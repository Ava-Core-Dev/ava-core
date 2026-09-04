"""One function per report kind × morning / midday / evening.

Writes a local snapshot. Does not post Discord. Does not call Grok.
Hourly clip packs still speak solar / weather / Kīlauea / host at :00.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from apps.core import config
from apps.core.services import day_board

log = logging.getLogger("ava.day_reports")
HST = ZoneInfo("Pacific/Honolulu")


def _read_json(path: Path) -> dict:
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _clip(text: str, n: int = 1200) -> str:
    body = (text or "").strip()
    if len(body) <= n:
        return body
    return body[: n].rstrip() + "\n…"


def _facts_kind(kind: str) -> str:
    state = config.DATA_DIR / "state"
    if kind == "solar":
        try:
            from apps.core.services import db_facts

            return db_facts.ecoflow_line()
        except Exception as e:
            return f"Solar: {type(e).__name__}"
    if kind == "host":
        try:
            from apps.core.services import db_facts

            return db_facts.host_line()
        except Exception as e:
            return f"Host: {type(e).__name__}"
    if kind == "weather":
        reports = sorted(
            config.REPORTS_DIR.glob("solar-weather-*.md"),
            key=lambda x: x.stat().st_mtime,
            reverse=True,
        )
        if reports:
            return _clip(reports[0].read_text(encoding="utf-8", errors="replace"), 900)
        return "Weather file not on disk yet."
    if kind == "kilauea":
        row = _read_json(state / "kilauea-alert.json")
        if not row:
            return "Kīlauea: no alert file."
        bits = [
            str(row.get("alert_level") or row.get("alert") or "unknown"),
            str(row.get("color") or ""),
            str(row.get("updated") or row.get("at") or ""),
        ]
        return "Kīlauea: " + " · ".join(b for b in bits if b)
    if kind == "economy":
        row = _read_json(state / "player-economy.json")
        if not row:
            return "Economy: no snapshot yet."
        return (
            f"Economy: wallets {row.get('wallets')} · "
            f"gold {row.get('positive_gold') or row.get('total_gold')} · "
            f"ok {row.get('ok')}"
        )
    if kind == "adsense":
        row = _read_json(state / "adsense-report.json")
        if not row:
            return "AdSense: no report yet."
        return f"AdSense last {row.get('last_kind') or '?'} · ok {row.get('last_ok')} · {row.get('last_at') or ''}"
    if kind == "admob":
        row = _read_json(state / "admob-report.json")
        if not row:
            return "AdMob: no report yet."
        return f"AdMob last {row.get('last_kind') or '?'} · ok {row.get('last_ok')} · {row.get('last_at') or ''}"
    if kind == "finance":
        for name in ("stripe-poll.json", "stripe.json", "finance.json"):
            row = _read_json(state / name)
            if row:
                return _clip(json.dumps(row, default=str), 800)
        return "Finance: no Stripe snapshot file."
    if kind == "governance":
        row = _read_json(state / "governance.json")
        if not row:
            return "Governance: no snapshot yet."
        flags = row.get("flags") or {}
        return (
            f"Governance people {row.get('people')} · "
            f"gate {flags.get('cursor_gate')} · "
            f"source {row.get('source')}"
        )
    if kind == "identity":
        try:
            from apps.core.services import db_facts, guests

            line = db_facts.identity_line()
            n = guests.today_count()
            return f"{line} Guests recorded today: {n}."
        except Exception as e:
            return f"Identity: {type(e).__name__}"
    if kind == "community":
        current = config.REPORTS_DIR / "morning-report-current.md"
        if current.is_file():
            return _clip(current.read_text(encoding="utf-8", errors="replace"), 900)
        return "Community: no current morning report file."
    return f"{kind}: unknown kind."


async def run_kind_slot(kind: str, slot: str) -> dict:
    kind = (kind or "").strip().lower()
    slot = (slot or "").strip().lower()
    if kind not in day_board.REPORT_KINDS or slot not in day_board.SLOTS:
        return {"ok": False, "detail": "bad_kind_or_slot", "kind": kind, "slot": slot}
    if day_board.fired_today(kind, slot):
        return {"ok": True, "skipped": True, "reason": "already_fired", "kind": kind, "slot": slot}

    now = datetime.now(HST)
    body = _facts_kind(kind)
    stamp = now.strftime("%Y-%m-%d %H:%M HST")
    title = f"Ava {slot} {kind} report"
    text = f"**{title}** — {stamp}\n\n{body}\n"
    dest = day_board.snapshot_dir() / f"{now.strftime('%Y-%m-%d')}-{slot}-{kind}.md"
    dest.write_text(text, encoding="utf-8")
    day_board.mark_fired(kind, slot, extra={"path": str(dest)})
    log.info("day report %s_%s path=%s", slot, kind, dest.name)
    return {"ok": True, "kind": kind, "slot": slot, "path": str(dest), "function": f"{slot}_{kind}"}


async def run_slot(slot: str) -> dict:
    slot = (slot or "").strip().lower()
    if slot not in day_board.SLOTS:
        return {"ok": False, "detail": "bad_slot"}
    out = []
    for kind in day_board.REPORT_KINDS:
        out.append(await run_kind_slot(kind, slot))
    job_id = {
        "morning": "day-reports-morning",
        "midday": "day-reports-midday",
        "evening": "day-reports-evening",
    }[slot]
    day_board.mark_job(job_id)
    return {"ok": True, "slot": slot, "ran": out}


async def run_morning_slot() -> dict:
    return await run_slot("morning")


async def run_midday_slot() -> dict:
    return await run_slot("midday")


async def run_evening_slot() -> dict:
    return await run_slot("evening")


async def maybe_boot_morning() -> dict:
    """Origin start: run morning slots only before noon HST, once per day."""
    now = datetime.now(HST)
    if now.hour >= 12:
        return {"ok": True, "skipped": True, "reason": "after_noon"}
    return await run_morning_slot()


# ── morning ──────────────────────────────────────────────────────────────────

async def morning_solar():
    return await run_kind_slot("solar", "morning")


async def morning_weather():
    return await run_kind_slot("weather", "morning")


async def morning_kilauea():
    return await run_kind_slot("kilauea", "morning")


async def morning_host():
    return await run_kind_slot("host", "morning")


async def morning_economy():
    return await run_kind_slot("economy", "morning")


async def morning_adsense():
    return await run_kind_slot("adsense", "morning")


async def morning_admob():
    return await run_kind_slot("admob", "morning")


async def morning_finance():
    return await run_kind_slot("finance", "morning")


async def morning_governance():
    return await run_kind_slot("governance", "morning")


async def morning_identity():
    return await run_kind_slot("identity", "morning")


async def morning_community():
    return await run_kind_slot("community", "morning")


# ── midday ───────────────────────────────────────────────────────────────────

async def midday_solar():
    return await run_kind_slot("solar", "midday")


async def midday_weather():
    return await run_kind_slot("weather", "midday")


async def midday_kilauea():
    return await run_kind_slot("kilauea", "midday")


async def midday_host():
    return await run_kind_slot("host", "midday")


async def midday_economy():
    return await run_kind_slot("economy", "midday")


async def midday_adsense():
    return await run_kind_slot("adsense", "midday")


async def midday_admob():
    return await run_kind_slot("admob", "midday")


async def midday_finance():
    return await run_kind_slot("finance", "midday")


async def midday_governance():
    return await run_kind_slot("governance", "midday")


async def midday_identity():
    return await run_kind_slot("identity", "midday")


async def midday_community():
    return await run_kind_slot("community", "midday")


# ── evening ──────────────────────────────────────────────────────────────────

async def evening_solar():
    return await run_kind_slot("solar", "evening")


async def evening_weather():
    return await run_kind_slot("weather", "evening")


async def evening_kilauea():
    return await run_kind_slot("kilauea", "evening")


async def evening_host():
    return await run_kind_slot("host", "evening")


async def evening_economy():
    return await run_kind_slot("economy", "evening")


async def evening_adsense():
    return await run_kind_slot("adsense", "evening")


async def evening_admob():
    return await run_kind_slot("admob", "evening")


async def evening_finance():
    return await run_kind_slot("finance", "evening")


async def evening_governance():
    return await run_kind_slot("governance", "evening")


async def evening_identity():
    return await run_kind_slot("identity", "evening")


async def evening_community():
    return await run_kind_slot("community", "evening")

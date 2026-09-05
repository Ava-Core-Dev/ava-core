"""HST daily report due ledger — morning / midday / evening / late.

State: data/state/daily-reports-due.json
Late is optional and never catch-up on boot or morning run_due.
"""
from __future__ import annotations

import json
import logging
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from apps.core import config

log = logging.getLogger("ava.daily_report_board")
HST = ZoneInfo("Pacific/Honolulu")

STATE_PATH = config.DATA_DIR / "state" / "daily-reports-due.json"

SLOTS = ("morning", "midday", "evening", "late")

# scheduled HST clock + mandatory/catch-up policy
_SLOT_META: dict[str, dict[str, Any]] = {
    "morning": {
        "hour": 10,
        "minute": 0,
        "mandatory": True,
        "catch_up_allowed": True,
    },
    "midday": {
        "hour": 11,
        "minute": 55,
        "mandatory": True,
        "catch_up_allowed": True,
    },
    "evening": {
        "hour": 17,
        "minute": 15,
        "mandatory": True,
        "catch_up_allowed": True,
    },
    "late": {
        "hour": 22,
        "minute": 0,
        "mandatory": False,
        "catch_up_allowed": False,
    },
}

_DONEISH = frozenset({"done", "missed", "skipped_optional"})
_RETRYABLE = frozenset({"due", "failed"})


def _now() -> datetime:
    return datetime.now(HST)


def _day_key(now: datetime | None = None) -> str:
    return (now or _now()).strftime("%Y-%m-%d")


def _read() -> dict:
    if not STATE_PATH.is_file():
        return {}
    try:
        data = json.loads(STATE_PATH.read_text(encoding="utf-8-sig"))
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _write(data: dict) -> dict:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    out = dict(data)
    out["updated_at"] = datetime.now(timezone.utc).isoformat()
    STATE_PATH.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    return out


def _engine_mp3_defaults(kind: str) -> tuple[str, str]:
    try:
        from apps.core.services import report_generation

        settings = report_generation.type_settings(kind)
        engine = report_generation.normalize_engine(settings.get("engine"))
        mp3 = report_generation.normalize_mp3(settings.get("mp3"))
        return engine, mp3
    except Exception:
        return "local", "local"


def _seed_slot(kind: str, day: str) -> dict:
    meta = _SLOT_META[kind]
    engine, mp3 = _engine_mp3_defaults(kind)
    scheduled = f"{day}T{meta['hour']:02d}:{meta['minute']:02d}:00"
    return {
        "status": "pending",
        "scheduled_at": scheduled,
        "hour": meta["hour"],
        "minute": meta["minute"],
        "mandatory": bool(meta["mandatory"]),
        "catch_up_allowed": bool(meta["catch_up_allowed"]),
        "engine_req": engine,
        "mp3_req": mp3,
        "completed_at": None,
        "mp3": None,
        "spend": None,
        "error": None,
        "started_at": None,
    }


def _expire_prior_day(prior: dict, prior_day: str) -> dict:
    """Unfinished mandatory → missed. Optional unfinished → skipped_optional."""
    slots = prior.get("slots") if isinstance(prior.get("slots"), dict) else {}
    changed = False
    for kind in SLOTS:
        row = slots.get(kind)
        if not isinstance(row, dict):
            continue
        st = str(row.get("status") or "")
        if st in _DONEISH:
            continue
        if row.get("mandatory"):
            row["status"] = "missed"
            row["error"] = row.get("error") or "unfinished_after_midnight"
            row["completed_at"] = datetime.now(timezone.utc).isoformat()
            changed = True
            log.info("daily board %s %s → missed (day rolled)", prior_day, kind)
        elif st in {"pending", "due", "failed", "running"}:
            row["status"] = "skipped_optional"
            row["completed_at"] = datetime.now(timezone.utc).isoformat()
            changed = True
    if changed:
        prior["slots"] = slots
        prior["expired_at"] = datetime.now(timezone.utc).isoformat()
    return prior


def ensure_today(*, now: datetime | None = None) -> dict:
    """Seed today's four slots. Prior unfinished mandatory → missed (not regen)."""
    now = now or _now()
    day = _day_key(now)
    data = _read()
    cur_day = str(data.get("day") or "")

    if cur_day and cur_day != day:
        history = data.setdefault("history", {})
        if not isinstance(history, dict):
            history = {}
            data["history"] = history
        expired = _expire_prior_day(deepcopy(data), cur_day)
        # Keep a slim prior record (drop deep history nesting).
        history[cur_day] = {
            "day": cur_day,
            "slots": expired.get("slots") or {},
            "expired_at": expired.get("expired_at"),
        }
        # Cap history size.
        for old in sorted(history.keys())[:-14]:
            history.pop(old, None)
        data = {
            "day": day,
            "slots": {k: _seed_slot(k, day) for k in SLOTS},
            "history": history,
        }
        return _write(data)

    if cur_day != day or not isinstance(data.get("slots"), dict):
        data = {
            "day": day,
            "slots": {k: _seed_slot(k, day) for k in SLOTS},
            "history": data.get("history") if isinstance(data.get("history"), dict) else {},
        }
        return _write(data)

    slots = data["slots"]
    changed = False
    for kind in SLOTS:
        if kind not in slots or not isinstance(slots[kind], dict):
            slots[kind] = _seed_slot(kind, day)
            changed = True
            continue
        row = slots[kind]
        meta = _SLOT_META[kind]
        for key, val in (
            ("mandatory", meta["mandatory"]),
            ("catch_up_allowed", meta["catch_up_allowed"]),
            ("hour", meta["hour"]),
            ("minute", meta["minute"]),
        ):
            if key not in row:
                row[key] = val
                changed = True
        if "scheduled_at" not in row:
            row["scheduled_at"] = f"{day}T{meta['hour']:02d}:{meta['minute']:02d}:00"
            changed = True
        eng, mp3 = _engine_mp3_defaults(kind)
        # Always refresh from live toggles so stale cloud does not stick after lockout.
        if row.get("engine_req") != eng:
            row["engine_req"] = eng
            changed = True
        if row.get("mp3_req") != mp3:
            row["mp3_req"] = mp3
            changed = True
        if "engine_req" not in row or "mp3_req" not in row:
            row.setdefault("engine_req", eng)
            row.setdefault("mp3_req", mp3)
            changed = True
    if changed:
        data["slots"] = slots
        return _write(data)
    return data


def mark_due(*, now: datetime | None = None) -> dict:
    """Past schedule time and not finished → due (failed stays retryable)."""
    now = now or _now()
    data = ensure_today(now=now)
    day = data["day"]
    slots = data["slots"]
    changed = False
    for kind in SLOTS:
        row = slots.get(kind)
        if not isinstance(row, dict):
            continue
        st = str(row.get("status") or "pending")
        if st in _DONEISH or st == "running":
            continue
        if st == "failed":
            # Remains retryable; surface as due for runners.
            if st != "due":
                # keep failed — run_due accepts failed
                pass
            continue
        meta = _SLOT_META[kind]
        due_at = now.replace(
            hour=int(meta["hour"]),
            minute=int(meta["minute"]),
            second=0,
            microsecond=0,
        )
        if now >= due_at and st == "pending":
            row["status"] = "due"
            row["marked_due_at"] = now.isoformat()
            changed = True
            log.info("daily board %s %s → due", day, kind)
    if changed:
        data["slots"] = slots
        return _write(data)
    return data


def status(*, now: datetime | None = None) -> dict:
    data = mark_due(now=now)
    return {
        "ok": True,
        "path": str(STATE_PATH),
        "day": data.get("day"),
        "slots": data.get("slots") or {},
        "updated_at": data.get("updated_at"),
    }


def get_slot(kind: str) -> dict | None:
    kind = (kind or "").strip().lower()
    data = ensure_today()
    row = (data.get("slots") or {}).get(kind)
    return dict(row) if isinstance(row, dict) else None


def mark_running(kind: str) -> dict:
    kind = (kind or "").strip().lower()
    if kind not in SLOTS:
        return {"ok": False, "detail": "unknown_slot"}
    data = ensure_today()
    row = data["slots"][kind]
    row["status"] = "running"
    row["started_at"] = datetime.now(timezone.utc).isoformat()
    row["error"] = None
    data["slots"][kind] = row
    _write(data)
    return {"ok": True, "kind": kind, "status": "running"}


def mark_done(
    kind: str,
    *,
    mp3: str | None = None,
    engine: str | None = None,
    spend: dict | None = None,
) -> dict:
    kind = (kind or "").strip().lower()
    if kind not in SLOTS:
        return {"ok": False, "detail": "unknown_slot"}
    data = ensure_today()
    row = data["slots"][kind]
    row["status"] = "done"
    row["completed_at"] = datetime.now(timezone.utc).isoformat()
    row["error"] = None
    if mp3:
        row["mp3"] = str(mp3)
    if engine:
        row["engine"] = str(engine)
    if spend is not None:
        row["spend"] = spend
    data["slots"][kind] = row
    _write(data)
    log.info("daily board %s %s → done mp3=%s", data.get("day"), kind, mp3)
    return {"ok": True, "kind": kind, "status": "done", "mp3": row.get("mp3")}


def mark_failed(kind: str, *, error: str | None = None) -> dict:
    """Fail stays retryable same HST day (status failed; run_due retries)."""
    kind = (kind or "").strip().lower()
    if kind not in SLOTS:
        return {"ok": False, "detail": "unknown_slot"}
    data = ensure_today()
    row = data["slots"][kind]
    row["status"] = "failed"
    row["error"] = str(error or "failed")[:400]
    row["failed_at"] = datetime.now(timezone.utc).isoformat()
    data["slots"][kind] = row
    _write(data)
    log.warning("daily board %s %s → failed (%s)", data.get("day"), kind, row["error"])
    return {"ok": True, "kind": kind, "status": "failed", "error": row["error"]}


def next_catchup_slot(*, now: datetime | None = None) -> str | None:
    """Oldest mandatory due/failed with catch_up_allowed. Never late."""
    data = mark_due(now=now)
    candidates: list[tuple[str, str]] = []
    for kind in SLOTS:
        row = (data.get("slots") or {}).get(kind) or {}
        if not isinstance(row, dict):
            continue
        if not row.get("mandatory"):
            continue
        if not row.get("catch_up_allowed", True):
            continue
        st = str(row.get("status") or "")
        if st not in _RETRYABLE:
            continue
        scheduled = str(row.get("scheduled_at") or "")
        candidates.append((scheduled, kind))
    if not candidates:
        return None
    candidates.sort(key=lambda x: x[0])
    return candidates[0][1]


async def run_due(
    *,
    now: datetime | None = None,
    play: bool = True,
    allow_tts: bool = True,
) -> dict:
    """Run oldest mandatory due/failed. Never late. Never boot catch-up for late."""
    kind = next_catchup_slot(now=now)
    if not kind:
        return {"ok": True, "skipped": True, "detail": "nothing_due"}
    if kind == "late":
        return {"ok": True, "skipped": True, "detail": "late_no_catchup"}

    mark_running(kind)
    from apps.core.services import report_generation

    try:
        result = report_generation.generate(
            kind,
            dry_run=False,
            allow_tts=allow_tts,
            offline=False,
            update_board=False,  # we own board status here
        )
    except Exception as e:
        mark_failed(kind, error=type(e).__name__)
        return {"ok": False, "kind": kind, "detail": type(e).__name__}

    ok = bool(result.get("ok")) and not result.get("blocked")
    tts = result.get("tts") or {}
    mp3_path = tts.get("current") or tts.get("mp3")
    if ok and (result.get("text") or "").strip():
        mark_done(
            kind,
            mp3=str(mp3_path) if mp3_path else None,
            engine=str(result.get("engine") or ""),
        )
        play_out = None
        if play:
            from apps.core.services import voice_events

            play_out = await voice_events.play_report_mp3(
                tts.get("current"),
                tts.get("mp3"),
                name="status",
                kind=kind,
            )
            if play_out.get("ok") and play_out.get("mp3"):
                mark_done(
                    kind,
                    mp3=str(play_out.get("mp3")),
                    engine=str(result.get("engine") or ""),
                )
        return {
            "ok": True,
            "kind": kind,
            "result": result,
            "play": play_out,
        }

    mark_failed(kind, error=str(result.get("detail") or "generate_failed")[:400])
    return {
        "ok": False,
        "kind": kind,
        "result": result,
        "detail": result.get("detail"),
    }

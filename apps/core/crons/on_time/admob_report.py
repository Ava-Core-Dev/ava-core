"""AdMob network report — twice daily: Core boot + end-of-day close (HST)."""

from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

log = logging.getLogger("ava.cron.admob_report")
HST = ZoneInfo("Pacific/Honolulu")
BOOT_COOLDOWN_S = int(os.getenv("ADMOB_BOOT_COOLDOWN_S", str(30 * 60)))


def _state_path() -> Path:
    from apps.core import config

    return config.DATA_DIR / "state" / "admob-report.json"


def _load_state() -> dict:
    p = _state_path()
    if not p.is_file():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_state(data: dict) -> None:
    p = _state_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def _should_post_boot(*, force: bool = False) -> bool:
    if force:
        return True
    st = _load_state()
    last = float(st.get("last_boot_at") or 0)
    if last and (time.time() - last) < BOOT_COOLDOWN_S:
        log.info(
            "AdMob boot report suppressed — cooldown %ss left",
            int(BOOT_COOLDOWN_S - (time.time() - last)),
        )
        return False
    return True


def _channel() -> str:
    from apps.core import config

    return (
        os.getenv("DISCORD_ADMOB_CHANNEL_ID", "").strip()
        or os.getenv("DISCORD_ADSENSE_CHANNEL_ID", "").strip()
        or os.getenv("DISCORD_AUTOMATIONS_CHANNEL_ID", "").strip()
        or config.DISCORD_CHANNELS.get("automations", "")
        or "1545284463783710720"
    )


async def run(kind: str = "eod", *, force: bool = False, post: bool = True) -> dict:
    from apps.core import config
    from apps.core.services import admob
    from apps.core.services import discord

    kind = (kind or "eod").strip().lower()
    if kind not in {"boot", "eod", "manual"}:
        kind = "eod"

    if kind == "boot" and not _should_post_boot(force=force):
        return {"ok": True, "skipped": True, "reason": "boot_cooldown"}

    now = datetime.now(HST)
    label = {
        "boot": f"boot · {now.strftime('%Y-%m-%d %H:%M HST')}",
        "eod": f"end-of-day close · {now.strftime('%Y-%m-%d %H:%M HST')}",
        "manual": f"manual · {now.strftime('%Y-%m-%d %H:%M HST')}",
    }[kind]

    days = int(os.getenv("ADMOB_REPORT_DAYS", "7") or 7)
    snap = admob.daily_snapshot(days=days)

    reports = Path(config.REPORTS_DIR)
    reports.mkdir(parents=True, exist_ok=True)
    stamp = now.strftime("%Y-%m-%d")
    out = reports / f"admob-{kind}-{stamp}.md"
    out.write_text(
        "\n".join(
            [
                f"# AdMob {kind} report — {stamp} HST",
                "",
                f"Generated {now.isoformat()}",
                "",
                "```json",
                json.dumps(snap, indent=2, default=str)[:12000],
                "```",
                "",
            ]
        ),
        encoding="utf-8",
    )

    stub = config.DATA_DIR / "state" / "status-events.jsonl"
    stub.parent.mkdir(parents=True, exist_ok=True)
    status = "ok" if snap.get("ok") else "warn"
    with stub.open("a", encoding="utf-8") as fh:
        fh.write(
            f"{datetime.utcnow().isoformat()}Z\tcron · admob-report · {status} · {kind} · {out.name}\n"
        )

    posted = False
    if post:
        msg = admob.format_discord(snap, label=label)
        r = await discord.post_message(_channel(), msg[:1900])
        posted = bool(r)

    st = _load_state()
    st["last_kind"] = kind
    st["last_ok"] = bool(snap.get("ok"))
    st["last_path"] = str(out)
    st["last_at"] = now.isoformat()
    if kind == "boot":
        st["last_boot_at"] = time.time()
    if kind == "eod":
        st["last_eod_date"] = stamp
    _save_state(st)

    log.info(
        "AdMob report kind=%s ok=%s posted=%s path=%s",
        kind,
        snap.get("ok"),
        posted,
        out,
    )
    return {
        "ok": bool(snap.get("ok")),
        "kind": kind,
        "posted": posted,
        "path": str(out),
        "channel": _channel(),
        "snapshot": {k: snap.get(k) for k in ("ok", "detail", "account", "start", "end")},
    }

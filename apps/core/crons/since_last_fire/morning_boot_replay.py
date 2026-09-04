"""Replay morning-boot MP3 every :30 HST until noon (same day). No TTS spend."""

from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

log = logging.getLogger("ava.cron.morning_boot_replay")
HST = ZoneInfo("Pacific/Honolulu")
STATE_NAME = "morning-boot-replay.json"


def _state_path() -> Path:
    from apps.core import config

    return config.DATA_DIR / "state" / STATE_NAME


def _load() -> dict:
    p = _state_path()
    if not p.is_file():
        return {}
    try:
        # utf-8-sig: PowerShell Set-Content -Encoding utf8 may write a BOM that
        # plain utf-8 json.loads rejects → empty state → silent skip (no play).
        data = json.loads(p.read_text(encoding="utf-8-sig"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save(data: dict) -> None:
    p = _state_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


async def run() -> dict:
    st = _load()
    if not st.get("enabled"):
        return {"ok": True, "skipped": True, "reason": "disabled"}

    now = datetime.now(HST)
    until_raw = str(st.get("until") or "").strip()
    try:
        until = datetime.fromisoformat(until_raw)
        if until.tzinfo is None:
            until = until.replace(tzinfo=HST)
    except ValueError:
        until = now.replace(hour=12, minute=0, second=0, microsecond=0)

    if now >= until:
        st["enabled"] = False
        st["stopped_at"] = now.isoformat()
        st["play_once"] = False
        _save(st)
        log.info("morning-boot replay stopped (past until %s)", until.isoformat())
        return {"ok": True, "skipped": True, "reason": "past_until", "until": until.isoformat()}

    play_once = bool(st.get("play_once"))
    # Scheduled fires are :30 only; manual/play_once may run any minute.
    if not play_once and now.minute != 30:
        return {"ok": True, "skipped": True, "reason": "not_:30"}

    mp3 = Path(str(st.get("mp3") or ""))
    if not mp3.is_file():
        current = Path(str(st.get("current") or ""))
        mp3 = current if current.is_file() else mp3
    if not mp3.is_file():
        log.warning("morning-boot replay missing mp3")
        return {"ok": False, "detail": "mp3_missing"}

    from apps.voice.director import Priority, get_director

    await get_director().queue(
        mp3,
        name="morning_boot",
        priority=Priority.REPORT,
        scene=None,
    )
    st["play_once"] = False
    st["last_played_at"] = now.isoformat()
    st["last_played"] = str(mp3)
    _save(st)
    log.info("morning-boot replay queued %s", mp3.name)
    return {"ok": True, "played": True, "mp3": str(mp3), "play_once_cleared": play_once}

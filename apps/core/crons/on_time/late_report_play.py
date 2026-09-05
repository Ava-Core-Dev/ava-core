"""Late report play — 22:12 HST. Only if late WAV/MP3 exists (optional slot)."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

log = logging.getLogger("ava.cron.late_report_play")


async def run():
    log.info("Late report play (22:12)  %s", datetime.now(timezone.utc).isoformat())
    from apps.core import config
    from apps.core.services import daily_report_board, voice_events

    slot = daily_report_board.get_slot("late") or {}
    current = config.GENERATED_DIR / "late-report-current.wav"
    current_mp3 = config.GENERATED_DIR / "late-report-current.mp3"
    mp3 = slot.get("mp3") or slot.get("wav")
    has_current = (current.is_file() and current.stat().st_size > 0) or (
        current_mp3.is_file() and current_mp3.stat().st_size > 0
    )
    if not has_current and not mp3:
        log.info("Late play skipped — no audio")
        return {"ok": True, "skipped": True, "detail": "mp3_missing"}

    play = await voice_events.play_report_mp3(
        mp3,
        current,
        current_mp3,
        name="status",
        kind="late",
    )
    log.info("late play=%s", play)
    return {"ok": True, "play": play}

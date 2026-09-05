"""Midday report play — 12:05 HST (after noon chime)."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

log = logging.getLogger("ava.cron.midday_report_play")


async def run():
    log.info("Midday report play (12:05)  %s", datetime.now(timezone.utc).isoformat())
    from apps.core import config
    from apps.core.services import report_audio_manual, voice_events

    current = config.GENERATED_DIR / "midday-report-current.mp3"
    boot_cur = config.GENERATED_DIR / "midday-boot-current.mp3"
    if current.is_file() and current.stat().st_size > 0:
        play = await voice_events.play_report_mp3(
            current, boot_cur, name="status", kind="midday"
        )
    elif boot_cur.is_file() and boot_cur.stat().st_size > 0:
        play = await voice_events.play_report_mp3(
            boot_cur, name="status", kind="midday"
        )
    else:
        play = await report_audio_manual.play_scheduled("midday")
    log.info("midday play=%s", play)
    return {"ok": True, "play": play}

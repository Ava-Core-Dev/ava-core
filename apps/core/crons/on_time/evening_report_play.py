"""Evening report play — 17:28 HST. Queues current evening MP3 (no TTS spend)."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

log = logging.getLogger("ava.cron.evening_report_play")


async def run():
    log.info("Evening report play (17:28)  %s", datetime.now(timezone.utc).isoformat())
    from apps.core import config
    from apps.core.services import report_audio_manual, voice_events

    current = config.GENERATED_DIR / "evening-report-current.mp3"
    if current.is_file() and current.stat().st_size > 0:
        play = await voice_events.play_report_mp3(
            current,
            name="status",
            kind="evening",
        )
    else:
        play = await report_audio_manual.play_scheduled("evening")
    log.info("evening play=%s", play)
    return {"ok": True, "play": play}

"""Morning report play — 10:12 HST. Queues morning MP3 after generate slack."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

log = logging.getLogger("ava.cron.morning_report_play")


async def run():
    log.info("Morning report play (10:12)  %s", datetime.now(timezone.utc).isoformat())
    from apps.core import config
    from apps.core.services import report_audio_manual, voice_events

    current = config.GENERATED_DIR / "morning-report-current.mp3"
    boot_cur = config.GENERATED_DIR / "morning-boot-current.mp3"
    if current.is_file() and current.stat().st_size > 0:
        play = await voice_events.play_report_mp3(
            current, boot_cur, name="morning_report", kind="morning"
        )
    elif boot_cur.is_file() and boot_cur.stat().st_size > 0:
        play = await voice_events.play_report_mp3(
            boot_cur, name="morning_report", kind="morning"
        )
    else:
        play = await report_audio_manual.play_scheduled("morning")
    log.info("morning play=%s", play)
    return {"ok": True, "play": play}

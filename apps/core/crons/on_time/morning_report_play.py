"""Morning report play — 10:12 HST. Queues morning WAV after generate slack."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

log = logging.getLogger("ava.cron.morning_report_play")


async def run():
    log.info("Morning report play (10:12)  %s", datetime.now(timezone.utc).isoformat())
    from apps.core.services import report_periodic_audio

    play = await report_periodic_audio.play_if_due("morning", reason="scheduled")
    log.info("morning play=%s", play)
    return {"ok": True, "play": play}

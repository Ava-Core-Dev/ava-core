"""Evening report play — 17:28 HST. Queues current evening WAV (no TTS spend)."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

log = logging.getLogger("ava.cron.evening_report_play")


async def run():
    log.info("Evening report play (17:28)  %s", datetime.now(timezone.utc).isoformat())
    from apps.core.services import report_periodic_audio

    play = await report_periodic_audio.play_if_due("evening", reason="scheduled")
    log.info("evening play=%s", play)
    return {"ok": True, "play": play}

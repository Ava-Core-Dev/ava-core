"""Late report play — 22:12 HST. Only if late WAV/MP3 exists (optional slot)."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

log = logging.getLogger("ava.cron.late_report_play")


async def run():
    log.info("Late report play (22:12)  %s", datetime.now(timezone.utc).isoformat())
    from apps.core.services import report_periodic_audio

    play = await report_periodic_audio.play_if_due("late", reason="scheduled")
    log.info("late play=%s", play)
    return {"ok": True, "play": play}

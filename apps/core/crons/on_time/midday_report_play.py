"""Midday report play — 12:05 HST (after noon chime)."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

log = logging.getLogger("ava.cron.midday_report_play")


async def run():
    log.info("Midday report play (12:05)  %s", datetime.now(timezone.utc).isoformat())
    from apps.core.services import report_periodic_audio

    play = await report_periodic_audio.play_if_due("midday", reason="scheduled")
    log.info("midday play=%s", play)
    return {"ok": True, "play": play}

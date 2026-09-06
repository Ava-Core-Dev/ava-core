"""Refresh worldwide tropical cyclones and rebuild Hurricane Tracker slides when that mode is on."""

from __future__ import annotations

import logging

log = logging.getLogger("ava.cron.hurricane_tracker")


async def run() -> None:
    """Legacy name — fetch only. OBS and radio are separate on-time stages."""
    from apps.core.crons.on_time import hurricane_fetch

    await hurricane_fetch.run()

"""Refresh official NHC EPAC + CPHC graphics into media and OBS."""

from __future__ import annotations

import logging

log = logging.getLogger("ava.cron.nhc_media")


async def run() -> None:
    """Folded into hurricane_fetch. Kept so a leftover scheduler id is a no-op."""
    log.info("nhc_media skipped — folded into hurricane_fetch")

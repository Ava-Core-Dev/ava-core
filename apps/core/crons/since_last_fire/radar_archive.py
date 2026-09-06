"""Fetch the NWS Hawaii radar loop and append it to the local archive."""

from __future__ import annotations

import logging

log = logging.getLogger("ava.cron.radar_archive")


async def run(reason: str = "poll"):
    from apps.core.services import radar_archive

    result = radar_archive.run()
    log.info("radar archive reason=%s result=%s", reason, result)
    return result

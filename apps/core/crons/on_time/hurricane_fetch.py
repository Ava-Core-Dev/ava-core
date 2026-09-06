"""Fetch tropical boards (NHC + RAMMB + JTWC) and NHC graphics. No radio, no OBS."""

from __future__ import annotations

import logging

log = logging.getLogger("ava.cron.hurricane_fetch")


async def run() -> None:
    from apps.core.services import hurricane_desk
    from apps.core.services.hurricane_tracker import refresh_storms
    from apps.core.services.nhc_media import ingest

    if not hurricane_desk.acquire_stage("fetch"):
        return
    try:
        data = await refresh_storms()
        nhc = await ingest()
        log.info(
            "hurricane fetch storms=%s sources=%s nhc=%s",
            data.get("count"),
            data.get("sources"),
            nhc.get("downloaded"),
        )
    finally:
        hurricane_desk.release_stage("fetch")

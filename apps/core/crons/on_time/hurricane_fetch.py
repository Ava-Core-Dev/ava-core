"""Fetch tropical boards (NHC / RAMMB / JTWC). Separate minute from build/radio."""

from __future__ import annotations

import logging

log = logging.getLogger("ava.cron.hurricane_fetch")


async def run() -> dict:
    from apps.core.services import hurricane_desk
    from apps.core.services.hurricane_tracker import refresh_storms

    if not hurricane_desk.acquire_stage("fetch"):
        log.info("hurricane_fetch skipped overlap")
        return {"ok": True, "skipped": "overlap"}
    try:
        payload = await refresh_storms()
        log.info("hurricane_fetch storms=%s sources=%s", payload.get("count"), payload.get("sources"))
        return {"ok": True, "count": payload.get("count"), "sources": payload.get("sources")}
    finally:
        hurricane_desk.release_stage("fetch")

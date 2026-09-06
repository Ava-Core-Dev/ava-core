"""Build hurricane desk text + WAV from on-disk storm/NWS state."""

from __future__ import annotations

import asyncio
import logging

log = logging.getLogger("ava.cron.hurricane_desk")


async def run() -> dict:
    from apps.core.services import hurricane_desk

    if not hurricane_desk.acquire_stage("build"):
        log.info("hurricane_desk skipped overlap")
        return {"ok": True, "skipped": "overlap"}
    try:
        payload = await asyncio.to_thread(hurricane_desk.build, write_wav=True)
        log.info("hurricane_desk ok=%s wav=%s", payload.get("ok"), (payload.get("wav") or {}).get("ok"))
        return payload
    finally:
        hurricane_desk.release_stage("build")

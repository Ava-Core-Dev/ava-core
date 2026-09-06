"""Play hurricane desk on the public program bus when Radio is on air."""

from __future__ import annotations

import logging

log = logging.getLogger("ava.cron.hurricane_radio")


async def run() -> dict:
    from apps.core.services import hurricane_desk

    if not hurricane_desk.acquire_stage("radio"):
        log.info("hurricane_radio skipped overlap")
        return {"ok": True, "skipped": "overlap"}
    try:
        out = await hurricane_desk.play_on_radio()
        log.info("hurricane_radio %s", out)
        return out
    finally:
        hurricane_desk.release_stage("radio")

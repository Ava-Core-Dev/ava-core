"""Queue hurricane desk WAV onto the radio program bus when on air."""

from __future__ import annotations

import logging

log = logging.getLogger("ava.cron.hurricane_radio")


async def run() -> None:
    from apps.core.services import hurricane_desk

    if not hurricane_desk.acquire_stage("radio"):
        return
    try:
        out = await hurricane_desk.play_on_radio()
        log.info("hurricane radio %s", {k: out.get(k) for k in ("ok", "skipped", "played", "name")})
    finally:
        hurricane_desk.release_stage("radio")

"""Build Hawaiʻi + global hurricane desk text from disk. No HTTP fetch."""

from __future__ import annotations

import logging

log = logging.getLogger("ava.cron.hurricane_desk")


async def run() -> None:
    from apps.core.services import hurricane_desk

    if not hurricane_desk.acquire_stage("build"):
        return
    try:
        out = hurricane_desk.build(write_wav=True)
        hi = out.get("hawaii") or {}
        log.info(
            "hurricane desk storms=%s nearest=%s %s nm wav=%s",
            out.get("storm_count"),
            hi.get("name"),
            hi.get("nm"),
            (out.get("wav") or {}).get("ok"),
        )
    finally:
        hurricane_desk.release_stage("build")

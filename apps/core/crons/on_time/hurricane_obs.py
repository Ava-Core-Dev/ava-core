"""OBS hurricane slides. Only when OBS is allowed."""

from __future__ import annotations

import logging

log = logging.getLogger("ava.cron.hurricane_obs")


async def run() -> dict:
    from apps.core import config
    from apps.core.services import hurricane_desk

    if not config.ENABLE_OBS:
        return {"ok": True, "skipped": "obs_off"}
    if not hurricane_desk.acquire_stage("obs"):
        log.info("hurricane_obs skipped overlap")
        return {"ok": True, "skipped": "overlap"}
    try:
        from apps.core.services.hurricane_tracker import apply_hurricane_kit

        out = await apply_hurricane_kit()
        log.info("hurricane_obs %s", (out or {}).get("ok"))
        return out if isinstance(out, dict) else {"ok": True, "kit": out}
    finally:
        hurricane_desk.release_stage("obs")

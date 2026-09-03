"""Rotate OBS through the daily broadcast scenes every few minutes."""

from __future__ import annotations

import logging

from apps.core import config

log = logging.getLogger("ava.cron.broadcast_loop")


async def run() -> None:
    if not config.ENABLE_OBS:
        log.info("broadcast_loop skipped (AVA_ENABLE_OBS=0)")
        return
    from apps.core.services.obs_studio import rotate_loop_scene
    from apps.core.services.obs_scene_visibility import refresh_auto_hide

    await refresh_auto_hide()
    result = await rotate_loop_scene()
    log.info("broadcast loop %s", result)

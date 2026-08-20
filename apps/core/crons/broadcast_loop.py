"""Rotate OBS through the daily broadcast scenes every few minutes."""

from __future__ import annotations

import logging

log = logging.getLogger("ava.cron.broadcast_loop")


async def run() -> None:
    from apps.core.services.obs_studio import rotate_loop_scene

    result = await rotate_loop_scene()
    log.info("broadcast loop %s", result)

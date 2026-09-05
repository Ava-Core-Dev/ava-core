"""Rotate OBS through the daily broadcast scenes every few minutes."""

from __future__ import annotations

import logging

log = logging.getLogger("ava.cron.broadcast_loop")


async def run() -> None:
    from apps.core.services.obs_presence import obs_skip_reason, obs_work_allowed

    if not obs_work_allowed():
        # Quiet — fires every 20s when scheduled; do not spam INFO while OBS is closed.
        log.debug("broadcast_loop skipped (%s)", obs_skip_reason() or "obs_idle")
        return
    from apps.core.services.obs_studio import rotate_loop_scene
    from apps.core.services.obs_scene_visibility import refresh_auto_hide

    await refresh_auto_hide()
    result = await rotate_loop_scene()
    log.info("broadcast loop %s", result)

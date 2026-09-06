"""OBS hurricane slides only. Uses storms already on disk."""

from __future__ import annotations

import logging

log = logging.getLogger("ava.cron.hurricane_obs")


async def run() -> None:
    from apps.core.services import hurricane_desk
    from apps.core.services.hurricane_tracker import apply_hurricane_kit, current_mode
    from apps.core.services.nhc_media import apply_nhc_obs_scenes
    from apps.core.services.obs_presence import obs_skip_reason, obs_work_allowed

    if not hurricane_desk.acquire_stage("obs"):
        return
    try:
        if not obs_work_allowed():
            log.debug("hurricane OBS skipped (%s)", obs_skip_reason() or "obs_idle")
            return
        mode = current_mode()
        if mode == "hurricane":
            kit = await apply_hurricane_kit()
            log.info("hurricane kit %s", {k: kit.get(k) for k in ("ok", "storms", "removed")})
            return
        obs = await apply_nhc_obs_scenes()
        log.info("nhc live on %s %s", mode, {k: obs.get(k) for k in ("ok", "scenes")})
    finally:
        hurricane_desk.release_stage("obs")

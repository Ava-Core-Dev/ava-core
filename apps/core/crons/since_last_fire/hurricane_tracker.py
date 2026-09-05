"""Refresh worldwide tropical cyclones and rebuild Hurricane Tracker slides when that mode is on."""

from __future__ import annotations

import logging

log = logging.getLogger("ava.cron.hurricane_tracker")


async def run() -> None:
    from apps.core.services.hurricane_tracker import apply_hurricane_kit, current_mode, refresh_storms
    from apps.core.services.nhc_media import apply_nhc_obs_scenes, ingest
    from apps.core.services.obs_presence import obs_skip_reason, obs_work_allowed

    data = await refresh_storms()
    nhc = await ingest()
    log.info("hurricanes %s storms sources=%s nhc=%s", data.get("count"), data.get("sources"), nhc.get("downloaded"))
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

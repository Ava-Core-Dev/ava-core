"""Refresh official NHC EPAC + CPHC graphics into media and OBS."""

from __future__ import annotations

import logging

log = logging.getLogger("ava.cron.nhc_media")


async def run() -> None:
    from apps.core.services.nhc_media import apply_nhc_obs_scenes, ingest
    from apps.core.services.obs_presence import obs_skip_reason, obs_work_allowed

    data = await ingest()
    log.info("nhc media downloaded=%s current=%s", data.get("downloaded"), list((data.get("current") or {})))
    if not obs_work_allowed():
        log.debug("nhc obs skipped (%s)", obs_skip_reason() or "obs_idle")
        return
    obs = await apply_nhc_obs_scenes()
    log.info("nhc obs %s", {k: obs.get(k) for k in ("ok", "scenes")})

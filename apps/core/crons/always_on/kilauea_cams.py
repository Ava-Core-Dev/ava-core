"""Refresh USGS V1/V2/V3 YouTube embed IDs and push them into OBS."""

from __future__ import annotations

import logging

log = logging.getLogger("ava.cron.kilauea_cams")


async def run() -> None:
    from apps.core.services.hurricane_tracker import current_mode
    from apps.core.services.kilauea_cams import apply_kilauea_kit, push_embeds_to_current_collection
    from apps.core.services.obs_presence import obs_skip_reason, obs_work_allowed

    if not obs_work_allowed():
        try:
            from apps.core.services.obs_desk_data import quake_feed

            await quake_feed()
        except Exception:
            pass
        log.debug("kilauea_cams OBS push skipped (%s)", obs_skip_reason() or "obs_idle")
        return

    if current_mode() == "kilauea":
        kit = await apply_kilauea_kit()
        log.info("kilauea kit %s", {k: kit.get(k) for k in ("ok", "cams")})
        return
    pushed = await push_embeds_to_current_collection()
    try:
        from apps.core.services.obs_desk_data import quake_feed

        await quake_feed()
    except Exception:
        pass
    log.info("kilauea embeds %s", {k: pushed.get(k) for k in ("ok", "changed")})

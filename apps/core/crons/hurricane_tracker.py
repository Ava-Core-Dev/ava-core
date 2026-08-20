"""Refresh worldwide tropical cyclones and rebuild Hurricane Tracker slides when that mode is on."""

from __future__ import annotations

import logging

log = logging.getLogger("ava.cron.hurricane_tracker")


async def run() -> None:
    from apps.core.services.hurricane_tracker import apply_hurricane_kit, current_mode, refresh_storms

    data = await refresh_storms()
    log.info("hurricanes %s storms sources=%s", data.get("count"), data.get("sources"))
    if current_mode() != "hurricane":
        return
    kit = await apply_hurricane_kit()
    log.info("hurricane kit %s", {k: kit.get(k) for k in ("ok", "storms", "removed")})

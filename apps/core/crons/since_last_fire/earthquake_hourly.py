"""Hourly local EQ report (HI + global). Also fires on new local M≥2.0."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

log = logging.getLogger("ava.cron.earthquake_hourly")


async def run(*, reason: str = "hourly", force: bool = False):
    log.info(
        "Earthquake hourly cron %s reason=%s",
        datetime.now(timezone.utc).isoformat(),
        reason,
    )
    from apps.core.services import earthquake_hourly

    out = await earthquake_hourly.build_and_maybe_play(
        reason=reason,
        force=force,
        play=True,
    )
    log.info(
        "EQ hourly done ok=%s announce=%s m2=%s wav=%s",
        out.get("ok"),
        out.get("announce"),
        out.get("fresh_local_m2"),
        out.get("wav"),
    )
    return out

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

    # Poll path (interval): only announce when new local M≥2.0.
    # Hourly path: always rebuild + announce.
    play = reason == "hourly" or force
    out = await earthquake_hourly.build_and_maybe_play(
        reason=reason,
        force=force,
        play=play or reason == "poll",
    )
    # On poll, build_and_maybe_play already announces only for fresh M≥2 or hourly.
    if reason == "poll":
        # Re-run logic: play flag true but announce only if fresh_m2 inside service.
        pass
    log.info(
        "EQ hourly done ok=%s announce=%s m2=%s",
        out.get("ok"),
        out.get("announce"),
        out.get("fresh_local_m2"),
    )
    return out

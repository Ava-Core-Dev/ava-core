"""Refresh EcoFlow quota every couple of minutes so the solar desk is never hours stale."""

from __future__ import annotations

import logging

log = logging.getLogger("ava.cron.ecoflow_quota")


async def run() -> None:
    from apps.core.crons.since_last_fire.solar_weather import live_snapshot

    snap = await live_snapshot()
    log.info(
        "ecoflow %s bank=%s load=%s packs=%s",
        snap.get("source"),
        snap.get("battery_pct"),
        snap.get("load_w"),
        len(snap.get("devices") or []),
    )

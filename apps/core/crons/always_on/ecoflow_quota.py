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
    devices = list(snap.get("devices") or [])
    down = (
        not snap
        or snap.get("state") == "offline"
        or (not devices and snap.get("battery_pct") is None)
    )
    if down:
        try:
            from apps.core.services import voice_events

            await voice_events.announce("phrase_ecoflow_down", cooldown_s=30 * 60)
        except Exception as e:
            log.debug("ecoflow_down voice skip: %s", e)

    # DELTA 2 AC ↔ solar hysteresis (MPPT fight with RIVER). After fresh quota only.
    try:
        from apps.core.services import ecoflow_ac_solar_gate

        gate = await ecoflow_ac_solar_gate.run_after_quota(execute=True)
        log.info(
            "ac-solar-gate decision=%s would=%s action=%s skipped=%s input=%s",
            gate.get("decision"),
            gate.get("would"),
            gate.get("action"),
            gate.get("skipped"),
            (gate.get("quota") or {}).get("input_w"),
        )
    except Exception as e:
        log.warning("ac-solar-gate skipped: %s", e)

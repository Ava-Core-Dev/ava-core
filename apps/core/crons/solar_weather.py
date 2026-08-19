"""Hourly solar + weather cron — posts to Discord #automations (NOT #updates)."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

log = logging.getLogger("ava.cron.solar_weather")


async def run():
    log.info("Solar+weather cron  %s", datetime.now(timezone.utc).isoformat())
    from apps.core import config
    from apps.core.services import discord

    # Read latest solar report from disk
    reports = sorted(config.REPORTS_DIR.glob("solar-weather-*.md"),
                     key=lambda p: p.stat().st_mtime, reverse=True)
    if not reports:
        log.warning("No solar-weather report found")
        return

    content = reports[0].read_text(errors="replace")[:1800]
    # Post only to #automations — NOT to #updates (only merged morning summary goes there)
    ch = config.DISCORD_CHANNELS["automations"]
    await discord.post_message(ch, content)
    log.info("Solar+weather posted to #automations")

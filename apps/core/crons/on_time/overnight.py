"""
Late-night relay cron — posts a continuous status snapshot every hour after 10 PM HST.

No sleep mode. No shutdown gate. Ava relays data whenever the device is powered on,
right up until actual power-off. This cron is just the scheduled late-night check-in;
all other crons (solar, NOAA, Kīlauea, economy) keep running unaffected.
"""

from __future__ import annotations

import logging
from datetime import datetime

log = logging.getLogger("ava.cron.overnight")


async def run():
    from apps.core import config
    from apps.core.services import discord

    now = datetime.now()
    now_hst = now.strftime("%H:%M HST — %a, %b %-d")

    # Read latest solar report for quick battery context
    solar_line = ""
    try:
        reports = sorted(
            config.REPORTS_DIR.glob("solar-weather-*.md"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        if reports:
            first_line = reports[0].read_text(errors="replace").splitlines()[0]
            solar_line = f"\n{first_line}"
    except Exception as e:
        log.debug("Could not read solar report for overnight: %s", e)

    content = (
        f"**Late-night status** — {now_hst}"
        f"{solar_line}\n"
        "All systems running. Relaying until device powers off."
    )

    await discord.post_message(config.DISCORD_CHANNELS.get("automations", ""), content)
    log.info("Overnight relay posted")

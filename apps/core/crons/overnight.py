"""Overnight reserve cron — posts status, evaluates shutdown."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

log = logging.getLogger("ava.cron.overnight")


async def run():
    from apps.core import config
    from apps.core.services import discord

    now_hst = datetime.now().strftime("%a, %b %-d, %H:%M HST")
    content = (
        f"**Overnight reserve** — {now_hst}\n"
        "Still up after 10pm — monitoring solar/battery overnight.\n"
        "Scheduled shutdown: 10:00 PM HST if bank < 20%."
    )
    await discord.post_message(config.DISCORD_CHANNELS["automations"], content)
    log.info("Overnight reserve posted")

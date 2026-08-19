"""Player economy cron — snapshot and post to #automations."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

log = logging.getLogger("ava.cron.economy")


async def run():
    from apps.core import config
    from apps.core.services import discord

    now_hst = datetime.now().strftime("%H:%M HST — %a, %b %-d")
    content = f"**Player base + economy** — {now_hst}\n_(economy data pending MySQL integration)_"
    await discord.post_message(config.DISCORD_CHANNELS["automations"], content)
    log.info("Player economy posted")

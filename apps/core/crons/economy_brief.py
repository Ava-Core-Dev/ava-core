"""Economy brief cron."""

from __future__ import annotations
import logging
log = logging.getLogger("ava.cron.economy_brief")

async def run():
    log.info("Economy brief cron running")

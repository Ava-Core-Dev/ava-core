"""Pull Cloudflare offline inbox onto this disk."""

from __future__ import annotations

import logging

log = logging.getLogger("ava.cron.inbox_drain")


async def run() -> None:
    from apps.core.services import offline_inbox

    result = await offline_inbox.drain()
    log.info(
        "inbox drain stored=%s deleted=%s ecoflow_cleared=%s",
        result.get("stored"),
        result.get("deleted"),
        result.get("ecoflow_cleared"),
    )

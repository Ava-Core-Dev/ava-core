"""Once-on-boot: refresh public API prices. Does not spend tokens. Spend stays off."""

from __future__ import annotations

import logging

log = logging.getLogger("ava.cron.api_prices_boot")


async def run():
    from apps.core.services import api_ledger

    out = api_ledger.refresh(source="boot")
    log.info(
        "api-ledger boot fetches=%s live_rows=%s",
        len(out.get("fetches") or []),
        out.get("live_rows"),
    )

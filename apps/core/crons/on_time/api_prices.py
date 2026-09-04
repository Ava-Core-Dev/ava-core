"""Daily public API price capture (10:10 HST). HTTP GET on docs only — no inference spend."""

from __future__ import annotations

import logging

log = logging.getLogger("ava.cron.api_prices")


async def run():
    from apps.core.services import api_ledger

    out = api_ledger.refresh(source="daily")
    log.info(
        "api-ledger daily fetches=%s live_rows=%s",
        len(out.get("fetches") or []),
        out.get("live_rows"),
    )

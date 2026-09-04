"""Daily RootRecord governance tally (10:08 HST). Off until Desk switch is on.

Self-update never runs in this job until origin has been up at least an hour
(after boot reports / catchups).
"""

from __future__ import annotations

import logging

log = logging.getLogger("ava.cron.governance_daily")


async def run():
    from apps.core.services import governance

    result = governance.run_daily(source="daily")
    log.info(
        "governance daily off=%s passed=%s gate=%s",
        result.get("detail"),
        len(result.get("passed") or []),
        (result.get("flags") or {}).get("cursor_gate"),
    )

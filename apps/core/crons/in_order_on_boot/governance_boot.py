"""Once-on-boot consensus snapshot. Never self-update here — that waits an hour."""

from __future__ import annotations

import logging

log = logging.getLogger("ava.cron.governance_boot")


async def run():
    from apps.core.services import governance

    result = governance.run_daily(source="boot", allow_self_update=False)
    log.info(
        "governance boot people=%s passed=%s",
        result.get("people"),
        len(result.get("passed") or []),
    )

"""Self-update drain — first fire ~1h after origin start, then hourly.

Boot reports and catchups go first. Gate also refuses until origin uptime ≥ 1h.
"""

from __future__ import annotations

import logging

log = logging.getLogger("ava.cron.governance_self_update")


async def run():
    from apps.core.services import governance

    out = governance.run_self_update()
    log.info("governance self-update gate=%s jobs=%s", out.get("gate"), len(out.get("cursor") or []))

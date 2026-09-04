"""Write a review pack (11:20 and 17:20 HST). Never patches source."""
from __future__ import annotations

import logging

log = logging.getLogger("ava.cron.code_review")


async def run():
    from apps.core.services import code_review

    result = await code_review.run(with_coder=True)
    log.info("code review pack %s coder=%s", result.get("dated"), result.get("coder"))

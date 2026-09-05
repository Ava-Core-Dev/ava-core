"""Daily reports catch-up — 14:00 HST. run_due on mandatory slots only (never late)."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

log = logging.getLogger("ava.cron.daily_reports_catchup")


async def run():
    log.info("Daily reports catch-up (14:00)  %s", datetime.now(timezone.utc).isoformat())
    from apps.core.services import daily_report_board

    daily_report_board.ensure_today()
    daily_report_board.mark_due()
    out = await daily_report_board.run_due(play=True, allow_tts=True)
    log.info("catch-up run_due=%s", out)
    return out

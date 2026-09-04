"""Once on origin start: morning slots if the clock is still before noon HST."""
from __future__ import annotations

import logging

log = logging.getLogger("ava.cron.day_board_boot")


async def run():
    from apps.core.services import day_reports

    result = await day_reports.maybe_boot_morning()
    log.info("day-board boot skipped=%s", result.get("skipped"))
    return result

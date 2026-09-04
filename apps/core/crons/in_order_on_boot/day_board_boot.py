"""Once on origin start: prelims first, then morning slots if before noon HST."""
from __future__ import annotations

import logging

log = logging.getLogger("ava.cron.day_board_boot")


async def run():
    from apps.core.crons.in_order_on_boot import boot_prelims
    from apps.core.services import day_reports

    prelim = await boot_prelims.run(write_report=True)
    log.info(
        "boot prelims ok=%s steps=%s",
        prelim.get("ok"),
        list((prelim.get("steps") or {}).keys()),
    )
    result = await day_reports.maybe_boot_morning()
    log.info("day-board boot skipped=%s", result.get("skipped"))
    return {"prelim": prelim, "day_board": result, "grok": False}

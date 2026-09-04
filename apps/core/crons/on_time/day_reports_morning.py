"""Morning slot reports — 10:00 HST. One function per kind via day_reports."""
from __future__ import annotations

import logging

log = logging.getLogger("ava.cron.day_reports_morning")


async def run():
    from apps.core.services import day_reports

    result = await day_reports.run_morning_slot()
    log.info("morning slot kinds=%s", len(result.get("ran") or []))

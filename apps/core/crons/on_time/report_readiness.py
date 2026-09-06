"""Generate scheduled reports as soon as their validated data is ready."""

from __future__ import annotations

import logging
from datetime import datetime
from zoneinfo import ZoneInfo

log = logging.getLogger("ava.cron.report_readiness")
HST = ZoneInfo("Pacific/Honolulu")


def _at_or_after(now: datetime, hour: int, minute: int) -> bool:
    return (now.hour, now.minute) >= (hour, minute)


async def run():
    now = datetime.now(HST)
    from apps.core.services import daily_report_board

    daily_report_board.ensure_today()
    daily_report_board.mark_due(now=now)
    out: dict[str, object] = {"ok": True, "slot": None, "result": None}

    if now.hour < 10:
        slot = "morning"
        from apps.core.crons.on_time import morning_report

        result = await morning_report.run()
    elif _at_or_after(now, 11, 55) and not _at_or_after(now, 17, 15):
        slot = "midday"
        from apps.core.crons.on_time import midday_report

        result = await midday_report.run()
    elif _at_or_after(now, 17, 15) and not _at_or_after(now, 22, 0):
        slot = "evening"
        from apps.core.crons.on_time import evening_report

        result = await evening_report.run()
    elif _at_or_after(now, 22, 0):
        slot = "late"
        from apps.core.crons.on_time import late_report

        result = await late_report.run()
    else:
        return out

    out["slot"] = slot
    out["result"] = result
    out["ok"] = bool(result.get("ok", True)) if isinstance(result, dict) else True
    if isinstance(result, dict) and result.get("ok") and not result.get("skipped"):
        from apps.core.services import report_periodic_audio

        out["play"] = await report_periodic_audio.play_if_due(
            slot,
            reason="report_ready",
            force=True,
        )
    log.info("report readiness slot=%s result=%s", slot, result)
    return out

"""Optional late report — 22:00 HST. Never catch-up on boot/morning."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

log = logging.getLogger("ava.cron.late_report")


async def run():
    log.info("Late report cron (22:00 optional)  %s", datetime.now(timezone.utc).isoformat())
    from apps.core.services import daily_report_board, report_generation

    daily_report_board.ensure_today()
    late_slot = daily_report_board.get_slot("late") or {}
    if late_slot.get("status") in {"done", "running"}:
        log.info("Late report already active or generated today — skip duplicate run")
        return {"ok": True, "skipped": True, "detail": "already_done"}
    daily_report_board.mark_due()
    slot = daily_report_board.get_slot("late") or {}
    if slot.get("status") == "done":
        log.info("Late report already done — skip")
        return {"ok": True, "skipped": True, "detail": "already_done"}

    from apps.core.crons.in_order_on_boot import boot_prelims
    from apps.core.services import boot_report

    prelim = await boot_prelims.run(write_report=False)
    if not prelim.get("ok"):
        daily_report_board.mark_failed("late", error="prelims_failed")
        return {"ok": False, "skipped": True, "detail": "prelims_failed", "prelim": prelim}
    freshness = boot_report.report_metrics_fresh_within(max_age_s=3600)
    if not freshness["ok"]:
        daily_report_board.mark_failed("late", error="stale_metrics")
        return {"ok": False, "skipped": True, "detail": "stale_metrics", "freshness": freshness}

    engine = report_generation.engine_for("late")
    result = report_generation.generate(
        "late",
        dry_run=False,
        allow_tts=True,
        update_board=True,
    )
    log.info(
        "Late report engine_req=%s engine=%s ok=%s tts=%s",
        engine,
        result.get("engine"),
        result.get("ok"),
        (result.get("tts") or {}).get("skipped", result.get("tts")),
    )
    return {
        "ok": bool(result.get("ok")),
        "engine": result.get("engine"),
        "optional": True,
        "catch_up_allowed": False,
        "result": result,
    }

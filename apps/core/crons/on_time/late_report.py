"""Optional late report — 22:00 HST. Never catch-up on boot/morning."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

log = logging.getLogger("ava.cron.late_report")


async def run():
    log.info("Late report cron (22:00 optional)  %s", datetime.now(timezone.utc).isoformat())
    from apps.core.services import daily_report_board, report_generation

    daily_report_board.ensure_today()
    daily_report_board.mark_due()
    slot = daily_report_board.get_slot("late") or {}
    if slot.get("status") == "done":
        log.info("Late report already done — skip")
        return {"ok": True, "skipped": True, "detail": "already_done"}

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

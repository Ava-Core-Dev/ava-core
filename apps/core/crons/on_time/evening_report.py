"""Evening long-form report — 17:15 HST generate + due board + play after stitch."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

log = logging.getLogger("ava.cron.evening_report")


async def run():
    log.info("Evening report cron (17:15)  %s", datetime.now(timezone.utc).isoformat())
    from apps.core.services import daily_report_board, report_generation, reports
    from apps.core.services import voice_events

    daily_report_board.ensure_today()
    evening_slot = daily_report_board.get_slot("evening") or {}
    if evening_slot.get("status") in {"done", "running"}:
        log.info("Evening report already active or generated today — skip duplicate run")
        return {"ok": True, "skipped": True, "detail": "already_done"}
    daily_report_board.mark_due()

    from apps.core.crons.in_order_on_boot import boot_prelims
    from apps.core.services import boot_report

    prelim = await boot_prelims.run(write_report=False)
    if not prelim.get("ok"):
        daily_report_board.mark_failed("evening", error="prelims_failed")
        return {"ok": False, "skipped": True, "detail": "prelims_failed", "prelim": prelim}
    freshness = boot_report.report_metrics_fresh_within(max_age_s=3600)
    if not freshness["ok"]:
        daily_report_board.mark_failed("evening", error="stale_metrics")
        return {"ok": False, "skipped": True, "detail": "stale_metrics", "freshness": freshness}

    engine = report_generation.engine_for("evening")
    result = report_generation.generate(
        "evening",
        dry_run=False,
        allow_tts=True,
        update_board=True,
    )
    content = result.get("text") or ""
    if content.strip():
        reports.queue_public_draft("summary", content, source=f"cron_evening_{engine}")
        reports.write_current(content, kind="summary", source=f"cron_evening_{engine}")

    play = None
    tts = result.get("tts") or {}
    if result.get("ok") and not result.get("blocked"):
        play = await voice_events.play_report_mp3(
            tts.get("current"),
            tts.get("mp3"),
            name="evening_report",
            kind="evening",
        )
        if play.get("ok") and play.get("mp3"):
            daily_report_board.mark_done(
                "evening",
                mp3=str(play.get("mp3")),
                engine=str(result.get("engine") or engine),
            )
    elif not result.get("ok"):
        daily_report_board.mark_failed(
            "evening", error=str(result.get("detail") or "evening_failed")
        )

    log.info(
        "Evening report engine_req=%s engine=%s tts=%s play=%s",
        engine,
        result.get("engine"),
        (result.get("tts") or {}).get("skipped", result.get("tts")),
        play,
    )
    return {"ok": bool(result.get("ok")), "engine": result.get("engine"), "play": play}

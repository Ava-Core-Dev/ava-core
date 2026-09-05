"""Midday status cron — 11:55 HST prebuild; report presents as 12 noon.

Prelims first. Engine from data/state/report-generation.json (grok|local).
Ara TTS when midday tts toggle is on (this cron passes allow_tts=True once for live noon).
On successful TTS: queue the MP3 on the desk (REPORT) — same class as morning-boot-replay.
On successful text: disarm morning-boot-replay; close midday Grok spend window.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

log = logging.getLogger("ava.cron.midday")


async def _refresh_prelims() -> dict:
    from apps.core.crons.in_order_on_boot import boot_prelims

    return await boot_prelims.run(write_report=False)


def _after_midday_success(*, engine: str, content: str) -> dict:
    """Stop morning MP3 replay for the day; restore spend halt if live-test window."""
    out: dict = {"replay": None, "spend_window": None}
    try:
        from apps.core.crons.since_last_fire import morning_boot_replay

        out["replay"] = morning_boot_replay.disarm(
            reason=f"midday_report_ok engine={engine}"
        )
    except Exception as e:
        log.warning("midday disarm morning-boot-replay failed: %s", e)
        out["replay"] = {"ok": False, "detail": type(e).__name__}
    try:
        from apps.core.services import report_generation

        out["spend_window"] = report_generation.close_midday_spend_window(
            reason="midday_report_ok"
        )
    except Exception as e:
        log.warning("midday close spend window failed: %s", e)
        out["spend_window"] = {"ok": False, "detail": type(e).__name__}
    out["chars"] = len(content or "")
    return out


async def _play_midday_mp3(tts: dict | None) -> dict | None:
    """Desk playback: fresh Ara file if present, else operator manual pick."""
    tts = tts or {}
    from apps.core.services import report_audio_manual, voice_events

    if tts.get("ok"):
        return await voice_events.play_report_mp3(
            tts.get("current"),
            tts.get("mp3"),
            name="midday_report",
            kind="midday",
        )
    return await report_audio_manual.play_scheduled("midday")


async def run():
    log.info("Midday report cron (11:55 → noon)  %s", datetime.now(timezone.utc).isoformat())
    from apps.core.services import daily_report_board, midday_report, report_generation, reports
    from apps.core.services import reports as report_store

    daily_report_board.ensure_today()
    daily_report_board.mark_due()

    if not midday_report.midday_automation_enabled():
        log.info("Midday report automation OFF — prelims still refresh facts")
    prelim = await _refresh_prelims()
    log.info("midday prelims ok=%s", prelim.get("ok"))

    settings = report_generation.type_settings("midday")
    allow_tts = bool(settings.get("tts"))
    engine = report_generation.engine_for("midday")
    result = report_generation.generate(
        "midday", dry_run=False, allow_tts=allow_tts, update_board=True
    )
    if result.get("blocked"):
        log.error(
            "Midday cloud BLOCKED incomplete package/output — no disarm/close/TTS fallback. detail=%s validation=%s",
            result.get("detail"),
            result.get("validation"),
        )
        daily_report_board.mark_failed(
            "midday", error=str(result.get("detail") or "blocked")
        )
        return {
            "ok": False,
            "blocked": True,
            "detail": result.get("detail"),
            "validation": result.get("validation"),
            "engine_req": engine,
        }

    content = result.get("text") or ""
    if not content.strip():
        written = midday_report.write_midday_report(
            source="midday_cron_fallback",
            include_timestamp=True,
        )
        content = written.get("text") or ""
        result = {
            "engine": written.get("engine"),
            "dated": written.get("dated"),
            "ok": bool(content),
        }
        if content.strip():
            daily_report_board.mark_done("midday", engine=str(result.get("engine") or "local"))
        else:
            daily_report_board.mark_failed("midday", error="empty_fallback")

    reports.queue_public_draft("summary", content, source=f"cron_midday_{engine}")
    report_store.write_current(content, kind="summary", source=f"cron_midday_{engine}")
    after = None
    # Play deferred to midday_report_play (12:05). Still disarm / close spend on text OK.
    if content.strip() and result.get("ok", True) and not result.get("blocked"):
        after = _after_midday_success(
            engine=str(result.get("engine") or engine),
            content=content,
        )
    log.info(
        "Midday report engine_req=%s engine=%s blog=%s tts=%s dated=%s after=%s blocked=%s",
        engine,
        result.get("engine"),
        (result.get("blog") or {}).get("ok"),
        (result.get("tts") or {}).get("skipped", result.get("tts")),
        result.get("dated") or (result.get("files") or {}).get("dated"),
        after,
        result.get("blocked"),
    )
    return {
        "ok": bool(content.strip()) and not result.get("blocked"),
        "engine": result.get("engine") or engine,
        "tts": result.get("tts"),
        "after": after,
    }

"""Morning report cron (10:00 HST) + merged morning summary (10:05 HST).

Refreshes NOAA/Kīlauea first. While Grok is halted, writes on-device Boot Report
text only (no xAI spend, no Ara TTS from this cron unless a separate path arms it).
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

log = logging.getLogger("ava.cron.morning")


def _datapoints(limit: int, clip: int) -> str:
    from apps.core import config
    reports = list(config.REPORTS_DIR.glob("*.md"))
    parts = []
    for r in sorted(reports, key=lambda p: p.stat().st_mtime, reverse=True)[:limit]:
        parts.append(r.read_text(errors="replace")[:clip])
    return "\n---\n".join(parts)


async def _refresh_prelims() -> dict:
    from apps.core.crons.in_order_on_boot import boot_prelims

    return await boot_prelims.run(write_report=True)


async def run():
    log.info("Morning report cron  %s", datetime.now(timezone.utc).isoformat())
    from apps.core import config
    from apps.core.services import boot_report, reports, xai
    from apps.core.services import reports as report_store

    if not boot_report.morning_automation_enabled():
        log.info("Morning report automation OFF — prelims still refresh facts")
    prelim = await _refresh_prelims()
    log.info("morning prelims ok=%s", prelim.get("ok"))

    # Preferred path: on-device Boot Report (Grok halted or automation local-only).
    if xai.grok_is_down() or boot_report.morning_automation_enabled():
        written = boot_report.write_boot_report(source="morning_cron_local")
        content = written.get("text") or ""
        reports.queue_public_draft("morning", content, source="cron_local")
        report_store.write_current(content, kind="morning", source="cron_local")
        log.info(
            "Morning Boot Report via on-device brain engine=%s scrub=%s automation=%s",
            written.get("engine"),
            written.get("scrub"),
            boot_report.morning_automation_enabled(),
        )
        return

    from apps.core.services import synth

    raw = _datapoints(10, 500)
    factual = f"_Live snapshot (Grok unavailable or cooling down)._\n\n{raw[:1500]}"
    system = (
        "You are Ava Ivy, the AI runtime of the Hawaii Pacific Solar Root Server. "
        "Write a concise, natural morning summary under 300 words covering "
        "solar (ground-mounted arrays only — never rooftop), weather, earthquakes, economy, and server status. Friendly tone. "
        "Do not invent watts. If PV is near zero, say the array is on the ground / being reset, not that the roof is empty. "
        "Use only the provided data. Do not invent numbers."
    )
    polished = synth.polish_ex(
        "morning", system, f"Morning data:\n{raw[:3000]}", factual=factual
    )
    summary = polished["text"]
    # Full Grok/ollama may stamp; offline factual stub must not.
    include_timestamp = bool(polished.get("include_timestamp"))
    if include_timestamp:
        now_hst = config.hst_now_text(date_first=True)
        content = f"**Ava morning report** — {now_hst}\n\n{summary}"
    else:
        content = f"**Ava morning report**\n\n{summary}"
    reports.queue_public_draft(
        "morning", content, source="cron", include_timestamp=include_timestamp
    )
    report_store.write_current(
        content, kind="morning", source="cron", include_timestamp=include_timestamp
    )
    log.info(
        "Morning report drafted for operator review engine=%s stamp=%s",
        polished.get("engine"),
        include_timestamp,
    )
    try:
        import asyncio

        def _render() -> str | None:
            from apps.core.broadcast_render import spoken_script, synthesize
            from apps.core.mp4_converter import convert_if_needed

            script = spoken_script(summary)
            dest = synthesize(script)
            convert_if_needed(
                dest,
                current_path=config.MP4_DIR / "Morning_Broadcast_Current.mp4",
            )
            return str(dest)

        mp3 = await asyncio.to_thread(_render)
        if mp3:
            from pathlib import Path
            from apps.voice.director import Priority, get_director

            await get_director().queue(
                Path(mp3),
                name="morning",
                priority=Priority.REPORT,
                scene="Main",
            )
            log.info("Morning broadcast queued for OBS")
    except Exception:
        log.exception("Morning broadcast render skipped")


async def run_merged():
    """Merged morning summary — drafts for operator approval."""
    log.info("Merged morning summary  %s", datetime.now(timezone.utc).isoformat())
    from apps.core import config
    from apps.core.services import boot_report, reports, xai

    prelim = await _refresh_prelims()
    log.info("merged morning prelims ok=%s", prelim.get("ok"))

    if xai.grok_is_down() or boot_report.morning_automation_enabled():
        written = boot_report.write_boot_report(source="merged_morning_local")
        content = written.get("text") or ""
        reports.queue_public_draft("summary", content, source="cron_local")
        reports.write_current(content, kind="summary", source="cron_local")
        log.info(
            "Merged morning Boot Report via on-device brain engine=%s",
            written.get("engine"),
        )
        return

    from apps.core.services import synth

    all_data = _datapoints(15, 400)
    factual = f"_Live snapshot (Grok unavailable or cooling down)._\n\n{all_data[:1800]}"
    system = (
        "Write a friendly merged morning summary for the RootMC Discord community. "
        "Cover: solar/power, weather, Kīlauea, earthquakes, player economy, Minecraft servers. "
        "Under 400 words. Warm tone. Use only the provided data. Do not invent numbers."
    )
    polished = synth.polish_ex(
        "summary", system, all_data[:4000], factual=factual, channel="ava_home"
    )
    summary = polished["text"]
    include_timestamp = bool(polished.get("include_timestamp"))
    if include_timestamp:
        now_hst = config.hst_now_text(date_first=True)
        content = f"**Merged Morning Summary** — {now_hst}\n\n{summary}"
    else:
        content = f"**Merged Morning Summary**\n\n{summary}"
    reports.queue_public_draft(
        "summary", content, source="cron", include_timestamp=include_timestamp
    )
    reports.write_current(
        content, kind="summary", source="cron", include_timestamp=include_timestamp
    )
    log.info(
        "Merged morning summary drafted for operator review engine=%s stamp=%s",
        polished.get("engine"),
        include_timestamp,
    )
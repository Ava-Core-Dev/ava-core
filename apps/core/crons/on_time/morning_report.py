"""Morning report cron (10:00 HST) + merged morning summary (10:05 HST).

Refreshes NOAA/Kīlauea first. While Grok is halted, writes file facts only
(no xAI spend). Local Ollama polish is also skipped when Grok is halted so
the morning path stays file-based until the operator turns spend back on.
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
    from apps.core.services import reports, xai
    from apps.core.services import reports as report_store

    prelim = await _refresh_prelims()
    log.info("morning prelims ok=%s", prelim.get("ok"))

    if xai.grok_is_down():
        from apps.core.services import boot_report

        content = boot_report.build_text(source="morning_cron_file")
        reports.queue_public_draft("morning", content, source="cron_file")
        report_store.write_current(content, kind="morning", source="cron_file")
        boot_report.write_boot_report(source="morning_cron_file")
        log.info("Morning report wrote file facts only (Grok halted)")
        return

    from apps.core.services import synth

    raw = _datapoints(10, 500)
    factual = f"_Live snapshot (Grok unavailable or cooling down)._\n\n{raw[:1500]}"
    system = (
        "You are Ava Ivy, the AI runtime of the HI Pacific Solar Root Server. "
        "Write a concise, natural morning summary under 300 words covering "
        "solar (ground-mounted arrays only — never rooftop), weather, earthquakes, economy, and server status. Friendly tone. "
        "Do not invent watts. If PV is near zero, say the array is on the ground / being reset, not that the roof is empty. "
        "Use only the provided data. Do not invent numbers."
    )
    summary = synth.polish("morning", system, f"Morning data:\n{raw[:3000]}", factual=factual)
    now_hst = config.hst_now_text(date_first=True)
    content = f"**Ava morning report** — {now_hst}\n\n{summary}"
    reports.queue_public_draft("morning", content, source="cron")
    report_store.write_current(content, kind="morning", source="cron")
    log.info("Morning report drafted for operator review")
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
    from apps.core.services import reports, xai

    prelim = await _refresh_prelims()
    log.info("merged morning prelims ok=%s", prelim.get("ok"))

    if xai.grok_is_down():
        from apps.core.services import boot_report

        content = boot_report.build_text(source="merged_morning_file")
        content = content.replace(
            "**Ava morning Boot Report**",
            "**Merged Morning Summary**",
            1,
        )
        reports.queue_public_draft("summary", content, source="cron_file")
        reports.write_current(content, kind="summary", source="cron_file")
        log.info("Merged morning wrote file facts only (Grok halted)")
        return

    from apps.core.services import synth

    all_data = _datapoints(15, 400)
    factual = f"_Live snapshot (Grok unavailable or cooling down)._\n\n{all_data[:1800]}"
    system = (
        "Write a friendly merged morning summary for the RootMC Discord community. "
        "Cover: solar/power, weather, Kīlauea, earthquakes, player economy, Minecraft servers. "
        "Under 400 words. Aloha tone. Use only the provided data. Do not invent numbers."
    )
    summary = synth.polish(
        "summary", system, all_data[:4000], factual=factual, channel="ava_home"
    )
    now_hst = config.hst_now_text(date_first=True)
    content = f"**Merged Morning Summary** — {now_hst}\n\n{summary}"
    reports.queue_public_draft("summary", content, source="cron")
    reports.write_current(content, kind="summary", source="cron")
    log.info("Merged morning summary drafted for operator review")

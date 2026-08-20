"""Morning report cron (10:00 HST) + merged morning summary (10:05 HST)."""

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


async def run():
    log.info("Morning report cron  %s", datetime.now(timezone.utc).isoformat())
    from apps.core import config
    from apps.core.services import discord, synth

    raw = _datapoints(10, 500)
    factual = f"_Live snapshot (Grok unavailable or cooling down)._\n\n{raw[:1500]}"
    system = (
        "You are Ava Ivy, the AI runtime of the HI Pacific Solar Root Server. "
        "Write a concise, natural morning summary under 300 words covering "
        "solar, weather, earthquakes, economy, and server status. Friendly tone. "
        "Use only the provided data. Do not invent numbers."
    )
    summary = synth.polish("morning", system, f"Morning data:\n{raw[:3000]}", factual=factual)
    now_hst = datetime.now().strftime("%a, %b %-d, %H:%M HST")
    content = f"**Ava morning report** — {now_hst}\n\n{summary}"
    await discord.post_message(config.DISCORD_CHANNELS["ava_home"], content)
    from apps.core.services import reports as report_store
    report_store.write_current(content, kind="morning", source="cron")
    log.info("Morning report posted")
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
    """Merged morning summary — posts to Ava home."""
    log.info("Merged morning summary  %s", datetime.now(timezone.utc).isoformat())
    from apps.core.services import reports, synth

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
    now_hst = datetime.now().strftime("%a, %b %-d, %H:%M HST")
    content = f"**Merged Morning Summary** — {now_hst}\n\n{summary}"
    await reports.publish("summary", content, channel="ava_home")
    reports.write_current(content, kind="summary", source="cron")
    log.info("Merged morning summary posted to Ava home + report DMs")

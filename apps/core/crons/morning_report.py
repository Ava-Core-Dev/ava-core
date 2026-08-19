"""Morning report cron (10:00 HST) + merged morning summary (10:05 HST)."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

log = logging.getLogger("ava.cron.morning")


async def run():
    log.info("Morning report cron  %s", datetime.now(timezone.utc).isoformat())
    from apps.core import config
    from apps.core.services import discord, xai as xai_client

    # Gather datapoints
    reports = list(config.REPORTS_DIR.glob("*.md"))
    datapoints = []
    for r in sorted(reports, key=lambda p: p.stat().st_mtime, reverse=True)[:10]:
        datapoints.append(r.read_text(errors="replace")[:500])

    raw = "\n---\n".join(datapoints)

    # Try Grok summary, fall back to raw concatenation
    summary = None
    if config.XAI_API_KEY:
        try:
            summary = xai_client.chat([
                {"role": "system", "content": (
                    "You are Ava Ivy, the AI runtime of the HI Pacific Solar Root Server. "
                    "Write a concise, natural morning summary under 300 words covering "
                    "solar, weather, earthquakes, economy, and server status. Friendly tone."
                )},
                {"role": "user", "content": f"Morning data:\n{raw[:3000]}"},
            ], max_tokens=400)
        except Exception as e:
            log.warning("Grok unavailable for morning report: %s", e)

    if not summary:
        summary = f"_Grok unavailable — live snapshot only._\n\n{raw[:1500]}"

    now_hst = datetime.now().strftime("%a, %b %-d, %H:%M HST")
    content = f"**Ava morning report** — {now_hst}\n\n{summary}"

    # Post to #automations only — merged summary is the public DM at 10:05
    await discord.post_message(config.DISCORD_CHANNELS["automations"], content)
    log.info("Morning report posted")


async def run_merged():
    """Merged morning summary — posts to #updates (the only cron that does)."""
    log.info("Merged morning summary  %s", datetime.now(timezone.utc).isoformat())
    from apps.core import config
    from apps.core.services import discord, xai as xai_client

    reports = list(config.REPORTS_DIR.glob("*.md"))
    all_data = "\n---\n".join(
        r.read_text(errors="replace")[:400]
        for r in sorted(reports, key=lambda p: p.stat().st_mtime, reverse=True)[:15]
    )

    summary = None
    if config.XAI_API_KEY:
        try:
            summary = xai_client.chat([
                {"role": "system", "content": (
                    "Write a friendly merged morning summary for the RootMC Discord community. "
                    "Cover: solar/power, weather, Kīlauea, earthquakes, player economy, Minecraft servers. "
                    "Under 400 words. Aloha tone."
                )},
                {"role": "user", "content": all_data[:4000]},
            ], max_tokens=500)
        except Exception as e:
            log.warning("Grok unavailable for merged summary: %s", e)

    if not summary:
        summary = f"_Grok unavailable (http403) — concatenated 10:00 datapoints._\n\n{all_data[:1800]}"

    now_hst = datetime.now().strftime("%a, %b %-d, %H:%M HST")
    content = f"**Merged Morning Summary** — {now_hst}\n\n{summary}"

    from apps.core.services import reports
    await reports.publish("summary", content, channel="updates")
    log.info("Merged morning summary posted to #updates + report DMs")

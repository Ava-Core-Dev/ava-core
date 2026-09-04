"""Midday status cron — 11:55 HST prebuild; report presents as 12 noon.

Refreshes NOAA/Kīlauea first. On-device text only while Grok is halted.
No Ara TTS from this cron. Optional later Ara is a separate operator path.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

log = logging.getLogger("ava.cron.midday")


async def _refresh_prelims() -> dict:
    from apps.core.crons.in_order_on_boot import boot_prelims

    # Prelims only — do not rewrite morning Boot Report from the midday slot.
    return await boot_prelims.run(write_report=False)


async def run():
    log.info("Midday report cron (11:55 → noon)  %s", datetime.now(timezone.utc).isoformat())
    from apps.core import config
    from apps.core.services import midday_report, reports, xai
    from apps.core.services import reports as report_store

    if not midday_report.midday_automation_enabled():
        log.info("Midday report automation OFF — prelims still refresh facts")
    prelim = await _refresh_prelims()
    log.info("midday prelims ok=%s", prelim.get("ok"))

    # Preferred path: on-device midday status (Grok halted or local automation).
    if xai.grok_is_down() or midday_report.midday_automation_enabled():
        written = midday_report.write_midday_report(
            source="midday_cron_local",
            include_timestamp=True,
        )
        content = written.get("text") or ""
        reports.queue_public_draft("midday", content, source="cron_local")
        report_store.write_current(content, kind="midday", source="cron_local")
        log.info(
            "Midday status via on-device brain engine=%s scrub=%s automation=%s stamp=%s",
            written.get("engine"),
            written.get("scrub"),
            midday_report.midday_automation_enabled(),
            written.get("include_timestamp"),
        )
        return

    # Full Grok path (scaffolded): timestamps allowed. Do not burn TTS here.
    from apps.core.services import synth

    scaffold = midday_report.grok_full_scaffold_ok(include_timestamp=True)
    log.info("midday Grok full path scaffold=%s", scaffold)

    raw_parts = []
    for pattern in ("midday-boot-*.md", "morning-boot-*.md", "nws-weather-*.md"):
        for r in sorted(
            config.REPORTS_DIR.glob(pattern),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )[:4]:
            raw_parts.append(r.read_text(errors="replace")[:400])
    raw = "\n---\n".join(raw_parts)
    factual = f"_Live snapshot (Grok unavailable or cooling down)._\n\n{raw[:1500]}"
    system = (
        "You are Ava Ivy, the AI runtime of the Hawaii Pacific Solar Root Server. "
        "Write a concise midday status under 300 words for about 12 noon Hawaiian Standard Time. "
        "Cover solar (ground-mounted arrays only), weather, Kīlauea (advisory is not eruption), "
        "and server status. Friendly tone. Use only the provided data. Do not invent numbers. "
        "Never advise wall power — off-grid solar only."
    )
    polished = synth.polish_ex(
        "midday", system, f"Midday data:\n{raw[:3000]}", factual=factual
    )
    summary = polished["text"]
    engine = polished.get("engine") or "unknown"
    # Full Grok/ollama may stamp; offline factual stub must not.
    include_timestamp = engine != "factual"
    if include_timestamp:
        now_hst = config.hst_now_text(date_first=True)
        content = f"**Ava midday report** — {now_hst} (presents as 12 noon)\n\n{summary}"
    else:
        content = f"**Ava midday report**\n\n{summary}"
    reports.queue_public_draft("midday", content, source="cron")
    report_store.write_current(content, kind="midday", source="cron")
    log.info(
        "Midday report drafted for operator review engine=%s stamp=%s (no Ara TTS)",
        engine,
        include_timestamp,
    )

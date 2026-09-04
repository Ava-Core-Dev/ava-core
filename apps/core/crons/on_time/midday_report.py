"""Midday status cron — 11:55 HST prebuild; report presents as 12 noon.

Prelims first. Engine from data/state/report-generation.json (grok|local).
Grok path uses public context URLs. Ara TTS only when midday tts toggle is on.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger("ava.cron.midday")


async def _refresh_prelims() -> dict:
    from apps.core.crons.in_order_on_boot import boot_prelims

    # Prelims only — do not rewrite morning Boot Report from the midday slot.
    return await boot_prelims.run(write_report=False)


async def run():
    log.info("Midday report cron (11:55 → noon)  %s", datetime.now(timezone.utc).isoformat())
    from apps.core.services import midday_report, report_generation, reports
    from apps.core.services import reports as report_store

    if not midday_report.midday_automation_enabled():
        log.info("Midday report automation OFF — prelims still refresh facts")
    prelim = await _refresh_prelims()
    log.info("midday prelims ok=%s", prelim.get("ok"))

    engine = report_generation.engine_for("midday")
    result = report_generation.generate("midday", dry_run=False, allow_tts=False)
    content = ""
    current = (result.get("files") or {}).get("current")
    if current:
        try:
            content = Path(current).read_text(encoding="utf-8", errors="replace")
        except Exception:
            content = result.get("text_preview") or ""
    if not content:
        written = midday_report.write_midday_report(
            source="midday_cron_fallback",
            include_timestamp=True,
        )
        content = written.get("text") or ""
        result = {
            "engine": written.get("engine"),
            "files": {"scrub": written.get("scrub"), "dated": written.get("dated")},
        }

    reports.queue_public_draft("summary", content, source=f"cron_midday_{engine}")
    report_store.write_current(content, kind="summary", source=f"cron_midday_{engine}")

    log.info(
        "Midday report engine_req=%s engine=%s blog=%s tts=%s scrub=%s",
        engine,
        result.get("engine"),
        (result.get("blog") or {}).get("ok"),
        (result.get("tts") or {}).get("skipped", result.get("tts")),
        (result.get("files") or {}).get("scrub"),
    )

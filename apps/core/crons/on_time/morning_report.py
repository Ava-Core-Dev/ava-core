"""Morning report cron (10:00 HST) + merged morning summary (10:05 HST).

Prelims first. Engine from data/state/report-generation.json (grok|local).
Grok path uses public context + live data pages. Ara TTS only when type tts
toggle is on AND spend is open (cron keeps allow_tts=False by default).
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger("ava.cron.morning")


async def _refresh_prelims() -> dict:
    from apps.core.crons.in_order_on_boot import boot_prelims

    return await boot_prelims.run(write_report=True)


async def run():
    log.info("Morning report cron  %s", datetime.now(timezone.utc).isoformat())
    from apps.core.services import boot_report, report_generation, reports
    from apps.core.services import reports as report_store

    if not boot_report.morning_automation_enabled():
        log.info("Morning report automation OFF — prelims still refresh facts")
    prelim = await _refresh_prelims()
    log.info("morning prelims ok=%s", prelim.get("ok"))

    engine = report_generation.engine_for("morning")
    result = report_generation.generate(
        "morning", dry_run=False, allow_tts=False
    )
    content = result.get("text") or ""
    if not content.strip():
        written = boot_report.write_boot_report(source="morning_cron_fallback")
        content = written.get("text") or ""
        result = {"engine": written.get("engine"), "scrub": written.get("scrub")}

    reports.queue_public_draft("morning", content, source=f"cron_{engine}")
    report_store.write_current(content, kind="morning", source=f"cron_{engine}")
    log.info(
        "Morning report engine_req=%s engine=%s blog=%s tts=%s dated=%s",
        engine,
        result.get("engine"),
        (result.get("blog") or {}).get("ok"),
        (result.get("tts") or {}).get("skipped", result.get("tts")),
        result.get("dated"),
    )


async def run_merged():
    """Queue today's morning Boot Report as the merged summary draft — no second generate."""
    log.info("Merged morning summary  %s", datetime.now(timezone.utc).isoformat())
    from apps.core import config
    from apps.core.services import boot_report, reports

    prelim = await _refresh_prelims()
    log.info("merged morning prelims ok=%s", prelim.get("ok"))

    path = config.REPORTS_DIR / boot_report.CURRENT_NAME
    if path.is_file():
        content = path.read_text(encoding="utf-8", errors="replace")
    else:
        written = boot_report.write_boot_report(source="merged_morning_local")
        content = written.get("text") or ""
        log.info("Merged morning wrote fresh Boot Report engine=%s", written.get("engine"))

    if not content.strip():
        log.warning("Merged morning empty — skip")
        return

    reports.queue_public_draft("summary", content, source="cron_merged")
    reports.write_current(content, kind="summary", source="cron_merged")
    log.info(
        "Merged morning queued from %s bytes=%s",
        path.name if path.is_file() else "fresh",
        len(content),
    )

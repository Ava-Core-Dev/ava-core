"""Drain at most one Cursor fallback job (10:12 and 16:12 HST)."""

from __future__ import annotations

import logging
from datetime import datetime
from zoneinfo import ZoneInfo

log = logging.getLogger("ava.cron.cursor_fallback")
HST = ZoneInfo("Pacific/Honolulu")


async def run():
    from apps.core import config
    from apps.core.services import cursor_fallback, reports

    job = cursor_fallback.drain_one()
    if not job:
        log.info("Cursor fallback: queue empty or budget spent")
        return

    kind = str(job.get("kind") or "summary")
    text = str(job.get("text") or "").strip()
    if not text:
        return

    stamp = datetime.now(HST).strftime("%Y-%m-%d %H:%M HST")
    header = {
        "kilauea": "Ava Kīlauea report",
        "morning": "Ava morning report",
        "summary": "Ava morning summary",
    }.get(kind, "Ava report")
    body = f"**{header}** — {stamp}\n\n{text}"

    pub_kind = kind if kind in reports.PUBLIC_KINDS else "summary"
    channel = job.get("channel") or "ava_home"
    await reports.publish(pub_kind, body, channel=channel)
    if pub_kind in {"morning", "summary"}:
        reports.write_current(body, kind=pub_kind, source="cursor")

    report_path = config.REPORTS_DIR / f"{kind}-cursor-{datetime.now(HST).strftime('%Y-%m-%dT%H')}.md"
    report_path.write_text(body)
    log.info("Cursor fallback posted kind=%s file=%s", kind, report_path.name)

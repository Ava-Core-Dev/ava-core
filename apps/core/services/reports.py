"""Fan-out for public Ava reports (channels + subscriber DMs).

Use this for morning / solar / weather / Kīlauea.
Do not use this for operator-only or development messages.
"""
from __future__ import annotations

import logging

from .. import config
from . import discord, subscribers, telegram

log = logging.getLogger("ava.reports")

# Public report kinds subscribers opted into. Everything else stays off the list.
PUBLIC_KINDS = {"morning", "summary", "solar", "weather", "kilauea"}


async def publish(
    kind: str,
    text: str,
    *,
    channel: str | None = "automations",
) -> dict:
    """Post a public report to a Discord channel (optional) and every subscriber DM."""
    kind = str(kind or "").strip().lower()
    body = str(text or "").strip()
    result = {"ok": True, "kind": kind, "channel": False, "dms": 0, "failed": 0}
    if kind not in PUBLIC_KINDS:
        log.warning("refusing non-public report kind %r", kind)
        return {"ok": False, "detail": "not_a_public_report", **result}
    if not body:
        return {"ok": False, "detail": "empty", **result}

    header = {
        "morning": "Ava morning report",
        "summary": "Ava morning summary",
        "solar": "Ava solar + weather",
        "weather": "Ava weather alert",
        "kilauea": "Ava Kīlauea report",
    }.get(kind, "Ava report")
    dm_text = body if body.lower().startswith("**ava") else f"**{header}**\n\n{body}"

    if channel:
        ch_id = config.DISCORD_CHANNELS.get(channel, channel)
        if ch_id:
            posted = await discord.post_message(ch_id, body[:1900])
            result["channel"] = bool(posted)

    for row in subscribers.list_all():
        if not subscribers.wants_reports(row):
            continue
        surface = str(row.get("surface") or "")
        sid = str(row.get("id") or "")
        try:
            sent = None
            if surface == "telegram":
                sent = await telegram.send_message(sid, dm_text)
            elif surface == "discord":
                sent = await discord.send_dm(sid, dm_text[:1900])
            if sent:
                result["dms"] += 1
            else:
                result["failed"] += 1
        except Exception as e:
            result["failed"] += 1
            log.warning("report DM %s:%s failed: %s", surface, sid, e)

    log.info(
        "report %s channel=%s dms=%s failed=%s",
        kind, result["channel"], result["dms"], result["failed"],
    )
    return result

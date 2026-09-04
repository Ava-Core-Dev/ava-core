"""NWS Hawaiʻi by-county hazard poll — api.weather.gov.

Every 15 minutes + boot. Speaks (writes spoken script / draft) only when the
product hash changes, or on boot. Does not call Grok. Does not touch midday toggles.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

log = logging.getLogger("ava.cron.nws_hawaii")


async def run(*, reason: str = "poll", force_speak: bool = False):
    log.info("NWS Hawaii counties cron  %s reason=%s", datetime.now(timezone.utc).isoformat(), reason)
    from apps.core.services import nws_hawaii

    result = await nws_hawaii.refresh(
        reason=reason,
        force_speak=force_speak or reason == "boot",
        speak_on_change=True,
    )
    log.info(
        "NWS Hawaii counties done ok=%s changed=%s alerts=%s",
        result.get("ok"),
        result.get("changed"),
        result.get("alerts"),
    )
    return result

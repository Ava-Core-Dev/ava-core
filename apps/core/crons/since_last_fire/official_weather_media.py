"""Refresh official NHC/NWS graphics and HLS statement media."""

from __future__ import annotations

import logging

log = logging.getLogger("ava.cron.official_weather_media")


async def run(reason: str = "poll"):
    from apps.core.services import official_weather_media

    result = official_weather_media.run()
    if result.get("ok"):
        try:
            result["obs"] = await official_weather_media.apply_obs_scenes()
        except Exception as exc:
            result["obs"] = {"ok": False, "detail": str(exc)[:240]}
    log.info("official weather media reason=%s ok=%s assets=%s errors=%s", reason, result.get("ok"), len(result.get("downloaded") or {}), result.get("errors"))
    return result

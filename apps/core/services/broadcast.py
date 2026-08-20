"""Public live-broadcast status for avaivy.cloud/live and the home embed."""

from __future__ import annotations

import asyncio

from apps.core import config

DEFAULT_CHANNEL_ID = "UC6M7U4fXAWuVYhgm_veKecA"
DEFAULT_HANDLE = "@AvaIvyRootMC"


async def live_payload() -> dict:
    channel_id = config.YOUTUBE_CHANNEL_ID or DEFAULT_CHANNEL_ID
    handle = DEFAULT_HANDLE
    watch = config.YOUTUBE_CHANNEL_URL or f"https://www.youtube.com/{handle}/live"
    embed = (
        "https://www.youtube-nocookie.com/embed/live_stream"
        f"?channel={channel_id}&autoplay=1&modestbranding=1&rel=0&playsinline=1"
    )
    streaming = False
    scene = None
    duration_ms = None
    try:
        from apps.voice.director import get_director

        director = get_director()
        data = await asyncio.wait_for(director._obs_request("GetStreamStatus"), 1.2)
        payload = (data or {}).get("responseData") or {}
        streaming = bool(payload.get("outputActive"))
        duration_ms = payload.get("outputDuration")
        scene_data = await asyncio.wait_for(
            director._obs_request("GetCurrentProgramScene"), 1.2
        )
        scene = ((scene_data or {}).get("responseData") or {}).get(
            "currentProgramSceneName"
        )
    except Exception:
        pass
    return {
        "ok": True,
        "live": streaming,
        "streaming": streaming,
        "scene": scene,
        "duration_ms": duration_ms,
        "watch_url": watch,
        "embed_url": embed,
        "channel_id": channel_id,
        "channel_handle": handle,
        "page_url": "https://avaivy.cloud/live",
        "embed_page_url": "https://avaivy.cloud/live/embed",
    }

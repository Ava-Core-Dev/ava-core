"""OBS routes — audio stream page + SSE events + queue API."""

from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, StreamingResponse
from pydantic import BaseModel

from .. import config

router = APIRouter(prefix="/obs")
api_router = APIRouter(prefix="/api/obs")
log = logging.getLogger("ava.obs")

# Shared event queue — audio events broadcast to all SSE listeners
_listeners: list[asyncio.Queue] = []


def broadcast_audio_event(event: dict):
    """Called by the voice director when a new track is ready."""
    payload = json.dumps(event)
    for q in list(_listeners):
        try:
            q.put_nowait(payload)
        except asyncio.QueueFull:
            pass


@router.get("/audio-stream", response_class=HTMLResponse)
async def obs_audio_stream():
    """
    OBS Browser Source page — add this URL as a Browser Source in OBS.
    Listens on SSE and auto-plays audio when signaled by the Stream Director.
    """
    generated = config.GENERATED_DIR
    return HTMLResponse(f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Ava Audio Stream</title>
<style>
  body {{ margin: 0; background: transparent; overflow: hidden; }}
  #status {{ position: fixed; bottom: 4px; right: 8px; font: 10px monospace;
             color: rgba(255,255,255,0.3); }}
</style>
</head>
<body>
<audio id="player" preload="none"></audio>
<div id="status">Ava Audio — connecting…</div>
<script>
const player = document.getElementById('player');
const status = document.getElementById('status');
let currentPriority = -1;
let pausedSrc = null;
let pausedTime = 0;

const es = new EventSource('/obs/audio-events');

es.onopen = () => {{ status.textContent = 'Ava Audio — ready'; }};
es.onerror = () => {{ status.textContent = 'Ava Audio — reconnecting…'; }};

es.addEventListener('play', e => {{
  const data = JSON.parse(e.data);
  const priority = data.priority ?? 1;
  const src = data.src;

  if (!player.paused && priority > currentPriority) {{
    // Pause current, save position for resume
    pausedSrc = player.src;
    pausedTime = player.currentTime;
    player.pause();
  }}

  currentPriority = priority;
  player.src = src;
  player.currentTime = 0;
  player.play().catch(() => {{}});
  status.textContent = 'Playing: ' + (data.name || src.split('/').pop());
}});

player.addEventListener('ended', () => {{
  status.textContent = 'Ava Audio — ready';
  currentPriority = -1;
  // Resume paused track if any
  if (pausedSrc) {{
    player.src = pausedSrc;
    player.currentTime = pausedTime;
    player.play().catch(() => {{}});
    pausedSrc = null;
    pausedTime = 0;
    status.textContent = 'Resuming…';
  }}
}});
</script>
</body>
</html>""")


@router.get("/audio-events")
async def obs_audio_events(request: Request):
    """SSE endpoint — Stream Director pushes play events here."""
    q: asyncio.Queue = asyncio.Queue(maxsize=20)
    _listeners.append(q)

    async def generate():
        try:
            yield "data: {\"type\":\"connected\"}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=30)
                    yield f"event: play\ndata: {msg}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            _listeners.remove(q)

    return StreamingResponse(generate(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/hud", response_class=HTMLResponse)
async def obs_hud():
    return HTMLResponse("<html><body><p>HUD — coming soon</p></body></html>")


@router.get("/quake-overlay", response_class=HTMLResponse)
async def obs_quake_overlay():
    return HTMLResponse("<html><body><p>Quake Overlay — coming soon</p></body></html>")


def _kilauea_state() -> dict:
    path = config.DATA_DIR / "state" / "kilauea-alert.json"
    if not path.is_file():
        return {}
    try:
        return json.loads(path.read_text())
    except Exception:
        return {}


def _watch_from_state(state: dict) -> dict:
    level = str(state.get("alert_level") or "").strip().lower()
    erupting = level in {"watch", "warning", "eruption", "advisory"}
    return {
        "active": erupting,
        "erupting": level in {"watch", "warning", "eruption"},
        "mode": "active" if erupting else "off",
        "alert_level": state.get("alert_level"),
        "multiplier": state.get("multiplier"),
        "updated_at": state.get("updated_at"),
    }


class SceneBody(BaseModel):
    scene: str = "Be right back"


class MetaBody(BaseModel):
    title: str | None = None
    description: str | None = None
    restart: bool = False
    scene: str | None = None


class WatchBody(BaseModel):
    action: str = "enter"
    title: str | None = None
    description: str | None = None


class ToastBody(BaseModel):
    title: str = "Test toast"
    body: str = "Desktop Streaming Ops"


class ReactionBody(BaseModel):
    id: str | None = None
    reactionId: str | None = None


@api_router.get("/status")
async def api_obs_status():
    from apps.voice.director import get_director

    director = get_director()
    st = director.get_status()
    streaming = False
    scene = None
    try:
        data = await director._obs_request("GetStreamStatus")
        payload = (data or {}).get("responseData") or {}
        streaming = bool(payload.get("outputActive"))
        scene_data = await director._obs_request("GetCurrentProgramScene")
        scene = ((scene_data or {}).get("responseData") or {}).get(
            "currentProgramSceneName"
        )
    except Exception as e:
        log.debug("OBS status probe: %s", e)
    kit = "ok" if st.get("obs_connected") else "offline"
    return {
        "ok": True,
        "streaming": streaming,
        "scene": scene or st.get("current") or "Main",
        "director": st,
        "kit": {"health": kit},
        "title": "",
        "description": "",
    }


@api_router.get("/volcano-watch")
async def api_volcano_watch_get():
    return {"ok": True, "watch": _watch_from_state(_kilauea_state())}


@api_router.post("/volcano-watch")
async def api_volcano_watch_post(body: WatchBody):
    from apps.voice.director import get_director

    scene = "Kilauea Watch" if body.action != "exit" else "Main"
    await get_director()._switch_scene(scene)
    return {"ok": True, "action": body.action, "scene": scene, "watch": _watch_from_state(_kilauea_state())}


@api_router.get("/eruption-eta")
async def api_eruption_eta():
    watch = _watch_from_state(_kilauea_state())
    stored = {}
    path = config.DATA_DIR / "state" / "eruption-eta.json"
    if path.is_file():
        try:
            stored = json.loads(path.read_text())
        except Exception:
            stored = {}
    band = stored.get("band") or ("active" if watch.get("erupting") else "quiet")
    return {
        "ok": True,
        "band": band,
        "label": stored.get("label"),
        "countdown": {"display": stored.get("window") or ""},
        "watch": watch,
        **{k: v for k, v in stored.items() if k not in {"history"}},
    }


@api_router.post("/scene")
async def api_obs_scene(body: SceneBody):
    from apps.voice.director import get_director

    await get_director()._switch_scene(body.scene)
    return {"ok": True, "scene": body.scene}


@api_router.post("/metadata")
async def api_obs_metadata(body: MetaBody):
    from apps.voice.director import get_director

    if body.scene:
        await get_director()._switch_scene(body.scene)
    return {
        "ok": True,
        "title": body.title or "",
        "description": body.description or "",
        "restart": body.restart,
        "detail": "obs_stream_title_not_wired",
    }


@api_router.post("/toast")
async def api_obs_toast(body: ToastBody):
    return {"ok": True, "title": body.title, "body": body.body, "detail": "queued_local"}


@api_router.post("/repair-kit")
async def api_obs_repair():
    from apps.voice.director import get_director

    director = get_director()
    connected = await director._connect_obs()
    return {"ok": connected, "detail": "obs_reconnect" if connected else "obs_unreachable"}


@api_router.post("/reaction")
async def api_obs_reaction(body: ReactionBody):
    rid = body.reactionId or body.id or ""
    return {"ok": True, "id": rid, "detail": "ack"}

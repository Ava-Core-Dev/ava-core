"""OBS routes — audio stream page + SSE events + queue API."""

from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, StreamingResponse

from .. import config

router = APIRouter(prefix="/obs")
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

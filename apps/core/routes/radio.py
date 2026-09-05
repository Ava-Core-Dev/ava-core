"""Root Record Radio — Banished wake, program player, Desk API.

Program bus only (music / reports / chimes). No desktop loopback.
"""
from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

from apps.core import config
from apps.core.services import radio as radio_svc

router = APIRouter(tags=["radio"])
log = logging.getLogger("ava.radio.routes")

WAKE_LINES = [
    "Root Record · Hawaiʻi",
    "Waiting for the board…",
    "Solar desk warms up when you visit.",
    "Program bus only — not this PC’s speakers.",
    "Music, reports, and chimes when on air.",
    "Ava keeps the lights low until you arrive.",
]


def _banished_html(*, on_air_hint: bool = False) -> str:
    lines_js = ",".join(json_escape(x) for x in WAKE_LINES)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Root Record Radio</title>
<style>
  :root {{
    --ink: #e8e4d9;
    --muted: #9a9588;
    --ring: #c4a574;
    --bg0: #0c0d10;
    --bg1: #16141a;
  }}
  * {{ box-sizing: border-box; }}
  html, body {{
    margin: 0; min-height: 100%;
    background: radial-gradient(1200px 800px at 50% 20%, #1a1820 0%, var(--bg0) 55%);
    color: var(--ink);
    font-family: "Segoe UI", "Iowan Old Style", Georgia, serif;
  }}
  .wrap {{
    min-height: 100vh; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 2.2rem;
    padding: 2rem 1.25rem;
  }}
  .brand {{
    letter-spacing: 0.22em; text-transform: uppercase; font-size: 0.78rem;
    color: var(--muted); font-family: system-ui, sans-serif;
  }}
  .orbit {{
    width: min(42vw, 220px); height: min(42vw, 220px);
    border-radius: 50%;
    border: 2px solid rgba(196,165,116,0.35);
    box-shadow: 0 0 0 14px rgba(196,165,116,0.06), inset 0 0 40px rgba(0,0,0,0.35);
    position: relative;
    animation: spin 14s linear infinite;
  }}
  .orbit::before {{
    content: ""; position: absolute; inset: 18%;
    border-radius: 50%; border: 1px solid rgba(232,228,217,0.18);
  }}
  .orbit::after {{
    content: ""; position: absolute; width: 12px; height: 12px;
    border-radius: 50%; background: var(--ring);
    top: -6px; left: 50%; margin-left: -6px;
    box-shadow: 0 0 16px var(--ring);
  }}
  @keyframes spin {{ to {{ transform: rotate(360deg); }} }}
  .line {{
    min-height: 1.6em; text-align: center; font-size: clamp(1.05rem, 2.4vw, 1.45rem);
    color: var(--ink); opacity: 0.92; max-width: 28rem; line-height: 1.45;
    transition: opacity 0.5s ease;
  }}
  .hint {{ font-size: 0.85rem; color: var(--muted); font-family: system-ui, sans-serif; }}
  a {{ color: var(--ring); }}
</style>
</head>
<body>
  <div class="wrap">
    <div class="brand">Root Record Radio</div>
    <div class="orbit" aria-hidden="true"></div>
    <div class="line" id="line">Root Record · Hawaiʻi</div>
    <p class="hint" id="hint">Warming the board…</p>
  </div>
<script>
const LINES = [{lines_js}];
let i = 0;
const el = document.getElementById('line');
const hint = document.getElementById('hint');
setInterval(() => {{
  i = (i + 1) % LINES.length;
  el.style.opacity = 0;
  setTimeout(() => {{ el.textContent = LINES[i]; el.style.opacity = 1; }}, 400);
}}, 4200);
async function wake() {{
  try {{
    const r = await fetch('/api/radio/wake', {{ method: 'POST', headers: {{ 'Content-Type': 'application/json' }}, body: '{{}}' }});
    const j = await r.json();
    if (j.serving_public || j.on_air) {{
      hint.textContent = 'On air — opening player…';
      location.replace('/radio/listen');
      return;
    }}
    hint.textContent = 'Station idle — open Ava Desk → Radio → On air';
  }} catch (e) {{
    hint.textContent = 'Origin quiet — try again in a moment';
  }}
}}
wake();
setInterval(wake, 12000);
</script>
</body>
</html>"""


def json_escape(s: str) -> str:
    import json as _json

    return _json.dumps(s)


def _player_html() -> str:
    return """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Root Record Radio · Live</title>
<style>
  html,body{margin:0;min-height:100%;background:#0c0d10;color:#e8e4d9;
    font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem;padding:1.5rem;}
  .brand{letter-spacing:.2em;text-transform:uppercase;font-size:.75rem;opacity:.65;}
  #status{opacity:.75;font-size:.9rem;}
  audio{width:min(420px,92vw);}
  a{color:#c4a574;}
</style>
</head>
<body>
  <div class="brand">Root Record Radio</div>
  <div id="status">Connecting…</div>
  <audio id="player" controls preload="none"></audio>
  <p><a href="/radio">Wake page</a></p>
<script>
const player = document.getElementById('player');
const status = document.getElementById('status');
const es = new EventSource('/radio/events');
es.onopen = () => { status.textContent = 'Ready'; };
es.onerror = () => { status.textContent = 'Reconnecting…'; };
es.addEventListener('play', e => {
  const data = JSON.parse(e.data);
  if (!data.src) return;
  player.src = data.src;
  player.play().catch(()=>{});
  status.textContent = 'Playing: ' + (data.name || data.src.split('/').pop());
});
es.addEventListener('message', e => {
  try {
    const data = JSON.parse(e.data);
    if (data.type === 'connected') status.textContent = 'Ready';
  } catch {}
});
</script>
</body>
</html>"""


@router.get("/radio", response_class=HTMLResponse)
async def radio_home():
    st = radio_svc.status()
    if st.get("on_air"):
        return HTMLResponse(_player_html())
    return HTMLResponse(_banished_html())


@router.get("/radio/listen", response_class=HTMLResponse)
async def radio_listen():
    st = radio_svc.status()
    if not st.get("on_air"):
        return HTMLResponse(_banished_html())
    return HTMLResponse(_player_html())


@router.get("/radio/events")
async def radio_events(request: Request):
    st = radio_svc.status()
    if not (st.get("on_air") or st.get("local_playback")):
        return Response(status_code=204)

    q: asyncio.Queue = asyncio.Queue(maxsize=32)
    radio_svc.register_listener(q)

    async def generate():
        try:
            yield 'data: {"type":"connected"}\n\n'
            while True:
                if await request.is_disconnected():
                    break
                st2 = radio_svc.load()
                if not (st2.get("on_air") or st2.get("local_playback")):
                    break
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=25)
                    yield f"event: play\ndata: {msg}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            radio_svc.unregister_listener(q)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/api/radio/status")
async def api_radio_status():
    return radio_svc.status()


class RadioPatch(BaseModel):
    local_playback: bool | None = None
    on_air: bool | None = None
    mic_armed: bool | None = None
    mic_device: str | None = None
    on_air_sticky: bool | None = None


@router.post("/api/radio/wake")
async def api_radio_wake():
    radio_svc.wake()
    return radio_svc.status()


@router.post("/api/radio")
async def api_radio_patch(body: RadioPatch):
    """Desk toggles. Local playback drives speaker bed; on_air opens public listen."""
    kwargs = {}
    if body.local_playback is not None:
        kwargs["local_playback"] = bool(body.local_playback)
    if body.on_air is not None:
        kwargs["on_air"] = bool(body.on_air)
    if body.mic_armed is not None:
        kwargs["mic_armed"] = bool(body.mic_armed)
    if body.mic_device is not None:
        kwargs["mic_device"] = str(body.mic_device or "")[:120]
    if body.on_air_sticky is not None:
        kwargs["on_air_sticky"] = bool(body.on_air_sticky)
    if kwargs:
        radio_svc.patch(**kwargs)

    st = radio_svc.status()
    # Sync speaker bed with local_playback
    try:
        from apps.voice.director import ensure_music_bed, get_director

        d = get_director()
        if st.get("local_playback"):
            ensure_music_bed()
            await d.start_music_bed()
        else:
            d.pause_music_bed()
    except Exception as e:
        log.debug("radio local_playback sync: %s", e)
        st = {**st, "bed_sync_detail": str(e)[:160]}

    if st.get("mic_armed") and not st.get("tools", {}).get("ffmpeg"):
        st = {**st, "mic_note": "Mic flag set — needs ffmpeg + named device before encode"}

    return st

"""Root Record Radio — Banished wake, program player, Desk API.

Program bus only (music / reports / chimes). No desktop loopback.
Public pages: title + description (not .wav names), like/dislike steering.
"""
from __future__ import annotations

import asyncio
import logging
import secrets
from typing import Any

from fastapi import APIRouter, Request, Response
from fastapi.responses import HTMLResponse, StreamingResponse
from pydantic import BaseModel, Field

from apps.core.services import radio as radio_svc
from apps.core.services import radio_catalog
from apps.core.services import radio_access
from apps.core.routes.radio_player_html import player_html as _player_html_fn

router = APIRouter(tags=["radio"])
log = logging.getLogger("ava.radio.routes")

WAKE_LINES = [
    "Root Record · Hawaiʻi",
    "Waiting for the board…",
    "Solar desk warms up when you visit.",
    "Music, reports, and chimes — when we’re on air.",
    "Ava keeps the lights low until you arrive.",
    "From the islands — Root Record Radio.",
]

SITE_BRAND = {
    "rootrecord.cloud": ("Root Record Radio", "RootRecord"),
    "www.rootrecord.cloud": ("Root Record Radio", "RootRecord"),
    "avaivy.cloud": ("Ava Ivy Radio", "Ava Ivy"),
    "www.avaivy.cloud": ("Ava Ivy Radio", "Ava Ivy"),
    "rootmc.net": ("RootMC Radio", "RootMC"),
    "www.rootmc.net": ("RootMC Radio", "RootMC"),
    "origin.avaivy.cloud": ("Root Record Radio", "RootRecord"),
    "127.0.0.1": ("Root Record Radio", "RootRecord"),
    "localhost": ("Root Record Radio", "RootRecord"),
}


def _brand_for_host(host: str) -> tuple[str, str]:
    h = (host or "").split(":")[0].strip().lower()
    return SITE_BRAND.get(h, ("Root Record Radio", "RootRecord"))


def json_escape(s: str) -> str:
    import json as _json

    return _json.dumps(s)


def _banished_html(*, brand: str = "Root Record Radio") -> str:
    lines_js = ",".join(json_escape(x) for x in WAKE_LINES)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>{brand}</title>
<style>
  :root {{
    --ink: #e8e4d9;
    --muted: #9a9588;
    --ring: #c4a574;
    --bg0: #0c0d10;
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
    <div class="brand">{brand}</div>
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
    hint.textContent = 'Station is quiet — check back soon.';
  }} catch (e) {{
    hint.textContent = 'Taking a moment — try again shortly.';
  }}
}}
wake();
setInterval(wake, 12000);
</script>
</body>
</html>"""


def _player_html(*, brand: str = "Root Record Radio", site_label: str = "RootRecord") -> str:
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>{brand} · Live</title>
<style>
  :root {{
    --ink:#e8e4d9; --muted:#9a9588; --ring:#c4a574; --bg:#0c0d10;
    --ok:#7d9a6a; --bad:#b87a6a;
  }}
  * {{ box-sizing:border-box; }}
  html,body{{margin:0;min-height:100%;background:radial-gradient(900px 600px at 50% 0%,#1a1820 0%,var(--bg) 55%);
    color:var(--ink);font-family:system-ui,sans-serif;}}
  .wrap{{max-width:32rem;margin:0 auto;padding:2.5rem 1.25rem 3rem;display:flex;flex-direction:column;gap:1.1rem;}}
  .brand{{letter-spacing:.2em;text-transform:uppercase;font-size:.72rem;color:var(--muted);}}
  #title{{font-family:Georgia,"Iowan Old Style",serif;font-size:clamp(1.35rem,3.5vw,1.85rem);line-height:1.25;margin:0;}}
  #desc{{color:var(--muted);font-size:.95rem;line-height:1.45;margin:0;min-height:2.8em;}}
  #status{{opacity:.7;font-size:.85rem;}}
  audio{{width:100%;margin-top:.25rem;}}
  .votes{{display:flex;gap:.65rem;flex-wrap:wrap;align-items:center;}}
  .votes button{{
    appearance:none;border:1px solid rgba(196,165,116,.35);background:rgba(255,255,255,.04);
    color:var(--ink);padding:.55rem 1rem;border-radius:6px;cursor:pointer;font-size:.9rem;
  }}
  .votes button:hover{{border-color:var(--ring);}}
  .votes button.on-like{{border-color:var(--ok);color:var(--ok);}}
  .votes button.on-dislike{{border-color:var(--bad);color:var(--bad);}}
  .counts{{font-size:.8rem;color:var(--muted);}}
  .steer{{
    margin-top:.5rem;padding:1rem 1.05rem;border-left:3px solid rgba(196,165,116,.45);
    background:rgba(255,255,255,.03);font-size:.88rem;line-height:1.5;color:var(--muted);
  }}
  .steer strong{{color:var(--ink);font-weight:600;}}
  a{{color:var(--ring);}}
  .nav{{font-size:.85rem;opacity:.8;}}
</style>
</head>
<body>
  <div class="wrap">
    <div class="brand">{brand}</div>
    <p id="status">Connecting…</p>
    <h1 id="title">Now playing</h1>
    <p id="desc"></p>
    <audio id="player" controls preload="none"></audio>
    <div class="votes" id="votes" hidden>
      <button type="button" id="btn-like" aria-pressed="false">Like</button>
      <button type="button" id="btn-dislike" aria-pressed="false">Dislike</button>
      <span class="counts" id="counts"></span>
    </div>
    <div class="steer">
      <strong>Your vote steers the station.</strong>
      Likes make a song play more often and push its sound into what we pick and make next.
      Dislikes cut how often it returns and tell us what to ease off — for music already on the board and new tracks still to come.
    </div>
    <p class="nav"><a href="/radio">Back</a> · Live from {site_label}</p>
  </div>
<script>
const player = document.getElementById('player');
const status = document.getElementById('status');
const titleEl = document.getElementById('title');
const descEl = document.getElementById('desc');
const votes = document.getElementById('votes');
const counts = document.getElementById('counts');
const btnLike = document.getElementById('btn-like');
const btnDislike = document.getElementById('btn-dislike');
const SITE = location.hostname || '';
let currentId = null;
let myVote = null;

function voterId() {{
  try {{
    let v = localStorage.getItem('rr_radio_voter');
    if (!v) {{
      v = (crypto.randomUUID && crypto.randomUUID()) || ('v' + Math.random().toString(36).slice(2) + Date.now());
      localStorage.setItem('rr_radio_voter', v);
    }}
    return v;
  }} catch (e) {{ return 'anon'; }}
}}

function paintMeta(j) {{
  const title = j.title || j.name || 'Now playing';
  const desc = j.description || '';
  titleEl.textContent = title;
  descEl.textContent = desc;
  currentId = j.id || null;
  if (currentId) {{
    votes.hidden = false;
    counts.textContent = (j.likes || 0) + ' likes · ' + (j.dislikes || 0) + ' dislikes';
  }} else {{
    votes.hidden = true;
  }}
  btnLike.classList.toggle('on-like', myVote === 'like');
  btnDislike.classList.toggle('on-dislike', myVote === 'dislike');
  btnLike.setAttribute('aria-pressed', myVote === 'like' ? 'true' : 'false');
  btnDislike.setAttribute('aria-pressed', myVote === 'dislike' ? 'true' : 'false');
}}

function playSrc(src, meta) {{
  if (!src) return;
  const next = src + (src.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now();
  if (player.getAttribute('data-base') !== src) {{
    player.setAttribute('data-base', src);
    player.src = next;
    player.play().catch(()=>{{}});
  }}
  paintMeta(meta || {{}});
  status.textContent = 'On air';
}}

async function refreshNow() {{
  try {{
    const j = await fetch('/api/radio/now').then(r=>r.json());
    if (!j.on_air) {{ status.textContent = 'Off air'; votes.hidden = true; return; }}
    playSrc(j.live || j.src, j);
  }} catch (e) {{
    status.textContent = 'Reconnecting…';
  }}
}}

async function sendVote(vote) {{
  if (!currentId) return;
  myVote = vote;
  btnLike.classList.toggle('on-like', vote === 'like');
  btnDislike.classList.toggle('on-dislike', vote === 'dislike');
  try {{
    const r = await fetch('/api/radio/vote', {{
      method: 'POST',
      headers: {{ 'Content-Type': 'application/json' }},
      body: JSON.stringify({{ id: currentId, vote, voter: voterId(), site: SITE }})
    }});
    const j = await r.json();
    if (j.ok) {{
      counts.textContent = (j.likes || 0) + ' likes · ' + (j.dislikes || 0) + ' dislikes';
      status.textContent = vote === 'like' ? 'Noted — this will play more.' : 'Noted — we will ease off this one.';
    }}
  }} catch (e) {{
    status.textContent = 'Could not save vote — try again.';
  }}
}}

btnLike.addEventListener('click', () => sendVote('like'));
btnDislike.addEventListener('click', () => sendVote('dislike'));

refreshNow();
const es = new EventSource('/radio/events');
es.onerror = () => {{ status.textContent = 'Reconnecting…'; }};
es.addEventListener('play', e => {{
  try {{
    const data = JSON.parse(e.data);
    myVote = null;
    playSrc(data.live || data.src, data);
  }} catch (err) {{}}
}});
player.addEventListener('ended', () => refreshNow());
setInterval(refreshNow, 45000);
</script>
</body>
</html>"""


def _host(request: Request) -> str:
    return (request.headers.get("host") or "").split(":")[0].strip().lower()


@router.get("/radio", response_class=HTMLResponse)
async def radio_home(request: Request):
    brand, _ = _brand_for_host(_host(request))
    st = radio_svc.status()
    if st.get("on_air"):
        return HTMLResponse(_player_html(brand=brand, site_label=_brand_for_host(_host(request))[1]))
    return HTMLResponse(_banished_html(brand=brand))


@router.get("/radio/listen", response_class=HTMLResponse)
async def radio_listen(request: Request):
    brand, label = _brand_for_host(_host(request))
    st = radio_svc.status()
    if not st.get("on_air"):
        return HTMLResponse(_banished_html(brand=brand))
    return HTMLResponse(_player_html(brand=brand, site_label=label))


@router.get("/radio/live.mp3")
async def radio_live_mp3():
    """Progressive MP3 of the current program file (ffmpeg). On-air only."""
    st = radio_svc.status()
    if not st.get("on_air"):
        return Response(status_code=404)
    from apps.core.services import radio_encode

    path = radio_encode.current_program_path()
    if path is None:
        return Response(status_code=204)

    async def gen():
        async for chunk in radio_encode.iter_mp3_for_file(path):
            yield chunk

    return StreamingResponse(
        gen(),
        media_type="audio/mpeg",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Content-Disposition": "inline; filename=rootrecord-radio.mp3",
        },
    )


def _now_payload() -> dict[str, Any]:
    st = radio_svc.status()
    if not st.get("on_air"):
        return {"ok": True, "on_air": False, "src": None, "title": None, "description": None}
    from apps.core.services import radio_encode

    path = radio_encode.current_program_path()
    meta: dict[str, Any] = {}
    src = None
    if path is not None:
        src = radio_svc.program_url_for_file(path)
        meta = radio_catalog.public_meta(path)
    return {
        "ok": True,
        "on_air": True,
        "src": src or ("/radio/live.mp3" if path else None),
        "live": "/radio/live.mp3" if path else None,
        "name": meta.get("title"),
        "title": meta.get("title"),
        "description": meta.get("description"),
        "id": meta.get("id"),
        "likes": meta.get("likes") or 0,
        "dislikes": meta.get("dislikes") or 0,
        "tags": meta.get("tags") or "",
        "steering": radio_catalog.steering_public().get("note"),
    }


@router.get("/api/radio/now")
async def api_radio_now():
    """Public now-playing (title/description — not raw filenames)."""
    return _now_payload()


@router.get("/api/radio/steering")
async def api_radio_steering():
    return radio_catalog.steering_public()


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


class RadioVote(BaseModel):
    id: str = Field(..., min_length=1, max_length=500)
    vote: str = Field(..., min_length=3, max_length=12)
    voter: str = Field("", max_length=80)
    site: str = Field("", max_length=80)


@router.post("/api/radio/wake")
async def api_radio_wake():
    radio_svc.wake()
    return radio_svc.status()


@router.post("/api/radio/vote")
async def api_radio_vote(body: RadioVote, request: Request):
    voter = (body.voter or "").strip()
    if not voter:
        voter = secrets.token_hex(8)
    site = (body.site or _host(request) or "")[:80]
    return radio_catalog.cast_vote(
        track_id=body.id,
        vote=body.vote,
        voter=voter,
        site=site,
    )


@router.post("/api/radio")
async def api_radio_patch(body: RadioPatch):
    """Desk toggles. Local = speakers; on_air = public listen. Never desktop loopback."""
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
    try:
        from apps.voice.director import ensure_music_bed, get_director
        from apps.voice import desk_audio

        d = get_director()
        if st.get("local_playback") or st.get("on_air"):
            ensure_music_bed()
            await d.start_music_bed()
            if st.get("local_playback"):
                desk_audio.set_ducked(False)
                desk_audio.set_muted(False)
            else:
                desk_audio.set_muted(True)
        else:
            d.pause_music_bed()
            try:
                desk_audio.set_muted(False)
            except Exception:
                pass
        st = radio_svc.status()
    except Exception as e:
        log.warning("radio bed sync: %s", e)
        st = {**st, "bed_sync_detail": str(e)[:160]}

    if st.get("mic_armed") and not st.get("tools", {}).get("ffmpeg"):
        st = {**st, "mic_note": "Mic armed — needs a named capture device wired next"}

    if st.get("on_air") or st.get("local_playback"):
        try:
            from apps.voice.director import get_director
            from apps.voice import desk_audio

            path = desk_audio.bed_path()
            if path is None:
                d = get_director()
                cur = getattr(d, "_music_current", None)
                if cur is not None:
                    path = cur
            if path is not None:
                radio_svc.announce_program_file(path)
        except Exception:
            pass

    return radio_svc.status()

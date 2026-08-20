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

const es = new EventSource((location.origin || '') + '/obs/audio-events');

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
    origin = f"http://127.0.0.1:{config.AVA_PORT}"
    return HTMLResponse(f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Ava Daily Broadcast HUD</title>
<style>
  html,body {{ margin:0; padding:0; width:1920px; height:1080px; overflow:hidden;
    background:transparent; color:#fff; font-family:Segoe UI,Helvetica Neue,system-ui,sans-serif; }}
  #live {{ position:fixed; top:28px; left:32px; display:flex; align-items:center; gap:10px;
    background:rgba(8,8,10,.72); border:1px solid rgba(255,255,255,.14); border-radius:999px;
    padding:10px 18px; letter-spacing:.08em; font-weight:800; }}
  #dot {{ width:12px; height:12px; border-radius:50%; background:#e10600; box-shadow:0 0 10px #e10600; }}
  #clock {{ position:fixed; top:28px; right:32px; text-align:right;
    background:rgba(8,8,10,.72); border:1px solid rgba(255,255,255,.14); border-radius:14px;
    padding:12px 18px; min-width:280px; }}
  #clock .d {{ opacity:.85; font-size:15px; }}
  #clock .t {{ font-size:34px; font-weight:700; letter-spacing:1px; }}
  #lower {{ position:fixed; left:32px; right:32px; bottom:28px; display:flex; justify-content:space-between;
    align-items:flex-end; gap:24px; }}
  #brand {{ background:rgba(8,8,10,.78); border:1px solid rgba(255,255,255,.14); border-radius:16px;
    padding:16px 22px; max-width:920px; }}
  #brand h1 {{ margin:0 0 4px; font-size:28px; }}
  #brand p {{ margin:0; opacity:.82; font-size:16px; }}
  #kila {{ background:rgba(8,8,10,.78); border:1px solid rgba(255,158,60,.35); border-radius:16px;
    padding:14px 18px; min-width:280px; }}
  #kila .k {{ font-size:12px; letter-spacing:.12em; text-transform:uppercase; opacity:.7; }}
  #kila .v {{ font-size:22px; font-weight:700; }}
</style>
</head>
<body>
  <div id="live"><span id="dot"></span><span>AVA DAILY BROADCAST</span></div>
  <div id="clock"><div class="d" id="date"></div><div class="t" id="time"></div></div>
  <div id="lower">
    <div id="brand">
      <h1>Ava Ivy · HI Pacific Root Server</h1>
      <p>play.rootmc.net · avaivy.cloud · rootrecord.info/ava · Scene: <span id="scene">Main</span></p>
    </div>
    <div id="kila">
      <div class="k">Kīlauea</div>
      <div class="v" id="alert">loading…</div>
    </div>
  </div>
<script>
function tick() {{
  const now = new Date();
  document.getElementById('date').textContent = now.toLocaleDateString('en-US', {{
    weekday:'long', year:'numeric', month:'long', day:'numeric', timeZone:'Pacific/Honolulu'
  }});
  document.getElementById('time').textContent = now.toLocaleTimeString('en-US', {{
    hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false, timeZone:'Pacific/Honolulu'
  }}) + ' HST';
}}
tick(); setInterval(tick, 1000);
async function refresh() {{
  try {{
    const s = await fetch('{origin}/api/obs/status').then(r => r.json());
    document.getElementById('scene').textContent = s.scene || 'Main';
    document.getElementById('dot').style.background = s.streaming ? '#e10600' : '#8a8a8a';
  }} catch (e) {{}}
  try {{
    const w = await fetch('{origin}/api/obs/volcano-watch').then(r => r.json());
    const a = (w.watch && (w.watch.headline || w.watch.alert_level)) || 'quiet';
    document.getElementById('alert').textContent = String(a);
  }} catch (e) {{}}
}}
refresh(); setInterval(refresh, 15000);
</script>
</body>
</html>""")


@router.get("/quake-overlay", response_class=HTMLResponse)
async def obs_quake_overlay():
    origin = f"http://127.0.0.1:{config.AVA_PORT}"
    return HTMLResponse(f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<meta http-equiv="refresh" content="30"/>
<style>
html,body{{margin:0;width:1920px;height:1080px;overflow:hidden;background:transparent;
font-family:Segoe UI,system-ui,sans-serif;color:#fff}}
.box{{position:fixed;top:40px;left:50%;transform:translateX(-50%);
background:rgba(8,12,18,.88);border:2px solid rgba(255,200,80,.45);border-radius:16px;
padding:18px 28px;text-align:center;min-width:720px}}
.box.hot{{background:rgba(90,10,10,.88);border-color:#ff5e3a}}
.h{{font-size:14px;letter-spacing:.16em;text-transform:uppercase;opacity:.8}}
.t{{font-size:32px;font-weight:800;margin-top:4px}}
.s{{font-size:16px;opacity:.85;margin-top:8px}}
</style></head>
<body>
<div class="box" id="box">
  <div class="h">Pacific seismic / volcano desk · HVO</div>
  <div class="t" id="line">Kīlauea — loading official status…</div>
  <div class="s" id="sub">Source: USGS Hawaiian Volcano Observatory</div>
</div>
<script>
async function paint() {{
  try {{
    const w = await fetch('{origin}/api/obs/volcano-watch').then(r => r.json());
    const watch = w.watch || {{}};
    const erupting = !!watch.erupting;
    const level = (watch.alert_level || 'normal').toUpperCase();
    const headline = watch.headline || (erupting ? 'erupting' : 'not erupting');
    document.getElementById('box').className = 'box' + (erupting ? ' hot' : '');
    document.getElementById('line').textContent = erupting
      ? ('Kīlauea ' + level + ' · erupting')
      : ('Kīlauea ' + level + ' · not erupting');
    document.getElementById('sub').textContent = headline;
  }} catch (e) {{
    document.getElementById('line').textContent = 'Kīlauea status unavailable';
  }}
}}
paint(); setInterval(paint, 15000);
</script>
</body></html>""")


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
    if level in {"eruption", "erupting"}:
        level = "warning"
    erupting = bool(state.get("erupting")) if "erupting" in state else level == "warning"
    if level in {"advisory", "normal", ""}:
        erupting = False
    headline = state.get("headline") or (
        "WARNING" if erupting else f"{(level or 'normal').upper()} — not a live fountain"
    )
    return {
        "active": erupting or level in {"watch", "warning"},
        "erupting": erupting,
        "mode": "erupting" if erupting else "paused" if level == "advisory" else "off",
        "alert_level": level or "normal",
        "headline": headline,
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
    mode = "daily"
    try:
        from apps.core.services.hurricane_tracker import current_mode

        mode = current_mode()
    except Exception:
        pass
    return {
        "ok": True,
        "streaming": streaming,
        "scene": scene or st.get("current") or "Main",
        "director": st,
        "kit": {"health": kit},
        "mode": mode,
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
    if body.action != "exit":
        from apps.core.services.hurricane_tracker import set_mode

        kit = await set_mode("kilauea")
        return {"ok": True, "action": body.action, "scene": "KV · V1", "mode": "kilauea", "kit": kit}
    from apps.core.services.hurricane_tracker import set_mode

    daily = await set_mode("daily")
    await get_director()._switch_scene(scene)
    return {"ok": True, "action": body.action, "scene": scene, "mode": "daily", "kit": daily}


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


@api_router.post("/setup-daily")
async def api_obs_setup_daily():
    from apps.core.services.obs_studio import setup_daily_broadcast

    return await setup_daily_broadcast(start_stream=False)


@api_router.post("/update-collections")
async def api_obs_update_collections():
    from apps.core.services.obs_studio import update_all_scene_collections

    return await update_all_scene_collections()


@api_router.get("/mode")
async def api_obs_mode_get():
    from apps.core.services.hurricane_tracker import current_mode, load_storms

    data = load_storms()
    return {
        "ok": True,
        "mode": current_mode(),
        "storms": data.get("count") or len(data.get("storms") or []),
        "updated": data.get("ts"),
    }


class ModeBody(BaseModel):
    mode: str = "daily"


@api_router.post("/mode")
async def api_obs_mode_post(body: ModeBody):
    from apps.core.services.hurricane_tracker import set_mode

    return await set_mode(body.mode)


@api_router.get("/hurricane-desk")
async def api_hurricane_desk(id: str = "world"):
    from apps.core.services.hurricane_tracker import desk_payload, refresh_storms, load_storms

    if not load_storms().get("storms"):
        await refresh_storms()
    return desk_payload(id)


@api_router.get("/kilauea-desk")
async def api_kilauea_desk(cam: str = "usgs_v1"):
    from apps.core.services.kilauea_cams import load_catalog

    data = load_catalog()
    cams = data.get("cams") or []
    hit = next((c for c in cams if c.get("id") == cam), cams[0] if cams else {})
    return {
        "ok": True,
        "cam": hit,
        "cams": cams,
        "ts": data.get("ts"),
        "watch": _watch_from_state(_kilauea_state()),
    }


@router.get("/kilauea-desk", response_class=HTMLResponse)
async def obs_kilauea_desk():
    path = Path(__file__).resolve().parent.parent / "templates" / "obs-kilauea-desk.html"
    return HTMLResponse(path.read_text(encoding="utf-8"))


@api_router.post("/reaction")
async def api_obs_reaction(body: ReactionBody):
    rid = body.reactionId or body.id or ""
    return {"ok": True, "id": rid, "detail": "ack"}


@api_router.get("/solar-desk")
async def api_obs_solar_desk():
    solar: dict = {}
    try:
        from apps.core.crons.solar_weather import live_snapshot
        solar = await live_snapshot() or {}
    except Exception as e:
        solar = {"error": str(e)[:200]}
    host = {}
    try:
        from apps.core.routes.status import api_status
        import time as _time
        import psutil
        host = await api_status()
        mem = psutil.virtual_memory()
        load = psutil.getloadavg()
        host = {
            **host,
            "boot_uptime_s": int(_time.time() - psutil.boot_time()),
            "cpu_count": psutil.cpu_count() or 1,
            "load_1": round(load[0], 2),
            "load_5": round(load[1], 2),
            "load_15": round(load[2], 2),
            "mem_used_gb": round(mem.used / (1024 ** 3), 1),
            "mem_total_gb": round(mem.total / (1024 ** 3), 1),
        }
    except Exception:
        host = host or {}
    weather = {}
    try:
        from apps.core.routes.realworld import api_weather
        weather = await api_weather()
        if hasattr(weather, "body"):
            weather = {}
    except Exception:
        weather = {}
    if not weather.get("conditions") and solar.get("conditions"):
        weather = {**weather, "conditions": solar.get("conditions")}
    kilauea = _watch_from_state(_kilauea_state())
    shutdown = {}
    for p in (
        config.DATA_DIR / "state" / "projected-shutdown.json",
        Path.home() / "ava" / "data" / "state" / "projected-shutdown.json",
    ):
        if p.is_file():
            try:
                shutdown = json.loads(p.read_text())
                break
            except Exception:
                pass
    try:
        from apps.core.services.site_ops import site_ops, pv_line

        solar = {**solar, **site_ops(), "pv_mount_note": pv_line()}
    except Exception:
        solar.setdefault("pv_mount_note", "Ground-mounted PV")
    return {
        "ok": True,
        "solar": solar,
        "host": host,
        "weather": weather if isinstance(weather, dict) else {},
        "kilauea": kilauea,
        "shutdown": shutdown,
    }


@router.get("/solana-qr", response_class=HTMLResponse)
async def obs_solana_qr():
    path = Path(__file__).resolve().parent.parent / "templates" / "obs-solana.html"
    return HTMLResponse(path.read_text(encoding="utf-8"))


@router.get("/solar", response_class=HTMLResponse)
async def obs_solar_public():
    path = Path(__file__).resolve().parent.parent / "templates" / "solar.html"
    html = path.read_text(encoding="utf-8") if path.is_file() else "<p>solar desk missing</p>"
    return HTMLResponse(html)
async def obs_solar_dashboard():
    origin = f"http://127.0.0.1:{config.AVA_PORT}"
    path = Path(__file__).resolve().parent.parent / "templates" / "obs-solar.html"
    html = path.read_text(encoding="utf-8")
    return HTMLResponse(html.replace("__ORIGIN__", origin))

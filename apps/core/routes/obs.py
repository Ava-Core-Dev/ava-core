"""OBS routes — audio stream page + SSE events + queue API."""

from __future__ import annotations

import asyncio
import json
import logging
import urllib.request
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, Response, StreamingResponse
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


@router.get("/lower-third", response_class=HTMLResponse)
async def obs_lower_third():
    origin = f"http://127.0.0.1:{config.AVA_PORT}"
    return HTMLResponse(f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/>
<title>Ava lower third</title>
<style>
html,body{{margin:0;width:1920px;height:1080px;overflow:hidden;background:transparent;
  color:#fff;font-family:Segoe UI,Helvetica Neue,system-ui,sans-serif}}
#bar{{position:fixed;left:28px;right:28px;bottom:22px;display:flex;justify-content:space-between;
  align-items:center;gap:18px;background:rgba(8,10,14,.82);border:1px solid rgba(245,158,11,.28);
  border-radius:16px;padding:12px 20px}}
.live{{display:flex;align-items:center;gap:8px;letter-spacing:.1em;font-size:13px;font-weight:800}}
.dot{{width:10px;height:10px;border-radius:50%;background:#8a8a8a}}
.brand{{font-size:20px;font-weight:800}}
.brand span{{color:#f59e0b}}
.meta{{opacity:.85;font-size:15px;text-align:right}}
</style></head>
<body>
<div id="bar">
  <div>
    <div class="live"><span class="dot" id="dot"></span><span id="mode">AVA</span></div>
    <div class="brand">Ava Ivy <span>·</span> HI Pacific Root Server</div>
  </div>
  <div class="meta">
    <div id="time"></div>
    <div>play.rootmc.net · <span id="scene">—</span></div>
  </div>
</div>
<script>
function tick(){{
  document.getElementById('time').textContent = new Date().toLocaleTimeString('en-US',{{
    hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,timeZone:'Pacific/Honolulu'
  }}) + ' HST';
}}
tick(); setInterval(tick, 1000);
async function refresh(){{
  try {{
    const s = await fetch('{origin}/api/obs/status').then(r=>r.json());
    document.getElementById('scene').textContent = s.scene || '—';
    document.getElementById('dot').style.background = s.streaming ? '#e10600' : '#8a8a8a';
    const m = (s.mode||'daily').toUpperCase();
    document.getElementById('mode').textContent = s.streaming ? ('LIVE · '+m) : m;
  }} catch(e){{}}
}}
refresh(); setInterval(refresh, 8000);
</script>
</body></html>""")


@router.get("/hurricane", response_class=HTMLResponse)
async def obs_hurricane():
    path = Path(__file__).resolve().parent.parent / "templates" / "obs-hurricane.html"
    return HTMLResponse(path.read_text(encoding="utf-8") if path.is_file() else "<p>hurricane overlay missing</p>")


@router.get("/reactions", response_class=HTMLResponse)
async def obs_reactions():
    origin = f"http://127.0.0.1:{config.AVA_PORT}"
    return HTMLResponse(f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<style>
html,body{{margin:0;width:1920px;height:1080px;overflow:hidden;background:transparent;
font-family:Segoe UI,system-ui,sans-serif;color:#fff}}
#toast{{position:fixed;top:120px;right:36px;max-width:520px;opacity:0;transform:translateY(-8px);
transition:opacity .25s,transform .25s;background:rgba(8,12,18,.9);border:1px solid rgba(6,182,212,.4);
border-radius:14px;padding:14px 18px;font-size:22px;font-weight:700}}
#toast.on{{opacity:1;transform:none}}
</style></head>
<body>
<div id="toast"></div>
<script>
let last = 0;
async function poll(){{
  try {{
    const r = await fetch('{origin}/api/obs/reaction-last').then(x=>x.json());
    if (r && r.ts && r.ts !== last && r.id) {{
      last = r.ts;
      const el = document.getElementById('toast');
      el.textContent = (r.label || r.id).replaceAll('_',' ');
      el.classList.add('on');
      setTimeout(()=>el.classList.remove('on'), 4200);
    }}
  }} catch(e){{}}
}}
poll(); setInterval(poll, 800);
</script>
</body></html>""")


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
    scenes: list[str] = []
    try:
        lst = await director._obs_request("GetSceneList")
        scenes = [
            s.get("sceneName")
            for s in ((lst or {}).get("responseData") or {}).get("scenes") or []
            if s.get("sceneName")
        ]
    except Exception:
        pass
    return {
        "ok": True,
        "streaming": streaming,
        "scene": scene or st.get("current") or "Main",
        "scenes": scenes,
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

    scene = "Scene 3 - Kilauea Watch" if body.action != "exit" else "Main"
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
    from apps.core.services.obs_studio import apply_scene_overlays

    director = get_director()
    connected = await director._connect_obs()
    overlays = await apply_scene_overlays() if connected else {"ok": False, "detail": "obs_unreachable"}
    return {
        "ok": connected and overlays.get("ok"),
        "detail": "obs_reconnect" if connected else "obs_unreachable",
        "overlays": overlays,
    }


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
    from apps.core.services.kilauea_cams import load_catalog, DEFAULT_CAMS

    data = load_catalog()
    cams = data.get("cams") or []
    hit = next((c for c in cams if c.get("id") == cam), None)
    if not hit and cams:
        hit = cams[0]
    if not hit:
        hit = next((c for c in DEFAULT_CAMS if c.get("id") == cam), DEFAULT_CAMS[0])
    return {
        "ok": True,
        "cam": {
            **hit,
            "embed_url": hit.get("url") if hit.get("kind") == "youtube" or hit.get("live") else None,
            "live": bool(hit.get("live") or hit.get("kind") == "youtube"),
        },
        "cams": cams or DEFAULT_CAMS,
        "ts": data.get("ts"),
        "watch": _watch_from_state(_kilauea_state()),
    }


@router.get("/kilauea-desk", response_class=HTMLResponse)
async def obs_kilauea_desk():
    path = Path(__file__).resolve().parent.parent / "templates" / "obs-kilauea-desk.html"
    return HTMLResponse(path.read_text(encoding="utf-8"))


_last_reaction: dict = {"id": "", "label": "", "ts": 0}


@api_router.post("/reaction")
async def api_obs_reaction(body: ReactionBody):
    import time

    rid = (body.reactionId or body.id or "").strip()
    _last_reaction.update({"id": rid, "label": rid.replace("_", " "), "ts": int(time.time() * 1000)})
    return {"ok": True, "id": rid, "detail": "queued"}


@api_router.get("/reaction-last")
async def api_obs_reaction_last():
    return {"ok": True, **_last_reaction}


@api_router.get("/preview")
async def api_obs_preview():
    from apps.voice.director import get_director

    director = get_director()
    scene = None
    image = None
    try:
        scene_data = await director._obs_request("GetCurrentProgramScene")
        scene = ((scene_data or {}).get("responseData") or {}).get("currentProgramSceneName")
        shot = await director._obs_request(
            "GetSourceScreenshot",
            {
                "sourceName": scene,
                "imageFormat": "jpg",
                "imageWidth": 960,
                "imageHeight": 540,
            },
        )
        image = ((shot or {}).get("responseData") or {}).get("imageData")
    except Exception as e:
        log.debug("OBS preview: %s", e)
    return {"ok": bool(image), "scene": scene, "image": image}


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
        try:
            from apps.core.crons.solar_weather import record_host_sample, _host_temp_c
            sample = record_host_sample()
            temp = (sample or {}).get("temp_c")
            if temp is None:
                temp = _host_temp_c()
            if temp is not None:
                host["temp_c"] = temp
        except Exception:
            pass
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


@router.get("/support-ava", response_class=HTMLResponse)
async def obs_support_ava():
    """Scene 10 Support Overlay — same board as /obs/solana-qr."""
    path = Path(__file__).resolve().parent.parent / "templates" / "obs-solana.html"
    return HTMLResponse(path.read_text(encoding="utf-8"))


@router.get("/solar", response_class=HTMLResponse)
async def obs_solar_public():
    path = Path(__file__).resolve().parent.parent / "templates" / "solar.html"
    html = path.read_text(encoding="utf-8") if path.is_file() else "<p>solar desk missing</p>"
    return HTMLResponse(html)


@router.get("/solar-dashboard", response_class=HTMLResponse)
async def obs_solar_dashboard():
    origin = f"http://127.0.0.1:{config.AVA_PORT}"
    path = Path(__file__).resolve().parent.parent / "templates" / "obs-solar.html"
    html = path.read_text(encoding="utf-8") if path.is_file() else "<p>solar overlay missing</p>"
    return HTMLResponse(html.replace("__ORIGIN__", origin))


def _overlays_root() -> Path:
    return Path(__file__).resolve().parent.parent / "templates" / "overlays"


@router.get("/overlays/_shared/{asset_name}")
async def obs_overlay_shared_asset(asset_name: str):
    """Serve shared CSS/JS for isolated card overlays."""
    safe = Path(asset_name).name
    path = _overlays_root() / "_shared" / safe
    if not path.is_file():
        return Response("missing", status_code=404)
    media = "text/css" if safe.endswith(".css") else "application/javascript" if safe.endswith(".js") else "text/plain"
    body = path.read_text(encoding="utf-8")
    if "__ORIGIN__" in body:
        body = body.replace("__ORIGIN__", f"http://127.0.0.1:{config.AVA_PORT}")
    return Response(body, media_type=media)


@router.get("/card/{board}/{card}", response_class=HTMLResponse)
async def obs_overlay_card(board: str, card: str):
    """Isolated board card — one OBS Browser Source per element."""
    b = Path(board).name
    c = Path(card).name
    path = _overlays_root() / b / f"{c}.html"
    if not path.is_file():
        return HTMLResponse(f"<p>card missing: {b}/{c}</p>", status_code=404)
    origin = f"http://127.0.0.1:{config.AVA_PORT}"
    return HTMLResponse(path.read_text(encoding="utf-8").replace("__ORIGIN__", origin))


@router.get("/cards", response_class=HTMLResponse)
async def obs_overlay_cards_index():
    """Human-readable index of every isolated overlay card."""
    root = _overlays_root()
    cat = root / "catalog.json"
    origin = f"http://127.0.0.1:{config.AVA_PORT}"
    if cat.is_file():
        data = json.loads(cat.read_text(encoding="utf-8"))
    else:
        data = {"cards": []}
    rows = []
    for item in data.get("cards") or []:
        url = f"{origin}{item['url']}"
        rows.append(
            f"<tr><td>{item['board']}</td><td><code>{item['card']}</code></td>"
            f"<td><a href='{url}' target='_blank'>{url}</a></td></tr>"
        )
    html = f"""<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>OBS Overlay Cards</title>
<style>body{{font-family:system-ui;background:#0b1220;color:#e8f4ff;padding:24px}}
table{{border-collapse:collapse;width:100%}}td,th{{border:1px solid #234;padding:8px;text-align:left}}
a{{color:#38bdf8}}code{{color:#ffd54a}}</style></head><body>
<h1>OBS Overlay Cards ({len(rows)})</h1>
<p>Each URL is a transparent 1920×1080 page — add as its own Browser Source.</p>
<table><thead><tr><th>Board</th><th>Card</th><th>URL</th></tr></thead>
<tbody>{''.join(rows)}</tbody></table></body></html>"""
    return HTMLResponse(html)


@api_router.get("/overlay-cards")
async def api_overlay_cards():
    cat = _overlays_root() / "catalog.json"
    if not cat.is_file():
        return {"ok": False, "cards": []}
    data = json.loads(cat.read_text(encoding="utf-8"))
    data["origin"] = f"http://127.0.0.1:{config.AVA_PORT}"
    return data


def _template_html(name: str) -> str:
    path = Path(__file__).resolve().parent.parent / "templates" / name
    return path.read_text(encoding="utf-8") if path.is_file() else f"<p>{name} missing</p>"


@router.get("/kilauea-cam", response_class=HTMLResponse)
async def obs_kilauea_cam():
    return HTMLResponse(_template_html("obs-kilauea-cam.html"))


@router.get("/weather-board", response_class=HTMLResponse)
async def obs_weather_board():
    origin = f"http://127.0.0.1:{config.AVA_PORT}"
    return HTMLResponse(_template_html("obs-weather.html").replace("__ORIGIN__", origin))


@router.get("/economy-board", response_class=HTMLResponse)
async def obs_economy_board():
    origin = f"http://127.0.0.1:{config.AVA_PORT}"
    return HTMLResponse(_template_html("obs-economy.html").replace("__ORIGIN__", origin))


@router.get("/goals-report", response_class=HTMLResponse)
async def obs_goals_report():
    origin = f"http://127.0.0.1:{config.AVA_PORT}"
    return HTMLResponse(_template_html("obs-goals.html").replace("__ORIGIN__", origin))


@router.get("/dev-updates", response_class=HTMLResponse)
async def obs_dev_updates():
    origin = f"http://127.0.0.1:{config.AVA_PORT}"
    return HTMLResponse(_template_html("obs-dev-updates.html").replace("__ORIGIN__", origin))


@router.get("/quake-global", response_class=HTMLResponse)
async def obs_quake_global():
    origin = f"http://127.0.0.1:{config.AVA_PORT}"
    return HTMLResponse(_template_html("obs-quake-global.html").replace("__ORIGIN__", origin))


@router.get("/quake-island", response_class=HTMLResponse)
async def obs_quake_island():
    origin = f"http://127.0.0.1:{config.AVA_PORT}"
    return HTMLResponse(_template_html("obs-quake-island.html").replace("__ORIGIN__", origin))


USGS_MAP_GLOBAL = (
    "https://earthquake.usgs.gov/earthquakes/map/"
    "?extent=-80.58973,-374.0625&extent=84.9901,164.88281"
)
USGS_MAP_ISLAND = (
    "https://earthquake.usgs.gov/earthquakes/map/"
    "?extent=18.5,-161.0&extent=22.5,-154.0"
)


@api_router.get("/overlay-gen")
async def api_obs_overlay_gen():
    from apps.core.services.obs_overlay_gen import load_gen

    return {"ok": True, **load_gen()}


@api_router.get("/weather-desk")
async def api_obs_weather_desk():
    """Live desk payload for /obs/weather-board (temp/wind/conditions)."""
    import re
    from datetime import datetime, timezone

    out = {
        "ok": True,
        "ts": datetime.now(timezone.utc).isoformat(),
        "conditions": "—",
        "temp_f": None,
        "wind": "—",
        "hazards": "none",
    }
    try:
        reports = sorted(
            config.REPORTS_DIR.glob("nws-weather-*.md"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        if reports:
            text = reports[0].read_text(errors="replace")
            out["ts"] = datetime.fromtimestamp(
                reports[0].stat().st_mtime, tz=timezone.utc
            ).isoformat()
            # Prefer "80°F — Scattered Rain Showers" lines under ### Today / Tonight
            line = re.search(
                r"###\s*(Today|Tonight|This Afternoon)[^\n]*\n+(\d+)°F\s*[—\-]+\s*([^\n]+)",
                text,
                re.I,
            )
            if line:
                out["temp_f"] = int(line.group(2))
                out["conditions"] = line.group(3).strip()
            else:
                tm = re.search(r"(\d+)°F", text)
                if tm:
                    out["temp_f"] = int(tm.group(1))
                cm = re.search(r"\d+°F\s*[—\-]+\s*([^\n]+)", text)
                if cm:
                    out["conditions"] = cm.group(1).strip()
            wm = re.search(
                r"((?:North|South|East|West|Variable)[^\n.]{0,40}wind[^\n.]{0,40})",
                text,
                re.I,
            )
            if wm:
                out["wind"] = wm.group(1).strip().rstrip(".")
            if re.search(r"##\s*No active HI alerts", text, re.I):
                out["hazards"] = "none"
            else:
                alerts = re.findall(r"^\*\*(.+?)\*\*", text, re.M)
                if alerts:
                    out["hazards"] = "; ".join(a.strip() for a in alerts[:3])
        # Fall back to /api/weather shape if report parse is thin
        if out["temp_f"] is None:
            from apps.core.routes.realworld import api_weather

            w = await api_weather()
            if isinstance(w, dict) and "error" not in w:
                out["temp_f"] = w.get("temperature_f") or w.get("temp_f") or w.get("temperature")
                out["conditions"] = (
                    w.get("conditions")
                    or w.get("period")
                    or w.get("forecast")
                    or out["conditions"]
                )
                out["wind"] = w.get("wind") or w.get("windSpeed") or out["wind"]
                if w.get("alerts_active"):
                    out["hazards"] = f"{w['alerts_active']} alert(s)"
    except Exception:
        pass
    return out


@router.get("/hawaii-ir", response_class=HTMLResponse)
async def obs_hawaii_ir():
    """Full-bleed Hawaii IR loop for OBS (CEF-friendly wrapper around the NWS GIF)."""
    return HTMLResponse(
        """<!DOCTYPE html>
<html><head><meta charset="UTF-8"/><title>Hawaii IR</title>
<style>
html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#000;}
img{width:100%;height:100%;object-fit:cover;display:block;}
</style></head>
<body>
<img id="ir" alt="Hawaii IR"
 src="https://www.weather.gov/images/hfo/satellite/Hawaii_IR_loop.gif"
 onerror="this.src='https://cdn.star.nesdis.noaa.gov/GOES18/ABI/SECTOR/hi/GEOCOLOR/GOES18-HI-GEOCOLOR-600x600.gif'"/>
<script>
// Bust CDN caches every 5 minutes so the loop stays fresh in OBS CEF.
setInterval(()=>{
  const el=document.getElementById('ir');
  const base=el.src.split('?')[0];
  el.src=base+'?t='+Date.now();
}, 300000);
</script>
</body></html>"""
    )


@api_router.get("/economy-desk")
async def api_obs_economy_desk():
    from apps.core.services.obs_desk_data import economy_desk

    return economy_desk()


@api_router.get("/dev-updates-desk")
async def api_obs_dev_updates_desk(limit: int = 6):
    from apps.core.services.obs_desk_data import latest_blog_across_sites, recent_blogs_across_sites

    items = recent_blogs_across_sites(limit=limit)
    newest = items[0] if items else latest_blog_across_sites()
    return {"ok": True, "count": len(items), "items": items, **newest}


@api_router.get("/quake-desk")
async def api_obs_quake_desk(scope: str = "global"):
    from apps.core.services.obs_desk_data import quake_feed

    data = await quake_feed(force=True)
    key = "island" if scope == "island" else "global"
    return {"ok": True, "scope": key, "quakes": data.get(key) or [], "ts": data.get("ts")}


@api_router.get("/kilauea-still")
async def api_obs_kilauea_still(cam: str = "usgs_v1"):
    """Proxy USGS still images through localhost for OBS reliability."""
    from apps.core.services.kilauea_cams import load_catalog, DEFAULT_CAMS

    data = load_catalog()
    cams = list(data.get("cams") or [])
    if not cams:
        cams = list(DEFAULT_CAMS)
    hit = next((c for c in cams if c.get("id") == cam), cams[0])
    still = str(hit.get("still") or "").strip()
    if not still:
        return Response(status_code=404, content=b"")
    req = urllib.request.Request(still, headers={"User-Agent": "AvaIvy/2.0 (obs-still-proxy)"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            content = resp.read()
            ctype = resp.headers.get("Content-Type") or "image/jpeg"
        return Response(
            content=content,
            media_type=ctype,
            headers={"Cache-Control": "no-store, max-age=0"},
        )
    except Exception:
        return Response(status_code=502, content=b"")


class SceneVisibilityBody(BaseModel):
    hidden_manual: list[str] = []


class RotationConfigBody(BaseModel):
    mode_dwell_s: dict[str, int] = {}
    scene_dwell_s: dict[str, int] = {}


@api_router.get("/scene-visibility")
async def api_obs_scene_visibility_get():
    from apps.core.services.obs_scene_visibility import load_visibility
    from apps.voice.director import get_director

    scenes: list[str] = []
    try:
        lst = await get_director()._obs_request("GetSceneList")
        scenes = [
            s.get("sceneName")
            for s in ((lst or {}).get("responseData") or {}).get("scenes") or []
            if s.get("sceneName")
        ]
    except Exception:
        scenes = []
    return {"ok": True, "scenes": scenes, **load_visibility()}


@api_router.post("/scene-visibility")
async def api_obs_scene_visibility_post(body: SceneVisibilityBody):
    from apps.core.services.obs_scene_visibility import set_manual_hidden, refresh_auto_hide

    vis = set_manual_hidden(body.hidden_manual)
    vis = await refresh_auto_hide()
    return {"ok": True, **vis}


@api_router.get("/rotation-config")
async def api_obs_rotation_config_get():
    from apps.core.services.obs_studio import load_rotation_config

    return {"ok": True, **load_rotation_config()}


@api_router.post("/rotation-config")
async def api_obs_rotation_config_post(body: RotationConfigBody):
    from apps.core.services.obs_studio import save_rotation_config

    cfg = save_rotation_config(body.mode_dwell_s, body.scene_dwell_s)
    return {"ok": True, **cfg}


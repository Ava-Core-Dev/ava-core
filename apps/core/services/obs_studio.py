"""OBS WebSocket 5.x helper — identify, request, daily-broadcast kit."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import uuid
from pathlib import Path
from typing import Any

import websockets

from apps.core import config

log = logging.getLogger("ava.obs_studio")

COLLECTION = "Ava Daily Broadcast"
HURRICANE_COLLECTION = "Ava Hurricane Tracker"
MC_SCENE = "RootMC Live"
MC_SHARE = 0.75
QUAKE_GLOBAL = "Quake · Global"
QUAKE_ISLAND = "Quake · Big Island"
DEFAULT_START_SCENE = "Weather Board"
AMBIENT_SCENES = [
    "Weather Board",
    "Radar",
    "Satellite",
    "SO2 Index",
    "Vog Map",
    "Windy Big Island",
    "NHC · EPAC 2-Day",
    "NHC · EPAC 7-Day",
    "NHC · CPAC 2-Day",
    "NHC · CPAC 7-Day",
    "NHC · 5-Day Cone",
    "NHC · Wind Field",
    "NHC · Wind History",
    "Kilauea Watch",
    "Solar Dashboard",
    "Economy Board",
    "Goals Report",
    "Dev Updates",
    "Support Ava",
    QUAKE_GLOBAL,
    QUAKE_ISLAND,
]
def weather_scene_pool() -> list[str]:
    from apps.core.services.nhc_media import nhc_outlook_scenes

    return [
        "Weather Board",
        "Radar",
        "Satellite",
        *nhc_outlook_scenes(),
        "SO2 Index",
        "Vog Map",
        "Windy Big Island",
    ]


LOOP_SCENES = [
    *AMBIENT_SCENES,
    MC_SCENE,
]

# Primary media per scene — rotator waits for this to finish before leaving.
SCENE_MEDIA = {
    "Weather Board": ("NWS Hawaii", "ffmpeg"),
    "Radar": ("NWS Radar", "image"),
    "Satellite": ("Hawaii IR", "image"),
    "SO2 Index": ("HI SO2 Index", "image"),
    "Vog Map": ("MKWC Vog", "image"),
    "Windy Big Island": ("Windy Kilauea", "image"),
    "NHC · EPAC 2-Day": ("NHC EPAC 2Day", "browser"),
    "NHC · EPAC 7-Day": ("NHC EPAC 7Day", "browser"),
    "NHC · CPAC 2-Day": ("NHC CPAC 2Day", "browser"),
    "NHC · CPAC 7-Day": ("NHC CPAC 7Day", "browser"),
    "NHC · 5-Day Cone": ("NHC 5Day Cone", "image"),
    "NHC · Wind Field": ("NHC Wind", "image"),
    "NHC · Wind History": ("NHC Wind History", "image"),
    "Kilauea Watch": ("Kilauea Audio", "ffmpeg"),
    "Solar Dashboard": ("Solar Audio", "ffmpeg"),
    "Economy Board": ("Economy Audio", "ffmpeg"),
    "Goals Report": ("Goals Audio", "ffmpeg"),
    "Dev Updates": ("Dev Audio", "ffmpeg"),
    "Support Ava": ("Solana QR", "image"),
    QUAKE_GLOBAL: ("Quake Global Map", "browser"),
    QUAKE_ISLAND: ("Quake Island Map", "browser"),
}
# Ambient VLC can be on Morning_Broadcast_Current (~7 min); wait at least that long
# unless GetMediaInputStatus reports the current item has ended.
VLC_MIN_DWELL_S = 420
MIN_DWELL_S = 12
MAX_DWELL_S = 900
ROTATION_CFG_PATH = config.DATA_DIR / "state" / "obs-rotation-config.json"

DEFAULT_MODE_DWELL_S = {
    "daily": 60,
    "weather": 60,
    "kilauea": 60,
    "hurricane": 60,
}


def _rotate_state_path() -> Path:
    return config.DATA_DIR / "state" / "obs-rotate.json"


def _load_rotate() -> dict:
    p = _rotate_state_path()
    if not p.is_file():
        return {}
    try:
        return json.loads(p.read_text())
    except Exception:
        return {}


def _save_rotate(scene: str) -> None:
    import time
    p = _rotate_state_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({"scene": scene, "since": time.time()}))


def _sanitize_dwell(value: Any, fallback: int = 60) -> int:
    try:
        n = int(float(value))
    except Exception:
        n = int(fallback)
    return max(5, min(3600, n))


def load_rotation_config() -> dict[str, Any]:
    mode_dwell = dict(DEFAULT_MODE_DWELL_S)
    scene_dwell: dict[str, int] = {}
    if ROTATION_CFG_PATH.is_file():
        try:
            raw = json.loads(ROTATION_CFG_PATH.read_text())
        except Exception:
            raw = {}
        for mode, default_s in DEFAULT_MODE_DWELL_S.items():
            mode_dwell[mode] = _sanitize_dwell((raw.get("mode_dwell_s") or {}).get(mode), default_s)
        for scene, dwell in (raw.get("scene_dwell_s") or {}).items():
            if isinstance(scene, str) and scene.strip():
                scene_dwell[scene] = _sanitize_dwell(dwell, 60)
    return {"mode_dwell_s": mode_dwell, "scene_dwell_s": scene_dwell}


def save_rotation_config(mode_dwell_s: dict[str, Any] | None = None, scene_dwell_s: dict[str, Any] | None = None) -> dict[str, Any]:
    cfg = load_rotation_config()
    if isinstance(mode_dwell_s, dict):
        for mode in DEFAULT_MODE_DWELL_S:
            if mode in mode_dwell_s:
                cfg["mode_dwell_s"][mode] = _sanitize_dwell(mode_dwell_s.get(mode), cfg["mode_dwell_s"][mode])
    if isinstance(scene_dwell_s, dict):
        cleaned: dict[str, int] = {}
        for scene, dwell in scene_dwell_s.items():
            if isinstance(scene, str) and scene.strip():
                cleaned[scene] = _sanitize_dwell(dwell, 60)
        cfg["scene_dwell_s"] = cleaned
    ROTATION_CFG_PATH.parent.mkdir(parents=True, exist_ok=True)
    ROTATION_CFG_PATH.write_text(json.dumps(cfg, indent=2))
    return cfg


class ObsClient:
    def __init__(self) -> None:
        self._ws: Any = None

    async def connect(self) -> bool:
        url = config.OBS_WS_URL
        if not url:
            return False
        try:
            self._ws = await websockets.connect(url, ping_interval=20)
            hello = json.loads(await self._ws.recv())
            auth = hello.get("d", {}).get("authentication")
            identify: dict = {"op": 1, "d": {"rpcVersion": 1}}
            if auth and config.OBS_WS_PASSWORD:
                challenge = auth["challenge"]
                salt = auth["salt"]
                secret = base64.b64encode(
                    hashlib.sha256((config.OBS_WS_PASSWORD + salt).encode()).digest()
                ).decode()
                auth_str = base64.b64encode(
                    hashlib.sha256((secret + challenge).encode()).digest()
                ).decode()
                identify["d"]["authentication"] = auth_str
            await self._ws.send(json.dumps(identify))
            identified = json.loads(await self._ws.recv())
            if identified.get("op") not in (2, 0) and identified.get("d", {}).get("negotiatedRpcVersion") is None:
                # Identified is op 2
                if identified.get("op") != 2:
                    log.warning("OBS identify unexpected: %s", identified)
            return True
        except Exception as e:
            log.warning("OBS connect failed: %s", e)
            self._ws = None
            return False

    async def close(self) -> None:
        if self._ws:
            await self._ws.close()
            self._ws = None

    async def req(self, request_type: str, data: dict | None = None) -> dict:
        if not self._ws:
            raise RuntimeError("obs_not_connected")
        req_id = str(uuid.uuid4())[:8]
        payload = {
            "op": 6,
            "d": {
                "requestType": request_type,
                "requestId": req_id,
                "requestData": data or {},
            },
        }
        await self._ws.send(json.dumps(payload))
        while True:
            raw = json.loads(await asyncio.wait_for(self._ws.recv(), timeout=8))
            if raw.get("op") != 7:
                continue
            body = raw.get("d") or {}
            if body.get("requestId") != req_id:
                continue
            status = body.get("requestStatus") or {}
            if not status.get("result", True):
                raise RuntimeError(
                    f"{request_type}: {status.get('code')} {status.get('comment')}"
                )
            return body.get("responseData") or {}

    async def try_req(self, request_type: str, data: dict | None = None) -> dict | None:
        try:
            return await self.req(request_type, data)
        except Exception as e:
            log.debug("%s skipped: %s", request_type, e)
            return None


def _item(path: Path, selected: bool = False) -> dict:
    return {
        "value": str(path),
        "hidden": False,
        "selected": selected,
    }


def playlist_paths() -> list[Path]:
    """PG-13 daily loop only — unnamed Grok gens and random YouTube stay out."""
    media = config.MEDIA_DIR
    deny = (
        "generated_video",
        "grok-video",
        "ava-gen-",
        "nsfw",
        "nude",
        "explicit",
        "ambient-mix",  # mix was built from the gen dump
        "jNQXAC9IVRw",
    )
    allow_name = (
        "morning_broadcast",
        "nws-hawaii",
        "earthquake",
        "ara-report",
        "peakactivity",
        "going-back-to-bed",
        "good-morning",
        "meadow",
        "hologram",
        "desk-ops",
        "idle",
    )
    roots = [
        media / "video" / "current",
        media / "video" / "appearance",
        media / "video" / "reports",
    ]
    seen: set[int] = set()
    files: list[Path] = []
    for root in roots:
        if not root.is_dir():
            continue
        for p in sorted(root.glob("*.mp4")) + sorted(root.glob("*.webm")):
            name = p.name.lower()
            if any(d in name for d in deny):
                continue
            if root.name == "appearance" and not any(a in name for a in allow_name):
                continue
            try:
                sz = p.stat().st_size
            except OSError:
                continue
            if sz < 80_000 or sz in seen:
                continue
            seen.add(sz)
            files.append(p)

    def _rank(p: Path) -> tuple[int, str]:
        name = p.name.lower()
        if "morning_broadcast" in name:
            return (0, name)
        if "current" in str(p.parent):
            return (1, name)
        return (2, name)

    files.sort(key=_rank)
    return files


def write_playlist_m3u(paths: list[Path] | None = None) -> Path:
    dest = config.MEDIA_DIR / "stream" / "ava-daily-loop.m3u"
    dest.parent.mkdir(parents=True, exist_ok=True)
    items = paths or playlist_paths()
    dest.write_text("#EXTM3U\n" + "\n".join(str(p) for p in items) + "\n")
    return dest


NWS_RADAR_URL = (
    "https://radar.weather.gov/?settings=v1_eyJhZ2VuZGEiOnsiaWQiOm51bGwsImNlbnRlciI6"
    "Wy0xNTcuNzI0LDIwLjg3NV0sImxvY2F0aW9uIjpudWxsLCJ6b29tIjo3LjI4NDE4OTAxNzQ4OTc3M30s"
    "ImFuaW1hdGluZyI6dHJ1ZSwiYmFzZSI6InN0YW5kYXJkIiwiYXJ0Y2MiOmZhbHNlLCJjb3VudHkiOmZhbHNl"
    "LCJjd2EiOmZhbHNlLCJyZmMiOmZhbHNlLCJzdGF0ZSI6ZmFsc2UsIm1lbnUiOnRydWUsInNob3J0RnVzZWRP"
    "bmx5IjpmYWxzZSwib3BhY2l0eSI6eyJhbGVydHMiOjAuOCwibG9jYWwiOjAuNiwibG9jYWxTdGF0aW9ucyI6"
    "MC44LCJuYXRpb25hbCI6MC42fX0%3D"
)
WINDY_RADAR_URL = "https://www.windy.com/-Weather-radar-radar?radar,20.808,-157.736,6,p:cities"
WINDY_HURRICANE_URL = "https://www.windy.com/-Hurricane-tracker/hurricanes?950h,19.929,-155.800,6,p:cities"
WINDY_CLOUDS_URL = "https://www.windy.com/-High-clouds-hclouds?hclouds,21.545,-156.761,6,p:cities"
WINDY_KILAUEA_URL = "https://www.windy.com/?19.761,-155.615,9,p:cities,m:eeNaPl"
HI_SO2_URL = "https://www.hiso2index.info/"
HI_VOG_URL = "http://mkwc.ifa.hawaii.edu/vmap/vog/"
HAWAII_IR_URL = "https://www.weather.gov/images/hfo/satellite/Hawaii_IR_loop.gif"
GOES_HI_URL = "https://cdn.star.nesdis.noaa.gov/GOES18/ABI/SECTOR/hi/GEOCOLOR/GOES18-HI-GEOCOLOR-1000x1000.gif"
# Full-screen hazard maps used as scene media (Kīlauea + weather).
HAZARD_SCENES = [
    ("SO2 Index", "HI SO2 Index", HI_SO2_URL),
    ("Vog Map", "MKWC Vog", HI_VOG_URL),
    ("Windy Big Island", "Windy Kilauea", WINDY_KILAUEA_URL),
]
_SKIP_STRETCH = {
    "Ava Audio",
    "Economy Audio",
    "Solar Audio",
    "Kilauea Audio",
    "Dev Audio",
    "Goals Audio",
    "Solana QR",
}


async def _ensure_input(
    obs: ObsClient,
    scene: str,
    name: str,
    kind: str,
    settings: dict,
    *,
    audio: bool = False,
) -> None:
    existing = await obs.try_req("GetInputSettings", {"inputName": name})
    if existing is not None:
        await obs.try_req("SetInputSettings", {"inputName": name, "inputSettings": settings})
        # make sure it is in this scene
        items = await obs.try_req("GetSceneItemList", {"sceneName": scene}) or {}
        names = [i.get("sourceName") for i in items.get("sceneItems") or []]
        if name not in names:
            await obs.try_req(
                "CreateSceneItem",
                {"sceneName": scene, "sourceName": name, "sceneItemEnabled": True},
            )
        return
    await obs.req(
        "CreateInput",
        {
            "sceneName": scene,
            "inputName": name,
            "inputKind": kind,
            "inputSettings": settings,
            "sceneItemEnabled": True,
        },
    )
    if not audio:
        await obs.try_req("SetInputMute", {"inputName": name, "inputMuted": False})


async def _fit(obs: ObsClient, scene: str, source: str, w: int = 1920, h: int = 1080) -> None:
    items = await obs.try_req("GetSceneItemList", {"sceneName": scene}) or {}
    sid = None
    for it in items.get("sceneItems") or []:
        if it.get("sourceName") == source:
            sid = it.get("sceneItemId")
            break
    if sid is None:
        return
    await obs.try_req(
        "SetSceneItemTransform",
        {
            "sceneName": scene,
            "sceneItemId": sid,
            "sceneItemTransform": {
                "boundsType": "OBS_BOUNDS_STRETCH",
                "boundsAlignment": 0,
                "boundsWidth": float(w),
                "boundsHeight": float(h),
                "alignment": 5,
                "positionX": 0.0,
                "positionY": 0.0,
            },
        },
    )


async def _enable_item(obs: ObsClient, scene: str, source: str, on: bool) -> bool:
    items = await obs.try_req("GetSceneItemList", {"sceneName": scene}) or {}
    for it in items.get("sceneItems") or []:
        if it.get("sourceName") == source:
            await obs.try_req(
                "SetSceneItemEnabled",
                {
                    "sceneName": scene,
                    "sceneItemId": it["sceneItemId"],
                    "sceneItemEnabled": bool(on),
                },
            )
            return True
    return False


SKIP_LOWER_THIRD = {
    "Solar Dashboard",
    QUAKE_GLOBAL,
    QUAKE_ISLAND,
    "Support Ava",
    "Kilauea Watch",
}


USGS_MAP_GLOBAL = (
    "https://earthquake.usgs.gov/earthquakes/map/"
    "?extent=-80.58973,-374.0625&extent=84.9901,164.88281"
)
USGS_MAP_ISLAND = (
    "https://earthquake.usgs.gov/earthquakes/map/"
    "?extent=18.5,-161.0&extent=22.5,-154.0"
)


async def _overlay_browser(
    obs: ObsClient,
    scene: str,
    name: str,
    url: str,
    *,
    restart: bool = True,
) -> None:
    await _ensure_input(
        obs,
        scene,
        name,
        "browser_source",
        {
            "url": url,
            "width": 1920,
            "height": 1080,
            "css": "body { background-color: rgba(0,0,0,0); margin: 0; overflow: hidden; }",
            "shutdown": False,
            "restart_when_active": restart,
        },
    )
    await _fit(obs, scene, name)


async def _remove_legacy_scenes(obs: ObsClient) -> list[str]:
    removed = []
    for scene in ("Main", "Ambient Playlist", "Quake Overlay"):
        await obs.try_req("RemoveScene", {"sceneName": scene})
        removed.append(scene)
    return removed

async def apply_scene_overlays(obs: Any | None = None, origin: str | None = None) -> dict:
    """Add lower-third + director audio to daily scenes that only had media."""
    origin = origin or f"http://127.0.0.1:{config.AVA_PORT}"
    own = False
    if obs is None:
        obs = ObsClient()
        if not await obs.connect():
            return {"ok": False, "detail": "obs_unreachable"}
        own = True
    placed: list[str] = []
    try:
        existing = {
            s.get("sceneName")
            for s in (await obs.req("GetSceneList")).get("scenes") or []
        }
        targets = [
            s
            for s in [*LOOP_SCENES, "Be right back"]
            if s in existing and s not in SKIP_LOWER_THIRD
        ]
        first = targets[0] if targets else None
        if first:
            await _ensure_input(
                obs,
                first,
                "Ava Lower",
                "browser_source",
                {
                    "url": f"{origin}/obs/lower-third",
                    "width": 1920,
                    "height": 1080,
                    "css": "body { background-color: rgba(0,0,0,0); margin: 0; overflow: hidden; }",
                    "reroute_audio": False,
                    "shutdown": False,
                    "restart_when_active": False,
                },
            )
            await _ensure_input(
                obs,
                first,
                "Ava Reactions",
                "browser_source",
                {
                    "url": f"{origin}/obs/reactions",
                    "width": 1920,
                    "height": 1080,
                    "css": "body { background-color: rgba(0,0,0,0); margin: 0; overflow: hidden; }",
                    "shutdown": False,
                    "restart_when_active": True,
                },
            )
        for scene in targets:
            await _ensure_input(
                obs,
                scene,
                "Ava Lower",
                "browser_source",
                {
                    "url": f"{origin}/obs/lower-third",
                    "width": 1920,
                    "height": 1080,
                    "css": "body { background-color: rgba(0,0,0,0); margin: 0; overflow: hidden; }",
                    "shutdown": False,
                },
            )
            await _ensure_input(
                obs,
                scene,
                "Ava Audio",
                "browser_source",
                {
                    "url": f"{origin}/obs/audio-stream",
                    "width": 2,
                    "height": 2,
                    "reroute_audio": True,
                    "shutdown": False,
                    "restart_when_active": True,
                },
                audio=True,
            )
            await _ensure_input(
                obs,
                scene,
                "Ava Reactions",
                "browser_source",
                {
                    "url": f"{origin}/obs/reactions",
                    "width": 1920,
                    "height": 1080,
                    "shutdown": False,
                    "restart_when_active": True,
                },
            )
            placed.append(scene)
        return {"ok": True, "scenes": placed}
    finally:
        if own:
            await obs.close()


async def _stretch_all(obs: ObsClient) -> int:
    """Stretch every visible canvas source to 1920×1080 (OBS Bounds: Stretch)."""
    n = 0
    scenes = [s.get("sceneName") for s in (await obs.req("GetSceneList")).get("scenes") or []]
    for scene in scenes:
        items = await obs.try_req("GetSceneItemList", {"sceneName": scene}) or {}
        for it in items.get("sceneItems") or []:
            name = str(it.get("sourceName") or "")
            if not name or name in _SKIP_STRETCH or name.startswith("HT Overlay") or name.startswith("KV Overlay"):
                continue
            await _fit(obs, scene, name)
            n += 1
    return n


async def apply_weather_radar(obs: ObsClient | None = None) -> dict:
    """Pull NWS radar / IR / Windy / hurricane from the Untitled weather collection."""
    own = obs is None
    if own:
        obs = ObsClient()
        if not await obs.connect():
            return {"ok": False, "detail": "obs_unreachable"}
    try:
        existing = {s.get("sceneName") for s in (await obs.req("GetSceneList")).get("scenes") or []}
        for scene in ("Radar", "Satellite", "Weather Board"):
            if scene not in existing:
                await obs.try_req("CreateScene", {"sceneName": scene})
        browsers = [
            ("Radar", "NWS Radar", NWS_RADAR_URL, True),
            ("Radar", "Windy Hawaii", WINDY_RADAR_URL, False),
            ("Radar", "Hurricane Tracker", WINDY_HURRICANE_URL, False),
            ("Satellite", "Hawaii IR", HAWAII_IR_URL, True),
            ("Satellite", "GOES Hawaii", GOES_HI_URL, False),
            ("Satellite", "Windy Clouds", WINDY_CLOUDS_URL, False),
            ("Weather Board", "Hawaii IR", HAWAII_IR_URL, False),
        ]
        for scene, name, url in HAZARD_SCENES:
            if scene not in existing:
                await obs.try_req("CreateScene", {"sceneName": scene})
            browsers.append((scene, name, url, True))
            browsers.append(("Weather Board", name, url, False))
        for scene, name, url, vis in browsers:
            await _ensure_input(
                obs,
                scene,
                name,
                "browser_source",
                {
                    "url": url,
                    "width": 1920,
                    "height": 1080,
                    "shutdown": True,
                    "restart_when_active": True,
                    "css": "body { margin: 0; overflow: hidden; }",
                },
            )
            await _fit(obs, scene, name)
            await _enable_item(obs, scene, name, vis)
        await _enable_item(obs, "Weather Board", "Windy Hawaii", False)
        await _enable_item(obs, "Weather Board", "NWS Hawaii", True)
        await _fit(obs, "Weather Board", "NWS Hawaii")
        from apps.core.services.nhc_media import apply_nhc_obs_scenes, live_url, NHC_OUTLOOK_SCENES

        for _scene, name, slug in NHC_OUTLOOK_SCENES:
            await _ensure_input(
                obs,
                "Weather Board",
                name,
                "browser_source",
                {
                    "url": live_url(slug),
                    "width": 1920,
                    "height": 1080,
                    "shutdown": True,
                    "restart_when_active": True,
                },
            )
            await _enable_item(obs, "Weather Board", name, False)
        await apply_nhc_obs_scenes(obs)
        stretched = await _stretch_all(obs) if own else 0
        return {"ok": True, "stretched": stretched}
    finally:
        if own:
            await obs.close()


async def apply_solana_qr_scene(
    obs: ObsClient | None = None,
    *,
    origin: str | None = None,
    thumb: Path | None = None,
) -> dict:
    """OBS scene: Ava’s official Solana QR on the right, copy on the left."""
    from apps.core.services.user_qrcodes import write_ava_main_qr

    qr = write_ava_main_qr()
    own = obs is None
    if own:
        obs = ObsClient()
        if not await obs.connect():
            return {"ok": False, "detail": "obs_unreachable", "qr": str(qr)}
    origin = origin or f"http://127.0.0.1:{config.AVA_PORT}"
    still = thumb if thumb and thumb.is_file() else Path(config.DAILY_BROADCAST_THUMB)
    try:
        scenes = {s.get("sceneName") for s in (await obs.req("GetSceneList")).get("scenes") or []}
        if "Support Ava" not in scenes:
            await obs.try_req("CreateScene", {"sceneName": "Support Ava"})
        if still.is_file():
            await _ensure_input(
                obs, "Support Ava", "Support Still", "image_source", {"file": str(still)}
            )
            await _fit(obs, "Support Ava", "Support Still")
        await _ensure_input(
            obs,
            "Support Ava",
            "Solana Copy",
            "browser_source",
            {
                "url": f"{origin}/obs/solana-qr",
                "width": 1920,
                "height": 1080,
                "css": "body { background-color: rgba(0,0,0,0); margin: 0; overflow: hidden; }",
                "reroute_audio": False,
            },
        )
        await _fit(obs, "Support Ava", "Solana Copy")
        await _ensure_input(
            obs, "Support Ava", "Solana QR", "image_source", {"file": str(qr)}
        )
        items = await obs.try_req("GetSceneItemList", {"sceneName": "Support Ava"}) or {}
        for it in items.get("sceneItems") or []:
            if it.get("sourceName") != "Solana QR":
                continue
            await obs.try_req(
                "SetSceneItemTransform",
                {
                    "sceneName": "Support Ava",
                    "sceneItemId": it["sceneItemId"],
                    "sceneItemTransform": {
                        "boundsType": "OBS_BOUNDS_STRETCH",
                        "boundsAlignment": 0,
                        "boundsWidth": 640.0,
                        "boundsHeight": 640.0,
                        "alignment": 5,
                        "positionX": 1180.0,
                        "positionY": 220.0,
                    },
                },
            )
        return {"ok": True, "scene": "Support Ava", "qr": str(qr)}
    finally:
        if own:
            await obs.close()


async def setup_daily_broadcast(*, start_stream: bool = False) -> dict:
    """Create/switch the Ava Daily Broadcast collection and wire sources."""
    media = config.MEDIA_DIR
    origin = f"http://127.0.0.1:{config.AVA_PORT}"
    thumb = Path(config.DAILY_BROADCAST_THUMB)
    if not thumb.is_file():
        thumb = media / "images" / "thumbnails" / "DEFAULT.jpg"
    bg = Path("/home/ava-core/.config/background")
    kilauea_html = media / "stream" / "overlays" / "obs-kilauea.html"
    playlist = [_item(p) for p in playlist_paths()]
    statement = media / "audio" / "reports" / "ava_full_statement_ara.mp3"
    intro = media / "audio" / "reports" / "ava_intro_what_she_does_ara.mp3"
    goals_img = media / "images" / "thumbnails" / "goalsreports.jpg"
    dev_img = media / "images" / "thumbnails" / "video devupdate.jpg"
    nws = media / "video" / "current" / "nws-hawaii-current.mp4"
    quake = media / "video" / "current" / "earthquake-global-current.mp4"
    solar_mp3 = media / "audio" / "current" / "solar-weather-current.mp3"
    eco_mp3 = media / "audio" / "current" / "system-performance-current.mp3"

    obs = ObsClient()
    if not await obs.connect():
        return {"ok": False, "detail": "obs_unreachable"}

    detail: list[str] = []
    try:
        cols = await obs.req("GetSceneCollectionList")
        names = cols.get("sceneCollections") or []
        if COLLECTION not in names:
            await obs.req("CreateSceneCollection", {"sceneCollectionName": COLLECTION})
            detail.append("created_collection")
            await asyncio.sleep(1.2)
        elif cols.get("currentSceneCollectionName") != COLLECTION:
            await obs.req("SetCurrentSceneCollection", {"sceneCollectionName": COLLECTION})
            detail.append("switched_collection")
            await asyncio.sleep(1.2)

        existing_scenes = {
            s.get("sceneName")
            for s in (await obs.req("GetSceneList")).get("scenes") or []
        }
        for scene in [
            *LOOP_SCENES,
            QUAKE_GLOBAL,
            QUAKE_ISLAND,
            "Support Ava",
            "Be right back",
        ]:
            if scene not in existing_scenes:
                await obs.try_req("CreateScene", {"sceneName": scene})

        await _remove_legacy_scenes(obs)

        # Weather overlay on Weather Board
        if nws.is_file():
            await _ensure_input(
                obs,
                "Weather Board",
                "NWS Hawaii",
                "ffmpeg_source",
                {
                    "is_local_file": True,
                    "local_file": str(nws),
                    "looping": True,
                    "restart_on_activate": True,
                    "close_when_inactive": False,
                    "clear_on_media_end": False,
                },
                audio=True,
            )
            await _fit(obs, "Weather Board", "NWS Hawaii")
        await apply_weather_radar(obs)
        await _overlay_browser(obs, "Weather Board", "Weather Overlay", f"{origin}/obs/weather-board")

        # Kilauea — local USGS still page (never YouTube embed in OBS)
        from apps.core.services.kilauea_cams import load_catalog, obs_cam_url

        cat = load_catalog()
        v1 = next((c for c in cat.get("cams") or [] if c.get("id") == "usgs_v1"), None)
        v1_url = (v1 or {}).get("obs_url") or obs_cam_url("usgs_v1")
        await _ensure_input(
            obs,
            "Kilauea Watch",
            "HVO Kilauea",
            "browser_source",
            {
                "url": v1_url,
                "width": 1920,
                "height": 1080,
                "shutdown": True,
                "restart_when_active": True,
            },
        )
        await _fit(obs, "Kilauea Watch", "HVO Kilauea")
        if kilauea_html.is_file():
            await _ensure_input(
                obs,
                "Kilauea Watch",
                "Kilauea Overlay",
                "browser_source",
                {
                    "is_local_file": True,
                    "local_file": str(kilauea_html),
                    "width": 1920,
                    "height": 1080,
                    "shutdown": False,
                    "restart_when_active": True,
                },
            )
        await _overlay_browser(
            obs,
            "Kilauea Watch",
            "Kilauea Desk",
            f"{origin}/obs/kilauea-desk?cam=usgs_v1",
        )

        # Solar
        still_solar = thumb
        await _ensure_input(
            obs,
            "Solar Dashboard",
            "Solar Still",
            "image_source",
            {"file": str(still_solar)},
        )
        await _fit(obs, "Solar Dashboard", "Solar Still")
        if solar_mp3.is_file():
            await _ensure_input(
                obs,
                "Solar Dashboard",
                "Solar Audio",
                "ffmpeg_source",
                {
                    "is_local_file": True,
                    "local_file": str(solar_mp3),
                    "looping": True,
                    "close_when_inactive": False,
                    "clear_on_media_end": False,
                },
                audio=True,
            )
        await _ensure_input(
            obs,
            "Solar Dashboard",
            "Solar HUD",
            "browser_source",
            {
                "url": f"{origin}/obs/solar-dashboard",
                "width": 1920,
                "height": 1080,
                "css": "body { background-color: rgba(0,0,0,0); margin: 0; overflow: hidden; }",
                "shutdown": False,
                "restart_when_active": True,
            },
        )

        # Economy / RootMC
        await _ensure_input(
            obs,
            "Economy Board",
            "Economy Still",
            "image_source",
            {"file": str(goals_img if goals_img.is_file() else thumb)},
        )
        await _fit(obs, "Economy Board", "Economy Still")
        if eco_mp3.is_file():
            await _ensure_input(
                obs,
                "Economy Board",
                "Economy Audio",
                "ffmpeg_source",
                {
                    "is_local_file": True,
                    "local_file": str(eco_mp3),
                    "looping": True,
                    "close_when_inactive": False,
                    "clear_on_media_end": False,
                },
                audio=True,
            )
        await _overlay_browser(obs, "Economy Board", "Economy Overlay", f"{origin}/obs/economy-board")
        await _ensure_input(
            obs,
            "RootMC Live",
            "Ava Ivy Cloud",
            "browser_source",
            {
                "url": "https://avaivy.cloud",
                "width": 1920,
                "height": 1080,
                "shutdown": True,
                "restart_when_active": True,
            },
        )
        await _fit(obs, "RootMC Live", "Ava Ivy Cloud")
        from apps.core.services.minecraft_live import offline_thumb
        mc_thumb = offline_thumb() or Path(config.DAILY_BROADCAST_THUMB)
        await _ensure_input(
            obs,
            "RootMC Live",
            "MC Offline Thumb",
            "image_source",
            {"file": str(mc_thumb)},
        )
        await _fit(obs, "RootMC Live", "MC Offline Thumb")
        kinds = ((await obs.try_req("GetInputKindList")) or {}).get("inputKinds") or []
        if "xcomposite_input" in kinds:
            await _ensure_input(
                obs,
                "RootMC Live",
                "MC Game",
                "xcomposite_input",
                {"capture_window": "Minecraft", "show_cursor": False},
            )
            await _fit(obs, "RootMC Live", "MC Game")
        elif "pipewire-screen-capture-source" in kinds:
            await _ensure_input(
                obs,
                "RootMC Live",
                "MC Game",
                "pipewire-screen-capture-source",
                {},
            )
            await _fit(obs, "RootMC Live", "MC Game")

        # Goals / Dev
        await _ensure_input(
            obs,
            "Goals Report",
            "Goals Image",
            "image_source",
            {"file": str(goals_img if goals_img.is_file() else thumb)},
        )
        await _fit(obs, "Goals Report", "Goals Image")
        if statement.is_file():
            await _ensure_input(
                obs,
                "Goals Report",
                "Goals Audio",
                "ffmpeg_source",
                {
                    "is_local_file": True,
                    "local_file": str(statement),
                    "looping": True,
                    "close_when_inactive": False,
                    "clear_on_media_end": False,
                },
                audio=True,
            )
        await _overlay_browser(obs, "Goals Report", "Goals Overlay", f"{origin}/obs/goals-report")
        await _ensure_input(
            obs,
            "Dev Updates",
            "Dev Image",
            "image_source",
            {"file": str(dev_img if dev_img.is_file() else thumb)},
        )
        await _fit(obs, "Dev Updates", "Dev Image")
        await _overlay_browser(obs, "Dev Updates", "Dev Overlay", f"{origin}/obs/dev-updates")
        if intro.is_file():
            await _ensure_input(
                obs,
                "Dev Updates",
                "Dev Audio",
                "ffmpeg_source",
                {
                    "is_local_file": True,
                    "local_file": str(intro),
                    "looping": True,
                    "close_when_inactive": False,
                    "clear_on_media_end": False,
                },
                audio=True,
            )

        for qscene, qname, qurl in (
            (QUAKE_GLOBAL, "Quake Global Map", USGS_MAP_GLOBAL),
            (QUAKE_ISLAND, "Quake Island Map", USGS_MAP_ISLAND),
        ):
            await _ensure_input(
                obs,
                qscene,
                qname,
                "browser_source",
                {
                    "url": qurl,
                    "width": 1920,
                    "height": 1080,
                    "shutdown": True,
                    "restart_when_active": True,
                    "css": "body { margin: 0; overflow: hidden; background: #000; }",
                },
            )
            await _fit(obs, qscene, qname)
            await _overlay_browser(obs, qscene, "Quake Overlay Global", f"{origin}/obs/quake-global")
            await _overlay_browser(obs, qscene, "Quake Overlay Island", f"{origin}/obs/quake-island")

        await _ensure_input(
            obs,
            "Be right back",
            "BRB Still",
            "image_source",
            {"file": str(thumb)},
        )
        await _fit(obs, "Be right back", "BRB Still")

        await apply_solana_qr_scene(obs, origin=origin, thumb=thumb if thumb.is_file() else bg)
        await apply_scene_overlays(obs, origin=origin)
        from apps.core.services.obs_scene_visibility import refresh_auto_hide, apply_hidden_scenes

        await refresh_auto_hide()
        await apply_hidden_scenes(obs)
        await _stretch_all(obs)

        await obs.try_req("SetCurrentProgramScene", {"sceneName": DEFAULT_START_SCENE})
        from apps.core.services.hurricane_tracker import write_mode as _write_obs_mode

        _write_obs_mode("daily")

        # Mute desktop/mic so only program audio goes out
        for cap in ("Desktop Audio", "Mic/Aux"):
            await obs.try_req("SetInputMute", {"inputName": cap, "inputMuted": True})

        streaming = False
        if start_stream:
            st = await obs.try_req("GetStreamStatus") or {}
            if not st.get("outputActive"):
                await obs.try_req("StartStream")
            streaming = bool((await obs.try_req("GetStreamStatus") or {}).get("outputActive"))

        scenes = [s.get("sceneName") for s in (await obs.req("GetSceneList")).get("scenes") or []]
        await obs.close()
        self_obs_closed = True
        wired = await apply_current_scene_media()
        return {
            "ok": True,
            "collection": COLLECTION,
            "scenes": scenes,
            "playlist": [str(p) for p in playlist_paths()],
            "streaming": streaming,
            "detail": detail,
            "current_media": wired,
        }
    finally:
        if not locals().get("self_obs_closed"):
            await obs.close()


async def apply_ambient_playlist() -> dict:
    """Legacy — Main/Ambient removed; refresh weather desk media instead."""
    wired = await apply_current_scene_media()
    return {"ok": wired.get("ok", False), "detail": "ambient_removed", "wired": wired}


async def apply_minecraft_live(snap: dict | None = None) -> dict:
    from apps.core.services.minecraft_live import (
        snapshot as mc_snapshot,
        offline_thumb,
        bind_minecraft_capture,
    )

    snap = snap or mc_snapshot()
    ingame = bool(snap.get("ingame"))
    thumb = offline_thumb()
    obs = ObsClient()
    if not await obs.connect():
        return {"ok": False, "detail": "obs_unreachable", "ingame": ingame}
    try:
        if thumb:
            await obs.try_req(
                "SetInputSettings",
                {"inputName": "MC Offline Thumb", "inputSettings": {"file": str(thumb)}},
            )
        await bind_minecraft_capture(obs, ingame)
        await _enable_item(obs, MC_SCENE, "MC Game", ingame)
        await _enable_item(obs, MC_SCENE, "MC Offline Thumb", not ingame)
        await _enable_item(obs, MC_SCENE, "Ava Ivy Cloud", False)
        cur = (await obs.req("GetCurrentProgramScene")).get("currentProgramSceneName")
        switched = None
        if ingame and not snap.get("was_ingame") and cur != MC_SCENE:
            await obs.req("SetCurrentProgramScene", {"sceneName": MC_SCENE})
            switched = MC_SCENE
        elif (not ingame) and cur == MC_SCENE:
            await obs.req("SetCurrentProgramScene", {"sceneName": DEFAULT_START_SCENE})
            switched = DEFAULT_START_SCENE
        return {
            "ok": True,
            "ingame": ingame,
            "thumb": str(thumb) if thumb else None,
            "scene": switched or cur,
            "window": snap.get("window_title"),
        }
    finally:
        await obs.close()


async def apply_current_scene_media() -> dict:
    """Point each desk at media/audio/current + video/current and play each file once."""
    media = config.MEDIA_DIR
    cur_a = media / "audio" / "current"
    cur_v = media / "video" / "current"
    reports = media / "audio" / "reports"
    dev_src = reports / "ava_dev_update_account_redesign_ara.mp3"
    dev_cur = cur_a / "dev-update-current.mp3"
    if dev_src.is_file() and not dev_cur.exists():
        try:
            dev_cur.symlink_to(dev_src)
        except OSError:
            import shutil
            shutil.copy2(dev_src, dev_cur)
    desk = cur_a / "hourly-desk-current.mp3"
    parts = [
        cur_a / "solar-weather-current.mp3",
        cur_a / "Kilauea_Current.mp3",
        cur_a / "nws-hawaii-current.mp3",
        cur_a / "earthquake-global-current.mp3",
        cur_a / "ara-report-current.mp3",
        cur_a / "system-performance-current.mp3",
    ]
    existing = [p for p in parts if p.is_file()]
    if existing and (not desk.is_file() or desk.stat().st_mtime < max(p.stat().st_mtime for p in existing)):
        _concat_mp3(existing, desk)

    def spoken(path: Path) -> dict:
        return {
            "is_local_file": True,
            "local_file": str(path),
            "looping": False,
            "restart_on_activate": True,
            "close_when_inactive": True,
            "clear_on_media_end": False,
        }

    obs = ObsClient()
    if not await obs.connect():
        return {"ok": False, "detail": "obs_unreachable"}
    wired: dict[str, str] = {}
    try:
        jobs = [
            ("Weather Board", "NWS Hawaii", cur_v / "nws-hawaii-current.mp4", True),
            ("Kilauea Watch", "Kilauea Audio", cur_a / "Kilauea_Current.mp3", False),
            ("Solar Dashboard", "Solar Audio", cur_a / "solar-weather-current.mp3", False),
            ("Economy Board", "Economy Audio", desk if desk.is_file() else cur_a / "ara-report-current.mp3", False),
            ("Economy Board", "Economy Video", cur_v / "ara-report-current.mp4", True),
            ("Goals Report", "Goals Audio", statement if statement.is_file() else cur_a / "Morning_Broadcast_Current.mp3", False),
            ("Dev Updates", "Dev Audio", dev_cur if dev_cur.exists() else reports / "ava_intro_what_she_does_ara.mp3", False),
        ]
        for scene, name, path, vis in jobs:
            if not path.is_file():
                wired[name] = "missing"
                continue
            settings = spoken(path)
            await _ensure_input(obs, scene, name, "ffmpeg_source", settings, audio=True)
            if vis:
                await _fit(obs, scene, name)
            wired[name] = path.name
        await _enable_item(obs, "Goals Report", "Goals Audio", True)
        await _enable_item(obs, "Goals Report", "Goals Image", False)
        await _enable_item(obs, "Goals Report", "Goals Video", False)
        await _enable_item(obs, "Economy Board", "Economy Still", False)
        await _enable_item(obs, "Economy Board", "Economy Video", True)
        return {"ok": True, "wired": wired, "desk_brief": desk.name if desk.is_file() else None}
    finally:
        await obs.close()


def _concat_mp3(parts: list[Path], dest: Path) -> None:
    import subprocess
    lst = dest.with_suffix(".concat.txt")
    lst.write_text("".join(f"file '{p}'\n" for p in parts))
    dest.parent.mkdir(parents=True, exist_ok=True)
    cmd_copy = ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(dest)]
    r = subprocess.run(cmd_copy, capture_output=True, text=True, timeout=60)
    if r.returncode != 0 or not dest.is_file():
        subprocess.run(
            ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(lst),
             "-c:a", "libmp3lame", "-b:a", "192k", str(dest)],
            capture_output=True, text=True, timeout=90, check=False,
        )


async def _media_remaining_s(obs: ObsClient, input_name: str) -> float | None:
    st = await obs.try_req("GetMediaInputStatus", {"inputName": input_name})
    if not st:
        return None
    state = str(st.get("mediaState") or "")
    if "ENDED" in state or "STOPPED" in state:
        return 0.0
    dur = float(st.get("mediaDuration") or 0)
    cur = float(st.get("mediaCursor") or 0)
    if dur <= 0:
        return None
    if dur > 1000:
        dur /= 1000.0
        cur /= 1000.0
    return max(0.0, dur - cur)


async def _restart_media(obs: ObsClient, input_name: str) -> None:
    await obs.try_req(
        "TriggerMediaInputAction",
        {
            "inputName": input_name,
            "mediaAction": "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART",
        },
    )


async def rotate_loop_scene() -> dict:
    """Advance desks only after the current file has finished (or VLC min dwell)."""
    from apps.core.routes.obs import _kilauea_state, _watch_from_state
    from apps.core.services.minecraft_live import mc_share, record_tick, snapshot

    watch = _watch_from_state(_kilauea_state())
    mc = snapshot()
    obs = ObsClient()
    if not await obs.connect():
        return {"ok": False, "detail": "obs_unreachable"}
    try:
        from apps.core.services.hurricane_tracker import (
            current_mode,
            ensure_mode_collection,
            hurricane_scene_pool,
        )
        from apps.core.services.kilauea_cams import kilauea_scene_pool
        import time as _time
        from apps.core.services.obs_scene_visibility import visible_pool, refresh_auto_hide

        mode = current_mode()
        coll = await ensure_mode_collection(obs)
        cur = (await obs.req("GetCurrentProgramScene")).get("currentProgramSceneName")
        if coll.get("switched"):
            return {"ok": True, "scene": cur, "held": "mode_collection", "mode": mode}

        if watch.get("erupting"):
            if cur != "Kilauea Watch":
                await obs.req("SetCurrentProgramScene", {"sceneName": "Kilauea Watch"})
            return {"ok": True, "scene": "Kilauea Watch", "held": "eruption"}
        if mc.get("ingame"):
            share = mc_share()
            if share < MC_SHARE:
                record_tick(True)
                if cur != MC_SCENE:
                    await obs.req("SetCurrentProgramScene", {"sceneName": MC_SCENE})
                return {"ok": True, "scene": MC_SCENE, "held": "minecraft", "share": share}
            record_tick(False)
        elif cur == MC_SCENE:
            await obs.req("SetCurrentProgramScene", {"sceneName": DEFAULT_START_SCENE})
            return {"ok": True, "scene": DEFAULT_START_SCENE, "held": "mc_offline"}

        from apps.core.services.obs_overlay_gen import bump_overlay_gen

        await refresh_auto_hide()
        cfg = load_rotation_config()
        dwell_mode = _sanitize_dwell((cfg.get("mode_dwell_s") or {}).get(mode), 60)
        dwell_scene = _sanitize_dwell((cfg.get("scene_dwell_s") or {}).get(cur), dwell_mode)
        dwell_s = max(MIN_DWELL_S, dwell_scene)
        st = _load_rotate()
        if st.get("scene") != cur:
            _save_rotate(cur)
            elapsed = 0.0
        else:
            elapsed = _time.time() - float(st.get("since") or _time.time())
        if elapsed < dwell_s:
            return {
                "ok": True,
                "scene": cur,
                "held": "dwell",
                "mode": mode,
                "elapsed_s": round(elapsed, 1),
                "need_s": dwell_s,
            }
        scene_list = [
            s.get("sceneName")
            for s in (await obs.req("GetSceneList")).get("scenes") or []
            if s.get("sceneName")
        ]
        if mode == "kilauea":
            base_pool = kilauea_scene_pool()
        elif mode == "hurricane":
            base_pool = hurricane_scene_pool()
        elif mode == "weather":
            base_pool = weather_scene_pool()
        else:
            base_pool = AMBIENT_SCENES
        merged_pool: list[str] = []
        for scene_name in [*base_pool, *scene_list]:
            if scene_name and scene_name not in merged_pool:
                merged_pool.append(scene_name)
        pool = visible_pool(merged_pool)
        if not pool:
            pool = [DEFAULT_START_SCENE]
        if cur not in pool:
            nxt = pool[0]
        else:
            nxt = pool[(pool.index(cur) + 1) % len(pool)]
        await obs.req("SetCurrentProgramScene", {"sceneName": nxt})
        bump_overlay_gen(nxt, "rotate")
        nxt_media, _ = SCENE_MEDIA.get(nxt, (None, None))
        if nxt_media:
            await _restart_media(obs, nxt_media)
        _save_rotate(nxt)
        return {"ok": True, "scene": nxt, "from": cur, "ingame": bool(mc.get("ingame"))}
    finally:
        await obs.close()


def _remap_media_path(old: str) -> str | None:
    """Point stale Desktop/Thumbnails paths at the live PG-13 media tree."""
    if not old:
        return None
    media = config.MEDIA_DIR
    p = Path(old)
    aliases = {
        "goalsreports.jpg": media / "images" / "thumbnails" / "goalsreports.jpg",
        "video devupdate.jpg": media / "images" / "thumbnails" / "video devupdate.jpg",
        "ava_full_statement_ara.mp3": media / "audio" / "reports" / "ava_full_statement_ara.mp3",
        "ava_intro_what_she_does_ara.mp3": media / "audio" / "reports" / "ava_intro_what_she_does_ara.mp3",
        "ava_test_intro.mp3": media / "audio" / "reports" / "ava_test_intro.mp3",
        "kilaueaappoverlay.html": media / "stream" / "overlays" / "obs-kilauea.html",
        "last lala.mp4": media / "video" / "current" / "nws-hawaii-current.mp4",
        "Ava_Lala_1600_Final_Complete.mp3": media / "audio" / "current" / "nws-hawaii-current.mp3",
        "Ava_Lala_Closing.mp3": media / "audio" / "current" / "nws-hawaii-current.mp3",
        "ava_5min_report_2026-08-17_1435.mp3": media / "audio" / "current" / "Morning_Broadcast_Current.mp3",
        "ava_account_promo_1min.mp3": media / "audio" / "reports" / "ava_intro_what_she_does_ara.mp3",
    }
    cand = aliases.get(p.name)
    if cand is not None and cand.is_file():
        return str(cand)
    if p.is_file():
        return str(p)
    return None


def _path_is_pg13(path: str) -> bool:
    name = Path(path).name.lower()
    deny = ("generated_video", "grok-video", "ava-gen-", "nsfw", "nude", "explicit", "ambient-mix")
    return not any(d in name for d in deny)


async def _retarget_collection_inputs(obs: ObsClient) -> dict:
    changed = 0
    lst = await obs.try_req("GetInputList") or {}
    for inp in lst.get("inputs") or []:
        name = inp.get("inputName")
        kind = str(inp.get("inputKind") or "")
        st = await obs.try_req("GetInputSettings", {"inputName": name}) or {}
        settings = dict(st.get("inputSettings") or {})
        dirty = False
        for key in ("file", "local_file"):
            old = str(settings.get(key) or "")
            new = _remap_media_path(old)
            if new and new != old:
                settings[key] = new
                dirty = True
        if "vlc" in kind:
            pl = settings.get("playlist") or []
            newpl = []
            for item in pl:
                val = item.get("value") if isinstance(item, dict) else str(item)
                mapped = _remap_media_path(str(val or "")) or str(val or "")
                if mapped and _path_is_pg13(mapped) and Path(mapped).is_file():
                    if isinstance(item, dict):
                        newpl.append({**item, "value": mapped, "hidden": False})
                    else:
                        newpl.append({"value": mapped, "hidden": False, "selected": False})
            if not newpl:
                newpl = [_item(p) for p in playlist_paths()[:6]]
            settings["playlist"] = newpl
            settings["loop"] = True
            dirty = True
        url = str(settings.get("url") or "")
        if "hurricanes/lala" in url:
            settings["url"] = WINDY_HURRICANE_URL
            dirty = True
        elif "radar.weather.gov" in url:
            settings["url"] = NWS_RADAR_URL
            dirty = True
        elif url.rstrip("/").endswith("Hawaii_IR_loop.gif") or "hfo/satellite" in url:
            settings["url"] = HAWAII_IR_URL
            dirty = True
        if dirty:
            await obs.try_req("SetInputSettings", {"inputName": name, "inputSettings": settings})
            changed += 1
    stretched = await _stretch_all(obs)
    return {"inputs": changed, "stretched": stretched}


async def update_all_scene_collections() -> dict:
    """Stretch, PG-13 media, and weather URLs on every OBS scene collection."""
    obs = ObsClient()
    if not await obs.connect():
        return {"ok": False, "detail": "obs_unreachable"}
    out: dict = {"ok": True, "collections": {}}
    try:
        cols = await obs.req("GetSceneCollectionList")
        names = list(cols.get("sceneCollections") or [])
        home = cols.get("currentSceneCollectionName") or COLLECTION
        for name in names:
            if name != home:
                await obs.req("SetCurrentSceneCollection", {"sceneCollectionName": name})
                await asyncio.sleep(1.8)
            if name in {"All Islands Weather", "Untitled", "test", COLLECTION}:
                await apply_weather_radar(obs)
            stats = await _retarget_collection_inputs(obs)
            scenes = [s.get("sceneName") for s in (await obs.req("GetSceneList")).get("scenes") or []]
            out["collections"][name] = {**stats, "scenes": scenes}
        if home:
            cur = (await obs.req("GetSceneCollectionList")).get("currentSceneCollectionName")
            if cur != home:
                await obs.req("SetCurrentSceneCollection", {"sceneCollectionName": home})
                await asyncio.sleep(1.2)
        out["current"] = home
        return out
    finally:
        await obs.close()

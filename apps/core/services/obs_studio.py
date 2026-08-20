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
MC_SCENE = "RootMC Live"
MC_SHARE = 0.75
AMBIENT_SCENES = [
    "Main",
    "Ambient Playlist",
    "Weather Board",
    "Kilauea Watch",
    "Solar Dashboard",
    "Economy Board",
    "Goals Report",
    "Dev Updates",
]
LOOP_SCENES = [
    *AMBIENT_SCENES,
    MC_SCENE,
]

# Primary media per scene — rotator waits for this to finish before leaving.
SCENE_MEDIA = {
    "Main": ("Daily Loop", "vlc"),
    "Ambient Playlist": ("Daily Loop", "vlc"),
    "Weather Board": ("NWS Hawaii", "ffmpeg"),
    "Kilauea Watch": ("Kilauea Audio", "ffmpeg"),
    "Solar Dashboard": ("Solar Audio", "ffmpeg"),
    "Economy Board": ("Economy Audio", "ffmpeg"),
    "Goals Report": ("Goals Video", "ffmpeg"),
    "Dev Updates": ("Dev Audio", "ffmpeg"),
    "Quake Overlay": ("Quake Loop", "ffmpeg"),
}
VLC_MIN_DWELL_S = 180
MIN_DWELL_S = 12
MAX_DWELL_S = 900


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
    """Unique videos for VLC — longer files first, then the rest of the library."""
    media = config.MEDIA_DIR
    roots = [
        media / "video" / "current",
        media / "video" / "appearance",
        media / "video" / "clips",
        media / "video" / "reports",
        media / "video" / "youtube",
    ]
    seen: set[int] = set()
    files: list[Path] = []
    for root in roots:
        if not root.is_dir():
            continue
        for p in sorted(root.glob("*.mp4")) + sorted(root.glob("*.webm")):
            try:
                sz = p.stat().st_size
            except OSError:
                continue
            if sz < 80_000 or sz in seen:
                continue
            seen.add(sz)
            files.append(p)
    mix = media / "video" / "current" / "ambient-mix.mp4"
    if mix.is_file() and mix.stat().st_size not in seen:
        files.insert(0, mix)
    # Prefer long current reports at the front of the VLC list
    def _rank(p: Path) -> tuple[int, str]:
        name = p.name.lower()
        if "morning_broadcast" in name or "ambient-mix" in name:
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
                "boundsType": "OBS_BOUNDS_SCALE_INNER",
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
            "Quake Overlay",
            "Be right back",
            "Ambient Playlist",
        ]:
            if scene not in existing_scenes:
                await obs.try_req("CreateScene", {"sceneName": scene})

        # Main — looping playlist + still + overlays + director audio
        if playlist:
            await _ensure_input(
                obs,
                "Main",
                "Daily Loop",
                "vlc_source",
                {"playlist": playlist, "loop": True, "shuffle": True},
                audio=True,
            )
            await _fit(obs, "Main", "Daily Loop")
        await _ensure_input(
            obs,
            "Main",
            "Broadcast Still",
            "image_source",
            {"file": str(bg if bg.is_file() else thumb)},
        )
        await _fit(obs, "Main", "Broadcast Still")
        await _ensure_input(
            obs,
            "Main",
            "Ava HUD",
            "browser_source",
            {
                "url": f"{origin}/obs/hud",
                "width": 1920,
                "height": 1080,
                "css": "body { background-color: rgba(0,0,0,0); margin: 0; overflow: hidden; }",
                "reroute_audio": False,
                "shutdown": False,
                "restart_when_active": False,
            },
        )
        await _fit(obs, "Main", "Ava HUD")
        await _ensure_input(
            obs,
            "Main",
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

        # Weather
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
        await _ensure_input(
            obs,
            "Weather Board",
            "Windy Hawaii",
            "browser_source",
            {
                "url": "https://www.windy.com/-Weather-radar-radar?radar,20.808,-157.736,6,p:cities",
                "width": 1920,
                "height": 1080,
                "shutdown": True,
                "restart_when_active": True,
            },
        )
        await _fit(obs, "Weather Board", "Windy Hawaii")

        # Kilauea
        await _ensure_input(
            obs,
            "Kilauea Watch",
            "HVO Kilauea",
            "browser_source",
            {
                "url": "https://www.usgs.gov/volcanoes/kilauea/webcams",
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
                },
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
        await _ensure_input(
            obs,
            "Dev Updates",
            "Dev Image",
            "image_source",
            {"file": str(dev_img if dev_img.is_file() else thumb)},
        )
        await _fit(obs, "Dev Updates", "Dev Image")
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

        if quake.is_file():
            await _ensure_input(
                obs,
                "Quake Overlay",
                "Quake Loop",
                "ffmpeg_source",
                {
                    "is_local_file": True,
                    "local_file": str(quake),
                    "looping": True,
                    "close_when_inactive": False,
                    "clear_on_media_end": False,
                },
                audio=True,
            )
            await _fit(obs, "Quake Overlay", "Quake Loop")
        await _ensure_input(
            obs,
            "Quake Overlay",
            "Quake HUD",
            "browser_source",
            {"url": f"{origin}/obs/quake-overlay", "width": 1920, "height": 1080},
        )

        await _ensure_input(
            obs,
            "Be right back",
            "BRB Still",
            "image_source",
            {"file": str(thumb)},
        )
        await _fit(obs, "Be right back", "BRB Still")

        # Ambient shares the daily loop
        if playlist:
            await _ensure_input(
                obs,
                "Ambient Playlist",
                "Daily Loop",
                "vlc_source",
                {"playlist": playlist, "loop": True, "shuffle": True},
                audio=True,
            )

            await _fit(obs, "Ambient Playlist", "Daily Loop")

        await obs.try_req("SetCurrentProgramScene", {"sceneName": "Main"})

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
    paths = playlist_paths()
    m3u = write_playlist_m3u(paths)
    playlist = [_item(p) for p in paths]
    obs = ObsClient()
    if not await obs.connect():
        return {"ok": False, "detail": "obs_unreachable", "count": len(paths)}
    try:
        await obs.req(
            "SetInputSettings",
            {
                "inputName": "Daily Loop",
                "inputSettings": {"playlist": playlist, "loop": True, "shuffle": True},
            },
        )
        await _fit(obs, "Main", "Daily Loop")
        await _fit(obs, "Ambient Playlist", "Daily Loop")
        return {"ok": True, "count": len(paths), "m3u": str(m3u), "files": [p.name for p in paths[:20]]}
    except Exception as e:
        return {"ok": False, "detail": str(e)[:240], "count": len(paths)}
    finally:
        await obs.close()


async def apply_minecraft_live(snap: dict | None = None) -> dict:
    from apps.core.services.minecraft_live import snapshot as mc_snapshot, offline_thumb

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
        await _enable_item(obs, MC_SCENE, "MC Game", ingame)
        await _enable_item(obs, MC_SCENE, "MC Offline Thumb", not ingame)
        await _enable_item(obs, MC_SCENE, "Ava Ivy Cloud", False)
        cur = (await obs.req("GetCurrentProgramScene")).get("currentProgramSceneName")
        switched = None
        if ingame and not snap.get("was_ingame") and cur != MC_SCENE:
            await obs.req("SetCurrentProgramScene", {"sceneName": MC_SCENE})
            switched = MC_SCENE
        elif (not ingame) and cur == MC_SCENE:
            await obs.req("SetCurrentProgramScene", {"sceneName": "Ambient Playlist"})
            switched = "Ambient Playlist"
        return {
            "ok": True,
            "ingame": ingame,
            "thumb": str(thumb) if thumb else None,
            "scene": switched or cur,
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
            ("Goals Report", "Goals Video", cur_v / "Morning_Broadcast_Current.mp4", True),
            ("Dev Updates", "Dev Audio", dev_cur if dev_cur.exists() else reports / "ava_intro_what_she_does_ara.mp3", False),
            ("Quake Overlay", "Quake Loop", cur_v / "earthquake-global-current.mp4", True),
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
        await _enable_item(obs, "Goals Report", "Goals Audio", False)
        await _enable_item(obs, "Goals Report", "Goals Image", False)
        await _enable_item(obs, "Goals Report", "Goals Video", True)
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
        cur = (await obs.req("GetCurrentProgramScene")).get("currentProgramSceneName")
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
            await obs.req("SetCurrentProgramScene", {"sceneName": "Ambient Playlist"})
            return {"ok": True, "scene": "Ambient Playlist", "held": "mc_offline"}

        media_name, kind = SCENE_MEDIA.get(cur, (None, None))
        import time as _time
        st = _load_rotate()
        if st.get("scene") != cur:
            _save_rotate(cur)
            elapsed = 0.0
        else:
            elapsed = _time.time() - float(st.get("since") or _time.time())
        if elapsed < MIN_DWELL_S:
            return {"ok": True, "scene": cur, "held": "min_dwell", "elapsed_s": round(elapsed, 1)}
        if elapsed < MAX_DWELL_S and media_name:
            left = await _media_remaining_s(obs, media_name)
            if kind == "vlc":
                if elapsed < VLC_MIN_DWELL_S:
                    return {
                        "ok": True,
                        "scene": cur,
                        "held": "vlc_dwell",
                        "elapsed_s": round(elapsed, 1),
                        "need_s": VLC_MIN_DWELL_S,
                    }
            elif left is None:
                if elapsed < 45:
                    return {"ok": True, "scene": cur, "held": "audio_unknown", "elapsed_s": round(elapsed, 1)}
            elif left > 1.5:
                return {
                    "ok": True,
                    "scene": cur,
                    "held": "audio",
                    "remaining_s": round(left, 1),
                    "elapsed_s": round(elapsed, 1),
                }

        pool = AMBIENT_SCENES
        if cur not in pool:
            nxt = "Ambient Playlist"
        else:
            nxt = pool[(pool.index(cur) + 1) % len(pool)]
        await obs.req("SetCurrentProgramScene", {"sceneName": nxt})
        nxt_media, _ = SCENE_MEDIA.get(nxt, (None, None))
        if nxt_media:
            await _restart_media(obs, nxt_media)
        _save_rotate(nxt)
        return {"ok": True, "scene": nxt, "from": cur, "ingame": bool(mc.get("ingame"))}
    finally:
        await obs.close()

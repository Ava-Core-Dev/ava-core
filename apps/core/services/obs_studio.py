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
LOOP_SCENES = [
    "Main",
    "Weather Board",
    "Kilauea Watch",
    "Solar Dashboard",
    "Economy Board",
    "RootMC Live",
    "Goals Report",
    "Dev Updates",
]


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
    media = config.MEDIA_DIR
    candidates = [
        media / "video" / "appearance" / "ava-gen-0.mp4",
        media / "video" / "clips" / "ava-good-morning.mp4",
        media / "video" / "appearance" / "ava-gen-1.mp4",
        media / "video" / "current" / "ara-report-current.mp4",
        media / "video" / "appearance" / "ava-gen-2.mp4",
        media / "video" / "current" / "nws-hawaii-current.mp4",
        media / "video" / "appearance" / "ava-gen-3.mp4",
        media / "video" / "current" / "earthquake-global-current.mp4",
        media / "video" / "appearance" / "peakactivity.mp4",
        media / "video" / "current" / "Morning_Broadcast_Current.mp4",
    ]
    return [p for p in candidates if p.is_file()]


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
                {"playlist": playlist, "loop": True, "shuffle": False},
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
                "url": f"{origin}/obs/hud",
                "width": 1920,
                "height": 1080,
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
                {"playlist": playlist, "loop": True},
                audio=True,
            )

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
        return {
            "ok": True,
            "collection": COLLECTION,
            "scenes": scenes,
            "playlist": [str(p) for p in playlist_paths()],
            "streaming": streaming,
            "detail": detail,
        }
    finally:
        await obs.close()


async def rotate_loop_scene() -> dict:
    """Advance Main → weather → volcano → … unless an alert is holding the desk."""
    from apps.core.routes.obs import _kilauea_state, _watch_from_state

    watch = _watch_from_state(_kilauea_state())
    obs = ObsClient()
    if not await obs.connect():
        return {"ok": False, "detail": "obs_unreachable"}
    try:
        cur = (await obs.req("GetCurrentProgramScene")).get("currentProgramSceneName")
        if watch.get("erupting"):
            if cur != "Kilauea Watch":
                await obs.req("SetCurrentProgramScene", {"sceneName": "Kilauea Watch"})
            return {"ok": True, "scene": "Kilauea Watch", "held": "eruption"}
        if cur not in LOOP_SCENES:
            await obs.req("SetCurrentProgramScene", {"sceneName": "Main"})
            return {"ok": True, "scene": "Main", "held": "reset"}
        idx = LOOP_SCENES.index(cur)
        nxt = LOOP_SCENES[(idx + 1) % len(LOOP_SCENES)]
        await obs.req("SetCurrentProgramScene", {"sceneName": nxt})
        return {"ok": True, "scene": nxt, "from": cur}
    finally:
        await obs.close()

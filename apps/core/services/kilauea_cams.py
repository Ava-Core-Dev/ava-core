"""Kīlauea Watch OBS mode: NWS radar + V1/V2/V3 USGS stills via local Ava pages.

Uses the same catalog as the Kīlauea Alerts app (Root Record live-streams API),
falls back to the official USGS V1/V2/V3 IDs, and refreshes still URLs on a timer.
OBS never loads YouTube embeds (Error 150 in CEF).
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
import urllib.request
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote

from apps.core import config

log = logging.getLogger("ava.kilauea_cams")

KILAUEA_COLLECTION = "Ava Kilauea Watch"
KILAUEA_DWELL_S = 32
UA = "AvaIvy/2.0 (https://avaivy.cloud; kilauea-cams)"
CATALOG_URLS = (
    "https://api.rootrecord.online/api/mobile/kilauea-live-streams",
    "https://rootrecord-api-kilauea.root-337.workers.dev/api/mobile/kilauea-live-streams",
)
STATE_PATH = config.DATA_DIR / "state" / "kilauea-cams.json"
YOUTUBE_Q = "autoplay=1&mute=1&playsinline=1&rel=0&modestbranding=1"
KV_HAZARD_SCENES = [
    ("KV · SO2", "KV SO2", "so2"),
    ("KV · Vog", "KV Vog", "vog"),
    ("KV · Windy", "KV Windy", "windy"),
]

# Same offline defaults as Kīlauea Alerts LiveFeedsRepository.
DEFAULT_CAMS = [
    {
        "id": "usgs_v1",
        "title": "[V1cam] West Halemaʻumaʻu",
        "youtube_video_id": "HggWKlZv9yk",
        "still": "https://volcanoes.usgs.gov/observatories/hvo/cams/V1cam/images/M.jpg",
        "scene": "KV · V1",
        "input": "KV Cam V1",
    },
    {
        "id": "usgs_v2",
        "title": "[V2cam] North Halemaʻumaʻu",
        "youtube_video_id": "Tz5tPqRRv1Y",
        "still": "https://volcanoes.usgs.gov/observatories/hvo/cams/V2cam/images/M.jpg",
        "scene": "KV · V2",
        "input": "KV Cam V2",
    },
    {
        "id": "usgs_v3",
        "title": "[V3cam] Halemaʻumaʻu lava lake",
        "youtube_video_id": "gXKuUyKt8mc",
        "still": "https://volcanoes.usgs.gov/observatories/hvo/cams/V3cam/images/M.jpg",
        "scene": "KV · V3",
        "input": "KV Cam V3",
    },
]


def _get(url: str, timeout: float = 12) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", "replace")


def _embed(video_id: str) -> str:
    vid = (video_id or "").strip()
    if vid.lower().startswith("live:"):
        ch = vid.split(":", 1)[1]
        return f"https://www.youtube.com/embed/live_stream?channel={quote(ch)}&{YOUTUBE_Q}"
    return f"https://www.youtube.com/embed/{quote(vid)}?{YOUTUBE_Q}"


def obs_cam_url(cam_id: str) -> str:
    """Local browser source URL — USGS still page served from this Ava desk."""
    return f"http://127.0.0.1:{config.AVA_PORT}/obs/kilauea-cam?cam={quote(cam_id)}"


def _obs_url_for_cam(row: dict) -> str:
    return obs_cam_url(str(row.get("id") or "usgs_v1"))


def _still(url: str) -> str:
    return f"{url}?t={int(time.time())}"


def _video_id_from_watch(html: str, fallback: str) -> str:
    live = re.search(r'"isLive(?:Content|Now)?"\s*:\s*true', html, re.I)
    ids = re.findall(r'"videoId"\s*:\s*"([\w-]{11})"', html)
    if live and ids:
        return ids[0]
    can = re.search(r'rel="canonical" href="https://www\.youtube\.com/watch\?v=([\w-]{11})"', html)
    if can:
        return can.group(1)
    return fallback


def _resolve_youtube(video_id: str) -> tuple[str, bool]:
    """Return (id, looks_live). Keep the known id if the watch page is unreachable."""
    vid = (video_id or "").strip()
    if not vid or vid.lower().startswith("live:"):
        return vid, True
    try:
        html = _get(f"https://www.youtube.com/watch?v={vid}")
    except Exception as e:
        log.info("youtube resolve %s: %s", vid, e)
        return vid, False
    if "UNPLAYABLE" in html or '"status":"ERROR"' in html:
        fresh = _video_id_from_watch(html, vid)
        return fresh, '"isLive' in html
    fresh = _video_id_from_watch(html, vid)
    live = bool(re.search(r'"isLive(?:Content|Now)?"\s*:\s*true', html, re.I))
    return fresh, live


async def refresh_catalog() -> dict:
    remote: list[dict] = []
    source = "default"
    for url in CATALOG_URLS:
        try:
            raw = await asyncio.to_thread(_get, url)
            data = json.loads(raw)
            remote = list(data.get("streams") or [])
            if remote:
                source = url
                break
        except Exception as e:
            log.info("kilauea catalog %s: %s", url, e)

    by_id = {str(s.get("id") or ""): s for s in remote}
    cams = []
    for base in DEFAULT_CAMS:
        row = dict(base)
        ext = by_id.get(base["id"]) or {}
        if ext.get("youtube_video_id"):
            row["youtube_video_id"] = str(ext["youtube_video_id"]).strip()
        if ext.get("embed_url"):
            row["embed_url_remote"] = ext["embed_url"]
        if ext.get("title"):
            row["title"] = ext["title"]
        vid, live = await asyncio.to_thread(_resolve_youtube, row["youtube_video_id"])
        row["youtube_video_id"] = vid
        row["live"] = live
        row["still_url"] = _still(row["still"])
        if live and vid:
            row["url"] = row.get("embed_url_remote") or _embed(vid)
            row["kind"] = "youtube"
        else:
            row["url"] = row["still_url"]
            row["kind"] = "still"
        row["obs_url"] = _obs_url_for_cam(row)
        cams.append(row)

    from apps.core.services.obs_studio import NWS_RADAR_URL

    payload = {
        "ok": True,
        "ts": datetime.now(timezone.utc).isoformat(),
        "source": source,
        "radar": NWS_RADAR_URL,
        "cams": cams,
        "scenes": ["KV · Radar"]
        + [s[0] for s in KV_HAZARD_SCENES]
        + [c["scene"] for c in cams],
        "featured": cams[0]["id"] if cams else "usgs_v1",
    }
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(payload, indent=2))
    return payload


def load_catalog() -> dict:
    if STATE_PATH.is_file():
        try:
            return json.loads(STATE_PATH.read_text())
        except Exception:
            pass
    return {
        "cams": DEFAULT_CAMS,
        "scenes": ["KV · Radar"] + [s[0] for s in KV_HAZARD_SCENES] + [c["scene"] for c in DEFAULT_CAMS],
    }


def kilauea_scene_pool() -> list[str]:
    from apps.core.services.nhc_media import nhc_outlook_scenes

    cams = [c["scene"] for c in DEFAULT_CAMS]
    hazards = [s[0] for s in KV_HAZARD_SCENES]
    saved = list(load_catalog().get("scenes") or [])
    ordered = ["KV · Radar", *nhc_outlook_scenes(), *hazards, *cams]
    for s in saved:
        if s not in ordered:
            ordered.append(s)
    return ordered


async def _browser(obs, scene: str, name: str, url: str) -> None:
    from apps.core.services.obs_studio import _ensure_input, _fit

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
            "css": "body { margin: 0; overflow: hidden; background: #000; }",
        },
    )
    await _fit(obs, scene, name)


async def apply_kilauea_kit(obs: Any | None = None) -> dict:
    from apps.core.services.obs_studio import (
        ObsClient,
        _stretch_all,
        NWS_RADAR_URL,
        HI_SO2_URL,
        HI_VOG_URL,
        WINDY_KILAUEA_URL,
    )

    data = await refresh_catalog()
    own = obs is None
    if own:
        obs = ObsClient()
        if not await obs.connect():
            return {"ok": False, "detail": "obs_unreachable"}
    origin = f"http://127.0.0.1:{config.AVA_PORT}"
    try:
        cols = await obs.req("GetSceneCollectionList")
        names = cols.get("sceneCollections") or []
        if KILAUEA_COLLECTION not in names:
            await obs.req("CreateSceneCollection", {"sceneCollectionName": KILAUEA_COLLECTION})
            await asyncio.sleep(1.6)
        elif cols.get("currentSceneCollectionName") != KILAUEA_COLLECTION:
            await obs.req("SetCurrentSceneCollection", {"sceneCollectionName": KILAUEA_COLLECTION})
            await asyncio.sleep(1.5)

        existing = {s.get("sceneName") for s in (await obs.req("GetSceneList")).get("scenes") or []}
        if "KV · Radar" not in existing:
            await obs.try_req("CreateScene", {"sceneName": "KV · Radar"})
        await _browser(obs, "KV · Radar", "KV Radar", data.get("radar") or NWS_RADAR_URL)
        await _browser(
            obs,
            "KV · Radar",
            "KV Overlay Radar",
            f"{origin}/obs/kilauea-desk?cam=radar",
        )

        hazard_urls = {"so2": HI_SO2_URL, "vog": HI_VOG_URL, "windy": WINDY_KILAUEA_URL}
        for scene, inp, cam in KV_HAZARD_SCENES:
            if scene not in existing:
                await obs.try_req("CreateScene", {"sceneName": scene})
            await _browser(obs, scene, inp, hazard_urls[cam])
            await _browser(
                obs,
                scene,
                f"KV Overlay {cam}",
                f"{origin}/obs/kilauea-desk?cam={cam}",
            )

        for cam in data.get("cams") or []:
            scene = cam["scene"]
            if scene not in existing:
                await obs.try_req("CreateScene", {"sceneName": scene})
            await _browser(obs, scene, cam["input"], cam.get("obs_url") or _obs_url_for_cam(cam))
            await _browser(
                obs,
                scene,
                f"KV Overlay {cam['id']}",
                f"{origin}/obs/kilauea-desk?cam={cam['id']}",
            )

        from apps.core.services.nhc_media import apply_nhc_obs_scenes

        await apply_nhc_obs_scenes(obs)
        await _stretch_all(obs)
        await obs.try_req("SetCurrentProgramScene", {"sceneName": "KV · V1"})
        from apps.core.services.hurricane_tracker import write_mode

        write_mode("kilauea", {"cams": [c["id"] for c in data.get("cams") or []]})
        return {
            "ok": True,
            "collection": KILAUEA_COLLECTION,
            "cams": [
                {"id": c["id"], "kind": c.get("kind"), "video": c.get("youtube_video_id"), "live": c.get("live")}
                for c in data.get("cams") or []
            ],
            "scenes": data.get("scenes"),
        }
    finally:
        if own:
            await obs.close()


async def push_embeds_to_current_collection() -> dict:
    """Update cam URLs on whatever collection is open (no collection switch)."""
    from apps.core.services.obs_studio import ObsClient

    data = await refresh_catalog()
    obs = ObsClient()
    if not await obs.connect():
        return {"ok": False, "detail": "obs_unreachable"}
    changed = 0
    try:
        v1 = next((c for c in data.get("cams") or [] if c["id"] == "usgs_v1"), None)
        lst = await obs.try_req("GetInputList") or {}
        names = {i.get("inputName") for i in lst.get("inputs") or []}
        mapping = {}
        if v1:
            obs_url = v1.get("obs_url") or _obs_url_for_cam(v1)
            mapping["HVO Kilauea"] = obs_url
            mapping["KV Cam V1"] = obs_url
        for cam in data.get("cams") or []:
            mapping[cam["input"]] = cam.get("obs_url") or _obs_url_for_cam(cam)
        if data.get("radar"):
            mapping["KV Radar"] = data["radar"]
        for name, url in mapping.items():
            if name not in names:
                continue
            st = await obs.try_req("GetInputSettings", {"inputName": name}) or {}
            settings = dict(st.get("inputSettings") or {})
            if settings.get("url") != url:
                settings["url"] = url
                await obs.try_req("SetInputSettings", {"inputName": name, "inputSettings": settings})
                changed += 1
        return {"ok": True, "changed": changed, "cams": data.get("cams")}
    finally:
        await obs.close()

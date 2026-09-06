"""Official NHC/NWS graphics, HLS text, archive, OBS scenes, and audio."""

from __future__ import annotations

import hashlib
import json
import logging
import re
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests

from apps.core import config

log = logging.getLogger("ava.official_weather_media")
UA = "AvaIvy/2.0 official NHC NWS media"
ROOT = config.PUBLIC_MEDIA / "images" / "weather" / "official"
ARCHIVE = ROOT / "archive"
ZIP_PATH = ARCHIVE / "official_weather_archive.zip"
STATE_PATH = config.DATA_DIR / "state" / "official-weather-media.json"
HLS_URL = "https://www.weather.gov/hfo/HLS"

ASSETS = {
    "nhc_cpac_7day": ("https://www.nhc.noaa.gov/gtwo.php?basin=cpac&fdays=7", "page"),
    "nhc_epac_7day": ("https://www.nhc.noaa.gov/gtwo.php?basin=epac&fdays=7", "page"),
    "nhc_atlc_7day": ("https://www.nhc.noaa.gov/gtwo.php?basin=atlc&fdays=7", "page"),
    "nhc_epac_2day": ("https://www.nhc.noaa.gov/gtwo.php?basin=epac&fdays=2", "page"),
    "nhc_cpac_2day": ("https://www.nhc.noaa.gov/gtwo.php?basin=cpac&fdays=2", "page"),
    "hfo_watch_warning_map": ("https://www.weather.gov/wwamap/png/hfo.png", "png"),
    "hawaii_ir_loop": ("https://www.weather.gov/images/hfo/satellite/Hawaii_IR_loop.gif", "gif"),
    "north_pacific_graphic": ("https://www.weather.gov/images/hfo/graphics/npac.gif", "gif"),
}

SCENES = tuple((f"Official · {slug}", slug) for slug in ASSETS)


def _current(slug: str, kind: str) -> Path:
    suffix = ".html" if kind == "page" else f".{kind}"
    path = ROOT / f"{slug}-current{suffix}"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _save_state(payload: dict) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def _clean_hls(text: str) -> str:
    text = text.replace("$", "").replace("&", "and")
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n\n", text)
    return text.strip()[:14000] + "\n"


def _hls_statement(html: str) -> str:
    match = re.search(r'["\']([^"\']*HLS[^"\']*\.xml)["\']', html, re.I)
    feed_url = "https://www.weather.gov" + match.group(1) if match and match.group(1).startswith("/") else (match.group(1) if match else "")
    if feed_url:
        try:
            feed = requests.get(feed_url, headers={"User-Agent": UA}, timeout=45)
            feed.raise_for_status()
            text = re.sub(r"<[^>]+>", " ", feed.text)
            return _clean_hls(text)
        except Exception as exc:
            log.warning("HLS XML fetch failed: %s", exc)
    text = re.sub(r"<script.*?</script>|<style.*?</style>", " ", html, flags=re.I | re.S)
    return _clean_hls(re.sub(r"<[^>]+>", " ", text))


def _archive(files: dict[str, bytes]) -> None:
    ARCHIVE.mkdir(parents=True, exist_ok=True)
    entries: dict[str, bytes] = {}
    if ZIP_PATH.is_file():
        with zipfile.ZipFile(ZIP_PATH) as old:
            entries = {n: old.read(n) for n in old.namelist()}
    entries.update(files)
    temp = ZIP_PATH.with_suffix(".zip.tmp")
    with zipfile.ZipFile(temp, "w", zipfile.ZIP_DEFLATED) as out:
        for name, data in sorted(entries.items()):
            out.writestr(name, data)
    temp.replace(ZIP_PATH)


def _write_audio(text: str) -> dict:
    dest = config.GENERATED_DIR / "NWS_Official_statement.wav"
    try:
        from apps.core.services import api_ledger, xai

        allowed, _ = api_ledger.may_spend("xai")
        if allowed and not xai.grok_is_down():
            xai.tts(text, dest)
            return {"ok": True, "engine": "cloud", "path": str(dest)}
    except Exception as exc:
        log.warning("official HLS cloud voice failed: %s", exc)
    try:
        from apps.voice.local_tts import speak_script

        result = speak_script(text, dest)
        return {"ok": bool(result.get("ok")), "engine": "local", "path": str(dest), "detail": result.get("detail")}
    except Exception as exc:
        return {"ok": False, "engine": "local", "detail": str(exc)[:240]}


def run() -> dict:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    downloaded = {}
    current = {}
    errors = {}
    for slug, (url, kind) in ASSETS.items():
        try:
            response = requests.get(url, headers={"User-Agent": UA}, timeout=45)
            response.raise_for_status()
            data = response.content
            ext = "html" if kind == "page" else kind
            dated_name = f"{slug}-{stamp}.{ext}"
            ARCHIVE.mkdir(parents=True, exist_ok=True)
            _current(slug, kind).write_bytes(data)
            (ARCHIVE / dated_name).write_bytes(data)
            downloaded[slug] = {"url": url, "bytes": len(data), "current": str(_current(slug, kind))}
            current[slug] = str(_current(slug, kind))
        except Exception as exc:
            errors[slug] = str(exc)[:240]

    try:
        hls_response = requests.get(HLS_URL, headers={"User-Agent": UA}, timeout=45)
        hls_response.raise_for_status()
        hls_text = _hls_statement(hls_response.text)
        hls_path = config.REPORTS_DIR / "NWS_Official_statement.txt"
        prior = hls_path.read_text(encoding="utf-8") if hls_path.is_file() else ""
        changed = hashlib.sha256(prior.encode()).hexdigest() != hashlib.sha256(hls_text.encode()).hexdigest()
        hls_path.write_text(hls_text, encoding="utf-8")
        audio = _write_audio(hls_text) if changed else {"ok": True, "skipped": True, "detail": "unchanged"}
    except Exception as exc:
        hls_text = ""
        changed = False
        audio = {"ok": False, "detail": str(exc)[:240]}
        errors["hls"] = str(exc)[:240]

    archive_files = {}
    for slug, (url, kind) in ASSETS.items():
        path = _current(slug, kind)
        if path.is_file():
            archive_files[f"{slug}-{stamp}{path.suffix}"] = path.read_bytes()
    if archive_files:
        _archive(archive_files)
    payload = {
        "ok": not errors,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "downloaded": downloaded,
        "current": current,
        "archive_zip": str(ZIP_PATH),
        "hls": {"url": HLS_URL, "changed": changed, "audio": audio},
        "errors": errors,
    }
    _save_state(payload)
    return payload


async def apply_obs_scenes() -> dict:
    from apps.core.services.obs_studio import ObsClient, _ensure_input, _fit, save_rotation_config

    obs = ObsClient()
    if not await obs.connect():
        return {"ok": False, "detail": "obs_unreachable"}
    created = []
    try:
        existing = {s.get("sceneName") for s in (await obs.req("GetSceneList")).get("scenes") or []}
        dwell = {}
        for scene, slug in SCENES:
            if scene not in existing:
                await obs.try_req("CreateScene", {"sceneName": scene})
            url, kind = ASSETS[slug]
            name = f"Official {slug}"
            current = _current(slug, kind)
            if kind == "page":
                source_url = f"http://127.0.0.1:8787/obs/official/{slug}" if current.is_file() else url
                await _ensure_input(obs, scene, name, "browser_source", {"url": source_url, "width": 1920, "height": 1080, "shutdown": True, "restart_when_active": True})
            else:
                await _ensure_input(obs, scene, name, "image_source", {"file": str(current), "unload": False})
            await _fit(obs, scene, name)
            await _ensure_input(
                obs,
                scene,
                "Ava Speaking Overlay",
                "browser_source",
                {
                    "url": "http://127.0.0.1:8787/obs/speaking-overlay",
                    "width": 1920,
                    "height": 1080,
                    "shutdown": False,
                    "restart_when_active": False,
                    "css": "body { margin: 0; overflow: hidden; background: transparent; }",
                },
            )
            await _fit(obs, scene, "Ava Speaking Overlay")
            created.append(scene)
            dwell[scene] = 10
        save_rotation_config(mode_dwell_s={"official": 10}, scene_dwell_s=dwell)
        return {"ok": True, "scenes": created, "dwell_s": 10}
    finally:
        await obs.close()

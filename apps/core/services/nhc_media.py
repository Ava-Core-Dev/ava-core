"""Pull official NHC / CPHC forecast graphics, GIFs, text, and GIS into media + data.

Sources:
  https://www.nhc.noaa.gov/?cpac
  https://www.nhc.noaa.gov/refresh/graphics_{bin}+shtml/  (every product tab)
  https://www.nhc.noaa.gov/CurrentStorms.json
  https://www.nhc.noaa.gov/gis/forecast/archive/{id}_fcst_latest.zip
"""

from __future__ import annotations

import json
import logging
import re
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx

from apps.core import config

log = logging.getLogger("ava.nhc_media")

BASE = "https://www.nhc.noaa.gov"
STORMS_URL = f"{BASE}/CurrentStorms.json"
CPAC_HOME = f"{BASE}/?cpac"
UA = "AvaIvy/2.0 (https://avaivy.cloud; nhc-media)"
GRAPHIC_TABS = (
    "cone",
    "wwCone",
    "expCone",
    "expIntCone",
    "gm_track",
    "mltoa34",
    "radii",
    "swath",
    "tswind120",
    "windhist",
    "wind34",
    "wind50",
    "wind64",
)
SKIP_RE = re.compile(
    r"/css/|/gifs/xml|/gifs/gmap|usa_gov|f_logo|w_logo|youtube_logo|skipgraphic|"
    r"key_messages|\(none\)",
    re.I,
)
IMG_RE = re.compile(
    r"""(?:src|href)=["']([^"']+\.(?:gif|png|jpe?g|webp)(?:\?[^"']*)?)""",
    re.I,
)
STABLE_MAP = (
    ("5day_cone", "5day_cone"),
    ("3day_cone", "3day_cone"),
    ("5day_expCone", "5day_exp_cone"),
    ("current_wind", "current_wind"),
    ("wind_history", "wind_history"),
    ("earliest_reasonable_toa", "toa_34"),
    ("wind_probs_64", "wsp_64"),
    ("wind_probs_50", "wsp_50"),
    ("wind_probs_34", "wsp_34"),
)
XGTWO_STABLE = (
    ("xgtwo_cpac_2d0_w1920", "cpac_2day"),
    ("xgtwo_cpac_7d0_w1920", "cpac_7day"),
    ("xgtwo_pac_2d0_w1920", "epac_2day"),
    ("xgtwo_pac_7d0_w1920", "epac_7day"),
    ("xgtwo_atl_2d0_w1920", "atl_2day"),
    ("xgtwo_atl_7d0_w1920", "atl_7day"),
)


def media_current() -> Path:
    p = config.MEDIA_DIR / "images" / "nhc" / "current"
    p.mkdir(parents=True, exist_ok=True)
    return p


def media_archive() -> Path:
    p = config.MEDIA_DIR / "images" / "nhc" / "archive"
    p.mkdir(parents=True, exist_ok=True)
    return p


def data_root() -> Path:
    p = config.DATA_DIR / "nhc"
    p.mkdir(parents=True, exist_ok=True)
    return p


def manifest_path() -> Path:
    return config.DATA_DIR / "state" / "nhc-media.json"


def load_manifest() -> dict:
    p = manifest_path()
    if p.is_file():
        try:
            return json.loads(p.read_text())
        except Exception:
            return {}
    return {}


def current_files() -> dict[str, Path]:
    root = media_current()
    return {p.stem: p for p in root.iterdir() if p.is_file()}


def _abs(url: str) -> str:
    return urljoin(BASE + "/", url.split()[0].strip())


def _ok_media(url: str) -> bool:
    if SKIP_RE.search(url):
        return False
    path = urlparse(url).path.lower()
    return any(x in path for x in ("storm_graphics", "/xgtwo/", "/refresh/"))


async def _get(client: httpx.AsyncClient, url: str) -> httpx.Response | None:
    try:
        r = await client.get(url, follow_redirects=True, timeout=30)
        if r.status_code == 200 and r.content:
            return r
        log.info("NHC %s %s", r.status_code, url)
    except Exception as e:
        log.warning("NHC fetch %s: %s", url, e)
    return None


def _urls_from_html(html: str) -> set[str]:
    out = set()
    for raw in IMG_RE.findall(html):
        u = _abs(raw)
        if _ok_media(u):
            out.add(u.split("?")[0])
    return out


def _fullsize_guess(url: str) -> str | None:
    if "_sm+" in url:
        return url.replace("_sm+", "+").replace("_sm.", ".")
    if "_sm." in url:
        return url.replace("_sm.", ".")
    return None


def _stable_name(url: str) -> str | None:
    path = urlparse(url).path
    name = Path(path).name
    for needle, slug in XGTWO_STABLE:
        if needle in path:
            return f"{slug}.png"
    storm = re.search(r"/(CP|EP|AL)(\d{2})(\d{4})_", path, re.I)
    prefix = ""
    if storm:
        prefix = f"{storm.group(1).lower()}{storm.group(2)}{storm.group(3)}_"
    for needle, slug in STABLE_MAP:
        if needle in path or needle in name:
            ext = Path(name).suffix or ".png"
            return f"{prefix}{slug}{ext}"
    return None


async def _save_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(data)
    tmp.replace(path)


async def _download_image(client: httpx.AsyncClient, url: str, saved: list[dict]) -> None:
    r = await _get(client, url)
    if not r:
        return
    ctype = (r.headers.get("content-type") or "").lower()
    if "html" in ctype:
        return
    name = Path(urlparse(url).path).name or "graphic.png"
    if not Path(name).suffix:
        name += ".png"
    arch = media_archive() / name
    await _save_bytes(arch, r.content)
    rec = {"url": url, "archive": str(arch), "bytes": len(r.content)}
    # Thumbnails are 60px nav icons — keep in archive only.
    if "_sm" in urlparse(url).path or len(r.content) < 8_000:
        saved.append(rec)
        return
    stable = _stable_name(url)
    if stable:
        dest = media_current() / stable
        await _save_bytes(dest, r.content)
        rec["current"] = str(dest)
    saved.append(rec)


async def _pull_gis(client: httpx.AsyncClient, url: str, dest_dir: Path) -> dict | None:
    r = await _get(client, url)
    if not r:
        return None
    dest_dir.mkdir(parents=True, exist_ok=True)
    fname = Path(urlparse(url).path).name or "latest.zip"
    zpath = dest_dir / fname
    await _save_bytes(zpath, r.content)
    extracted: list[str] = []
    try:
        with zipfile.ZipFile(zpath) as zf:
            zf.extractall(dest_dir / zpath.stem)
            extracted = zf.namelist()[:80]
    except zipfile.BadZipFile:
        log.warning("not a zip %s", url)
    return {"url": url, "path": str(zpath), "files": extracted, "bytes": len(r.content)}


async def _pull_text(client: httpx.AsyncClient, url: str, dest: Path) -> None:
    r = await _get(client, url)
    if not r:
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(r.content)


async def ingest() -> dict[str, Any]:
    """Download latest official NHC CPAC + active-storm graphics/GIS/text."""
    saved: list[dict] = []
    gis: list[dict] = []
    pages = 0
    headers = {"User-Agent": UA, "Accept": "*/*"}
    async with httpx.AsyncClient(headers=headers) as client:
        storms_r = await _get(client, STORMS_URL)
        storms = []
        if storms_r:
            try:
                storms = (storms_r.json() or {}).get("activeStorms") or []
            except Exception:
                storms = []
            (data_root() / "CurrentStorms.json").write_bytes(storms_r.content)

        home = await _get(client, CPAC_HOME)
        urls: set[str] = set()
        if home:
            pages += 1
            urls |= _urls_from_html(home.text)
            (data_root() / "pages").mkdir(parents=True, exist_ok=True)
            (data_root() / "pages" / "cpac.html").write_bytes(home.content)

        bins = []
        for s in storms:
            bin_no = str(s.get("binNumber") or "").lower()
            if bin_no:
                bins.append(bin_no)
            sid = str(s.get("id") or "").lower()
            # Stable GIS alias the operator named, plus advisory-numbered copies.
            gis_urls = [
                f"{BASE}/gis/forecast/archive/{sid}_fcst_latest.zip",
                ((s.get("forecastWindRadiiGIS") or {}).get("zipFile")),
                ((s.get("trackCone") or {}).get("zipFile")),
                ((s.get("bestTrackGIS") or {}).get("zipFile")),
                ((s.get("windSpeedProbabilitiesGIS") or {}).get("zipFile5km")),
            ]
            for g in gis_urls:
                if g:
                    got = await _pull_gis(client, g, data_root() / "gis" / sid)
                    if got:
                        gis.append(got)
            for key, fname in (
                ("publicAdvisory", "advisory.html"),
                ("forecastDiscussion", "discussion.html"),
                ("forecastAdvisory", "forecast.html"),
                ("windSpeedProbabilities", "wind-probs.html"),
            ):
                u = (s.get(key) or {}).get("url")
                if u:
                    await _pull_text(client, u, data_root() / "text" / sid / fname)

        if not bins:
            bins = ["cp2"]

        for bin_no in bins:
            graphics = f"{BASE}/refresh/graphics_{bin_no}+shtml/"
            for tab in ("", *GRAPHIC_TABS):
                url = graphics if not tab else f"{graphics}?{tab}"
                r = await _get(client, url)
                if not r:
                    continue
                pages += 1
                urls |= _urls_from_html(r.text)
            # canonical non-refresh page too
            r = await _get(client, f"{BASE}/graphics_{bin_no}.shtml")
            if r:
                pages += 1
                urls |= _urls_from_html(r.text)

        extra = set()
        for u in list(urls):
            guess = _fullsize_guess(u)
            if guess and guess not in urls:
                extra.add(guess)
        urls |= extra

        for u in sorted(urls):
            await _download_image(client, u, saved)

    files = {k: str(v) for k, v in current_files().items()}
    payload = {
        "ok": True,
        "ts": datetime.now(timezone.utc).isoformat(),
        "pages": pages,
        "downloaded": len(saved),
        "gis": gis,
        "current": files,
        "items": saved[-80:],
    }
    manifest_path().parent.mkdir(parents=True, exist_ok=True)
    manifest_path().write_text(json.dumps(payload, indent=2))
    log.info("NHC media pages=%s files=%s current=%s", pages, len(saved), list(files))
    return payload


async def apply_nhc_obs_scenes(obs=None) -> dict:
    """Put latest NHC stills on the open OBS collection as dedicated scenes."""
    from apps.core.services.obs_studio import ObsClient, _ensure_input, _fit

    files = current_files()
    own = obs is None
    if own:
        obs = ObsClient()
        if not await obs.connect():
            return {"ok": False, "detail": "obs_unreachable"}
    scenes = [
        ("NHC · CPAC 2-Day", "NHC CPAC 2Day", files.get("cpac_2day")),
        ("NHC · CPAC 7-Day", "NHC CPAC 7Day", files.get("cpac_7day")),
        ("NHC · 5-Day Cone", "NHC 5Day Cone", _first(files, "_5day_cone")),
        ("NHC · Wind Field", "NHC Wind", _first(files, "_current_wind")),
        ("NHC · Wind History", "NHC Wind History", _first(files, "_wind_history")),
    ]
    created = []
    try:
        existing = {s.get("sceneName") for s in (await obs.req("GetSceneList")).get("scenes") or []}
        for scene, name, path in scenes:
            if not path or not path.is_file():
                continue
            if scene not in existing:
                await obs.try_req("CreateScene", {"sceneName": scene})
            await _ensure_input(
                obs,
                scene,
                name,
                "image_source",
                {"file": str(path), "unload": False},
            )
            await _fit(obs, scene, name)
            created.append(scene)
        return {"ok": True, "scenes": created, "files": {k: str(v) for k, v in files.items()}}
    finally:
        if own:
            await obs.close()


def _first(files: dict[str, Path], needle: str) -> Path | None:
    for k, p in files.items():
        if needle in k:
            return p
    return None


def nhc_scene_names() -> list[str]:
    return [
        "NHC · CPAC 2-Day",
        "NHC · CPAC 7-Day",
        "NHC · 5-Day Cone",
        "NHC · Wind Field",
        "NHC · Wind History",
    ]

"""Worldwide tropical cyclone slides for OBS Hurricane Tracker mode.

NHC CurrentStorms covers Atlantic / EPac / CPac. RAMMB + JTWC fill the rest
of the globe. Florida and Hawaiʻi always get their own boards and rank first.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import math
import re
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

from apps.core import config

log = logging.getLogger("ava.hurricane")

HURRICANE_COLLECTION = "Ava Hurricane Tracker"
UA = "AvaIvy/2.0 (https://avaivy.cloud; hurricane-tracker)"
NHC_URL = "https://www.nhc.noaa.gov/CurrentStorms.json"
RAMMB_URL = "https://rammb-data.cira.colostate.edu/tc_realtime/"
RAMMB_STORM = "https://rammb-data.cira.colostate.edu/tc_realtime/storm.asp?storm_identifier={id}"
JTWC_ABPW = "https://www.metoc.navy.mil/jtwc/products/abpwweb.txt"
JTWC_ABIO = "https://www.metoc.navy.mil/jtwc/products/abioweb.txt"

FLORIDA = {
    "Miami": (25.7617, -80.1918),
    "Tampa": (27.9506, -82.4572),
    "Key West": (24.5551, -81.7800),
    "Jacksonville": (30.3322, -81.6557),
}
HAWAII = {
    "Honolulu": (21.3069, -157.8583),
    "Hilo": (19.7297, -155.0900),
    "Līhuʻe": (21.9811, -159.3711),
    "Kona": (19.6390, -155.9969),
}

MODE_PATH = config.DATA_DIR / "state" / "obs-mode.json"
STORMS_PATH = config.DATA_DIR / "state" / "hurricanes.json"

BOARD_SCENES = [
    ("HT · Florida", "florida"),
    ("HT · Hawaii", "hawaii"),
    ("HT · World", "world"),
]


def _mode_path() -> Path:
    MODE_PATH.parent.mkdir(parents=True, exist_ok=True)
    return MODE_PATH


def current_mode() -> str:
    p = _mode_path()
    if not p.is_file():
        return "daily"
    try:
        mode = str(json.loads(p.read_text()).get("mode") or "daily").lower()
    except Exception:
        return "daily"
    if mode in {"hurricane", "hurricanes", "tracker"}:
        return "hurricane"
    if mode in {"kilauea", "volcano", "kv"}:
        return "kilauea"
    if mode in {"weather", "wx", "noaa"}:
        return "weather"
    return "daily"


def write_mode(mode: str, extra: dict | None = None) -> dict:
    raw = str(mode or "daily").lower()
    if raw in {"hurricane", "hurricanes", "tracker"}:
        stored = "hurricane"
    elif raw in {"kilauea", "volcano", "kv"}:
        stored = "kilauea"
    elif raw in {"weather", "wx", "noaa"}:
        stored = "weather"
    else:
        stored = "daily"
    payload = {
        "mode": stored,
        "ts": datetime.now(timezone.utc).isoformat(),
        **(extra or {}),
    }
    _mode_path().write_text(json.dumps(payload, indent=2))
    return payload


def hurricane_scene_pool() -> list[str]:
    from apps.core.services.nhc_media import nhc_scene_names

    data = load_storms()
    scenes = [s for s, _ in BOARD_SCENES] + nhc_scene_names()
    for st in data.get("storms") or []:
        name = st.get("scene")
        if name:
            scenes.append(name)
    return scenes or [s for s, _ in BOARD_SCENES]


def load_storms() -> dict:
    if STORMS_PATH.is_file():
        try:
            return json.loads(STORMS_PATH.read_text())
        except Exception:
            pass
    return {"ok": False, "storms": [], "ts": None}


def _get(url: str, timeout: float = 14) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", "replace")


def _haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371.0 * 2 * math.asin(min(1.0, math.sqrt(h)))


def _nm(km: float) -> float:
    return km * 0.539957


def _parse_latlon(lat: str | float | None, lon: str | float | None) -> tuple[float | None, float | None]:
    if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
        return float(lat), float(lon)

    def one(val: str | None, pos: str, neg: str) -> float | None:
        if not val:
            return None
        s = str(val).strip().upper().replace(" ", "")
        m = re.match(r"^([+-]?\d+(?:\.\d+)?)([NSEW])?$", s)
        if not m:
            return None
        n = float(m.group(1))
        hemi = m.group(2)
        if hemi in {neg}:
            n = -abs(n)
        elif hemi in {pos}:
            n = abs(n)
        return n

    return one(str(lat) if lat is not None else None, "N", "S"), one(
        str(lon) if lon is not None else None, "E", "W"
    )


def _class_label(code: str, knots: int | None, text: str = "") -> str:
    blob = f"{code} {text}".upper()
    kt = knots or 0
    if "INVEST" in blob:
        return "Invest"
    if kt >= 137 or "CAT 5" in blob or "CATEGORY 5" in blob:
        return "Category 5 hurricane"
    if kt >= 113 or "CAT 4" in blob:
        return "Category 4 hurricane"
    if kt >= 96 or "CAT 3" in blob or "MAJOR" in blob:
        return "Major hurricane"
    if kt >= 83 or "CAT 2" in blob:
        return "Category 2 hurricane"
    if kt >= 64 or code in {"HU", "TY", "MH"} or "HURRICANE" in blob or "TYPHOON" in blob:
        return "Hurricane" if "TYPHOON" not in blob else "Typhoon"
    if kt >= 34 or code in {"TS", "STS", "TC"} or "TROPICAL STORM" in blob:
        return "Tropical storm"
    if "DEPRESSION" in blob or code in {"TD", "SD"}:
        return "Tropical depression"
    return (text or code or "Tropical cyclone").strip()


def _basin_name(code: str) -> str:
    return {
        "al": "Atlantic",
        "ep": "Eastern Pacific",
        "cp": "Central Pacific",
        "wp": "Western Pacific",
        "io": "North Indian",
        "sh": "Southern Hemisphere",
    }.get(code[:2].lower(), code.upper())


def _nws_radar(lon: float, lat: float, zoom: float = 6.4) -> str:
    payload = {
        "agenda": {"id": None, "center": [lon, lat], "location": None, "zoom": zoom},
        "animating": True,
        "base": "standard",
        "artcc": False,
        "county": False,
        "cwa": False,
        "rfc": False,
        "state": False,
        "menu": True,
        "shortFusedOnly": False,
        "opacity": {"alerts": 0.8, "local": 0.6, "localStations": 0.8, "national": 0.6},
    }
    b64 = base64.b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode()
    return "https://radar.weather.gov/?settings=v1_" + quote(b64)


def _windy(lat: float | None, lon: float | None, zoom: int = 6) -> str:
    if lat is None or lon is None:
        return "https://www.windy.com/-Hurricane-tracker/hurricanes?hurricanes,20,-40,3,p:cities"
    return (
        "https://www.windy.com/-Hurricane-tracker/hurricanes"
        f"?hurricanes,{lat:.3f},{lon:.3f},{zoom},p:cities"
    )


def _enrich(storm: dict) -> dict:
    lat, lon = storm.get("lat"), storm.get("lon")
    fl = {}
    hi = {}
    if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
        fl = {
            name: round(_nm(_haversine_km((lat, lon), pos)), 0)
            for name, pos in FLORIDA.items()
        }
        hi = {
            name: round(_nm(_haversine_km((lat, lon), pos)), 0)
            for name, pos in HAWAII.items()
        }
    nearest_fl = min(fl.values()) if fl else None
    nearest_hi = min(hi.values()) if hi else None
    knots = int(storm.get("knots") or 0)
    invest = bool(storm.get("invest"))
    basin = str(storm.get("basin") or "")
    score = knots
    if nearest_fl is not None:
        if nearest_fl < 2500:
            score += 500 + int((2500 - nearest_fl) / 4)
        if nearest_fl < 800:
            score += 400
    if nearest_hi is not None:
        if nearest_hi < 2500:
            score += 550 + int((2500 - nearest_hi) / 4)
        if nearest_hi < 800:
            score += 450
    if basin == "al":
        score += 180
    if basin == "cp":
        score += 220
    if basin == "ep" and nearest_hi and nearest_hi < 2000:
        score += 120
    if invest:
        score -= 90
    name = str(storm.get("name") or storm.get("id") or "Storm")
    scene = f"Storm · {name.title() if name.isupper() else name}"
    if invest:
        scene = f"Storm · {str(storm.get('id') or name).upper()}"
    storm.update(
        {
            "florida_nm": fl,
            "hawaii_nm": hi,
            "nearest_florida_nm": nearest_fl,
            "nearest_hawaii_nm": nearest_hi,
            "focus": (
                "florida"
                if nearest_fl is not None and (nearest_hi is None or nearest_fl <= nearest_hi) and nearest_fl < 1800
                else "hawaii"
                if nearest_hi is not None and nearest_hi < 1800
                else "global"
            ),
            "score": score,
            "scene": scene[:80],
            "label": storm.get("label") or _class_label(str(storm.get("class") or ""), knots, name),
            "windy_url": _windy(lat, lon, 6 if not invest else 5),
            "mph": round(knots * 1.15078) if knots else None,
        }
    )
    return storm


def _from_nhc(raw: dict) -> list[dict]:
    out = []
    for s in raw.get("activeStorms") or []:
        lat, lon = s.get("latitudeNumeric"), s.get("longitudeNumeric")
        if lat is None:
            lat, lon = _parse_latlon(s.get("latitude"), s.get("longitude"))
        sid = str(s.get("id") or "").lower()
        basin = sid[:2]
        try:
            knots = int(float(s.get("intensity") or 0))
        except (TypeError, ValueError):
            knots = 0
        name = str(s.get("name") or sid).strip()
        klass = str(s.get("classification") or "")
        bin_no = str(s.get("binNumber") or "")
        graphics = ""
        if bin_no:
            graphics = f"https://www.nhc.noaa.gov/graphics_{bin_no.lower()}.shtml?cone"
        out.append(
            _enrich(
                {
                    "id": sid,
                    "source": "nhc",
                    "basin": basin,
                    "basin_name": _basin_name(basin),
                    "name": name,
                    "class": klass,
                    "knots": knots,
                    "mb": _to_int(s.get("pressure")),
                    "lat": lat,
                    "lon": lon,
                    "movement_dir": s.get("movementDir"),
                    "movement_kt": s.get("movementSpeed"),
                    "updated": s.get("lastUpdate"),
                    "advisory_url": ((s.get("publicAdvisory") or {}).get("url")),
                    "cone_url": graphics,
                    "invest": name.upper() in {"INVEST", "UNKNOWN"} or "INVEST" in klass.upper(),
                }
            )
        )
    return out


def _to_int(v) -> int | None:
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def _from_rammb(html: str) -> list[dict]:
    out = []
    for m in re.finditer(
        r'storm_identifier=([a-z0-9]+)[^>]*>\s*([A-Z0-9]+)\s*-\s*([^<]+)',
        html,
        re.I,
    ):
        sid = m.group(1).lower()
        label = re.sub(r"<br\s*/?>", "", m.group(3), flags=re.I).strip()
        basin = sid[:2]
        invest = "INVEST" in label.upper()
        year = sid[4:8] if len(sid) >= 8 else datetime.now(timezone.utc).strftime("%Y")
        num = sid[2:4]
        ir = (
            "https://rammb-data.cira.colostate.edu/tc_realtime/products/storms/"
            f"{year}{basin}{num}/4kmirimg/{year}{basin}{num}_4kmirimg.gif"
        )
        # RAMMB timestamps the gif; storm page first 4km IR is resolved later.
        out.append(
            {
                "id": sid,
                "source": "rammb",
                "basin": basin,
                "basin_name": _basin_name(basin),
                "name": "INVEST" if invest else re.sub(r"^(Major\s+)?(Hurricane|Typhoon|Tropical Storm|Tropical Depression)\s+", "", label, flags=re.I).strip() or sid,
                "class": "INVEST" if invest else "",
                "label": label.title() if not invest else "Invest",
                "rammb_url": RAMMB_STORM.format(id=sid),
                "ir_guess": ir,
                "invest": invest,
            }
        )
    return out


def _rammb_ir(sid: str, html: str) -> str | None:
    m = re.search(
        rf"/tc_realtime/products/storms/[^\"']+{re.escape(sid[4:8]+sid[:2]+sid[2:4])}?[^\"']*4kmirimg[^\"']+\.gif",
        html,
        re.I,
    )
    if not m:
        m = re.search(r"/tc_realtime/products/storms/[^\"']+4kmirimg[^\"']+\.gif", html, re.I)
    if not m:
        return None
    return "https://rammb-data.cira.colostate.edu" + m.group(0)


def _from_jtwc(text: str, default_basin: str) -> list[dict]:
    out = []
    # Named warning: TROPICAL STORM 17W (SAUDEL) WAS LOCATED NEAR 8.5N 154.1E ... 35 KNOTS
    named = re.compile(
        r"(TYPHOON|HURRICANE|TROPICAL STORM|TROPICAL DEPRESSION)\s+(\d{1,2})([WEPACS])"
        r"(?:\s+\(([A-Z][A-Z0-9\- ]+)\))?.*?NEAR\s+(\d+\.?\d*)([NS])\s+(\d+\.?\d*)([EW])"
        r".{0,500}?MAXIMUM\s+SUSTAINED\s+SURFACE\s+WINDS WERE ESTIMATED AT (\d{2,3})\s+KNOTS",
        re.I | re.S,
    )
    for m in named.finditer(text):
        num = int(m.group(2))
        hemi = m.group(3).lower()
        basin = {"w": "wp", "e": "ep", "p": "cp", "a": "al", "c": "cp", "s": "sh"}.get(hemi, default_basin)
        lat = float(m.group(5)) * (1 if m.group(6).upper() == "N" else -1)
        lon = float(m.group(7)) * (1 if m.group(8).upper() == "E" else -1)
        name = (m.group(4) or f"{num}{hemi.upper()}").strip()
        out.append(
            {
                "id": f"{basin}{num:02d}{datetime.now(timezone.utc).year}",
                "source": "jtwc",
                "basin": basin,
                "name": name,
                "class": m.group(1),
                "knots": int(m.group(9)),
                "lat": lat,
                "lon": lon,
                "invest": False,
            }
        )
    invest = re.compile(
        r"INVEST\s+(\d{2})([WEPACS]).*?NEAR\s+(\d+\.?\d*)([NS])\s+(\d+\.?\d*)([EW])"
        r".{0,500}?(\d{2,3})\s+(?:TO\s+\d{2,3}\s+)?KNOTS",
        re.I | re.S,
    )
    for m in invest.finditer(text):
        num = int(m.group(1))
        hemi = m.group(2).lower()
        basin = {"w": "wp", "e": "ep", "p": "cp", "s": "sh", "a": "io", "c": "io"}.get(hemi, default_basin)
        lat = float(m.group(3)) * (1 if m.group(4).upper() == "N" else -1)
        lon = float(m.group(5)) * (1 if m.group(6).upper() == "E" else -1)
        out.append(
            {
                "id": f"{basin}{num:02d}{datetime.now(timezone.utc).year}",
                "source": "jtwc",
                "basin": basin,
                "name": "INVEST",
                "class": "INVEST",
                "knots": int(m.group(7)),
                "lat": lat,
                "lon": lon,
                "invest": True,
            }
        )
    return out


def _merge(rows: list[dict]) -> list[dict]:
    by: dict[str, dict] = {}
    for row in rows:
        sid = str(row.get("id") or "").lower()
        if not sid:
            continue
        cur = by.get(sid)
        if not cur:
            by[sid] = row
            continue
        for k, v in row.items():
            if v in (None, "", [], {}):
                continue
            if k in {"lat", "lon", "knots", "mb"} and cur.get(k) in (None, 0, ""):
                cur[k] = v
            elif k not in cur or cur[k] in (None, "", []):
                cur[k] = v
            elif k == "source" and v == "nhc":
                cur[k] = v
        if row.get("source") == "nhc":
            for k in ("name", "class", "cone_url", "advisory_url", "updated"):
                if row.get(k):
                    cur[k] = row[k]
    storms = [_enrich(s) for s in by.values()]
    storms.sort(key=lambda s: (-int(s.get("score") or 0), -int(s.get("knots") or 0)))
    kept: list[dict] = []
    for s in storms:
        if not s.get("invest"):
            kept.append(s)
            continue
        nfl, nhi = s.get("nearest_florida_nm"), s.get("nearest_hawaii_nm")
        close = (nfl is not None and nfl < 2200) or (nhi is not None and nhi < 2200)
        if close or s.get("basin") in {"al", "cp"}:
            kept.append(s)
    return kept[:14]


async def refresh_storms() -> dict:
    chunks: list[str] = []

    async def grab(url: str) -> str:
        try:
            return await asyncio.to_thread(_get, url)
        except Exception as e:
            log.info("hurricane fetch fail %s: %s", url, e)
            return ""

    nhc_txt, rammb_html, abpw, abio = await asyncio.gather(
        grab(NHC_URL), grab(RAMMB_URL), grab(JTWC_ABPW), grab(JTWC_ABIO)
    )
    rows: list[dict] = []
    if nhc_txt:
        try:
            rows.extend(_from_nhc(json.loads(nhc_txt)))
            chunks.append("nhc")
        except Exception as e:
            log.warning("NHC parse: %s", e)
    if rammb_html:
        rows.extend(_from_rammb(rammb_html))
        chunks.append("rammb")
    if abpw:
        rows.extend(_from_jtwc(abpw, "wp"))
        chunks.append("jtwc-wp")
    if abio:
        rows.extend(_from_jtwc(abio, "io"))
        chunks.append("jtwc-io")

    # Resolve IR gif for storms still missing coords or wanting a still.
    async def fill_ir(storm: dict) -> None:
        if storm.get("ir_url"):
            return
        try:
            html = await grab(RAMMB_STORM.format(id=storm["id"]))
        except Exception:
            return
        if not html:
            return
        ir = _rammb_ir(storm["id"], html)
        if ir:
            storm["ir_url"] = ir

    storms = _merge(rows)
    await asyncio.gather(*(fill_ir(s) for s in storms[:14]))
    storms = [_enrich(s) for s in storms]

    payload = {
        "ok": True,
        "ts": datetime.now(timezone.utc).isoformat(),
        "sources": chunks,
        "count": len(storms),
        "storms": storms,
        "florida": {
            "radar": _nws_radar(-81.3, 27.5, 5.8),
            "goes": "https://cdn.star.nesdis.noaa.gov/GOES19/ABI/SECTOR/eus/GEOCOLOR/GOES19-EUS-GEOCOLOR-1000x1000.gif",
            "windy": _windy(26.5, -81.0, 5),
        },
        "hawaii": {
            "radar": _nws_radar(-157.724, 20.875, 7.2),
            "goes": "https://cdn.star.nesdis.noaa.gov/GOES18/ABI/SECTOR/hi/GEOCOLOR/GOES18-HI-GEOCOLOR-1000x1000.gif",
            "windy": _windy(20.8, -157.0, 5),
        },
        "world": {"windy": _windy(18.0, -40.0, 3)},
    }
    STORMS_PATH.parent.mkdir(parents=True, exist_ok=True)
    STORMS_PATH.write_text(json.dumps(payload, indent=2, default=str))
    return payload


def desk_payload(slide_id: str | None = None) -> dict:
    data = load_storms()
    storms = data.get("storms") or []
    sid = (slide_id or "world").lower()
    if sid in {"florida", "hawaii", "world"}:
        nearby = []
        if sid == "florida":
            nearby = sorted(
                [s for s in storms if s.get("nearest_florida_nm") is not None],
                key=lambda s: s.get("nearest_florida_nm") or 9e9,
            )[:6]
        elif sid == "hawaii":
            nearby = sorted(
                [s for s in storms if s.get("nearest_hawaii_nm") is not None],
                key=lambda s: s.get("nearest_hawaii_nm") or 9e9,
            )[:6]
        else:
            nearby = storms[:8]
        return {
            "ok": True,
            "slide": sid,
            "title": {"florida": "Florida desk", "hawaii": "Hawaiʻi desk", "world": "Earth tracker"}[sid],
            "storms": nearby,
            "all": storms,
            "ts": data.get("ts"),
            "mode": current_mode(),
        }
    storm = next((s for s in storms if str(s.get("id")).lower() == sid), None)
    if not storm:
        storm = next((s for s in storms if str(s.get("scene")).lower() == sid), None)
    return {
        "ok": bool(storm),
        "slide": sid,
        "storm": storm,
        "all": storms,
        "ts": data.get("ts"),
        "mode": current_mode(),
    }


async def _browser(obs, scene: str, name: str, url: str, *, overlay: bool = False) -> None:
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
            "css": "body { margin: 0; overflow: hidden; background: transparent; }",
        },
    )
    await _fit(obs, scene, name)


async def apply_hurricane_kit(obs: Any | None = None) -> dict:
    """Build/update the Hurricane Tracker collection: FL + HI boards + one scene per storm."""
    from apps.core.services.obs_studio import (
        ObsClient,
        _enable_item,
        _ensure_input,
        _fit,
        _stretch_all,
    )
    from apps.core.services.nhc_media import apply_nhc_obs_scenes, current_files

    data = await refresh_storms()
    own = obs is None
    if own:
        obs = ObsClient()
        if not await obs.connect():
            return {"ok": False, "detail": "obs_unreachable", "storms": data.get("count")}
    origin = f"http://127.0.0.1:{config.AVA_PORT}"
    created = []
    try:
        cols = await obs.req("GetSceneCollectionList")
        names = cols.get("sceneCollections") or []
        if HURRICANE_COLLECTION not in names:
            await obs.req("CreateSceneCollection", {"sceneCollectionName": HURRICANE_COLLECTION})
            await asyncio.sleep(1.6)
            created.append("collection")
        elif cols.get("currentSceneCollectionName") != HURRICANE_COLLECTION:
            await obs.req("SetCurrentSceneCollection", {"sceneCollectionName": HURRICANE_COLLECTION})
            await asyncio.sleep(1.5)

        existing = {s.get("sceneName") for s in (await obs.req("GetSceneList")).get("scenes") or []}
        wanted = {scene for scene, _ in BOARD_SCENES}
        storms = data.get("storms") or []
        for st in storms:
            wanted.add(st["scene"])

        for scene, key in BOARD_SCENES:
            if scene not in existing:
                await obs.try_req("CreateScene", {"sceneName": scene})
            board = data.get(key) or {}
            map_url = board.get("radar") or board.get("windy")
            if key == "world":
                map_url = board.get("windy")
            await _browser(obs, scene, f"HT Map {key}", map_url)
            if key == "hawaii":
                cone = next((p for n, p in current_files().items() if "5day_cone" in n), None)
                from apps.core.services.nhc_media import live_url
                two = live_url("cpac_2day")
                epac_two = live_url("epac_2day")
                if cone:
                    await _ensure_input(
                        obs, scene, "HT NHC Cone", "image_source",
                        {"file": str(cone), "unload": False},
                    )
                    await _fit(obs, scene, "HT NHC Cone")
                if two:
                    await _ensure_input(
                        obs, scene, "HT NHC 2Day", "browser_source",
                        {"url": two, "width": 1920, "height": 1080, "shutdown": True, "restart_when_active": True},
                    )
                    await _fit(obs, scene, "HT NHC 2Day")
                    await _enable_item(obs, scene, "HT NHC 2Day", False)
                if epac_two:
                    await _ensure_input(
                        obs, scene, "HT NHC EPAC 2Day", "browser_source",
                        {"url": epac_two, "width": 1920, "height": 1080, "shutdown": True, "restart_when_active": True},
                    )
                    await _fit(obs, scene, "HT NHC EPAC 2Day")
                    await _enable_item(obs, scene, "HT NHC EPAC 2Day", False)
            if key != "world" and board.get("goes"):
                await _browser(obs, scene, f"HT Sat {key}", board["goes"])
                await _enable_item(obs, scene, f"HT Sat {key}", False)
            await _browser(
                obs,
                scene,
                f"HT Overlay {key}",
                f"{origin}/obs/hurricane?id={key}",
                overlay=True,
            )

        for st in storms:
            scene = st["scene"]
            if scene not in existing:
                await obs.try_req("CreateScene", {"sceneName": scene})
            url = st.get("cone_url") or st.get("windy_url")
            if not st.get("lat") and st.get("ir_url"):
                url = st["ir_url"]
            await _browser(obs, scene, f"HT Map {st['id']}", url)
            if st.get("ir_url") and url != st.get("ir_url"):
                await _browser(obs, scene, f"HT IR {st['id']}", st["ir_url"])
                await _enable_item(obs, scene, f"HT IR {st['id']}", False)
            await _browser(
                obs,
                scene,
                f"HT Overlay {st['id']}",
                f"{origin}/obs/hurricane?id={st['id']}",
                overlay=True,
            )

        leftover = [
            s
            for s in existing
            if (str(s).startswith("Storm · ") or str(s).startswith("HT · ")) and s not in wanted
        ]
        for scene in leftover:
            await obs.try_req("RemoveScene", {"sceneName": scene})

        await apply_nhc_obs_scenes(obs)

        await _stretch_all(obs)
        first = BOARD_SCENES[0][0]
        await obs.try_req("SetCurrentProgramScene", {"sceneName": first})
        write_mode("hurricane", {"storms": len(storms), "scenes": list(wanted)})
        return {
            "ok": True,
            "collection": HURRICANE_COLLECTION,
            "storms": [s.get("id") for s in storms],
            "scenes": hurricane_scene_pool(),
            "removed": leftover,
            "created": created,
        }
    finally:
        if own:
            await obs.close()


async def set_mode(mode: str) -> dict:
    from apps.core.services.obs_studio import COLLECTION, ObsClient, apply_weather_radar
    from apps.core.services.nhc_media import apply_nhc_obs_scenes

    raw = str(mode or "daily").lower()
    if raw in {"hurricane", "hurricanes", "tracker"}:
        want = "hurricane"
    elif raw in {"kilauea", "volcano", "kv"}:
        want = "kilauea"
    elif raw in {"weather", "wx", "noaa"}:
        want = "weather"
    else:
        want = "daily"
    write_mode(want)
    obs = ObsClient()
    if not await obs.connect():
        return {"ok": False, "detail": "obs_unreachable", "mode": want}
    try:
        if want == "hurricane":
            kit = await apply_hurricane_kit(obs)
            return {"ok": True, "mode": want, "kit": kit}
        if want == "kilauea":
            from apps.core.services.kilauea_cams import apply_kilauea_kit

            kit = await apply_kilauea_kit(obs)
            return {"ok": True, "mode": want, "kit": kit}
        cols = await obs.req("GetSceneCollectionList")
        if COLLECTION in (cols.get("sceneCollections") or []):
            if cols.get("currentSceneCollectionName") != COLLECTION:
                await obs.req("SetCurrentSceneCollection", {"sceneCollectionName": COLLECTION})
                await asyncio.sleep(1.2)
        wx = await apply_weather_radar(obs)
        nhc = await apply_nhc_obs_scenes(obs)
        start = "NHC · EPAC 2-Day" if want == "weather" else "Main"
        await obs.try_req("SetCurrentProgramScene", {"sceneName": start})
        return {
            "ok": True,
            "mode": want,
            "collection": COLLECTION,
            "weather": wx,
            "nhc": nhc,
        }
    finally:
        await obs.close()


async def ensure_mode_collection(obs) -> dict:
    """Keep OBS on the collection that matches the saved mode. No kit rebuild."""
    from apps.core.services.obs_studio import COLLECTION
    from apps.core.services.kilauea_cams import KILAUEA_COLLECTION

    mode = current_mode()
    if mode == "hurricane":
        target = HURRICANE_COLLECTION
    elif mode == "kilauea":
        target = KILAUEA_COLLECTION
    else:
        target = COLLECTION
    cols = await obs.req("GetSceneCollectionList")
    names = cols.get("sceneCollections") or []
    cur = cols.get("currentSceneCollectionName")
    if target not in names:
        return {"ok": False, "mode": mode, "missing": target, "current": cur}
    if cur != target:
        await obs.req("SetCurrentSceneCollection", {"sceneCollectionName": target})
        await asyncio.sleep(1.4)
        return {"ok": True, "mode": mode, "switched": target}
    return {"ok": True, "mode": mode, "current": cur}

"""Hurricane global desk — text + radio insert from on-disk storm + NWS files.

Fetch is a separate cron. This module never invents storms; it reads
``data/state/hurricanes.json`` and ``data/state/nws-hawaii.json``.
Hawaiʻi block is always present: nearest tropical system to a Hawaiian island.
"""
from __future__ import annotations

import json
import logging
import math
import re
import time
import unicodedata
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from apps.core import config

log = logging.getLogger("ava.hurricane_desk")
HST = ZoneInfo("Pacific/Honolulu")

STATE_PATH = config.DATA_DIR / "state" / "hurricane-desk.json"
LOCK_PATH = config.DATA_DIR / "state" / "hurricane-desk-lock.json"
WAV_NAME = "hurricane-desk-current.wav"

COMPASS = (
    "north",
    "northeast",
    "east",
    "southeast",
    "south",
    "southwest",
    "west",
    "northwest",
)

HAWAII_POS = {
    "Honolulu": (21.3069, -157.8583),
    "Hilo": (19.7297, -155.0900),
    "Līhuʻe": (21.9811, -159.3711),
    "Kona": (19.6390, -155.9969),
}

TROPICAL_EVENTS = (
    "hurricane",
    "tropical storm",
    "tropical depression",
    "typhoon",
    "cyclone",
    "storm surge",
    "hurricane watch",
    "hurricane warning",
    "tropical storm watch",
    "tropical storm warning",
)


def _reports_dir() -> Path:
    p = getattr(config, "REPORTS_DIR", None)
    if p:
        return Path(p)
    return Path(r"C:\Users\rootr\ava\Media\public\documents\reports")


def load() -> dict[str, Any]:
    if STATE_PATH.is_file():
        try:
            return json.loads(STATE_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"ok": False, "hawaii": {}, "global": {}, "spoken": ""}


def save(payload: dict[str, Any]) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, indent=2, default=str) + "\n", encoding="utf-8")
    tmp.replace(STATE_PATH)


def stage_busy() -> str | None:
    if not LOCK_PATH.is_file():
        return None
    try:
        raw = json.loads(LOCK_PATH.read_text(encoding="utf-8"))
    except Exception:
        return None
    started = float(raw.get("started") or 0)
    if started and time.time() - started > 180:
        return None
    return str(raw.get("stage") or "busy")


def acquire_stage(stage: str) -> bool:
    other = stage_busy()
    if other and other != stage:
        log.info("hurricane desk skip overlap other=%s want=%s", other, stage)
        return False
    LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
    LOCK_PATH.write_text(
        json.dumps({"stage": stage, "started": time.time()}, indent=2) + "\n",
        encoding="utf-8",
    )
    return True


def release_stage(stage: str) -> None:
    try:
        if LOCK_PATH.is_file():
            raw = json.loads(LOCK_PATH.read_text(encoding="utf-8"))
            if str(raw.get("stage") or "") == stage:
                LOCK_PATH.unlink()
    except Exception:
        pass


def _bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def _compass(deg: float) -> str:
    idx = int((deg + 22.5) // 45) % 8
    return COMPASS[idx]


def _nws_hawaii() -> dict[str, Any]:
    path = config.DATA_DIR / "state" / "nws-hawaii.json"
    if not path.is_file():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return raw if isinstance(raw, dict) else {}


def _tropical_nws(nws: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for p in nws.get("products") or []:
        if not isinstance(p, dict):
            continue
        ev = str(p.get("event") or "").lower()
        if any(t in ev for t in TROPICAL_EVENTS):
            out.append(p)
    return out


def nearest_hawaii(storms: list[dict[str, Any]]) -> dict[str, Any] | None:
    best = None
    best_nm = 9e9
    for s in storms:
        if not isinstance(s, dict):
            continue
        hi = s.get("hawaii_nm") if isinstance(s.get("hawaii_nm"), dict) else {}
        if hi:
            island, nm = min(hi.items(), key=lambda kv: float(kv[1] or 9e9))
        else:
            nm = s.get("nearest_hawaii_nm")
            island = None
            if nm is None:
                continue
        try:
            nmi = float(nm)
        except (TypeError, ValueError):
            continue
        if nmi < best_nm:
            best_nm = nmi
            best = {**s, "_island": island or "Hawaiʻi", "_nm": nmi}
    return best


def _storm_latlon(s: dict[str, Any]) -> tuple[float | None, float | None]:
    try:
        lat = float(s["lat"]) if s.get("lat") is not None else None
        lon = float(s["lon"]) if s.get("lon") is not None else None
    except (TypeError, ValueError):
        return None, None
    return lat, lon


def hawaii_block(storms: list[dict[str, Any]], nws: dict[str, Any]) -> dict[str, Any]:
    near = nearest_hawaii(storms)
    trop = _tropical_nws(nws)
    title = "Nearest Hurricane from a Hawaiian island"
    if not near:
        spoken = (
            f"{title}. No tropical system with a mapped position is on the board. "
            "Stay with NWS Honolulu for watches and warnings."
        )
        return {
            "title": title,
            "present": False,
            "spoken": spoken,
            "nws_tropical": trop,
            "alerts": [p.get("event") for p in trop],
        }

    name = str(near.get("name") or near.get("id") or "unnamed system")
    label = str(near.get("label") or near.get("class") or "tropical system")
    island = str(near.get("_island") or "Hawaiʻi")
    nmi = int(round(float(near.get("_nm") or 0)))
    lat, lon = _storm_latlon(near)
    pos = HAWAII_POS.get(island) or HAWAII_POS.get("Honolulu")
    bearing = None
    compass = None
    if lat is not None and lon is not None and pos:
        bearing = round(_bearing(pos[0], pos[1], lat, lon), 0)
        compass = _compass(bearing)
    knots = near.get("knots")
    try:
        kt = int(round(float(knots))) if knots is not None else None
    except (TypeError, ValueError):
        kt = None
    wind = f" Maximum sustained winds {kt} knots." if kt else ""
    bear = f" It bears {compass} of {island}." if compass else ""
    if trop:
        bits = []
        for p in trop:
            counties = p.get("counties") or []
            if isinstance(counties, list):
                county_s = ", ".join(str(c) for c in counties) or "Hawaiʻi"
            else:
                county_s = str(counties) or "Hawaiʻi"
            bits.append(f"{p.get('event')} for {county_s}")
        watch = " NWS Honolulu: " + "; ".join(bits) + "."
    else:
        watch = " No tropical watches or warnings for Hawaiʻi in the last NWS pull."

    spoken = (
        f"{title}. {label} {name} is about {nmi} nautical miles from {island}.{bear}{wind}{watch}"
    )
    mb = near.get("mb")
    try:
        pressure = int(round(float(mb))) if mb is not None else None
    except (TypeError, ValueError):
        pressure = None
    try:
        move_kt = int(round(float(near.get("movement_kt")))) if near.get("movement_kt") is not None else None
    except (TypeError, ValueError):
        move_kt = None
    move_dir = near.get("movement_dir")
    try:
        move_compass = _compass(float(move_dir)) if move_dir is not None else None
    except (TypeError, ValueError):
        move_compass = None
    return {
        "title": title,
        "present": True,
        "name": name,
        "label": label,
        "island": island,
        "nm": nmi,
        "bearing_deg": bearing,
        "bearing": compass,
        "knots": kt,
        "pressure_mb": pressure,
        "movement_kt": move_kt,
        "movement_compass": move_compass,
        "storm_id": near.get("id"),
        "basin": near.get("basin"),
        "spoken": spoken,
        "nws_tropical": trop,
        "alerts": [p.get("event") for p in trop],
    }


def global_block(storms: list[dict[str, Any]]) -> dict[str, Any]:
    named = []
    by_basin: dict[str, int] = {}
    for s in storms:
        if not isinstance(s, dict):
            continue
        basin = str(s.get("basin") or "xx").lower()[:2]
        by_basin[basin] = by_basin.get(basin, 0) + 1
        if s.get("invest"):
            continue
        named.append(s)
    named.sort(key=lambda s: int(s.get("knots") or 0), reverse=True)
    lead = []
    for s in named[:3]:
        lead.append(f"{s.get('label') or 'storm'} {s.get('name') or s.get('id')}")
    n = len(storms)
    if n == 0:
        spoken = "Around the world right now, the tropical boards are quiet."
    elif lead:
        extra = " and more on the board." if n > len(lead) else "."
        spoken = (
            f"Around the world right now, {n} tropical systems are on the board. "
            + "; ".join(lead)
            + extra
        )
    else:
        spoken = (
            f"Around the world right now, {n} tropical features are mapped, "
            "none named in the lead list."
        )
    return {"count": n, "by_basin": by_basin, "lead": lead, "spoken": spoken}


ISLAND_SLOTS = {
    "honolulu": "island_honolulu",
    "hilo": "island_hilo",
    "lihue": "island_lihue",
    "kona": "island_kona",
    "kauai": "island_kauai",
    "oahu": "island_oahu",
    "maui": "island_maui",
}

COMPASS_SLOTS = {
    "north": "compass_north",
    "northeast": "compass_northeast",
    "east": "compass_east",
    "southeast": "compass_southeast",
    "south": "compass_south",
    "southwest": "compass_southwest",
    "west": "compass_west",
    "northwest": "compass_northwest",
    "north-northeast": "compass_north_northeast",
    "east-northeast": "compass_east_northeast",
    "east-southeast": "compass_east_southeast",
    "south-southeast": "compass_south_southeast",
    "south-southwest": "compass_south_southwest",
    "west-southwest": "compass_west_southwest",
    "west-northwest": "compass_west_northwest",
    "north-northwest": "compass_north_northwest",
}

BASIN_AFTER = {
    "al": "in_the_north_atlantic_after",
    "ep": "in_the_eastern_pacific_after",
    "cp": "in_the_central_pacific_after",
    "wp": "in_the_western_pacific_after",
}

BASIN_QUIET = {
    "al": "basin_quiet_north_atlantic",
    "ep": "basin_quiet_eastern_north_pacific",
    "cp": "basin_quiet_central_pacific",
    "wp": "basin_quiet_western_pacific",
    "io": "basin_quiet_north_indian",
    "sh": "basin_quiet_south_pacific",
}


def _slug(text: str) -> str:
    raw = (text or "").lower().replace("ʻ", "").replace("'", "")
    raw = unicodedata.normalize("NFKD", raw)
    raw = "".join(c for c in raw if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "_", raw).strip("_")


def _name_tokens(name: str) -> list[str]:
    slug = _slug(name)
    if not slug or slug in {"unnamed", "invest"}:
        return []
    return [f"storm_{slug}"]


def _class_before(label: str) -> str:
    blob = (label or "").lower()
    if "typhoon" in blob:
        return "hawaii_named_typhoon_before"
    if "cyclone" in blob and "tropical storm" not in blob:
        return "hawaii_named_cyclone_before"
    if "hurricane" in blob:
        return "hawaii_named_hurricane_before"
    if "tropical storm" in blob:
        return "hawaii_ts_before"
    if "depression" in blob:
        return "hawaii_td_before"
    if "remnant" in blob:
        return "hawaii_remnant_before"
    return "hawaii_disturbance_before"


def _class_slot(label: str) -> str | None:
    blob = (label or "").lower()
    if "category 5" in blob or "cat 5" in blob:
        return "slot_class_cat5"
    if "category 4" in blob or "cat 4" in blob:
        return "slot_class_cat4"
    if "category 3" in blob or "major" in blob:
        return "slot_class_major"
    if "category 2" in blob:
        return "slot_class_cat2"
    if "category 1" in blob:
        return "slot_class_cat1"
    if "super typhoon" in blob:
        return "slot_class_super"
    if "typhoon" in blob:
        return "slot_class_typhoon"
    if "cyclone" in blob and "tropical storm" not in blob:
        return "slot_class_cyclone"
    if "tropical storm" in blob:
        return "slot_class_ts"
    if "depression" in blob:
        return "slot_class_td"
    if "hurricane" in blob:
        return "slot_class_hurricane"
    return None


def _county_watch_clips(trop: list[dict[str, Any]]) -> list[str]:
    blob = " ".join(
        f"{p.get('event') or ''} {p.get('counties') or ''}" for p in trop
    ).lower()
    bits = []
    if any(k in blob for k in ("kauai", "kauaʻi", "lihue", "līhuʻe")):
        bits.append("hawaii_watch_kauai_01")
    if any(k in blob for k in ("oahu", "oʻahu", "honolulu")):
        bits.append("hawaii_watch_oahu_01")
    if "maui" in blob:
        bits.append("hawaii_watch_maui_01")
    if any(k in blob for k in ("hawaii county", "hawaiʻi island", "big island", "hilo", "kona")):
        bits.append("hawaii_watch_big_01")
    return bits


def clip_script(hawaii: dict, globe: dict) -> str:
    """Stem + slot + number ids. Missing WAVs are skipped at stitch time."""
    bits = ["opener_10", "hawaii_title_01"]
    trop = hawaii.get("nws_tropical") or []
    if hawaii.get("present"):
        bits.append(_class_before(str(hawaii.get("label") or "")))
        bits.extend(_name_tokens(str(hawaii.get("name") or "")))
        slot = _class_slot(str(hawaii.get("label") or ""))
        if slot:
            bits.append(slot)
        nm = hawaii.get("nm")
        if nm is not None:
            bits.append("hawaii_dist_before")
            bits.append(str(int(nm)))
            bits.append("slot_unit_nm")
            bits.append("hawaii_from_before")
            island = str(hawaii.get("island") or "")
            folded = _slug(island)
            slot_isle = ISLAND_SLOTS.get(island.lower()) or ISLAND_SLOTS.get(folded)
            if not slot_isle and "lihu" in folded:
                slot_isle = "slot_island_lihue"
            bits.append(slot_isle or "honolulu")
        compass = str(hawaii.get("bearing") or "").lower()
        if compass in COMPASS_SLOTS:
            bits.append(COMPASS_SLOTS[compass])
        kt = hawaii.get("knots")
        if kt is not None:
            bits.append("wind_before")
            bits.append(str(int(kt)))
            bits.append("slot_unit_knots")
        if trop:
            bits.append("hawaii_watches_active_01")
            bits.extend(_county_watch_clips(trop))
        else:
            bits.append("hawaii_watches_none_01")
        bits.append("hawaii_monitor_01")
    else:
        bits.append("hawaii_no_named_01")
        bits.append("hawaii_watches_none_01" if not trop else "hawaii_watches_active_01")
        if trop:
            bits.extend(_county_watch_clips(trop))
        bits.append("opener_04")
    n = globe.get("count")
    if not n:
        bits.append("global_quiet_01")
    else:
        bits.append("global_around_before")
        bits.append(str(int(n)))
        bits.append("global_systems_after")
    bits.append("signoff_01")
    return " ".join(bits)


def build(*, write_wav: bool = True) -> dict[str, Any]:
    from apps.core.services.hurricane_tracker import load_storms

    data = load_storms()
    storms = [s for s in (data.get("storms") or []) if isinstance(s, dict)]
    nws = _nws_hawaii()
    hi = hawaii_block(storms, nws)
    globe = global_block(storms)
    now = datetime.now(HST)
    opener = "Hurricane global desk, Pacific Root Server."
    signoff = "Root Record Radio. Follow official NWS Honolulu on watches."
    spoken = " ".join(
        [opener, hi.get("spoken") or "", globe.get("spoken") or "", signoff]
    ).strip()
    script = clip_script(hi, globe)
    wav_info: dict[str, Any] = {}
    wav_path = config.GENERATED_DIR / WAV_NAME
    if write_wav:
        try:
            from apps.voice.local_tts import speak_script

            wav_info = speak_script(script, wav_path)
        except Exception as e:
            wav_info = {"ok": False, "detail": str(e)[:200]}

    reports = _reports_dir()
    reports.mkdir(parents=True, exist_ok=True)
    dated = reports / f"hurricane-desk-{now.strftime('%Y-%m-%d')}.md"
    current = reports / "hurricane-desk-current.md"
    body = (
        f"# Hurricane global desk — {now.strftime('%Y-%m-%d %H:%M')} HST\n\n"
        f"{spoken}\n\n"
        f"Sources on disk: NHC/RAMMB/JTWC storms ({data.get('count') or len(storms)}), "
        f"NWS Hawaiʻi alerts ({nws.get('alert_count') or 0}).\n"
    )
    dated.write_text(body, encoding="utf-8")
    current.write_text(body, encoding="utf-8")

    payload = {
        "ok": True,
        "ts": datetime.now(HST).isoformat(),
        "storms_ts": data.get("ts"),
        "storm_count": len(storms),
        "sources": data.get("sources") or [],
        "hawaii": hi,
        "global": globe,
        "spoken": spoken,
        "clip_script": script,
        "wav": wav_info,
        "reports": {"dated": str(dated), "current": str(current)},
    }
    save(payload)
    return payload


def public_payload() -> dict[str, Any]:
    d = load()
    hi = d.get("hawaii") or {}
    globe = d.get("global") or {}
    return {
        "ok": bool(d.get("ok")),
        "ts": d.get("ts"),
        "title": hi.get("title") or "Nearest Hurricane from a Hawaiian island",
        "hawaii": hi.get("spoken"),
        "global": globe.get("spoken"),
        "spoken": d.get("spoken"),
        "island": hi.get("island"),
        "nm": hi.get("nm"),
        "name": hi.get("name"),
        "label": hi.get("label"),
        "alerts": hi.get("alerts") or [],
        "count": globe.get("count"),
    }


async def play_on_radio() -> dict[str, Any]:
    from apps.core.services import radio as radio_svc
    from apps.core.services import voice_events

    st = radio_svc.load()
    if not st.get("on_air"):
        return {"ok": True, "skipped": "not_on_air"}
    if st.get("hurricane_on_radio", True) is False:
        return {"ok": True, "skipped": "hurricane_off"}
    wav = config.GENERATED_DIR / WAV_NAME
    if not wav.is_file() or wav.stat().st_size <= 0:
        return {"ok": False, "skipped": "no_wav"}
    return await voice_events.play_report_mp3(wav, name="hurricane_desk")

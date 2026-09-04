"""Live NWS + NHC lines for Ava chat. Do not invent. Prefer tonight over a stale afternoon period."""
from __future__ import annotations

import logging
import re
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx

from apps.core import config

log = logging.getLogger("ava.live_wx")
HST = ZoneInfo("Pacific/Honolulu")
UA = {"User-Agent": "AvaIvy/2.0 (https://avaivy.cloud; chat-wx)"}
POINT = "https://api.weather.gov/points/19.5429,-155.0372"
ALERTS = "https://api.weather.gov/alerts/active?area=HI"

_cache: tuple[float, list[str]] | None = None
_CACHE_S = 180.0


def _pick_period(periods: list[dict], hour: int) -> dict | None:
    if not periods:
        return None
    if hour >= 18 or hour < 5:
        for p in periods:
            if "tonight" in str(p.get("name") or "").lower():
                return p
        if "afternoon" in str(periods[0].get("name") or "").lower() and len(periods) > 1:
            return periods[1]
    return periods[0]


def _period_line(p: dict) -> str:
    name = p.get("name") or "?"
    temp = p.get("temperature")
    unit = p.get("temperatureUnit") or "F"
    short = p.get("shortForecast") or ""
    wind = p.get("windSpeed") or ""
    gust = p.get("windGust") or ""
    bits = [f"{name}", f"{temp}{unit}" if temp is not None else ""]
    if short:
        bits.append(str(short))
    if wind:
        bits.append(f"wind {wind}")
    if gust:
        bits.append(f"gusts {gust}")
    return ", ".join(b for b in bits if b)


def _alert_line(alerts: list[dict]) -> str:
    if not alerts:
        return "HI alerts: none active"
    grouped: dict[str, bool] = {}
    order: list[str] = []
    for a in alerts[:8]:
        ev = str(a.get("event") or "alert")
        areas = str(a.get("areas") or "")
        bi = bool(re.search(r"Big Island|Puna|Kona|Hilo|Kohala|Kaʻū|Kau", areas, re.I))
        if ev not in grouped:
            order.append(ev)
            grouped[ev] = bi
        else:
            grouped[ev] = grouped[ev] or bi
    names = [f"{ev} (Big Island in area)" if grouped[ev] else ev for ev in order]
    return "HI alerts: " + "; ".join(names)


def _from_md() -> tuple[list[dict], list[dict], str]:
    from apps.core.services.reports import latest_report

    report = latest_report("nws-weather-*.md")
    if not report:
        return [], [], "no NWS file"
    text = report.read_text(encoding="utf-8", errors="replace")
    age_h = (time.time() - report.stat().st_mtime) / 3600.0
    written = datetime.fromtimestamp(report.stat().st_mtime, HST).strftime("%H:%M HST")
    stamp = f"file {written}, {age_h:.1f} h old"
    alerts: list[dict] = []
    for m in re.finditer(r"\*\*([^*]+)\*\* —[^\n]*\n([^\n]*)\n_([^_]+)_", text):
        alerts.append({"event": m.group(1).strip(), "headline": m.group(2).strip(), "areas": m.group(3).strip()})
    periods: list[dict] = []
    chunks = re.split(r"^### ", text, flags=re.M)
    for chunk in chunks[1:]:
        lines = chunk.strip().splitlines()
        if not lines:
            continue
        name = lines[0].strip()
        rest = " ".join(lines[1:])
        tm = re.search(r"(\d+)°([FC])", rest)
        wm = re.search(r"wind[^\d]{0,20}(\d+(?:\s+to\s+\d+)?)\s*mph", rest, re.I)
        gm = re.search(r"gusts as high as (\d+)\s*mph", rest, re.I)
        sm = re.search(r"—\s*([^\n.]+)", rest)
        periods.append(
            {
                "name": name,
                "temperature": int(tm.group(1)) if tm else None,
                "temperatureUnit": tm.group(2) if tm else "F",
                "shortForecast": (sm.group(1).strip() if sm else ""),
                "windSpeed": f"{wm.group(1)} mph" if wm else "",
                "windGust": f"{gm.group(1)} mph" if gm else "",
            }
        )
    return periods, alerts, stamp


async def _from_api() -> tuple[list[dict], list[dict], str] | None:
    try:
        async with httpx.AsyncClient(timeout=10, headers=UA, follow_redirects=True) as client:
            r = await client.get(POINT)
            periods: list[dict] = []
            if r.status_code == 200:
                fc = (r.json().get("properties") or {}).get("forecast")
                if fc:
                    rf = await client.get(fc)
                    if rf.status_code == 200:
                        periods = (rf.json().get("properties") or {}).get("periods") or []
            alerts: list[dict] = []
            ra = await client.get(ALERTS)
            if ra.status_code == 200:
                for f in (ra.json().get("features") or [])[:8]:
                    p = f.get("properties") or {}
                    alerts.append(
                        {
                            "event": p.get("event") or "Unknown",
                            "headline": p.get("headline") or "",
                            "areas": p.get("areaDesc") or "",
                            "severity": p.get("severity") or "",
                        }
                    )
            if not periods:
                return None
            return periods, alerts, "live NWS " + datetime.now(HST).strftime("%H:%M HST")
    except Exception as e:
        log.debug("NWS live fetch: %s", e)
        return None


def hurricane_line() -> str:
    from apps.core.services.hurricane_tracker import load_storms

    data = load_storms()
    storms = data.get("storms") or []
    ts = str(data.get("ts") or "")
    near = []
    for s in storms:
        if not isinstance(s, dict):
            continue
        nm = s.get("nearest_hawaii_nm")
        try:
            nmi = float(nm) if nm is not None else None
        except (TypeError, ValueError):
            nmi = None
        if nmi is None:
            continue
        if nmi <= 1500 or s.get("focus") == "hawaii":
            near.append((nmi, s))
    near.sort(key=lambda x: x[0])
    if not near:
        n = int(data.get("count") or 0)
        return (
            f"Hurricanes near Hawaiʻi: none inside 1500 nm. "
            f"NHC worldwide count {n}. Sample {ts or 'unknown'}."
        )
    bits = []
    for nmi, s in near[:3]:
        name = s.get("name") or s.get("id") or "storm"
        label = s.get("label") or s.get("class") or "cyclone"
        hi = s.get("hawaii_nm") if isinstance(s.get("hawaii_nm"), dict) else {}
        if hi.get("Kona") is not None:
            dist = f"{int(round(float(hi['Kona'])))} nm from Kona"
        elif hi.get("Hilo") is not None:
            dist = f"{int(round(float(hi['Hilo'])))} nm from Hilo"
        else:
            dist = f"{int(round(nmi))} nm from Hawaiʻi"
        mph = s.get("mph")
        try:
            wind = f", {int(round(float(mph)))} mph" if mph is not None else ""
        except (TypeError, ValueError):
            wind = ""
        bits.append(f"{label} {name}, {dist}{wind}")
    return "Hurricanes: " + "; ".join(bits) + (f". Sample {ts}." if ts else ".")


async def weather_lines() -> list[str]:
    global _cache
    now = time.monotonic()
    if _cache and (now - _cache[0]) < _CACHE_S:
        return _cache[1]
    hour = datetime.now(HST).hour
    fetched = await _from_api()
    if fetched:
        periods, alerts, stamp = fetched
    else:
        periods, alerts, stamp = _from_md()
    period = _pick_period(periods, hour)
    wx = f"Weather ({stamp}): " + (_period_line(period) if period else "DOWN")
    lines = [wx, _alert_line(alerts), hurricane_line()]
    _cache = (now, lines)
    return lines

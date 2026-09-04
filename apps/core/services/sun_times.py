"""Daily sunrise and sunset in Hawaiʻi time. Live numbers only."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx

from apps.core import config

log = logging.getLogger("ava.sun")

HST = ZoneInfo("Pacific/Honolulu")
# Near Volcano / Puna — same patch as the weather desk.
LAT = 19.43
LON = -155.23
PATH = config.DATA_DIR / "state" / "sun-times.json"
OPEN_METEO = (
    "https://api.open-meteo.com/v1/forecast"
    f"?latitude={LAT}&longitude={LON}"
    "&daily=sunrise,sunset"
    "&timezone=Pacific/Honolulu"
    "&forecast_days=1"
)


def _today() -> str:
    return datetime.now(HST).strftime("%Y-%m-%d")


def read() -> dict:
    if not PATH.is_file():
        return {}
    try:
        raw = json.loads(PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return raw if isinstance(raw, dict) else {}


def _hhmm_from_iso(iso: str) -> str:
    raw = str(iso or "").strip()
    if "T" in raw:
        raw = raw.split("T", 1)[1]
    return raw[:5]


def write(payload: dict) -> dict:
    PATH.parent.mkdir(parents=True, exist_ok=True)
    PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return payload


def refresh_if_stale(*, force: bool = False) -> dict:
    stored = read()
    if not force and stored.get("date") == _today() and stored.get("sunrise") and stored.get("sunset"):
        return stored
    try:
        with httpx.Client(timeout=12) as client:
            r = client.get(OPEN_METEO)
        r.raise_for_status()
        daily = (r.json() or {}).get("daily") or {}
        rises = daily.get("sunrise") or []
        sets = daily.get("sunset") or []
        if not rises or not sets:
            return stored
        payload = {
            "date": _today(),
            "sunrise": _hhmm_from_iso(rises[0]),
            "sunset": _hhmm_from_iso(sets[0]),
            "sunrise_iso": rises[0],
            "sunset_iso": sets[0],
            "source": "open-meteo",
            "lat": LAT,
            "lon": LON,
        }
        return write(payload)
    except Exception as e:
        log.debug("sun times fetch skipped: %s", e)
        return stored


def parse_hhmm(value: str) -> tuple[int, int] | None:
    raw = str(value or "").strip()
    if ":" not in raw:
        return None
    hh, mm = raw.split(":", 1)
    try:
        h, m = int(hh), int(mm[:2])
    except ValueError:
        return None
    if not (0 <= h <= 23 and 0 <= m <= 59):
        return None
    return h, m


def _at_today(hhmm: str) -> datetime | None:
    parsed = parse_hhmm(hhmm)
    if not parsed:
        return None
    now = datetime.now(HST)
    return now.replace(hour=parsed[0], minute=parsed[1], second=0, microsecond=0)


def facts() -> dict:
    stored = refresh_if_stale()
    now = datetime.now(HST)
    rise = _at_today(stored.get("sunrise") or "")
    sett = _at_today(stored.get("sunset") or "")
    after_sunset = bool(sett and now > sett)
    before_sunrise = bool(rise and now < rise)
    return {
        "ok": bool(stored.get("sunrise") and stored.get("sunset")),
        "date": stored.get("date") or _today(),
        "sunrise": stored.get("sunrise") or "",
        "sunset": stored.get("sunset") or "",
        "sunrise_iso": stored.get("sunrise_iso"),
        "sunset_iso": stored.get("sunset_iso"),
        "after_sunset": after_sunset,
        "before_sunrise": before_sunrise,
        "source": stored.get("source") or "",
        "now_hst": now.strftime("%H:%M"),
    }


def in_day_start_window(now: datetime | None = None) -> bool:
    """First desk-awake after sunrise and before 14:00 HST."""
    now = now or datetime.now(HST)
    if now.hour >= 14:
        return False
    stored = read() or refresh_if_stale()
    rise = _at_today(stored.get("sunrise") or "06:00")
    if rise is None:
        return 6 <= now.hour < 14
    return now >= rise and now.hour < 14

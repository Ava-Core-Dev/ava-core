"""First daytime start and nightly stop samples. Rolling mean is the default clock."""

from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from apps.core import config
from apps.core.services import sun_times

log = logging.getLogger("ava.schedule")

HST = ZoneInfo("Pacific/Honolulu")
STATE = config.DATA_DIR / "state"
STARTS = STATE / "day-starts.json"
STOPS = STATE / "day-stops.json"
KEEP_DAYS = 60


def _read(path: Path) -> dict:
    if not path.is_file():
        return {"days": {}}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"days": {}}
    if isinstance(raw, dict) and isinstance(raw.get("days"), dict):
        return raw
    return {"days": {}}


def _write(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    days = payload.get("days") or {}
    if len(days) > KEEP_DAYS:
        keep = dict(sorted(days.items())[-KEEP_DAYS:])
        payload = {**payload, "days": keep}
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _today() -> str:
    return datetime.now(HST).strftime("%Y-%m-%d")


def _hhmm_now() -> str:
    return datetime.now(HST).strftime("%H:%M")


def mean_hhmm(days: dict) -> str | None:
    minutes: list[int] = []
    for raw in (days or {}).values():
        parsed = sun_times.parse_hhmm(str(raw))
        if parsed:
            minutes.append(parsed[0] * 60 + parsed[1])
    if not minutes:
        return None
    avg = int(round(sum(minutes) / len(minutes)))
    return f"{avg // 60:02d}:{avg % 60:02d}"


def sample_day_start() -> str | None:
    """First desk-awake after sunrise and before 14:00 HST."""
    if not sun_times.in_day_start_window():
        return None
    stored = _read(STARTS)
    day = _today()
    if day in (stored.get("days") or {}):
        return stored["days"][day]
    hhmm = _hhmm_now()
    stored.setdefault("days", {})[day] = hhmm
    stored["updated"] = datetime.now(HST).isoformat()
    _write(STARTS, stored)
    log.info("day-start %s %s", day, hhmm)
    return hhmm


def sample_day_stop() -> str | None:
    stored = _read(STOPS)
    day = _today()
    now = datetime.now(HST)
    if now.hour < 18:
        return stored.get("days", {}).get(day)
    hhmm = _hhmm_now()
    stored.setdefault("days", {})[day] = hhmm
    stored["updated"] = now.isoformat()
    _write(STOPS, stored)
    log.info("day-stop %s %s", day, hhmm)
    return hhmm


def start_stats() -> dict:
    days = (_read(STARTS).get("days") or {})
    avg = mean_hhmm(days)
    return {"days": days, "sampleDays": len(days), "average": avg}


def stop_stats() -> dict:
    days = (_read(STOPS).get("days") or {})
    avg = mean_hhmm(days)
    return {"days": days, "sampleDays": len(days), "average": avg}

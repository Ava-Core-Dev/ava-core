"""Ops schedule banner for local Ava boards. Not painted on cold holding."""

from __future__ import annotations

import json
from pathlib import Path

from apps.core import config

PATH = config.DATA_DIR / "state" / "ops-schedule-banner.json"

DEFAULT = {
    "enabled": False,
    "autoLowBank": True,
    "showStart": True,
    "showShutdown": True,
}


def read() -> dict:
    if not PATH.is_file():
        return dict(DEFAULT)
    try:
        raw = json.loads(PATH.read_text(encoding="utf-8"))
    except Exception:
        return dict(DEFAULT)
    if not isinstance(raw, dict):
        return dict(DEFAULT)
    out = dict(DEFAULT)
    for k in DEFAULT:
        if k in raw:
            out[k] = bool(raw[k])
    return out


def write(patch: dict) -> dict:
    stored = read()
    for k in DEFAULT:
        if k in patch and patch[k] is not None:
            stored[k] = bool(patch[k])
    PATH.parent.mkdir(parents=True, exist_ok=True)
    PATH.write_text(json.dumps(stored, indent=2), encoding="utf-8")
    return stored


# Match load_categories / desk roles: meaningful PV, not noise or E-Batt.
PV_ACTIVE_W = 20.0


def paint(
    *,
    hours_to_empty: float | None = None,
    solar_in_w: float | None = None,
    host_battery_pct: float | None = None,
    host_plugged: bool | None = None,
    start_label: str = "",
    shutdown_label: str = "",
    after_sunset: bool = False,
    sun: dict | None = None,
) -> dict:
    cfg = read()
    sun = sun or {}
    hours = hours_to_empty
    low = hours is not None and hours <= 3
    # True PV only (load_categories.solar_in_w). E-Batt on MPPT is not PV.
    try:
        pv = float(solar_in_w) if solar_in_w is not None else 0.0
    except (TypeError, ValueError):
        pv = 0.0
    pv_in = pv >= PV_ACTIVE_W
    auto = bool(cfg["autoLowBank"] and low and not pv_in)
    show = bool(cfg["enabled"] or auto)
    title = ""
    detail = ""
    kicker = "Schedule"
    if auto:
        kicker = "Power"
        title = "Site power is running low"
        hours_txt = f"About {hours:g} hours left on the site bank." if hours is not None else "The site bank is low."
        extra = " Starlink and the public site will go dark."
        host_ok = (host_plugged is True) or (host_battery_pct is not None and host_battery_pct >= 15)
        if host_ok:
            extra += " The Root Server can keep offline tasks on its own battery. That is not Starlink power."
        detail = hours_txt + extra
        if after_sunset or sun.get("after_sunset"):
            sett = sun.get("sunset") or ""
            if sett:
                detail += f" After sunset ({sett} HST)."
    elif cfg["enabled"]:
        bits = []
        if cfg["showStart"] and start_label:
            bits.append(f"Projected start {start_label}.")
        if cfg["showShutdown"] and shutdown_label:
            bits.append(f"Projected shutdown {shutdown_label}.")
        title = "Desk hours"
        detail = " ".join(bits) or "Projected start and shutdown are on."
        if sun.get("after_sunset"):
            kicker = "After sunset"
    return {
        "ok": True,
        **cfg,
        "show": show,
        "auto": auto,
        "category": "power" if auto else "schedule",
        "categoryLabel": kicker,
        "title": title,
        "detail": detail,
        "hours_to_empty": hours,
        "solar_in_w": round(pv, 1) if solar_in_w is not None else None,
        "pv_suppress": pv_in,
        "host_battery_pct": host_battery_pct,
        "after_sunset": bool(after_sunset or sun.get("after_sunset")),
        "sunrise": (sun or {}).get("sunrise") or "",
        "sunset": (sun or {}).get("sunset") or "",
        "startLabel": start_label,
        "shutdownLabel": shutdown_label,
    }

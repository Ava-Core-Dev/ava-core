"""Status, solar, and power routes."""

from __future__ import annotations

import platform
import time
from datetime import datetime, timezone
from pathlib import Path

import psutil
from fastapi import APIRouter
from fastapi.responses import HTMLResponse, JSONResponse

from .. import config
from ..heartbeat import last_success_age_s
from ..scheduler import Scheduler

router = APIRouter()

_start_time = time.time()


@router.get("/")
async def root():
    return JSONResponse({"redirect": "https://avaivy.cloud/solar", "ava": "online"})


def _solar_html() -> str:
    path = Path(__file__).resolve().parent.parent / "templates" / "solar.html"
    return path.read_text(encoding="utf-8") if path.is_file() else "<p>solar desk missing</p>"


@router.get("/solar")
@router.get("/solar/")
async def solar_page():
    return HTMLResponse(_solar_html())


@router.get("/health")
async def health():
    return {"ok": True, "uptime_s": int(time.time() - _start_time)}


@router.get("/api/status")
async def api_status():
    cpu = psutil.cpu_percent(interval=None)
    mem = psutil.virtual_memory()
    uptime = int(time.time() - _start_time)
    heartbeat_age = last_success_age_s()
    from apps.core.services.broadcast import live_payload

    live = await live_payload()

    return {
        "version": "2.0.0",
        "ts": datetime.now(timezone.utc).isoformat(),
        "uptime_s": uptime,
        "host": platform.node(),
        "cpu_pct": cpu,
        "mem_pct": round(mem.percent, 1),
        "heartbeat_age_s": round(heartbeat_age, 1) if heartbeat_age is not None else None,
        "streaming": bool(live.get("streaming")),
        "live": live,
        "config": {
            "port": config.AVA_PORT,
            "env": config.AVA_ENV,
            "scheduler": config.ENABLE_SCHEDULER,
            "voice_mode": config.VOICE_MODE,
        },
    }


@router.get("/api/live")
async def api_live():
    from apps.core.services.broadcast import live_payload

    return await live_payload()


@router.get("/api/solar")
async def api_solar():
    """Solar dashboard JSON — live EcoFlow when configured, else latest report."""
    import json, re
    from pathlib import Path

    try:
        from apps.core.crons.solar_weather import live_snapshot
        live = await live_snapshot()
        if live.get("battery_pct") is not None or live.get("power_w"):
            return live
    except Exception:
        live = {}

    reports = list(config.REPORTS_DIR.glob("solar-weather-*.md"))
    if not reports:
        if live:
            return live
        return JSONResponse({"error": "no solar reports found"}, status_code=404)

    latest = max(reports, key=lambda p: p.stat().st_mtime)
    text = latest.read_text(errors="replace")

    def find(pattern: str, default=None):
        m = re.search(pattern, text, re.IGNORECASE)
        return m.group(1).strip() if m else default

    bank = find(r"SOC\s*(\d+)%") or find(r"Bank:\s*(\d+)%")
    watts = find(r"in\s*(\d+)W") or find(r"solar in\s*(\d+)W")
    offline = "offline" in text.lower() and not bank
    return {
        "report_file": latest.name,
        "bank_pct": bank,
        "solar_in_w": watts,
        "delta2_soc": find(r"Delta 2.*?SOC\s*(\d+)%"),
        "river2_soc": find(r"River 2 Pro.*?SOC\s*(\d+)%"),
        "conditions": find(r"Conditions:\s*(.+)"),
        "voltage": None,
        "current": None,
        "power_w": int(watts) if watts and str(watts).isdigit() else watts,
        "battery_pct": int(bank) if bank and str(bank).isdigit() else ("offline" if offline else bank),
        "state": "offline" if offline else (find(r"state[:\s]+(\w+)") or "see report"),
        "kwh_today": find(r"kwh[_\s-]*today[:\s]+([\d.]+)"),
        "kwh_total": find(r"kwh[_\s-]*total[:\s]+([\d.]+)"),
        "panel_temp_c": find(r"temp[:\s]+([\d.]+)"),
        "raw": text[:2000],
        "source": "report_file",
    }


@router.get("/api/solar/history")
async def api_solar_history(hours: float = 12):
    """EcoFlow + host history — solar_w, load_w, soc, cpu_pct over the last N hours."""
    try:
        from apps.core.crons.solar_weather import history_points
        return history_points(hours)
    except Exception as exc:
        return JSONResponse(
            {"ok": False, "points": [], "hours": hours, "error": str(exc)[:200]},
            status_code=500,
        )


@router.get("/status")
@router.get("/status/")
@router.get("/ava")
@router.get("/ava/")
@router.get("/ava/status")
@router.get("/ava/status/")
async def ava_status_page():
    """Full solar desk — same board as /solar — for every /status surface."""
    return HTMLResponse(_solar_html())


@router.get("/ava/status.json")
async def ava_status_json():
    age = last_success_age_s()
    return {
        "host": platform.node() or "ava-core",
        "online": True,
        "last_seen": datetime.now(timezone.utc).isoformat(),
        "heartbeat_age_s": round(age, 1) if age is not None else None,
        "reason": "ok",
    }

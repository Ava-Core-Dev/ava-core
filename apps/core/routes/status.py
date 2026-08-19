"""Status, solar, and power routes."""

from __future__ import annotations

import platform
import time
from datetime import datetime, timezone

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
    return JSONResponse({"redirect": "https://rootrecord.online/status", "ava": "online"})


@router.get("/health")
async def health():
    return {"ok": True, "uptime_s": int(time.time() - _start_time)}


@router.get("/api/status")
async def api_status():
    cpu = psutil.cpu_percent(interval=None)
    mem = psutil.virtual_memory()
    uptime = int(time.time() - _start_time)
    heartbeat_age = last_success_age_s()

    return {
        "version": "2.0.0",
        "ts": datetime.now(timezone.utc).isoformat(),
        "uptime_s": uptime,
        "host": platform.node(),
        "cpu_pct": cpu,
        "mem_pct": round(mem.percent, 1),
        "heartbeat_age_s": round(heartbeat_age, 1) if heartbeat_age is not None else None,
        "config": {
            "port": config.AVA_PORT,
            "env": config.AVA_ENV,
            "scheduler": config.ENABLE_SCHEDULER,
            "voice_mode": config.VOICE_MODE,
        },
    }


@router.get("/api/solar")
async def api_solar():
    """Solar dashboard JSON — reads latest solar-weather report from disk."""
    import json, re
    from pathlib import Path

    reports = list(config.REPORTS_DIR.glob("solar-weather-*.md"))
    if not reports:
        return JSONResponse({"error": "no solar reports found"}, status_code=404)

    latest = max(reports, key=lambda p: p.stat().st_mtime)
    text = latest.read_text(errors="replace")

    # Extract key values with regex
    def find(pattern: str, default="?"):
        m = re.search(pattern, text, re.IGNORECASE)
        return m.group(1).strip() if m else default

    return {
        "report_file": latest.name,
        "bank_pct": find(r"Bank:\s*(\d+)%"),
        "solar_in_w": find(r"solar in\s*(\d+)W"),
        "delta2_soc": find(r"Delta 2.*?SOC\s*(\d+)%"),
        "river2_soc": find(r"River 2 Pro.*?SOC\s*(\d+)%"),
        "conditions": find(r"Conditions\s*\n(.+)"),
        "raw": text[:2000],
    }

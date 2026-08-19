"""
Real-world data routes — Kīlauea alert state and NOAA weather snapshot.
These read from on-disk reports written by the cron jobs, so they respond
instantly with no upstream API calls.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .. import config

router = APIRouter(prefix="/api")


@router.get("/kilauea")
async def api_kilauea():
    """Current Kīlauea alert level + economy multiplier from latest cron state."""
    state_path = config.DATA_DIR / "state" / "kilauea-alert.json"
    if state_path.exists():
        try:
            state = json.loads(state_path.read_text())
            return state
        except Exception:
            pass

    # Fall back to scanning latest kilauea report for event count
    reports = sorted(
        config.REPORTS_DIR.glob("kilauea-*.md"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    if not reports:
        return JSONResponse({"error": "no kilauea data yet"}, status_code=404)

    text = reports[0].read_text(errors="replace")
    events_match = re.search(r"Events.*?:\s*(\d+)", text)
    mag_match     = re.search(r"M([\d.]+)", text)

    return {
        "alert_level":     "normal",
        "multiplier":      1.0,
        "events_nearby":   int(events_match.group(1)) if events_match else 0,
        "max_magnitude":   float(mag_match.group(1)) if mag_match else 0.0,
        "updated_at":      datetime.fromtimestamp(
                               reports[0].stat().st_mtime, tz=timezone.utc
                           ).isoformat(),
        "source":          "report_file",
    }


@router.get("/weather")
async def api_weather():
    """Latest NWS Big Island forecast + active alert count."""
    reports = sorted(
        config.REPORTS_DIR.glob("nws-weather-*.md"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    if not reports:
        return JSONResponse({"error": "no weather data yet"}, status_code=404)

    text = reports[0].read_text(errors="replace")

    # Parse first forecast period
    period_match  = re.search(r"###?\s*(.+)", text)
    temp_match    = re.search(r"(\d+)°[FC]", text)
    short_match   = re.search(r"(?:###?.+\n)([\w ,']+)", text)
    alert_count   = len(re.findall(r"^\*\*.*\*\*", text, re.MULTILINE))

    return {
        "period":         period_match.group(1).strip() if period_match else "?",
        "temperature_f":  int(temp_match.group(1)) if temp_match else None,
        "forecast":       short_match.group(1).strip() if short_match else "see report",
        "alerts_active":  alert_count,
        "updated_at":     datetime.fromtimestamp(
                              reports[0].stat().st_mtime, tz=timezone.utc
                          ).isoformat(),
    }


class VoicePlayRequest(BaseModel):
    clip: str = "phrase_device_startup"
    priority: str = "critical"


@router.post("/voice/play")
async def api_voice_play(req: VoicePlayRequest):
    """Trigger a named voice clip through the Stream Director."""
    try:
        from apps.voice.director import get_director, Priority
        from apps.voice.clips import WORDS_DIR

        clip_path = WORDS_DIR / f"{req.clip}.mp3"
        if not clip_path.exists():
            return JSONResponse({"error": f"clip not found: {req.clip}"}, status_code=404)

        pri = getattr(Priority, req.priority.upper(), Priority.CRITICAL)
        director = get_director()
        import asyncio
        asyncio.create_task(director.queue(clip_path, name=req.clip, priority=pri))
        return {"ok": True, "clip": req.clip, "priority": req.priority}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

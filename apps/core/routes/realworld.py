"""
Real-world data routes — Kīlauea alert state and NOAA weather snapshot.
These read from on-disk reports written by the cron jobs, so they respond
instantly with no upstream API calls.
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .. import config

router = APIRouter(prefix="/api")


def _local(request: Request) -> bool:
    if request.headers.get("cf-ray") or request.headers.get("cf-connecting-ip"):
        return False
    host = request.client.host if request.client else ""
    return host in {"127.0.0.1", "::1"}


@router.get("/kilauea")
async def api_kilauea():
    """Current Kīlauea alert level + economy multiplier from latest cron state."""
    state_path = config.DATA_DIR / "state" / "kilauea-alert.json"
    if state_path.exists():
        try:
            state = json.loads(state_path.read_text(encoding="utf-8"))
            return state
        except Exception:
            pass

    # Fall back to scanning latest kilauea report for event count
    from apps.core.services.reports import latest_report

    report = latest_report("kilauea-*.md")
    if not report:
        return JSONResponse({"error": "no kilauea data yet"}, status_code=404)

    text = report.read_text(encoding="utf-8", errors="replace")
    events_match = re.search(r"Events.*?:\s*(\d+)", text)
    mag_match     = re.search(r"M([\d.]+)", text)

    return {
        "alert_level":     "normal",
        "multiplier":      1.0,
        "events_nearby":   int(events_match.group(1)) if events_match else 0,
        "max_magnitude":   float(mag_match.group(1)) if mag_match else 0.0,
        "updated_at":      datetime.fromtimestamp(
                               report.stat().st_mtime, tz=timezone.utc
                           ).isoformat(),
        "source":          "report_file",
    }


@router.get("/business")
async def api_business(request: Request):
    """Business Manager — this PC only. Not a public dashboard."""
    held = JSONResponse(
        {
            "ok": False,
            "status": "held",
            "detail": "Business Manager is not public.",
        },
        status_code=503,
    )
    if not _local(request):
        return held
    ledger = config.DATA_DIR / "finance" / "ops-ledger.json"
    if not ledger.is_file():
        return held
    try:
        data = json.loads(ledger.read_text(encoding="utf-8"))
    except Exception:
        return held
    if not isinstance(data, dict) or not data:
        return held
    return {
        "ok": True,
        "public": False,
        "status": "internal",
        "ledger_ok": True,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/membership")
async def api_membership(request: Request, q: str = ""):
    """Membership lookup — this PC only. Calls RootMC's API for stats; local store for identifiers."""
    held = JSONResponse(
        {"ok": False, "status": "held", "detail": "Membership is not public."},
        status_code=503,
    )
    if not _local(request):
        return held
    from apps.core.services import membership as membership_svc

    if q.strip():
        return await membership_svc.lookup(q.strip())
    return await membership_svc.board()


@router.get("/identity")
async def api_identity(request: Request):
    """Identifier counts only — this PC only. No email/UUID lists."""
    if not _local(request):
        return JSONResponse({"ok": False}, status_code=404)
    from apps.core.services import identities as ident_svc

    return {
        "ok": True,
        "public": False,
        "store": str(ident_svc.db_path()),
        "counts": ident_svc.counts(),
    }


@router.get("/weather")
async def api_weather():
    """Latest NWS Big Island forecast + active alert count."""
    from apps.core.services.reports import latest_report

    report = latest_report("nws-weather-*.md")
    if not report:
        return JSONResponse({"error": "no weather data yet"}, status_code=404)

    text = report.read_text(encoding="utf-8", errors="replace")

    period_match = re.search(r"^###\s+(.+)$", text, re.MULTILINE)
    temp_match = re.search(r"(\d+)°[FC]", text)
    short_match = re.search(
        r"^###\s+.+\n+(\d+°[FC]\s*[—\-]+\s*[^\n]+|.+)",
        text,
        re.MULTILINE,
    )
    alert_count = len(re.findall(r"^\*\*.*\*\*", text, re.MULTILINE))
    forecast = (short_match.group(1).strip() if short_match else "") or "see report"

    return {
        "period": period_match.group(1).strip() if period_match else "?",
        "temperature_f": int(temp_match.group(1)) if temp_match else None,
        "forecast": forecast,
        "alerts_active": alert_count,
        "updated_at": datetime.fromtimestamp(
            report.stat().st_mtime, tz=timezone.utc
        ).isoformat(),
    }


class VoicePlayRequest(BaseModel):
    clip: str = "phrase_device_startup"
    priority: str = "critical"
    force: bool = False  # bypass cooldown for intentional ops triggers


class VoiceNumberRequest(BaseModel):
    number: int
    priority: str = "report"


@router.post("/voice/speak-number")
async def api_voice_speak_number(req: VoiceNumberRequest):
    """Build a spoken integer from on-disk Ara clips and queue it."""
    try:
        from apps.voice.director import Priority, get_director

        pri = getattr(Priority, req.priority.upper(), Priority.REPORT)
        director = get_director()
        path = await director.queue_number(req.number, priority=pri)
        if not path:
            return JSONResponse({"ok": False, "detail": "no_clips"}, status_code=404)
        return {"ok": True, "number": req.number, "mp3": path.name}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@router.post("/voice/play")
async def api_voice_play(req: VoicePlayRequest):
    """Trigger a named voice clip through the Stream Director.
    Looks in words/, time_clips/, and sounds/ under assets.
    phrase_device_startup respects a 30m cooldown unless force=true.
    """
    try:
        from apps.voice.director import get_director, Priority
        from apps.voice.clips import WORDS_DIR, TIME_DIR, SOUNDS_DIR, ASSETS_DIR

        # "I'm back" — never spam on brief reconnects / GUI reloads
        if req.clip in ("phrase_device_startup", "startup"):
            from apps.core.services.startup_voice import queue_if_allowed

            result = await queue_if_allowed(force=req.force, name=req.clip)
            if not result.get("ok"):
                return JSONResponse(result, status_code=404)
            return {
                "ok": True,
                "clip": req.clip,
                "played": bool(result.get("played")),
                "detail": result.get("detail"),
                "priority": req.priority,
            }

        candidates = [
            WORDS_DIR / f"{req.clip}.mp3",
            TIME_DIR / f"{req.clip}.mp3",
            SOUNDS_DIR / f"{req.clip}.mp3",
            ASSETS_DIR / f"{req.clip}.mp3",
        ]
        clip_path = next((p for p in candidates if p.exists()), None)
        if not clip_path:
            return JSONResponse({"error": f"clip not found: {req.clip}"}, status_code=404)

        pri = getattr(Priority, req.priority.upper(), Priority.CRITICAL)
        director = get_director()
        import asyncio
        asyncio.create_task(director.queue(clip_path, name=req.clip, priority=pri))
        return {"ok": True, "clip": req.clip, "path": clip_path.name, "priority": req.priority}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@router.post("/voice/chime")
async def api_voice_chime():
    """Fire the half-hourly chime now (bell + current time_HHMM slot)."""
    try:
        from apps.core.crons.since_last_fire.hourly_chime import run
        await run()
        return {"ok": True, "job": "hourly_chime"}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@router.get("/activity")
async def api_activity(limit: int = 220):
    """
    Terminal live activity feed — running crons, scheduler state, Ollama status.
    Replaces the old Node.js /api/activity endpoint.
    """
    from apps.core.main import _scheduler

    running_crons: list[dict] = []
    jobs: list[dict] = []
    try:
        if _scheduler:
            jobs = _scheduler.get_jobs()
    except Exception:
        pass

    # Read last N lines from core log as activity feed (session or systemd)
    logs: list[str] = []
    try:
        for name in ("ava-core-session.log", "ava-core.log", "ava-core-systemd.log"):
            log_path = config.DATA_DIR / "logs" / name
            if log_path.exists():
                try:
                    lines = log_path.read_text(errors="replace").splitlines()
                    logs = lines[-limit:]
                    break
                except Exception:
                    continue
    except Exception:
        pass

    # Cached Ollama ping — GUI polls this every few seconds
    from ..services.ollama import tags as ollama_tags

    ollama_up, ollama_models = await ollama_tags()

    processes = []
    try:
        import psutil
        for p in psutil.process_iter(["pid", "name", "cmdline", "cpu_percent"]):
            cmd = " ".join(p.info.get("cmdline") or [])
            name = p.info.get("name") or ""
            kind = None
            if "ollama" in name.lower() or "/ollama" in cmd:
                kind = "ollama"
            elif "uvicorn" in cmd or "apps.core.main" in cmd:
                kind = "ava"
            if kind:
                processes.append(
                    {
                        "kind": kind,
                        "pid": p.info["pid"],
                        "comm": name,
                        "cpu": round(float(p.info.get("cpu_percent") or 0), 1),
                        "etime": "",
                        "args": cmd[:80],
                    }
                )
    except Exception:
        processes = []

    return {
        "ok": True,
        "label": "idle",
        "ollamaBusy": False,
        "inflight": [],
        "runningCrons": running_crons,
        "ollama": {
            "up": ollama_up,
            "model": ollama_models[0] if ollama_models else None,
            "models": ollama_models,
            "baseUrl": "http://127.0.0.1:11434",
            "ps": [{"name": n} for n in ollama_models[:4]],
        },
        "jobs": jobs,
        "logs": logs[-limit:],
        "processes": processes[:12],
        "heartbeat": {"pid": os.getpid()},
        "ts": datetime.now(timezone.utc).isoformat(),
    }

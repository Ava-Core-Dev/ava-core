"""Public Kīlauea / mobile JSON for apps on rootrecord.cloud.

Reads files written under ``data/state`` by the Kīlauea cron. Honest empty
payloads when a file is missing — never invent alert levels or AQI.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from apps.core import config
from apps.core.services.kilauea_cams import DEFAULT_CAMS

router = APIRouter(prefix="/api")


def _state(name: str) -> Path:
    return config.DATA_DIR / "state" / name


def _read_json(path: Path) -> dict | list | None:
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    return data


def _default_streams() -> dict:
    streams = []
    for cam in DEFAULT_CAMS:
        vid = cam.get("youtube_video_id") or ""
        streams.append(
            {
                "id": cam["id"],
                "title": cam.get("title") or cam["id"],
                "description": "USGS official cam (local Root Server catalog).",
                "youtube_video_id": vid,
                "watch_url": f"https://www.youtube.com/watch?v={vid}",
                "embed_url": f"https://www.youtube.com/embed/{vid}?autoplay=1&playsinline=1&rel=0&modestbranding=1",
            }
        )
    return {
        "streams": streams,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "source": "local_defaults",
    }


@router.get("/mobile/kilauea-live-streams")
async def mobile_live_streams():
    data = _read_json(_state("kilauea-live-streams.json"))
    if isinstance(data, dict) and data.get("streams"):
        return data
    return _default_streams()


@router.get("/mobile/kilauea-situation")
async def mobile_situation():
    data = _read_json(_state("kilauea-situation.json"))
    if isinstance(data, dict) and "situation" in data:
        return data
    alert = _read_json(_state("kilauea-alert.json"))
    if isinstance(alert, dict):
        level = str(alert.get("alert_level") or "normal")
        headline = str(alert.get("headline") or level)
        return {
            "situation": {
                "id": "current",
                "name": headline[:80],
                "enabled": level not in {"", "normal"} or bool(alert.get("erupting")),
                "body": headline,
                "updated_at": alert.get("updated_at") or datetime.now(timezone.utc).isoformat(),
            }
        }
    return {"situation": {"id": "current", "name": "", "enabled": False, "body": "", "updated_at": ""}}


@router.get("/mobile/kilauea-ai-analyses")
async def mobile_ai_analyses(limit: int = Query(10, ge=1, le=50)):
    data = _read_json(_state("kilauea-ai-analyses.json"))
    if isinstance(data, dict):
        rows = data.get("analyses") or data.get("items") or []
        if isinstance(rows, list):
            return {"analyses": rows[:limit], "source": data.get("source") or "local"}
    return {"analyses": [], "source": "empty", "detail": "No local analyses yet."}


@router.get("/mobile/developer-messages")
async def mobile_developer_messages(app_id: str = "rootrecord_kilauea_alerts_android"):
    data = _read_json(_state("developer-messages.json"))
    if isinstance(data, dict) and isinstance(data.get("messages"), list):
        return data
    return {"messages": [], "app_id": app_id}


@router.get("/air-quality/current")
async def air_quality_current(lat: float = 19.43, lon: float = -155.23):
    data = _read_json(_state("air-quality-current.json"))
    if isinstance(data, dict) and data.get("ok") is not False:
        return data
    return {
        "ok": False,
        "lat": lat,
        "lon": lon,
        "detail": "Air quality not live on this desk yet.",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/photos/gallery")
async def photos_gallery(limit: int = Query(30, ge=1, le=100), cursor: str | None = None):
    data = _read_json(_state("photos-gallery.json"))
    if isinstance(data, dict):
        return data
    return {"photos": [], "next_cursor": None, "detail": "No approved gallery on this desk yet."}


@router.get("/dashboard")
async def api_dashboard(
    lat: float = 19.43,
    lon: float = -155.23,
    location_id: str | None = None,
    refresh: bool | None = None,
):
    data = _read_json(_state("kilauea-dashboard.json"))
    if isinstance(data, dict):
        return data
    alert = _read_json(_state("kilauea-alert.json")) or {}
    weather = _read_json(config.DATA_DIR / "state" / "weather-snapshot.json") or {}
    return {
        "ok": True,
        "lat": lat,
        "lon": lon,
        "location_id": location_id,
        "kilauea": alert if isinstance(alert, dict) else {},
        "weather": weather if isinstance(weather, dict) else {},
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "source": "local_compose",
    }

"""Plugin status route."""
from fastapi import APIRouter
router = APIRouter(prefix="/api")

@router.get("/plugins")
async def api_plugins():
    return {
        "ok": True,
        "voice_plugins": [
            "hourly_chime", "voice_report", "nws_weather", "open_meteo",
            "earthquake_global", "earthquake_hawaii", "kilauea_report", "youtube_stats",
        ],
        "status": "running",
    }


@router.get("/plugins/status")
async def api_plugins_status():
    body = await api_plugins()
    return {**body, "jobs": []}


@router.get("/apps/status")
async def api_apps_status():
    return {"ok": True, "apps": [], "detail": "managed_on_origin"}

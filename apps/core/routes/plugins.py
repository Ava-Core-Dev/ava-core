"""Plugin status route."""
from fastapi import APIRouter
router = APIRouter(prefix="/api")

@router.get("/plugins")
async def api_plugins():
    return {
        "voice_plugins": [
            "hourly_chime", "voice_report", "nws_weather", "open_meteo",
            "earthquake_global", "earthquake_hawaii", "kilauea_report", "youtube_stats",
        ],
        "status": "running",
    }

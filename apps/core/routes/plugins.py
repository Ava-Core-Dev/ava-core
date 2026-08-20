"""Plugin status route."""
from fastapi import APIRouter

from .. import config

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


def _release_status(kind: str) -> dict:
    root = config.PLUGIN_DIR if kind == "plugins" else (config.AVA_HOME / "apps")
    targets = []
    if root.is_dir():
        for child in sorted(root.iterdir()):
            if child.is_dir() and not child.name.startswith("."):
                targets.append({"id": child.name, "label": child.name, "version": None})
    import shutil

    return {
        "ok": True,
        "kind": kind,
        "busy": False,
        "javaReady": bool(shutil.which("javac") or shutil.which("java")),
        "targets": targets,
        "artifacts": [],
        "status": {"state": "idle", "logTail": "Idle — Python origin does not run the JDK release pipeline."},
        "public": {"public": ""},
        "sync": {},
    }


@router.get("/plugins/status")
async def api_plugins_status():
    body = await api_plugins()
    return {**body, **_release_status("plugins")}


@router.get("/apps/status")
async def api_apps_status():
    return _release_status("apps")

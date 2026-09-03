"""Plugin status route."""
from __future__ import annotations

import shutil
from pathlib import Path

from fastapi import APIRouter

from .. import config

router = APIRouter(prefix="/api")

_JDK_ROOTS = (
    Path(r"C:\Program Files\Microsoft"),
    Path(r"C:\Program Files\Eclipse Adoptium"),
    Path(r"C:\Program Files\Java"),
)


def _java_ready() -> bool:
    if shutil.which("javac") or shutil.which("java"):
        return True
    for root in _JDK_ROOTS:
        if root.is_dir() and next(root.glob("jdk-*/bin/java.exe"), None):
            return True
    return False

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
            if child.is_dir() and not child.name.startswith(".") and child.name != "__pycache__":
                targets.append({"id": child.name, "label": child.name, "version": None})

    return {
        "ok": True,
        "kind": kind,
        "busy": False,
        "javaReady": _java_ready(),
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

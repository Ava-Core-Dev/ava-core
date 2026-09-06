"""Download and archive the NWS Hawaii radar loop."""

from __future__ import annotations

import io
import json
import logging
import zipfile
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

from apps.core import config

log = logging.getLogger("ava.radar_archive")
HST = ZoneInfo("Pacific/Honolulu")
URL = "https://radar.weather.gov/ridge/standard/HAWAII_loop.gif"
RADAR_DIR = config.PUBLIC_MEDIA / "images" / "weather" / "gifs" / "archive"
ZIP_PATH = RADAR_DIR / "radar_archive.zip"
CURRENT_PATH = RADAR_DIR / "radar_archive-current.gif"
STATE_PATH = config.DATA_DIR / "state" / "radar-archive.json"


def _save_state(payload: dict) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def fetch_and_archive() -> dict:
    RADAR_DIR.mkdir(parents=True, exist_ok=True)
    response = requests.get(URL, timeout=45, headers={"User-Agent": "AvaIvy/2.0 radar archive"})
    response.raise_for_status()
    data = response.content
    if not data.startswith((b"GIF87a", b"GIF89a")):
        raise ValueError("radar response is not a GIF")

    stamp = datetime.now(HST).strftime("%Y%m%d-%H%M%S")
    gif_name = f"radar_archive-{stamp}.gif"
    gif_path = RADAR_DIR / gif_name
    gif_path.write_bytes(data)
    CURRENT_PATH.write_bytes(data)

    entries: dict[str, bytes] = {}
    if ZIP_PATH.is_file():
        with zipfile.ZipFile(ZIP_PATH, "r") as archive:
            for name in archive.namelist():
                if name.startswith("radar_archive-") and name.endswith(".gif"):
                    entries[name] = archive.read(name)
    entries[gif_name] = data
    temp_zip = ZIP_PATH.with_suffix(".zip.tmp")
    with zipfile.ZipFile(temp_zip, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name in sorted(entries):
            archive.writestr(name, entries[name])
    temp_zip.replace(ZIP_PATH)

    payload = {
        "ok": True,
        "url": URL,
        "gif": str(gif_path),
        "current": str(CURRENT_PATH),
        "zip": str(ZIP_PATH),
        "bytes": len(data),
        "archived_count": len(entries),
        "updated_at": datetime.now(HST).isoformat(),
    }
    _save_state(payload)
    return payload


def run() -> dict:
    try:
        return fetch_and_archive()
    except Exception as exc:
        payload = {"ok": False, "url": URL, "detail": str(exc)[:300]}
        _save_state(payload)
        log.warning("radar archive failed: %s", exc)
        return payload

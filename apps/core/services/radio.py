"""Root Record Radio — program bus state (not desktop loopback).

local_playback: pygame/speakers on this PC (Desk toggle)
on_air: public /radio player + SSE may serve program events
mic_armed: flag only until a named capture device is wired

Never capture WASAPI desktop mix.
"""
from __future__ import annotations

import json
import logging
import os
import shutil
import time
from pathlib import Path
from typing import Any

from apps.core import config

log = logging.getLogger("ava.radio")

STATE_NAME = "radio.json"
WAKE_HOLD_S = 20 * 60


def _state_path() -> Path:
    return config.DATA_DIR / "state" / STATE_NAME


def _default() -> dict[str, Any]:
    return {
        "local_playback": False,
        "on_air": False,
        "mic_armed": False,
        "mic_device": "",
        "wake_until": 0,
        "on_air_sticky": True,
        "hurricane_on_radio": True,
        "feedback_popup": True,
        "voice_inserts": True,
        "last_track": "",
        "updated_at": 0,
    }


def load() -> dict[str, Any]:
    path = _state_path()
    if not path.is_file():
        return _default()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return _default()
        out = _default()
        out.update({k: data.get(k, out[k]) for k in out})
        out["local_playback"] = bool(data.get("local_playback"))
        out["on_air"] = bool(data.get("on_air"))
        out["mic_armed"] = bool(data.get("mic_armed"))
        out["on_air_sticky"] = bool(data.get("on_air_sticky", True))
        out["hurricane_on_radio"] = bool(data.get("hurricane_on_radio", True))
        out["feedback_popup"] = bool(data.get("feedback_popup", True))
        out["voice_inserts"] = bool(data.get("voice_inserts", True))
        out["mic_device"] = str(data.get("mic_device") or "")[:120]
        out["last_track"] = str(data.get("last_track") or "")[:500]
        out["wake_until"] = int(data.get("wake_until") or 0)
        out["updated_at"] = int(data.get("updated_at") or 0)
        return out
    except Exception:
        return _default()


def save(data: dict[str, Any]) -> dict[str, Any]:
    path = _state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    data = dict(data)
    data["updated_at"] = int(time.time())
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    return data


def patch(**kwargs: Any) -> dict[str, Any]:
    st = load()
    for k, v in kwargs.items():
        if k in st:
            st[k] = v
    return save(st)


def wake(*, seconds: int = WAKE_HOLD_S) -> dict[str, Any]:
    st = load()
    st["wake_until"] = int(time.time()) + max(60, int(seconds))
    return save(st)


def visitor_awake() -> bool:
    st = load()
    return int(time.time()) < int(st.get("wake_until") or 0)


def serving_public() -> bool:
    """Public program stream only when intentionally on air."""
    return bool(load().get("on_air"))


def tool_status() -> dict[str, Any]:
    ffmpeg = _which_media("ffmpeg")
    icecast = shutil.which("icecast") or shutil.which("icecast2") or ""
    liquidsoap = shutil.which("liquidsoap") or ""
    return {
        "ffmpeg": bool(ffmpeg),
        "ffmpeg_path": ffmpeg,
        "icecast": bool(icecast),
        "icecast_path": icecast,
        "liquidsoap": bool(liquidsoap),
        "liquidsoap_path": liquidsoap,
        "encoder_ready": bool(ffmpeg and icecast),
        "encode_mode": (
            "icecast+ffmpeg"
            if (ffmpeg and icecast)
            else "ffmpeg_live_mp3"
            if ffmpeg
            else "origin_file_sse"
        ),
        "desktop_loopback": False,
        "note": (
            "ffmpeg live remux at /radio/live.mp3 when on air. "
            "Icecast optional for multi-mount later."
            if ffmpeg
            else "Install ffmpeg (winget Gyan.FFmpeg) for live remux."
        ),
    }


def _which_media(name: str) -> str:
    found = shutil.which(name) or ""
    if found:
        return found
    # Winget Gyan.FFmpeg often lands here; origin may start before PATH refresh.
    root = Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WinGet" / "Packages"
    if root.is_dir():
        for p in root.glob(f"Gyan.FFmpeg*/ffmpeg-*/bin/{name}.exe"):
            if p.is_file():
                return str(p)
    return ""


def program_url_for_file(path: Path | str) -> str | None:
    """Same-origin URL for a program-bus file. Never desktop capture."""
    from urllib.parse import quote

    p = Path(path)
    if not p.is_file():
        return None
    try:
        rel = p.resolve().relative_to(Path(config.PUBLIC_MEDIA).resolve())
        q = quote(str(rel).replace("\\", "/"))
        return f"/api/media/public/file?path={q}"
    except Exception:
        pass
    try:
        gen = Path(config.GENERATED_DIR).resolve()
        rel = p.resolve().relative_to(gen)
        q = quote(str(rel).replace("\\", "/"))
        return f"/data/generated/{q}"
    except Exception:
        return None


def announce_program_file(path: Path | str, *, name: str = "", insert: bool = False) -> None:
    p = Path(path)
    src = program_url_for_file(p)
    if p.is_file() and not insert:
        try:
            patch(last_track=str(p.resolve()))
        except Exception:
            pass
    if not src and not p.is_file():
        return
    meta: dict = {}
    try:
        from apps.core.services import radio_catalog

        meta = radio_catalog.public_meta(p) if not insert else {}
    except Exception:
        meta = {}
    title = (name or meta.get("title") or p.stem)[:160]
    broadcast_program_event(
        {
            "src": "/radio/live.mp3",
            "live": "/radio/live.mp3",
            "name": title,
            "title": title,
            "description": (
                "Live desk — report or chime"
                if insert
                else (meta.get("description") or "")
            ),
            "id": meta.get("id") or p.name,
            "likes": meta.get("likes") or 0,
            "dislikes": meta.get("dislikes") or 0,
            "priority": 2 if insert else 0,
            "insert": bool(insert),
        }
    )


def status() -> dict[str, Any]:
    st = load()
    tools = tool_status()
    return {
        "ok": True,
        **st,
        "visitor_awake": visitor_awake(),
        "serving_public": serving_public(),
        "tools": tools,
        "listen_local": f"http://127.0.0.1:{config.AVA_PORT}/radio/listen",
        "events_local": f"http://127.0.0.1:{config.AVA_PORT}/radio/events",
        "wake_page": f"http://127.0.0.1:{config.AVA_PORT}/radio",
    }


# SSE listeners for /radio/events (Desk HTML + public player)
_listeners: list = []


def register_listener(q) -> None:
    _listeners.append(q)


def unregister_listener(q) -> None:
    try:
        _listeners.remove(q)
    except ValueError:
        pass


def broadcast_program_event(event: dict) -> None:
    """Push play events when on air or Desk local_playback (HTML listen)."""
    st = load()
    if not (st.get("on_air") or st.get("local_playback")):
        return
    if not _listeners:
        return
    payload = json.dumps(event)
    for q in list(_listeners):
        try:
            q.put_nowait(payload)
        except Exception:
            pass

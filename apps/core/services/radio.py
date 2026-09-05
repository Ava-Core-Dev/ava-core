"""Root Record Radio — program bus state (not desktop loopback).

local_playback: pygame/speakers on this PC (Desk toggle)
on_air: public /radio player + SSE may serve program events
mic_armed: flag only until a named capture device is wired

Never capture WASAPI desktop mix.
"""
from __future__ import annotations

import json
import logging
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
        out["mic_device"] = str(data.get("mic_device") or "")[:120]
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
    ffmpeg = shutil.which("ffmpeg") or ""
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
            else "origin_file_sse"
            if True
            else "off"
        ),
        "desktop_loopback": False,
        "note": (
            "Install Icecast2 + ffmpeg for a classic mount. "
            "Until then, on-air uses origin file URLs + SSE (program bus only)."
        ),
    }


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

"""Startup voice: short reconnect vs device-up.

Downtime under 60s → satellite_connection.mp3.
Longer (and past the 30m spam gate, or first boot) → phrase_all_systems_running.

phrase_device_startup.mp3 is the old "Root Record is online. I'm back." line.
Do not use it for origin recycle — that clip is not an AC-load label.
"""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from pathlib import Path

from apps.core import config

log = logging.getLogger("ava.startup_voice")

STATE_PATH = config.DATA_DIR / "state" / "startup-voice.json"
MIN_INTERVAL_S = 30 * 60
SHORT_DOWN_S = 60
CLIP_BACK = "phrase_all_systems_running"
CLIP_SAT = "satellite_connection"
CLIP_ONLINE_BACK = "phrase_device_startup"


def _load() -> dict:
    if not STATE_PATH.is_file():
        return {}
    try:
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save(data: dict) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def capture_boot_gap() -> float:
    """Stamp last_seen_down from the previous process tick before origin_start overwrites it."""
    st = _load()
    if st.get("last_seen_down_at"):
        return downtime_s()
    marker = config.DATA_DIR / "state" / "uptime-marker.json"
    ts = None
    if marker.is_file():
        try:
            m = json.loads(marker.read_text(encoding="utf-8"))
        except Exception:
            m = {}
        for key in ("last_stop_at", "last_tick_at"):
            ts = _parse_iso(str(m.get(key) or ""))
            if ts:
                break
    if ts:
        st["last_seen_down_at"] = ts
        st["last_seen_down_iso"] = datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        _save(st)
    return downtime_s()


def note_down() -> None:
    """Call when origin is going away so the next boot knows the gap."""
    st = _load()
    st["last_seen_down_at"] = time.time()
    st["last_seen_down_iso"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    _save(st)


def _parse_iso(raw: str) -> float | None:
    try:
        t = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        return t.astimezone(timezone.utc).timestamp()
    except Exception:
        return None


def downtime_s() -> float:
    """Seconds since last recorded down. Huge if unknown (first boot)."""
    now = time.time()
    st = _load()
    down_at = st.get("last_seen_down_at")
    if down_at:
        try:
            return max(0.0, now - float(down_at))
        except (TypeError, ValueError):
            pass
    return 10**9


def should_announce(*, force: bool = False, min_interval_s: float = MIN_INTERVAL_S) -> bool:
    gap = downtime_s()
    if force:
        return True
    if gap < SHORT_DOWN_S:
        return True
    now = time.time()
    st = _load()
    last = float(st.get("last_played_at") or 0)
    if last and (now - last) < min_interval_s:
        left = int(min_interval_s - (now - last))
        log.info("Startup voice suppressed — cooldown %ss remaining", left)
        return False
    return True


def mark_announced(*, clip: str = "") -> None:
    st = _load()
    st["last_played_at"] = time.time()
    st["last_played_iso"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    if clip:
        st["last_clip"] = clip
    _save(st)


def clip_path(name: str = CLIP_BACK) -> Path:
    return config.ASSETS_DIR / "words" / f"{name}.mp3"


def choose_clip(*, force: bool = False) -> tuple[str, Path, float]:
    """Return (clip_name, path, downtime_s)."""
    gap = downtime_s()
    if gap < SHORT_DOWN_S:
        name = CLIP_SAT
    else:
        name = CLIP_BACK
    path = clip_path(name)
    if not path.is_file() and name == CLIP_SAT:
        name = CLIP_BACK
        path = clip_path(name)
    return name, path, gap


async def queue_if_allowed(*, force: bool = False, name: str = "startup") -> dict:
    from apps.voice.director import Priority, get_director

    clip, path, gap = choose_clip(force=force)
    if not path.is_file():
        return {"ok": False, "detail": "clip_missing", "path": str(path), "downtime_s": gap}
    if not should_announce(force=force):
        return {"ok": True, "played": False, "detail": "cooldown", "clip": clip, "downtime_s": gap}
    await get_director().queue(
        path,
        name=name,
        priority=Priority.CRITICAL,
        scene=None,
    )
    mark_announced(clip=clip)
    log.info("Startup voice queued clip=%s downtime_s=%.1f force=%s", clip, gap, force)
    return {"ok": True, "played": True, "clip": clip, "downtime_s": round(gap, 1)}

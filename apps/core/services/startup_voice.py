"""Gate the 'Root Record is online. I'm back.' startup clip.

Brief uvicorn / watchdog flaps must not spam the desk every minute.
"""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path

from apps.core import config

log = logging.getLogger("ava.startup_voice")

STATE_PATH = config.DATA_DIR / "state" / "startup-voice.json"
# Don't replay just because origin bounced for a second.
MIN_INTERVAL_S = 30 * 60  # 30 minutes between announcements
CLIP_NAME = "phrase_device_startup"


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


def should_announce(*, force: bool = False, min_interval_s: float = MIN_INTERVAL_S) -> bool:
    """Return True only if we should play the I'm-back clip."""
    if force:
        return True
    now = time.time()
    st = _load()
    last = float(st.get("last_played_at") or 0)
    if last and (now - last) < min_interval_s:
        left = int(min_interval_s - (now - last))
        log.info("Startup voice suppressed — cooldown %ss remaining", left)
        return False
    return True


def mark_announced() -> None:
    st = _load()
    st["last_played_at"] = time.time()
    st["last_played_iso"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    _save(st)


def clip_path() -> Path:
    return config.ASSETS_DIR / "words" / f"{CLIP_NAME}.mp3"


async def queue_if_allowed(*, force: bool = False, name: str = "startup") -> dict:
    """Queue the startup clip through the Stream Director when cooldown allows."""
    from apps.voice.director import Priority, get_director

    path = clip_path()
    if not path.is_file():
        return {"ok": False, "detail": "clip_missing", "path": str(path)}
    if not should_announce(force=force):
        return {"ok": True, "played": False, "detail": "cooldown"}
    await get_director().queue(
        path,
        name=name,
        priority=Priority.CRITICAL,
        scene=None,
    )
    mark_announced()
    log.info("Startup voice queued (force=%s)", force)
    return {"ok": True, "played": True}

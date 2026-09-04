"""Queue a named local clip when a key process happens. No Grok.

Missing files are logged so Grok can record them later. Cooldown per phrase.
"""
from __future__ import annotations

import json
import logging
import time

from apps.core import config

log = logging.getLogger("ava.voice_events")
STATE_PATH = config.DATA_DIR / "state" / "voice-events.json"
DEFAULT_COOLDOWN_S = 5 * 60


def _load() -> dict:
    if not STATE_PATH.is_file():
        return {"last": {}}
    try:
        data = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {"last": {}}
    data.setdefault("last", {})
    return data


def _save(data: dict) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def _clip_path(name: str) -> Path | None:
    from apps.voice.clips import _find_clip

    return _find_clip(name)


async def announce(phrase_id: str, *, cooldown_s: int = DEFAULT_COOLDOWN_S, priority: str = "REPORT") -> dict:
    name = (phrase_id or "").strip().lower()
    if not name:
        return {"ok": False, "detail": "empty"}
    now = time.time()
    st = _load()
    last = float((st.get("last") or {}).get(name) or 0)
    if last and cooldown_s > 0 and (now - last) < cooldown_s:
        return {"ok": True, "skipped": True, "reason": "cooldown", "phrase": name}
    path = _clip_path(name)
    st.setdefault("last", {})[name] = now
    if path is None:
        needed = config.ASSETS_DIR / "words" / "_needed_record.txt"
        log.info("voice event %s — clip not on disk yet", name)
        _save(st)
        return {"ok": True, "skipped": True, "reason": "missing_clip", "phrase": name, "needed": str(needed)}
    try:
        from apps.voice.director import Priority, get_director

        pri = getattr(Priority, priority.upper(), Priority.REPORT)
        await get_director().queue(path, name=name, priority=pri, scene=None)
        _save(st)
        return {"ok": True, "played": True, "phrase": name, "path": str(path)}
    except Exception as e:
        log.warning("voice event %s failed: %s", name, e)
        return {"ok": False, "phrase": name, "detail": str(e)[:200]}

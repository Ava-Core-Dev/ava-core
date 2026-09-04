"""Queue a named local clip when a key process happens. No Grok.

Missing files are logged so Grok can record them later. Cooldown per phrase.
Also queues on-disk report MP3s (midday/morning) at REPORT priority — same class
as morning-boot-replay: pause music bed, play file, resume. No re-TTS.
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path

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


def _resolve_mp3(*candidates: str | Path | None) -> Path | None:
    for raw in candidates:
        if not raw:
            continue
        p = Path(str(raw))
        if p.is_file() and p.stat().st_size > 0:
            return p
    return None


async def play_report_mp3(
    *candidates: str | Path | None,
    name: str = "report",
    kind: str | None = None,
) -> dict:
    """Queue an existing report MP3 at REPORT priority. No TTS spend.

    Same path class as morning-boot-replay: director.queue → music bed hold → play.
    Prefer current symlink/copy first, then dated file.
    """
    path = _resolve_mp3(*candidates)
    if path is None and kind:
        path = _resolve_mp3(
            config.GENERATED_DIR / f"{kind}-report-current.mp3",
        )
    if path is None:
        log.warning("report play missing mp3 name=%s kind=%s", name, kind)
        return {"ok": False, "detail": "mp3_missing", "name": name, "kind": kind}
    try:
        from apps.voice.director import Priority, get_director

        label = (name or path.stem or "report").strip() or "report"
        await get_director().queue(
            path,
            name=label,
            priority=Priority.REPORT,
            scene=None,
        )
        log.info("report MP3 queued name=%s file=%s", label, path.name)
        return {
            "ok": True,
            "played": True,
            "name": label,
            "mp3": str(path),
            "file": path.name,
            "priority": "REPORT",
        }
    except Exception as e:
        log.warning("report play failed name=%s: %s", name, e)
        return {"ok": False, "name": name, "detail": str(e)[:200]}


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

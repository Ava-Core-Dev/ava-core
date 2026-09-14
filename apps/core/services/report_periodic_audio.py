"""Periodic playback of the newest ready daily report audio."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from apps.core import config

HST = ZoneInfo("Pacific/Honolulu")
STATE_PATH = config.DATA_DIR / "state" / "report-periodic-play.json"
REPLAY_S = 10 * 60


def active_kind(now: datetime | None = None) -> str:
    now = now or datetime.now(HST)
    minute = now.hour * 60 + now.minute
    if minute < 11 * 60 + 55:
        return "morning"
    if minute < 17 * 60 + 15:
        return "midday"
    if minute < 22 * 60:
        return "evening"
    return "late"


def _load() -> dict:
    if not STATE_PATH.is_file():
        return {"slots": {}}
    try:
        data = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {"slots": {}}
    return data if isinstance(data, dict) else {"slots": {}}


def _save(data: dict) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def _generated_audio(kind: str) -> Path | None:
    for suffix in (".wav", ".mp3"):
        path = config.GENERATED_DIR / f"{kind}-report-current{suffix}"
        if path.is_file() and path.stat().st_size > 0:
            return path
    return None


def _audio_for(kind: str) -> Path | None:
    return _generated_audio(kind)


def _age_s(raw: object) -> float | None:
    if not raw:
        return None
    try:
        stamp = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        if stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=timezone.utc)
        return max(0.0, (datetime.now(timezone.utc) - stamp.astimezone(timezone.utc)).total_seconds())
    except (TypeError, ValueError):
        return None


async def play_if_due(
    kind: str,
    *,
    reason: str = "periodic",
    force: bool = False,
) -> dict:
    kind = str(kind or "").strip().lower()
    if kind not in {"morning", "midday", "evening", "late"}:
        return {"ok": False, "detail": "bad_kind"}

    from apps.core.services import daily_report_board, report_audio_manual, voice_events

    slot = daily_report_board.get_slot(kind) or {}
    if slot.get("status") != "done":
        return {"ok": True, "skipped": True, "detail": "report_not_ready", "kind": kind}

    path = _audio_for(kind)
    manual = False
    if path is None:
        path = report_audio_manual.resolve_play_path(kind)
        manual = path is not None
    if path is None:
        return {"ok": True, "skipped": True, "detail": "audio_missing", "kind": kind}

    state = _load()
    row = state.setdefault("slots", {}).setdefault(kind, {})
    mtime = path.stat().st_mtime
    fresh_file = float(row.get("file_mtime") or 0) != mtime
    due = force or fresh_file or (_age_s(row.get("last_played_at")) or float("inf")) >= REPLAY_S
    if not due:
        return {"ok": True, "skipped": True, "detail": "replay_interval", "kind": kind}

    played = await voice_events.play_report_mp3(path, name=f"{kind}_report_periodic", kind=kind)
    if played.get("skipped"):
        return {"ok": True, "skipped": True, "kind": kind, "play": played}
    if not played.get("ok"):
        return {"ok": False, "kind": kind, "play": played}

    row.update(
        {
            "last_played_at": datetime.now(timezone.utc).isoformat(),
            "file_mtime": mtime,
            "file": str(path),
            "manual": manual,
            "reason": reason,
        }
    )
    _save(state)
    return {"ok": True, "kind": kind, "play": played, "manual": manual}


async def run() -> dict:
    kind = active_kind()
    return await play_if_due(kind, reason="periodic")

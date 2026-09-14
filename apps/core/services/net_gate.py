"""Persist the local desk network-gate lifecycle state."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from apps.core import config

STATE_PATH = config.DATA_DIR / "state" / "net-gate.json"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load() -> dict[str, Any]:
    if not STATE_PATH.is_file():
        return {}
    try:
        value = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def _save(data: dict[str, Any]) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary = STATE_PATH.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    temporary.replace(STATE_PATH)


def mark_online() -> dict[str, Any]:
    """Record that the local desk has restored its network gate."""
    state = _load()
    timestamp = _now()
    state.update(
        {
            "online": True,
            "updated": timestamp,
            "restored_at": timestamp,
            "ava_stopped": False,
            "desk_was_open": True,
        }
    )
    _save(state)
    return state


def mark_offline() -> dict[str, Any]:
    """Record that the local desk is stopping and its gate is closed."""
    state = _load()
    timestamp = _now()
    state.update(
        {
            "online": False,
            "updated": timestamp,
            "stopped_at": timestamp,
            "ava_stopped": True,
            "desk_was_open": False,
        }
    )
    _save(state)
    return state
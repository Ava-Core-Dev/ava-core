"""Public report subscribers — people who asked for Ava's reports in DMs.

This is not the operator/dev feed. Subscribers get morning / solar / weather /
Kīlauea reports only. Overnight status, D1 sync, system perf, and development
posts stay off this list.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .. import config

log = logging.getLogger("ava.subscribers")

SURFACES = ("telegram", "discord")
TOPICS = ("reports",)  # one bundle: public reports, not ops chatter


def _path() -> Path:
    return config.DATA_DIR / "state" / "report-subscribers.json"


def _empty() -> dict[str, Any]:
    return {"subscribers": []}


def load() -> dict[str, Any]:
    path = _path()
    if not path.is_file():
        return _empty()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict) and isinstance(data.get("subscribers"), list):
            return data
    except Exception as e:
        log.warning("subscriber file unreadable: %s", e)
    return _empty()


def save(data: dict[str, Any]) -> None:
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def list_all() -> list[dict[str, Any]]:
    return list(load().get("subscribers") or [])


def _key(surface: str, sid: str) -> str:
    return f"{surface}:{sid}"


def add(surface: str, sid: str, *, label: str = "") -> dict[str, Any]:
    surface = str(surface or "").strip().lower()
    sid = str(sid or "").strip()
    if surface not in SURFACES or not sid:
        return {"ok": False, "detail": "need telegram or discord id"}
    data = load()
    rows = data["subscribers"]
    key = _key(surface, sid)
    for row in rows:
        if _key(row.get("surface", ""), str(row.get("id") or "")) == key:
            return {"ok": True, "already": True, "subscriber": row}
    row = {
        "surface": surface,
        "id": sid,
        "topics": ["reports"],
        "label": str(label or "").strip()[:80],
        "added_at": datetime.now(timezone.utc).isoformat(),
    }
    rows.append(row)
    save(data)
    log.info("report subscriber +%s %s", surface, sid)
    return {"ok": True, "already": False, "subscriber": row}


def remove(surface: str, sid: str) -> dict[str, Any]:
    surface = str(surface or "").strip().lower()
    sid = str(sid or "").strip()
    data = load()
    before = len(data["subscribers"])
    data["subscribers"] = [
        row
        for row in data["subscribers"]
        if not (
            str(row.get("surface") or "").lower() == surface
            and str(row.get("id") or "") == sid
        )
    ]
    save(data)
    gone = before - len(data["subscribers"])
    if gone:
        log.info("report subscriber -%s %s", surface, sid)
    return {"ok": True, "removed": gone}


def wants_reports(row: dict[str, Any]) -> bool:
    topics = row.get("topics") or ["reports"]
    return "reports" in topics

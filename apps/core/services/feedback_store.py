"""Visitor feedback stored on this disk. Origin-up path."""

from __future__ import annotations

import json
import sqlite3
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from apps.core import config

DIR = config.DATA_DIR / "feedback"
DB = DIR / "inbox.sqlite"


def _connect() -> sqlite3.Connection:
    DIR.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(DB), timeout=8)
    con.row_factory = sqlite3.Row
    con.execute(
        """CREATE TABLE IF NOT EXISTS feedback (
             id TEXT PRIMARY KEY,
             at INTEGER NOT NULL,
             iso TEXT NOT NULL,
             surface TEXT,
             kind TEXT,
             name TEXT,
             email TEXT,
             message TEXT NOT NULL,
             app_id TEXT,
             extra TEXT
           )"""
    )
    con.commit()
    return con


def store(payload: dict) -> dict:
    msg = str(payload.get("message") or payload.get("content") or "").strip()
    if not msg:
        raise ValueError("message required")
    fid = str(payload.get("id") or uuid.uuid4())
    now = int(time.time() * 1000)
    iso = str(payload.get("iso") or datetime.now(timezone.utc).isoformat())
    kind = str(payload.get("kind") or payload.get("type") or "general")[:40]
    surface = str(payload.get("surface") or payload.get("app_id") or "web")[:80]
    name = str(payload.get("name") or payload.get("author_name") or "")[:120]
    email = str(payload.get("email") or payload.get("reply_email") or "")[:160]
    app_id = str(payload.get("app_id") or "")[:80]
    extra = {k: payload[k] for k in payload if k not in {
        "id", "at", "iso", "message", "content", "kind", "type", "surface",
        "name", "author_name", "email", "reply_email", "app_id",
    }}
    con = _connect()
    try:
        con.execute(
            "INSERT OR REPLACE INTO feedback "
            "(id, at, iso, surface, kind, name, email, message, app_id, extra) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (fid, now, iso, surface, kind, name, email, msg[:8000], app_id, json.dumps(extra, default=str)),
        )
        con.commit()
    finally:
        con.close()
    return {"ok": True, "id": fid, "stored": "local"}

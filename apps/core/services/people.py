"""Per-person memory: call names, channel ids, agriculture. Same human across chats."""
from __future__ import annotations

import json
import logging
import re
import sqlite3
import time
from datetime import datetime, timezone

from apps.core import config
from apps.core.services import identities

log = logging.getLogger("ava.people")

# Same operator, two Telegram accounts seen in Fern Forest.
ALEX_TELEGRAM = ("6644482344", "8589077731")
SARA_TELEGRAM = "6574408926"

_AGRI_RE = re.compile(
    r"\b(eggplant|eggplants|tomato|tomatoes|pepper|peppers|fern|ferns|"
    r"bloom|blooms|harvest|planted|seeds?|cucumber|cucumbers)\b",
    re.I,
)


def db_path():
    return config.DB_DIR / "people.sqlite"


def connect() -> sqlite3.Connection:
    config.DB_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path()))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS people (
          id INTEGER PRIMARY KEY,
          call_name TEXT,
          extra_json TEXT,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS channels (
          person_id INTEGER NOT NULL REFERENCES people(id),
          surface TEXT NOT NULL,
          sid TEXT NOT NULL,
          username TEXT,
          PRIMARY KEY (surface, sid)
        );
        CREATE INDEX IF NOT EXISTS idx_channels_person ON channels(person_id);
        CREATE TABLE IF NOT EXISTS agriculture (
          id INTEGER PRIMARY KEY,
          person_id INTEGER NOT NULL REFERENCES people(id),
          plant TEXT,
          event TEXT,
          detail TEXT,
          chat_id TEXT,
          at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS plants (
          id INTEGER PRIMARY KEY,
          person_id INTEGER NOT NULL REFERENCES people(id),
          name TEXT,
          cultivar TEXT,
          row_label TEXT,
          location TEXT,
          notes TEXT,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS person_notes (
          id INTEGER PRIMARY KEY,
          person_id INTEGER NOT NULL REFERENCES people(id),
          kind TEXT,
          text TEXT,
          at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS utterances (
          id INTEGER PRIMARY KEY,
          person_id INTEGER NOT NULL REFERENCES people(id),
          surface TEXT,
          chat_id TEXT,
          text TEXT,
          at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_utterances_person ON utterances(person_id, id);
        """
    )
    return conn


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _person_for_channel(conn: sqlite3.Connection, surface: str, sid: str) -> int | None:
    row = conn.execute(
        "SELECT person_id FROM channels WHERE surface=? AND sid=?",
        (surface, str(sid)),
    ).fetchone()
    return int(row["person_id"]) if row else None


def _merge_people(conn: sqlite3.Connection, a: int, b: int) -> int:
    if a == b:
        return a
    keep, drop = (a, b) if a < b else (b, a)
    conn.execute("UPDATE channels SET person_id=? WHERE person_id=?", (keep, drop))
    conn.execute("UPDATE agriculture SET person_id=? WHERE person_id=?", (keep, drop))
    conn.execute("UPDATE plants SET person_id=? WHERE person_id=?", (keep, drop))
    conn.execute("UPDATE person_notes SET person_id=? WHERE person_id=?", (keep, drop))
    conn.execute("UPDATE utterances SET person_id=? WHERE person_id=?", (keep, drop))
    conn.execute("DELETE FROM people WHERE id=?", (drop,))
    return keep


def _ensure_person(conn: sqlite3.Connection, surface: str, sid: str, *, username: str = "", call_name: str = "") -> int:
    sid = str(sid)
    pid = _person_for_channel(conn, surface, sid)
    if pid is None:
        cur = conn.execute(
            "INSERT INTO people (call_name, extra_json, updated_at) VALUES (?, NULL, ?)",
            (call_name or None, _now()),
        )
        pid = int(cur.lastrowid)
        conn.execute(
            "INSERT INTO channels (person_id, surface, sid, username) VALUES (?, ?, ?, ?)",
            (pid, surface, sid, username or None),
        )
    else:
        if username:
            conn.execute(
                "UPDATE channels SET username=? WHERE surface=? AND sid=?",
                (username, surface, sid),
            )
        if call_name:
            conn.execute(
                "UPDATE people SET call_name=?, updated_at=? WHERE id=? AND (call_name IS NULL OR call_name='')",
                (call_name, _now(), pid),
            )
    return pid


def seed_known() -> None:
    conn = connect()
    try:
        alex = None
        for tid in ALEX_TELEGRAM:
            pid = _ensure_person(conn, "telegram", tid, username="WildEcho94", call_name="Alex")
            alex = pid if alex is None else _merge_people(conn, alex, pid)
        conn.execute("UPDATE people SET call_name=? WHERE id=?", ("Alex", alex))
        _ensure_person(conn, "telegram", SARA_TELEGRAM, username="Crazychickenlady12")
        conn.commit()
        ident = identities.connect()
        try:
            for tid in ALEX_TELEGRAM:
                identities.upsert(
                    ident,
                    identifiers={"telegram": tid, "username": "WildEcho94", "membership_id": f"telegram:{tid}"},
                    source="people_seed",
                )
            identities.upsert(
                ident,
                identifiers={"telegram": SARA_TELEGRAM, "username": "Crazychickenlady12", "membership_id": f"telegram:{SARA_TELEGRAM}"},
                source="people_seed",
            )
            ident.commit()
        finally:
            ident.close()
    finally:
        conn.close()


def observe(surface: str, sid: str, *, username: str = "", first_name: str = "", text: str = "", chat_id: str = "") -> dict:
    """Touch a person on any surface. Same telegram/discord id = same row."""
    seed_known()
    conn = connect()
    try:
        call = ""
        if str(sid) in ALEX_TELEGRAM:
            call = "Alex"
        pid = _ensure_person(conn, surface, str(sid), username=username, call_name=call)
        if str(sid) in ALEX_TELEGRAM:
            other = ALEX_TELEGRAM[1] if str(sid) == ALEX_TELEGRAM[0] else ALEX_TELEGRAM[0]
            oid = _person_for_channel(conn, surface, other)
            if oid:
                pid = _merge_people(conn, pid, oid)
            _ensure_person(conn, surface, other, call_name="Alex")
            conn.execute("UPDATE people SET call_name=? WHERE id=?", ("Alex", pid))
        conn.execute("UPDATE people SET updated_at=? WHERE id=?", (_now(), pid))
        agri = None
        if text:
            agri = _maybe_agri(conn, pid, text, chat_id)
            named = re.search(r"\bcall me ([A-Za-z][A-Za-z' -]{1,30})\b", text, re.I)
            if named:
                nm = named.group(1).strip(" .,")
                if nm.lower() not in {"ava", "you"}:
                    conn.execute(
                        "UPDATE people SET call_name=?, updated_at=? WHERE id=?",
                        (nm, _now(), pid),
                    )
        row = conn.execute("SELECT call_name FROM people WHERE id=?", (pid,)).fetchone()
        conn.commit()
        ident = identities.connect()
        try:
            identities.upsert(
                ident,
                identifiers={
                    surface: sid if surface in {"telegram", "discord"} else None,
                    "username": username or first_name,
                    "membership_id": f"{surface}:{sid}",
                },
                source="people_observe",
            )
            ident.commit()
        finally:
            ident.close()
        return {
            "person_id": pid,
            "call_name": (row["call_name"] if row else None) or "",
            "agriculture": agri,
        }
    finally:
        conn.close()


def _maybe_agri(conn: sqlite3.Connection, person_id: int, text: str, chat_id: str) -> dict | None:
    if not _AGRI_RE.search(text or ""):
        return None
    if re.search(r"\bcucumbers?\b", text or "", re.I) and re.search(r"\b(delta|river|ecoflow|pack|battery)\b", text or "", re.I):
        return None
    plant = ""
    for name in ("eggplant", "tomato", "pepper", "fern", "seed"):
        if re.search(rf"\b{name}s?\b", text, re.I):
            plant = name
            break
    event = "note"
    if re.search(r"\bblooms?\b", text, re.I):
        event = "bloom"
    elif re.search(r"\bharvest", text, re.I):
        event = "harvest"
    elif re.search(r"\bplanted\b|\bseeds?\b", text, re.I):
        event = "planted"
    conn.execute(
        "INSERT INTO agriculture (person_id, plant, event, detail, chat_id, at) VALUES (?, ?, ?, ?, ?, ?)",
        (person_id, plant or None, event, text[:500], chat_id or None, _now()),
    )
    line = json.dumps(
        {"at": int(time.time() * 1000), "person_id": person_id, "plant": plant, "event": event, "detail": text[:500]},
        ensure_ascii=False,
    )
    path = config.DATA_DIR / "people" / "agriculture.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.open("a", encoding="utf-8").write(line + "\n")
    return {"plant": plant, "event": event}


def call_name_for(surface: str, sid: str) -> str:
    conn = connect()
    try:
        row = conn.execute(
            """SELECT p.call_name FROM people p
               JOIN channels c ON c.person_id = p.id
               WHERE c.surface=? AND c.sid=?""",
            (surface, str(sid)),
        ).fetchone()
        return str(row["call_name"] or "") if row else ""
    finally:
        conn.close()


def set_call_name(surface: str, sid: str, name: str) -> None:
    name = str(name or "").strip()[:40]
    if not name:
        return
    conn = connect()
    try:
        pid = _ensure_person(conn, surface, str(sid), call_name=name)
        conn.execute("UPDATE people SET call_name=?, updated_at=? WHERE id=?", (name, _now(), pid))
        conn.commit()
    finally:
        conn.close()


def add_note(surface: str, sid: str, kind: str, text: str) -> None:
    text = str(text or "").strip()[:800]
    if not text:
        return
    conn = connect()
    try:
        pid = _ensure_person(conn, surface, str(sid))
        conn.execute(
            "INSERT INTO person_notes (person_id, kind, text, at) VALUES (?, ?, ?, ?)",
            (pid, (kind or "fact")[:40], text, _now()),
        )
        conn.commit()
    finally:
        conn.close()


def add_plant(surface: str, sid: str, *, name: str, cultivar: str = "", count: int = 1, notes: str = "") -> None:
    conn = connect()
    try:
        pid = _ensure_person(conn, surface, str(sid))
        for i in range(max(1, int(count))):
            conn.execute(
                """INSERT INTO plants (person_id, name, cultivar, row_label, location, notes, updated_at)
                   VALUES (?, ?, ?, NULL, NULL, ?, ?)""",
                (pid, name, cultivar or None, notes or None, _now()),
            )
        conn.commit()
    finally:
        conn.close()

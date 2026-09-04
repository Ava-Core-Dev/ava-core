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
_SKIP_UTTER = re.compile(
    r"^(ok|okay|k|lol|lmao|yes|no|yeah|nah|hi|hey|thanks|ty|np|sure)\.?$",
    re.I,
)
_SECRETISH = re.compile(
    r"(password|passwd|api[_-]?key|\btoken\b|secret|sk-[a-z0-9]|bot\d+:|0x[a-f0-9]{40})",
    re.I,
)
_WISH_RE = re.compile(
    r"\b(?:we should|you should|can you add|please add|i want you to|i wish|"
    r"add a feature|new feature|make (?:her|ava|it)|self[- ]updat)\b",
    re.I,
)
_LOVE_RE = re.compile(r"\bi (?:love|like|hate) ([^.]{2,80})", re.I)
_HAVE_RE = re.compile(r"\b(?:we have|i have|i've got)\s+(\d{1,3})?\s*([a-z][a-z ]{2,40})", re.I)
_TIRED_RE = re.compile(r"\b(tired|little sleep|couldn't sleep|did not sleep)\b", re.I)
_NAME_IS_RE = re.compile(r"\b(?:my name is|i(?:'m| am)) ([A-Z][a-z]{1,20})\b")


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
        if alex:
            desk = _ensure_person(conn, "desk", "alex", call_name="Alex")
            alex = _merge_people(conn, alex, desk)
            conn.execute("UPDATE people SET call_name=? WHERE id=?", ("Alex", alex))
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
        if str(sid) in ALEX_TELEGRAM or (surface == "desk" and str(sid) == "alex"):
            for other_surface, other_sid in (
                ("telegram", ALEX_TELEGRAM[0]),
                ("telegram", ALEX_TELEGRAM[1]),
                ("desk", "alex"),
            ):
                oid = _person_for_channel(conn, other_surface, other_sid)
                if oid:
                    pid = _merge_people(conn, pid, oid)
                _ensure_person(conn, other_surface, other_sid, call_name="Alex")
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
            _auto_capture(conn, pid, surface, str(sid), text, chat_id)
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


def _note_if_new(conn: sqlite3.Connection, person_id: int, kind: str, text: str) -> None:
    text = str(text or "").strip()[:800]
    if not text or _SECRETISH.search(text):
        return
    row = conn.execute(
        """SELECT id FROM person_notes
           WHERE person_id=? AND kind=? AND text=?
           ORDER BY id DESC LIMIT 1""",
        (person_id, kind[:40], text),
    ).fetchone()
    if row:
        return
    conn.execute(
        "INSERT INTO person_notes (person_id, kind, text, at) VALUES (?, ?, ?, ?)",
        (person_id, kind[:40], text, _now()),
    )


def _auto_capture(conn: sqlite3.Connection, person_id: int, surface: str, sid: str, text: str, chat_id: str) -> None:
    raw = str(text or "").strip()
    if len(raw) < 8 or _SECRETISH.search(raw):
        return
    last = conn.execute(
        "SELECT text FROM utterances WHERE person_id=? ORDER BY id DESC LIMIT 1",
        (person_id,),
    ).fetchone()
    if last and str(last["text"] or "") == raw[:500]:
        return
    if not _SKIP_UTTER.match(raw):
        conn.execute(
            "INSERT INTO utterances (person_id, surface, chat_id, text, at) VALUES (?, ?, ?, ?, ?)",
            (person_id, surface, chat_id or None, raw[:500], _now()),
        )
        keep = [
            int(r["id"])
            for r in conn.execute(
                "SELECT id FROM utterances WHERE person_id=? ORDER BY id DESC LIMIT 40",
                (person_id,),
            ).fetchall()
        ]
        if keep:
            conn.execute(
                f"DELETE FROM utterances WHERE person_id=? AND id NOT IN ({','.join('?' * len(keep))})",
                (person_id, *keep),
            )
    love = _LOVE_RE.search(raw)
    if love:
        _note_if_new(conn, person_id, "interest", love.group(0).strip()[:200])
    have = _HAVE_RE.search(raw)
    if have and _AGRI_RE.search(raw):
        _note_if_new(conn, person_id, "garden", have.group(0).strip()[:200])
    if _TIRED_RE.search(raw):
        _note_if_new(conn, person_id, "state", "tired / little sleep")
    named = _NAME_IS_RE.search(raw)
    if named and named.group(1).lower() not in {"ava", "you", "here", "just"}:
        _note_if_new(conn, person_id, "name", f"goes by {named.group(1)}")
    if _WISH_RE.search(raw):
        _note_if_new(conn, person_id, "wish", raw[:400])
        try:
            from apps.core.services import governance

            governance.record_wish(person_id, surface, sid, raw)
        except Exception:
            pass


def memory_for(surface: str, sid: str, *, limit: int = 8) -> str:
    """Compact notes for the prompt. Empty if we have nothing."""
    conn = connect()
    try:
        pid = _person_for_channel(conn, surface, str(sid))
        if not pid:
            return ""
        call = conn.execute("SELECT call_name FROM people WHERE id=?", (pid,)).fetchone()
        name = str((call["call_name"] if call else "") or "").strip()
        notes = conn.execute(
            "SELECT kind, text FROM person_notes WHERE person_id=? ORDER BY id DESC LIMIT ?",
            (pid, max(2, int(limit))),
        ).fetchall()
        plants = conn.execute(
            "SELECT name, cultivar, notes FROM plants WHERE person_id=? ORDER BY id DESC LIMIT 6",
            (pid,),
        ).fetchall()
        lines = []
        if name:
            lines.append(f"Call them {name}.")
        else:
            lines.append("No call name on file. You may ask once what to call them.")
        seen: set[str] = set()
        for row in notes:
            bit = f"{row['kind']}: {row['text']}".strip()
            key = bit.lower()
            if key in seen:
                continue
            seen.add(key)
            lines.append(bit[:180])
        for row in plants:
            bits = [row["name"] or "plant"]
            if row["cultivar"]:
                bits.append(str(row["cultivar"]))
            if row["notes"]:
                bits.append(str(row["notes"]))
            lines.append("plant: " + ", ".join(bits)[:180])
        return "\n".join(lines[: 2 + limit])
    finally:
        conn.close()


def lock_addon(surface: str, sid: str) -> str:
    mem = memory_for(surface, sid)
    if not mem:
        return (
            "You want to fully know people so you can treat everyone as themselves. "
            "Small talk is useful — it gives you context to build cooler stuff. You can still chat while building. "
            "No notes on file for this speaker yet."
        )
    return (
        "You want to fully know people so you can treat everyone as themselves. "
        "Small talk is useful — it gives you context to build cooler stuff. You can still chat while building. "
        "Notes on file (do not invent beyond these):\n" + mem
    )

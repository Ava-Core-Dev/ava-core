"""Local identity index for AVA-CORE.

Cloud license rows stay on Root Record D1 (`license_accounts`). This SQLite
file is the on-box merge of every identifier we can find: email, Discord id,
Minecraft UUID, Solana public key, RootMC username, membership/account id.

Path: ``config.DB_DIR / identities.sqlite`` (under gitignored ``data/``).
Never write passwords, hashes, private keys, or tokens here.
"""

from __future__ import annotations

import json
import logging
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from apps.core import config

log = logging.getLogger("ava.identities")

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)
DISCORD_RE = re.compile(r"^\d{15,22}$")
SOLANA_RE = re.compile(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$")
KINDS = ("email", "discord", "uuid", "solana", "username", "account_id", "membership_id", "telegram")
ALIASES = {
    "minecraft_uuid": "uuid",
    "player_uuid": "uuid",
    "uuid": "uuid",
    "discord_id": "discord",
    "discord_user_id": "discord",
    "discordid": "discord",
    "pubkey": "solana",
    "solana_public": "solana",
    "custodial_pubkey": "solana",
    "linked_pubkey": "solana",
    "public_pubkey": "solana",
    "minecraft_username": "username",
    "minecraftname": "username",
    "mc_name": "username",
    "telegram": "telegram",
    "telegram_id": "telegram",
    "tg_id": "telegram",
}


def db_path() -> Path:
    return config.DB_DIR / "identities.sqlite"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def connect() -> sqlite3.Connection:
    config.DB_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path()))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS identities (
          id INTEGER PRIMARY KEY,
          account_id TEXT,
          slug TEXT,
          kind TEXT,
          pro INTEGER NOT NULL DEFAULT 0,
          life INTEGER NOT NULL DEFAULT 0,
          member INTEGER NOT NULL DEFAULT 0,
          extra_json TEXT,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS identifiers (
          kind TEXT NOT NULL,
          value TEXT NOT NULL,
          identity_id INTEGER NOT NULL REFERENCES identities(id),
          PRIMARY KEY (kind, value)
        );
        CREATE INDEX IF NOT EXISTS idx_identifiers_identity ON identifiers(identity_id);
        CREATE TABLE IF NOT EXISTS sources (
          identity_id INTEGER NOT NULL REFERENCES identities(id),
          source TEXT NOT NULL,
          path TEXT,
          imported_at TEXT NOT NULL,
          PRIMARY KEY (identity_id, source, path)
        );
        """
    )
    return conn


def canonical_kind(kind: str) -> str:
    k = (kind or "").strip().lower()
    return ALIASES.get(k, k)


def normalize(kind: str, raw: str) -> str | None:
    kind = canonical_kind(kind)
    value = str(raw or "").strip()
    if not value:
        return None
    if kind == "email":
        value = value.lower()
        if value.startswith("mailto:"):
            value = value[7:]
        return value if EMAIL_RE.match(value) else None
    if kind == "discord":
        value = value.strip()
        return value if DISCORD_RE.match(value) else None
    if kind == "uuid":
        value = value.lower()
        return value if UUID_RE.match(value) else None
    if kind == "solana":
        if value.lower().startswith("solana:"):
            value = value.split(":", 1)[1]
        if value in {"3euG8kS4Dwvicq2xDwiwQEoDBipBjwyUQxp9CFo2gwtL"}:
            return None
        return value if SOLANA_RE.match(value) else None
    if kind == "username":
        value = value.strip()
        if len(value) < 2 or "@" in value:
            return None
        if value.lower() in {"player", "unknown", "null"}:
            return None
        return value[:32]
    if kind in {"account_id", "membership_id"}:
        return value[:80] if len(value) >= 4 else None
    return None


def _find_ids(conn: sqlite3.Connection, pairs: list[tuple[str, str]]) -> set[int]:
    found: set[int] = set()
    for kind, value in pairs:
        row = conn.execute(
            "SELECT identity_id FROM identifiers WHERE kind=? AND value=?",
            (kind, value),
        ).fetchone()
        if row:
            found.add(int(row["identity_id"]))
    return found


def _merge_ids(conn: sqlite3.Connection, ids: Iterable[int]) -> int:
    ordered = sorted(set(ids))
    if not ordered:
        raise ValueError("no ids to merge")
    keep = ordered[0]
    now = _now()
    for other in ordered[1:]:
        if other == keep:
            continue
        src = conn.execute("SELECT * FROM identities WHERE id=?", (other,)).fetchone()
        dst = conn.execute("SELECT * FROM identities WHERE id=?", (keep,)).fetchone()
        if src and dst:
            conn.execute(
                """UPDATE identities SET
                     account_id=COALESCE(NULLIF(account_id,''), ?),
                     slug=COALESCE(NULLIF(slug,''), ?),
                     kind=COALESCE(NULLIF(kind,''), ?),
                     pro=MAX(pro, ?),
                     life=MAX(life, ?),
                     member=MAX(member, ?),
                     updated_at=?
                   WHERE id=?""",
                (
                    src["account_id"],
                    src["slug"],
                    src["kind"],
                    int(src["pro"] or 0),
                    int(src["life"] or 0),
                    int(src["member"] or 0),
                    now,
                    keep,
                ),
            )
        conn.execute(
            "UPDATE identifiers SET identity_id=? WHERE identity_id=?",
            (keep, other),
        )
        conn.execute(
            """INSERT OR IGNORE INTO sources (identity_id, source, path, imported_at)
               SELECT ?, source, path, imported_at FROM sources WHERE identity_id=?""",
            (keep, other),
        )
        conn.execute("DELETE FROM sources WHERE identity_id=?", (other,))
        conn.execute("DELETE FROM identities WHERE id=?", (other,))
    return keep


def upsert(
    conn: sqlite3.Connection,
    *,
    identifiers: dict[str, str | None] | None = None,
    account_id: str = "",
    slug: str = "",
    kind: str = "",
    pro: int = 0,
    life: int = 0,
    member: int = 0,
    source: str = "",
    path: str = "",
) -> int | None:
    pairs: list[tuple[str, str]] = []
    raw = dict(identifiers or {})
    if account_id:
        raw.setdefault("account_id", account_id)
    for k, v in raw.items():
        ck = canonical_kind(k)
        nv = normalize(ck, str(v or ""))
        if nv and ck in KINDS:
            pairs.append((ck, nv))
    if not pairs:
        return None
    existing = _find_ids(conn, pairs)
    now = _now()
    if not existing:
        cur = conn.execute(
            """INSERT INTO identities (account_id, slug, kind, pro, life, member, extra_json, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, NULL, ?)""",
            (account_id or None, slug or None, kind or None, int(pro), int(life), int(member), now),
        )
        ident_id = int(cur.lastrowid)
    else:
        ident_id = _merge_ids(conn, existing)
        conn.execute(
            """UPDATE identities SET
                 account_id=COALESCE(NULLIF(account_id,''), ?),
                 slug=COALESCE(NULLIF(slug,''), ?),
                 kind=COALESCE(NULLIF(kind,''), ?),
                 pro=MAX(pro, ?),
                 life=MAX(life, ?),
                 member=MAX(member, ?),
                 updated_at=?
               WHERE id=?""",
            (account_id or None, slug or None, kind or None, int(pro), int(life), int(member), now, ident_id),
        )
    for k, v in pairs:
        row = conn.execute(
            "SELECT identity_id FROM identifiers WHERE kind=? AND value=?",
            (k, v),
        ).fetchone()
        if row and int(row["identity_id"]) != ident_id:
            ident_id = _merge_ids(conn, [ident_id, int(row["identity_id"])])
        conn.execute(
            "INSERT OR IGNORE INTO identifiers (kind, value, identity_id) VALUES (?, ?, ?)",
            (k, v, ident_id),
        )
        conn.execute(
            "UPDATE identifiers SET identity_id=? WHERE kind=? AND value=?",
            (ident_id, k, v),
        )
    if source:
        conn.execute(
            """INSERT OR IGNORE INTO sources (identity_id, source, path, imported_at)
               VALUES (?, ?, ?, ?)""",
            (ident_id, source, path or "", now),
        )
    return ident_id


def counts(conn: sqlite3.Connection | None = None) -> dict[str, int]:
    own = conn is None
    if own:
        conn = connect()
    try:
        n_id = conn.execute("SELECT COUNT(*) FROM identities").fetchone()[0]
        by_kind = {
            k: conn.execute(
                "SELECT COUNT(*) FROM identifiers WHERE kind=?", (k,)
            ).fetchone()[0]
            for k in KINDS
        }
        members = conn.execute(
            "SELECT COUNT(*) FROM identities WHERE member=1 OR pro=1 OR life=1"
        ).fetchone()[0]
        uuid_rows = conn.execute(
            "SELECT COUNT(*) FROM identifiers WHERE kind='uuid'"
        ).fetchone()[0]
        return {
            "identities": int(n_id),
            "members_flagged": int(members),
            "uuid_present": int(uuid_rows),
            **{f"id_{k}": int(v) for k, v in by_kind.items()},
        }
    finally:
        if own:
            conn.close()


def lookup(query: str, conn: sqlite3.Connection | None = None) -> dict[str, Any] | None:
    q = str(query or "").strip()
    if not q:
        return None
    own = conn is None
    if own:
        conn = connect()
    try:
        candidates: list[tuple[str, str]] = []
        for kind in KINDS:
            nv = normalize(kind, q)
            if nv:
                candidates.append((kind, nv))
        if q.lower().startswith("uuid:"):
            nv = normalize("uuid", q.split(":", 1)[1])
            if nv:
                candidates.append(("uuid", nv))
        ident_id = None
        for kind, value in candidates:
            row = conn.execute(
                "SELECT identity_id FROM identifiers WHERE kind=? AND value=?",
                (kind, value),
            ).fetchone()
            if row:
                ident_id = int(row["identity_id"])
                break
        if ident_id is None:
            row = conn.execute(
                "SELECT identity_id FROM identifiers WHERE lower(value)=lower(?) LIMIT 1",
                (q,),
            ).fetchone()
            if row:
                ident_id = int(row["identity_id"])
        if ident_id is None:
            return None
        ident = conn.execute("SELECT * FROM identities WHERE id=?", (ident_id,)).fetchone()
        ids = conn.execute(
            "SELECT kind, value FROM identifiers WHERE identity_id=?", (ident_id,)
        ).fetchall()
        has = {k: False for k in KINDS}
        for row in ids:
            has[row["kind"]] = True
        return {
            "ok": True,
            "found": True,
            "identity_id": ident_id,
            "member": bool(ident["member"] or ident["pro"] or ident["life"]),
            "pro": bool(ident["pro"]),
            "life": bool(ident["life"]),
            "has": has,
            "identifier_count": len(ids),
        }
    finally:
        if own:
            conn.close()


def list_for_qrcodes(conn: sqlite3.Connection | None = None) -> list[dict[str, str]]:
    own = conn is None
    if own:
        conn = connect()
    try:
        rows = conn.execute("SELECT id, account_id, slug FROM identities").fetchall()
        out = []
        for row in rows:
            ident_id = int(row["id"])
            bag = {
                r["kind"]: r["value"]
                for r in conn.execute(
                    "SELECT kind, value FROM identifiers WHERE identity_id=?",
                    (ident_id,),
                )
            }
            email = bag.get("email") or ""
            aid = bag.get("account_id") or row["account_id"] or ""
            slug = row["slug"] or (email.split("@")[0] if email else aid[:12] or str(ident_id))
            out.append(
                {
                    "account_id": aid or slug,
                    "email": email,
                    "slug": slug,
                    "custodial_pubkey": bag.get("solana") or "",
                    "public_pubkey": bag.get("solana") or "",
                }
            )
        return out
    finally:
        if own:
            conn.close()


def sample_uuid(conn: sqlite3.Connection | None = None) -> str | None:
    own = conn is None
    if own:
        conn = connect()
    try:
        row = conn.execute(
            "SELECT value FROM identifiers WHERE kind='uuid' LIMIT 1"
        ).fetchone()
        return str(row["value"]) if row else None
    finally:
        if own:
            conn.close()

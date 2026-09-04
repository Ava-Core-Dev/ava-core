"""Public Ava chat guests: one person per IP, three live replies then membership.

Operator localhost is not a guest. Raw IPs stay in this local sqlite only.
people.sqlite gets a hash, never the address.
"""
from __future__ import annotations

import hashlib
import logging
import os
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path

from apps.core import config

log = logging.getLogger("ava.guests")

FREE_LIVE = 3
MEMBER_LIVE = 40
SALT_PATH = config.DATA_DIR / "state" / "guest-salt.txt"
LOCAL_IPS = frozenset({"127.0.0.1", "::1", "localhost", "unknown", ""})


def db_path() -> Path:
    return config.DB_DIR / "guests.sqlite"


def _salt() -> str:
    if SALT_PATH.is_file():
        raw = SALT_PATH.read_text(encoding="utf-8").strip()
        if raw:
            return raw
    token = os.urandom(16).hex()
    SALT_PATH.parent.mkdir(parents=True, exist_ok=True)
    SALT_PATH.write_text(token + "\n", encoding="utf-8")
    return token


def ip_hash(ip: str) -> str:
    return hashlib.sha256((_salt() + "|" + (ip or "")).encode("utf-8")).hexdigest()[:32]


def is_local(ip: str) -> bool:
    raw = (ip or "").strip().lower()
    if raw in LOCAL_IPS:
        return True
    return raw.startswith("127.") or raw.startswith("::ffff:127.")


def _day() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def connect() -> sqlite3.Connection:
    config.DB_DIR.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(db_path()))
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.executescript(
        """
        CREATE TABLE IF NOT EXISTS guests (
          ip TEXT NOT NULL,
          ip_hash TEXT NOT NULL,
          sid TEXT,
          first_seen REAL NOT NULL,
          last_seen REAL NOT NULL,
          first_day TEXT NOT NULL,
          PRIMARY KEY (ip)
        );
        CREATE TABLE IF NOT EXISTS guest_days (
          day TEXT NOT NULL,
          ip TEXT NOT NULL,
          n INTEGER NOT NULL DEFAULT 0,
          wall_said INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (day, ip)
        );
        """
    )
    return con


def today_count() -> int:
    con = connect()
    try:
        row = con.execute(
            "SELECT COUNT(*) AS n FROM guest_days WHERE day=?",
            (_day(),),
        ).fetchone()
        return int(row["n"] if row else 0)
    finally:
        con.close()


def touch(ip: str, *, sid: str = "", member: bool = False) -> dict:
    """Record this visitor. Returns new_guest when this IP has never been seen."""
    ip = (ip or "").strip() or "unknown"
    sid = (sid or "").strip()[:64]
    now = time.time()
    h = ip_hash(ip)
    con = connect()
    try:
        row = con.execute("SELECT ip, first_seen FROM guests WHERE ip=?", (ip,)).fetchone()
        new_guest = row is None
        if new_guest:
            con.execute(
                "INSERT INTO guests(ip, ip_hash, sid, first_seen, last_seen, first_day) "
                "VALUES (?,?,?,?,?,?)",
                (ip, h, sid, now, now, _day()),
            )
        else:
            con.execute(
                "UPDATE guests SET ip_hash=?, sid=COALESCE(NULLIF(?,''), sid), last_seen=? WHERE ip=?",
                (h, sid, now, ip),
            )
        day_row = con.execute(
            "SELECT n, wall_said FROM guest_days WHERE day=? AND ip=?",
            (_day(), ip),
        ).fetchone()
        if day_row is None:
            con.execute(
                "INSERT INTO guest_days(day, ip, n, wall_said) VALUES (?,?,0,0)",
                (_day(), ip),
            )
            n = 0
            wall_said = 0
        else:
            n = int(day_row["n"] or 0)
            wall_said = int(day_row["wall_said"] or 0)
        con.commit()
        cap = MEMBER_LIVE if member else FREE_LIVE
        remaining = max(0, cap - n)
        return {
            "ok": True,
            "ip_hash": h,
            "new_guest": new_guest,
            "local": is_local(ip),
            "member": member,
            "n": n,
            "cap": cap,
            "remaining": remaining,
            "wall": (not member) and (not is_local(ip)) and n >= FREE_LIVE,
            "wall_said": bool(wall_said),
        }
    finally:
        con.close()


def bump(ip: str, *, member: bool = False) -> int:
    ip = (ip or "").strip() or "unknown"
    con = connect()
    try:
        con.execute(
            "INSERT INTO guest_days(day, ip, n, wall_said) VALUES (?,?,1,0) "
            "ON CONFLICT(day, ip) DO UPDATE SET n = n + 1",
            (_day(), ip),
        )
        n = con.execute(
            "SELECT n FROM guest_days WHERE day=? AND ip=?",
            (_day(), ip),
        ).fetchone()[0]
        con.commit()
        return int(n)
    finally:
        con.close()


def mark_wall_said(ip: str) -> None:
    ip = (ip or "").strip() or "unknown"
    con = connect()
    try:
        con.execute(
            "UPDATE guest_days SET wall_said=1 WHERE day=? AND ip=?",
            (_day(), ip),
        )
        con.commit()
    finally:
        con.close()


def live_allowed(ip: str, *, member: bool = False) -> dict:
    """Gate before a live generation. Localhost always allowed."""
    if is_local(ip):
        return {"ok": True, "allowed": True, "local": True, "remaining": None}
    info = touch(ip, member=member)
    if member:
        return {**info, "allowed": int(info.get("n") or 0) < MEMBER_LIVE}
    return {**info, "allowed": int(info.get("n") or 0) < FREE_LIVE}


MEMBERSHIP_REPLY = (
    "You've used your three free talks for today. "
    "Sign in at rootrecord.cloud/account to keep going."
)

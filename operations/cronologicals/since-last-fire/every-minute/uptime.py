#!/usr/bin/env python3
"""Build local uptime truth from Ava's system databases.

Inputs (read-only):
  /home/ava-core/database/system.db
  /home/ava-core/database/system-1min.db
  /home/ava-core/database/system-1hour.db

Output (only):
  /home/ava-core/database/uptime.db

The runner discovers this file every minute.  `uptime.db` distinguishes a
machine's *current* uptime from observed historical uptime: the latter is only
the elapsed uptime covered by collected `system.db` samples, never a claim
about time the collector did not see.
"""
from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path

DB_ROOT = Path("/home/ava-core/database")
RAW_DB = DB_ROOT / "system.db"
MINUTE_DB = DB_ROOT / "system-1min.db"
HOUR_DB = DB_ROOT / "system-1hour.db"
UPTIME_DB = DB_ROOT / "uptime.db"


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def table_exists(conn: sqlite3.Connection, name: str) -> bool:
    return conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
    ).fetchone() is not None


def source_count(path: Path, table: str) -> int:
    if not path.is_file():
        return 0
    try:
        with sqlite3.connect(path) as conn:
            return int(conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]) if table_exists(conn, table) else 0
    except sqlite3.Error:
        return 0


def raw_runs() -> list[tuple[int, str, str, float]]:
    if not RAW_DB.is_file():
        return []
    with sqlite3.connect(RAW_DB) as conn:
        if not table_exists(conn, "runs"):
            return []
        return [
            (int(row[0]), row[1] or "", row[2] or "unknown", float(row[3] or 0))
            for row in conn.execute(
                "SELECT id, ts_utc, hostname, uptime_seconds FROM runs "
                "WHERE uptime_seconds IS NOT NULL ORDER BY id"
            )
        ]


def observed_totals(runs: list[tuple[int, str, str, float]]) -> tuple[float, int]:
    """Sum elapsed sample time per boot; an uptime decrease starts a new boot."""
    if not runs:
        return 0.0, 0
    total = 0.0
    boots = 1
    previous = runs[0][3]
    for _, _, _, uptime in runs[1:]:
        if uptime < previous:
            boots += 1
        else:
            total += uptime - previous
        previous = uptime
    return total, boots


def initialise(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS uptime_snapshots (
            raw_run_id INTEGER PRIMARY KEY,
            collected_at TEXT NOT NULL,
            source_ts_utc TEXT,
            hostname TEXT,
            current_uptime_seconds REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS uptime_events (
            source_key TEXT PRIMARY KEY,
            collected_at TEXT NOT NULL,
            source_ts_utc TEXT NOT NULL,
            hostname TEXT,
            current_uptime_seconds REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS uptime_summary (
            summary_key TEXT PRIMARY KEY,
            updated_at TEXT NOT NULL,
            current_uptime_seconds REAL,
            observed_total_uptime_seconds REAL NOT NULL,
            observed_average_uptime_seconds REAL,
            observed_boots INTEGER NOT NULL,
            raw_sample_count INTEGER NOT NULL,
            minute_bucket_count INTEGER NOT NULL,
            hour_bucket_count INTEGER NOT NULL,
            first_observed_at TEXT,
            last_observed_at TEXT,
            current_hostname TEXT
        );
        """
    )


def stored_events(conn: sqlite3.Connection) -> list[tuple[int, str, str, float]]:
    """Persistent observations survive source database rotation and run-ID reuse."""
    return [
        (0, row[0], row[1] or "unknown", float(row[2]))
        for row in conn.execute(
            "SELECT source_ts_utc, hostname, current_uptime_seconds "
            "FROM uptime_events ORDER BY source_ts_utc, source_key"
        )
    ]


def main() -> int:
    if DB_ROOT.name != "database":
        raise RuntimeError("Refusing to write outside the lowercase database directory")
    runs = raw_runs()
    minute_buckets = source_count(MINUTE_DB, "minute_runs")
    hour_buckets = source_count(HOUR_DB, "hour_runs")
    now = utc_now()

    with sqlite3.connect(UPTIME_DB) as conn:
        initialise(conn)
        conn.executemany(
            "INSERT OR IGNORE INTO uptime_snapshots "
            "(raw_run_id, collected_at, source_ts_utc, hostname, current_uptime_seconds) "
            "VALUES (?, ?, ?, ?, ?)",
            [(run_id, now, ts, hostname, uptime) for run_id, ts, hostname, uptime in runs],
        )
        conn.executemany(
            "INSERT OR IGNORE INTO uptime_events "
            "(source_key, collected_at, source_ts_utc, hostname, current_uptime_seconds) "
            "VALUES (?, ?, ?, ?, ?)",
            [(f"{hostname}:{ts}", now, ts, hostname, uptime) for _, ts, hostname, uptime in runs if ts],
        )
        events = stored_events(conn)
        total, boots = observed_totals(events)
        latest = runs[-1] if runs else None
        conn.execute(
            """
            INSERT INTO uptime_summary (
                summary_key, updated_at, current_uptime_seconds,
                observed_total_uptime_seconds, observed_average_uptime_seconds,
                observed_boots, raw_sample_count, minute_bucket_count,
                hour_bucket_count, first_observed_at, last_observed_at,
                current_hostname
            ) VALUES ('global', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(summary_key) DO UPDATE SET
                updated_at=excluded.updated_at,
                current_uptime_seconds=excluded.current_uptime_seconds,
                observed_total_uptime_seconds=excluded.observed_total_uptime_seconds,
                observed_average_uptime_seconds=excluded.observed_average_uptime_seconds,
                observed_boots=excluded.observed_boots,
                raw_sample_count=excluded.raw_sample_count,
                minute_bucket_count=excluded.minute_bucket_count,
                hour_bucket_count=excluded.hour_bucket_count,
                first_observed_at=excluded.first_observed_at,
                last_observed_at=excluded.last_observed_at,
                current_hostname=excluded.current_hostname
            """,
            (
                now,
                latest[3] if latest else None,
                total,
                sum(row[3] for row in events) / len(events) if events else None,
                boots,
                len(events),
                minute_buckets,
                hour_buckets,
                events[0][1] if events else None,
                events[-1][1] if events else None,
                latest[2] if latest else None,
            ),
        )
        conn.commit()
    print(f"uptime: {len(runs)} raw samples, {total:.0f}s observed across {boots} boot(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

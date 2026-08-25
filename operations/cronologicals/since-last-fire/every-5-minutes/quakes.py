#!/usr/bin/env python3
"""
USGS earthquake poller → SQLite
  - global: all events (past hour feed)
  - hawaii: M ≥ 1.0 (past 24h, island box)

DB: /home/ava-core/database/quakes.db
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.request import Request, urlopen

DB_PATH = Path("/home/ava-core/database/quakes.db")

GLOBAL_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson"

def hawaii_url(hours: int = 24) -> str:
    start = (datetime.now(timezone.utc) - timedelta(hours=hours)).strftime("%Y-%m-%dT%H:%M:%S")
    return (
        "https://earthquake.usgs.gov/fdsnws/event/1/query"
        "?format=geojson&minmagnitude=1"
        "&minlatitude=18.5&maxlatitude=22.5"
        "&minlongitude=-161&maxlongitude=-154"
        f"&orderby=time&starttime={start}"
    )


def fetch(url: str) -> dict:
    req = Request(
        url,
        headers={
            "User-Agent": "ava-core-quake-poller/1.0",
            "Accept-Encoding": "gzip",
        },
    )
    with urlopen(req, timeout=90) as r:
        raw = r.read()
        # urllib may leave gzip compressed if server sends it; try decode
        try:
            return json.loads(raw.decode("utf-8"))
        except UnicodeDecodeError:
            import gzip
            return json.loads(gzip.decompress(raw).decode("utf-8"))


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(DB_PATH))
    con.execute("PRAGMA journal_mode=WAL")
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS quakes (
            id            TEXT PRIMARY KEY,
            source        TEXT NOT NULL,          -- 'global' | 'hawaii'
            time_ms       INTEGER,
            time_utc      TEXT,
            updated_ms    INTEGER,
            updated_utc   TEXT,
            latitude      REAL,
            longitude     REAL,
            depth_km      REAL,
            mag           REAL,
            mag_type      TEXT,
            place         TEXT,
            type          TEXT,
            status        TEXT,
            tsunami       INTEGER,
            sig           INTEGER,
            url           TEXT,
            detail        TEXT,
            raw_json      TEXT NOT NULL,
            first_seen    TEXT NOT NULL,
            last_seen     TEXT NOT NULL
        )
        """
    )
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS poll_runs (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            ts_utc        TEXT NOT NULL,
            global_count  INTEGER,
            hawaii_count  INTEGER,
            upserted      INTEGER,
            ok            INTEGER,
            error         TEXT
        )
        """
    )
    con.execute("CREATE INDEX IF NOT EXISTS idx_quakes_time ON quakes(time_ms DESC)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_quakes_source ON quakes(source)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_quakes_mag ON quakes(mag)")
    con.commit()
    return con


def feature_row(feat: dict, source: str, now: str) -> tuple | None:
    props = feat.get("properties") or {}
    geom = feat.get("geometry") or {}
    coords = geom.get("coordinates") or [None, None, None]
    eid = feat.get("id") or props.get("code")
    if not eid:
        return None

    time_ms = props.get("time")
    updated_ms = props.get("updated")

    def ms_to_iso(ms):
        if ms is None:
            return None
        try:
            return datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc).isoformat()
        except Exception:
            return None

    lon = coords[0] if len(coords) > 0 else None
    lat = coords[1] if len(coords) > 1 else None
    depth = coords[2] if len(coords) > 2 else None

    return (
        eid,
        source,
        time_ms,
        ms_to_iso(time_ms),
        updated_ms,
        ms_to_iso(updated_ms),
        lat,
        lon,
        depth,
        props.get("mag"),
        props.get("magType"),
        props.get("place"),
        props.get("type"),
        props.get("status"),
        props.get("tsunami"),
        props.get("sig"),
        props.get("url"),
        props.get("detail"),
        json.dumps(feat, separators=(",", ":")),
        now,
        now,
    )


UPSERT = """
INSERT INTO quakes (
    id, source, time_ms, time_utc, updated_ms, updated_utc,
    latitude, longitude, depth_km, mag, mag_type, place, type, status,
    tsunami, sig, url, detail, raw_json, first_seen, last_seen
) VALUES (
    ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
)
ON CONFLICT(id) DO UPDATE SET
    source      = excluded.source,
    time_ms     = excluded.time_ms,
    time_utc    = excluded.time_utc,
    updated_ms  = excluded.updated_ms,
    updated_utc = excluded.updated_utc,
    latitude    = excluded.latitude,
    longitude   = excluded.longitude,
    depth_km    = excluded.depth_km,
    mag         = excluded.mag,
    mag_type    = excluded.mag_type,
    place       = excluded.place,
    type        = excluded.type,
    status      = excluded.status,
    tsunami     = excluded.tsunami,
    sig         = excluded.sig,
    url         = excluded.url,
    detail      = excluded.detail,
    raw_json    = excluded.raw_json,
    last_seen   = excluded.last_seen
"""


def ingest(con: sqlite3.Connection, geo: dict, source: str, now: str) -> int:
    n = 0
    for feat in geo.get("features") or []:
        row = feature_row(feat, source, now)
        if not row:
            continue
        con.execute(UPSERT, row)
        n += 1
    return n


def main() -> int:
    now = datetime.now(timezone.utc).isoformat()
    con = connect()
    g_count = h_count = upserted = 0
    err = None
    ok = 1
    try:
        global_geo = fetch(GLOBAL_URL)
        hawaii_geo = fetch(hawaii_url(24))
        g_count = len(global_geo.get("features") or [])
        h_count = len(hawaii_geo.get("features") or [])
        upserted += ingest(con, global_geo, "global", now)
        upserted += ingest(con, hawaii_geo, "hawaii", now)
        con.commit()
    except Exception as e:
        ok = 0
        err = str(e)
        con.rollback()
        print("ERROR:", e)

    con.execute(
        "INSERT INTO poll_runs (ts_utc, global_count, hawaii_count, upserted, ok, error) VALUES (?,?,?,?,?,?)",
        (now, g_count, h_count, upserted, ok, err),
    )
    con.commit()
    total = con.execute("SELECT COUNT(*) FROM quakes").fetchone()[0]
    con.close()
    print(f"OK={ok} global={g_count} hawaii={h_count} upserted={upserted} db_total={total} -> {DB_PATH}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
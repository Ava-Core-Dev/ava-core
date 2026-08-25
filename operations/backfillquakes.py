#!/usr/bin/env python3
"""
Backfill USGS quakes into /home/ava-core/database/quakes.db

Hawaii:  M >= 1.0, island box, monthly chunks
Global:  M >= min_global (default 2.5), weekly chunks

Respects 20k/query cap by shrinking windows on overflow.
"""

from __future__ import annotations

import json
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

DB_PATH = Path("/home/ava-core/database/quakes.db")

# --- tune these ---
HAWAII_START = datetime(2010, 1, 1, tzinfo=timezone.utc)   # how far back for HI
GLOBAL_START = datetime(2020, 1, 1, tzinfo=timezone.utc)   # how far back global
MIN_GLOBAL_MAG = 2.5                                       # use 1.0 only for short ranges
SLEEP_SEC = 1.0                                            # be polite to USGS
MAX_PER_QUERY = 20000

HI_BOX = dict(minlatitude=18.5, maxlatitude=22.5, minlongitude=-161, maxlongitude=-154)


def fetch(params: dict) -> dict:
    q = urlencode(params)
    url = f"https://earthquake.usgs.gov/fdsnws/event/1/query?{q}"
    req = Request(url, headers={"User-Agent": "ava-core-quake-backfill/1.0"})
    with urlopen(req, timeout=120) as r:
        raw = r.read()
        try:
            return json.loads(raw.decode("utf-8"))
        except UnicodeDecodeError:
            import gzip
            return json.loads(gzip.decompress(raw).decode("utf-8"))


def count_events(params: dict) -> int:
    q = urlencode({k: v for k, v in params.items() if k != "format"})
    url = f"https://earthquake.usgs.gov/fdsnws/event/1/count?{q}"
    req = Request(url, headers={"User-Agent": "ava-core-quake-backfill/1.0"})
    with urlopen(req, timeout=60) as r:
        return int(r.read().decode().strip())


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(DB_PATH))
    con.execute("PRAGMA journal_mode=WAL")
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS quakes (
            id            TEXT PRIMARY KEY,
            source        TEXT NOT NULL,
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
    con.execute("CREATE INDEX IF NOT EXISTS idx_quakes_time ON quakes(time_ms DESC)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_quakes_source ON quakes(source)")
    con.commit()
    return con


def ms_to_iso(ms):
    if ms is None:
        return None
    try:
        return datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc).isoformat()
    except Exception:
        return None


UPSERT = """
INSERT INTO quakes (
    id, source, time_ms, time_utc, updated_ms, updated_utc,
    latitude, longitude, depth_km, mag, mag_type, place, type, status,
    tsunami, sig, url, detail, raw_json, first_seen, last_seen
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(id) DO UPDATE SET
    source=excluded.source, time_ms=excluded.time_ms, time_utc=excluded.time_utc,
    updated_ms=excluded.updated_ms, updated_utc=excluded.updated_utc,
    latitude=excluded.latitude, longitude=excluded.longitude, depth_km=excluded.depth_km,
    mag=excluded.mag, mag_type=excluded.mag_type, place=excluded.place,
    type=excluded.type, status=excluded.status, tsunami=excluded.tsunami,
    sig=excluded.sig, url=excluded.url, detail=excluded.detail,
    raw_json=excluded.raw_json, last_seen=excluded.last_seen
"""


def ingest(con: sqlite3.Connection, geo: dict, source: str, now: str) -> int:
    n = 0
    for feat in geo.get("features") or []:
        props = feat.get("properties") or {}
        geom = feat.get("geometry") or {}
        coords = geom.get("coordinates") or [None, None, None]
        eid = feat.get("id") or props.get("code")
        if not eid:
            continue
        time_ms = props.get("time")
        updated_ms = props.get("updated")
        row = (
            eid, source, time_ms, ms_to_iso(time_ms), updated_ms, ms_to_iso(updated_ms),
            coords[1] if len(coords) > 1 else None,
            coords[0] if len(coords) > 0 else None,
            coords[2] if len(coords) > 2 else None,
            props.get("mag"), props.get("magType"), props.get("place"),
            props.get("type"), props.get("status"), props.get("tsunami"),
            props.get("sig"), props.get("url"), props.get("detail"),
            json.dumps(feat, separators=(",", ":")), now, now,
        )
        con.execute(UPSERT, row)
        n += 1
    return n


def daterange_chunks(start: datetime, end: datetime, step: timedelta):
    cur = start
    while cur < end:
        nxt = min(cur + step, end)
        yield cur, nxt
        cur = nxt


def backfill_window(
    con: sqlite3.Connection,
    source: str,
    start: datetime,
    end: datetime,
    step: timedelta,
    extra: dict,
    now: str,
) -> int:
    total = 0
    for a, b in daterange_chunks(start, end, step):
        params = {
            "format": "geojson",
            "orderby": "time",
            "starttime": a.strftime("%Y-%m-%dT%H:%M:%S"),
            "endtime": b.strftime("%Y-%m-%dT%H:%M:%S"),
            **extra,
        }
        # shrink if too many
        try:
            n = count_events(params)
        except Exception as e:
            print(f"  count fail {a.date()}–{b.date()}: {e}")
            time.sleep(SLEEP_SEC)
            continue

        if n == 0:
            print(f"  {source} {a.date()} → {b.date()}: 0")
            time.sleep(SLEEP_SEC * 0.3)
            continue

        if n >= MAX_PER_QUERY:
            # split step in half recursively via smaller step
            if step <= timedelta(hours=6):
                print(f"  SKIP too dense {a}–{b} count={n}")
                time.sleep(SLEEP_SEC)
                continue
            half = step / 2
            print(f"  split {a.date()}–{b.date()} count={n}")
            total += backfill_window(con, source, a, b, half, extra, now)
            continue

        try:
            geo = fetch(params)
            got = ingest(con, geo, source, now)
            con.commit()
            total += got
            print(f"  {source} {a.date()} → {b.date()}: count={n} upserted={got}")
        except Exception as e:
            print(f"  FAIL {a.date()}–{b.date()}: {e}")
            con.rollback()
        time.sleep(SLEEP_SEC)
    return total


def main() -> None:
    now = datetime.now(timezone.utc).isoformat()
    end = datetime.now(timezone.utc)
    con = connect()

    print("=== Hawaii M≥1 ===")
    hi_extra = {"minmagnitude": 1, **HI_BOX}
    hi_n = backfill_window(
        con, "hawaii", HAWAII_START, end, timedelta(days=31), hi_extra, now
    )
    print(f"Hawaii upserted (this run): {hi_n}")

    print("=== Global M≥%.1f ===" % MIN_GLOBAL_MAG)
    g_extra = {"minmagnitude": MIN_GLOBAL_MAG}
    g_n = backfill_window(
        con, "global", GLOBAL_START, end, timedelta(days=7), g_extra, now
    )
    print(f"Global upserted (this run): {g_n}")

    total = con.execute("SELECT COUNT(*) FROM quakes").fetchone()[0]
    by = list(con.execute("SELECT source, COUNT(*) FROM quakes GROUP BY source"))
    con.close()
    print(f"DB total={total} by_source={by} -> {DB_PATH}")


if __name__ == "__main__":
    main()
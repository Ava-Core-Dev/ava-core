#!/usr/bin/env python3
"""
ecoflow_lib.py — Shared library for EcoFlow hierarchical aggregation.

Paths (override with env ECOFLOW_ROOT):
  /home/ava-core/Database/ecoflow/

Devices:
  R331ZAB5SG755642 → security
  R621ZA16XH6K1155 → Primary
  R331ZAB5SG6S2858 → Backup

Hierarchy (source → dest, clear_source only for 10s→1min):
  10s snapshots  →  1min   (CLEAR source after)
  1min           →  15min  (no clear)
  15min          →  1h
  1h             →  4h
  4h             →  8h
  8h             →  12h
  12h            →  24h
  24h            →  3d
  3d             →  7d
  7d             →  month
  month          →  quarter
  quarter        →  year

Missed/late boots: each aggregator condenses ALL unprocessed
source rows into the correct bucket keys for "now".
"""

from __future__ import annotations

import json
import logging
import math
import os
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from pathlib import Path
from statistics import mean, median, stdev
from typing import Any, Callable, Iterable, Optional

# ── paths ──────────────────────────────────────────────────────────────
ECO_ROOT = Path(os.environ.get("ECOFLOW_ROOT", "/home/ava-core/Database/ecoflow"))
LOG_DIR = Path(os.environ.get("ECOFLOW_LOG_DIR", "/home/ava-core/Database/logs"))
CRED_FILE = Path(os.environ.get(
    "ECOFLOW_CRED", "/home/ava-core/Credentials/credentials.env"
))

DB_10S = ECO_ROOT / "ecoflow-10s.db"
DB_1MIN = ECO_ROOT / "ecoflow-1min.db"
DB_15MIN = ECO_ROOT / "ecoflow-15min.db"
DB_1H = ECO_ROOT / "ecoflow-1h.db"
DB_4H = ECO_ROOT / "ecoflow-4h.db"
DB_8H = ECO_ROOT / "ecoflow-8h.db"
DB_12H = ECO_ROOT / "ecoflow-12h.db"
DB_24H = ECO_ROOT / "ecoflow-24h.db"
DB_3D = ECO_ROOT / "ecoflow-3d.db"
DB_7D = ECO_ROOT / "ecoflow-7d.db"
DB_MONTH = ECO_ROOT / "ecoflow-month.db"
DB_QUARTER = ECO_ROOT / "ecoflow-quarter.db"
DB_YEAR = ECO_ROOT / "ecoflow-year.db"
LIVE_JSON = ECO_ROOT / "ecoflow-live.json"
STATE_DB = ECO_ROOT / "ecoflow-state.db"  # watermark / last-processed

NAME_MAP = {
    "R331ZAB5SG755642": "security",
    "R621ZA16XH6K1155": "Primary",
    "R331ZAB5SG6S2858": "Backup",
}

# Canonical metric columns stored at every level
METRIC_COLS = [
    "soc_avg", "soc_min", "soc_max", "soc_delta", "soc_stdev",
    "in_w_avg", "in_w_min", "in_w_max", "in_w_delta",
    "out_w_avg", "out_w_min", "out_w_max", "out_w_delta",
    "solar_w_avg", "solar_w_min", "solar_w_max",
    "net_w_avg", "load_ratio",
    "energy_in_wh", "energy_out_wh", "energy_solar_wh",
    "online_pct",
]

# ── logging helper ─────────────────────────────────────────────────────
def setup_log(name: str) -> logging.Logger:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    ECO_ROOT.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger(name)
    if logger.handlers:
        return logger
    logger.setLevel(logging.INFO)
    fmt = logging.Formatter(
        "%(asctime)s  %(levelname)-7s  %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    fh = logging.FileHandler(LOG_DIR / f"{name}.log")
    fh.setFormatter(fmt)
    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(fmt)
    logger.addHandler(fh)
    logger.addHandler(sh)
    return logger


def friendly(sn: str, fallback: str = "") -> str:
    return NAME_MAP.get(sn, fallback or sn)


# ── safe stats ─────────────────────────────────────────────────────────
def _clean(vals: Iterable) -> list:
    out = []
    for v in vals:
        if v is None:
            continue
        try:
            f = float(v)
            if math.isfinite(f):
                out.append(f)
        except (TypeError, ValueError):
            continue
    return out


def safe_mean(vals) -> Optional[float]:
    v = _clean(vals)
    return round(mean(v), 4) if v else None


def safe_median(vals) -> Optional[float]:
    v = _clean(vals)
    return round(median(v), 4) if v else None


def safe_stdev(vals) -> Optional[float]:
    v = _clean(vals)
    return round(stdev(v), 4) if len(v) > 1 else 0.0 if v else None


def safe_min(vals) -> Optional[float]:
    v = _clean(vals)
    return min(v) if v else None


def safe_max(vals) -> Optional[float]:
    v = _clean(vals)
    return max(v) if v else None


def safe_sum(vals) -> Optional[float]:
    v = _clean(vals)
    return round(sum(v), 4) if v else None


def delta_first_last(vals) -> Optional[float]:
    v = _clean(vals)
    if len(v) < 2:
        return 0.0 if v else None
    return round(v[-1] - v[0], 4)


def trend_from_delta(d: Optional[float], threshold: float = 0.3) -> str:
    if d is None:
        return "unknown"
    if abs(d) < threshold:
        return "stable"
    return "rising" if d > 0 else "falling"


# ── bucket key helpers ─────────────────────────────────────────────────
def parse_ts(ts: str) -> datetime:
    """Parse ISO or 'YYYY-MM-DD HH:MM' into aware UTC datetime."""
    if not ts:
        return datetime.now(timezone.utc)
    s = ts.strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        # fallback common formats
        for fmt in (
            "%Y-%m-%d %H:%M:%S",
            "%Y-%m-%d %H:%M",
            "%Y-%m-%dT%H:%M:%S",
            "%Y-%m-%d",
        ):
            try:
                dt = datetime.strptime(s[: len(fmt) + 2], fmt)
                break
            except ValueError:
                continue
        else:
            return datetime.now(timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def floor_dt(dt: datetime, minutes: int = 0, hours: int = 0) -> datetime:
    dt = dt.astimezone(timezone.utc)
    if hours:
        h = (dt.hour // hours) * hours
        return dt.replace(hour=h, minute=0, second=0, microsecond=0)
    if minutes:
        m = (dt.minute // minutes) * minutes
        return dt.replace(minute=m, second=0, microsecond=0)
    return dt.replace(second=0, microsecond=0)


def bucket_1min(dt: datetime) -> str:
    return floor_dt(dt, minutes=1).strftime("%Y-%m-%d %H:%M")


def bucket_15min(dt: datetime) -> str:
    return floor_dt(dt, minutes=15).strftime("%Y-%m-%d %H:%M")


def bucket_1h(dt: datetime) -> str:
    return floor_dt(dt, hours=1).strftime("%Y-%m-%d %H:00")


def bucket_4h(dt: datetime) -> str:
    return floor_dt(dt, hours=4).strftime("%Y-%m-%d %H:00")


def bucket_8h(dt: datetime) -> str:
    return floor_dt(dt, hours=8).strftime("%Y-%m-%d %H:00")


def bucket_12h(dt: datetime) -> str:
    return floor_dt(dt, hours=12).strftime("%Y-%m-%d %H:00")


def bucket_24h(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%d")


def bucket_3d(dt: datetime) -> str:
    """Start of 3-day window aligned to epoch day // 3."""
    d = dt.astimezone(timezone.utc).date()
    epoch = datetime(1970, 1, 1, tzinfo=timezone.utc).date()
    day_num = (d - epoch).days
    start = epoch + timedelta(days=(day_num // 3) * 3)
    return start.strftime("%Y-%m-%d")


def bucket_7d(dt: datetime) -> str:
    """ISO week start (Monday)."""
    d = dt.astimezone(timezone.utc).date()
    start = d - timedelta(days=d.weekday())
    return start.strftime("%Y-%m-%d")


def bucket_month(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m")


def bucket_quarter(dt: datetime) -> str:
    d = dt.astimezone(timezone.utc)
    q = (d.month - 1) // 3 + 1
    return f"{d.year}-Q{q}"


def bucket_year(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y")


BUCKET_FN = {
    "1min": bucket_1min,
    "15min": bucket_15min,
    "1h": bucket_1h,
    "4h": bucket_4h,
    "8h": bucket_8h,
    "12h": bucket_12h,
    "24h": bucket_24h,
    "3d": bucket_3d,
    "7d": bucket_7d,
    "month": bucket_month,
    "quarter": bucket_quarter,
    "year": bucket_year,
}

# Approximate duration (hours) of one bucket — used for energy when
# aggregating from lower levels that already store energy_*.
BUCKET_HOURS = {
    "1min": 1 / 60,
    "15min": 0.25,
    "1h": 1.0,
    "4h": 4.0,
    "8h": 8.0,
    "12h": 12.0,
    "24h": 24.0,
    "3d": 72.0,
    "7d": 168.0,
    "month": 730.0,   # ~30.4 d
    "quarter": 2190.0,
    "year": 8760.0,
}


# ── schema ─────────────────────────────────────────────────────────────
SUMMARY_DDL = """
CREATE TABLE IF NOT EXISTS summary (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    ts              TEXT NOT NULL,          -- UTC ISO when row written
    bucket_key      TEXT NOT NULL,          -- level-specific key
    level           TEXT NOT NULL,          -- 1min / 15min / 1h / …
    sn              TEXT NOT NULL,
    name            TEXT NOT NULL,
    samples         INTEGER,               -- raw 10s count (propagated)
    source_rows     INTEGER,               -- how many lower-level rows merged

    soc_avg         REAL,
    soc_min         REAL,
    soc_max         REAL,
    soc_delta       REAL,
    soc_stdev       REAL,

    in_w_avg        REAL,
    in_w_min        REAL,
    in_w_max        REAL,
    in_w_delta      REAL,

    out_w_avg       REAL,
    out_w_min       REAL,
    out_w_max       REAL,
    out_w_delta     REAL,

    solar_w_avg     REAL,
    solar_w_min     REAL,
    solar_w_max     REAL,

    net_w_avg       REAL,
    load_ratio      REAL,

    energy_in_wh    REAL,
    energy_out_wh   REAL,
    energy_solar_wh REAL,

    online_pct      REAL,
    trend           TEXT,

    meta_json       TEXT,                  -- extras / source bucket list
    created_at      TEXT DEFAULT (datetime('now')),

    UNIQUE(level, bucket_key, sn)
)
"""

INDEX_DDL = [
    "CREATE INDEX IF NOT EXISTS idx_sum_sn_bucket ON summary(sn, bucket_key)",
    "CREATE INDEX IF NOT EXISTS idx_sum_name_bucket ON summary(name, bucket_key)",
    "CREATE INDEX IF NOT EXISTS idx_sum_level ON summary(level, bucket_key)",
]

SNAPSHOTS_DDL = """
CREATE TABLE IF NOT EXISTS snapshots (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts          TEXT    NOT NULL,
    sn          TEXT    NOT NULL,
    online      INTEGER,
    soc         REAL,
    in_w        REAL,
    out_w       REAL,
    solar_w     REAL,
    raw_json    TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
)
"""

DEVICES_DDL = """
CREATE TABLE IF NOT EXISTS devices (
    sn          TEXT PRIMARY KEY,
    name        TEXT,
    online      INTEGER,
    last_seen   TEXT,
    raw_json    TEXT
)
"""

STATE_DDL = """
CREATE TABLE IF NOT EXISTS watermark (
    level       TEXT PRIMARY KEY,          -- destination level name
    last_id     INTEGER DEFAULT 0,         -- last source row id processed
    last_ts     TEXT,
    updated_at  TEXT
)
"""


def connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def init_summary_db(path: Path) -> sqlite3.Connection:
    conn = connect(path)
    conn.execute(SUMMARY_DDL)
    for ddl in INDEX_DDL:
        conn.execute(ddl)
    conn.commit()
    return conn


def init_10s_db(path: Path) -> sqlite3.Connection:
    conn = connect(path)
    conn.execute(SNAPSHOTS_DDL)
    conn.execute(DEVICES_DDL)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_snap_sn_ts ON snapshots(sn, ts)"
    )
    conn.commit()
    return conn


def init_state_db() -> sqlite3.Connection:
    conn = connect(STATE_DB)
    conn.execute(STATE_DDL)
    conn.commit()
    return conn


def get_watermark(level: str) -> int:
    conn = init_state_db()
    row = conn.execute(
        "SELECT last_id FROM watermark WHERE level=?", (level,)
    ).fetchone()
    conn.close()
    return int(row["last_id"]) if row else 0


def set_watermark(level: str, last_id: int, last_ts: str = "") -> None:
    conn = init_state_db()
    conn.execute(
        """
        INSERT INTO watermark (level, last_id, last_ts, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(level) DO UPDATE SET
            last_id=excluded.last_id,
            last_ts=excluded.last_ts,
            updated_at=excluded.updated_at
        """,
        (level, last_id, last_ts, datetime.now(timezone.utc).isoformat()),
    )
    conn.commit()
    conn.close()


# ── aggregate a list of sample dicts into one summary dict ─────────────
def aggregate_samples(
    samples: list[dict],
    *,
    level: str,
    bucket_key: str,
    sn: str,
    name: str,
    from_energy: bool = False,
) -> dict:
    """
    samples: list of dicts with keys soc/in_w/out_w/solar_w (or *_avg)
             and optionally energy_*_wh, samples, online_pct, ts
    from_energy: True when rolling up already-aggregated energy columns
                 (sum energies); False when deriving energy from power averages.
    """
    if not samples:
        return {}

    def col(key_primary: str, *alts: str) -> list:
        keys = (key_primary,) + alts
        out = []
        for s in samples:
            for k in keys:
                if k in s and s[k] is not None:
                    out.append(s[k])
                    break
        return out

    socs = col("soc", "soc_avg")
    ins = col("in_w", "in_w_avg")
    outs = col("out_w", "out_w_avg")
    solars = col("solar_w", "solar_w_avg")

    soc_avg = safe_mean(socs)
    in_avg = safe_mean(ins)
    out_avg = safe_mean(outs)
    solar_avg = safe_mean(solars)

    soc_d = delta_first_last(socs)
    in_d = delta_first_last(ins)
    out_d = delta_first_last(outs)

    # min/max prefer pre-computed if present
    soc_min = safe_min(col("soc_min", "soc", "soc_avg"))
    soc_max = safe_max(col("soc_max", "soc", "soc_avg"))
    in_min = safe_min(col("in_w_min", "in_w", "in_w_avg"))
    in_max = safe_max(col("in_w_max", "in_w", "in_w_avg"))
    out_min = safe_min(col("out_w_min", "out_w", "out_w_avg"))
    out_max = safe_max(col("out_w_max", "out_w", "out_w_avg"))
    solar_min = safe_min(col("solar_w_min", "solar_w", "solar_w_avg"))
    solar_max = safe_max(col("solar_w_max", "solar_w", "solar_w_avg"))

    net_w = None
    if in_avg is not None and out_avg is not None:
        net_w = round(in_avg - out_avg, 4)

    load_ratio = None
    if in_avg is not None and out_avg is not None:
        load_ratio = round(out_avg / (in_avg + 0.01), 4)

    # energy
    if from_energy:
        energy_in = safe_sum(col("energy_in_wh"))
        energy_out = safe_sum(col("energy_out_wh"))
        energy_solar = safe_sum(col("energy_solar_wh"))
    else:
        # rough Wh from average watts × window
        # prefer sum of per-sample energies if present, else estimate
        e_in_list = col("energy_in_wh")
        e_out_list = col("energy_out_wh")
        e_sol_list = col("energy_solar_wh")
        if e_in_list or e_out_list:
            energy_in = safe_sum(e_in_list)
            energy_out = safe_sum(e_out_list)
            energy_solar = safe_sum(e_sol_list)
        else:
            n = len(samples)
            # 10s samples → window hours
            window_h = (n * 10) / 3600.0
            energy_in = round(in_avg * window_h, 4) if in_avg is not None else None
            energy_out = round(out_avg * window_h, 4) if out_avg is not None else None
            energy_solar = (
                round(solar_avg * window_h, 4) if solar_avg is not None else None
            )

    # samples / online
    sample_counts = col("samples")
    total_samples = int(sum(_clean(sample_counts))) if sample_counts else len(samples)

    online_list = col("online_pct", "online")
    # online may be 0/1; online_pct is 0-100
    online_pct = None
    if online_list:
        cleaned = _clean(online_list)
        if cleaned:
            # if values look like 0/1, scale to percent
            if max(cleaned) <= 1.0:
                online_pct = round(100.0 * mean(cleaned), 2)
            else:
                online_pct = round(mean(cleaned), 2)

    trend = trend_from_delta(soc_d)

    source_keys = []
    for s in samples:
        for k in ("bucket_key", "minute_key", "ts"):
            if k in s and s[k]:
                source_keys.append(str(s[k]))
                break

    return {
        "ts": datetime.now(timezone.utc).isoformat(),
        "bucket_key": bucket_key,
        "level": level,
        "sn": sn,
        "name": name,
        "samples": total_samples,
        "source_rows": len(samples),
        "soc_avg": soc_avg,
        "soc_min": soc_min,
        "soc_max": soc_max,
        "soc_delta": soc_d,
        "soc_stdev": safe_stdev(socs),
        "in_w_avg": in_avg,
        "in_w_min": in_min,
        "in_w_max": in_max,
        "in_w_delta": in_d,
        "out_w_avg": out_avg,
        "out_w_min": out_min,
        "out_w_max": out_max,
        "out_w_delta": out_d,
        "solar_w_avg": solar_avg,
        "solar_w_min": solar_min,
        "solar_w_max": solar_max,
        "net_w_avg": net_w,
        "load_ratio": load_ratio,
        "energy_in_wh": energy_in,
        "energy_out_wh": energy_out,
        "energy_solar_wh": energy_solar,
        "online_pct": online_pct,
        "trend": trend,
        "meta_json": json.dumps({
            "source_keys": source_keys[:50],
            "n_source": len(samples),
        }),
    }


def upsert_summary(conn: sqlite3.Connection, row: dict) -> None:
    cols = [
        "ts", "bucket_key", "level", "sn", "name", "samples", "source_rows",
        "soc_avg", "soc_min", "soc_max", "soc_delta", "soc_stdev",
        "in_w_avg", "in_w_min", "in_w_max", "in_w_delta",
        "out_w_avg", "out_w_min", "out_w_max", "out_w_delta",
        "solar_w_avg", "solar_w_min", "solar_w_max",
        "net_w_avg", "load_ratio",
        "energy_in_wh", "energy_out_wh", "energy_solar_wh",
        "online_pct", "trend", "meta_json",
    ]
    placeholders = ",".join("?" * len(cols))
    col_names = ",".join(cols)
    updates = ",".join(f"{c}=excluded.{c}" for c in cols if c not in ("bucket_key", "level", "sn"))
    sql = f"""
        INSERT INTO summary ({col_names})
        VALUES ({placeholders})
        ON CONFLICT(level, bucket_key, sn) DO UPDATE SET {updates}
    """
    conn.execute(sql, [row.get(c) for c in cols])


# ── generic rollup: source DB → dest DB ────────────────────────────────
def rollup(
    *,
    src_db: Path,
    dst_db: Path,
    src_level: str,          # "10s" or a summary level name
    dst_level: str,
    bucket_fn: Callable[[datetime], str],
    clear_source: bool = False,
    from_energy: bool = True,
    log: Optional[logging.Logger] = None,
) -> int:
    """
    Read unprocessed (or all, if clear_source) rows from src, group by
    (sn, bucket_key), aggregate, upsert into dst.
    Returns number of summary rows written/updated.
    """
    log = log or setup_log(f"ecoflow-{dst_level}")
    if not src_db.exists():
        log.warning(f"Source DB missing: {src_db}")
        return 0

    src = connect(src_db)
    if src_level == "10s":
        table = "snapshots"
        id_col = "id"
        rows = src.execute(
            f"SELECT * FROM {table} ORDER BY {id_col}"
        ).fetchall()
    else:
        table = "summary"
        id_col = "id"
        # only rows of the expected source level
        rows = src.execute(
            f"SELECT * FROM {table} WHERE level=? ORDER BY {id_col}",
            (src_level,),
        ).fetchall()

    if not rows:
        log.info(f"No rows in {src_db} ({src_level}) — nothing to roll up")
        src.close()
        return 0

    # convert to dicts
    samples_by_sn_bucket: dict[tuple[str, str], list[dict]] = defaultdict(list)
    max_id = 0
    max_ts = ""

    for r in rows:
        d = dict(r)
        max_id = max(max_id, int(d.get("id") or 0))
        ts_raw = d.get("ts") or d.get("bucket_key") or d.get("minute_key") or ""
        max_ts = max(max_ts, str(ts_raw))
        sn = d.get("sn") or ""
        if not sn:
            continue
        # normalize power keys for 10s
        if src_level == "10s":
            d.setdefault("in_w", d.get("in_w"))
            d.setdefault("out_w", d.get("out_w"))
            d.setdefault("solar_w", d.get("solar_w"))
            d.setdefault("soc", d.get("soc"))
        bk = bucket_fn(parse_ts(ts_raw if src_level == "10s" else (d.get("bucket_key") or ts_raw)))
        samples_by_sn_bucket[(sn, bk)].append(d)

    dst = init_summary_db(dst_db)
    written = 0
    log_lines = []

    for (sn, bk), samples in sorted(samples_by_sn_bucket.items()):
        name = friendly(sn, samples[0].get("name") or "")
        row = aggregate_samples(
            samples,
            level=dst_level,
            bucket_key=bk,
            sn=sn,
            name=name,
            from_energy=(from_energy and src_level != "10s"),
        )
        if not row:
            continue
        upsert_summary(dst, row)
        written += 1
        line = (
            f"{bk}  {name:10s}  "
            f"soc={row['soc_avg']:>6} ({row['trend']})  "
            f"in={row['in_w_avg']:>7}W  out={row['out_w_avg']:>7}W  "
            f"net={row['net_w_avg']:>8}W  samples={row['samples']}  "
            f"src_rows={row['source_rows']}"
        )
        log_lines.append(line)
        log.info(line)

    dst.commit()
    dst.close()

    if clear_source and src_level == "10s":
        log.info(f"Clearing source snapshots in {src_db}")
        src.execute("DELETE FROM snapshots")
        src.execute("DELETE FROM devices")
        src.commit()
        src.execute("VACUUM")
        src.close()
    else:
        src.close()
        # watermark for non-clearing levels (idempotent re-runs still OK
        # because of UNIQUE upsert, but watermark tracks progress)
        set_watermark(dst_level, max_id, max_ts)

    log.info(f"Wrote/updated {written} {dst_level} row(s) → {dst_db}")
    return written


# ── live JSON status ───────────────────────────────────────────────────
def update_live_json(log: Optional[logging.Logger] = None) -> None:
    """Rebuild ecoflow-live.json from the newest row of every level."""
    log = log or setup_log("ecoflow-live")
    levels = [
        ("1min", DB_1MIN),
        ("15min", DB_15MIN),
        ("1h", DB_1H),
        ("4h", DB_4H),
        ("8h", DB_8H),
        ("12h", DB_12H),
        ("24h", DB_24H),
        ("3d", DB_3D),
        ("7d", DB_7D),
        ("month", DB_MONTH),
        ("quarter", DB_QUARTER),
        ("year", DB_YEAR),
    ]
    live: dict[str, Any] = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "devices": {},
        "levels": {},
    }

    for level, path in levels:
        if not path.exists():
            continue
        conn = connect(path)
        # latest bucket per device
        rows = conn.execute(
            """
            SELECT s.* FROM summary s
            INNER JOIN (
                SELECT sn, MAX(bucket_key) AS mk
                FROM summary WHERE level=?
                GROUP BY sn
            ) t ON s.sn=t.sn AND s.bucket_key=t.mk AND s.level=?
            """,
            (level, level),
        ).fetchall()
        conn.close()
        level_data = {}
        for r in rows:
            d = dict(r)
            name = d.get("name") or friendly(d["sn"])
            entry = {k: d.get(k) for k in (
                "bucket_key", "samples", "source_rows",
                "soc_avg", "soc_min", "soc_max", "soc_delta", "trend",
                "in_w_avg", "out_w_avg", "solar_w_avg", "net_w_avg",
                "energy_in_wh", "energy_out_wh", "energy_solar_wh",
                "online_pct", "load_ratio",
            )}
            level_data[name] = entry
            # also keep top-level latest for each device from 1min if present
            if level == "1min":
                live["devices"][name] = {
                    "sn": d["sn"],
                    "soc": d.get("soc_avg"),
                    "in_w": d.get("in_w_avg"),
                    "out_w": d.get("out_w_avg"),
                    "solar_w": d.get("solar_w_avg"),
                    "net_w": d.get("net_w_avg"),
                    "trend": d.get("trend"),
                    "bucket_key": d.get("bucket_key"),
                }
        live["levels"][level] = level_data

    # totals across devices at 1min
    devs = live.get("devices") or {}
    if devs:
        live["totals"] = {
            "soc_avg": safe_mean([d.get("soc") for d in devs.values()]),
            "in_w": safe_sum([d.get("in_w") for d in devs.values()]),
            "out_w": safe_sum([d.get("out_w") for d in devs.values()]),
            "solar_w": safe_sum([d.get("solar_w") for d in devs.values()]),
            "net_w": safe_sum([d.get("net_w") for d in devs.values()]),
        }

    LIVE_JSON.parent.mkdir(parents=True, exist_ok=True)
    LIVE_JSON.write_text(json.dumps(live, indent=2, default=str))
    log.info(f"Updated {LIVE_JSON}")


# ── credentials (for 10s collector) ────────────────────────────────────
def load_credentials(path: Path = CRED_FILE) -> dict:
    creds = {}
    if not path.exists():
        return creds
    for line in path.read_text(errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if " // " in line:
            line = line.split(" // ", 1)[0].strip()
        if "=" not in line:
            continue
        k, v = line.split("=", 1)
        creds[k.strip()] = v.strip().strip('"').strip("'")
    return creds


def find_key(creds: dict, *candidates: str) -> Optional[str]:
    for c in candidates:
        if c in creds and creds[c]:
            return creds[c]
        for k, v in creds.items():
            if k.upper() == c.upper() and v:
                return v
    return None

#!/usr/bin/env python3
"""
ecoflow-catchup.py — Run the full hierarchy once (missed cron / late boot)

Runs every stage in order so any backlog of 10s → … → year is condensed
into the correct buckets. Safe to run anytime; all stages upsert.

Usage:
  python3 ecoflow-catchup.py
  python3 ecoflow-catchup.py --from 15min   # start mid-chain
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ecoflow_lib import (
    DB_10S, DB_1MIN, DB_15MIN, DB_1H, DB_4H, DB_8H, DB_12H,
    DB_24H, DB_3D, DB_7D, DB_MONTH, DB_QUARTER, DB_YEAR,
    bucket_1min, bucket_15min, bucket_1h, bucket_4h, bucket_8h,
    bucket_12h, bucket_24h, bucket_3d, bucket_7d, bucket_month,
    bucket_quarter, bucket_year,
    rollup, setup_log, update_live_json,
)

log = setup_log("ecoflow-catchup")

# (name, src_db, dst_db, src_level, dst_level, bucket_fn, clear_source, from_energy)
CHAIN = [
    ("1min",    DB_10S,     DB_1MIN,    "10s",     "1min",    bucket_1min,    True,  False),
    ("15min",   DB_1MIN,    DB_15MIN,   "1min",    "15min",   bucket_15min,   False, True),
    ("1h",      DB_15MIN,   DB_1H,      "15min",   "1h",      bucket_1h,      False, True),
    ("4h",      DB_1H,      DB_4H,      "1h",      "4h",      bucket_4h,      False, True),
    ("8h",      DB_4H,      DB_8H,      "4h",      "8h",      bucket_8h,      False, True),
    ("12h",     DB_8H,      DB_12H,     "8h",      "12h",     bucket_12h,     False, True),
    ("24h",     DB_12H,     DB_24H,     "12h",     "24h",     bucket_24h,     False, True),
    ("3d",      DB_24H,     DB_3D,      "24h",     "3d",      bucket_3d,      False, True),
    ("7d",      DB_3D,      DB_7D,      "3d",      "7d",      bucket_7d,      False, True),
    ("month",   DB_7D,      DB_MONTH,   "7d",      "month",   bucket_month,   False, True),
    ("quarter", DB_MONTH,   DB_QUARTER, "month",   "quarter", bucket_quarter, False, True),
    ("year",    DB_QUARTER, DB_YEAR,    "quarter", "year",    bucket_year,    False, True),
]


def main() -> None:
    ap = argparse.ArgumentParser(description="EcoFlow full hierarchy catch-up")
    ap.add_argument(
        "--from", dest="start", default="1min",
        help="First stage to run (default: 1min). e.g. 15min, 1h, 24h",
    )
    ap.add_argument(
        "--only", default=None,
        help="Run a single stage only (e.g. 1h)",
    )
    args = ap.parse_args()

    log.info("ecoflow-catchup starting")
    started = False
    for name, src, dst, src_lv, dst_lv, bfn, clear, from_e in CHAIN:
        if args.only:
            if name != args.only:
                continue
        else:
            if not started:
                if name == args.start:
                    started = True
                else:
                    continue
        log.info(f"── stage {name} ──")
        n = rollup(
            src_db=src,
            dst_db=dst,
            src_level=src_lv,
            dst_level=dst_lv,
            bucket_fn=bfn,
            clear_source=clear,
            from_energy=from_e,
            log=log,
        )
        log.info(f"stage {name}: {n} rows")

    update_live_json(log)
    log.info("ecoflow-catchup finished")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
ecoflow-15min.py — Roll 1-minute summaries → 15-minute buckets

Drop into:
  /home/ava-core/operations/cronologicals/since-last-fire/every-15-minutes/
  (or on-time/HH:00, HH:15, HH:30, HH:45)

Does NOT delete source data. Upserts by (level, bucket_key, sn).
Missed runs: next fire condenses all 1min rows into correct 15min keys.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ecoflow_lib import (
    DB_1MIN,
    DB_15MIN,
    bucket_15min,
    rollup,
    setup_log,
    update_live_json,
)

log = setup_log("ecoflow-15min")


def main() -> None:
    log.info("ecoflow-15min starting")
    n = rollup(
        src_db=DB_1MIN,
        dst_db=DB_15MIN,
        src_level="1min",
        dst_level="15min",
        bucket_fn=bucket_15min,
        clear_source=False,
        from_energy=True,
        log=log,
    )
    update_live_json(log)
    log.info(f"ecoflow-15min finished ({n} rows)")


if __name__ == "__main__":
    main()

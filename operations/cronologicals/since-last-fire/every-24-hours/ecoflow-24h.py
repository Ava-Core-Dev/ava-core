#!/usr/bin/env python3
"""
ecoflow-24h.py — Roll 12-hour → daily (24h) buckets

Cron: every-24-hours / midnight
Does NOT delete source. bucket_key = YYYY-MM-DD
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ecoflow_lib import DB_12H, DB_24H, bucket_24h, rollup, setup_log, update_live_json

log = setup_log("ecoflow-24h")


def main() -> None:
    log.info("ecoflow-24h starting")
    n = rollup(
        src_db=DB_12H,
        dst_db=DB_24H,
        src_level="12h",
        dst_level="24h",
        bucket_fn=bucket_24h,
        clear_source=False,
        from_energy=True,
        log=log,
    )
    update_live_json(log)
    log.info(f"ecoflow-24h finished ({n} rows)")


if __name__ == "__main__":
    main()

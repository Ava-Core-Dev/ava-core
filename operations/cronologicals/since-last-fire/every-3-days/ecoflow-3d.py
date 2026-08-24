#!/usr/bin/env python3
"""
ecoflow-3d.py — Roll daily → 3-day buckets

Cron: every-3-days (or daily; idempotent upsert)
bucket_key = start date of 3-day window (epoch-aligned)
Does NOT delete source.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ecoflow_lib import DB_24H, DB_3D, bucket_3d, rollup, setup_log, update_live_json

log = setup_log("ecoflow-3d")


def main() -> None:
    log.info("ecoflow-3d starting")
    n = rollup(
        src_db=DB_24H,
        dst_db=DB_3D,
        src_level="24h",
        dst_level="3d",
        bucket_fn=bucket_3d,
        clear_source=False,
        from_energy=True,
        log=log,
    )
    update_live_json(log)
    log.info(f"ecoflow-3d finished ({n} rows)")


if __name__ == "__main__":
    main()

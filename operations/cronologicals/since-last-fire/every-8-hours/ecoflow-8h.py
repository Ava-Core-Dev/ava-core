#!/usr/bin/env python3
"""
ecoflow-8h.py — Roll 4-hour → 8-hour buckets

Cron: every-8-hours (00/08/16)
Does NOT delete source.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ecoflow_lib import DB_4H, DB_8H, bucket_8h, rollup, setup_log, update_live_json

log = setup_log("ecoflow-8h")


def main() -> None:
    log.info("ecoflow-8h starting")
    n = rollup(
        src_db=DB_4H,
        dst_db=DB_8H,
        src_level="4h",
        dst_level="8h",
        bucket_fn=bucket_8h,
        clear_source=False,
        from_energy=True,
        log=log,
    )
    update_live_json(log)
    log.info(f"ecoflow-8h finished ({n} rows)")


if __name__ == "__main__":
    main()

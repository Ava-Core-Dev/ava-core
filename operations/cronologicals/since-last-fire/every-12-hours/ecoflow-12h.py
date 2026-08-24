#!/usr/bin/env python3
"""
ecoflow-12h.py — Roll 8-hour → 12-hour buckets

Cron: every-12-hours (00/12) or from 8h chain.
Does NOT delete source.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ecoflow_lib import DB_8H, DB_12H, bucket_12h, rollup, setup_log, update_live_json

log = setup_log("ecoflow-12h")


def main() -> None:
    log.info("ecoflow-12h starting")
    n = rollup(
        src_db=DB_8H,
        dst_db=DB_12H,
        src_level="8h",
        dst_level="12h",
        bucket_fn=bucket_12h,
        clear_source=False,
        from_energy=True,
        log=log,
    )
    update_live_json(log)
    log.info(f"ecoflow-12h finished ({n} rows)")


if __name__ == "__main__":
    main()

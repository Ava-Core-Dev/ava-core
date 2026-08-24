#!/usr/bin/env python3
"""
ecoflow-4h.py — Roll 1-hour → 4-hour buckets

Cron: every-4-hours (or on-time 00/04/08/12/16/20)
Does NOT delete source. Missed windows condense on next fire.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ecoflow_lib import DB_1H, DB_4H, bucket_4h, rollup, setup_log, update_live_json

log = setup_log("ecoflow-4h")


def main() -> None:
    log.info("ecoflow-4h starting")
    n = rollup(
        src_db=DB_1H,
        dst_db=DB_4H,
        src_level="1h",
        dst_level="4h",
        bucket_fn=bucket_4h,
        clear_source=False,
        from_energy=True,
        log=log,
    )
    update_live_json(log)
    log.info(f"ecoflow-4h finished ({n} rows)")


if __name__ == "__main__":
    main()

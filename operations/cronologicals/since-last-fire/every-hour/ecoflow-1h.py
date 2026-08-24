#!/usr/bin/env python3
"""
ecoflow-1h.py — Roll 15-minute → 1-hour buckets

Cron: every-hour or on-time/HH:00
Does NOT delete source. Missed hours condense on next fire.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ecoflow_lib import DB_15MIN, DB_1H, bucket_1h, rollup, setup_log, update_live_json

log = setup_log("ecoflow-1h")


def main() -> None:
    log.info("ecoflow-1h starting")
    n = rollup(
        src_db=DB_15MIN,
        dst_db=DB_1H,
        src_level="15min",
        dst_level="1h",
        bucket_fn=bucket_1h,
        clear_source=False,
        from_energy=True,
        log=log,
    )
    update_live_json(log)
    log.info(f"ecoflow-1h finished ({n} rows)")


if __name__ == "__main__":
    main()

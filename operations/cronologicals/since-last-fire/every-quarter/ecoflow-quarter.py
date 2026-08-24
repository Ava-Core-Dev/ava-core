#!/usr/bin/env python3
"""
ecoflow-quarter.py — Roll month → calendar quarter

bucket_key = YYYY-Q1 … YYYY-Q4
Does NOT delete source.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ecoflow_lib import DB_MONTH, DB_QUARTER, bucket_quarter, rollup, setup_log, update_live_json

log = setup_log("ecoflow-quarter")


def main() -> None:
    log.info("ecoflow-quarter starting")
    n = rollup(
        src_db=DB_MONTH,
        dst_db=DB_QUARTER,
        src_level="month",
        dst_level="quarter",
        bucket_fn=bucket_quarter,
        clear_source=False,
        from_energy=True,
        log=log,
    )
    update_live_json(log)
    log.info(f"ecoflow-quarter finished ({n} rows)")


if __name__ == "__main__":
    main()

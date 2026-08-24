#!/usr/bin/env python3
"""
ecoflow-year.py — Roll quarter → calendar year

bucket_key = YYYY
Does NOT delete source.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ecoflow_lib import DB_QUARTER, DB_YEAR, bucket_year, rollup, setup_log, update_live_json

log = setup_log("ecoflow-year")


def main() -> None:
    log.info("ecoflow-year starting")
    n = rollup(
        src_db=DB_QUARTER,
        dst_db=DB_YEAR,
        src_level="quarter",
        dst_level="year",
        bucket_fn=bucket_year,
        clear_source=False,
        from_energy=True,
        log=log,
    )
    update_live_json(log)
    log.info(f"ecoflow-year finished ({n} rows)")


if __name__ == "__main__":
    main()

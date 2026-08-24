#!/usr/bin/env python3
"""
ecoflow-month.py — Roll weekly → calendar month

Cron: every-month (or daily; upsert is idempotent)
bucket_key = YYYY-MM
Does NOT delete source.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ecoflow_lib import DB_7D, DB_MONTH, bucket_month, rollup, setup_log, update_live_json

log = setup_log("ecoflow-month")


def main() -> None:
    log.info("ecoflow-month starting")
    n = rollup(
        src_db=DB_7D,
        dst_db=DB_MONTH,
        src_level="7d",
        dst_level="month",
        bucket_fn=bucket_month,
        clear_source=False,
        from_energy=True,
        log=log,
    )
    update_live_json(log)
    log.info(f"ecoflow-month finished ({n} rows)")


if __name__ == "__main__":
    main()

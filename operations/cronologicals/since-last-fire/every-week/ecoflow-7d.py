#!/usr/bin/env python3
"""
ecoflow-7d.py — Roll 3-day → weekly (ISO week, Monday start)

Cron: every-week
bucket_key = Monday YYYY-MM-DD
Does NOT delete source.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ecoflow_lib import DB_3D, DB_7D, bucket_7d, rollup, setup_log, update_live_json

log = setup_log("ecoflow-7d")


def main() -> None:
    log.info("ecoflow-7d starting")
    n = rollup(
        src_db=DB_3D,
        dst_db=DB_7D,
        src_level="3d",
        dst_level="7d",
        bucket_fn=bucket_7d,
        clear_source=False,
        from_energy=True,
        log=log,
    )
    update_live_json(log)
    log.info(f"ecoflow-7d finished ({n} rows)")


if __name__ == "__main__":
    main()

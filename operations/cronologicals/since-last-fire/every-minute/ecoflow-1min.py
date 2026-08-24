#!/usr/bin/env python3
"""
ecoflow-1min.py — Aggregate 10s snapshots → 1-minute summaries

Drop into:
  /home/ava-core/operations/cronologicals/since-last-fire/every-minute/

- Reads ALL rows currently in ecoflow-10s.db
- Groups by (sn, YYYY-MM-DD HH:MM)
- Upserts into ecoflow-1min.db
- CLEARS ecoflow-10s.db (snapshots + devices) and VACUUMs
- Updates ecoflow-live.json

Missed minutes (late boot / cron gap): all pending 10s samples are
bucketed into their correct minute keys on the next run.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ecoflow_lib import (
    DB_10S,
    DB_1MIN,
    bucket_1min,
    rollup,
    setup_log,
    update_live_json,
)

log = setup_log("ecoflow-1min")


def main() -> None:
    log.info("ecoflow-1min starting")
    n = rollup(
        src_db=DB_10S,
        dst_db=DB_1MIN,
        src_level="10s",
        dst_level="1min",
        bucket_fn=bucket_1min,
        clear_source=True,       # only this stage clears the 10s buffer
        from_energy=False,       # derive Wh from power × window
        log=log,
    )
    update_live_json(log)
    log.info(f"ecoflow-1min finished ({n} rows)")


if __name__ == "__main__":
    main()

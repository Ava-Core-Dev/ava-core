#!/usr/bin/env python3
"""All US state news scan — every 10 minutes.

Uses operations/news/build_state_news.py which skips states checked recently
and only polls stale / empty DBs. Safe to run alongside legacy on-time launchers.
"""
from pathlib import Path
import runpy
import sys

ROOT = Path("/home/ava-core")
# Force a lower max-age so 10-minute cadence actually refreshes when stale
sys.argv = [sys.argv[0], "--max-age-minutes", "9"]
runpy.run_path(str(ROOT / "operations/news/build_state_news.py"), run_name="__main__")

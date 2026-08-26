#!/usr/bin/env python3
"""Global news scan — every 10 minutes."""
from pathlib import Path
import runpy

ROOT = Path("/home/ava-core")
runpy.run_path(str(ROOT / "operations/news/build_global_news.py"), run_name="__main__")

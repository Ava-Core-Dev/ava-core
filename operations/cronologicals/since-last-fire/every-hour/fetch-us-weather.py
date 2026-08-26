#!/usr/bin/env python3
"""Hourly US weather collection (all states + dense Hawaiʻi)."""
from pathlib import Path
import runpy

ROOT = Path("/home/ava-core")
runpy.run_path(str(ROOT / "operations/weather/fetch_us_weather.py"), run_name="__main__")

#!/usr/bin/env python3
from pathlib import Path
import runpy
p=Path(__file__).resolve().parents[5]/"operations/locations/st/s-o-tom-and-pr-ncipe/s-o-tom/poller.py"
runpy.run_path(str(p), run_name="__main__")

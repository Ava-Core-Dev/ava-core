#!/usr/bin/env python3
from pathlib import Path
import runpy
p=Path(__file__).resolve().parents[5]/"operations/locations/us/iowa/des-moines/poller.py"
runpy.run_path(str(p), run_name="__main__")

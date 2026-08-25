#!/usr/bin/env python3
"""On-time hourly GitHub sync — delegates to operations/system-tools/github-auto-push.py
Safe if multiple HH:00 slots fire; the real runner uses a non-blocking lock.
"""
import runpy
import sys
from pathlib import Path

TARGET = Path("/home/ava-core/operations/system-tools/github-auto-push.py")
if not TARGET.is_file():
    print(f"ERROR: missing {TARGET}", file=sys.stderr)
    sys.exit(1)
sys.argv = [str(TARGET)] + sys.argv[1:]
runpy.run_path(str(TARGET), run_name="__main__")

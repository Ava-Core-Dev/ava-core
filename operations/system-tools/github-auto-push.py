#!/usr/bin/env python3
"""
github-auto-push.py — run-once GitHub sync for Ava Core

Safe to invoke from many hourly cron slots. Uses a non-blocking lock so only
one instance runs at a time. Delegates the actual selective push to
/home/ava-core/core_uploader.py (existing exclusions, token discovery, etc.).

Exit codes:
  0  success (pushed, or nothing to commit, or another instance already running)
  1  uploader failed / misconfiguration
  2  lock path / environment error

Usage:
  python3 /home/ava-core/operations/system-tools/github-auto-push.py
  python3 /home/ava-core/operations/system-tools/github-auto-push.py --dry-run
"""

from __future__ import annotations

import argparse
import fcntl
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path("/home/ava-core")
UPLOADER = ROOT / "core_uploader.py"
LOCK_PATH = Path("/tmp/ava-github-auto-push.lock")
LOG_DIR = ROOT / "database" / "logs"
LOG_FILE = LOG_DIR / "github-auto-push.log"


def log(msg: str) -> None:
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    line = f"{ts}  {msg}"
    print(line, flush=True)
    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass


def acquire_lock():
    """Non-blocking exclusive lock. Returns file object or None if busy."""
    try:
        fh = open(LOCK_PATH, "w")
        fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        fh.write(str(os.getpid()))
        fh.flush()
        return fh
    except BlockingIOError:
        return None
    except OSError as e:
        log(f"ERROR lock: {e}")
        return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Ava Core → GitHub auto-push (run once)")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--uploader",
        type=Path,
        default=UPLOADER,
        help="Path to core_uploader.py",
    )
    args = parser.parse_args()

    if not args.uploader.is_file():
        log(f"ERROR: uploader not found: {args.uploader}")
        return 1

    lock_fh = acquire_lock()
    if lock_fh is None:
        log("skip: another github-auto-push instance is running")
        return 0

    try:
        cmd = [sys.executable, str(args.uploader)]
        if args.dry_run:
            cmd.append("--dry-run")

        log(f"start: {' '.join(cmd)}")
        t0 = time.time()
        result = subprocess.run(
            cmd,
            cwd=str(ROOT),
            text=True,
            capture_output=True,
        )
        elapsed = time.time() - t0

        if result.stdout and result.stdout.strip():
            for line in result.stdout.rstrip().splitlines():
                log(f"  | {line}")
        if result.stderr and result.stderr.strip():
            for line in result.stderr.rstrip().splitlines():
                log(f"  ! {line}")

        if result.returncode != 0:
            log(f"FAIL rc={result.returncode} after {elapsed:.1f}s")
            return 1

        log(f"ok after {elapsed:.1f}s")
        return 0
    finally:
        try:
            fcntl.flock(lock_fh.fileno(), fcntl.LOCK_UN)
            lock_fh.close()
        except OSError:
            pass


if __name__ == "__main__":
    sys.exit(main())

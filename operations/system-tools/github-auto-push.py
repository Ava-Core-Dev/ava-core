#!/usr/bin/env python3
"""
github-auto-push.py — run-once GitHub sync for Ava Core

Safe to invoke from many hourly cron slots. Uses a non-blocking lock so only
one instance runs at a time. Delegates the actual selective push to
/home/ava-core/core_uploader.py (existing exclusions, token discovery, etc.).

Streams uploader output live (no silent hang). core_uploader clones the repo
and walks /home/ava-core — first run can take several minutes; that is normal.

Exit codes:
  0  success (pushed, nothing to commit, or another instance already running)
  1  uploader failed / misconfiguration / timeout
  2  lock / environment error

Usage:
  python3 /home/ava-core/operations/system-tools/github-auto-push.py
  python3 /home/ava-core/operations/system-tools/github-auto-push.py --dry-run
  python3 /home/ava-core/operations/system-tools/github-auto-push.py --timeout 900
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

# Default: 20 minutes. core_uploader can be slow on a full tree + clone.
DEFAULT_TIMEOUT = 1200


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


def run_streaming(cmd: list[str], timeout: int | None) -> int:
    """Run cmd, stream stdout/stderr line-by-line to console + log."""
    log(f"start: {' '.join(cmd)}")
    if timeout:
        log(f"timeout: {timeout}s")
    log("note: core_uploader clones GitHub then walks the tree — may take minutes")

    t0 = time.time()
    try:
        proc = subprocess.Popen(
            cmd,
            cwd=str(ROOT),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
    except OSError as e:
        log(f"ERROR spawn: {e}")
        return 1

    try:
        assert proc.stdout is not None
        while True:
            if timeout is not None and (time.time() - t0) > timeout:
                log(f"TIMEOUT after {timeout}s — killing uploader")
                proc.kill()
                try:
                    proc.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    pass
                return 1

            line = proc.stdout.readline()
            if line:
                # Strip trailing newline; log() adds its own framing for file,
                # but for console we want the uploader's own lines mostly raw.
                text = line.rstrip("\n")
                print(text, flush=True)
                try:
                    LOG_DIR.mkdir(parents=True, exist_ok=True)
                    with open(LOG_FILE, "a", encoding="utf-8") as f:
                        f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')}  | {text}\n")
                except OSError:
                    pass
                continue

            if proc.poll() is not None:
                break

            time.sleep(0.05)

        # Drain any remaining buffered lines
        rest = proc.stdout.read()
        if rest:
            for text in rest.splitlines():
                print(text, flush=True)
                try:
                    with open(LOG_FILE, "a", encoding="utf-8") as f:
                        f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')}  | {text}\n")
                except OSError:
                    pass

        rc = proc.wait()
        elapsed = time.time() - t0
        if rc != 0:
            log(f"FAIL rc={rc} after {elapsed:.1f}s")
            return 1
        log(f"ok after {elapsed:.1f}s")
        return 0
    except KeyboardInterrupt:
        log("interrupted by user — stopping uploader")
        proc.kill()
        try:
            proc.wait(timeout=5)
        except Exception:
            pass
        return 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Ava Core → GitHub auto-push (run once)")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--timeout",
        type=int,
        default=DEFAULT_TIMEOUT,
        help=f"Kill uploader after N seconds (default {DEFAULT_TIMEOUT}; 0 = no limit)",
    )
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
        cmd = [sys.executable, "-u", str(args.uploader)]  # -u = unbuffered child
        if args.dry_run:
            cmd.append("--dry-run")

        timeout = None if args.timeout == 0 else args.timeout
        return run_streaming(cmd, timeout)
    finally:
        try:
            fcntl.flock(lock_fh.fileno(), fcntl.LOCK_UN)
            lock_fh.close()
        except OSError:
            pass


if __name__ == "__main__":
    sys.exit(main())

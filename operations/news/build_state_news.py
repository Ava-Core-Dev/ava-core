#!/usr/bin/env python3
"""Ava Ivy state-news hourly collector.

Uses the existing operations/news/<state>/news.py collectors.
Does not replace or duplicate state collectors or databases.

Normal hourly behavior:
- new/empty state DB -> bounded --backfill
- recently checked state -> skip
- stale state -> incremental poll

The existing daily on-time state launchers may remain in place. Freshness
checking prevents the hourly builder from needlessly recollecting a state.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
import argparse
import sqlite3
import subprocess
import sys

ROOT = Path("/home/ava-core")
NEWS_ROOT = ROOT / "operations" / "news"
STATE_DB_ROOT = ROOT / "database" / "states"
DEFAULT_MAX_AGE_MINUTES = 55
WORKERS = 8
TIMEOUT_SECONDS = 120


def parse_time(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(
            str(value).replace("Z", "+00:00")
        ).astimezone(timezone.utc)
    except Exception:
        return None


def db_state(db: Path):
    if not db.is_file():
        return False, None

    try:
        con = sqlite3.connect(str(db), timeout=10)
        try:
            posts = con.execute("SELECT COUNT(*) FROM posts").fetchone()[0]
            events = con.execute("SELECT COUNT(*) FROM events").fetchone()[0]

            times = []
            for table, column in (
                ("source_health", "last_checked_at"),
                ("posts", "collected_at"),
                ("events", "collected_at"),
            ):
                try:
                    row = con.execute(
                        f"SELECT MAX({column}) FROM {table}"
                    ).fetchone()
                    if row and row[0]:
                        dt = parse_time(row[0])
                        if dt:
                            times.append(dt)
                except sqlite3.Error:
                    pass

            latest = max(times) if times else None
            return bool(posts or events), latest
        finally:
            con.close()
    except Exception:
        return False, None


def collector_running(collector: Path) -> bool:
    """Avoid colliding with an existing daily on-time launcher."""
    try:
        result = subprocess.run(
            ["pgrep", "-f", str(collector)],
            text=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=3,
        )
        return result.returncode == 0
    except Exception:
        return False


def run_state(state_dir: Path, max_age_minutes: int, force: bool) -> dict:
    state = state_dir.name
    collector = state_dir / "news.py"
    db = STATE_DB_ROOT / state / f"{state}_news.db"

    if not collector.is_file():
        return {"state": state, "status": "missing"}

    has_content, latest = db_state(db)
    now = datetime.now(timezone.utc)

    recent = bool(
        latest and
        (now - latest).total_seconds() < max_age_minutes * 60
    )

    if not force and has_content and recent:
        return {
            "state": state,
            "status": "skipped",
            "reason": "fresh",
            "last_checked": latest.isoformat(),
        }

    if collector_running(collector):
        return {
            "state": state,
            "status": "skipped",
            "reason": "already-running",
        }

    backfill = not has_content
    command = [sys.executable, str(collector)]
    if backfill:
        command.append("--backfill")

    started = now.isoformat()

    try:
        result = subprocess.run(
            command,
            cwd=str(ROOT),
            text=True,
            capture_output=True,
            timeout=TIMEOUT_SECONDS,
        )
        return {
            "state": state,
            "status": "ok" if result.returncode == 0 else "failed",
            "mode": "backfill" if backfill else "incremental",
            "returncode": result.returncode,
            "stdout": result.stdout.strip(),
            "stderr": result.stderr.strip(),
            "started": started,
        }
    except subprocess.TimeoutExpired:
        return {
            "state": state,
            "status": "timeout",
            "mode": "backfill" if backfill else "incremental",
            "started": started,
        }
    except Exception as exc:
        return {
            "state": state,
            "status": "error",
            "error": repr(exc),
            "started": started,
        }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--max-age-minutes",
        type=int,
        default=DEFAULT_MAX_AGE_MINUTES,
    )
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    if not NEWS_ROOT.is_dir():
        print(f"ERROR: missing news directory: {NEWS_ROOT}")
        return 1

    states = sorted(
        p for p in NEWS_ROOT.iterdir()
        if p.is_dir()
        and (p / "news.py").is_file()
        and not p.name.startswith("_")
    )

    if not states:
        print("ERROR: no state news collectors found.")
        return 1

    print("=" * 64)
    print("AVA IVY STATE NEWS — HOURLY POLL")
    print("=" * 64)
    print(f"Collectors found: {len(states)}")
    print(f"Freshness window: {args.max_age_minutes} minutes")
    print(f"Workers: {WORKERS}")
    print()

    results = []
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {
            pool.submit(run_state, state, args.max_age_minutes, args.force): state.name
            for state in states
        }
        for future in as_completed(futures):
            result = future.result()
            results.append(result)
            state = result["state"]
            status = result["status"]
            if status == "ok":
                print(f"[{state}] OK · {result['mode']}")
            elif status == "skipped":
                print(f"[{state}] SKIP · {result['reason']}")
            elif status == "missing":
                print(f"[{state}] MISSING collector")
            elif status == "timeout":
                print(f"[{state}] TIMEOUT")
            else:
                print(f"[{state}] FAILED · returncode={result.get('returncode')}")
                if result.get("stderr"):
                    print(f"  {result['stderr']}")

    results.sort(key=lambda r: r["state"])
    failed = [r for r in results if r["status"] in {"failed", "timeout", "error", "missing"}]
    collected = [r for r in results if r["status"] == "ok"]
    skipped = [r for r in results if r["status"] == "skipped"]

    print()
    print("=" * 64)
    print("STATE NEWS HOURLY POLL COMPLETE")
    print("=" * 64)
    print(f"States checked: {len(results)}")
    print(f"Collected:      {len(collected)}")
    print(f"Skipped fresh:  {len(skipped)}")
    print(f"Failed:         {len(failed)}")
    print()
    print("The existing build_global_news.py remains responsible for the global index.")

    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())

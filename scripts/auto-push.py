"""Git auto-push for AVA-CORE on Windows (Task Scheduler, pythonw).

Every tick: if tracked files are dirty (except secrets / Media / large DBs /
__pycache__), stage the safe paths, commit `auto: sync <timestamp>`, push
HEAD and `dev`. Never --force. Never --no-verify.

Quiet when there is nothing to do. Skips if AVA_AUTO_PUSH=0 or the off flag.
Shares git-sync.lock with auto-pull.py.
"""
from __future__ import annotations

import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from git_win import (
    LOG_DIR,
    REPO,
    acquire_lock,
    git,
    git_exe,
    is_git_repo,
    is_unsafe_auto_path,
    merge_in_progress,
    release_lock,
    skip_worktree_missing_tracked,
    unstage_secrets,
)

# New source under these trees is auto-staged. Not Media, not data, not packages/web leftovers.
SAFE_ADD = (
    "AGENTS.md",
    "apps/core/",
    "apps/desktop/",
    "packages/workers/",
    "scripts/auto-push.py",
    "scripts/git_win.py",
    "scripts/auto-pull.py",
    "windows/register-services.ps1",
    "windows/auto-push.xml",
    "windows/auto-pull.xml",
    "windows/watchdog.xml",
    "windows/site-update.xml",
    "windows/assert_c_only.py",
)
LOG = LOG_DIR / "auto-push.log"
FLAG_WIN = Path.home() / ".ava" / "github-auto-push.off"
FLAG_NIX = Path.home() / ".local" / "state" / "ava" / "github-auto-push.off"


def log(msg: str) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    LOG.open("a", encoding="utf-8").write(f"{datetime.now(timezone.utc).isoformat()} {msg}\n")


def _ahead_count(exe: str) -> int | None:
    up = git(exe, "rev-parse", "--abbrev-ref", "@{u}")
    if up.returncode != 0:
        return None
    n = git(exe, "rev-list", "--count", "@{u}..HEAD")
    try:
        return int((n.stdout or "0").strip() or "0")
    except ValueError:
        return 0


def _staged_names(exe: str) -> list[str]:
    return [
        f.strip().replace("\\", "/")
        for f in git(exe, "diff", "--cached", "--name-only").stdout.splitlines()
        if f.strip()
    ]


def _commit_safe(exe: str, dry: bool) -> bool:
    """Stage tracked changes plus new product source that is safe, then commit."""
    git(exe, "add", "-u")
    existing = [p for p in SAFE_ADD if (REPO / p).exists()]
    if existing:
        git(exe, "add", "--", *existing)
    secrets = unstage_secrets(exe)
    if secrets:
        log("unstaged secrets: " + " ".join(secrets[:12]))
    staged = _staged_names(exe)
    unsafe = [f for f in staged if is_unsafe_auto_path(f)]
    if unsafe:
        git(exe, "restore", "--staged", "--", *unsafe)
        log("unstaged unsafe: " + " ".join(unsafe[:12]))
    dirty = git(exe, "diff", "--cached", "--quiet").returncode != 0
    if not dirty:
        return False
    if dry:
        log("dry-run: would commit " + " ".join(_staged_names(exe)[:16]))
        git(exe, "restore", "--staged", ".")
        return False
    msg = f"auto: sync {datetime.now().astimezone().strftime('%Y-%m-%d %H:%M %Z')}"
    c = git(exe, "commit", "-m", msg)
    if c.returncode != 0:
        err = (c.stderr or c.stdout or "").strip().splitlines()
        log("commit failed: " + " | ".join(err[-4:] or ["(no git stderr)"]))
        return False
    log("commit " + git(exe, "rev-parse", "--short", "HEAD").stdout.strip())
    return True


def main(argv: list[str]) -> int:
    dry = "--dry-run" in argv
    once = "--once" in argv
    if os.environ.get("AVA_AUTO_PUSH", "1").lower() in {"0", "false", "no"}:
        return 0
    if FLAG_WIN.is_file() or FLAG_NIX.is_file():
        return 0
    if not is_git_repo():
        log(f"skip: not a git repo ({REPO})")
        return 0
    if merge_in_progress():
        log("skip: merge/rebase in progress")
        return 0
    exe = git_exe()
    if not exe:
        log("skip: git.exe not found")
        return 1

    # Task Scheduler will not take PT30S on this Windows. Tick twice per 1-min task.
    deadline = time.monotonic() + (0 if once or dry else 50)
    rc = 0
    while True:
        rc = _tick(exe, dry)
        if once or dry or time.monotonic() + 30 > deadline:
            break
        time.sleep(30)
    return rc


def _tick(exe: str, dry: bool) -> int:
    lock = acquire_lock()
    if lock is None:
        log("skip: git-sync lock held")
        return 0
    try:
        marked = skip_worktree_missing_tracked(exe)
        if marked:
            log(f"skip-worktree missing tracked {marked}")
        did_commit = _commit_safe(exe, dry)
        branch = git(exe, "rev-parse", "--abbrev-ref", "HEAD").stdout.strip()
        ahead = _ahead_count(exe)
        if ahead is None:
            log(f"skip push: no upstream for {branch}")
            return 0
        if ahead == 0 and not did_commit:
            return 0
        if dry:
            log(f"dry-run: would push origin HEAD:{branch} (ahead={ahead})")
            return 0
        p = git(exe, "push", "origin", f"HEAD:{branch}", timeout=180)
        if p.returncode != 0:
            err = (p.stderr or p.stdout or "push failed").strip().splitlines()
            safe = [ln for ln in err if "token" not in ln.lower() and "password" not in ln.lower()]
            log("push failed: " + " | ".join(safe[-4:] or ["(no git stderr)"]))
            return 1
        log(f"pushed {branch} " + git(exe, "rev-parse", "--short", "HEAD").stdout.strip())
        d = git(exe, "push", "origin", "HEAD:dev", timeout=180)
        if d.returncode == 0:
            log("pushed dev")
        else:
            log("dev push skipped/failed (non-fatal)")
        return 0
    finally:
        release_lock(lock)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

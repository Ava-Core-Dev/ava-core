"""Git auto-push for AVA-CORE on Windows (Task Scheduler, pythonw).

Pushes already-committed work to origin. Never --force. Never --no-verify.
Never stages .env / tokens / credentials.

Does not `git add -A` the whole dirty tree (parallel agents + cutover WIP).
Optional website-path commit (holding HTML / Sites / worker source), matching
the old Linux job’s site-sync intent. Set AVA_AUTO_COMMIT_ALL=1 to restore
the Linux `git add -A` behavior.

Quiet when there is nothing to do. Skips if AVA_AUTO_PUSH=0 or the off flag.
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from git_win import (
    LOG_DIR,
    REPO,
    acquire_lock,
    git,
    git_exe,
    is_git_repo,
    merge_in_progress,
    release_lock,
    skip_worktree_missing_tracked,
    unstage_secrets,
)

LOG = LOG_DIR / "auto-push.log"
FLAG_WIN = Path.home() / ".ava" / "github-auto-push.off"
FLAG_NIX = Path.home() / ".local" / "state" / "ava" / "github-auto-push.off"

# Holding page + worker source only. Not desk, not .env, not apps/desktop.
WEBSITE_PATHS = (
    "apps/core/static/maintenance.html",
    "Sites/Holding/index.html",
    "packages/workers/src/shared/maintenancePage.ts",
    "packages/workers/holding-worker.ts",
    "packages/workers/wrangler.rootrecord-cloud.toml",
    "packages/workers/wrangler.holding.toml",
    "windows/sync_maintenance_html.py",
)


def log(msg: str) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    LOG.open("a", encoding="utf-8").write(f"{datetime.now(timezone.utc).isoformat()} {msg}\n")


def _norm(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n")


def _website_changed(exe: str, rel: str) -> bool:
    path = REPO / rel
    if not path.is_file():
        return False
    shown = git(exe, "show", f"HEAD:{rel}")
    working = path.read_text(encoding="utf-8")
    if shown.returncode != 0:
        return True
    return _norm(working) != _norm(shown.stdout)


def _ahead_count(exe: str) -> int | None:
    up = git(exe, "rev-parse", "--abbrev-ref", "@{u}")
    if up.returncode != 0:
        return None
    n = git(exe, "rev-list", "--count", "@{u}..HEAD")
    try:
        return int((n.stdout or "0").strip() or "0")
    except ValueError:
        return 0


def main(argv: list[str]) -> int:
    dry = "--dry-run" in argv
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
    lock = acquire_lock()
    if lock is None:
        log("skip: git-sync lock held")
        return 0
    try:
        marked = skip_worktree_missing_tracked(exe)
        if marked:
            log(f"skip-worktree missing tracked {marked}")
        commit_all = os.environ.get("AVA_AUTO_COMMIT_ALL", "0").lower() in {"1", "true", "yes"}
        did_commit = False
        if commit_all:
            if dry:
                log("dry-run: would git add -A (AVA_AUTO_COMMIT_ALL)")
            else:
                git(exe, "add", "-A")
                secrets = unstage_secrets(exe)
                if secrets:
                    log("unstaged secrets: " + " ".join(secrets))
                dirty = git(exe, "diff", "--cached", "--quiet").returncode != 0
                if dirty:
                    msg = f"auto: sync {datetime.now().astimezone().strftime('%Y-%m-%d %H:%M %Z')}"
                    c = git(exe, "commit", "-m", msg)
                    if c.returncode != 0:
                        err = (c.stderr or c.stdout or "").strip().splitlines()
                        log("commit failed: " + " | ".join(err[-4:] or ["(no git stderr)"]))
                        return 1
                    did_commit = True
                    log("commit " + git(exe, "rev-parse", "--short", "HEAD").stdout.strip())
        else:
            changed = [p for p in WEBSITE_PATHS if _website_changed(exe, p)]
            if changed:
                if dry:
                    log("dry-run: would commit website " + " ".join(changed))
                else:
                    git(exe, "add", "--", *changed)
                    secrets = unstage_secrets(exe)
                    if secrets:
                        log("unstaged secrets: " + " ".join(secrets))
                    staged = [
                        f.strip().replace("\\", "/")
                        for f in git(exe, "diff", "--cached", "--name-only").stdout.splitlines()
                        if f.strip()
                    ]
                    extra = [f for f in staged if f not in WEBSITE_PATHS]
                    if extra:
                        git(exe, "restore", "--staged", "--", *extra)
                        log("unstaged non-website: " + " ".join(extra[:12]))
                    dirty = git(exe, "diff", "--cached", "--quiet").returncode != 0
                    if dirty:
                        msg = f"auto: holding {datetime.now().astimezone().strftime('%Y-%m-%d %H:%M %Z')}"
                        c = git(exe, "commit", "-m", msg)
                        if c.returncode != 0:
                            err = (c.stderr or c.stdout or "").strip().splitlines()
                            log("commit failed: " + " | ".join(err[-4:] or ["(no git stderr)"]))
                            return 1
                        did_commit = True
                        log("commit " + git(exe, "rev-parse", "--short", "HEAD").stdout.strip() + " " + " ".join(changed))

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
        # Rolling dev pointer like Linux auto-push.sh. Never --force.
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

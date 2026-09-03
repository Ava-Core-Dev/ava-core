"""Git auto-pull for AVA-CORE on Windows (Task Scheduler, pythonw).

ff-only. Refuses a dirty working tree (does not stash or clobber).
Shares git-sync.lock with auto-push.py.

Marks GitHub blobs missing from this Windows tree as skip-worktree (colon
cron paths, audio/web on E:). Does not git add -A, force-push, or write
git config.

Modes:
  status  local ahead/behind, no network
  check   fetch; pull if AVA_GIT_AUTO_PULL=1 (default 1) and clean
  pull    fetch + ff-only (still refuses dirty)

Scheduled task runs: check
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone

from git_win import (
    LOG_DIR,
    REPO,
    acquire_lock,
    git,
    git_exe,
    is_git_repo,
    is_secret_path,
    merge_in_progress,
    release_lock,
    skip_worktree_missing_tracked,
)

LOG = LOG_DIR / "git-pull-live.log"


def log(msg: str) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    LOG.open("a", encoding="utf-8").write(f"{datetime.now(timezone.utc).isoformat()} {msg}\n")


def emit_json(payload: dict) -> None:
    line = "AVA_GIT_JSON:" + json.dumps(payload, separators=(",", ":"))
    try:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()
    except OSError:
        pass


def _count(exe: str, rev: str) -> int:
    n = git(exe, "rev-list", "--count", rev)
    try:
        return int((n.stdout or "0").strip() or "0")
    except ValueError:
        return 0


def _tree_dirty(exe: str) -> bool:
    return git(exe, "diff", "--quiet").returncode != 0 or git(exe, "diff", "--cached", "--quiet").returncode != 0


def _dirty_names(exe: str, limit: int = 12) -> list[str]:
    names = git(exe, "diff", "--name-only").stdout.splitlines()
    names += git(exe, "diff", "--cached", "--name-only").stdout.splitlines()
    seen: list[str] = []
    for n in names:
        n = n.strip()
        if not n or n in seen or is_secret_path(n):
            continue
        seen.append(n)
        if len(seen) >= limit:
            break
    return seen


def main(argv: list[str]) -> int:
    args = [a for a in argv if not a.startswith("--")]
    dry = "--dry-run" in argv
    mode = args[0] if args else "check"
    if os.environ.get("AVA_GIT_AUTO_PULL", "1").lower() in {"0", "false", "no"} and mode == "check":
        mode = "status"

    out = {
        "ok": True,
        "action": mode,
        "detail": "ok",
        "branch": None,
        "upstream": None,
        "ahead": 0,
        "behind": 0,
        "dirty": False,
        "pulled": False,
        "changed_core": False,
        "changed_desktop": False,
        "changed_web": False,
        "repo": str(REPO),
    }

    def done(rc: int, detail: str | None = None, ok: bool | None = None) -> int:
        if detail:
            out["detail"] = detail
        if ok is not None:
            out["ok"] = ok
        elif rc != 0:
            out["ok"] = False
        emit_json(out)
        return rc

    if not is_git_repo():
        log(f"skip: not a git repo ({REPO})")
        return done(0, "not_a_repo", ok=False)
    if merge_in_progress():
        log("skip: merge/rebase in progress")
        return done(1, "rebase_or_merge", ok=False)
    exe = git_exe()
    if not exe:
        log("skip: git.exe not found")
        return done(1, "no_git", ok=False)
    lock = acquire_lock()
    if lock is None:
        log("skip: git-sync lock held")
        return done(0, "busy_lock", ok=False)
    try:
        marked = skip_worktree_missing_tracked(exe)
        if marked:
            log(f"skip-worktree missing tracked {marked}")

        branch = git(exe, "rev-parse", "--abbrev-ref", "HEAD").stdout.strip() or "master"
        out["branch"] = branch
        up = git(exe, "rev-parse", "--abbrev-ref", "@{u}")
        if up.returncode != 0:
            log("skip: no upstream")
            return done(0, "no_upstream", ok=False)
        upstream = up.stdout.strip()
        out["upstream"] = upstream
        remote, _, remote_branch = upstream.partition("/")
        if not remote_branch:
            remote, remote_branch = "origin", branch
        dirty = _tree_dirty(exe)
        out["dirty"] = dirty
        ahead = _count(exe, f"{upstream}..HEAD") if git(exe, "rev-parse", "--verify", upstream).returncode == 0 else 0
        behind = _count(exe, f"HEAD..{upstream}") if git(exe, "rev-parse", "--verify", upstream).returncode == 0 else 0
        out["ahead"] = ahead
        out["behind"] = behind

        if mode == "status":
            log(f"status branch={branch} upstream={upstream} ahead={ahead} behind={behind} dirty={dirty}")
            return done(0, "status")

        if mode in {"check", "pull"}:
            if dry:
                log(f"dry-run: would fetch {remote}")
            else:
                log(f"fetch {remote}")
                f = git(exe, "fetch", "--prune", remote, timeout=180)
                if f.returncode != 0:
                    err = (f.stderr or f.stdout or "").strip().splitlines()
                    safe = [ln for ln in err if "token" not in ln.lower() and "password" not in ln.lower()]
                    log("fetch failed: " + " | ".join(safe[-4:] or ["(no git stderr)"]))
                    return done(1, "fetch_failed", ok=False)
                ahead = _count(exe, f"{upstream}..HEAD")
                behind = _count(exe, f"HEAD..{upstream}")
                out["ahead"] = ahead
                out["behind"] = behind
                dirty = _tree_dirty(exe)
                out["dirty"] = dirty

        auto = os.environ.get("AVA_GIT_AUTO_PULL", "1").lower() not in {"0", "false", "no"}
        want_pull = mode == "pull" or (mode == "check" and auto and behind > 0)
        if not want_pull:
            log(f"up_to_date_or_check branch={branch} ahead={ahead} behind={behind} dirty={dirty}")
            return done(0, "up_to_date" if behind == 0 else "behind")
        if dirty:
            names = _dirty_names(exe)
            extra = f" files={len(names)} " + " ".join(names) if names else ""
            log(f"refuse pull: working tree dirty (behind={behind} ahead={ahead}){extra} — commit/push first")
            return done(0, "dirty_tree", ok=False)
        if behind == 0:
            log(f"already up to date with {upstream}")
            return done(0, "already_up_to_date")
        if dry:
            log(f"dry-run: would ff-only pull {remote} {remote_branch} ({behind} behind)")
            return done(0, "dry_run")
        before = git(exe, "rev-parse", "HEAD").stdout.strip()
        log(f"ff-only pull {upstream} ({behind} behind)")
        p = git(exe, "pull", "--ff-only", remote, remote_branch, timeout=180)
        if p.returncode != 0:
            err = (p.stderr or p.stdout or "").strip().splitlines()
            safe = [ln for ln in err if "token" not in ln.lower() and "password" not in ln.lower()]
            log("ff-only pull failed: " + " | ".join(safe[-6:] or ["conflict or non-ff"]))
            return done(1, "pull_failed", ok=False)
        after = git(exe, "rev-parse", "HEAD").stdout.strip()
        files = git(exe, "diff", "--name-only", f"{before}..{after}").stdout.splitlines()
        out["pulled"] = True
        out["changed_core"] = any(f.startswith("apps/core/") for f in files)
        out["changed_desktop"] = any(f.startswith("apps/desktop/") for f in files)
        out["changed_web"] = any(f.startswith("packages/web/") for f in files)
        out["ahead"] = _count(exe, f"{upstream}..HEAD")
        out["behind"] = _count(exe, f"HEAD..{upstream}")
        log("pulled " + git(exe, "rev-parse", "--short", "HEAD").stdout.strip())
        return done(0, "pulled")
    finally:
        release_lock(lock)


if __name__ == "__main__":
    rc = main(sys.argv[1:])
    sys.exit(rc)

"""Fast-forward-only GitHub pull for the AVA server.

The server is a deployment target: it fetches the configured upstream and
pulls only when the checkout is clean and behind. It never pushes, stashes,
resets, merges, or logs Git credentials.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from fcntl import LOCK_EX, LOCK_NB, LOCK_UN, lockf
from pathlib import Path

REPO = Path(os.environ.get("AVA_REPO", str(Path(__file__).resolve().parents[1]))).resolve()
LOG_DIR = Path(os.environ.get("AVA_LOG_DIR", str(REPO / "data" / "logs")))
LOCK_PATH = LOG_DIR / "git-sync.lock"
LOG_PATH = LOG_DIR / "git-pull-server.log"


def log(message: str) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    with LOG_PATH.open("a", encoding="utf-8") as handle:
        handle.write(f"{datetime.now(timezone.utc).isoformat()} {message}\n")


def git(*args: str, timeout: int = 180) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env.setdefault("GIT_TERMINAL_PROMPT", "0")
    return subprocess.run(
        [os.environ.get("AVA_GIT", "git"), *args],
        cwd=REPO,
        capture_output=True,
        text=True,
        timeout=timeout,
        env=env,
    )


def safe_output(result: subprocess.CompletedProcess[str]) -> str:
    lines = (result.stderr or result.stdout or "").strip().splitlines()
    return " | ".join(line for line in lines[-6:] if "token" not in line.lower() and "password" not in line.lower())


def emit(payload: dict[str, object]) -> int:
    print("AVA_GIT_JSON:" + json.dumps(payload, separators=(",", ":")), flush=True)
    return 0 if payload.get("ok") else 1


def count(revision_range: str) -> int:
    result = git("rev-list", "--count", revision_range)
    try:
        return int((result.stdout or "0").strip() or "0")
    except ValueError:
        return 0


def main(argv: list[str]) -> int:
    mode = next((arg for arg in argv if not arg.startswith("--")), "check")
    dry_run = "--dry-run" in argv
    result: dict[str, object] = {
        "ok": True,
        "action": mode,
        "detail": "ok",
        "repo": str(REPO),
        "branch": None,
        "upstream": None,
        "ahead": 0,
        "behind": 0,
        "dirty": False,
        "pulled": False,
    }

    def finish(detail: str, ok: bool = True) -> int:
        result["detail"] = detail
        result["ok"] = ok
        return emit(result)

    if not (REPO / ".git").exists():
        return finish("not_a_repo", False)

    lock_handle = None
    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        lock_handle = LOCK_PATH.open("a+")
        lockf(lock_handle.fileno(), LOCK_EX | LOCK_NB)
    except (BlockingIOError, OSError):
        if lock_handle:
            lock_handle.close()
        return finish("busy_lock", False)

    try:
        branch_result = git("symbolic-ref", "--short", "HEAD")
        branch = branch_result.stdout.strip()
        if not branch:
            return finish("detached_head", False)
        result["branch"] = branch

        upstream_result = git("rev-parse", "--abbrev-ref", "@{u}")
        upstream = upstream_result.stdout.strip()
        if upstream_result.returncode != 0 or not upstream:
            return finish("no_upstream", False)
        result["upstream"] = upstream

        status = git("status", "--porcelain")
        dirty = bool(status.stdout.strip())
        result["dirty"] = dirty
        if mode == "status":
            return finish("status")
        if mode not in {"check", "pull"}:
            return finish("unknown_action", False)
        if dirty:
            log("refuse pull: working tree dirty")
            return finish("dirty_tree", False)
        if dry_run:
            return finish("dry_run")

        remote, _, remote_branch = upstream.partition("/")
        if not remote_branch:
            return finish("invalid_upstream", False)
        fetched = git("fetch", "--prune", remote)
        if fetched.returncode != 0:
            log("fetch failed: " + safe_output(fetched))
            return finish("fetch_failed", False)

        result["ahead"] = count(f"{upstream}..HEAD")
        result["behind"] = count(f"HEAD..{upstream}")
        if not result["behind"]:
            return finish("up_to_date")

        pulled = git("pull", "--ff-only", remote, remote_branch)
        if pulled.returncode != 0:
            log("ff-only pull failed: " + safe_output(pulled))
            return finish("pull_failed", False)
        result["pulled"] = True
        result["ahead"] = count(f"{upstream}..HEAD")
        result["behind"] = count(f"HEAD..{upstream}")
        log("pulled " + git("rev-parse", "--short", "HEAD").stdout.strip())
        return finish("pulled")
    finally:
        if lock_handle:
            lockf(lock_handle.fileno(), LOCK_UN)
            lock_handle.close()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

"""Shared Windows git helpers for auto-push / auto-pull.

Finds git.exe even when Task Scheduler PATH is empty.
Never force-pushes. Never skips hooks. Never stages secrets.
"""
from __future__ import annotations

import msvcrt
import os
import shutil
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
LOG_DIR = Path(os.environ.get("AVA_AUTO_PUSH_LOG_DIR", str(REPO / "data" / "logs")))
LOCK_PATH = LOG_DIR / "git-sync.lock"

GIT_CANDIDATES = (
    Path(os.environ["ProgramFiles"]) / "Git" / "cmd" / "git.exe" if os.environ.get("ProgramFiles") else None,
    Path(r"C:\Program Files\Git\cmd\git.exe"),
    Path(r"C:\Program Files\Git\bin\git.exe"),
    Path(r"C:\Program Files (x86)\Git\cmd\git.exe"),
    Path.home() / "AppData" / "Local" / "Programs" / "Git" / "cmd" / "git.exe",
)

SECRET_MARKERS = (".env", ".token", ".pem", ".p12", ".jks", ".keystore")

# Never hide dirty state for live product paths (skip-worktree is only for
# GitHub blobs that this Windows tree never checked out).
PRODUCT_DIRTY_PREFIXES = (
    "apps/core/",
    "apps/desktop/",
    "apps/voice/",
    "packages/workers/",
    "packages/web/",
    "scripts/",
    "windows/",
    "Sites/",
)
PRODUCT_DIRTY_FILES = frozenset(
    {
        "AGENTS.md",
        ".gitignore",
        ".gitattributes",
        "pyproject.toml",
        "README.md",
        "EDITING.md",
    }
)
CREATE_NO_WINDOW = 0x08000000


def _hidden_run_kwargs() -> dict:
    """git.exe is a console app — hide the window even when parent is pythonw."""
    kw: dict = {}
    if os.name == "nt":
        kw["creationflags"] = CREATE_NO_WINDOW
        si = subprocess.STARTUPINFO()
        si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        si.wShowWindow = 0
        kw["startupinfo"] = si
    return kw


def is_git_repo(root: Path = REPO) -> bool:
    git = root / ".git"
    return git.is_dir() or git.is_file()


def git_exe() -> str | None:
    override = os.environ.get("AVA_GIT") or os.environ.get("GIT_EXE")
    if override and Path(override).is_file():
        return override
    for cand in GIT_CANDIDATES:
        if cand is not None and cand.is_file():
            return str(cand)
    found = shutil.which("git")
    return found


def git(exe: str, *args: str, check: bool = False, timeout: int = 120) -> subprocess.CompletedProcess:
    # -c only for this process. GitHub main contains paths with ':' that Windows
    # cannot checkout; protectNTFS=false lets the index load. Never writes git config.
    env = os.environ.copy()
    env.setdefault("GIT_TERMINAL_PROMPT", "0")
    env.setdefault("GCM_INTERACTIVE", "never")
    # Process env only — matches E:\ava\ava-core-v2 identity. Does not write git config.
    env.setdefault("GIT_AUTHOR_NAME", "Ava-Core-Dev")
    env.setdefault("GIT_AUTHOR_EMAIL", "ava-core-dev@users.noreply.github.com")
    env.setdefault("GIT_COMMITTER_NAME", "Ava-Core-Dev")
    env.setdefault("GIT_COMMITTER_EMAIL", "ava-core-dev@users.noreply.github.com")
    return subprocess.run(
        [exe, "-c", "core.protectNTFS=false", "-c", "core.longpaths=true", *args],
        cwd=REPO,
        capture_output=True,
        text=True,
        check=check,
        timeout=timeout,
        env=env,
        **_hidden_run_kwargs(),
    )


def is_secret_path(rel: str) -> bool:
    name = rel.replace("\\", "/").lower()
    base = name.rsplit("/", 1)[-1]
    if base in {".env", "credentials.env", "origin.token", "identities.sqlite"}:
        return True
    if "credentials" in name:
        return True
    if "wallet-secrets" in name or name.endswith(".wallet"):
        return True
    return any(name.endswith(ext) or base.endswith(ext) for ext in SECRET_MARKERS)


_UNSAFE_PREFIX = (
    "media/",
    "data/",
    "node_modules/",
    ".venv/",
    "dist/",
    "build/",
    "apps/data/",
)
_UNSAFE_EXT = {".db", ".sqlite", ".sqlite3", ".pyc", ".mp4", ".wav", ".webm", ".zip", ".7z", ".gguf"}


def is_unsafe_auto_path(rel: str) -> bool:
    """Runtime blobs, secrets, and caches — never auto-committed."""
    n = rel.replace("\\", "/").lstrip("./")
    low = n.lower()
    if is_secret_path(n):
        return True
    if any(part == "__pycache__" or part == "node_modules" for part in low.split("/")):
        return True
    if any(low.startswith(p) or low.startswith(p.lower()) for p in _UNSAFE_PREFIX):
        return True
    ext = Path(low).suffix
    return ext in _UNSAFE_EXT


def keep_visible_dirty(rel: str) -> bool:
    n = rel.replace("\\", "/").lstrip("./")
    if n in PRODUCT_DIRTY_FILES:
        return True
    return any(n.startswith(p) for p in PRODUCT_DIRTY_PREFIXES)


def skip_worktree_missing_tracked(exe: str) -> int:
    """Hide tracked files that are not on disk (Windows --no-checkout attach).

    GitHub main has ':' cron folders and trees that live on E: (audio/web).
    Those show as 3800+ deletions and block ff-only pull. skip-worktree is an
    index bit only — does not write git config, does not delete, does not add.
    Product paths stay visible if they go missing.
    """
    raw = git(exe, "ls-files", "-d", "-z")
    paths = [p for p in (raw.stdout or "").split("\0") if p]
    todo = [p for p in paths if not keep_visible_dirty(p)]
    marked = 0
    chunk = 40
    for i in range(0, len(todo), chunk):
        batch = todo[i : i + chunk]
        r = git(exe, "update-index", "--skip-worktree", "--", *batch)
        if r.returncode == 0:
            marked += len(batch)
            continue
        for p in batch:
            if git(exe, "update-index", "--skip-worktree", "--", p).returncode == 0:
                marked += 1
    return marked


def unstage_secrets(exe: str) -> list[str]:
    staged = git(exe, "diff", "--cached", "--name-only").stdout.splitlines()
    secrets = [f for f in staged if is_secret_path(f)]
    if secrets:
        git(exe, "restore", "--staged", "--", *secrets)
    return secrets


def acquire_lock():
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    fh = open(LOCK_PATH, "a+b")
    try:
        if fh.tell() == 0:
            fh.write(b"\0")
            fh.flush()
        fh.seek(0)
        msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        fh.close()
        return None
    return fh


def release_lock(fh) -> None:
    if fh is None:
        return
    try:
        fh.seek(0)
        msvcrt.locking(fh.fileno(), msvcrt.LK_UNLCK, 1)
    except OSError:
        pass
    fh.close()


def merge_in_progress(root: Path = REPO) -> bool:
    gitdir = root / ".git"
    if gitdir.is_file():
        return False
    return (
        (gitdir / "MERGE_HEAD").exists()
        or (gitdir / "rebase-merge").is_dir()
        or (gitdir / "rebase-apply").is_dir()
    )

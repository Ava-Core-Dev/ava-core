#!/usr/bin/env python3
"""
Ava Core Uploader — selective, safe push of /home/ava-core
to https://github.com/Ava-Core-Dev/ava-core

Usage:
  python3 core_uploader.py --dry-run
  python3 core_uploader.py
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import List, Optional

DEFAULT_ROOT = Path("/home/ava-core")
DEFAULT_OWNER = "Ava-Core-Dev"
DEFAULT_REPO = "ava-core"
DEFAULT_BRANCH = "main"

CREDENTIALS_CANDIDATES = [
    Path("/home/ava-core/Credentials/github_token"),
    Path("/home/ava-core/Credentials/credentials.env"),
    Path("/home/ava-core/credentials/github_token"),
    Path("/home/ava-core/credentials/credentials.env"),
    Path.home() / "Credentials" / "github_token",
    Path.home() / "Credentials" / "credentials.env",
]

ALWAYS_EXCLUDE = {
    # Secrets / credentials
    ".env",
    ".env.local",
    ".env.production",
    "credentials.env",
    "credentials",
    ".credentials",
    "Credentials",
    ".ssh",
    ".gnupg",
    "id_rsa",
    "id_ed25519",
    "*.pem",
    "*.key",

    # Known secret-containing files (blocked by GitHub Push Protection)
    "MANIFEST.json",
    "1o1.py",                       # operations/system-tools/gemini/1o1.py

    # Oversized mapping files (warnings + slow)
    "file_mapping.json",
    "file_mapping.txt",

    # Tooling / IDE / AI / caches
    "codex",
    ".codex",
    "cursor",
    ".cursor",
    "emergent",
    ".emergent",
    "ext",
    ".ext",
    ".agents",
    ".ava",
    ".cache",
    "cache",
    "codex-runtimes",

    # Virtualenvs / Python
    "venv",
    ".venv",
    "env",
    "virtualenv",
    "site-packages",

    # Browser / desktop profiles
    "brave",
    ".brave",
    "BraveSoftware",
    "google-chrome",
    "chromium",
    "mozilla",
    ".mozilla",
    "firefox",

    # Heavy home clutter / runtime data
    ".cargo",
    ".cloudflared",
    ".config",
    ".gradle",
    ".local",
    ".minecraft",
    ".npm",
    ".ollama",
    ".pki",
    ".rustup",
    ".venvs",
    "Desktop",
    "Downloads",
    "Pictures",
    "Screenshots",
    "Database",
    "compress",
    "snap",
    ".gitignore",
    ".bash_logout",
    ".bash_history",
    ".profile",
    "gitconfig",
    ".bashrc",
    ".wget-hsts",
    ".gitignore",
    "gemini_env/pyvenv.cfg",
    "gemini_env/.gitignore",
    ".snap",
    ".git-ava-core-backup",

    # Build / runtime junk
    "node_modules",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    "data",
    "var",
    "media",
    "logs",
    "*.log",
    ".git",
    "tmp",
    "temp",
    "*.db",
    "*.sqlite",
    "*.sqlite3",
    "secrets",
    "private",

    # Huge binary
    "files.zip",
}


def load_token(cli_token: Optional[str]) -> str:
    if cli_token:
        return cli_token.strip()

    for key in ("GITHUB_TOKEN", "GH_TOKEN"):
        val = os.environ.get(key)
        if val:
            return val.strip()

    for path in CREDENTIALS_CANDIDATES:
        if not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue

        if path.name == "github_token":
            token = text.strip().splitlines()[0].strip()
            if token:
                return token

        for line in text.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            m = re.match(r"^(GH_TOKEN|GITHUB_TOKEN)=(.*)", line)
            if m:
                val = m.group(2).split("//")[0].strip().strip('"').strip("'")
                if val:
                    return val

    raise SystemExit(
        "No GitHub token found. Set GITHUB_TOKEN / GH_TOKEN, pass --token, "
        "or put it in /home/ava-core/Credentials/github_token"
    )


def should_exclude(path: Path, root: Path) -> bool:
    rel = path.relative_to(root)
    parts = {p.lower() for p in rel.parts}
    name = path.name.lower()

    for excl in ALWAYS_EXCLUDE:
        if excl.startswith("*"):
            if name.endswith(excl[1:].lower()):
                return True
        elif excl.lower() in parts or name == excl.lower():
            return True
    return False


def _redact_cmd(cmd: List[str]) -> str:
    """Hide tokens that appear in git URLs."""
    redacted = []
    for arg in cmd:
        if "x-access-token:" in arg and "@github.com" in arg:
            redacted.append(re.sub(r"x-access-token:[^@]+@", "x-access-token:***@", arg))
        else:
            redacted.append(arg)
    return " ".join(redacted)


def run(cmd: List[str], cwd: Path | None = None, check: bool = True) -> subprocess.CompletedProcess:
    print(f"  $ {_redact_cmd(cmd)}")
    result = subprocess.run(cmd, cwd=cwd, check=False, text=True, capture_output=True)
    if result.stdout and result.stdout.strip():
        print(result.stdout.rstrip())
    if result.stderr and result.stderr.strip():
        print(result.stderr.rstrip(), file=sys.stderr)
    if check and result.returncode != 0:
        raise subprocess.CalledProcessError(
            result.returncode, cmd, output=result.stdout, stderr=result.stderr
        )
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Safe Ava-core → GitHub uploader")
    parser.add_argument("--owner", default=DEFAULT_OWNER)
    parser.add_argument("--repo", default=DEFAULT_REPO)
    parser.add_argument("--token", default=None, help="GitHub PAT (or use env / credentials file)")
    parser.add_argument("--path", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--branch", default=DEFAULT_BRANCH)
    parser.add_argument(
        "--force",
        action="store_true",
        default=True,
        help="Use --force-with-lease on push (default: True)",
    )
    parser.add_argument(
        "--no-force",
        action="store_false",
        dest="force",
        help="Disable force push",
    )
    args = parser.parse_args()

    token = load_token(args.token)
    root = args.path.resolve()
    if not root.is_dir():
        print(f"ERROR: {root} does not exist", file=sys.stderr)
        return 1

    print(f"Source:      {root}")
    print(f"Target:      {args.owner}/{args.repo} ({args.branch})")
    print(f"Dry-run:     {args.dry_run}")
    print(f"Force push:  {args.force}")
    print()

    with tempfile.TemporaryDirectory(prefix="ava-upload-") as tmp:
        tmp_path = Path(tmp)
        clone_url = f"https://x-access-token:{token}@github.com/{args.owner}/{args.repo}.git"

        print("Cloning target repository...")
        try:
            run(["git", "clone", "--depth", "1", "--branch", args.branch, clone_url, str(tmp_path)])
        except subprocess.CalledProcessError:
            run(["git", "clone", "--depth", "1", clone_url, str(tmp_path)])
            run(["git", "checkout", "-B", args.branch], cwd=tmp_path)

        for item in tmp_path.iterdir():
            if item.name == ".git":
                continue
            if item.is_dir():
                shutil.rmtree(item)
            else:
                item.unlink()

        print("Copying allowed files...")
        copied = 0
        skipped = 0

        for src in root.rglob("*"):
            if not src.is_file():
                continue
            if should_exclude(src, root):
                skipped += 1
                continue

            try:
                if src.stat().st_size > 95 * 1024 * 1024:
                    print(f"  skip large  {src.relative_to(root)} ({src.stat().st_size // 1024 // 1024} MB)")
                    skipped += 1
                    continue
            except OSError:
                skipped += 1
                continue

            rel = src.relative_to(root)
            dst = tmp_path / rel
            dst.parent.mkdir(parents=True, exist_ok=True)

            if args.dry_run:
                print(f"  would copy  {rel}")
            else:
                shutil.copy2(src, dst)
            copied += 1

        print(f"\nCopied: {copied}   Skipped: {skipped}")

        if args.dry_run:
            print("\nDry-run complete — nothing was pushed.")
            return 0

        run(["git", "config", "user.email", "ava-uploader@local"], cwd=tmp_path)
        run(["git", "config", "user.name", "Ava Core Uploader"], cwd=tmp_path)
        run(["git", "add", "-A"], cwd=tmp_path)

        status = run(["git", "status", "--porcelain"], cwd=tmp_path, check=False)
        if not status.stdout.strip():
            print("Nothing to commit.")
            return 0

        msg = f"chore: sync from {root} ({copied} files)"
        run(["git", "commit", "-m", msg], cwd=tmp_path)

        print("Pushing...")
        push_cmd = ["git", "push", "-u", "origin", args.branch]
        if args.force:
            push_cmd.append("--force-with-lease")
        run(push_cmd, cwd=tmp_path)
        print("✓ Done")

    return 0


if __name__ == "__main__":
    sys.exit(main())
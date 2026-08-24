#!/usr/bin/env python3
"""
Ava Core Puller — trusted-source sync FROM GitHub INTO /home/ava-core

Checks for updates on Ava-Core-Dev/ava-core. If new commits exist and every
new commit author is trusted (you / us / people list), copies allowed files
into the local main layout.

Only applies updates from:
  - us   (org / Ava Core Uploader)
  - you  (Grok / agent identities)
  - people on the people list

Usage:
  python3 core_puller.py --dry-run
  python3 core_puller.py
  python3 core_puller.py --check-only
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

DEFAULT_ROOT = Path("/home/ava-core")
DEFAULT_OWNER = "Ava-Core-Dev"
DEFAULT_REPO = "ava-core"
DEFAULT_BRANCH = "main"
PEOPLE_CANDIDATES = [
    Path("/home/ava-core/context/people.json"),
    Path("/home/ava-core/operations/meta/people.json"),
    Path("/home/ava-core/people.json"),
]

CREDENTIALS_CANDIDATES = [
    Path("/home/ava-core/Credentials/github_token"),
    Path("/home/ava-core/Credentials/credentials.env"),
    Path("/home/ava-core/credentials/github_token"),
    Path("/home/ava-core/credentials/credentials.env"),
    Path.home() / "Credentials" / "github_token",
    Path.home() / "Credentials" / "credentials.env",
]

# Mirror of uploader excludes — never overwrite runtime/secrets/local data.
NEVER_OVERWRITE: Set[str] = {
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
    "MANIFEST.json",
    "1o1.py",
    "file_mapping.json",
    "file_mapping.txt",
    "files.zip",
    "codex",
    ".codex",
    "cursor",
    ".cursor",
    "emergent",
    ".emergent",
    ".agents",
    ".ava",
    ".cache",
    "cache",
    "venv",
    ".venv",
    "env",
    "virtualenv",
    "site-packages",
    "gemini_env",
    "brave",
    ".brave",
    "BraveSoftware",
    "google-chrome",
    "chromium",
    "mozilla",
    ".mozilla",
    "firefox",
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
    "database",
    "compress",
    "snap",
    ".bash_logout",
    ".bash_history",
    ".profile",
    "gitconfig",
    ".bashrc",
    ".wget-hsts",
    ".gitignore",
    ".gitconfig",
    ".snap",
    ".git-ava-core-backup",
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
    # local state that must stay machine-local
    "directory.enabled",
    "directory.enabled.disabled",
    ".ava-core-state.json",
    ".run-ava-state.json",
    "tunnel.token",
    "ava-core-v2.token",
}

# Prefer bringing in these trees from GitHub when trusted.
PREFERRED_PREFIXES = (
    "web/",
    "operations/",
    "context/",
    "AGENTS.md",
    "README.md",
    "core_uploader.py",
    "core_puller.py",
    "file_mapper.py",
    "people.json",
)


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


def load_people(explicit: Optional[Path]) -> dict:
    candidates = [explicit] if explicit else []
    candidates.extend(PEOPLE_CANDIDATES)
    # also next to this script
    candidates.append(Path(__file__).resolve().parent / "people.json")
    for path in candidates:
        if path and path.is_file():
            data = json.loads(path.read_text(encoding="utf-8"))
            data["_path"] = str(path)
            return data
    # built-in minimal trust (us + grok uploader identity)
    return {
        "version": 1,
        "_path": "(builtin)",
        "trusted": [
            {
                "id": "us",
                "github_logins": ["Ava-Core-Dev"],
                "git_emails": ["ava-uploader@local", "ava-core@local"],
                "git_names": ["Ava Core Uploader", "Ava Core"],
            },
            {
                "id": "grok",
                "github_logins": [],
                "git_emails": ["ava-uploader@local", "grok@x.ai", "grok@local"],
                "git_names": ["Ava Core Uploader", "Grok", "Grok Agent"],
            },
            {
                "id": "people",
                "github_logins": [],
                "git_emails": [],
                "git_names": [],
            },
        ],
    }


def trusted_sets(people: dict) -> Tuple[Set[str], Set[str], Set[str]]:
    logins: Set[str] = set()
    emails: Set[str] = set()
    names: Set[str] = set()
    for entry in people.get("trusted") or []:
        for x in entry.get("github_logins") or []:
            if x:
                logins.add(str(x).lower())
        for x in entry.get("git_emails") or []:
            if x:
                emails.add(str(x).lower())
        for x in entry.get("git_names") or []:
            if x:
                names.add(str(x).lower())
    return logins, emails, names


def author_trusted(name: str, email: str, logins: Set[str], emails: Set[str], names: Set[str]) -> bool:
    n = (name or "").strip().lower()
    e = (email or "").strip().lower()
    if e and e in emails:
        return True
    if n and n in names:
        return True
    # GitHub noreply forms: 123+login@users.noreply.github.com or login@users.noreply.github.com
    m = re.match(r"^(?:\d+\+)?([a-z0-9\-]+)@users\.noreply\.github\.com$", e)
    if m and m.group(1) in logins:
        return True
    # bare login match against name
    if n in logins:
        return True
    return False


def should_skip_path(rel: Path) -> bool:
    parts = {p.lower() for p in rel.parts}
    name = rel.name.lower()
    for excl in NEVER_OVERWRITE:
        if excl.startswith("*"):
            if name.endswith(excl[1:].lower()):
                return True
        elif excl.lower() in parts or name == excl.lower():
            return True
    return False


def prefer_path(rel: Path) -> bool:
    s = str(rel).replace("\\", "/")
    if s in PREFERRED_PREFIXES:
        return True
    for pref in PREFERRED_PREFIXES:
        if pref.endswith("/") and s.startswith(pref):
            return True
    return False


def _redact_cmd(cmd: List[str]) -> str:
    out = []
    for arg in cmd:
        if "x-access-token:" in arg and "@github.com" in arg:
            out.append(re.sub(r"x-access-token:[^@]+@", "x-access-token:***@", arg))
        else:
            out.append(arg)
    return " ".join(out)


def run(cmd: List[str], cwd: Path | None = None, check: bool = True) -> subprocess.CompletedProcess:
    print(f"  $ {_redact_cmd(cmd)}")
    result = subprocess.run(cmd, cwd=cwd, check=False, text=True, capture_output=True)
    if result.stdout and result.stdout.strip():
        print(result.stdout.rstrip())
    if result.stderr and result.stderr.strip():
        # git often writes progress to stderr
        print(result.stderr.rstrip(), file=sys.stderr)
    if check and result.returncode != 0:
        raise subprocess.CalledProcessError(
            result.returncode, cmd, output=result.stdout, stderr=result.stderr
        )
    return result


def local_marker(root: Path) -> Path:
    return root / ".ava" / "last_pulled_sha"


def read_local_sha(root: Path) -> Optional[str]:
    p = local_marker(root)
    if p.is_file():
        return p.read_text(encoding="utf-8").strip() or None
    return None


def write_local_sha(root: Path, sha: str) -> None:
    p = local_marker(root)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(sha + "\n", encoding="utf-8")


def list_new_commits(repo: Path, since_sha: Optional[str], branch: str) -> List[Dict[str, str]]:
    """Return commits on branch not yet applied, oldest first."""
    if since_sha:
        # commits reachable from HEAD but not from since_sha
        rng = f"{since_sha}..HEAD"
    else:
        rng = "HEAD"
    fmt = "%H%x09%an%x09%ae%x09%s"
    r = run(["git", "log", "--reverse", f"--format={fmt}", rng], cwd=repo, check=False)
    commits = []
    for line in (r.stdout or "").splitlines():
        if not line.strip():
            continue
        parts = line.split("\t", 3)
        if len(parts) < 4:
            continue
        sha, an, ae, subj = parts[0], parts[1], parts[2], parts[3]
        if since_sha and sha.startswith(since_sha):
            continue
        commits.append({"sha": sha, "name": an, "email": ae, "subject": subj})
    # if no since_sha, only report tip for trust check of "latest"
    if not since_sha and commits:
        commits = commits[-1:]
    return commits


def remote_head_sha(repo: Path) -> str:
    r = run(["git", "rev-parse", "HEAD"], cwd=repo)
    return (r.stdout or "").strip()


def apply_tree(src_root: Path, dst_root: Path, dry_run: bool) -> Tuple[int, int, int]:
    """Copy preferred allowed files from cloned repo into local layout."""
    copied = skipped = protected = 0
    for src in src_root.rglob("*"):
        if not src.is_file():
            continue
        if src.name == ".git" or ".git" in src.parts:
            continue
        try:
            rel = src.relative_to(src_root)
        except ValueError:
            continue
        if should_skip_path(rel):
            protected += 1
            continue
        if not prefer_path(rel):
            # still allow other non-excluded top-level project files
            # but skip random junk
            if len(rel.parts) > 0 and rel.parts[0].startswith("."):
                skipped += 1
                continue
        dst = dst_root / rel
        if dry_run:
            print(f"  would update  {rel}")
            copied += 1
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        copied += 1
    return copied, skipped, protected


def main() -> int:
    parser = argparse.ArgumentParser(description="Trusted Ava-core ← GitHub puller")
    parser.add_argument("--owner", default=DEFAULT_OWNER)
    parser.add_argument("--repo", default=DEFAULT_REPO)
    parser.add_argument("--branch", default=DEFAULT_BRANCH)
    parser.add_argument("--token", default=None)
    parser.add_argument("--path", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--people", type=Path, default=None, help="Path to people.json")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--check-only",
        action="store_true",
        help="Only report whether updates exist and if they are trusted",
    )
    parser.add_argument(
        "--force-untrusted",
        action="store_true",
        help="DANGEROUS: apply even if authors are not on the people list",
    )
    args = parser.parse_args()

    root = args.path.resolve()
    if not root.is_dir():
        print(f"ERROR: {root} does not exist", file=sys.stderr)
        return 1

    people = load_people(args.people)
    logins, emails, names = trusted_sets(people)
    print(f"Local root:   {root}")
    print(f"Remote:       {args.owner}/{args.repo} ({args.branch})")
    print(f"People file:  {people.get('_path')}")
    print(f"Trusted logins: {sorted(logins) or '(none)'}")
    print(f"Trusted emails: {sorted(emails) or '(none)'}")
    print(f"Dry-run:      {args.dry_run}")
    print()

    token = load_token(args.token)
    local_sha = read_local_sha(root)
    if local_sha:
        print(f"Last pulled:  {local_sha[:12]}")
    else:
        print("Last pulled:  (none — first run will require trusted tip)")

    with tempfile.TemporaryDirectory(prefix="ava-pull-") as tmp:
        tmp_path = Path(tmp)
        clone_url = f"https://x-access-token:{token}@github.com/{args.owner}/{args.repo}.git"
        print("Fetching remote...")
        run(
            ["git", "clone", "--depth", "50", "--branch", args.branch, clone_url, str(tmp_path)]
        )
        head = remote_head_sha(tmp_path)
        print(f"Remote HEAD:  {head[:12]}")

        if local_sha and local_sha == head:
            print("Already up to date.")
            return 0

        commits = list_new_commits(tmp_path, local_sha if local_sha else None, args.branch)
        if not commits:
            # depth limit or first run with only tip
            commits = [
                {
                    "sha": head,
                    "name": run(
                        ["git", "log", "-1", "--format=%an"], cwd=tmp_path
                    ).stdout.strip(),
                    "email": run(
                        ["git", "log", "-1", "--format=%ae"], cwd=tmp_path
                    ).stdout.strip(),
                    "subject": run(
                        ["git", "log", "-1", "--format=%s"], cwd=tmp_path
                    ).stdout.strip(),
                }
            ]

        print(f"\nNew commits to consider: {len(commits)}")
        untrusted: List[Dict[str, str]] = []
        for c in commits:
            ok = author_trusted(c["name"], c["email"], logins, emails, names)
            mark = "OK" if ok else "BLOCK"
            print(f"  [{mark}] {c['sha'][:10]}  {c['name']} <{c['email']}>  {c['subject']}")
            if not ok:
                untrusted.append(c)

        if untrusted and not args.force_untrusted:
            print(
                "\nRefusing to apply: one or more commits are not from you, us, "
                "or the people list.",
                file=sys.stderr,
            )
            print(
                "Add their github_logins / git_emails to context/people.json "
                "or re-run with --force-untrusted (not recommended).",
                file=sys.stderr,
            )
            return 2

        if args.check_only:
            print("\nCheck-only: updates available and trusted." if not untrusted else "\nCheck-only: blocked.")
            return 0 if not untrusted else 2

        print("\nApplying trusted tree into main layout...")
        copied, skipped, protected = apply_tree(tmp_path, root, dry_run=args.dry_run)
        print(f"Updated: {copied}   Skipped: {skipped}   Protected: {protected}")

        if not args.dry_run:
            write_local_sha(root, head)
            print(f"Recorded last_pulled_sha = {head[:12]}")
            print("✓ Done — local layout updated from trusted remote commits.")
        else:
            print("Dry-run complete — nothing written.")

    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Fail if live Ava still depends on D: or E: junctions / path literals.

Run from repo root:  .venv\\Scripts\\python windows\\assert_c_only.py
Exit 0 = C-only. Exit 1 = still wired to external drives.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

LIVE = Path(__file__).resolve().parents[1]
BAD_DRIVE = re.compile(r"(?i)(?:^|[\"'\s=])([DE]:\\)")
# Live Python that must not open external archives.
SCAN_GLOBS = (
    "apps/core/**/*.py",
    "windows/*.py",
    "scripts/*.py",
    "scripts/*.ps1",
    "AGENTS.md",
)
# Docs may mention D:/E: as archive history; skip those.
SKIP_PARTS = {
    "all-connections",
    "node_modules",
    ".venv",
    "__pycache__",
    "Media",
    "data/_cutover_archive",
    "backups",
}


def _skip(path: Path) -> bool:
    parts = {p.lower() for p in path.parts}
    return any(s.lower() in parts or s in str(path) for s in SKIP_PARTS)


def check_junctions() -> list[str]:
    bad: list[str] = []
    for p in LIVE.iterdir():
        if not p.is_dir() and not p.is_symlink():
            # junctions look like dirs
            pass
        try:
            if p.is_junction() or (p.is_symlink() and p.exists()):
                target = str(p.readlink() if p.is_symlink() else "")
                # pathlib may not expose junction target on all Pythons — use resolve trick
        except OSError:
            continue
    # PowerShell-style: use os.listdir + Get-Item via win32 if needed
    import subprocess

    out = subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-Command",
            f"Get-ChildItem -LiteralPath '{LIVE}' -Force | "
            "Where-Object { $_.LinkType } | "
            "ForEach-Object { '{0}|{1}|{2}' -f $_.Name, $_.LinkType, ($_.Target -join ',') }",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    for line in (out.stdout or "").splitlines():
        line = line.strip()
        if not line or "|" not in line:
            continue
        name, link_type, target = line.split("|", 2)
        if re.search(r"(?i)^[DE]:\\", target.strip()):
            bad.append(f"junction {name} -> {target}")
        # plugins may be C-local junction — OK
    # apps subfolder
    apps = LIVE / "apps"
    out2 = subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-Command",
            f"Get-ChildItem -LiteralPath '{apps}' -Force | "
            "Where-Object { $_.LinkType } | "
            "ForEach-Object { '{0}|{1}|{2}' -f $_.Name, $_.LinkType, ($_.Target -join ',') }",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    for line in (out2.stdout or "").splitlines():
        line = line.strip()
        if not line or "|" not in line:
            continue
        name, _lt, target = line.split("|", 2)
        if re.search(r"(?i)^[DE]:\\", target.strip()):
            bad.append(f"apps junction {name} -> {target}")
    return bad


def check_source_literals() -> list[str]:
    bad: list[str] = []
    roots = [
        LIVE / "apps" / "core",
        LIVE / "windows",
        LIVE / "scripts",
    ]
    for root in roots:
        if not root.is_dir():
            continue
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            if path.suffix.lower() not in {".py", ".ps1", ".md"}:
                continue
            if _skip(path):
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            for i, line in enumerate(text.splitlines(), 1):
                if "assert_c_only" in path.name:
                    continue
                # allow comments that say "do not use D:"
                if re.search(r"(?i)Path\(r?[\"'][DE]:\\", line) or re.search(
                    r"(?i)=[\"'][DE]:\\", line
                ):
                    if "do not" in line.lower() or "archive" in line.lower() and "Path(" not in line:
                        if "Path(" not in line and "r\"" not in line and "r'" not in line:
                            continue
                    if "Path(" in line or "r\"" in line or "r'" in line or ".ps1" in path.suffix:
                        rel = path.relative_to(LIVE)
                        bad.append(f"{rel}:{i}: {line.strip()[:120]}")
    return bad


def main() -> int:
    problems = check_junctions() + check_source_literals()
    # Required real dirs
    for name in ("Media", "workstations", "apps", "data"):
        p = LIVE / name
        if not p.exists():
            problems.append(f"missing {name}")
    media = LIVE / "Media"
    if media.exists():
        import subprocess

        out = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-Command",
                f"$i=Get-Item -LiteralPath '{media}' -Force; "
                "if ($i.LinkType) { 'JUNCTION|' + ($i.Target -join ',') } else { 'REAL' }",
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        tip = (out.stdout or "").strip()
        if tip.startswith("JUNCTION|") and re.search(r"(?i)^[DE]:\\", tip.split("|", 1)[-1]):
            problems.append(f"Media still on external drive: {tip}")

    if problems:
        print("assert_c_only FAILED:")
        for p in problems:
            print(" -", p)
        return 1
    print("assert_c_only OK — live tree is C-only")
    return 0


if __name__ == "__main__":
    sys.exit(main())

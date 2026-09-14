#!/usr/bin/env python3
"""AVA-CORE API host rules for workstation plugin/app sources.

RootMC Minecraft stays on https://api.rootmc.net (its own API).
Do not point Ava origin at *.rootmc.net.
Do not retarget weather/business/Kilauea product APIs here (still held /
moving later to rootrecord.cloud).
Never rewrite files under a rootmc-api tree.
"""
from __future__ import annotations

import sys
from pathlib import Path

_DEFAULT = Path(r"C:\Users\rootr\ava\workstations")
if not _DEFAULT.exists():
    _DEFAULT = Path("/home/ava-core/ava/workstations")
ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else _DEFAULT)

# Restore Minecraft defaults that an older Linux pass moved to .info / Ava origin.
REPLACEMENTS: list[tuple[str, str]] = [
    ("https://api.rootmc.info/", "https://api.rootmc.net/"),
    ("https://api.rootmc.info", "https://api.rootmc.net"),
    ("https://ava-origin.rootmc.net/", "https://api.rootmc.net/"),
    ("https://ava-origin.rootmc.net", "https://api.rootmc.net"),
]

TEXT_SUFFIXES = {
    ".java", ".kt", ".kts", ".yml", ".yaml", ".xml", ".json", ".md",
    ".properties", ".gradle", ".toml", ".ts", ".js", ".mjs", ".cfg",
}

SKIP_PARTS = {
    "node_modules", ".gradle", "build", ".git",
    "world", "world_nether", "world_the_end",
    "rootmc-api", "rootmc-api-g2",
}
SKIP_NAMES = {
    "local.properties", ".env", "credentials.env", "google-services.json",
}


def should_skip(path: Path) -> bool:
    if path.name in SKIP_NAMES:
        return True
    return any(p in SKIP_PARTS for p in path.parts)


def patch_file(path: Path) -> bool:
    try:
        text = path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        return False
    new = text
    for old, repl in REPLACEMENTS:
        new = new.replace(old, repl)
    if new == text:
        return False
    path.write_text(new, encoding="utf-8")
    return True


def main() -> None:
    changed = 0
    scanned = 0
    for path in ROOT.rglob("*"):
        if not path.is_file() or should_skip(path):
            continue
        if path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        scanned += 1
        if patch_file(path):
            changed += 1
            print(f"  patched {path.relative_to(ROOT)}")
    print(f"scanned {scanned} files, patched {changed}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Retarget Android apps + Minecraft plugins to the v2 API domains.

Minecraft  -> https://api.rootmc.info
Kīlauea    -> https://api.rootrecord.online
Ava/host   -> https://ava-origin.rootmc.net
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else "/home/ava-core/ava/workstations")

REPLACEMENTS: list[tuple[str, str]] = [
    # Minecraft API
    ("https://api.rootmc.net/", "https://api.rootmc.info/"),
    ("https://api.rootmc.net", "https://api.rootmc.info"),
    ("https://api-local.rootmc.net", "https://ava-origin.rootmc.net"),
    ("https://rootmc-web.pages.dev", "https://rootmc.info"),
    # Kīlauea / Root Record (old workers.dev + .info → .online)
    ("https://rootrecord-api-kilauea.rootrecord.workers.dev/", "https://api.rootrecord.online/"),
    ("https://rootrecord-api-kilauea.rootrecord.workers.dev", "https://api.rootrecord.online"),
    ("https://api-kilauea.rootrecord.info", "https://api.rootrecord.online"),
    ("https://kilauea.rootrecord.info", "https://rootrecord.online"),
    ("https://rootrecord.info/billing", "https://rootrecord.online/billing"),
    ("https://rootrecord.info/", "https://rootrecord.online/"),
    ("https://rootrecord.info", "https://rootrecord.online"),
    ("https://rootrecord-api-account.rootrecord.workers.dev", "https://api.rootrecord.online"),
]

TEXT_SUFFIXES = {
    ".java", ".kt", ".kts", ".yml", ".yaml", ".xml", ".json", ".md",
    ".properties", ".gradle", ".toml", ".ts", ".js", ".mjs", ".cfg",
}

SKIP_PARTS = {"node_modules", ".gradle", "build", ".git"}


def should_skip(path: Path) -> bool:
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
        if path.suffix.lower() not in TEXT_SUFFIXES and path.name not in {
            "NetworkModule.kt", "RootMcApiBases.java",
        }:
            continue
        scanned += 1
        if patch_file(path):
            changed += 1
            print(f"  patched {path.relative_to(ROOT)}")
    print(f"scanned {scanned} files, patched {changed}")


if __name__ == "__main__":
    main()

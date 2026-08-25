#!/usr/bin/env python3
"""Move Ava Core SQLite databases into /home/ava-core/database.

Safe migration helper for the database-root standard:
  /home/ava-core/database/*.db

No database subdirectories are created. Existing files in the destination are
left alone unless --replace is supplied.
"""
from __future__ import annotations

import argparse
import shutil
from pathlib import Path

ROOT = Path("/home/ava-core")
OLD = ROOT / "Database"
NEW = ROOT / "database"
EXTS = {".db", ".sqlite", ".sqlite3"}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", type=Path, default=OLD)
    ap.add_argument("--destination", type=Path, default=NEW)
    ap.add_argument("--replace", action="store_true")
    args = ap.parse_args()

    src = args.source
    dst = args.destination
    dst.mkdir(parents=True, exist_ok=True)

    if not src.exists():
        print(f"Source does not exist: {src}")
        return 0

    moved = 0
    skipped = 0
    for p in sorted(src.rglob("*")):
        if not p.is_file() or p.suffix.lower() not in EXTS:
            continue
        target = dst / p.name
        if target.exists() and not args.replace:
            print(f"SKIP (destination exists): {p} -> {target}")
            skipped += 1
            continue
        if target.exists():
            target.unlink()
        shutil.move(str(p), str(target))
        print(f"MOVED: {p} -> {target}")
        moved += 1

    print(f"Done. moved={moved} skipped={skipped} destination={dst}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

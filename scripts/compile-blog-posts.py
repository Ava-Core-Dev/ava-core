#!/usr/bin/env python3
"""Promote inbox reports to blog posts. Source of truth: media/documents/reports/."""
from __future__ import annotations

import re
import shutil
import sys
from pathlib import Path

MEDIA = Path("/home/ava-core/ava/media")
REPORTS = MEDIA / "documents" / "reports"
INBOX = REPORTS / "inbox"
POSTS = REPORTS / "posts"
BRANDS = ("rootmc", "ava", "rootrecord")

FM = re.compile(r"^---\n(.*?)\n---\n", re.S)


def parse_fm(text: str) -> dict[str, str]:
    m = FM.match(text)
    if not m:
        return {}
    out: dict[str, str] = {}
    for line in m.group(1).splitlines():
        if ":" not in line or line.strip().startswith("-"):
            continue
        k, v = line.split(":", 1)
        out[k.strip()] = v.strip().strip("\"'")
    return out


def main() -> int:
    POSTS.mkdir(parents=True, exist_ok=True)
    for b in BRANDS:
        (POSTS / b).mkdir(exist_ok=True)
    moved = 0
    for path in sorted(INBOX.glob("*.md")):
        if path.name.upper() == "README.MD":
            continue
        text = path.read_text(encoding="utf-8")
        meta = parse_fm(text)
        if meta.get("blog") != "true":
            print(f"skip (blog != true): {path.name}")
            continue
        brand = meta.get("brand", "")
        slug = meta.get("slug", "")
        if brand not in BRANDS or not slug:
            print(f"skip (need brand+slug): {path.name}", file=sys.stderr)
            continue
        dest = POSTS / brand / f"{slug}.md"
        shutil.move(str(path), str(dest))
        print(f"published {dest}")
        moved += 1
    if moved:
        import subprocess
        sync = Path(__file__).resolve().parent / "sync-blogs.py"
        subprocess.run([sys.executable, str(sync)], check=False)
    print(f"inbox promoted: {moved}")
    print("Next: regenerate site blogs (write-blog-timeline.py / Next POSTS) and deploy.")
    print("Set category + published (ISO with offset) in frontmatter; bump ARCHIVE_REVISED.")
    print("Templates: media/documents/reports/templates/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

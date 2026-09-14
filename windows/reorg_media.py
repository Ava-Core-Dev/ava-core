"""One-shot media layout helper. Operates on live Media under AVA_HOME only."""
from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(os.getenv("AVA_HOME", str(Path.home() / "ava"))) / "Media"
PUBLIC = ROOT / "public"
PRIVATE = ROOT / "private"

PRIVATE_MOVES = [
    ("documents/notes/alex", "documents/notes/alex"),
    ("documents/logs", "documents/logs"),
    ("documents/docs/vercel-builds", "documents/vercel-builds"),
    ("documents/reports/conversation-summaries", "documents/reports/conversation-summaries"),
    ("documents/persona/known-people-alexrs94.md", "documents/persona/known-people-alexrs94.md"),
    ("documents/persona/training/alex-praise-gold.jsonl", "documents/persona/training/alex-praise-gold.jsonl"),
]


def merge_move(src: Path, dst: Path) -> None:
    if not src.exists():
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    if not dst.exists():
        src.rename(dst)
        print("moved", src.name, "->", dst)
        return
    if src.is_file():
        print("skip duplicate file (already at dest)", src)
        src.unlink()
        return
    for child in list(src.iterdir()):
        merge_move(child, dst / child.name)
    try:
        src.rmdir()
        print("removed empty", src)
    except OSError:
        print("left non-empty", src)


def main() -> None:
    if not ROOT.is_dir():
        raise SystemExit(f"missing {ROOT}")
    PUBLIC.mkdir(exist_ok=True)
    PRIVATE.mkdir(exist_ok=True)

    # Peel private-mixed items out of the type trees before they become public.
    for src_rel, dest_rel in PRIVATE_MOVES:
        src = ROOT / src_rel
        dest = PRIVATE / dest_rel
        if src.exists():
            dest.parent.mkdir(parents=True, exist_ok=True)
            if dest.exists():
                print("private dest exists, drop src copy", src_rel)
                if src.is_file():
                    src.unlink()
                else:
                    shutil.rmtree(src, ignore_errors=True)
            else:
                merge_move(src, dest)
                print("private", src_rel, "->", dest)

    for name in ("AVA-FINANCE-", "LOCKOUT-RECOVERY-"):
        notes = ROOT / "documents" / "notes"
        plans = ROOT / "documents" / "plans"
        for folder in (notes, plans):
            if not folder.is_dir():
                continue
            for p in folder.glob(name + "*"):
                dest = PRIVATE / "documents" / folder.name / p.name
                dest.parent.mkdir(parents=True, exist_ok=True)
                if dest.exists():
                    p.unlink() if p.is_file() else shutil.rmtree(p, ignore_errors=True)
                else:
                    p.rename(dest)
                    print("private glob", p.name)

    dm = ROOT / "images" / "direct messages"
    if dm.exists() and not dm.is_dir():
        dm.unlink()
        print("removed leftover DM alias")

    for t in ("audio", "images", "video", "documents", "stream"):
        src = ROOT / t
        if src.is_dir():
            merge_move(src, PUBLIC / t)

    music = ROOT / "music"
    if music.exists():
        merge_move(music, PUBLIC / "audio" / "music")

    for thumbs in (ROOT / "Thumbnails", ROOT / "thumbnails"):
        if thumbs.exists() and thumbs.is_dir() and thumbs.resolve() != (PUBLIC / "images" / "thumbnails").resolve():
            merge_move(thumbs, PUBLIC / "images" / "thumbnails")

    qr_old = PUBLIC / "qrcodes"
    qr_new = PUBLIC / "images" / "qrcodes"
    if qr_old.exists() and qr_old.resolve() != qr_new.resolve():
        merge_move(qr_old, qr_new)

    # Broken WSL alias files pointing at C:\ava\media\...
    for name in ("brand", "emojis", "portraits", "videos"):
        p = ROOT / name
        if p.exists() and p.is_file():
            p.unlink()
            print("removed leftover alias", name)

    yt = ROOT / "youtube.py"
    dest_yt = Path(r"C:\Users\rootr\ava\apps\core\services\youtube_download.py")
    if yt.is_file() and not dest_yt.exists():
        dest_yt.write_text(yt.read_text(encoding="utf-8"), encoding="utf-8")
        yt.unlink()
        print("moved youtube.py -> apps/core/services/youtube_download.py")
    elif yt.is_file():
        yt.unlink()
        print("removed leftover youtube.py")

    init = ROOT / "__init__.py"
    if init.is_file():
        init.unlink()
        print("removed media __init__.py")
    cache = ROOT / "__pycache__"
    if cache.is_dir():
        shutil.rmtree(cache, ignore_errors=True)

    leftover = ROOT / "manifest.v2-staged.json"
    if leftover.is_file():
        dest = PUBLIC / "documents" / leftover.name
        dest.parent.mkdir(parents=True, exist_ok=True)
        if not dest.exists():
            leftover.rename(dest)
            print("moved", leftover.name, "-> public/documents")
        else:
            leftover.unlink()

    print("\nROOT now:")
    for p in sorted(ROOT.iterdir(), key=lambda x: x.name.lower()):
        print(" ", p.name, "dir" if p.is_dir() else "file")
    print("\nPUBLIC types:")
    for p in sorted(PUBLIC.iterdir(), key=lambda x: x.name.lower()):
        print(" ", p.name)


if __name__ == "__main__":
    main()

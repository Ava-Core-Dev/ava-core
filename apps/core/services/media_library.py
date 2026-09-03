"""Public vs private Ava media. Private never leaves the box via download APIs."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

from .. import config

PRIVATE_ROOT_NAME = "private"
PUBLIC_ROOT_NAME = "public"

# Anything under private/ is private. Old leftover prefixes still refused if they remain.
PRIVATE_PREFIXES = (
    "private/",
    "public/images/direct messages/",
    "images/direct messages/",
    "documents/notes/alex/",
    "documents/logs/",
    "public/documents/notes/alex/",
    "public/documents/logs/",
)

# Types live under public/{type}/{category}/. Old unprefixed paths still match.
PUBLIC_PREFIXES = (
    "public/audio/",
    "public/video/",
    "public/images/",
    "public/documents/",
    "public/stream/",
    "audio/",
    "video/",
    "images/",
    "documents/",
    "stream/",
)

SKIP_NAMES = {"files.log", "SCAN-REPORT.md", ".git", "catalog.json", "youtube.py", "__init__.py"}
SKIP_DIRS = {"obs-backup", "__pycache__", "node_modules", ".git"}


def media_root() -> Path:
    return Path(config.MEDIA_DIR)


def public_root() -> Path:
    return Path(config.PUBLIC_MEDIA)


def private_root() -> Path:
    return Path(config.PRIVATE_MEDIA)


def _norm(rel: str) -> str:
    return rel.replace("\\", "/").lstrip("/")


def _rel(path: Path) -> str:
    return path.resolve().relative_to(media_root().resolve()).as_posix()


def is_private_rel(rel: str) -> bool:
    n = _norm(rel)
    if n == PRIVATE_ROOT_NAME or n.startswith(f"{PRIVATE_ROOT_NAME}/"):
        return True
    if "direct messages" in n:
        return True
    for p in PRIVATE_PREFIXES:
        if n == p.rstrip("/") or n.startswith(p):
            return True
    return False


def is_public_rel(rel: str) -> bool:
    if is_private_rel(rel):
        return False
    n = _norm(rel)
    if any(part in SKIP_NAMES for part in n.split("/")):
        return False
    if n.startswith(f"{PUBLIC_ROOT_NAME}/"):
        rest = n[len(PUBLIC_ROOT_NAME) + 1 :]
        return any(rest.startswith(p) or n.startswith(p) for p in (
            "audio/", "video/", "images/", "documents/", "stream/",
        ))
    return any(n.startswith(p) for p in PUBLIC_PREFIXES)


def _under(root: Path, full: Path) -> bool:
    try:
        return full.is_relative_to(root)
    except (ValueError, AttributeError):
        return str(full).startswith(str(root) + "\\") or str(full).startswith(str(root) + "/")


def resolve_public(rel: str) -> Path | None:
    n = _norm(rel)
    if not n or ".." in n.split("/"):
        return None
    candidates: list[Path] = []
    if n.startswith(f"{PUBLIC_ROOT_NAME}/"):
        candidates.append(media_root() / n)
    else:
        candidates.append(public_root() / n)
        candidates.append(media_root() / n)
    media = media_root().resolve()
    priv = private_root().resolve()
    for cand in candidates:
        try:
            full = cand.resolve()
        except OSError:
            continue
        if not _under(media, full):
            continue
        if _under(priv, full):
            return None
        rel_n = full.relative_to(media).as_posix()
        if not is_public_rel(rel_n):
            continue
        if full.is_file():
            return full
    return None


def list_public(*, limit: int = 400, per_folder: int = 80) -> dict:
    root = public_root()
    by_folder: dict[str, list[dict]] = {}
    if not root.is_dir():
        return {"ok": False, "error": "media_missing", "files": []}
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            if name in SKIP_NAMES:
                continue
            path = Path(dirpath) / name
            if not path.is_file():
                continue
            try:
                rel = _rel(path)
            except ValueError:
                continue
            if not is_public_rel(rel):
                continue
            st = path.stat()
            folder = rel.rsplit("/", 1)[0] if "/" in rel else ""
            by_folder.setdefault(folder, []).append(
                {
                    "path": rel,
                    "name": path.name,
                    "size": st.st_size,
                    "mtime": datetime.fromtimestamp(st.st_mtime, timezone.utc).isoformat(),
                    "download": f"/api/media/public/file?path={rel}",
                }
            )
    files: list[dict] = []
    for folder, rows in sorted(by_folder.items()):
        rows.sort(key=lambda r: r["mtime"], reverse=True)
        files.extend(rows[:per_folder])
    files.sort(key=lambda r: r["mtime"], reverse=True)
    files = files[:limit]
    payload = {
        "ok": True,
        "generated": datetime.now(timezone.utc).isoformat(),
        "count": len(files),
        "folders": {k: len(v) for k, v in sorted(by_folder.items())},
        "files": files,
    }
    catalog = public_root() / "catalog.json"
    catalog.parent.mkdir(parents=True, exist_ok=True)
    catalog.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return payload

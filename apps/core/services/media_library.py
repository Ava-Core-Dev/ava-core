"""Public vs private Ava media. Private never leaves the box via download APIs."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from .. import config

PRIVATE_ROOT_NAME = "private"

# Relative prefixes that must never be listed or downloaded publicly
# (includes symlink names that still point at private/).
PRIVATE_PREFIXES = (
    "private/",
    "documents/notes/alex/",
    "documents/context/AIConversations/",
    "images/direct messages/",
    "documents/persona/known-people-",
    "documents/docs/known-people-",
    "documents/docs/vercel-builds/",
    "documents/reports/conversation-summaries/",
    "documents/logs/",
    "documents/notes/AVA-FINANCE-",
    "documents/plans/LOCKOUT-RECOVERY-",
    "documents/persona/training/alex-praise-gold.jsonl",
)

PUBLIC_PREFIXES = (
    "audio/",
    "video/",
    "images/character/",
    "images/brand/",
    "images/emojis/",
    "images/thumbnails/",
    "images/thumnails/",
    "images/channels/",
    "documents/reports/",
    "documents/docs/",
    "documents/plans/",
    "stream/",
)

SKIP_NAMES = {"files.log", "SCAN-REPORT.md", ".git"}


def media_root() -> Path:
    return Path(config.MEDIA_DIR)


def private_root() -> Path:
    return media_root() / PRIVATE_ROOT_NAME


def _rel(path: Path) -> str:
    return path.resolve().relative_to(media_root().resolve()).as_posix()


def is_private_rel(rel: str) -> bool:
    n = rel.replace("\\", "/").lstrip("/")
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
    n = rel.replace("\\", "/").lstrip("/")
    if any(part in SKIP_NAMES for part in n.split("/")):
        return False
    return any(n.startswith(p) for p in PUBLIC_PREFIXES)


def resolve_public(rel: str) -> Path | None:
    n = rel.replace("\\", "/").lstrip("/")
    if not n or ".." in n.split("/"):
        return None
    if not is_public_rel(n):
        return None
    full = (media_root() / n).resolve()
    root = media_root().resolve()
    if not str(full).startswith(str(root) + "/") and full != root:
        return None
    if not full.is_file():
        return None
    # Symlink into private/
    try:
        if private_root().resolve() in full.parents or full.is_relative_to(private_root().resolve()):
            return None
    except Exception:
        priv = str(private_root().resolve())
        if str(full).startswith(priv + "/"):
            return None
    return full


def list_public(*, limit: int = 400, per_folder: int = 80) -> dict:
    root = media_root()
    by_folder: dict[str, list[dict]] = {}
    if not root.is_dir():
        return {"ok": False, "error": "media_missing", "files": []}
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if path.name in SKIP_NAMES:
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
    catalog = root / "public" / "catalog.json"
    catalog.parent.mkdir(parents=True, exist_ok=True)
    catalog.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return payload

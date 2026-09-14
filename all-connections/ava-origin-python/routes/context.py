"""Ava context routes — /api/context, /ava/context."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import PlainTextResponse

from .. import config

router = APIRouter()

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
_CONTEXT_CANDIDATES = (
    _REPO_ROOT / "docs" / "ava-identity.md",
    config.AVA_HOME / "unsorted" / "ava-core-context-updated.md",
    config.AVA_HOME / "context.md",
    _REPO_ROOT / "context.md",
)


def _context_path() -> Path | None:
    for p in _CONTEXT_CANDIDATES:
        if p.exists():
            return p
    return None


def _load_context() -> tuple[str, str]:
    path = _context_path()
    if path is None:
        return "# Ava Core Context\n\nContext file not found.\n", ""
    return path.read_text(errors="replace"), str(path)


@router.get("/api/context")
async def api_context():
    text, source = _load_context()
    return {
        "ts": datetime.now(timezone.utc).isoformat(),
        "source": source,
        "content": text,
        "length": len(text),
    }


@router.get("/ava/context")
@router.get("/context")
@router.get("/context.md")
async def context_md(fmt: str = "json"):
    text, source = _load_context()
    if fmt == "md":
        return PlainTextResponse(text, media_type="text/markdown; charset=utf-8")
    return {
        "ts": datetime.now(timezone.utc).isoformat(),
        "source": source,
        "content": text,
    }

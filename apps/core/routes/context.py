"""Ava context routes — /api/context, /ava/context."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import JSONResponse, PlainTextResponse

from .. import config

router = APIRouter()

_CONTEXT_FILE = config.AVA_HOME / "unsorted" / "ava-core-context-updated.md"
_FALLBACK_CONTEXT = config.AVA_HOME / "context.md"


def _load_context() -> str:
    for p in (_CONTEXT_FILE, _FALLBACK_CONTEXT):
        if p.exists():
            return p.read_text(errors="replace")
    return "# Ava Core Context\n\nContext file not found."


@router.get("/api/context")
async def api_context():
    text = _load_context()
    return {
        "ts": datetime.now(timezone.utc).isoformat(),
        "source": str(_CONTEXT_FILE if _CONTEXT_FILE.exists() else _FALLBACK_CONTEXT),
        "content": text,
        "length": len(text),
    }


@router.get("/ava/context")
@router.get("/context")
@router.get("/context.md")
async def context_md(fmt: str = "json"):
    text = _load_context()
    if fmt == "md":
        return PlainTextResponse(text, media_type="text/markdown")
    return {
        "ts": datetime.now(timezone.utc).isoformat(),
        "content": text,
    }

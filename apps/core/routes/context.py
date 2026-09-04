"""Ava context + GEO discovery routes.

Serves:
  /context, /context.md, /ava/context  — live blob (HTML hub, md, or json)
  /context/*                         — static context pack (C-only)
  /api/context                       — JSON blob
  /llms.txt, /ai.txt, /robots.txt    — GEO allowlist
  /docs/geo/*                        — identity snapshots
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, HTMLResponse, PlainTextResponse

from .. import config

router = APIRouter()

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
_CORE = Path(__file__).resolve().parent.parent
_STATIC_CONTEXT = _CORE / "static" / "geography" / "context"
_STATIC_GEOGRAPHY = _CORE / "static" / "geography"
_STATIC_RR = _CORE / "static" / "rootrecord"
_MEDIA_GEO = config.AVA_HOME / "Media" / "public" / "documents" / "docs" / "geo"
if not _MEDIA_GEO.is_dir():
    _MEDIA_GEO = Path(r"C:\Users\rootr\ava\Media\public\documents\docs\geo")

_CONTEXT_CANDIDATES = (
    _MEDIA_GEO / "WHAT-IS-AVA.md",
    Path(r"C:\Users\rootr\context\Ava-Ivy-Full-Context.md"),
    Path(r"C:\Users\rootr\Documents\AVA-CORE-CONTEXT\INDEX.md"),
    _REPO_ROOT / "docs" / "ava-identity.md",
    config.AVA_HOME / "unsorted" / "ava-core-context-updated.md",
    config.AVA_HOME / "context.md",
    _REPO_ROOT / "context.md",
)


def _first_file(*candidates: Path) -> Path | None:
    for p in candidates:
        if p.is_file():
            return p
    return None


def _context_path() -> Path | None:
    return _first_file(*_CONTEXT_CANDIDATES)


def _load_context() -> tuple[str, str]:
    path = _context_path()
    if path is None:
        return "# Ava Core Context\n\nContext file not found.\n", ""
    return path.read_text(encoding="utf-8", errors="replace"), str(path)


def _geo_txt(name: str) -> Path | None:
    return _first_file(
        _MEDIA_GEO / name,
        _STATIC_GEOGRAPHY / name,
        _STATIC_RR / name,
        _REPO_ROOT / "packages" / "web" / "avaivy.cloud" / "public" / name,
    )


def _safe_under(base: Path, rel: str) -> Path | None:
    rel = (rel or "").replace("\\", "/").lstrip("/")
    if ".." in rel.split("/"):
        return None
    p = (base / rel).resolve()
    try:
        p.relative_to(base.resolve())
    except ValueError:
        return None
    if p.is_dir():
        p = p / "index.html"
    return p if p.is_file() else None


def _file_response(path: Path, media: str | None = None) -> FileResponse:
    headers = {"Cache-Control": "public, max-age=60"}
    if media:
        return FileResponse(path, media_type=media, headers=headers)
    return FileResponse(path, headers=headers)


@router.get("/api/context")
async def api_context():
    text, source = _load_context()
    return {
        "ts": datetime.now(timezone.utc).isoformat(),
        "schema": "ava-core-context/v1",
        "source": source,
        "content": text,
        "length": len(text),
        "links": {
            "hub": "https://avaivy.cloud/context",
            "dev": "https://avaivy.cloud/context/dev",
            "llms": "https://rootrecord.cloud/llms.txt",
            "ai": "https://rootrecord.cloud/ai.txt",
        },
    }


@router.get("/llms.txt")
async def llms_txt():
    path = _geo_txt("llms.txt")
    if path is None:
        return PlainTextResponse("# llms.txt missing\n", status_code=404)
    return _file_response(path, "text/plain; charset=utf-8")


@router.get("/ai.txt")
async def ai_txt():
    path = _geo_txt("ai.txt")
    if path is None:
        return PlainTextResponse("# ai.txt missing\n", status_code=404)
    return _file_response(path, "text/plain; charset=utf-8")


@router.get("/robots.txt")
async def robots_txt():
    path = _geo_txt("robots.txt")
    if path is None:
        return PlainTextResponse("User-agent: *\nAllow: /\n", media_type="text/plain; charset=utf-8")
    return _file_response(path, "text/plain; charset=utf-8")


@router.get("/docs/geo/{rest:path}")
async def docs_geo(rest: str):
    path = _safe_under(_MEDIA_GEO, rest) or _safe_under(_STATIC_GEOGRAPHY / "docs" / "geo", rest)
    if path is None:
        return PlainTextResponse("Not found\n", status_code=404)
    media = "text/markdown; charset=utf-8" if path.suffix.lower() == ".md" else None
    if path.name.endswith(".txt"):
        media = "text/plain; charset=utf-8"
    return _file_response(path, media)


@router.get("/context/{rest:path}")
async def context_static(rest: str):
    path = _safe_under(_STATIC_CONTEXT, rest)
    if path is None:
        return HTMLResponse("<p>Context page not found.</p>", status_code=404)
    media = None
    if path.suffix.lower() == ".md":
        media = "text/markdown; charset=utf-8"
    elif path.suffix.lower() == ".txt":
        media = "text/plain; charset=utf-8"
    return _file_response(path, media)


@router.get("/ava/context")
@router.get("/context")
@router.get("/context.md")
async def context_root(request: Request, format: str | None = None, fmt: str | None = None):
    want = (format or fmt or "").lower()
    path_name = request.url.path.rstrip("/").split("/")[-1]
    if path_name == "context.md":
        want = "md"
    if not want:
        accept = (request.headers.get("accept") or "").lower()
        if "text/markdown" in accept:
            want = "md"
        elif "application/json" in accept:
            want = "json"

    # Default: static HTML hub when present; else markdown blob.
    if want in ("", "html"):
        hub = _STATIC_CONTEXT / "index.html"
        if hub.is_file() and want != "md" and want != "json":
            return _file_response(hub, "text/html; charset=utf-8")

    text, source = _load_context()
    if want == "md":
        return PlainTextResponse(text, media_type="text/markdown; charset=utf-8")

    return {
        "ts": datetime.now(timezone.utc).isoformat(),
        "schema": "ava-core-context/v1",
        "source": source,
        "content": text,
        "length": len(text),
    }

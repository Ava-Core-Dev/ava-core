"""Public media listing + download. Private 1:1 / life-story is never served."""

from __future__ import annotations

from fastapi import APIRouter, Query
from fastapi.responses import FileResponse, JSONResponse

from ..services import media_library

router = APIRouter(prefix="/api/media")


@router.get("/public")
async def public_catalog(limit: int = Query(default=400, ge=1, le=2000)):
    return media_library.list_public(limit=limit)


@router.get("/public/file")
async def public_file(path: str = Query(..., min_length=1, max_length=512)):
    full = media_library.resolve_public(path)
    if full is None:
        return JSONResponse({"ok": False, "error": "not_public"}, status_code=404)
    return FileResponse(full, filename=full.name)

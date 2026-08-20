"""Public + ops API for rotating site page backgrounds."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from ..services import site_backgrounds

router = APIRouter(prefix="/api/site-backgrounds")


@router.get("")
@router.get("/")
async def list_backgrounds():
    return site_backgrounds.catalog()


@router.get("/{page_key}")
async def get_backgrounds(page_key: str):
    page = site_backgrounds.get_page(page_key)
    if not page:
        return JSONResponse({"ok": False, "error": "unknown_page"}, status_code=404)
    return {"ok": True, "page": page}


@router.put("/{page_key}")
@router.post("/{page_key}")
async def set_backgrounds(page_key: str, request: Request):
    try:
        body: dict[str, Any] = await request.json()
    except Exception:
        body = {}
    if not isinstance(body, dict):
        body = {}
    try:
        page = site_backgrounds.upsert_page(
            page_key,
            paths=body.get("paths"),
            label=body.get("label"),
            sites=body.get("sites"),
            cycle_seconds=body.get("cycle_seconds"),
        )
    except ValueError as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=400)
    return {"ok": True, "page": page}

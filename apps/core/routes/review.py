"""Review packs for Cursor / Grok / GPT. Localhost only. Never applies patches."""
from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, PlainTextResponse

from ..services import code_review

router = APIRouter(prefix="/api/review")


def _local(request: Request) -> bool:
    if request.headers.get("cf-ray") or request.headers.get("cf-connecting-ip"):
        return False
    host = request.client.host if request.client else ""
    return host in {"127.0.0.1", "::1"}


@router.get("/latest")
async def review_latest(request: Request):
    if not _local(request):
        return JSONResponse({"ok": False, "detail": "local_only"}, status_code=403)
    path = code_review.CURRENT
    if not path.is_file():
        return {"ok": True, "exists": False, "path": str(path)}
    return {
        "ok": True,
        "exists": True,
        "path": str(path),
        "drop": str(code_review.DROP),
        "text": path.read_text(encoding="utf-8", errors="replace")[:20000],
    }


@router.get("/latest.md")
async def review_latest_md(request: Request):
    if not _local(request):
        return JSONResponse({"ok": False, "detail": "local_only"}, status_code=403)
    path = code_review.CURRENT
    if not path.is_file():
        return PlainTextResponse("No review pack yet.\n", status_code=404)
    return PlainTextResponse(path.read_text(encoding="utf-8", errors="replace"))


@router.post("/run")
async def review_run(request: Request):
    if not _local(request):
        return JSONResponse({"ok": False, "detail": "local_only"}, status_code=403)
    return await code_review.run(with_coder=True)

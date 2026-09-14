"""Goals routes — standalone rankable records + localhost helper append."""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from ..services import goals as store

router = APIRouter(prefix="/api")


class HelperIn(BaseModel):
    who: str = Field(min_length=1, max_length=120)
    amount_usd: float = Field(ge=0)
    note: str = Field(default="", max_length=500)


def _allow_mutate(request: Request) -> bool:
    # Cloudflare tunnel injects cf-ray; never accept mutations from the public origin.
    if request.headers.get("cf-ray") or request.headers.get("cf-connecting-ip"):
        return False
    host = request.client.host if request.client else ""
    return host in {"127.0.0.1", "::1"}


@router.get("/goals")
async def api_goals():
    return store.list_goals()


@router.get("/goals/{goal_id}")
async def api_goal(goal_id: str):
    g = store.get_goal(goal_id)
    if not g:
        return JSONResponse({"error": "not found"}, status_code=404)
    return g


@router.post("/goals/{goal_id}/helpers")
async def api_record_helper(goal_id: str, body: HelperIn, request: Request):
    if not _allow_mutate(request):
        return JSONResponse({"error": "helpers are recorded locally or via goals.json"}, status_code=403)
    g = store.record_helper(goal_id, body.who, body.amount_usd, body.note)
    if not g:
        return JSONResponse({"error": "not found"}, status_code=404)
    return g

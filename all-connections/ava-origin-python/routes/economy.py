"""Economy and finance routes."""
from fastapi import APIRouter
from fastapi.responses import JSONResponse
router = APIRouter(prefix="/api")

@router.get("/economy")
async def api_economy():
    return {"status": "coming_soon", "board": "https://ava.rootmc.net/economy"}

@router.get("/finance")
async def api_finance():
    return {"status": "coming_soon"}

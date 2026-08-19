"""Goals routes."""
from fastapi import APIRouter
from fastapi.responses import JSONResponse
router = APIRouter(prefix="/api")

GOALS = [
    {"id": "ops-record", "area": "Ops", "title": "Stay the system of record", "status": "active"},
    {"id": "portfolio-audit", "area": "Portfolio", "title": "Director of Resources — Root Record audit", "status": "active"},
    {"id": "kilauea-app", "area": "Product", "title": "Kīlauea Alerts = priority app", "status": "active"},
    {"id": "local-brain", "area": "Ops", "title": "Stronger local brain on this host", "status": "active"},
    {"id": "grow-rootmc", "area": "Product", "title": "Grow RootMC before crowdfunding", "status": "active"},
    {"id": "telegram-surface", "area": "Income", "title": "Telegram bot surface", "status": "live"},
]

@router.get("/goals")
async def api_goals():
    return GOALS

@router.get("/goals/{goal_id}")
async def api_goal(goal_id: str):
    g = next((g for g in GOALS if g["id"] == goal_id), None)
    if not g:
        return JSONResponse({"error": "not found"}, status_code=404)
    return g

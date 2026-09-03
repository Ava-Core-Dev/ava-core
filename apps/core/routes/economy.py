"""Economy and finance routes — live RootMC MySQL snapshot."""
from fastapi import APIRouter

from apps.core.services import rootmc_economy as eco

router = APIRouter(prefix="/api")


@router.get("/economy")
async def api_economy():
    snap = await eco.snapshot()
    return {
        "ok": bool(snap.get("ok")),
        "status": "live" if snap.get("ok") else "unavailable",
        "board": "https://ava.rootmc.net/economy",
        "discord_channel": eco.economy_discord_channel(),
        "snapshot": snap,
    }

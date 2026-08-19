"""Minecraft server status and RCON routes."""
from fastapi import APIRouter
from fastapi.responses import JSONResponse
import httpx, logging
router = APIRouter(prefix="/api/minecraft")
log = logging.getLogger("ava.minecraft")

LIVE_HOST = "play.rootmc.net"
LIVE_PORT = 25565
TEST_HOST = "192.168.1.62"
TEST_PORT = 24945

async def _ping(host: str, port: int) -> dict:
    """Simple TCP ping to check if Minecraft server is up."""
    import asyncio
    try:
        _, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port), timeout=5
        )
        writer.close()
        await writer.wait_closed()
        return {"online": True, "host": host, "port": port}
    except Exception as e:
        return {"online": False, "host": host, "port": port, "error": str(e)}

@router.get("/status")
async def minecraft_status():
    live = await _ping(LIVE_HOST, LIVE_PORT)
    test = await _ping(TEST_HOST, TEST_PORT)
    return {"live": live, "test": test}

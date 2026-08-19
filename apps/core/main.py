"""
Ava Core — FastAPI server (replaces server.mjs :8787).
Handles all HTTP routes, starts the scheduler on boot, and manages the voice pipeline.
"""

from __future__ import annotations

import logging
import sys
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import config
from .scheduler import Scheduler

log = logging.getLogger("ava.core")

# ── Startup / Shutdown ────────────────────────────────────────────────────────

_scheduler: Scheduler | None = None  # exposed for /api/activity


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _scheduler

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s  %(name)-20s  %(levelname)s  %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)],
    )

    config.ensure_dirs()
    log.info("Ava Core starting  port=%s  env=%s", config.AVA_PORT, config.AVA_ENV)
    log.info("Config: %s", config.as_dict())

    # Start heartbeat writer + cron scheduler
    _scheduler = Scheduler()
    await _scheduler.start()

    # Fire startup voice clip (non-blocking — best effort)
    try:
        import asyncio
        from apps.voice.tts import synthesize
        from apps.voice.director import get_director

        async def _startup_voice():
            await asyncio.sleep(3)  # let the server finish binding
            director = get_director()
            from apps.voice.director import Priority
            clip = config.VOICE_DIR / "assets" / "words" / "phrase_device_startup.mp3"
            if clip.exists():
                await director.queue(clip, name="startup", priority=Priority.CRITICAL)
                log.info("Startup voice clip queued")
            else:
                log.debug("No startup clip found at %s — skipping", clip)

        asyncio.create_task(_startup_voice())
    except Exception as e:
        log.debug("Startup voice skipped: %s", e)

    yield

    log.info("Ava Core shutting down")
    if _scheduler:
        await _scheduler.stop()


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Ava Core",
    version="2.0.0",
    description="Ava Ivy — HI Pacific Solar Root Server",
    lifespan=lifespan,
    docs_url="/docs" if config.AVA_ENV == "development" else None,
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

# ── Routes ────────────────────────────────────────────────────────────────────

from .routes import status, context, goals, obs, minecraft, economy, chat, plugins, realworld  # noqa: E402

app.include_router(status.router)
app.include_router(context.router)
app.include_router(goals.router)
app.include_router(obs.router)
app.include_router(minecraft.router)
app.include_router(economy.router)
app.include_router(chat.router)
app.include_router(plugins.router)
app.include_router(realworld.router)


@app.get("/health")
async def health():
    return {"ok": True, "version": "2.0.0"}


@app.get("/api/config")
async def api_config():
    """Non-secret config snapshot (dev only)."""
    if config.AVA_ENV != "development":
        return JSONResponse({"error": "not available"}, status_code=403)
    return config.as_dict()


# ── CLI ───────────────────────────────────────────────────────────────────────

def cli():
    uvicorn.run(
        "apps.core.main:app",
        host="0.0.0.0",
        port=config.AVA_PORT,
        reload=config.AVA_ENV == "development",
        log_level="info",
    )


if __name__ == "__main__":
    cli()

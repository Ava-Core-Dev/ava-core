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
    import asyncio
    log.info("Ava Core starting  port=%s  env=%s", config.AVA_PORT, config.AVA_ENV)
    log.info("Config: %s", config.as_dict())

    # Start heartbeat writer + cron scheduler
    _scheduler = Scheduler()
    await _scheduler.start()

    # Drain the audio queue in this process — crons and /api/voice/* enqueue here
    try:
        from apps.voice.director import ensure_running
        ensure_running()
    except Exception as e:
        log.warning("Stream Director loop failed to start: %s", e)

    # Fire startup voice clip (non-blocking — best effort)
    try:
        import asyncio
        from apps.voice.director import get_director

        async def _startup_voice():
            await asyncio.sleep(3)  # let the server finish binding
            director = get_director()
            from apps.voice.director import Priority
            clip = config.ASSETS_DIR / "words" / "phrase_device_startup.mp3"
            if clip.exists():
                await director.queue(clip, name="startup", priority=Priority.CRITICAL)
                log.info("Startup voice clip queued")
            else:
                log.debug("No startup clip found at %s — skipping", clip)

        asyncio.create_task(_startup_voice())
    except Exception as e:
        log.debug("Startup voice skipped: %s", e)

    try:
        from apps.core.inbox import run_inbox
        asyncio.create_task(run_inbox())
        log.info("Report-subscribe inbox started")
    except Exception as e:
        log.warning("Report inbox failed to start: %s", e)

    yield

    log.info("Ava Core shutting down")
    if _scheduler:
        await _scheduler.stop()
    try:
        from apps.voice.director import get_director
        await get_director().stop()
    except Exception:
        pass


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
# Optional modules must not take the origin down (USB vs SSD route sets differ).
import importlib

for _route in (
    "crons",
    "reports",
    "status",
    "context",
    "goals",
    "obs",
    "minecraft",
    "economy",
    "desktop",
    "chat",
    "plugins",
    "realworld",
    "media",
    "blog",
    "vercel_builds",
):
    try:
        _mod = importlib.import_module(f".routes.{_route}", __package__)
        app.include_router(_mod.router)
        for _extra_name in ("api_router", "legacy_router"):
            _extra = getattr(_mod, _extra_name, None)
            if _extra is not None:
                app.include_router(_extra)
    except Exception as _exc:
        log.warning("route %s not loaded: %s", _route, _exc)


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

"""
Ava Core — FastAPI server (replaces server.mjs :8787).
Handles all HTTP routes, starts the scheduler on boot, and manages the voice pipeline.
"""

from __future__ import annotations

import logging
import re
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from fastapi.staticfiles import StaticFiles

from . import config
from .scheduler import Scheduler

log = logging.getLogger("ava.core")

# ── Startup / Shutdown ────────────────────────────────────────────────────────

_scheduler: Scheduler | None = None  # exposed for /api/activity


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _scheduler

    session_log = Path(config.AVA_HOME) / "data" / "logs" / "ava-core-session.log"
    session_log.parent.mkdir(parents=True, exist_ok=True)
    media_log = Path(config.LOG_DIR) / "ava-core.log"
    media_log.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s  %(name)-20s  %(levelname)s  %(message)s",
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler(session_log, encoding="utf-8"),
            logging.FileHandler(media_log, encoding="utf-8"),
        ],
        force=True,
    )
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)

    class _RedactSecrets(logging.Filter):
        _bot = re.compile(r"bot\d+:[A-Za-z0-9_-]+")

        def filter(self, record: logging.LogRecord) -> bool:
            try:
                record.msg = self._bot.sub("bot<redacted>", str(record.msg))
            except Exception:
                pass
            return True

    redact = _RedactSecrets()
    for h in logging.getLogger().handlers:
        h.addFilter(redact)

    config.ensure_dirs()
    import asyncio
    try:
        from apps.core.services.startup_voice import capture_boot_gap

        capture_boot_gap()
    except Exception:
        pass
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

    # Fire startup voice clip once — skip brief reconnect / watchdog flaps
    try:
        import asyncio

        async def _startup_voice():
            try:
                await asyncio.sleep(3)  # let the server finish binding
                from apps.core.services.startup_voice import queue_if_allowed

                result = await queue_if_allowed(force=False)
                if result.get("played"):
                    log.info("Startup voice clip queued")
                else:
                    log.info("Startup voice skipped: %s", result.get("detail"))
            except Exception as e:
                log.warning("Startup voice failed: %s", e)

        asyncio.create_task(_startup_voice())
    except Exception as e:
        log.debug("Startup voice skipped: %s", e)

    # AdSense boot report (twice-daily pair with 21:00 HST EOD close)
    try:
        async def _adsense_boot():
            await asyncio.sleep(12)
            from apps.core.crons import adsense_report

            result = await adsense_report.run("boot")
            log.info("AdSense boot report: %s", {k: result.get(k) for k in ("ok", "skipped", "posted", "path")})

        asyncio.create_task(_adsense_boot())
    except Exception as e:
        log.debug("AdSense boot report skipped: %s", e)

    # AdMob boot report (pair with 21:05 HST EOD)
    try:
        async def _admob_boot():
            await asyncio.sleep(18)
            from apps.core.crons import admob_report

            result = await admob_report.run("boot")
            log.info("AdMob boot report: %s", {k: result.get(k) for k in ("ok", "skipped", "posted", "path")})

        asyncio.create_task(_admob_boot())
    except Exception as e:
        log.debug("AdMob boot report skipped: %s", e)

    try:
        from apps.core.inbox import run_inbox
        asyncio.create_task(run_inbox())
        log.info("Report-subscribe inbox started")
    except Exception as e:
        log.warning("Report inbox failed to start: %s", e)

    # Drop-in automation scripts (visible windows + watchdog)
    try:
        from apps.core.services.python_drop_runner import ensure_running

        ensure_running()
        log.info("Python drop runner started")
    except Exception as e:
        log.warning("Python drop runner failed to start: %s", e)

    try:
        async def _boot_accounts():
            await asyncio.sleep(25)
            from apps.core.services import account_import

            result = await account_import.run()
            counts = result.get("counts") or {}
            log.info(
                "boot account import identities=%s uuid_lookup=%s",
                counts.get("identities"),
                result.get("uuid_lookup_ok"),
            )

        asyncio.create_task(_boot_accounts())
    except Exception as e:
        log.debug("boot account import skipped: %s", e)

    try:
        async def _boot_governance():
            await asyncio.sleep(40)
            from apps.core.services import governance

            result = governance.run_daily(source="boot", allow_self_update=False)
            log.info(
                "boot governance people=%s passed=%s gate=%s",
                (result.get("people")),
                len(result.get("passed") or []),
                (result.get("flags") or {}).get("cursor_gate"),
            )

        asyncio.create_task(_boot_governance())
    except Exception as e:
        log.debug("boot governance skipped: %s", e)

    try:
        async def _boot_api_prices():
            await asyncio.sleep(48)
            from apps.core.services import api_ledger

            result = api_ledger.refresh(source="boot")
            log.info(
                "boot api-ledger fetches=%s live_rows=%s",
                len(result.get("fetches") or []),
                result.get("live_rows"),
            )

        asyncio.create_task(_boot_api_prices())
    except Exception as e:
        log.debug("boot api-ledger skipped: %s", e)

    try:
        from apps.core.services import uptime_log, schedule_clock, sun_times
        sun_times.refresh_if_stale()
        uptime_log.record_origin_start()
        schedule_clock.sample_day_start()
    except Exception as e:
        log.debug("uptime start skipped: %s", e)

    yield

    log.info("Ava Core shutting down")
    try:
        from apps.core.services import uptime_log, schedule_clock
        schedule_clock.sample_day_stop()
        uptime_log.record_origin_stop()
        from apps.core.services.startup_voice import note_down

        note_down()
    except Exception:
        pass
    if _scheduler:
        await _scheduler.stop()
    try:
        from apps.voice.director import get_director
        await get_director().stop()
    except Exception:
        pass
    try:
        from apps.core.services.python_drop_runner import get_runner

        await get_runner().stop()
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
    "public_site",
    "feedback",
    "context",
    "goals",
    "obs",
    "minecraft",
    "economy",
    "desktop",
    "chat",
    "plugins",
    "realworld",
    "kilauea_mobile",
    "media",
    "blog",
    "ops",
    "local_site",
    "brain",
    "vercel_builds",
    "site_backgrounds",
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

# OBS Ava Audio browser source fetches chimes/reports from here.
try:
    config.GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    app.mount(
        "/data/generated",
        StaticFiles(directory=str(config.GENERATED_DIR)),
        name="generated_audio",
    )
except Exception as _exc:
    log.warning("generated audio mount failed: %s", _exc)


@app.get("/health")
async def health():
    return {"ok": True, "version": "2.0.0", "host": "AVA-CORE"}


@app.get("/maintenance")
async def maintenance():
    from fastapi.responses import FileResponse
    html = Path(__file__).resolve().parent / "static" / "maintenance.html"
    return FileResponse(html, media_type="text/html", status_code=503)


@app.get("/api/config")
async def api_config():
    """Non-secret config snapshot (dev only)."""
    if config.AVA_ENV != "development":
        return JSONResponse({"error": "not available"}, status_code=403)
    return config.as_dict()


# Last so /ops, /status, /api/* keep their routers. Serves rootrecord HTML
# files and folder index.html. Pretty /about is the Worker; origin still
# answers /about.html (and /about when the file exists).
_RR_STATIC = Path(__file__).resolve().parent / "static" / "rootrecord"


@app.api_route("/{rest:path}", methods=["GET", "HEAD"])
async def rootrecord_static_fallback(rest: str):
    from fastapi.responses import FileResponse, HTMLResponse

    if not rest or rest.startswith(("api/", "ops", "ops/")):
        return HTMLResponse("", status_code=404)
    try:
        target = (_RR_STATIC / rest).resolve()
        target.relative_to(_RR_STATIC.resolve())
    except ValueError:
        return HTMLResponse("", status_code=404)
    candidates = []
    if target.is_file():
        candidates.append(target)
    if not rest.lower().endswith(".html"):
        candidates.append(_RR_STATIC / f"{rest}.html")
        candidates.append(_RR_STATIC / rest / "index.html")
    for cand in candidates:
        try:
            resolved = cand.resolve()
            resolved.relative_to(_RR_STATIC.resolve())
        except ValueError:
            continue
        if resolved.is_file():
            return FileResponse(resolved, headers={"Cache-Control": "no-store"})
    return HTMLResponse("", status_code=404)


# ── CLI ───────────────────────────────────────────────────────────────────────

def cli():
    uvicorn.run(
        "apps.core.main:app",
        host="127.0.0.1",
        port=config.AVA_PORT,
        reload=config.AVA_ENV == "development",
        log_level="info",
    )


if __name__ == "__main__":
    cli()

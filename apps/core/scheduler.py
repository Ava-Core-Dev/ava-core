"""
Ava Core Scheduler — replaces cronRunner.mjs.
Uses APScheduler with AsyncIO backend. Runs all cron jobs locally;
Cloudflare Workers check the heartbeat and stand down when Ava is awake.

Always-on design: no sleep mode, no day/night throttle. Ava relays data
whenever the device is powered on — right up until actual power-off.
Cloudflare Workers take over automatically once the heartbeat stops.
"""

from __future__ import annotations

import inspect
import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from . import config
from .heartbeat import write_heartbeat

log = logging.getLogger("ava.scheduler")

_instance: "Scheduler | None" = None


def get_scheduler() -> "Scheduler | None":
    """The live Scheduler, or None before boot. Lets routes trigger jobs
    without importing main.py (which imports the routes)."""
    return _instance


class Scheduler:
    def __init__(self):
        global _instance
        self._apscheduler = AsyncIOScheduler(timezone="Pacific/Honolulu")
        self._register_jobs()
        _instance = self

    def _register_jobs(self):
        s = self._apscheduler

        # ── Heartbeat (every 60s) ─────────────────────────────────────────────
        # Tells Cloudflare Workers Ava is alive → they stay in standby.
        # When this stops, CF workers auto-kick their fallback crons.
        s.add_job(write_heartbeat, IntervalTrigger(seconds=60),
                  id="heartbeat", name="CF heartbeat writer", misfire_grace_time=30)

        # ── NOAA / NWS weather (every 15 min, all hours) ──────────────────────
        s.add_job(self._run("noaa"), IntervalTrigger(minutes=60),
                  id="rr-noaa", name="NOAA weather", misfire_grace_time=180)

        # ── Kīlauea (hourly). Hash ignores the clock so unchanged USGS/HVO
        #    does not republish. Grok/Cursor synthesis is a separate 2×/day drain.
        s.add_job(self._run("kilauea"), IntervalTrigger(minutes=60),
                  id="rr-kilauea", name="Kīlauea", misfire_grace_time=180)

        # ── Time chime (:00 and :30 HST) — bell + time_HHMM.mp3 ───────────────
        # Uses all 48 clips (time_0000 … time_2330) via Stream Director → desktop + OBS
        s.add_job(self._run("hourly_chime"), CronTrigger(minute="0,30"),
                  id="time-chime", name="Time chime (:00/:30)", misfire_grace_time=90)

        # ── Hourly solar + weather (top of every hour) ────────────────────────
        s.add_job(self._run("solar_weather"), CronTrigger(minute=0),
                  id="hourly-solar-weather", name="Hourly solar+weather", misfire_grace_time=120)

        # ── System performance (top of every hour) ────────────────────────────
        s.add_job(self._run("system_perf"), CronTrigger(minute=0),
                  id="system-performance", name="System performance", misfire_grace_time=120)

        # ── Player economy + Kīlauea multiplier (every 10 min) ───────────────
        s.add_job(self._run("player_economy"), IntervalTrigger(minutes=30),
                  id="player-economy-report", name="Player economy", misfire_grace_time=180)

        # ── Morning report (10:00 HST) ────────────────────────────────────────
        s.add_job(self._run("morning_report"), CronTrigger(hour=10, minute=0),
                  id="morning-report", name="Morning report", misfire_grace_time=300)

        # ── Merged morning summary (10:05 HST) ───────────────────────────────
        # Only cron that posts to #updates. Everything else → #automations.
        s.add_job(self._run("merged_morning"), CronTrigger(hour=10, minute=5),
                  id="merged-morning-summary", name="Merged morning summary", misfire_grace_time=300)

        # ── Grok-down Cursor drain (2×/day, not per scan) ────────────────────
        s.add_job(self._run("cursor_fallback"), CronTrigger(hour="10,16", minute=12),
                  id="cursor-fallback", name="Cursor report fallback", misfire_grace_time=600)

        # ── Economy brief (15:00 HST daily) ──────────────────────────────────
        s.add_job(self._run("economy_brief"), CronTrigger(hour=15, minute=0),
                  id="economy-brief", name="Economy brief", misfire_grace_time=300)

        # ── Late-night relay (22:00–05:00 HST, top of each hour) ─────────────
        # No sleep gate — just a scheduled status check-in during late hours.
        # All other crons keep running regardless of time.
        s.add_job(self._run("overnight"),
                  CronTrigger(hour="22-23,0-5", minute=0),
                  id="overnight-relay", name="Late-night relay", misfire_grace_time=300)

        # ── D1 ← host MySQL (every 5 min) ────────────────────────────────────
        s.add_job(self._run("d1_sync"), IntervalTrigger(minutes=5),
                  id="d1-sync", name="MySQL → D1 Minecraft cache", misfire_grace_time=120)

        log.info("Registered %d cron jobs (always-on, no sleep gate)",
                 len(s.get_jobs()))

    @staticmethod
    def _run(name: str):
        """Return an async callable that imports and runs a cron module by name.
        Writes start/finish records to ava_cron MySQL tables (matching old Node.js schema)."""
        async def _job():
            import importlib
            import time
            from apps.core.services.mysql import log_cron_run

            started_at = int(time.time() * 1000)
            ok = False
            detail = ""
            error = ""
            try:
                mod = importlib.import_module(f"apps.core.crons.{name}")
                if hasattr(mod, "run"):
                    await mod.run()
                    ok = True
                    detail = "ok"
                else:
                    log.warning("Cron %s has no run() function", name)
                    detail = "no_run_fn"
            except Exception as exc:
                log.exception("Cron %s failed", name)
                error = str(exc)[:500]
            finally:
                finished_at = int(time.time() * 1000)
                try:
                    await log_cron_run(name, started_at, finished_at, ok, detail, error)
                except Exception:
                    pass  # never let DB logging kill the scheduler
        _job.__name__ = name
        return _job

    async def start(self):
        if not config.ENABLE_SCHEDULER:
            log.info("Scheduler disabled (ENABLE_SCHEDULER=false)")
            return
        self._apscheduler.start()
        log.info("Scheduler started  timezone=Pacific/Honolulu  mode=always-on")

    async def stop(self):
        if self._apscheduler.running:
            self._apscheduler.shutdown(wait=False)
            log.info("Scheduler stopped")

    def get_jobs(self) -> list[dict]:
        return [
            {
                "id": j.id,
                "name": j.name,
                "next_run": j.next_run_time.isoformat() if j.next_run_time else None,
            }
            for j in self._apscheduler.get_jobs()
        ]

    async def run_job_now(self, job_id: str) -> dict:
        """Run a registered job immediately, out of band from its schedule.

        Awaited inline so the caller gets the real outcome instead of a
        fire-and-forget ack; cron bodies also log themselves to ava_cron.
        """
        job = self._apscheduler.get_job(job_id)
        if job is None:
            return {
                "ok": False,
                "detail": f"unknown job {job_id!r}",
                "known": [j.id for j in self._apscheduler.get_jobs()],
            }
        try:
            result = job.func()
            if inspect.isawaitable(result):
                await result
            return {"ok": True, "id": job_id, "name": job.name}
        except Exception as exc:
            log.exception("Manual run of %s failed", job_id)
            return {"ok": False, "id": job_id, "name": job.name, "detail": str(exc)}

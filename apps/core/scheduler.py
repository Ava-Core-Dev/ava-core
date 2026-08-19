"""
Ava Core Scheduler — replaces cronRunner.mjs.
Uses APScheduler with AsyncIO backend. Runs all cron jobs locally;
Cloudflare Workers check the heartbeat and stand down when Ava is awake.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from . import config
from .heartbeat import write_heartbeat

log = logging.getLogger("ava.scheduler")


class Scheduler:
    def __init__(self):
        self._apscheduler = AsyncIOScheduler(timezone="Pacific/Honolulu")
        self._register_jobs()

    def _register_jobs(self):
        s = self._apscheduler

        # ── Heartbeat (every 60s) — keeps CF workers in standby ───────────────
        s.add_job(write_heartbeat, IntervalTrigger(seconds=60), id="heartbeat",
                  name="CF heartbeat writer", misfire_grace_time=30)

        # ── Hourly solar + weather ─────────────────────────────────────────────
        s.add_job(self._run("solar_weather"), CronTrigger(minute=0),
                  id="hourly-solar-weather", name="Hourly solar+weather", misfire_grace_time=120)

        # ── System performance (top of hour) ──────────────────────────────────
        s.add_job(self._run("system_perf"), CronTrigger(minute=0),
                  id="system-performance", name="System performance", misfire_grace_time=120)

        # ── Morning report (10:00 HST) ────────────────────────────────────────
        s.add_job(self._run("morning_report"), CronTrigger(hour=10, minute=0),
                  id="morning-report", name="Morning report", misfire_grace_time=300)

        # ── Merged morning summary (10:05 HST — after individual reports) ─────
        s.add_job(self._run("merged_morning"), CronTrigger(hour=10, minute=5),
                  id="merged-morning-summary", name="Merged morning summary", misfire_grace_time=300)

        # ── Player economy (every hour at :00) ────────────────────────────────
        s.add_job(self._run("player_economy"), CronTrigger(minute=0),
                  id="player-economy-report", name="Player economy", misfire_grace_time=120)

        # ── NOAA / NWS weather (every 15 min) ─────────────────────────────────
        s.add_job(self._run("noaa"), IntervalTrigger(minutes=15),
                  id="rr-noaa", name="NOAA weather", misfire_grace_time=120)

        # ── Kilauea (every 10 min) ────────────────────────────────────────────
        s.add_job(self._run("kilauea"), IntervalTrigger(minutes=10),
                  id="rr-kilauea", name="Kīlauea", misfire_grace_time=120)

        # ── Overnight reserve (23:00 HST) ─────────────────────────────────────
        s.add_job(self._run("overnight"), CronTrigger(hour=23, minute=0),
                  id="overnight-reserve", name="Overnight reserve", misfire_grace_time=300)

        # ── Economy brief (daily) ─────────────────────────────────────────────
        s.add_job(self._run("economy_brief"), CronTrigger(hour=15, minute=0),
                  id="economy-brief", name="Economy brief", misfire_grace_time=300)

        log.info("Registered %d cron jobs", len(s.get_jobs()))

    @staticmethod
    def _run(name: str):
        """Return an async callable that imports and runs a cron module by name."""
        async def _job():
            try:
                import importlib
                mod = importlib.import_module(f"apps.core.crons.{name}")
                if hasattr(mod, "run"):
                    await mod.run()
                else:
                    log.warning("Cron %s has no run() function", name)
            except Exception:
                log.exception("Cron %s failed", name)
        _job.__name__ = name
        return _job

    async def start(self):
        if not config.ENABLE_SCHEDULER:
            log.info("Scheduler disabled (ENABLE_SCHEDULER=false)")
            return
        self._apscheduler.start()
        log.info("Scheduler started  timezone=Pacific/Honolulu")

    async def stop(self):
        if self._apscheduler.running:
            self._apscheduler.shutdown(wait=False)
            log.info("Scheduler stopped")

    def get_jobs(self) -> list[dict]:
        jobs = []
        for j in self._apscheduler.get_jobs():
            next_run = j.next_run_time
            jobs.append({
                "id": j.id,
                "name": j.name,
                "next_run": next_run.isoformat() if next_run else None,
            })
        return jobs

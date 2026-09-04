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
from datetime import datetime, timedelta

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


def _job_wave(job_id: str) -> int:
    """Minimum AVA_CRON_WAVE required to register this job. Heartbeat is always 1."""
    wave1 = {"heartbeat", "rr-noaa", "rr-kilauea", "ecoflow-quota", "host-sample", "log-cleanup"}
    wave2 = {"kilauea-cams", "nhc-media", "hurricane-tracker", "hourly-solar-weather", "system-performance"}
    wave3 = {
        "minecraft-live", "d1-sync", "player-economy-report", "user-qrcodes",
        "vercel-builds", "account-import", "stripe-poll", "inbox-drain",
    }
    wave4 = {
        "morning-report", "merged-morning-summary", "cursor-fallback",
        "economy-brief", "overnight-relay", "governance-daily", "governance-self-update",
    }
    wave5 = {"adsense-eod", "admob-eod"}
    wave6 = {"time-chime", "broadcast-loop", "hourly-clip-prebuild", "hourly-clip-reports"}
    if job_id in wave1 or job_id == "heartbeat":
        return 1
    if job_id in wave2:
        return 2
    if job_id in wave3:
        return 3
    if job_id in wave4:
        return 4
    if job_id in wave5:
        return 5
    if job_id in wave6:
        return 6
    return 1


class _WaveScheduler:
    """Wraps add_job so AVA_CRON_WAVE can omit later clones."""

    def __init__(self, inner):
        self._inner = inner

    def add_job(self, *args, **kwargs):
        job_id = kwargs.get("id") or ""
        need = _job_wave(job_id)
        if need > config.CRON_WAVE:
            log.info("Skipping cron %s (wave %s > AVA_CRON_WAVE=%s)", job_id, need, config.CRON_WAVE)
            return None
        return self._inner.add_job(*args, **kwargs)

    def get_jobs(self):
        return self._inner.get_jobs()


class Scheduler:
    def __init__(self):
        global _instance
        self._apscheduler = AsyncIOScheduler(timezone="Pacific/Honolulu")
        self._register_jobs()
        _instance = self

    def _register_jobs(self):
        s = _WaveScheduler(self._apscheduler)

        # ── Heartbeat (every 60s) ─────────────────────────────────────────────
        # Tells Cloudflare Workers Ava is alive → they stay in standby.
        # When this stops, CF workers auto-kick their fallback crons.
        s.add_job(write_heartbeat, IntervalTrigger(seconds=60),
                  id="heartbeat", name="CF heartbeat writer", misfire_grace_time=30)

        # ── NOAA / NWS weather (hourly) ───────────────────────────────────────
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

        s.add_job(self._run_clip_prebuild, CronTrigger(minute=55),
                  id="hourly-clip-prebuild", name="Prebuild hourly clip reports", misfire_grace_time=120)

        s.add_job(self._run("hourly_clip_reports"), CronTrigger(minute=0),
                  id="hourly-clip-reports", name="Play hourly clip reports", misfire_grace_time=120)

        # ── Hourly solar + weather (top of every hour) ────────────────────────
        s.add_job(self._run("solar_weather"), CronTrigger(minute=0),
                  id="hourly-solar-weather", name="Hourly solar+weather", misfire_grace_time=120)

        # ── System performance (top of every hour) ────────────────────────────
        s.add_job(self._run("system_perf"), CronTrigger(minute=0),
                  id="system-performance", name="System performance", misfire_grace_time=120)

        # ── Player economy + Kīlauea multiplier (every 30 min) ───────────────
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

        s.add_job(self._run("governance_daily"), CronTrigger(hour=10, minute=8),
                  id="governance-daily", name="RootRecord governance daily", misfire_grace_time=300)

        s.add_job(self._run("governance_self_update"), IntervalTrigger(hours=1),
                  id="governance-self-update", name="Governance self-update after boot grace", misfire_grace_time=300)

        # ── Economy brief (15:00 HST daily) ──────────────────────────────────
        s.add_job(self._run("economy_brief"), CronTrigger(hour=15, minute=0),
                  id="economy-brief", name="Economy brief", misfire_grace_time=300)

        # ── AdSense reports (boot + end-of-day only) ─────────────────────────
        # Boot fires from main.py lifespan. EOD close at 21:00 HST.
        s.add_job(self._run_adsense_eod, CronTrigger(hour=21, minute=0),
                  id="adsense-eod", name="AdSense end-of-day report", misfire_grace_time=600)
        s.add_job(self._run_admob_eod, CronTrigger(hour=21, minute=5),
                  id="admob-eod", name="AdMob end-of-day report", misfire_grace_time=600)

        # ── Late-night relay (22:00–05:00 HST, top of each hour) ─────────────
        # No sleep gate — just a scheduled status check-in during late hours.
        # All other crons keep running regardless of time.
        s.add_job(self._run("overnight"),
                  CronTrigger(hour="22-23,0-5", minute=0),
                  id="overnight-relay", name="Late-night relay", misfire_grace_time=300)

        s.add_job(self._run("broadcast_loop"), IntervalTrigger(seconds=20),
                  id="broadcast-loop", name="OBS daily loop rotator", misfire_grace_time=30)

        s.add_job(self._run("minecraft_live"), IntervalTrigger(seconds=45),
                  id="minecraft-live", name="Minecraft in-game detect", misfire_grace_time=30)

        s.add_job(self._run("hurricane_tracker"), IntervalTrigger(minutes=15),
                  id="hurricane-tracker", name="Hurricane tracker slides", misfire_grace_time=120)

        s.add_job(self._run("kilauea_cams"), IntervalTrigger(minutes=5),
                  id="kilauea-cams", name="Kīlauea V1/V2/V3 embed refresh", misfire_grace_time=90)

        s.add_job(self._run("ecoflow_quota"), IntervalTrigger(minutes=2),
                  id="ecoflow-quota", name="EcoFlow quota refresh", misfire_grace_time=60)

        # Host CPU/RAM samples for solar/status desk history charts (~1/min)
        s.add_job(self._sample_host, IntervalTrigger(minutes=1),
                  id="host-sample", name="Host CPU/RAM sample", misfire_grace_time=45)

        s.add_job(self._run("nhc_media"), IntervalTrigger(minutes=10),
                  id="nhc-media", name="NHC EPAC + CPAC forecast graphics", misfire_grace_time=90)

        s.add_job(self._run("log_cleanup"), CronTrigger(hour=4, minute=20),
                  id="log-cleanup", name="Delete log files older than 7 days", misfire_grace_time=300)

        s.add_job(self._run("user_qrcodes"), IntervalTrigger(hours=6),
                  id="user-qrcodes", name="User QR backfill", misfire_grace_time=120)

        s.add_job(self._run("account_import"), IntervalTrigger(hours=6),
                  id="account-import", name="Identity + membership import", misfire_grace_time=300)

        # ── D1 ← host MySQL (every 5 min) ────────────────────────────────────
        s.add_job(self._run("d1_sync"), IntervalTrigger(minutes=5),
                  id="d1-sync", name="MySQL → D1 Minecraft cache", misfire_grace_time=120)

        s.add_job(self._run("inbox_drain"), IntervalTrigger(minutes=5),
                  id="inbox-drain", name="CF offline inbox → local", misfire_grace_time=120)

        s.add_job(self._run("stripe_poll"), IntervalTrigger(minutes=30),
                  id="stripe-poll", name="Stripe finance snapshot", misfire_grace_time=180)

        s.add_job(self._run("vercel_builds"), IntervalTrigger(minutes=5),
                  id="vercel-builds", name="Vercel build logs → docs", misfire_grace_time=120)

        log.info("Registered %d cron jobs (always-on, no sleep gate)",
                 len(s.get_jobs()))

    @staticmethod
    async def _sample_host():
        try:
            from apps.core.crons.since_last_fire.solar_weather import record_host_sample
            record_host_sample()
        except Exception as e:
            log.debug("host sample skipped: %s", e)
        try:
            from apps.core.services import sun_times, uptime_log, schedule_clock
            sun_times.refresh_if_stale()
            uptime_log.tick()
            schedule_clock.sample_day_start()
        except Exception as e:
            log.debug("sun/uptime sample skipped: %s", e)

    @staticmethod
    async def _run_adsense_eod():
        from apps.core.crons.on_time import adsense_report

        await adsense_report.run("eod")

    @staticmethod
    async def _run_admob_eod():
        from apps.core.crons.on_time import admob_report

        await admob_report.run("eod")

    @staticmethod
    async def _run_clip_prebuild():
        from apps.core.crons.since_last_fire import hourly_clip_reports

        await hourly_clip_reports.prebuild()

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
                last = None
                mod = None
                for pkg in (
                    "apps.core.crons.always_on",
                    "apps.core.crons.since_last_fire",
                    "apps.core.crons.on_time",
                    "apps.core.crons",
                ):
                    try:
                        mod = importlib.import_module(f"{pkg}.{name}")
                        break
                    except ModuleNotFoundError as exc:
                        last = exc
                if mod is None:
                    raise last or ModuleNotFoundError(name)
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
        try:
            await write_heartbeat()
        except Exception as e:
            log.warning("Immediate heartbeat failed: %s", e)

    async def stop(self):
        if self._apscheduler.running:
            self._apscheduler.shutdown(wait=False)
            log.info("Scheduler stopped")

    def get_jobs(self) -> list[dict]:
        out = []
        for j in self._apscheduler.get_jobs():
            next_run = j.next_run_time.isoformat() if j.next_run_time else None
            next_at = int(j.next_run_time.timestamp() * 1000) if j.next_run_time else 0
            every_ms = 0
            trig = j.trigger
            interval = getattr(trig, "interval", None)
            if interval is not None:
                try:
                    every_ms = int(interval.total_seconds() * 1000)
                except Exception:
                    every_ms = 0
            out.append(
                {
                    "id": j.id,
                    "name": j.name,
                    "next_run": next_run,
                    "nextAt": next_at,
                    "everyMs": every_ms or 3_600_000,
                    "cronHint": j.name or str(trig),
                    "running": False,
                    "disabled": False,
                    "lastFiredAt": None,
                }
            )
        return out

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

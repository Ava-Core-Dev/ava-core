"""Cron listing and manual triggers.

Lets the desktop GUI run any scheduled job on demand over HTTP, replacing the
old pattern of spawning .mjs scripts out of the retired Node core directory.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter

from ..scheduler import get_scheduler
from ..services.mysql import recent_cron_runs

router = APIRouter(prefix="/api/crons")
log = logging.getLogger("ava.crons")


@router.get("")
async def list_crons():
    sched = get_scheduler()
    if sched is None:
        return {"ok": False, "detail": "scheduler not started", "jobs": []}
    return {"ok": True, "jobs": sched.get_jobs()}


@router.get("/runs")
async def cron_runs(limit: int = 50):
    """Recent run history from the ava_cron MySQL tables."""
    try:
        rows = await recent_cron_runs(limit=max(1, min(int(limit), 500)))
        return {"ok": True, "runs": rows}
    except Exception as e:
        log.warning("cron run history unavailable: %s", e)
        return {"ok": False, "detail": str(e), "runs": []}


@router.post("/{job_id}/run")
async def run_cron(job_id: str):
    sched = get_scheduler()
    if sched is None:
        return {"ok": False, "detail": "scheduler not started"}
    return await sched.run_job_now(job_id)

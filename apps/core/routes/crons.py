"""Cron listing and manual triggers.

Lets the desktop GUI run any scheduled job on demand over HTTP, replacing the
old pattern of spawning .mjs scripts out of the retired Node core directory.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter
from pydantic import BaseModel

from ..scheduler import get_scheduler
from ..services.mysql import recent_cron_runs

router = APIRouter(prefix="/api/crons")
legacy_router = APIRouter(prefix="/api/cron")
log = logging.getLogger("ava.crons")


def _cron_payload():
    sched = get_scheduler()
    if sched is None:
        return {"ok": False, "detail": "scheduler not started", "started": False, "jobs": []}
    return {
        "ok": True,
        "started": True,
        "jobs": sched.get_jobs(),
    }


@router.get("")
@router.get("/")
async def list_crons():
    return _cron_payload()


@legacy_router.get("")
@legacy_router.get("/")
async def legacy_list_crons():
    return _cron_payload()


@router.get("/runs")
async def cron_runs(limit: int = 50):
    """Recent run history from the ava_cron MySQL tables."""
    try:
        rows = await recent_cron_runs(limit=max(1, min(int(limit), 500)))
        return {"ok": True, "runs": rows}
    except Exception as e:
        log.warning("cron run history unavailable: %s", e)
        return {"ok": False, "detail": str(e), "runs": []}


@router.post("/ensure-midday")
async def ensure_midday():
    """Hot path: register midday-report (11:55 → noon) if the live scheduler lacks it."""
    sched = get_scheduler()
    if sched is None:
        return {"ok": False, "detail": "scheduler not started"}
    if not hasattr(sched, "ensure_midday_job"):
        return {"ok": False, "detail": "ensure_midday_job missing — recycle origin once"}
    return sched.ensure_midday_job()


@router.post("/{job_id}/run")
async def run_cron(job_id: str):
    sched = get_scheduler()
    if sched is None:
        return {"ok": False, "detail": "scheduler not started"}
    return await sched.run_job_now(job_id)


class CronRunBody(BaseModel):
    id: str
    reason: str | None = None


@legacy_router.post("/run")
async def legacy_run_cron(body: CronRunBody):
    return await run_cron(body.id.strip())

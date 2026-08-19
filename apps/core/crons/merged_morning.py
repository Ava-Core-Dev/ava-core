"""Merged morning summary cron (10:05 HST) — delegates to morning_report.run_merged."""

from __future__ import annotations
from .morning_report import run_merged

async def run():
    await run_merged()

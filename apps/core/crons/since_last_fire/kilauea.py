"""Scheduler entry point for the standalone Kilauea processor."""

from __future__ import annotations


async def run():
    from apps.core.services.kilauea import run as process_kilauea

    return await process_kilauea()

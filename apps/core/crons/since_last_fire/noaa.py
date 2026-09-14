"""Scheduler entry point for the standalone Weather processor."""

from __future__ import annotations


async def run():
    from apps.core.services.weather import run as process_weather

    return await process_weather()

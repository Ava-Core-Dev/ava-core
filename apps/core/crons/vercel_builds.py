"""Poll Vercel deployments into docs media (errors only)."""

from __future__ import annotations

import logging

log = logging.getLogger("ava.cron.vercel_builds")


async def run() -> None:
    from apps.core.services import vercel_builds

    result = await vercel_builds.sync_recent()
    log.info("vercel builds %s", result)

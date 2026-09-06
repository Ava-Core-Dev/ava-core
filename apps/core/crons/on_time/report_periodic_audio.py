"""Periodic report audio replay cron wrapper."""

from __future__ import annotations

import logging

log = logging.getLogger("ava.cron.report_periodic_audio")


async def run():
    from apps.core.services import report_periodic_audio

    result = await report_periodic_audio.run()
    log.info("periodic report audio result=%s", result)
    return result

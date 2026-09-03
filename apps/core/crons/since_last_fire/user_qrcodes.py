"""Backfill / refresh per-user QR codes from D1 license accounts."""

from __future__ import annotations

import logging

log = logging.getLogger("ava.cron.user_qrcodes")


async def run():
    from apps.core.services.user_qrcodes import backfill

    result = await backfill()
    log.info("user QR backfill users=%s ava=%s", result.get("users"), result.get("ava_qr"))
    return result

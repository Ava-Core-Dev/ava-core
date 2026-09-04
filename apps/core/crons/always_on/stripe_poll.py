"""Refresh Stripe snapshot so the finance desk is not days old."""

from __future__ import annotations

import logging

log = logging.getLogger("ava.cron.stripe_poll")


async def run() -> None:
    from apps.core.services import stripe_poll

    snap = await stripe_poll.poll(force=False)
    log.info(
        "stripe %s avail=%s income30d=%s",
        "ok" if snap.get("ok") else snap.get("detail") or "fail",
        snap.get("usdAvailable"),
        snap.get("income30dUsd"),
    )

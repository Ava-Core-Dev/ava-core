"""Periodic identity import from disk + D1 + Discord + RootMC."""

from __future__ import annotations

import logging

log = logging.getLogger("ava.cron.account_import")


async def run():
    from apps.core.services.account_import import run as import_run

    result = await import_run()
    counts = result.get("counts") or {}
    log.info(
        "account import identities=%s email=%s discord=%s uuid=%s solana=%s",
        counts.get("identities"),
        counts.get("id_email"),
        counts.get("id_discord"),
        counts.get("id_uuid"),
        counts.get("id_solana"),
    )
    return {
        "ok": result.get("ok"),
        "identities": counts.get("identities"),
        "uuid_lookup_ok": result.get("uuid_lookup_ok"),
    }

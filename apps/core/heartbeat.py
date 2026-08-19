"""
Ava heartbeat writer — keeps Cloudflare Workers in standby while Ava is awake.
Writes a row to the D1 database every 60 seconds via the CF REST API.
CF workers check this before running; fresh heartbeat = stand down.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone

import httpx

from . import config

log = logging.getLogger("ava.heartbeat")

_HEARTBEAT_TABLE = "ava_heartbeat"
_last_success: float = 0.0


async def write_heartbeat() -> bool:
    """POST a heartbeat row to Cloudflare D1. Returns True on success."""
    global _last_success

    if not config.CF_API_TOKEN or not config.CF_ACCOUNT_ID or not config.CF_D1_HEARTBEAT_DB_ID:
        # Silently skip if CF not configured yet
        return False

    now = datetime.now(timezone.utc)
    url = (
        f"https://api.cloudflare.com/client/v4/accounts/{config.CF_ACCOUNT_ID}"
        f"/d1/database/{config.CF_D1_HEARTBEAT_DB_ID}/query"
    )
    payload = {
        "sql": (
            f"INSERT INTO {_HEARTBEAT_TABLE} (ts, host) VALUES (?1, ?2) "
            f"ON CONFLICT(host) DO UPDATE SET ts = excluded.ts"
        ),
        "params": [now.isoformat(), "ava-core"],
    }
    headers = {
        "Authorization": f"Bearer {config.CF_API_TOKEN}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(url, json=payload, headers=headers)
        if r.status_code == 200:
            _last_success = time.monotonic()
            log.debug("Heartbeat written  ts=%s", now.isoformat())
            return True
        else:
            log.warning("Heartbeat failed  status=%s  body=%s", r.status_code, r.text[:200])
            return False
    except Exception as e:
        log.warning("Heartbeat exception: %s", e)
        return False


def last_success_age_s() -> float | None:
    """Seconds since last successful heartbeat write, or None if never."""
    if _last_success == 0.0:
        return None
    return time.monotonic() - _last_success

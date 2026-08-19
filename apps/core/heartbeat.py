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
_warned_unconfigured = False
_table_ready = False

# Must match initHeartbeatTable() in packages/workers/src/shared/heartbeat.ts
_CREATE_TABLE_SQL = f"""
CREATE TABLE IF NOT EXISTS {_HEARTBEAT_TABLE} (
  host TEXT PRIMARY KEY,
  ts   TEXT NOT NULL
)
"""


def _auth_headers() -> dict[str, str]:
    """Bearer for scoped API tokens, X-Auth-* for account API keys."""
    headers = {"Content-Type": "application/json"}
    if config.CF_API_TOKEN:
        headers["Authorization"] = f"Bearer {config.CF_API_TOKEN}"
    else:
        headers["X-Auth-Email"] = config.CF_EMAIL
        headers["X-Auth-Key"] = config.CF_GLOBAL_API_KEY
    return headers


def _d1_url() -> str:
    return (
        f"https://api.cloudflare.com/client/v4/accounts/{config.CF_ACCOUNT_ID}"
        f"/d1/database/{config.CF_D1_HEARTBEAT_DB_ID}/query"
    )


async def _d1_query(client: httpx.AsyncClient, sql: str,
                    params: list[str] | None = None) -> httpx.Response:
    payload: dict = {"sql": sql}
    if params:
        payload["params"] = params
    return await client.post(_d1_url(), json=payload, headers=_auth_headers())


async def write_heartbeat() -> bool:
    """POST a heartbeat row to Cloudflare D1. Returns True on success."""
    global _last_success, _warned_unconfigured

    has_auth = bool(config.CF_API_TOKEN) or bool(
        config.CF_GLOBAL_API_KEY and config.CF_EMAIL
    )
    missing = [
        name for name, val in (
            ("CF_API_TOKEN (or CLOUDFLARE_GLOBAL_API_KEY + CLOUDFLARE_EMAIL)", has_auth),
            ("CF_ACCOUNT_ID", config.CF_ACCOUNT_ID),
            ("CF_D1_HEARTBEAT_DB_ID", config.CF_D1_HEARTBEAT_DB_ID),
        ) if not val
    ]
    if missing:
        # Warn once: a silent skip here reads as "host offline" on the status page.
        if not _warned_unconfigured:
            _warned_unconfigured = True
            log.error("Heartbeat disabled — missing config: %s. "
                      "Status pages will report the host offline.", ", ".join(missing))
        return False

    global _table_ready

    now = datetime.now(timezone.utc)
    upsert = (
        f"INSERT INTO {_HEARTBEAT_TABLE} (ts, host) VALUES (?1, ?2) "
        f"ON CONFLICT(host) DO UPDATE SET ts = excluded.ts"
    )

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await _d1_query(client, upsert, [now.isoformat(), "ava-core"])

            # The workers own this schema, but they may not be deployed yet.
            if not _table_ready and _missing_table(r):
                log.info("Creating %s table in D1", _HEARTBEAT_TABLE)
                created = await _d1_query(client, _CREATE_TABLE_SQL)
                if created.status_code != 200:
                    log.warning("Could not create %s  status=%s  body=%s",
                                _HEARTBEAT_TABLE, created.status_code, created.text[:300])
                    return False
                r = await _d1_query(client, upsert, [now.isoformat(), "ava-core"])

        if r.status_code == 200:
            _table_ready = True
            _last_success = time.monotonic()
            log.debug("Heartbeat written  ts=%s", now.isoformat())
            return True

        log.warning("Heartbeat failed  status=%s  body=%s", r.status_code, r.text[:300])
        return False
    except Exception as e:
        log.warning("Heartbeat exception: %s", e)
        return False


def _missing_table(r: httpx.Response) -> bool:
    """D1 reports a missing table as a SQL error, not an HTTP status."""
    return f"no such table: {_HEARTBEAT_TABLE}" in r.text


def last_success_age_s() -> float | None:
    """Seconds since last successful heartbeat write, or None if never."""
    if _last_success == 0.0:
        return None
    return time.monotonic() - _last_success

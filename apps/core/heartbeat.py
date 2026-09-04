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
_fail_until: float = 0.0
_FAIL_QUIET_S = 600.0

# Must match initHeartbeatTable() in packages/workers/src/shared/heartbeat.ts
_CREATE_TABLE_SQL = f"""
CREATE TABLE IF NOT EXISTS {_HEARTBEAT_TABLE} (
  host TEXT PRIMARY KEY,
  ts   TEXT NOT NULL
)
"""


def _bearer_headers() -> dict[str, str]:
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {config.CF_API_TOKEN}",
    }


def _legacy_headers() -> dict[str, str]:
    return {
        "Content-Type": "application/json",
        "X-Auth-Email": config.CF_WORKERS_EMAIL or config.CF_EMAIL,
        "X-Auth-Key": config.CF_WORKERS_API_KEY or config.CF_GLOBAL_API_KEY,
    }


def _auth_modes() -> list[tuple[str, dict[str, str]]]:
    modes: list[tuple[str, dict[str, str]]] = []
    email = (config.CF_WORKERS_EMAIL or config.CF_EMAIL or "").strip()
    key = (config.CF_WORKERS_API_KEY or config.CF_GLOBAL_API_KEY or "").strip()
    if email and key:
        modes.append(("legacy", _legacy_headers()))
    if config.CF_API_TOKEN:
        modes.append(("bearer", _bearer_headers()))
    return modes


def _d1_url() -> str:
    return (
        f"https://api.cloudflare.com/client/v4/accounts/{config.CF_ACCOUNT_ID}"
        f"/d1/database/{config.CF_D1_HEARTBEAT_DB_ID}/query"
    )


async def _d1_query(client: httpx.AsyncClient, sql: str,
                    params: list[str] | None = None,
                    headers: dict[str, str] | None = None) -> httpx.Response:
    payload: dict = {"sql": sql}
    if params:
        payload["params"] = params
    return await client.post(_d1_url(), json=payload, headers=headers or {})


async def write_heartbeat() -> bool:
    """POST a heartbeat row to Cloudflare D1. Returns True on success."""
    global _last_success, _warned_unconfigured, _fail_until

    if _fail_until and time.monotonic() < _fail_until:
        return False

    modes = _auth_modes()
    if not modes or not config.CF_ACCOUNT_ID or not config.CF_D1_HEARTBEAT_DB_ID:
        missing = []
        if not modes:
            missing.append("CF_API_TOKEN or CLOUDFLARE_API_KEY+CLOUDFLARE_EMAIL")
        if not config.CF_ACCOUNT_ID:
            missing.append("CF_ACCOUNT_ID")
        if not config.CF_D1_HEARTBEAT_DB_ID:
            missing.append("CF_D1_HEARTBEAT_DB_ID")
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
            r = None
            used = ""
            ok_headers: dict[str, str] | None = None
            for name, headers in modes:
                r = await _d1_query(client, upsert, [now.isoformat(), "ava-core"], headers)
                used = name
                if r.status_code == 200:
                    ok_headers = headers
                    break
                if r.status_code in {401, 403}:
                    log.warning(
                        "Heartbeat D1 %s with %s auth — trying next credential",
                        r.status_code, name,
                    )
                    continue
                break

            if r is None:
                return False

            # The workers own this schema, but they may not be deployed yet.
            if not _table_ready and _missing_table(r):
                log.info("Creating %s table in D1", _HEARTBEAT_TABLE)
                create_headers = ok_headers or modes[0][1]
                created = await _d1_query(client, _CREATE_TABLE_SQL, headers=create_headers)
                if created.status_code != 200:
                    log.warning("Could not create %s  status=%s  body=%s",
                                _HEARTBEAT_TABLE, created.status_code, created.text[:300])
                    return False
                r = await _d1_query(client, upsert, [now.isoformat(), "ava-core"], headers=create_headers)

        if r.status_code == 200:
            _table_ready = True
            _fail_until = 0.0
            _last_success = time.monotonic()
            log.info("Heartbeat written  auth=%s", used)
            return True

        if r.status_code in {401, 403}:
            _fail_until = time.monotonic() + _FAIL_QUIET_S
            log.warning(
                "Heartbeat failed  status=%s  body=%s — quiet %ss (credential pair, not .env rewrite)",
                r.status_code, r.text[:300], int(_FAIL_QUIET_S),
            )
        else:
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

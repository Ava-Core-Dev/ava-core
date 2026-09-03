"""Cloudflare D1 REST helper (same auth as heartbeat.py)."""

from __future__ import annotations

import logging

import httpx

from .. import config

log = logging.getLogger("ava.d1")


def auth_headers() -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if config.CF_API_TOKEN:
        headers["Authorization"] = f"Bearer {config.CF_API_TOKEN}"
    else:
        headers["X-Auth-Email"] = config.CF_EMAIL
        headers["X-Auth-Key"] = config.CF_GLOBAL_API_KEY
    return headers


def _is_account_db(db_id: str) -> bool:
    return bool(db_id and config.CF_D1_ACCOUNT_DB_ID and db_id == config.CF_D1_ACCOUNT_DB_ID)


def _is_rootmc_db(db_id: str) -> bool:
    return bool(db_id and config.CF_D1_ROOTMC_DB_ID and db_id == config.CF_D1_ROOTMC_DB_ID)


def _account_id_for(db_id: str) -> str:
    if _is_account_db(db_id) and config.CF_D1_ACCOUNT_ACCOUNT_ID:
        return config.CF_D1_ACCOUNT_ACCOUNT_ID
    if _is_rootmc_db(db_id) and getattr(config, "CF_D1_ROOTMC_ACCOUNT_ID", ""):
        return config.CF_D1_ROOTMC_ACCOUNT_ID
    return config.CF_ACCOUNT_ID


def _auth_modes(db_id: str = "") -> list[dict[str, str]]:
    modes: list[dict[str, str]] = []
    if _is_account_db(db_id) and config.CF_D1_ACCOUNT_EMAIL and config.CF_D1_ACCOUNT_API_KEY:
        modes.append({
            "Content-Type": "application/json",
            "X-Auth-Email": config.CF_D1_ACCOUNT_EMAIL,
            "X-Auth-Key": config.CF_D1_ACCOUNT_API_KEY,
        })
        return modes
    if _is_rootmc_db(db_id) and config.CF_API_TOKEN:
        modes.append({
            "Content-Type": "application/json",
            "Authorization": f"Bearer {config.CF_API_TOKEN}",
        })
    workers_email = (config.CF_WORKERS_EMAIL or config.CF_EMAIL or "").strip()
    workers_key = (config.CF_WORKERS_API_KEY or config.CF_GLOBAL_API_KEY or "").strip()
    if workers_email and workers_key:
        modes.append({
            "Content-Type": "application/json",
            "X-Auth-Email": workers_email,
            "X-Auth-Key": workers_key,
        })
    if config.CF_API_TOKEN:
        modes.append({
            "Content-Type": "application/json",
            "Authorization": f"Bearer {config.CF_API_TOKEN}",
        })
    return modes or [auth_headers()]


def _url(db_id: str, account_id: str | None = None) -> str:
    acc = account_id or _account_id_for(db_id)
    return (
        f"https://api.cloudflare.com/client/v4/accounts/{acc}"
        f"/d1/database/{db_id}/query"
    )


async def query(db_id: str, sql: str, params: list | None = None) -> dict:
    """Run one SQL statement. Returns the CF JSON body (success/errors/result)."""
    account_id = _account_id_for(db_id)
    if not db_id or not account_id:
        return {"success": False, "errors": [{"message": "d1 not configured"}]}
    payload: dict = {"sql": sql}
    if params:
        payload["params"] = params
    last: dict = {"success": False, "errors": [{"message": "d1 not configured"}]}
    async with httpx.AsyncClient(timeout=30) as client:
        for headers in _auth_modes(db_id):
            res = await client.post(_url(db_id, account_id), json=payload, headers=headers)
            try:
                body = res.json()
            except Exception:
                body = {"success": False, "errors": [{"message": res.text[:400]}]}
            last = body
            if res.status_code < 400 and body.get("success"):
                return body
            if res.status_code not in {401, 403}:
                if res.status_code >= 400:
                    log.warning("D1 %s HTTP %s: %s", db_id[:8], res.status_code, body)
                return body
        if last.get("errors"):
            log.warning("D1 %s unauthorized on all auth modes", db_id[:8])
        return last


async def exec_script(db_id: str, statements: list[str]) -> bool:
    ok = True
    for sql in statements:
        sql = sql.strip()
        # Drop full-line comments so a semicolon inside a comment cannot leak
        lines = [
            ln for ln in sql.splitlines()
            if ln.strip() and not ln.strip().startswith("--")
        ]
        sql = "\n".join(lines).strip()
        if not sql:
            continue
        body = await query(db_id, sql)
        if not body.get("success"):
            ok = False
            log.warning("D1 exec failed: %s", body.get("errors"))
    return ok

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


def _url(db_id: str) -> str:
    return (
        f"https://api.cloudflare.com/client/v4/accounts/{config.CF_ACCOUNT_ID}"
        f"/d1/database/{db_id}/query"
    )


async def query(db_id: str, sql: str, params: list | None = None) -> dict:
    """Run one SQL statement. Returns the CF JSON body (success/errors/result)."""
    if not db_id or not config.CF_ACCOUNT_ID:
        return {"success": False, "errors": [{"message": "d1 not configured"}]}
    payload: dict = {"sql": sql}
    if params:
        payload["params"] = params
    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.post(_url(db_id), json=payload, headers=auth_headers())
        try:
            body = res.json()
        except Exception:
            body = {"success": False, "errors": [{"message": res.text[:400]}]}
        if res.status_code >= 400:
            log.warning("D1 %s HTTP %s: %s", db_id[:8], res.status_code, body)
        return body


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

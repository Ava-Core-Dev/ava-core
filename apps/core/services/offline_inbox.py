"""Drain Cloudflare offline inbox to local disk, then delete the edge rows.

Clears temp `ava_ecoflow` after a successful drain. Never touches auth,
licenses, or rootmc-live.
"""

from __future__ import annotations

import json
import logging

from apps.core import config
from apps.core.services import feedback_store

log = logging.getLogger("ava.inbox")


async def _heartbeat_query(sql: str, params: list | None = None):
    from apps.core import heartbeat

    modes = heartbeat._auth_modes()
    if not modes or not config.CF_ACCOUNT_ID or not config.CF_D1_HEARTBEAT_DB_ID:
        return None
    import httpx

    async with httpx.AsyncClient(timeout=15) as client:
        last = None
        for _name, headers in modes:
            last = await heartbeat._d1_query(client, sql, params, headers)
            if last.status_code == 200:
                return last
            if last.status_code not in {401, 403}:
                return last
        return last


def _rows(resp) -> list[dict]:
    if resp is None or resp.status_code != 200:
        return []
    try:
        body = resp.json()
    except Exception:
        return []
    results = body.get("result") or []
    if isinstance(results, list) and results:
        first = results[0] if isinstance(results[0], dict) else {}
        return list(first.get("results") or [])
    return []


async def drain() -> dict:
    listed = await _heartbeat_query(
        "SELECT id, at, iso, surface, author_name, kind, content FROM ava_offline_inbox "
        "ORDER BY at ASC LIMIT 100"
    )
    rows = _rows(listed)
    kept = 0
    deleted = 0
    for row in rows:
        raw = row.get("content") or ""
        payload = {}
        if isinstance(raw, str) and raw.startswith("{"):
            try:
                payload = json.loads(raw)
            except Exception:
                payload = {"message": raw}
        elif raw:
            payload = {"message": str(raw)}
        payload.setdefault("id", row.get("id"))
        payload.setdefault("iso", row.get("iso"))
        payload.setdefault("surface", row.get("surface") or "offline")
        payload.setdefault("kind", row.get("kind") or "feedback")
        payload.setdefault("name", row.get("author_name") or "")
        payload.setdefault("message", payload.get("content") or payload.get("message") or "")
        try:
            feedback_store.store(payload)
            kept += 1
        except Exception as e:
            log.warning("inbox store skipped %s: %s", row.get("id"), e)
            continue
        rid = row.get("id")
        if rid:
            gone = await _heartbeat_query("DELETE FROM ava_offline_inbox WHERE id = ?1", [rid])
            if gone is not None and gone.status_code == 200:
                deleted += 1
    eco_cleared = False
    if kept or not rows:
        # Origin is up. Drop the temp edge EcoFlow snapshot so CF does not keep a stale bank.
        wiped = await _heartbeat_query("DELETE FROM ava_ecoflow WHERE host = 'ava-core'")
        eco_cleared = bool(wiped is not None and wiped.status_code == 200)
    return {
        "ok": True,
        "inbox": len(rows),
        "stored": kept,
        "deleted": deleted,
        "ecoflow_cleared": eco_cleared,
    }

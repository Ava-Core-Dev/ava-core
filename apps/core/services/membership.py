"""RootMC membership — call RootMC's own API, never host it on Ava origin.

Canonical hostname is ``api.rootmc.net``. Public DNS currently 301s that host
to rootrecord.cloud (holding). The live Worker is the same origin already
named in ``packages/workers/src/rootmc-api/worker.ts``.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from apps.core import config
from apps.core.services import identities

log = logging.getLogger("ava.membership")

ROOTMC_API = (getattr(config, "ROOTMC_API_BASE", None) or "https://api.rootmc.net").rstrip("/")
ROOTMC_UPSTREAM = (
    getattr(config, "ROOTMC_API_UPSTREAM", None) or "https://rootmc-api.root-337.workers.dev"
).rstrip("/")
STATS_PATH = "/api/rootmc/memberships/stats"


def _is_json_ok(body: Any) -> bool:
    return isinstance(body, dict) and body.get("ok") is True


async def _get_json(url: str) -> tuple[int, Any, str]:
    async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
        res = await client.get(url, headers={"Accept": "application/json"})
    ctype = (res.headers.get("content-type") or "").split(";")[0].strip().lower()
    if res.status_code in {301, 302, 303, 307, 308}:
        return res.status_code, {"ok": False, "status": "held", "location": res.headers.get("location")}, ctype
    if "json" not in ctype:
        return res.status_code, {"ok": False, "status": "not_json", "content_type": ctype}, ctype
    try:
        return res.status_code, res.json(), ctype
    except Exception:
        return res.status_code, {"ok": False, "status": "bad_json"}, ctype


async def rootmc_stats() -> dict[str, Any]:
    """Paid membership counts from RootMC's API. No PII."""
    canonical_status, canonical_body, _ = await _get_json(ROOTMC_API + STATS_PATH)
    if _is_json_ok(canonical_body):
        return {
            **canonical_body,
            "api_host": ROOTMC_API,
            "canonical_ok": True,
            "fallback_used": False,
        }
    up_status, up_body, _ = await _get_json(ROOTMC_UPSTREAM + STATS_PATH)
    if _is_json_ok(up_body):
        return {
            **up_body,
            "api_host": ROOTMC_UPSTREAM,
            "canonical_ok": False,
            "canonical_status": canonical_status,
            "canonical_detail": canonical_body if isinstance(canonical_body, dict) else {},
            "fallback_used": True,
            "fallback_status": up_status,
        }
    return {
        "ok": False,
        "status": "blocked",
        "canonical_status": canonical_status,
        "canonical_detail": canonical_body if isinstance(canonical_body, dict) else {},
        "upstream_status": up_status,
        "api_host": ROOTMC_API,
        "note": "api.rootmc.net is held (301). Upstream worker did not return stats JSON.",
    }


async def lookup(query: str) -> dict[str, Any]:
    local = identities.lookup(query)
    stats = None
    try:
        stats = await rootmc_stats()
    except Exception as e:
        stats = {"ok": False, "error": type(e).__name__}
    if not local:
        return {
            "ok": True,
            "found": False,
            "source": "local_identities",
            "rootmc_stats_ok": bool(stats and stats.get("ok")),
            "rootmc_api_separate": True,
        }
    return {
        **local,
        "source": "local_identities",
        "rootmc_stats_ok": bool(stats and stats.get("ok")),
        "rootmc_api_separate": True,
        "rootmc_api_host": (stats or {}).get("api_host"),
    }


async def board() -> dict[str, Any]:
    """Local-only membership board: RootMC stats + local identifier counts. No PII lists."""
    stats = await rootmc_stats()
    counts = identities.counts()
    return {
        "ok": True,
        "public": False,
        "rootmc_api_separate": True,
        "rootmc": stats,
        "local": counts,
        "store": str(identities.db_path()),
    }

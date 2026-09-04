"""Poll Stripe and write the live finance snapshot.

Desk and the local board read ``data/finance/stripe-snapshot.json``.
The last file on disk was 23 Aug 2026. This writes that file again.
Never log the secret.
"""
from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from apps.core import config

log = logging.getLogger("ava.stripe")

STRIPE_API = "https://api.stripe.com/v1"
FRESH_S = 25 * 60


def snapshot_path() -> Path:
    return config.DATA_DIR / "finance" / "stripe-snapshot.json"


def _secret() -> str:
    return (os.getenv("STRIPE_SECRET_KEY") or os.getenv("AVA_STRIPE_SECRET_KEY") or "").strip()


def configured() -> bool:
    return _secret().startswith("sk_")


def _usd(cents: Any) -> float:
    try:
        return round(int(cents) / 100.0, 2)
    except (TypeError, ValueError):
        return 0.0


async def _get(client: httpx.AsyncClient, path: str, params: dict | None = None) -> dict:
    r = await client.get(STRIPE_API + path, params=params or {})
    try:
        body = r.json()
    except Exception:
        body = {}
    if r.status_code >= 400:
        err = body.get("error") if isinstance(body, dict) else {}
        msg = (err or {}).get("message") or r.reason_phrase or str(r.status_code)
        raise RuntimeError(f"stripe {path} {r.status_code}: {msg}")
    return body if isinstance(body, dict) else {}


def _explain(avail: float, pending: float) -> dict[str, Any]:
    covers = pending + avail >= -0.05
    healthy = avail > -1.0 and avail < 0 and covers
    return {
        "avail": avail,
        "pending": pending,
        "pendingCoversDeficit": bool(avail < 0 and covers),
        "healthyTiming": bool(healthy),
    }


def read_snapshot() -> dict[str, Any]:
    path = snapshot_path()
    if not path.is_file():
        return {}
    try:
        import json
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return raw if isinstance(raw, dict) else {}


def snapshot_age_s(snap: dict[str, Any] | None = None) -> float | None:
    snap = snap if snap is not None else read_snapshot()
    at = snap.get("fetchedAt")
    try:
        v = float(at)
    except (TypeError, ValueError):
        return None
    if v > 10_000_000_000:
        v = v / 1000.0
    if v <= 0:
        return None
    return time.time() - v


def _write(snap: dict[str, Any]) -> Path:
    path = snapshot_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    import json
    path.write_text(json.dumps(snap, indent=2, default=str), encoding="utf-8")
    return path


async def poll(*, force: bool = False) -> dict[str, Any]:
    """Refresh the snapshot when stale or forced. Returns the snapshot dict."""
    existing = read_snapshot()
    age = snapshot_age_s(existing)
    if existing.get("ok") and age is not None and age < FRESH_S and not force:
        return existing
    if not configured():
        out = {
            "ok": False,
            "source": "stripe_balance_api",
            "fetchedAt": int(time.time() * 1000),
            "detail": "not_configured",
        }
        _write(out)
        return out

    since = int(time.time()) - 30 * 24 * 3600
    headers = {
        "Authorization": "Bearer " + _secret(),
        "Stripe-Version": "2024-06-20",
    }
    try:
        async with httpx.AsyncClient(timeout=25, headers=headers) as client:
            bal = await _get(client, "/balance")
            tx = await _get(
                client,
                "/balance_transactions",
                {"limit": 100, "created[gte]": str(since)},
            )
            pays = await _get(
                client,
                "/payouts",
                {"limit": 100, "created[gte]": str(since), "status": "paid"},
            )
    except Exception as e:
        log.warning("stripe poll failed: %s", e)
        out = {
            "ok": False,
            "source": "stripe_balance_api",
            "fetchedAt": int(time.time() * 1000),
            "detail": "poll_failed",
            "error": str(e)[:180],
        }
        if existing.get("ok"):
            existing["stale"] = True
            existing["pollError"] = out["error"]
            return existing
        _write(out)
        return out

    available = [
        {"currency": r.get("currency"), "amount": _usd(r.get("amount"))}
        for r in (bal.get("available") or [])
        if isinstance(r, dict)
    ]
    pending = [
        {"currency": r.get("currency"), "amount": _usd(r.get("amount"))}
        for r in (bal.get("pending") or [])
        if isinstance(r, dict)
    ]
    usd_avail = round(sum(float(r.get("amount") or 0) for r in available if r.get("currency") == "usd"), 2)
    usd_pend = round(sum(float(r.get("amount") or 0) for r in pending if r.get("currency") == "usd"), 2)

    income = 0.0
    fees = 0.0
    recent: list[dict[str, Any]] = []
    for row in tx.get("data") or []:
        if not isinstance(row, dict):
            continue
        if str(row.get("currency") or "").lower() != "usd":
            continue
        amt = _usd(row.get("amount"))
        fee = _usd(row.get("fee"))
        net = _usd(row.get("net"))
        kind = str(row.get("type") or "other")
        if kind in ("charge", "payment", "payment_refund") or amt > 0:
            if amt > 0:
                income += amt
            fees += abs(fee)
        created = row.get("created")
        created_iso = None
        if isinstance(created, (int, float)):
            created_iso = datetime.fromtimestamp(int(created), tz=timezone.utc).isoformat()
        recent.append(
            {
                "id": row.get("id"),
                "type": kind,
                "amount": amt,
                "fee": fee,
                "net": net,
                "description": row.get("description") or kind,
                "created": created_iso or created,
                "currency": "usd",
            }
        )
        if len(recent) >= 40:
            break

    payouts = 0.0
    for row in pays.get("data") or []:
        if not isinstance(row, dict):
            continue
        if str(row.get("currency") or "").lower() != "usd":
            continue
        payouts += _usd(row.get("amount"))

    now_ms = int(time.time() * 1000)
    snap = {
        "ok": True,
        "source": "stripe_balance_api",
        "fetchedAt": now_ms,
        "available": available,
        "pending": pending,
        "usdAvailable": usd_avail,
        "usdPending": usd_pend,
        "income30dUsd": round(income, 2),
        "fees30dUsd": round(fees, 2),
        "payouts30dUsd": round(payouts, 2),
        "recent": recent,
        "explain": _explain(usd_avail, usd_pend),
    }
    _write(snap)
    log.info(
        "stripe snapshot avail=%s pending=%s income30d=%s",
        usd_avail, usd_pend, snap["income30dUsd"],
    )
    return snap


async def ensure_snapshot(*, force: bool = False) -> dict[str, Any]:
    return await poll(force=force)

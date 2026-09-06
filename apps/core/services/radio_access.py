"""Root Record Radio — member access, guest clock, personal skips, token hour.

Public listen is one shared program (live remux). Members may skip for themselves
and blacklist tracks. Guests get a short listen window, then pause for sign-in.
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.parse import unquote
from urllib.request import Request, urlopen

from apps.core import config

log = logging.getLogger("ava.radio.access")

STATE_NAME = "radio-access.json"
GUEST_LIMIT_S = 10 * 60
TOKEN_HOUR_COST = 1
TOP_UP_UNDER = 10
PORTAL_ME = "https://rootrecord-api-account.rootrecord.workers.dev/api/auth/me"
# Display / billing doors (public).
ACCOUNT_URL = "https://rootrecord.cloud/account"
TOP_UP_URL = "https://rootrecord.cloud/root-units"
BILLING_URL = "https://rootrecord.cloud/billing"

# Soft cache for /me
_me_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_ME_TTL = 120.0


def _path() -> Path:
    return config.DATA_DIR / "state" / STATE_NAME


def _default() -> dict[str, Any]:
    return {
        "guests": {},
        "members": {},
        "updated_at": 0,
    }


def load() -> dict[str, Any]:
    p = _path()
    if not p.is_file():
        return _default()
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return _default()
        out = _default()
        out["guests"] = data.get("guests") if isinstance(data.get("guests"), dict) else {}
        out["members"] = data.get("members") if isinstance(data.get("members"), dict) else {}
        return out
    except Exception:
        return _default()


def save(data: dict[str, Any]) -> dict[str, Any]:
    p = _path()
    p.parent.mkdir(parents=True, exist_ok=True)
    data = dict(data)
    data["updated_at"] = int(time.time())
    p.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    return data


def _truthy(v: Any) -> bool:
    if isinstance(v, bool):
        return v
    s = str(v or "").strip().lower()
    return s in ("1", "true", "yes", "on", "life", "lifetime", "active", "member")


def fetch_portal_me(token: str) -> dict[str, Any] | None:
    tok = unquote((token or "").strip())
    if len(tok) < 16:
        return None
    now = time.monotonic()
    hit = _me_cache.get(tok)
    if hit and now < hit[0]:
        return hit[1]
    try:
        req = Request(
            PORTAL_ME,
            headers={
                "Authorization": f"Bearer {tok}",
                "User-Agent": "AvaIvy-radio/1.0",
            },
            method="GET",
        )
        with urlopen(req, timeout=3.0) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
        data = json.loads(raw)
        if not isinstance(data, dict):
            return None
        _me_cache[tok] = (now + _ME_TTL, data)
        if len(_me_cache) > 400:
            for k in list(_me_cache.keys())[:80]:
                _me_cache.pop(k, None)
        return data
    except HTTPError as e:
        if int(getattr(e, "code", 0) or 0) in (401, 403):
            _me_cache[tok] = (now + 30.0, {"_auth": False})
        return None
    except Exception:
        return hit[1] if hit else None


def member_from_me(me: dict[str, Any] | None) -> dict[str, Any]:
    """Paid / lifetime member flag + display balance (whole Root Units)."""
    if not me or me.get("_auth") is False:
        return {
            "signed_in": False,
            "member": False,
            "lifetime": False,
            "account_id": "",
            "email": "",
            "balance": 0,
        }
    access = me.get("access") if isinstance(me.get("access"), dict) else {}
    raw = me.get("raw") if isinstance(me.get("raw"), dict) else {}
    raw_access = raw.get("access") if isinstance(raw.get("access"), dict) else {}
    tier = str(
        me.get("tier")
        or me.get("plan")
        or access.get("tier")
        or raw.get("tier")
        or raw_access.get("tier")
        or ""
    ).strip().lower()
    lifetime = (
        _truthy(me.get("life_member"))
        or _truthy(me.get("lifeMember"))
        or _truthy(me.get("lifetime_member"))
        or _truthy(me.get("lifetime"))
        or _truthy(access.get("life_member"))
        or _truthy(raw.get("life_member"))
        or _truthy(raw_access.get("life_member"))
        or tier in ("life", "lifetime")
    )
    sub = str(
        me.get("subscription_status")
        or access.get("subscription_status")
        or raw.get("subscription_status")
        or ""
    ).strip().lower()
    paid = lifetime or sub in ("active", "trialing", "paid", "member") or tier in (
        "monthly",
        "member",
        "pro",
        "life",
        "lifetime",
    )
    # Balance candidates — prefer whole units when values look like whole counts.
    bal = 0
    for key in (
        "root_units_balance",
        "ledger_balance",
        "balance",
        "root_units",
        "balance_display",
    ):
        for src in (me, access, raw):
            if not isinstance(src, dict):
                continue
            v = src.get(key)
            try:
                n = float(v)
            except Exception:
                continue
            if n >= 0:
                # Atomic Root Units are huge; if > 1e6 treat as atomic / 1e8
                if n > 1_000_000:
                    bal = int(n // 100_000_000)
                else:
                    bal = int(n)
                break
        if bal:
            break
    account_id = str(
        me.get("account_id") or me.get("id") or me.get("user_id") or me.get("sub") or ""
    ).strip()[:120]
    email = str(me.get("email") or "").strip()[:160]
    return {
        "signed_in": bool(email or account_id),
        "member": bool(paid and (email or account_id)),
        "lifetime": lifetime,
        "account_id": account_id or email or "",
        "email": email,
        "balance": max(0, bal),
    }


def resolve_identity(*, token: str = "", guest_id: str = "") -> dict[str, Any]:
    me = fetch_portal_me(token) if token else None
    info = member_from_me(me)
    info["guest_id"] = (guest_id or "")[:80]
    return info


def member_row(account_id: str) -> dict[str, Any]:
    data = load()
    rows = data.setdefault("members", {})
    row = rows.get(account_id)
    if not isinstance(row, dict):
        row = {
            "skip": [],
            "radio_tokens_spent": 0,
            "listen_seconds": 0,
            "hour_bucket": "",
            "updated_at": 0,
        }
        rows[account_id] = row
        save(data)
    row.setdefault("skip", [])
    row.setdefault("radio_tokens_spent", 0)
    row.setdefault("listen_seconds", 0)
    row.setdefault("hour_bucket", "")
    return row


def blacklist_track(account_id: str, track_id: str) -> dict[str, Any]:
    track_id = (track_id or "").strip().replace("\\", "/")[:500]
    if not account_id or not track_id or ".." in track_id:
        return {"ok": False, "detail": "bad request"}
    data = load()
    rows = data.setdefault("members", {})
    row = rows.setdefault(
        account_id,
        {"skip": [], "radio_tokens_spent": 0, "listen_seconds": 0, "hour_bucket": ""},
    )
    skips = list(row.get("skip") or [])
    if track_id not in skips:
        skips.append(track_id)
    # Cap list
    row["skip"] = skips[-200:]
    row["updated_at"] = int(time.time())
    rows[account_id] = row
    save(data)
    return {"ok": True, "skip": row["skip"], "id": track_id}


def is_blacklisted(account_id: str, track_id: str) -> bool:
    if not account_id or not track_id:
        return False
    data = load()
    row = (data.get("members") or {}).get(account_id) or {}
    skips = row.get("skip") or []
    return track_id in skips


def guest_tick(guest_id: str, *, seconds: float = 5.0) -> dict[str, Any]:
    gid = (guest_id or "").strip()[:80]
    if not gid:
        return {"ok": False, "detail": "missing guest", "remaining_s": 0, "allowed": False}
    data = load()
    guests = data.setdefault("guests", {})
    row = guests.get(gid) if isinstance(guests.get(gid), dict) else None
    now = int(time.time())
    if not row:
        row = {"started_at": now, "heard_s": 0.0, "updated_at": now}
    row["heard_s"] = float(row.get("heard_s") or 0) + max(0.0, float(seconds))
    row["updated_at"] = now
    guests[gid] = row
    # Prune old guests
    if len(guests) > 2000:
        items = sorted(guests.items(), key=lambda kv: int((kv[1] or {}).get("updated_at") or 0))
        for k, _ in items[:500]:
            guests.pop(k, None)
    save(data)
    heard = float(row["heard_s"])
    remaining = max(0, int(GUEST_LIMIT_S - heard))
    return {
        "ok": True,
        "allowed": heard < GUEST_LIMIT_S,
        "heard_s": int(heard),
        "remaining_s": remaining,
        "limit_s": GUEST_LIMIT_S,
    }


def member_tick(account_id: str, *, balance: int, seconds: float = 5.0) -> dict[str, Any]:
    """Accumulate listen time; burn 1 token once per UTC hour of listening."""
    if not account_id:
        return {"ok": False, "detail": "missing member"}
    data = load()
    rows = data.setdefault("members", {})
    row = rows.setdefault(
        account_id,
        {"skip": [], "radio_tokens_spent": 0, "listen_seconds": 0, "hour_bucket": ""},
    )
    row["listen_seconds"] = float(row.get("listen_seconds") or 0) + max(0.0, float(seconds))
    bucket = time.strftime("%Y-%m-%dT%H", time.gmtime())
    spent = int(row.get("radio_tokens_spent") or 0)
    charged = False
    if row.get("hour_bucket") != bucket and float(seconds) > 0:
        # First tick in a new hour while listening → charge
        row["hour_bucket"] = bucket
        spent += TOKEN_HOUR_COST
        row["radio_tokens_spent"] = spent
        charged = True
    row["updated_at"] = int(time.time())
    rows[account_id] = row
    save(data)
    # Effective balance = portal balance minus radio spend tracked here
    # (until account worker owns the debit). Floor at 0.
    effective = max(0, int(balance) - spent)
    return {
        "ok": True,
        "allowed": True,
        "charged": charged,
        "token_cost_per_hour": TOKEN_HOUR_COST,
        "radio_tokens_spent": spent,
        "balance": effective,
        "portal_balance": int(balance),
        "top_up": effective < TOP_UP_UNDER,
        "top_up_url": TOP_UP_URL,
        "billing_url": BILLING_URL,
    }


def public_session_payload(identity: dict[str, Any]) -> dict[str, Any]:
    if identity.get("member"):
        row = member_row(identity["account_id"])
        spent = int(row.get("radio_tokens_spent") or 0)
        bal = max(0, int(identity.get("balance") or 0) - spent)
        return {
            "signed_in": True,
            "member": True,
            "lifetime": bool(identity.get("lifetime")),
            "email": identity.get("email") or "",
            "balance": bal,
            "top_up": bal < TOP_UP_UNDER,
            "top_up_url": TOP_UP_URL,
            "billing_url": BILLING_URL,
            "account_url": ACCOUNT_URL,
            "guest_limit_s": GUEST_LIMIT_S,
            "can_skip": True,
            "note_tokens": (
                "Members use 1 Root Unit per hour while listening. "
                "Monthly members receive 500 on renewal; lifetime includes 10,000 once plus 500 each month."
            ),
        }
    if identity.get("signed_in"):
        return {
            "signed_in": True,
            "member": False,
            "lifetime": False,
            "email": identity.get("email") or "",
            "balance": int(identity.get("balance") or 0),
            "top_up": False,
            "top_up_url": TOP_UP_URL,
            "billing_url": BILLING_URL,
            "account_url": ACCOUNT_URL,
            "guest_limit_s": GUEST_LIMIT_S,
            "can_skip": False,
            "need_membership": True,
        }
    return {
        "signed_in": False,
        "member": False,
        "lifetime": False,
        "email": "",
        "balance": 0,
        "top_up": False,
        "top_up_url": TOP_UP_URL,
        "billing_url": BILLING_URL,
        "account_url": ACCOUNT_URL,
        "guest_limit_s": GUEST_LIMIT_S,
        "can_skip": False,
    }

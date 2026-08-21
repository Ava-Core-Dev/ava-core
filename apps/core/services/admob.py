"""Google AdMob API — OAuth + network reports (desk / Ava).

Reuses the same OAuth client as AdSense; separate token + scopes.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

CLIENT_JSON = Path(
    os.environ.get(
        "GOOGLE_ADMOB_OAUTH_CLIENT_JSON",
        os.environ.get(
            "GOOGLE_ADSENSE_OAUTH_CLIENT_JSON",
            "/home/ava-core/ava/ava-core-v2/data/secrets/google-adsense-oauth-client.json",
        ),
    )
)
TOKEN_JSON = Path(
    os.environ.get(
        "GOOGLE_ADMOB_TOKEN_JSON",
        "/home/ava-core/ava/ava-core-v2/data/secrets/google-admob-token.json",
    )
)
SCOPES = [
    "https://www.googleapis.com/auth/admob.readonly",
]
AUTH_URI = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URI = "https://oauth2.googleapis.com/token"
DEFAULT_PUBLIC_REDIRECT = "https://ava-origin.rootmc.net/api/ops/admob/oauth/callback"
REDIRECT = os.environ.get("GOOGLE_ADMOB_REDIRECT_URI", DEFAULT_PUBLIC_REDIRECT).strip() or DEFAULT_PUBLIC_REDIRECT
if "127.0.0.1" in REDIRECT or "localhost" in REDIRECT:
    REDIRECT = DEFAULT_PUBLIC_REDIRECT

ADMOB_API = "https://admob.googleapis.com/v1"


def _load_client() -> dict[str, Any]:
    raw = json.loads(CLIENT_JSON.read_text(encoding="utf-8"))
    return raw.get("web") or raw.get("installed") or raw


def client_configured() -> bool:
    return CLIENT_JSON.is_file()


def token_present() -> bool:
    return TOKEN_JSON.is_file()


def recommended_redirect_uris() -> list[str]:
    return [DEFAULT_PUBLIC_REDIRECT]



def status() -> dict[str, Any]:
    out: dict[str, Any] = {
        "ok": True,
        "client_configured": client_configured(),
        "token_present": token_present(),
        "client_json": str(CLIENT_JSON),
        "token_json": str(TOKEN_JSON),
        "redirect_uri": REDIRECT,
        "recommended_redirect_uris": recommended_redirect_uris(),
        "scopes": SCOPES,
        "client_id_expected": "366072724921-baueoiiimj6rramekk6q7c3uq8k9pl5s.apps.googleusercontent.com",
        "note": (
            "Desk report OAuth only — not ad tags on public sites. "
            "Redirect URI: https://ava-origin.rootmc.net/api/ops/admob/oauth/callback "
            "(never localhost). Guide: docs/ADMOB-OAUTH.md"
        ),

    }
    if client_configured():
        c = _load_client()
        out["client_id"] = c.get("client_id")
    return out


def auth_url(state: str = "ava-admob", redirect_uri: str | None = None) -> str:
    c = _load_client()
    redir = redirect_uri or REDIRECT
    q = urlencode(
        {
            "client_id": c["client_id"],
            "redirect_uri": redir,
            "response_type": "code",
            "scope": " ".join(SCOPES),
            "access_type": "offline",
            "prompt": "consent",
            "state": state,
        }
    )
    return f"{AUTH_URI}?{q}"


def exchange_code(code: str, redirect_uri: str | None = None) -> dict[str, Any]:
    c = _load_client()
    redir = redirect_uri or REDIRECT
    body = urlencode(
        {
            "code": code,
            "client_id": c["client_id"],
            "client_secret": c["client_secret"],
            "redirect_uri": redir,
            "grant_type": "authorization_code",
        }
    ).encode()
    req = Request(
        TOKEN_URI,
        data=body,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urlopen(req, timeout=30) as r:
        tok = json.loads(r.read().decode())
    TOKEN_JSON.parent.mkdir(parents=True, exist_ok=True)
    TOKEN_JSON.write_text(json.dumps(tok, indent=2) + "\n", encoding="utf-8")
    os.chmod(TOKEN_JSON, 0o600)
    return {
        "ok": True,
        "token_saved": str(TOKEN_JSON),
        "has_refresh": bool(tok.get("refresh_token")),
        "redirect_uri_used": redir,
    }


def _refresh_if_needed(tok: dict[str, Any]) -> dict[str, Any]:
    refresh = tok.get("refresh_token")
    if not refresh:
        return tok
    c = _load_client()
    body = urlencode(
        {
            "client_id": c["client_id"],
            "client_secret": c["client_secret"],
            "refresh_token": refresh,
            "grant_type": "refresh_token",
        }
    ).encode()
    req = Request(
        TOKEN_URI,
        data=body,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urlopen(req, timeout=30) as r:
        fresh = json.loads(r.read().decode())
    if "refresh_token" not in fresh and refresh:
        fresh["refresh_token"] = refresh
    TOKEN_JSON.write_text(json.dumps(fresh, indent=2) + "\n", encoding="utf-8")
    return fresh


def access_token() -> str:
    tok = json.loads(TOKEN_JSON.read_text(encoding="utf-8"))
    tok = _refresh_if_needed(tok)
    return tok["access_token"]


def api_get(path: str) -> dict[str, Any]:
    url = f"{ADMOB_API}/{path.lstrip('/')}"
    req = Request(url, headers={"Authorization": f"Bearer {access_token()}"})
    with urlopen(req, timeout=45) as r:
        return json.loads(r.read().decode())


def api_post(path: str, body: dict[str, Any]) -> Any:
    url = f"{ADMOB_API}/{path.lstrip('/')}"
    data = json.dumps(body).encode()
    req = Request(
        url,
        data=data,
        method="POST",
        headers={
            "Authorization": f"Bearer {access_token()}",
            "Content-Type": "application/json",
        },
    )
    with urlopen(req, timeout=60) as r:
        raw = r.read().decode()
    # networkReport:generate returns a JSON array of streamed objects
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return raw


def accounts_summary() -> dict[str, Any]:
    if not token_present():
        return {
            "ok": False,
            "detail": "Not authorized yet — connect AdMob from /ops (see docs/ADMOB-OAUTH.md).",
        }
    return {"ok": True, "accounts": api_get("accounts")}


def _account_name(accounts_payload: dict[str, Any] | None = None) -> str:
    forced = os.environ.get("GOOGLE_ADMOB_ACCOUNT_NAME", "").strip()
    if forced:
        return forced if forced.startswith("accounts/") else f"accounts/{forced}"
    payload = accounts_payload or api_get("accounts")
    rows = payload.get("account") or payload.get("accounts") or []
    if isinstance(rows, dict):
        rows = [rows]
    if not rows:
        raise RuntimeError("No AdMob accounts on this Google login")
    name = str(rows[0].get("name") or "")
    if not name:
        raise RuntimeError("AdMob account missing name")
    return name


def generate_network_report(
    *,
    start: tuple[int, int, int],
    end: tuple[int, int, int],
    account_name: str | None = None,
) -> list[dict[str, Any]]:
    acct = account_name or _account_name()
    sy, sm, sd = start
    ey, em, ed = end
    body = {
        "reportSpec": {
            "dateRange": {
                "startDate": {"year": sy, "month": sm, "day": sd},
                "endDate": {"year": ey, "month": em, "day": ed},
            },
            "dimensions": ["DATE"],
            "metrics": [
                "ESTIMATED_EARNINGS",
                "IMPRESSIONS",
                "CLICKS",
                "AD_REQUESTS",
                "MATCHED_REQUESTS",
            ],
            "sortConditions": [{"dimension": "DATE", "order": "ASCENDING"}],
        }
    }
    result = api_post(f"{acct}/networkReport:generate", body)
    if isinstance(result, list):
        return result
    if isinstance(result, dict):
        return [result]
    return []


def _metric_micros_to_display(row: dict[str, Any], key: str) -> str:
    metrics = row.get("metricValues") or {}
    cell = metrics.get(key) or {}
    if "microsValue" in cell:
        try:
            return f"{int(cell['microsValue']) / 1_000_000:.4f}"
        except (TypeError, ValueError):
            return str(cell.get("microsValue"))
    if "integerValue" in cell:
        return str(cell["integerValue"])
    if "doubleValue" in cell:
        return str(cell["doubleValue"])
    return "—"


def parse_network_stream(stream: list[dict[str, Any]]) -> dict[str, Any]:
    rows_out: list[dict[str, Any]] = []
    totals: dict[str, str] = {}
    for item in stream:
        if "row" in item:
            row = item["row"]
            dims = row.get("dimensionValues") or {}
            date = (dims.get("DATE") or {}).get("value") or "?"
            rows_out.append(
                {
                    "DATE": date,
                    "ESTIMATED_EARNINGS": _metric_micros_to_display(row, "ESTIMATED_EARNINGS"),
                    "IMPRESSIONS": _metric_micros_to_display(row, "IMPRESSIONS"),
                    "CLICKS": _metric_micros_to_display(row, "CLICKS"),
                    "AD_REQUESTS": _metric_micros_to_display(row, "AD_REQUESTS"),
                    "MATCHED_REQUESTS": _metric_micros_to_display(row, "MATCHED_REQUESTS"),
                }
            )
        if "total" in item:
            tot = item["total"]
            totals = {
                "ESTIMATED_EARNINGS": _metric_micros_to_display(tot, "ESTIMATED_EARNINGS"),
                "IMPRESSIONS": _metric_micros_to_display(tot, "IMPRESSIONS"),
                "CLICKS": _metric_micros_to_display(tot, "CLICKS"),
                "AD_REQUESTS": _metric_micros_to_display(tot, "AD_REQUESTS"),
                "MATCHED_REQUESTS": _metric_micros_to_display(tot, "MATCHED_REQUESTS"),
            }
    return {"rows": rows_out, "totals": totals}


def daily_snapshot(*, days: int = 7) -> dict[str, Any]:
    from datetime import datetime, timedelta
    from zoneinfo import ZoneInfo

    if not token_present():
        return {
            "ok": False,
            "detail": "AdMob OAuth not connected — open http://127.0.0.1:8787/ops → Connect AdMob",
        }
    try:
        hst = ZoneInfo("Pacific/Honolulu")
        end = datetime.now(hst).date()
        start = end - timedelta(days=max(0, days - 1))
        accounts = api_get("accounts")
        acct = _account_name(accounts)
        stream = generate_network_report(
            start=(start.year, start.month, start.day),
            end=(end.year, end.month, end.day),
            account_name=acct,
        )
        parsed = parse_network_stream(stream)
        return {
            "ok": True,
            "account": acct,
            "start": start.isoformat(),
            "end": end.isoformat(),
            "report": parsed,
        }
    except Exception as e:
        return {"ok": False, "detail": str(e)[:500]}


def format_discord(snap: dict[str, Any], *, label: str) -> str:
    if not snap.get("ok"):
        return (
            f"**AdMob report — {label}**\n"
            f"⚠️ `{snap.get('detail') or 'unavailable'}`\n"
            f"_Connect once at http://127.0.0.1:8787/ops → Connect AdMob._\n"
            f"_Guide: docs/ADMOB-OAUTH.md_"
        )
    report = snap.get("report") or {}
    totals = report.get("totals") or {}
    rows = report.get("rows") or []
    lines = [
        f"**AdMob report — {label}**",
        f"Account: `{snap.get('account')}` · {snap.get('start')} → {snap.get('end')}",
        (
            f"Est. earnings: **{totals.get('ESTIMATED_EARNINGS', '—')}** · "
            f"Impressions: **{totals.get('IMPRESSIONS', '—')}** · "
            f"Clicks: **{totals.get('CLICKS', '—')}**"
        ),
        (
            f"Ad requests: **{totals.get('AD_REQUESTS', '—')}** · "
            f"Matched: **{totals.get('MATCHED_REQUESTS', '—')}**"
        ),
    ]
    for row in rows[-3:]:
        lines.append(
            f"· {row.get('DATE')}: {row.get('ESTIMATED_EARNINGS')} · "
            f"{row.get('IMPRESSIONS')} imps"
        )
    return "\n".join(lines)

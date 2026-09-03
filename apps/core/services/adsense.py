"""Google AdSense Management API — OAuth + account summary (desk / Ava)."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

_SECRETS = Path.home() / "Ava" / "Data" / "secrets"
CLIENT_JSON = Path(
    os.environ.get(
        "GOOGLE_ADSENSE_OAUTH_CLIENT_JSON",
        str(_SECRETS / "google-adsense-oauth-client.json"),
    )
)
TOKEN_JSON = Path(
    os.environ.get(
        "GOOGLE_ADSENSE_TOKEN_JSON",
        str(_SECRETS / "google-adsense-token.json"),
    )
)
# Full scope so Ava can read reports and manage inventory when needed.
SCOPES = [
    "https://www.googleapis.com/auth/adsense",
]
AUTH_URI = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URI = "https://oauth2.googleapis.com/token"

# Ops is localhost only. Do not publish /ops. Do not use *.rootmc.net for Ava.
DEFAULT_PUBLIC_REDIRECT = "http://127.0.0.1:8787/api/ops/adsense/oauth/callback"
REDIRECT = os.environ.get("GOOGLE_ADSENSE_REDIRECT_URI", DEFAULT_PUBLIC_REDIRECT).strip() or DEFAULT_PUBLIC_REDIRECT



def _load_client() -> dict[str, Any]:
    raw = json.loads(CLIENT_JSON.read_text(encoding="utf-8"))
    return raw.get("web") or raw.get("installed") or raw


def client_configured() -> bool:
    return CLIENT_JSON.is_file()


def token_present() -> bool:
    return TOKEN_JSON.is_file()


def recommended_redirect_uris() -> list[str]:
    """Paste these into Google Cloud Console → Credentials → OAuth client."""
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
        "note": (
            "Desk report OAuth only — not ad tags on public sites. "
            "Redirect URI is http://127.0.0.1:8787/api/ops/adsense/oauth/callback "
            "(localhost only; do not publish /ops; do not use *.rootmc.net)."
        ),

    }
    if client_configured():
        c = _load_client()
        out["client_id"] = c.get("client_id")
        out["redirect_uris_in_file"] = c.get("redirect_uris") or []
    return out


def auth_url(state: str = "ava-adsense", redirect_uri: str | None = None) -> str:
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
    url = f"https://adsense.googleapis.com/v2/{path.lstrip('/')}"
    req = Request(url, headers={"Authorization": f"Bearer {access_token()}"})
    with urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def accounts_summary() -> dict[str, Any]:
    if not token_present():
        return {
            "ok": False,
            "detail": "Not authorized yet — connect AdSense from /ops or the auth_url.",
        }
    accounts = api_get("accounts")
    return {"ok": True, "accounts": accounts}


def _account_name(accounts_payload: dict[str, Any] | None = None) -> str:
    """Return accounts/pub-… name for report calls."""
    forced = os.environ.get("GOOGLE_ADSENSE_ACCOUNT_NAME", "").strip()
    if forced:
        return forced if forced.startswith("accounts/") else f"accounts/{forced}"
    payload = accounts_payload or api_get("accounts")
    rows = payload.get("accounts") or []
    if not rows:
        raise RuntimeError("No AdSense accounts on this Google login")
    name = str(rows[0].get("name") or "")
    if not name:
        raise RuntimeError("AdSense account missing name field")
    return name


def generate_report(
    *,
    start: tuple[int, int, int],
    end: tuple[int, int, int],
    metrics: list[str] | None = None,
    dimensions: list[str] | None = None,
    account_name: str | None = None,
) -> dict[str, Any]:
    """GET accounts.reports.generate for a CUSTOM date range (inclusive)."""
    acct = account_name or _account_name()
    metrics = metrics or [
        "PAGE_VIEWS",
        "CLICKS",
        "ESTIMATED_EARNINGS",
        "PAGE_VIEWS_RPM",
        "IMPRESSIONS",
    ]
    dimensions = dimensions or ["DATE"]
    sy, sm, sd = start
    ey, em, ed = end
    q = urlencode(
        [
            ("dateRange", "CUSTOM"),
            ("startDate.year", str(sy)),
            ("startDate.month", str(sm)),
            ("startDate.day", str(sd)),
            ("endDate.year", str(ey)),
            ("endDate.month", str(em)),
            ("endDate.day", str(ed)),
            *[("metrics", m) for m in metrics],
            *[("dimensions", d) for d in dimensions],
            ("orderBy", "+DATE"),
            ("currencyCode", os.environ.get("GOOGLE_ADSENSE_CURRENCY", "USD")),
        ]
    )
    return api_get(f"{acct}/reports:generate?{q}")


def _cell_map(headers: list[dict], row: dict) -> dict[str, str]:
    cells = row.get("cells") or []
    out: dict[str, str] = {}
    for i, h in enumerate(headers):
        name = str(h.get("name") or h.get("type") or f"c{i}")
        val = ""
        if i < len(cells):
            val = str(cells[i].get("value") if isinstance(cells[i], dict) else cells[i] or "")
        out[name] = val
    return out


def parse_report(report: dict[str, Any]) -> dict[str, Any]:
    headers = report.get("headers") or []
    rows_out = []
    for row in report.get("rows") or []:
        rows_out.append(_cell_map(headers, row))
    totals = {}
    if report.get("totals"):
        totals = _cell_map(headers, report["totals"])
    return {
        "headers": [h.get("name") for h in headers],
        "rows": rows_out,
        "totals": totals,
        "warnings": report.get("warnings") or [],
    }


def daily_snapshot(*, days: int = 7) -> dict[str, Any]:
    """Pull last N days of earnings (HST calendar). Needs OAuth token on desk."""
    from datetime import datetime, timedelta
    from zoneinfo import ZoneInfo

    if not token_present():
        return {
            "ok": False,
            "detail": "AdSense OAuth not connected — open http://127.0.0.1:8787/ops → Connect AdSense",
        }
    try:
        hst = ZoneInfo("Pacific/Honolulu")
        end = datetime.now(hst).date()
        start = end - timedelta(days=max(0, days - 1))
        accounts = api_get("accounts")
        acct = _account_name(accounts)
        raw = generate_report(
            start=(start.year, start.month, start.day),
            end=(end.year, end.month, end.day),
            account_name=acct,
        )
        parsed = parse_report(raw)
        currency = os.environ.get("GOOGLE_ADSENSE_CURRENCY", "USD")
        for h in raw.get("headers") or []:
            if h.get("currencyCode"):
                currency = str(h["currencyCode"])
                break
        return {
            "ok": True,
            "account": acct,
            "start": start.isoformat(),
            "end": end.isoformat(),
            "report": parsed,
            "currency": currency,
        }
    except Exception as e:
        return {"ok": False, "detail": str(e)[:500]}


def format_discord(snap: dict[str, Any], *, label: str) -> str:
    """Compact Discord markdown for boot / EOD AdSense posts."""
    if not snap.get("ok"):
        return (
            f"**AdSense report — {label}**\n"
            f"⚠️ `{snap.get('detail') or 'unavailable'}`\n"
            f"_Connect once at http://127.0.0.1:8787/ops → Connect AdSense._"
        )
    report = snap.get("report") or {}
    totals = report.get("totals") or {}
    rows = report.get("rows") or []
    earn = totals.get("ESTIMATED_EARNINGS") or totals.get("TOTAL_EARNINGS") or "—"
    views = totals.get("PAGE_VIEWS") or "—"
    clicks = totals.get("CLICKS") or "—"
    rpm = totals.get("PAGE_VIEWS_RPM") or "—"
    imps = totals.get("IMPRESSIONS") or "—"
    lines = [
        f"**AdSense report — {label}**",
        f"Account: `{snap.get('account')}` · {snap.get('start')} → {snap.get('end')}",
        f"Est. earnings: **{earn}** · Page views: **{views}** · Clicks: **{clicks}**",
        f"RPM: **{rpm}** · Impressions: **{imps}**",
    ]
    # Last up to 3 day rows
    for row in rows[-3:]:
        d = row.get("DATE") or "?"
        e = row.get("ESTIMATED_EARNINGS") or "0"
        v = row.get("PAGE_VIEWS") or "0"
        lines.append(f"· {d}: {e} · {v} views")
    return "\n".join(lines)

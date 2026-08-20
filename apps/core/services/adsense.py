"""Google AdSense Management API — local OAuth + account summary (ops only)."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

CLIENT_JSON = Path(
    os.environ.get(
        "GOOGLE_ADSENSE_OAUTH_CLIENT_JSON",
        "/home/ava-core/ava/ava-core-v2/data/secrets/google-adsense-oauth-client.json",
    )
)
TOKEN_JSON = Path(
    os.environ.get(
        "GOOGLE_ADSENSE_TOKEN_JSON",
        "/home/ava-core/ava/ava-core-v2/data/secrets/google-adsense-token.json",
    )
)
SCOPES = ["https://www.googleapis.com/auth/adsense.readonly"]
AUTH_URI = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URI = "https://oauth2.googleapis.com/token"
REDIRECT = os.environ.get(
    "GOOGLE_ADSENSE_REDIRECT_URI",
    "http://127.0.0.1:8787/api/ops/adsense/oauth/callback",
)


def _load_client() -> dict[str, Any]:
    raw = json.loads(CLIENT_JSON.read_text(encoding="utf-8"))
    return raw.get("installed") or raw.get("web") or raw


def client_configured() -> bool:
    return CLIENT_JSON.is_file()


def token_present() -> bool:
    return TOKEN_JSON.is_file()


def status() -> dict[str, Any]:
    out: dict[str, Any] = {
        "ok": True,
        "client_configured": client_configured(),
        "token_present": token_present(),
        "client_json": str(CLIENT_JSON),
        "token_json": str(TOKEN_JSON),
        "redirect_uri": REDIRECT,
        "scopes": SCOPES,
    }
    if client_configured():
        c = _load_client()
        out["client_id"] = c.get("client_id")
        out["redirect_uris_in_file"] = c.get("redirect_uris") or []
    return out


def auth_url(state: str = "ava-adsense") -> str:
    c = _load_client()
    q = urlencode(
        {
            "client_id": c["client_id"],
            "redirect_uri": REDIRECT,
            "response_type": "code",
            "scope": " ".join(SCOPES),
            "access_type": "offline",
            "prompt": "consent",
            "state": state,
        }
    )
    return f"{AUTH_URI}?{q}"


def exchange_code(code: str) -> dict[str, Any]:
    c = _load_client()
    body = urlencode(
        {
            "code": code,
            "client_id": c["client_id"],
            "client_secret": c["client_secret"],
            "redirect_uri": REDIRECT,
            "grant_type": "authorization_code",
        }
    ).encode()
    req = Request(TOKEN_URI, data=body, method="POST", headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urlopen(req, timeout=30) as r:
        tok = json.loads(r.read().decode())
    TOKEN_JSON.parent.mkdir(parents=True, exist_ok=True)
    TOKEN_JSON.write_text(json.dumps(tok, indent=2) + "\n", encoding="utf-8")
    os.chmod(TOKEN_JSON, 0o600)
    return {"ok": True, "token_saved": str(TOKEN_JSON), "has_refresh": bool(tok.get("refresh_token"))}


def _refresh_if_needed(tok: dict[str, Any]) -> dict[str, Any]:
    # Always refresh when we have a refresh_token so ops calls stay simple.
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
    req = Request(TOKEN_URI, data=body, method="POST", headers={"Content-Type": "application/x-www-form-urlencoded"})
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
        return {"ok": False, "detail": "Not authorized yet — open the AdSense connect link on /ops."}
    accounts = api_get("accounts")
    return {"ok": True, "accounts": accounts}

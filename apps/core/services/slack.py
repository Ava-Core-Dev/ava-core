"""Slack Web API — replies only. Never delete history."""
from __future__ import annotations

import logging
from typing import Any

import httpx

from .. import config

log = logging.getLogger("ava.slack")
API = "https://slack.com/api"


def _token() -> str:
    return (config.slack_bot_token() or "").strip()


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {_token()}",
        "Content-Type": "application/json; charset=utf-8",
    }


async def api(method: str, payload: dict[str, Any] | None = None, *, params: dict | None = None) -> dict:
    if not _token():
        return {"ok": False, "error": "no_token"}
    async with httpx.AsyncClient(timeout=20) as client:
        if payload is None:
            r = await client.get(f"{API}/{method}", headers=_headers(), params=params or {})
        else:
            r = await client.post(f"{API}/{method}", headers=_headers(), json=payload)
    try:
        data = r.json()
    except Exception:
        return {"ok": False, "error": f"http_{r.status_code}"}
    return data if isinstance(data, dict) else {"ok": False}


async def auth_test() -> dict:
    return await api("auth.test", {})


async def post_message(channel: str, text: str) -> dict:
    return await api(
        "chat.postMessage",
        {"channel": channel, "text": text[:3500], "unfurl_links": False},
    )


async def history(channel: str, *, limit: int = 12) -> list[dict]:
    data = await api("conversations.history", params={"channel": channel, "limit": str(limit)})
    if not data.get("ok"):
        return []
    return list(data.get("messages") or [])

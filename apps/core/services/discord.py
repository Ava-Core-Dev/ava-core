"""Discord REST helpers — ported from discordApi.mjs."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

from .. import config

log = logging.getLogger("ava.discord")

_SPLIT_MAX = 1900


def _auth_headers() -> dict[str, str]:
    token = config.discord_bot_token()
    if not token:
        return {
            "Authorization": "",
            "Content-Type": "application/json; charset=utf-8",
            "User-Agent": "AvaIvyRootMC (rootmc.net, 2.0)",
        }
    return {
        "Authorization": f"Bot {token}",
        "Content-Type": "application/json; charset=utf-8",
        "User-Agent": "AvaIvyRootMC (rootmc.net, 2.0)",
    }


def _split_content(text: str) -> list[str]:
    """Split long content on paragraph boundaries, keeping each part under _SPLIT_MAX chars."""
    if len(text) <= _SPLIT_MAX:
        return [text]
    parts, buf = [], ""
    for line in text.splitlines(keepends=True):
        if len(buf) + len(line) > _SPLIT_MAX:
            if buf:
                parts.append(buf.rstrip())
            buf = line
        else:
            buf += line
    if buf.strip():
        parts.append(buf.rstrip())
    return parts or [text[:_SPLIT_MAX]]


async def post_message(channel_id: str, content: str, ref_id: str | None = None) -> dict | None:
    """Post one or more Discord messages. Splits long content automatically."""
    if not config.discord_bot_token():
        log.info("Discord post skipped (no bot token)")
        return None
    raw = str(content or "").strip()
    if not raw:
        return None
    parts = _split_content(raw)
    first = None
    async with httpx.AsyncClient(timeout=15) as client:
        for i, part in enumerate(parts):
            body: dict[str, Any] = {
                "content": part[:2000],
                "allowed_mentions": {"parse": []},
            }
            if i == 0 and ref_id:
                body["message_reference"] = {"message_id": str(ref_id)}
            r = await client.post(
                f"{config.DISCORD_API}/channels/{channel_id}/messages",
                headers=_auth_headers(), json=body,
            )
            if r.status_code not in (200, 201):
                log.error("Discord post failed  ch=%s  status=%s  body=%s",
                          channel_id, r.status_code, r.text[:200])
                return None
            if first is None:
                first = r.json()
            if i < len(parts) - 1:
                await asyncio.sleep(0.35)
    return first


async def pin_message(channel_id: str, message_id: str) -> bool:
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.put(
            f"{config.DISCORD_API}/channels/{channel_id}/pins/{message_id}",
            headers=_auth_headers(),
        )
    if r.status_code not in (200, 204):
        log.error("Discord pin failed  ch=%s  msg=%s  status=%s  body=%s",
                  channel_id, message_id, r.status_code, r.text[:200])
        return False
    return True


async def forward_message(
    dest_channel_id: str,
    source_channel_id: str,
    message_id: str,
) -> dict | None:
    """Native Discord forward (message_reference type 1). Falls back to None on failure."""
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            f"{config.DISCORD_API}/channels/{dest_channel_id}/messages",
            headers=_auth_headers(),
            json={
                "message_reference": {
                    "type": 1,
                    "message_id": str(message_id),
                    "channel_id": str(source_channel_id),
                },
                "allowed_mentions": {"parse": []},
            },
        )
    if r.status_code not in (200, 201):
        log.warning("Discord forward failed  dest=%s  status=%s  body=%s",
                    dest_channel_id, r.status_code, r.text[:200])
        return None
    return r.json()


_missing_channels: set[str] = set()


async def get_messages(channel_id: str, limit: int = 50) -> list[dict]:
    cid = str(channel_id or "")
    if not cid or cid in _missing_channels:
        return []
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(
            f"{config.DISCORD_API}/channels/{cid}/messages?limit={limit}",
            headers=_auth_headers(),
        )
    if r.status_code == 404:
        _missing_channels.add(cid)
        log.warning("Discord channel missing — skipping further polls  ch=%s", cid)
        return []
    if r.status_code != 200:
        log.error("Discord fetch failed  ch=%s  status=%s", cid, r.status_code)
        return []
    return r.json()


async def send_dm(user_id: str, content: str) -> dict | None:
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            f"{config.DISCORD_API}/users/@me/channels",
            headers=_auth_headers(), json={"recipient_id": str(user_id)},
        )
    if r.status_code not in (200, 201):
        log.error("DM channel create failed: %s", r.text[:200])
        return None
    ch = r.json()
    return await post_message(ch["id"], content)


async def get_me() -> dict | None:
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(f"{config.DISCORD_API}/users/@me", headers=_auth_headers())
    if r.status_code != 200:
        log.warning("Discord /users/@me failed: %s", r.status_code)
        return None
    return r.json()


async def list_private_channels() -> list[dict]:
    """DM / group-DM channels the bot already has open."""
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(
            f"{config.DISCORD_API}/users/@me/channels",
            headers=_auth_headers(),
        )
    if r.status_code != 200:
        log.debug("Discord private channels: %s", r.status_code)
        return []
    data = r.json()
    return data if isinstance(data, list) else []

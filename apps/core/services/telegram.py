"""Telegram Bot API helpers for public report DMs + /subscribe."""
from __future__ import annotations

import logging
from typing import Any

import httpx

from .. import config

log = logging.getLogger("ava.telegram")


def _base() -> str:
    token = config.telegram_bot_token()
    return f"https://api.telegram.org/bot{token}" if token else ""


async def send_message(
    chat_id: str | int,
    text: str,
    *,
    question: str = "",
    source: str = "",
) -> dict | None:
    if not _base() or not str(chat_id).strip() or not str(text or "").strip():
        return None
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(
            f"{_base()}/sendMessage",
            json={
                "chat_id": str(chat_id),
                "text": str(text)[:3900],
                "disable_web_page_preview": True,
            },
        )
    body = {}
    try:
        body = r.json()
    except Exception:
        body = {}
    if r.status_code >= 400 or not body.get("ok"):
        log.warning("Telegram send failed chat=%s: %s", chat_id, str(body)[:200])
        return None
    result = body.get("result")
    if isinstance(result, dict) and result.get("message_id") is not None:
        try:
            from apps.core.services import reply_feedback

            q = str(question or "").strip()
            if not q:
                q = reply_feedback.guess_question_for_chat(chat_id)
            reply_feedback.note_outbound(
                surface="telegram",
                chat_id=chat_id,
                message_id=result.get("message_id"),
                answer=str(text)[:3900],
                question=q,
                source=source or "telegram_send",
            )
        except Exception as e:
            log.debug("outbound register: %s", e)
    return result


async def get_me() -> dict:
    if not _base():
        return {}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(f"{_base()}/getMe")
        body = r.json()
        if body.get("ok") and isinstance(body.get("result"), dict):
            return body["result"]
    except Exception as e:
        log.debug("Telegram getMe: %s", e)
    return {}


async def get_updates(offset: int | None = None, timeout: int = 20) -> list[dict[str, Any]]:
    if not _base():
        return []
    payload: dict[str, Any] = {
        "timeout": timeout,
        # message_reaction: thumbs-up etc. on Ava lines (incl. Cursor-sent)
        "allowed_updates": ["message", "message_reaction"],
    }
    if offset:
        payload["offset"] = offset
    try:
        async with httpx.AsyncClient(timeout=timeout + 10) as client:
            r = await client.post(f"{_base()}/getUpdates", json=payload)
        body = r.json()
        if body.get("ok"):
            return list(body.get("result") or [])
        log.warning("Telegram getUpdates: %s", str(body)[:200])
    except Exception as e:
        log.debug("Telegram getUpdates: %s", e)
    return []

"""Durable inbound message audit records shared by chat adapters."""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from apps.core import config


def append_inbound(
    *,
    surface: str,
    chat_id: str,
    chat_type: str,
    sender_id: str,
    username: str = "",
    first_name: str = "",
    last_name: str = "",
    message_id: str | int | None = None,
    text: str = "",
    media_kind: str = "",
) -> None:
    record: dict[str, Any] = {
        "at": int(time.time() * 1000),
        "surface": surface,
        "chatId": str(chat_id),
        "chatType": chat_type,
        "isDm": chat_type in {"private", "dm", "im"},
        "senderId": str(sender_id),
        "username": username,
        "firstName": first_name,
        "lastName": last_name,
        "messageId": str(message_id) if message_id is not None else None,
        "text": str(text or "")[:4000],
        "mediaKind": media_kind,
    }
    path = config.DATA_DIR / "logs" / "messages-inbound.jsonl"
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception:
        pass
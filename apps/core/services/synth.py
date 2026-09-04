"""Write a public report: Grok → local Ollama → facts. Cursor is last-resort queue.

Ollama on this desk keeps mornings alive when xAI/Cursor credits are gone.
"""

from __future__ import annotations

import hashlib
import logging

from . import cursor_fallback, xai

log = logging.getLogger("ava.synth")


def source_hash(*parts: str) -> str:
    blob = "\n".join(parts).encode()
    return hashlib.sha256(blob).hexdigest()[:16]


def polish_ex(
    kind: str, system: str, user: str, *, factual: str, channel: str | None = None
) -> dict:
    """Grok if credits exist, else local Ollama, else facts. Cursor is optional queue.

    engine=factual is the short/offline stub path — callers must NOT add a clock stamp.
    engine=grok|ollama are full report paths — timestamps are allowed.
    """
    h = source_hash(kind, user)
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    grok = xai.try_chat(messages, max_tokens=400)
    if grok:
        return {"text": grok, "engine": "grok", "include_timestamp": True}
    from . import ollama as ollama_svc
    from apps.core import config

    local = ollama_svc.chat_sync(messages, model=config.OLLAMA_MODEL, timeout=90)
    if local and local.strip():
        log.info("%s: Grok missed — used local Ollama", kind)
        return {
            "text": local.strip(),
            "engine": "ollama",
            "include_timestamp": True,
        }
    cursor_fallback.enqueue(kind, system, user, source_hash=h, channel=channel)
    log.info("%s: Grok and Ollama missed — queued Cursor, posting facts now", kind)
    return {"text": factual, "engine": "factual", "include_timestamp": False}


def polish(kind: str, system: str, user: str, *, factual: str, channel: str | None = None) -> str:
    """Grok if credits exist, else local Ollama, else facts. Cursor is optional queue."""
    return polish_ex(kind, system, user, factual=factual, channel=channel)["text"]

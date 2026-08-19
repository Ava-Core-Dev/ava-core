"""Ollama local brain client (Qwen3 / ava-ivy model)."""

from __future__ import annotations

import logging

import httpx

from .. import config

log = logging.getLogger("ava.ollama")


async def chat(messages: list[dict], *, model: str | None = None,
               timeout: int = 20) -> str | None:
    """Returns reply string or None if Ollama is unavailable."""
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.post(
                f"{config.OLLAMA_URL}/api/chat",
                json={"model": model or config.OLLAMA_MODEL,
                      "messages": messages, "stream": False},
            )
        if r.status_code == 200:
            return r.json().get("message", {}).get("content", "")
        log.debug("Ollama status %s", r.status_code)
        return None
    except Exception as e:
        log.debug("Ollama unavailable: %s", e)
        return None


async def is_available() -> bool:
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"{config.OLLAMA_URL}/api/tags")
        return r.status_code == 200
    except Exception:
        return False

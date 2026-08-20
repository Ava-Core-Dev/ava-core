"""Ollama local brain client (Qwen3 / ava-ivy model)."""

from __future__ import annotations

import logging
import time

import httpx

from .. import config

log = logging.getLogger("ava.ollama")

# /api/activity is polled every 2s from the GUI; do not hit Ollama that often.
_TAGS_TTL_S = 30.0
_tags_cache: tuple[float, bool, list[str]] = (0.0, False, [])


def _payload(messages: list[dict], model: str | None) -> dict:
    return {
        "model": model or config.OLLAMA_MODEL,
        "messages": messages,
        "stream": False,
        "think": False,
    }


def chat_sync(messages: list[dict], *, model: str | None = None, timeout: int = 90) -> str | None:
    """Blocking Ollama chat for crons. Prefer qwen3:8b if rewriting long reports."""
    try:
        r = httpx.post(
            f"{config.OLLAMA_URL}/api/chat",
            json=_payload(messages, model),
            timeout=timeout,
        )
        if r.status_code == 200:
            return (r.json().get("message") or {}).get("content") or None
        log.debug("Ollama sync status %s", r.status_code)
        return None
    except Exception as e:
        log.debug("Ollama sync unavailable: %s", e)
        return None


async def chat(messages: list[dict], *, model: str | None = None,
               timeout: int = 20) -> str | None:
    """Returns reply string or None if Ollama is unavailable."""
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.post(
                f"{config.OLLAMA_URL}/api/chat",
                json=_payload(messages, model),
            )
        if r.status_code == 200:
            return r.json().get("message", {}).get("content", "")
        log.debug("Ollama status %s", r.status_code)
        return None
    except Exception as e:
        log.debug("Ollama unavailable: %s", e)
        return None


async def tags(force: bool = False) -> tuple[bool, list[str]]:
    """Cached GET /api/tags. Returns (up, model_names)."""
    global _tags_cache
    ts, up, models = _tags_cache
    if not force and (time.monotonic() - ts) < _TAGS_TTL_S:
        return up, models
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            r = await client.get(f"{config.OLLAMA_URL}/api/tags")
        ok = r.status_code == 200
        names: list[str] = []
        if ok:
            for m in (r.json() or {}).get("models") or []:
                name = str(m.get("name") or "")
                if name:
                    names.append(name)
        _tags_cache = (time.monotonic(), ok, names)
        return ok, names
    except Exception as e:
        log.debug("Ollama tags unavailable: %s", e)
        _tags_cache = (time.monotonic(), False, [])
        return False, []


async def is_available() -> bool:
    up, _ = await tags()
    return up

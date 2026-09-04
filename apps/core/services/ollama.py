"""Ollama local brain client (Qwen3 / ava-ivy model)."""

from __future__ import annotations

import logging
import time
from pathlib import Path

import httpx

from .. import config

log = logging.getLogger("ava.ollama")

# /api/activity is polled every 2s from the GUI; do not hit Ollama that often.
_TAGS_TTL_S = 30.0
_tags_cache: tuple[float, bool, list[str]] = (0.0, False, [])


def _payload(messages: list[dict], model: str | None, *, keep_alive=None, num_predict: int | None = None) -> dict:
    options: dict = {
        "num_ctx": int(config.OLLAMA_NUM_CTX),
    }
    if num_predict is not None:
        options["num_predict"] = int(num_predict)
    body = {
        "model": model or config.OLLAMA_MODEL,
        "messages": messages,
        "stream": False,
        "think": False,
        "options": options,
    }
    if keep_alive is not None:
        body["keep_alive"] = keep_alive
    return body


def chat_sync(
    messages: list[dict],
    *,
    model: str | None = None,
    timeout: int = 90,
    keep_alive=None,
    num_predict: int | None = None,
) -> str | None:
    """Blocking Ollama chat for crons. Default is AVA_OLLAMA_MODEL (llama3.2)."""
    try:
        r = httpx.post(
            f"{config.OLLAMA_URL}/api/chat",
            json=_payload(messages, model, keep_alive=keep_alive, num_predict=num_predict),
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


def _b64_file(path: Path, *, max_bytes: int = 1_800_000) -> str | None:
    try:
        raw = path.read_bytes()
    except OSError:
        return None
    if not raw or len(raw) > max_bytes:
        return None
    import base64

    return base64.b64encode(raw).decode("ascii")


def look_sync(prompt: str, images: list[Path], *, timeout: int = 90) -> str | None:
    """One-shot vision. Unloads after the reply so llama3.2 can talk."""
    blobs = []
    for p in images[:2]:
        b = _b64_file(Path(p))
        if b:
            blobs.append(b)
    if not blobs:
        return None
    payload = {
        "model": config.OLLAMA_VISION_MODEL,
        "messages": [
            {
                "role": "user",
                "content": (prompt or "Describe this still in four short factual sentences.")[:800],
                "images": blobs,
            }
        ],
        "stream": False,
        "think": False,
        "keep_alive": 0,
        "options": {"num_ctx": 2048, "temperature": 0.1},
    }
    try:
        r = httpx.post(f"{config.OLLAMA_URL}/api/chat", json=payload, timeout=timeout)
        if r.status_code != 200:
            log.warning("Ollama look HTTP %s %s", r.status_code, (r.text or "")[:200])
            return None
        return (r.json().get("message") or {}).get("content") or None
    except Exception as e:
        log.warning("Ollama look failed: %s", e)
        return None


async def look(prompt: str, images: list, *, timeout: int = 90) -> str | None:
    import asyncio
    from pathlib import Path

    paths = [Path(p) for p in images]
    return await asyncio.to_thread(look_sync, prompt, paths, timeout=timeout)

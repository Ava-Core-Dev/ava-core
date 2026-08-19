"""
xAI / Grok API client — ported from xai_client.py.
Provides chat completions and TTS synthesis with clear error messages.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import requests

from .. import config

log = logging.getLogger("ava.xai")

CHAT_URL = "https://api.x.ai/v1/chat/completions"
TTS_URL  = "https://api.x.ai/v1/tts"


class XAIError(RuntimeError):
    pass


def _headers() -> dict[str, str]:
    if not config.XAI_API_KEY:
        raise XAIError("XAI_API_KEY is not set")
    return {"Authorization": f"Bearer {config.XAI_API_KEY}", "Content-Type": "application/json"}


def _check(r: requests.Response, what: str) -> None:
    if r.status_code < 400:
        return
    body = (r.text or "")[:800]
    msg = f"xAI {what} HTTP {r.status_code}: {body}"
    if r.status_code == 401:
        msg += " → Check XAI_API_KEY"
    elif r.status_code == 403:
        msg += " → Key disabled or out of credits. Check console.x.ai → Billing"
    elif r.status_code == 404:
        msg += f" → Model {config.GROK_MODEL} not found"
    log.error(msg)
    raise XAIError(msg)


def chat(
    messages: list[dict[str, str]],
    *,
    model: str | None = None,
    temperature: float = 0.3,
    max_tokens: int = 340,
    timeout: int = 60,
) -> str:
    payload: dict[str, Any] = {
        "model": model or config.GROK_MODEL,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    r = requests.post(CHAT_URL, headers=_headers(), json=payload, timeout=timeout)
    _check(r, "chat")
    data = r.json()
    try:
        return data["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError, TypeError) as e:
        raise XAIError(f"Unexpected response: {data!r}") from e


def tts(text: str, out_path: Path, *, voice: str | None = None,
        language: str = "en", timeout: int = 90) -> Path:
    payload = {
        "text": text,
        "voice_id": voice or config.TTS_VOICE,
        "language": language,
        "output_format": {"codec": "mp3", "sample_rate": 44100, "bit_rate": 128000},
        "text_normalization": True,
    }
    r = requests.post(TTS_URL, headers=_headers(), json=payload, timeout=timeout)
    _check(r, "tts")
    out_path = out_path.resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(r.content)
    return out_path

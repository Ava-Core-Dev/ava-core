"""
xAI / Grok API client — ported from xai_client.py.
Provides chat completions and TTS synthesis with clear error messages.
Circuit-breaks on credit/auth failures so we do not hammer a dead key.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import requests

from .. import config
from . import model_pick

log = logging.getLogger("ava.xai")

CHAT_URL = "https://api.x.ai/v1/chat/completions"
TTS_URL  = "https://api.x.ai/v1/tts"


class XAIError(RuntimeError):
    pass


def _status_path() -> Path:
    return config.DATA_DIR / "state" / "grok-status.json"


def _load_status() -> dict[str, Any]:
    p = _status_path()
    if not p.exists():
        return {"ok": True}
    try:
        return json.loads(p.read_text())
    except json.JSONDecodeError:
        return {"ok": True}


def _save_status(data: dict[str, Any]) -> None:
    p = _status_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, indent=2) + "\n")


def grok_is_down() -> bool:
    st = _load_status()
    if st.get("halt"):
        return True
    if st.get("ok", True):
        return False
    until = st.get("until")
    if not until:
        return True
    try:
        return datetime.now(timezone.utc) < datetime.fromisoformat(until)
    except ValueError:
        return True


def _spend_blocked() -> bool:
    """Operator spend_master / circuit. Fail closed."""
    if grok_is_down():
        return True
    try:
        from apps.core.services import api_ledger

        ok, _why = api_ledger.may_spend("xai")
        return not ok
    except Exception:
        return True


def mark_grok_down(reason: str) -> None:
    until = datetime.now(timezone.utc) + timedelta(hours=max(1, config.GROK_DOWN_HOURS))
    _save_status({
        "ok": False,
        "reason": reason[:300],
        "until": until.isoformat(),
        "at": datetime.now(timezone.utc).isoformat(),
    })
    log.warning("Grok marked down until %s (%s)", until.isoformat(), reason[:120])


def mark_grok_up() -> None:
    _save_status({"ok": True, "at": datetime.now(timezone.utc).isoformat()})


def is_credits_error(exc: BaseException) -> bool:
    msg = str(exc).lower()
    return any(s in msg for s in ("403", "401", "429", "credit", "quota", "billing"))


def _headers() -> dict[str, str]:
    if not config.XAI_API_KEY:
        raise XAIError("XAI_API_KEY is not set")
    return {"Authorization": f"Bearer {config.XAI_API_KEY}", "Content-Type": "application/json"}


def _check(r: requests.Response, what: str, *, model: str | None = None) -> None:
    if r.status_code < 400:
        return
    body = (r.text or "")[:800]
    msg = f"xAI {what} HTTP {r.status_code}: {body}"
    if r.status_code == 401:
        msg += " → Check XAI_API_KEY"
    elif r.status_code == 403:
        msg += " → Key disabled or out of credits. Check console.x.ai → Billing"
    elif r.status_code == 404:
        msg += f" → Model {model or config.GROK_MODEL} not found"
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
    if grok_is_down():
        raise XAIError("Grok circuit-open (credits/auth). Skipping until cooldown.")
    chosen = model_pick.pick("xai", model=model)
    payload: dict[str, Any] = {
        "model": chosen,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    r = requests.post(CHAT_URL, headers=_headers(), json=payload, timeout=timeout)
    _check(r, "chat", model=chosen)
    data = r.json()
    try:
        text = data["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError, TypeError) as e:
        raise XAIError(f"Unexpected response: {data!r}") from e
    mark_grok_up()
    try:
        from apps.core.services import api_ledger

        usage = data.get("usage") if isinstance(data, dict) else None
        if isinstance(usage, dict):
            details = usage.get("prompt_tokens_details")
            cached = 0
            if isinstance(details, dict):
                cached = int(details.get("cached_tokens") or 0)
            api_ledger.record_usage(
                "xai",
                model=chosen,
                input_tokens=int(usage.get("prompt_tokens") or 0),
                output_tokens=int(usage.get("completion_tokens") or 0),
                cached_tokens=cached,
                surface="xai.chat",
            )
    except Exception:
        log.debug("api-ledger xai usage skip", exc_info=True)
    return text


def try_chat(messages: list[dict[str, str]], **kwargs) -> str | None:
    """Grok chat that returns None on failure and trips the credit breaker."""
    if not config.XAI_API_KEY or grok_is_down():
        return None
    try:
        return chat(messages, **kwargs)
    except XAIError as e:
        if is_credits_error(e):
            mark_grok_down(str(e))
        log.warning("Grok chat failed: %s", e)
        return None


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

"""Public Ava chat — every turn goes to local llama3.2 with live facts."""

from __future__ import annotations

import logging
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .. import config
from ..services import ollama as ollama_svc
from ..services import persona as persona_svc

router = APIRouter(prefix="/api")
log = logging.getLogger("ava.chat")

FREE_LIVE_PER_IP = 3
LOGGED_IN_LIVE = 40
_SURFACES = frozenset({"public", "rootmc", "kilauea"})


def _db() -> Path:
    path = config.DATA_DIR / "db" / "chat-usage.sqlite"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _day() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _bump(key: str) -> int:
    path = _db()
    con = sqlite3.connect(str(path))
    try:
        con.execute(
            "CREATE TABLE IF NOT EXISTS chat_usage (day TEXT, key TEXT, n INTEGER, PRIMARY KEY (day, key))"
        )
        con.execute(
            "INSERT INTO chat_usage(day, key, n) VALUES (?, ?, 1) "
            "ON CONFLICT(day, key) DO UPDATE SET n = n + 1",
            (_day(), key),
        )
        n = con.execute(
            "SELECT n FROM chat_usage WHERE day=? AND key=?", (_day(), key)
        ).fetchone()[0]
        con.commit()
        return int(n)
    finally:
        con.close()


def _client_ip(request: Request) -> str:
    cf = request.headers.get("cf-connecting-ip")
    if cf:
        return cf
    xff = request.headers.get("x-forwarded-for") or ""
    return (xff.split(",")[0].strip() if xff else request.client.host if request.client else "unknown")


def _has_session(request: Request) -> bool:
    return bool(
        request.cookies.get("ava_session")
        or request.cookies.get("rr_web_session")
        or request.headers.get("x-ava-session")
    )


class ChatRequest(BaseModel):
    message: str
    context: str = ""
    surface: str = "public"
    max_tokens: int = 512
    history: list[dict] = []


@router.get("/auth/session")
async def api_session(request: Request):
    return {
        "loggedIn": _has_session(request),
        "free": {"liveUsesPerIp": FREE_LIVE_PER_IP, "genericUnlimited": True, "resources": 3},
        "login": "https://rootrecord.cloud/account",
    }


@router.post("/chat")
async def api_chat(req: ChatRequest, request: Request):
    import httpx

    raw = (req.message or "").strip()
    if not raw:
        return {"reply": "Aloha — I'm Ava Ivy. What do you want to know?", "brain": "canned", "topic": "greet"}

    surface = req.surface if req.surface in _SURFACES else "public"
    try:
        _bump("ip:" + _client_ip(request))
    except Exception:
        pass

    system, _src = persona_svc.system_prompt(surface=surface)
    try:
        facts = await persona_svc.live_facts()
        if facts:
            system += "\n\n" + facts
    except Exception:
        facts = ""
    if req.context:
        system += f"\n\nAdditional context:\n{req.context}"

    messages = [{"role": "system", "content": system}]
    if surface == "public":
        messages.extend(persona_svc.PUBLIC_FEWSHOT)
    for turn in (req.history or [])[-10]:
        role = turn.get("role") if isinstance(turn, dict) else None
        content = str((turn.get("content") if isinstance(turn, dict) else "") or "").strip()[:1500]
        if role in {"user", "assistant"} and content:
            messages.append({"role": role, "content": content})
    if not messages or messages[-1].get("role") != "user" or messages[-1].get("content") != req.message:
        messages.append({"role": "user", "content": req.message})

    reply = await ollama_svc.chat(messages, timeout=45)
    if reply:
        cleaned = persona_svc.scrub_reply(reply)
        if cleaned:
            return {"reply": cleaned, "brain": "ollama", "model": config.OLLAMA_MODEL, "surface": surface}

    if config.XAI_API_KEY:
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await client.post(
                    "https://api.x.ai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {config.XAI_API_KEY}",
                             "Content-Type": "application/json"},
                    json={"model": config.GROK_MODEL, "messages": messages,
                          "max_tokens": req.max_tokens},
                )
            if r.status_code == 200:
                data = r.json()
                cleaned = persona_svc.scrub_reply(data["choices"][0]["message"]["content"].strip())
                if cleaned:
                    return {"reply": cleaned, "brain": "xai", "model": config.GROK_MODEL, "surface": surface}
        except Exception as e:
            log.error("xAI chat failed: %s", e)

    return {
        "reply": "I didn't get a clean sentence that time. Ask me again.",
        "brain": "empty",
        "surface": surface,
    }

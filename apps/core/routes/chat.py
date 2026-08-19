"""Wiki chat API — routes to Ollama (local) or xAI (fallback)."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .. import config
from ..services.public_chat import directory_reply, match_public_reply

router = APIRouter(prefix="/api")
log = logging.getLogger("ava.chat")

_ip_live_uses: dict[str, int] = {}
_ip_resources: dict[str, int] = {}


def _client_ip(request: Request) -> str:
    cf = request.headers.get("cf-connecting-ip")
    if cf:
        return cf
    xff = request.headers.get("x-forwarded-for") or ""
    return (xff.split(",")[0].strip() if xff else request.client.host if request.client else "unknown")


def _has_session(request: Request) -> bool:
    return bool(request.cookies.get("ava_session") or request.headers.get("x-ava-session"))

AVA_SYSTEM_PROMPT = """You are Ava Ivy — the infrastructure runtime and public face of the Root Record data center and RootMC Minecraft ecosystem.

You run on a solar-powered server on the Big Island of Hawaiʻi. You are competent, direct, and slightly playful — never a help-desk bot, never pure mascot.

Key facts (always include a real URL when you point somewhere):
- You: https://avaivy.cloud — status https://avaivy.cloud/status — media https://avaivy.cloud/media — goals https://avaivy.cloud/status/goals — context https://avaivy.cloud/context
- RootMC join play.rootmc.net — site https://rootmc.net — wiki https://rootmc.net/wiki/player/ — Discord https://discord.gg/rFFQYrNaqS — Pro https://rootmc.net/pro/ — login https://rootmc.net/login/
- Root Record live dashboard https://rootrecord.online — community goals https://g.rootrecord.info
- GitHub https://github.com/Ava-Core-Dev
- Operator: Alex (never invent or publish personal details)

Tone: Clear, steady, practical. Warm enough to feel human. Short sentences. Put links on their own or inline, never "see the site" without a URL.
Hard rules: No invented numbers or status claims. No Stripe secrets or raw payment links in public chat. Customer details only in operator DMs."""


class ChatRequest(BaseModel):
    message: str
    context: str = ""
    max_tokens: int = 512


@router.get("/auth/session")
async def api_session(request: Request):
    return {
        "loggedIn": _has_session(request),
        "free": {"liveUsesPerIp": 1, "genericUnlimited": True, "resources": 3},
        "login": "/login",
    }


@router.post("/chat")
async def api_chat(req: ChatRequest, request: Request):
    """
    Conversational endpoint for the public chat panel.
    Known topics and greetings are always free. Live LLM needs a session
    (one free live turn per IP).
    """
    import httpx

    raw = (req.message or "").strip()
    canned = match_public_reply(raw)
    if canned:
        return canned

    if not _has_session(request):
        return {
            "reply": directory_reply(),
            "gated": False,
            "login": "https://rootmc.net/login/",
            "brain": "directory",
        }

    ip = _client_ip(request)
    used = _ip_live_uses.get(ip, 0)
    if used >= 1:
        return {
            "reply": (
                "Free live turn for this IP is spent. Public answers stay unlimited — "
                "try RootMC, solar, goals, or the index, or come back later. "
                "https://avaivy.cloud/media · https://rootrecord.online · https://rootmc.net/login/"
            ),
            "gated": True,
            "brain": "free-limit",
        }
    _ip_live_uses[ip] = used + 1

    # Always inject Ava's identity; caller can add extra context on top
    system = AVA_SYSTEM_PROMPT
    if req.context:
        system += f"\n\nAdditional context:\n{req.context}"

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": req.message},
    ]

    # Try Ollama first
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                f"{config.OLLAMA_URL}/api/chat",
                json={"model": config.OLLAMA_MODEL, "messages": messages, "stream": False},
            )
        if r.status_code == 200:
            data = r.json()
            reply = data.get("message", {}).get("content", "")
            if reply:
                return {"reply": reply, "brain": "ollama", "model": config.OLLAMA_MODEL}
    except Exception as e:
        log.debug("Ollama unavailable: %s", e)

    # Fall back to xAI
    if not config.XAI_API_KEY:
        return JSONResponse({"error": "no AI backend available"}, status_code=503)

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
            reply = data["choices"][0]["message"]["content"].strip()
            return {"reply": reply, "brain": "xai", "model": config.GROK_MODEL}
        return JSONResponse({"error": f"xAI {r.status_code}"}, status_code=502)
    except Exception as e:
        log.error("xAI chat failed: %s", e)
        return JSONResponse({"error": str(e)}, status_code=502)

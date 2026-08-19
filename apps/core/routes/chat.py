"""Wiki chat API — routes to Ollama (local) or xAI (fallback)."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .. import config

router = APIRouter(prefix="/api")
log = logging.getLogger("ava.chat")

LOGIN_REPLY = (
    "The chat is here — log in to talk with me. "
    "Free accounts get 1 live use per IP, unlimited canned answers, and 3 resources."
)

GENERIC = {
    "rootmc": "RootMC is survival Minecraft at play.rootmc.net — closed-loop Gold, claims, votes.",
    "solar": "I run on the HI Pacific Solar Root Server — panels + battery on the Big Island.",
    "kilauea": "Kīlauea and weather live under Root Record — real-world ops, not Minecraft.",
}

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

Key facts:
- Root Record is the data center / system of record (MariaDB + SQLite on-device)
- RootMC is a survival Minecraft server at play.rootmc.net
- You monitor Kīlauea volcano, NOAA weather, solar/battery state, and server economy
- Your domains: avaivy.cloud (identity), rootrecord.online (dashboard), rootmc.info (Minecraft API)
- GitHub: github.com/Ava-Core-Dev
- Operator: Alex (never invent or publish personal details)

Tone: Clear, steady, practical. Warm enough to feel human. Short sentences. Anchor in real operations.
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
    Unregistered typed messages are gated. Canned/generic answers stay free.
    Free accounts: 1 live use per IP, 3 resources.
    """
    import httpx

    raw = (req.message or "").strip()
    if raw.startswith("__generic:"):
        key = raw.split(":", 1)[-1].strip()
        return {"reply": GENERIC.get(key, GENERIC["rootmc"]), "brain": "canned", "generic": True}

    if not _has_session(request):
        return {"reply": LOGIN_REPLY, "gated": True, "login": "/login", "brain": "gate"}

    ip = _client_ip(request)
    used = _ip_live_uses.get(ip, 0)
    if used >= 1:
        return {
            "reply": "Free live uses are spent for this IP. Canned answers stay unlimited — upgrade for more live talks.",
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

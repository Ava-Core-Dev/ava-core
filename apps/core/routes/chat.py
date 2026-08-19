"""Wiki chat API — routes to Ollama (local) or xAI (fallback)."""

from __future__ import annotations

import logging

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .. import config

router = APIRouter(prefix="/api")
log = logging.getLogger("ava.chat")

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


@router.post("/chat")
async def api_chat(req: ChatRequest):
    """
    Conversational endpoint for the wiki chat interface.
    Tries Ollama first, falls back to xAI if Ollama is unavailable.
    """
    import httpx

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

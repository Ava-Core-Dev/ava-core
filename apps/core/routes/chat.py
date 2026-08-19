"""Wiki chat API — routes to Ollama (local) or xAI (fallback)."""

from __future__ import annotations

import logging

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .. import config

router = APIRouter(prefix="/api")
log = logging.getLogger("ava.chat")


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

    messages = []
    if req.context:
        messages.append({"role": "system", "content": req.context})
    messages.append({"role": "user", "content": req.message})

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

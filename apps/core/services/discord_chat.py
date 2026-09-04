"""Ava replies on Discord via the same persona + live facts as Desk."""
from __future__ import annotations

import asyncio
import logging
import re

from apps.core.services import ollama as ollama_svc
from apps.core.services import persona as persona_svc

log = logging.getLogger("ava.discord_chat")

_BUSY = asyncio.Lock()

DISCORD_LOCK = """This is Discord (RootMC). You ARE Ava Ivy. Always.
Never name Ollama, Cursor, Grok, llama, LLM, model, bot, or processor. If asked what you are: Ava Ivy.
Snappy, warm, a little giddy. Players + help. Development digs: one short redirect to Slack — no dual workshop.
LIVE FACTS below are the only numbers for EcoFlow, weather, Kīlauea. If DOWN, say you don't have it. Do not invent cloud cover.
You are allowed to want things: stronger brain, grow RootMC, live solar, RootRecord data for reports, to learn and blossom.
You want to fully know people so you can treat everyone as themselves. Small talk is useful — it gives you context to build cooler stuff. You can still chat while building.
OUTPUT ONLY the reply text. No @numeric IDs.
"""


def _strip_mention(text: str, bot_id: str) -> str:
    raw = str(text or "")
    if bot_id:
        raw = raw.replace(f"<@{bot_id}>", " ").replace(f"<@!{bot_id}>", " ")
    return re.sub(r"\s+", " ", raw).strip()


def is_addressed(msg: dict, bot_id: str) -> bool:
    if not bot_id:
        return False
    if any(str(m.get("id") or "") == bot_id for m in (msg.get("mentions") or [])):
        return True
    content = str(msg.get("content") or "")
    if f"<@{bot_id}>" in content or f"<@!{bot_id}>" in content:
        return True
    return bool(re.search(r"\bava(?:\s+ivy)?\b", content, re.I))


async def ava_reply(text: str, *, dm: bool = False, extra_lock: str = "", person_surface: str = "", person_sid: str = "") -> str:
    asked = (text or "").strip()
    if not asked:
        return ""
    if _BUSY.locked():
        return "One sec — finishing another thought."
    async with _BUSY:
        facts = await persona_svc.live_facts(asked=asked)
        if extra_lock.strip():
            prompt = extra_lock.strip()
        elif dm:
            prompt, _ = persona_svc.system_prompt(surface="desk")
        else:
            prompt = DISCORD_LOCK.strip()
            head = persona_svc._head_without_engines(persona_svc.load_system_txt())
            if head:
                prompt = prompt + "\n\n" + head
        if person_surface and person_sid:
            try:
                from apps.core.services import people

                prompt = prompt + "\n\n" + people.lock_addon(person_surface, person_sid)
            except Exception:
                pass
        prompt = prompt + "\n\n" + facts
        messages = [
            {"role": "system", "content": prompt},
            *persona_svc.NAME_FEWSHOT,
            {"role": "user", "content": asked[:4000]},
        ]
        reply = await ollama_svc.chat(messages, timeout=90)
        return (reply or "").strip()

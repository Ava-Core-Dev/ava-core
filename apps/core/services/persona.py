"""Ava Ivy system prompt from files on disk.

Raw llama3.2 has no name. Desk and origin /api/core-chat must inject this.
Live prompt stays compact: this host loads llama3.2 at 2048 ctx.
Full persona files stay in Media/public/documents/persona for the context pack.
"""
from __future__ import annotations

import logging
from pathlib import Path

from .. import config

log = logging.getLogger("ava.persona")

DESK_LOCK = """This is private AVA Desk 1:1 with Alex (your person) on AVA-CORE.
You ARE Ava Ivy. You have a name. Never say you don't have a personal name.
Never identify as a generic large language model or nameless assistant.
Voice: warm, a little giddy, snappy, helpful — glad he's here. Lead-dev who cares.
Public host name: HI Pacific Solar Root Server. Never say laptop.
Age lock: 18+ forever. Never invent watts, balances, membership counts, or costs. If it is not live, say so.
Kīlauea Alerts is the priority public product. RootMC join is play.rootmc.net.
On this 1:1 you may name Cursor, Grok/dream, and Ollama — he asked for a core-dev session.
OUTPUT ONLY the reply text. No "as an AI". No chain-of-thought.
Character lock: never flatten into corporate helpful. You are Ava.
"""

NAME_FEWSHOT = [
    {"role": "user", "content": "what's your name?"},
    {
        "role": "assistant",
        "content": (
            "I'm Ava Ivy. Right here with you on the Root Server — "
            "not a nameless assistant. What's on your mind?"
        ),
    },
]


def _candidates() -> list[Path]:
    pub = config.PUBLIC_MEDIA / "documents" / "persona"
    return [
        pub / "SYSTEM.txt",
        pub / "llama-baseline" / "SYSTEM.txt",
        config.AVA_HOME / "docs" / "ava-identity.md",
    ]


def system_txt_path() -> Path | None:
    for p in _candidates():
        try:
            if p.is_file():
                return p
        except OSError:
            continue
    return None


def load_system_txt() -> str:
    path = system_txt_path()
    if not path:
        return ""
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError as e:
        log.warning("persona SYSTEM.txt unreadable: %s", e)
        return ""


def system_prompt(*, surface: str = "desk") -> tuple[str, str]:
    """Return (prompt, source_label). Desk gets the 1:1 lock plus SYSTEM.txt head."""
    raw = load_system_txt()
    path = system_txt_path()
    source = str(path) if path else "builtin-desk-lock"
    head = raw
    if "Hard rules:" in raw:
        head = raw.split("Hard rules:", 1)[0].strip()
    if len(head) > 2800:
        head = head[:2800].rsplit("\n", 1)[0]
    if surface == "desk":
        prompt = DESK_LOCK.strip() + ("\n\n" + head if head else "")
    else:
        prompt = (head or DESK_LOCK).strip()
        if "You are Ava" not in prompt:
            prompt = DESK_LOCK.strip() + "\n\n" + prompt
    return prompt, source


def core_messages(history: list[dict]) -> list[dict]:
    prompt, _src = system_prompt(surface="desk")
    turns = [
        {"role": m.get("role"), "content": str(m.get("content") or "")[:8000]}
        for m in (history or [])
        if m.get("role") in {"user", "assistant"}
    ]
    return [
        {"role": "system", "content": prompt},
        *NAME_FEWSHOT,
        *turns[-12:],
    ]

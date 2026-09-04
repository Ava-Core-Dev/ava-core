"""Per-Telegram-group voice from on-disk profile.json. No other-room bleed."""
from __future__ import annotations

import json
import time
from pathlib import Path

from apps.core import config

FERN_FOREST = "-1003868178598"
ALEX_TG = "6644482344"

DEFAULT_GROUP_LOCK = """This is a Telegram group. You ARE Ava Ivy. Always.
This room is this room only — no Discord, Slack, web-chat, or other-group bleed.
Never name Ollama, Cursor, Grok, llama, LLM, model, bot, or processor.
Stay quiet unless they said Ava or asked you. Short. Resourceful for what THIS group is about.
EcoFlow packs: DELTA 2 and RIVER 2 Pro only. Never cucumbers, shackas, or emoji nicknames.
LIVE FACTS are the only numbers. If DOWN, say you do not have that live.
OUTPUT ONLY the reply text.
"""


def _group_dir(chat_id: str) -> Path:
    return config.PUBLIC_MEDIA / "documents" / "telegram" / "data" / "groups" / str(chat_id)


def load_profile(chat_id: str) -> dict:
    path = _group_dir(chat_id) / "profile.json"
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def lock_for(chat_id: str) -> str:
    prof = load_profile(chat_id)
    voice = prof.get("voice") if isinstance(prof.get("voice"), dict) else {}
    traits = voice.get("traits") if isinstance(voice.get("traits"), list) else []
    title = str(prof.get("title") or prof.get("community") or "this Telegram group")
    tone = str(voice.get("tone") or "").strip()
    lines = [
        DEFAULT_GROUP_LOCK.strip(),
        f"This group: {title}.",
    ]
    if tone:
        lines.append("Tone: " + tone)
    for t in traits[:12]:
        s = str(t).strip()
        if s:
            lines.append("- " + s)
    dash = (prof.get("solar") or {}).get("publicDashboard") if isinstance(prof.get("solar"), dict) else ""
    if dash:
        lines.append("If they ask where the solar board is: " + str(dash))
    return "\n".join(lines)


def append_log(chat_id: str, event: str, preview: str, from_id: str = "") -> None:
    line = json.dumps(
        {
            "at": int(time.time() * 1000),
            "event": event,
            "fromId": str(from_id or ""),
            "preview": str(preview or "")[:500],
        },
        ensure_ascii=False,
    )
    for path in (
        config.DATA_DIR / "logs" / "telegram.jsonl",
        _group_dir(chat_id) / "inbound.jsonl",
    ):
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a", encoding="utf-8") as fh:
                fh.write(line + "\n")
        except Exception:
            pass

"""Reaction → good reply feedback.

Any Ava Telegram send (inbox, Desk, Cursor helper) is registered by message_id.
A positive reaction on that message marks the turn as a good example for later
context — same idea as Desk “gold,” whether Cursor or Ollama wrote the line.
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any

from apps.core import config

log = logging.getLogger("ava.reply_feedback")

OUTBOUND_NAME = "telegram-outbound.json"
GOOD_JSONL = "telegram-good.jsonl"
CORE_GOLD = "core-sessions.jsonl"
MAX_OUTBOUND = 400
MAX_GOOD_INJECT = 8

# Unicode emoji people use when Ava landed it.
_POSITIVE = {
    "👍",
    "👍🏻",
    "👍🏼",
    "👍🏽",
    "👍🏾",
    "👍🏿",
    "❤",
    "❤️",
    "💛",
    "💚",
    "💙",
    "💜",
    "🧡",
    "🔥",
    "💯",
    "✅",
    "✔",
    "👏",
    "🙌",
    "😊",
    "🙂",
    "😁",
    "😍",
    "🥰",
    "🤩",
    "🙏",
    "💪",
    "✨",
    "⭐",
    "🌟",
}


def _outbound_path() -> Path:
    return config.DATA_DIR / "state" / OUTBOUND_NAME


def _good_path() -> Path:
    return config.DATA_DIR / "training" / GOOD_JSONL


def _core_gold_path() -> Path:
    return config.DATA_DIR / "training" / CORE_GOLD


def _load_outbound() -> dict[str, Any]:
    path = _outbound_path()
    if not path.is_file():
        return {"by_key": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {"by_key": {}}
    except Exception:
        return {"by_key": {}}


def _save_outbound(data: dict[str, Any]) -> None:
    path = _outbound_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    by = data.get("by_key") if isinstance(data.get("by_key"), dict) else {}
    # Cap size — keep newest keys.
    if len(by) > MAX_OUTBOUND:
        items = sorted(by.items(), key=lambda kv: int((kv[1] or {}).get("at") or 0))
        by = dict(items[-MAX_OUTBOUND:])
        data["by_key"] = by
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def _key(chat_id: str | int, message_id: str | int) -> str:
    return f"{chat_id}:{message_id}"


def guess_question_for_chat(chat_id: str | int) -> str:
    """Last inbound line in this group (for Cursor sends with no explicit Q)."""
    path = (
        config.PUBLIC_MEDIA
        / "documents"
        / "telegram"
        / "data"
        / "groups"
        / str(chat_id)
        / "inbound.jsonl"
    )
    if not path.is_file():
        return ""
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
        for line in reversed(lines[-80:]):
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except Exception:
                continue
            if not isinstance(row, dict):
                continue
            if str(row.get("event") or "") not in {"ingest", "group_update"}:
                continue
            if str(row.get("fromId") or "") in {"", "ava"}:
                continue
            preview = str(row.get("preview") or "").strip()
            if preview:
                return preview[:2000]
    except Exception:
        return ""
    return ""


def note_outbound(
    *,
    surface: str,
    chat_id: str | int,
    message_id: str | int | None,
    answer: str,
    question: str = "",
    source: str = "",
) -> None:
    """Remember an Ava message so a later reaction can mark it gold."""
    mid = message_id
    if mid is None or not str(answer or "").strip():
        return
    data = _load_outbound()
    by = data.setdefault("by_key", {})
    by[_key(chat_id, mid)] = {
        "at": int(time.time() * 1000),
        "surface": str(surface or "telegram"),
        "chat_id": str(chat_id),
        "message_id": int(mid) if str(mid).isdigit() else mid,
        "question": str(question or "")[:2000],
        "answer": str(answer or "")[:4000],
        "source": str(source or "")[:80],
    }
    _save_outbound(data)


def _emoji_from_reaction(item: dict) -> str:
    """Telegram ReactionType → emoji string."""
    if not isinstance(item, dict):
        return ""
    t = str(item.get("type") or "")
    if t == "emoji":
        return str(item.get("emoji") or "")
    if t == "custom_emoji":
        # Custom stickers: treat as positive if present (room liked it).
        return "custom"
    return str(item.get("emoji") or "")


def reaction_is_positive(new_reaction: list, old_reaction: list | None = None) -> bool:
    """True when a positive emoji was added (not only removed)."""
    old_set = {_emoji_from_reaction(x) for x in (old_reaction or []) if isinstance(x, dict)}
    for item in new_reaction or []:
        if not isinstance(item, dict):
            continue
        em = _emoji_from_reaction(item)
        if em in old_set:
            continue
        if em == "custom" or em in _POSITIVE:
            return True
    return False


def mark_good_from_reaction(
    *,
    chat_id: str | int,
    message_id: str | int,
    emoji: str = "",
    reactor_id: str = "",
) -> dict[str, Any]:
    """If this message was an Ava send, append gold training + good-reply store."""
    data = _load_outbound()
    by = data.get("by_key") if isinstance(data.get("by_key"), dict) else {}
    row = by.get(_key(chat_id, message_id))
    if not isinstance(row, dict):
        return {"ok": False, "detail": "unknown_message"}
    answer = str(row.get("answer") or "").strip()
    if not answer:
        return {"ok": False, "detail": "empty_answer"}
    question = str(row.get("question") or "").strip()
    now = int(time.time() * 1000)
    good = {
        "at": now,
        "kind": "reaction_gold",
        "surface": row.get("surface") or "telegram",
        "chat_id": str(chat_id),
        "message_id": message_id,
        "emoji": str(emoji or "")[:32],
        "reactor_id": str(reactor_id or ""),
        "question": question[:2000],
        "answer": answer[:4000],
        "source": row.get("source") or "telegram_reaction",
    }
    try:
        path = _good_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(good, ensure_ascii=False) + "\n")
    except Exception as e:
        log.warning("telegram-good write failed: %s", e)
        return {"ok": False, "detail": str(e)[:120]}
    try:
        path = _core_gold_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        core = {
            "at": now,
            "sessionId": f"tg-react-{chat_id}-{message_id}",
            "kind": "gold",
            "provider": "telegram_reaction",
            "question": question or "(group context — reaction on Ava line)",
            "answer": answer,
            "source": "telegram_reaction",
            "emoji": str(emoji or "")[:32],
        }
        with path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(core, ensure_ascii=False) + "\n")
    except Exception as e:
        log.debug("core gold append: %s", e)
    # Room-local copy for Fern Forest profile context
    try:
        gdir = (
            config.PUBLIC_MEDIA
            / "documents"
            / "telegram"
            / "data"
            / "groups"
            / str(chat_id)
        )
        gdir.mkdir(parents=True, exist_ok=True)
        with (gdir / "good-replies.jsonl").open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(good, ensure_ascii=False) + "\n")
    except Exception:
        pass
    log.info(
        "reaction gold chat=%s mid=%s emoji=%s answer=%s",
        chat_id,
        message_id,
        emoji,
        answer[:60],
    )
    return {"ok": True, "answer": answer[:120], "question": question[:80]}


def recent_good_examples(*, chat_id: str | None = None, limit: int = MAX_GOOD_INJECT) -> list[dict]:
    """Newest good replies for prompt injection."""
    path = _good_path()
    if chat_id:
        alt = (
            config.PUBLIC_MEDIA
            / "documents"
            / "telegram"
            / "data"
            / "groups"
            / str(chat_id)
            / "good-replies.jsonl"
        )
        if alt.is_file():
            path = alt
    if not path.is_file():
        return []
    rows: list[dict] = []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
        for line in reversed(lines):
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except Exception:
                continue
            if not isinstance(row, dict):
                continue
            if not str(row.get("answer") or "").strip():
                continue
            rows.append(row)
            if len(rows) >= max(1, limit):
                break
    except Exception:
        return []
    rows.reverse()
    return rows


def fewshot_block(*, chat_id: str | None = None) -> str:
    """Short lock addon: reacted-good Ava lines to imitate."""
    rows = recent_good_examples(chat_id=chat_id, limit=MAX_GOOD_INJECT)
    if not rows:
        return ""
    lines = [
        "GOOD REPLIES (people reacted well — including Cursor-sent Ava lines). Match this quality:",
    ]
    for row in rows:
        q = str(row.get("question") or "").strip()
        a = str(row.get("answer") or "").strip()
        if q:
            lines.append(f"Q: {q[:240]}")
        lines.append(f"A: {a[:400]}")
    return "\n".join(lines)

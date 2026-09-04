"""Inbound subscribe/unsubscribe for public report DMs.

Telegram: /subscribe  /unsubscribe  (DM the bot)
Discord:  !subscribe  !unsubscribe  (guild channel or DM Ava)

These commands only toggle report delivery. They never add anyone to
development / operator feeds.
"""
from __future__ import annotations

import json
import logging
import re
from pathlib import Path

from . import config
from .services import discord, slack, subscribers, telegram

log = logging.getLogger("ava.inbox")

def _snowflake(value: str) -> int:
    try:
        return int(str(value or "0"))
    except (TypeError, ValueError):
        return 0


HELP = (
    "Ava report DMs — the same public reports, delivered to you.\n"
    "Not operator/dev messages. Just morning, solar/weather, Kīlauea, and alerts.\n\n"
    "/subscribe — start receiving reports\n"
    "/unsubscribe — stop"
)

_DISCORD_ME: str | None = None


def _state_path() -> Path:
    return config.DATA_DIR / "state" / "report-inbox.json"


def _load_state() -> dict:
    path = _state_path()
    if path.is_file():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"telegram_offset": 0, "discord_last": {}, "slack_last": {}}


def _save_state(state: dict) -> None:
    path = _state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state) + "\n", encoding="utf-8")


def _parse_cmd(text: str) -> str | None:
    raw = str(text or "").strip().lower()
    if not raw:
        return None
    first = raw.split()[0]
    first = first.split("@", 1)[0]
    if first in {"/start", "/help", "!help"}:
        return "help"
    if first in {"/subscribe", "!subscribe", "subscribe"}:
        return "subscribe"
    if first in {"/unsubscribe", "!unsubscribe", "unsubscribe"}:
        return "unsubscribe"
    return None


async def _handle(surface: str, sid: str, cmd: str, *, label: str = "") -> str:
    if cmd == "help":
        return HELP
    if cmd == "subscribe":
        res = subscribers.add(surface, sid, label=label)
        if res.get("already"):
            return "You already get Ava's public reports. /unsubscribe to stop."
        return (
            "You're on the list. I'll DM you morning, solar/weather, "
            "Kīlauea, and weather alerts — not development chatter."
        )
    if cmd == "unsubscribe":
        subscribers.remove(surface, sid)
        return "Stopped. You won't get report DMs. /subscribe anytime to come back."
    return HELP


async def telegram_loop() -> None:
    if not config.telegram_enabled() or not config.telegram_bot_token():
        log.info("Telegram inbox off (no bot token)")
        return
    log.info("Telegram report-subscribe inbox running")
    from apps.core.services import telegram_rooms

    state = _load_state()
    offset = int(state.get("telegram_offset") or 0)
    while True:
        try:
            updates = await telegram.get_updates(offset=offset or None, timeout=25)
            for upd in updates:
                offset = max(offset, int(upd.get("update_id") or 0) + 1)
                msg = upd.get("message") or {}
                text = str(msg.get("text") or "")
                chat = msg.get("chat") or {}
                chat_id = chat.get("id")
                if chat_id is None:
                    continue
                chat_type = str(chat.get("type") or "")
                is_group = chat_type in {"group", "supergroup"}
                cmd = _parse_cmd(text)
                from_user = msg.get("from") or {}
                from_id = str(from_user.get("id") or "")
                label = str(from_user.get("username") or from_user.get("first_name") or "")
                telegram_rooms.append_log(str(chat_id), "ingest" if text else "group_update", text, from_id)
                if cmd:
                    reply = await _handle("telegram", str(chat_id), cmd, label=label)
                    await telegram.send_message(chat_id, reply)
                    continue
                asked = text.strip()
                if not asked:
                    continue
                if is_group and not _tg_addressed(msg, asked):
                    continue
                from apps.core.services import discord_chat

                if is_group:
                    extra = telegram_rooms.lock_for(str(chat_id))
                    reply = await discord_chat.ava_reply(asked, extra_lock=extra)
                elif from_id == telegram_rooms.ALEX_TG:
                    reply = await discord_chat.ava_reply(asked, dm=True)
                else:
                    extra = persona_lock_public()
                    reply = await discord_chat.ava_reply(asked, extra_lock=extra)
                if reply:
                    telegram_rooms.append_log(str(chat_id), "reply", reply, "ava")
                    await telegram.send_message(chat_id, reply)
            state = _load_state()
            state["telegram_offset"] = offset
            _save_state(state)
        except Exception as e:
            log.debug("telegram inbox: %s", e)
            import asyncio
            await asyncio.sleep(5)


def persona_lock_public() -> str:
    from apps.core.services import persona as persona_svc

    return persona_svc.PUBLIC_LOCK.strip()


async def _discord_bot_id() -> str:
    global _DISCORD_ME
    if _DISCORD_ME:
        return _DISCORD_ME
    me = await discord.get_me()
    _DISCORD_ME = str((me or {}).get("id") or "")
    return _DISCORD_ME


async def discord_loop() -> None:
    if not config.discord_bot_token():
        log.info("Discord inbox off (no bot token)")
        return
    import asyncio

    log.info("Discord Ava replies + report-subscribe inbox running")
    while True:
        try:
            await _discord_tick()
        except Exception as e:
            log.debug("discord inbox: %s", e)
        await asyncio.sleep(20)


async def _discord_tick() -> None:
    state = _load_state()
    last: dict[str, str] = dict(state.get("discord_last") or {})
    bot_id = await _discord_bot_id()
    channels = list(config.DEFAULT_WATCH_CHANNELS)
    dm_ids: set[str] = set()
    for ch in await discord.list_private_channels():
        cid = str(ch.get("id") or "")
        if cid:
            channels.append(cid)
            dm_ids.add(cid)
    seen_ch: set[str] = set()
    # All public RootMC text channels (not RootRecord support guild).
    try:
        from apps.core.services import discord as discord_svc

        gchs = await discord_svc.list_guild_channels(config.ROOTMC_GUILD_ID)
        for ch in gchs:
            kind = int(ch.get("type") or 0)
            if kind in (0, 5, 11, 12, 15, 16):  # text, announce, threads, forum, media
                cid = str(ch.get("id") or "")
                if cid:
                    channels.append(cid)
    except Exception:
        pass
    for cid in channels:
        if not cid or cid in seen_ch:
            continue
        seen_ch.add(cid)
        msgs = await discord.get_messages(cid, limit=12)
        if not msgs:
            continue
        newest = str(msgs[0].get("id") or "")
        prev = last.get(cid)
        if not prev:
            last[cid] = newest
            continue
        # Discord returns newest-first
        pending = []
        for msg in msgs:
            mid = str(msg.get("id") or "")
            if not mid or _snowflake(mid) <= _snowflake(prev):
                break
            pending.append(msg)
        for msg in reversed(pending):
            author = msg.get("author") or {}
            if author.get("bot"):
                continue
            uid = str(author.get("id") or "")
            if not uid or uid == bot_id:
                continue
            content = str(msg.get("content") or "")
            cmd = _parse_cmd(content)
            if cmd:
                label = str(author.get("username") or "")
                reply = await _handle("discord", uid, cmd, label=label)
                sent = await discord.send_dm(uid, reply)
                if not sent:
                    await discord.post_message(cid, reply, ref_id=str(msg.get("id") or "") or None)
                continue
            dm = cid in dm_ids
            from apps.core.services import discord_chat

            if dm or discord_chat.is_addressed(msg, bot_id):
                asked = discord_chat._strip_mention(content, bot_id)
                if not asked and dm:
                    asked = content.strip() or "hey"
                if asked:
                    reply = await discord_chat.ava_reply(asked, dm=dm)
                    if reply:
                        await discord.post_message(
                            cid, reply, ref_id=str(msg.get("id") or "") or None
                        )
        last[cid] = newest
    state["discord_last"] = last
    _save_state(state)


def _slack_addressed(text: str, bot_id: str) -> bool:
    raw = str(text or "")
    if bot_id and f"<@{bot_id}>" in raw:
        return True
    import re

    return bool(re.search(r"\bava(?:\s+ivy)?\b", raw, re.I))


async def slack_loop() -> None:
    if not config.slack_bot_token():
        log.info("Slack inbox off (no bot token)")
        return
    import asyncio
    import re

    probe = await slack.auth_test()
    if not probe.get("ok"):
        log.info("Slack inbox off (%s)", probe.get("error") or "auth.test")
        return
    bot_id = str(probe.get("user_id") or config.slack_bot_user_id() or "")
    log.info("Slack Ava mention inbox running")
    while True:
        try:
            state = _load_state()
            last: dict[str, str] = dict(state.get("slack_last") or {})
            for cid in config.SLACK_CHANNELS.values():
                if not cid:
                    continue
                msgs = await slack.history(cid, limit=10)
                if not msgs:
                    continue
                newest = str(msgs[0].get("ts") or "")
                prev = last.get(cid)
                if not prev:
                    last[cid] = newest
                    continue
                pending = []
                for msg in msgs:
                    ts = str(msg.get("ts") or "")
                    if not ts or float(ts or 0) <= float(prev or 0):
                        break
                    pending.append(msg)
                for msg in reversed(pending):
                    if msg.get("bot_id") or msg.get("subtype"):
                        continue
                    uid = str(msg.get("user") or "")
                    if uid and uid == bot_id:
                        continue
                    text = str(msg.get("text") or "")
                    if not _slack_addressed(text, bot_id):
                        continue
                    asked = re.sub(rf"<@{re.escape(bot_id)}>", " ", text).strip() if bot_id else text.strip()
                    from apps.core.services import discord_chat

                    reply = await discord_chat.ava_reply(asked or "hey", dm=False)
                    if reply:
                        await slack.post_message(cid, reply)
                last[cid] = newest or prev
            state = _load_state()
            state["slack_last"] = last
            _save_state(state)
        except Exception as e:
            log.debug("slack inbox: %s", e)
        await asyncio.sleep(25)


async def run_inbox() -> None:
    import asyncio

    await asyncio.gather(telegram_loop(), discord_loop(), slack_loop())

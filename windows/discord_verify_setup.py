"""Create / pin RootRecord + RootMC verification channels. No tokens printed."""
from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
for envp in (ROOT / ".env", ROOT / "credentials.env", Path.home() / "ava" / "credentials.env"):
    if envp.is_file():
        load_dotenv(envp, override=False)

API = "https://discord.com/api/v10"
OUT = ROOT / "data" / "discord pre september" / "VERIFY_CHANNELS.json"
LOG = ROOT / "data" / "logs" / "discord-verify-setup.log"

RR_GUILD = "1497039564345442406"
RMC_GUILD = "1516108585740800042"
RR_VERIFIED_ROLE = "1504042901963804742"
RMC_LINKED_ROLE = "1516396491973984256"
RMC_UNVERIFIED_OLD = "1519249871326937138"
RR_INVITE = "https://discord.gg/CPaDYuFkU"

RR_PIN = (
    "Welcome to verification.\n\n"
    "To chat in this server, link Discord to your RootRecord account:\n\n"
    "1) Create or sign in: https://rootrecord.cloud/account.html\n"
    "2) Click **Link Discord** and authorize — or open https://rootrecord.cloud/discord-verify\n"
    "3) You receive **@Verified** and can message.\n\n"
    "Need an account? https://rootrecord.cloud/account-signup.html\n"
    f"Invite: {RR_INVITE}\n"
)

RMC_PIN = (
    "Link Minecraft to unlock chat.\n\n"
    "1) Join **play.rootmc.net**\n"
    "2) In game run `/link` (or `/rootmc link`) — you get a 6-character code\n"
    "3) Open https://rootmc.net/verify/ — enter the code — **Link with Discord**\n\n"
    "That gives you the linked role, sets your nickname to your player name, "
    "and lets you talk in public channels.\n\n"
    "Code expired? Run `/link` again.\n"
    "Wiki: https://rootmc.net/wiki/\n"
)


def _log(msg: str) -> None:
    LOG.parent.mkdir(parents=True, exist_ok=True)
    LOG.open("a", encoding="utf-8").write(msg + "\n")
    print(msg, flush=True)


def _token(*keys: str) -> str:
    for k in keys:
        v = (os.getenv(k) or "").strip().removeprefix("Bot ").removeprefix("bot ")
        if v:
            return v
    return ""


def _headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bot {token}",
        "Content-Type": "application/json; charset=utf-8",
        "User-Agent": "AvaIvyVerify (rootrecord.cloud, 1.0)",
    }


async def _req(client: httpx.AsyncClient, method: str, url: str, token: str, **kw) -> httpx.Response:
    r = await client.request(method, url, headers=_headers(token), **kw)
    if r.status_code == 429:
        wait = float((r.json() or {}).get("retry_after") or 1)
        await asyncio.sleep(min(wait, 20))
        r = await client.request(method, url, headers=_headers(token), **kw)
    return r


async def _ensure_text_channel(
    client: httpx.AsyncClient, token: str, guild: str, names: tuple[str, ...], *, topic: str
) -> tuple[str, bool]:
    chs = await _req(client, "GET", f"{API}/guilds/{guild}/channels", token)
    channels = chs.json() if chs.status_code == 200 and isinstance(chs.json(), list) else []
    want = {n.lower() for n in names}
    for ch in channels:
        if int(ch.get("type") or 0) != 0:
            continue
        raw = str(ch.get("name") or "").lower()
        clean = raw.replace("🛰️", "").replace("👮‍♂️", "").strip("# ")
        if raw in want or clean in want or any(n in raw for n in want):
            cid = str(ch["id"])
            await _req(client, "PATCH", f"{API}/channels/{cid}", token, json={"topic": topic[:1024]})
            return cid, False
    body = {"name": names[0], "type": 0, "topic": topic[:1024]}
    r = await _req(client, "POST", f"{API}/guilds/{guild}/channels", token, json=body)
    if r.status_code not in (200, 201):
        _log(f"create fail guild={guild} name={names[0]} status={r.status_code}")
        return "", False
    return str((r.json() or {}).get("id") or ""), True


async def _pin(client: httpx.AsyncClient, token: str, channel: str, text: str) -> str:
    r = await _req(
        client,
        "POST",
        f"{API}/channels/{channel}/messages",
        token,
        json={"content": text[:1900], "allowed_mentions": {"parse": []}},
    )
    if r.status_code not in (200, 201):
        _log(f"post fail ch={channel} status={r.status_code}")
        return ""
    mid = str((r.json() or {}).get("id") or "")
    if mid:
        p = await _req(client, "PUT", f"{API}/channels/{channel}/pins/{mid}", token)
        _log(f"pin ch={channel} msg={mid} status={p.status_code}")
    return mid


async def _role_exists(client: httpx.AsyncClient, token: str, guild: str, role_id: str) -> bool:
    r = await _req(client, "GET", f"{API}/guilds/{guild}/roles", token)
    roles = r.json() if r.status_code == 200 and isinstance(r.json(), list) else []
    return any(str(x.get("id") or "") == role_id for x in roles)


async def _bot_in_guild(client: httpx.AsyncClient, token: str, guild: str) -> dict:
    me = await _req(client, "GET", f"{API}/users/@me", token)
    user = me.json() if me.status_code == 200 else {}
    mem = await _req(client, "GET", f"{API}/guilds/{guild}/members/{user.get('id')}", token)
    return {
        "username": user.get("username"),
        "id": user.get("id"),
        "in_guild": mem.status_code == 200,
        "me_status": me.status_code,
        "member_status": mem.status_code,
    }


async def main() -> None:
    rr = _token("DISCORD_BOT_TOKEN")
    ava = _token("AVA_DISCORD_BOT_TOKEN", "DISCORD_ROOTMC_BOT_TOKEN", "SEXI_DISCORD_BOT_TOKEN")
    report: dict = {"ok": True}
    timeout = httpx.Timeout(40.0, connect=15.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        if len(rr) < 20:
            _log("no RootRecord bot token")
            report["rootrecord"] = "no_token"
        else:
            bot = await _bot_in_guild(client, rr, RR_GUILD)
            role = await _role_exists(client, rr, RR_GUILD, RR_VERIFIED_ROLE)
            cid, created = await _ensure_text_channel(
                client,
                rr,
                RR_GUILD,
                ("verification",),
                topic="Link Discord on rootrecord.cloud to get @Verified.",
            )
            mid = await _pin(client, rr, cid, RR_PIN) if cid else ""
            report["rootrecord"] = {
                "bot": bot,
                "verified_role": role,
                "channel": cid,
                "created": created,
                "pin": mid,
            }
            _log(f"rootrecord bot={bot.get('username')} in_guild={bot.get('in_guild')} role={role} ch={cid} new={created}")

        if len(ava) < 20:
            _log("no Ava / RootMC bot token")
            report["rootmc"] = "no_token"
        else:
            bot = await _bot_in_guild(client, ava, RMC_GUILD)
            role = await _role_exists(client, ava, RMC_GUILD, RMC_LINKED_ROLE)
            # Prefer existing unverified id if it still lives
            chs = await _req(client, "GET", f"{API}/guilds/{RMC_GUILD}/channels", ava)
            channels = chs.json() if chs.status_code == 200 and isinstance(chs.json(), list) else []
            cid = ""
            if any(str(c.get("id")) == RMC_UNVERIFIED_OLD for c in channels):
                cid = RMC_UNVERIFIED_OLD
                await _req(
                    client,
                    "PATCH",
                    f"{API}/channels/{cid}",
                    ava,
                    json={"topic": "Link Minecraft at rootmc.net/verify to unlock chat."},
                )
                created = False
            else:
                cid, created = await _ensure_text_channel(
                    client,
                    ava,
                    RMC_GUILD,
                    ("unverified", "verification"),
                    topic="Link Minecraft at rootmc.net/verify to unlock chat.",
                )
            mid = await _pin(client, ava, cid, RMC_PIN) if cid else ""
            report["rootmc"] = {
                "bot": bot,
                "linked_role": role,
                "channel": cid,
                "created": created,
                "pin": mid,
            }
            _log(f"rootmc bot={bot.get('username')} in_guild={bot.get('in_guild')} role={role} ch={cid} new={created}")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, indent=2), encoding="utf-8")
    _log(f"wrote {OUT}")


if __name__ == "__main__":
    asyncio.run(main())

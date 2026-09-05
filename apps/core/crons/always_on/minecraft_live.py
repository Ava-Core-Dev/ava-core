"""Poll RootMC player count (RCON) + local Minecraft client for OBS scene."""

from __future__ import annotations

import logging
import re

from apps.core import config

log = logging.getLogger("ava.cron.minecraft_live")

# Prefer live RootMC (prod/primary). Local "test" is often down and must not
# backoff-block the production list query.
_RCON_TARGETS = ("prod", "primary", "test")


def _parse_players_online(text: str) -> int | None:
    """Parse Minecraft /list output. None if not a measured line."""
    raw = (text or "").strip()
    if not raw:
        return None
    low = raw.lower()
    # "There are 2 of a max of 20 players online: foo, bar"
    m = re.search(r"there are\s+(\d+)\s+of\s+a\s+max", low)
    if m:
        return int(m.group(1))
    m = re.search(r"(\d+)\s+of\s+a?\s*max", low)
    if m:
        return int(m.group(1))
    if "players online" in low:
        head = raw.split(":", 1)[0]
        for tok in head.split():
            if tok.isdigit():
                return int(tok)
    return None


async def _fetch_players_online() -> tuple[int | None, str | None]:
    from apps.core.services import rcon

    last_detail = None
    for target in _RCON_TARGETS:
        listing = await rcon.execute("list", target=target, timeout=4)
        if not listing.get("ok"):
            last_detail = f"{target}:{(listing or {}).get('reason') or (listing or {}).get('detail')}"
            continue
        players = _parse_players_online(str(listing.get("output") or ""))
        if players is not None:
            return players, target
        last_detail = f"{target}:unparsed"
    return None, last_detail


async def run() -> None:
    from apps.core.services.minecraft_live import snapshot
    from apps.core.services.obs_studio import apply_minecraft_live

    players, source = await _fetch_players_online()
    snap = snapshot(players_online=players)
    if source:
        snap["players_source"] = source
    if not config.ENABLE_OBS:
        log.info(
            "minecraft live detect %s obs=skipped (AVA_ENABLE_OBS=0) source=%s",
            {k: snap.get(k) for k in ("ingame", "client_now", "thumb_ready", "players_online")},
            source,
        )
        return
    result = await apply_minecraft_live(snap)
    log.info(
        "minecraft live detect %s obs=%s source=%s",
        {k: snap.get(k) for k in ("ingame", "client_now", "thumb_ready", "players_online")},
        result,
        source,
    )

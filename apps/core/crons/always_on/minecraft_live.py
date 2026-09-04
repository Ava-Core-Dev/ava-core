"""Poll local Minecraft client and keep the RootMC Live OBS scene honest."""

from __future__ import annotations

import logging

from apps.core import config

log = logging.getLogger("ava.cron.minecraft_live")


async def run() -> None:
    from apps.core.services.minecraft_live import snapshot
    from apps.core.services.obs_studio import apply_minecraft_live

    players = None
    try:
        from apps.core.services import rcon
        listing = await rcon.execute("list", target="test", timeout=2)
        text = str((listing or {}).get("output") or "")
        # "There are 2 of a max of 20 players online: foo, bar"
        if "players online" in text.lower():
            head = text.split(":", 1)[0]
            for tok in head.split():
                if tok.isdigit():
                    players = int(tok)
                    break
    except Exception:
        players = None

    snap = snapshot(players_online=players)
    if not config.ENABLE_OBS:
        log.info(
            "minecraft live detect %s obs=skipped (AVA_ENABLE_OBS=0)",
            {k: snap.get(k) for k in ("ingame", "client_now", "thumb_ready", "players_online")},
        )
        return
    result = await apply_minecraft_live(snap)
    log.info("minecraft live detect %s obs=%s", {k: snap.get(k) for k in ("ingame", "client_now", "thumb_ready", "players_online")}, result)

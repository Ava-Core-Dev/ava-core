"""Detect local in-game Minecraft for the RootMC Live OBS scene."""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

from apps.core import config

log_name = "ava.minecraft_live"
STATE_PATH = config.DATA_DIR / "state" / "minecraft-live.json"
GRACE_S = 120

_CLIENT_MARKERS = (
    "net.minecraft.client",
    "net.minecraft.auth",
    "com.mojang.minecraft",
    "org.prismlauncher",
    "prismlauncher",
    "minecraft-launcher",
    "minecraftlauncher",
    "lunarclient",
    "lunar client",
    "modrinthapp",
    "modrinth-app",
    "sklauncher",
    "tlauncher",
    "techniclauncher",
    "forge-mod-installer",
)
_SERVER_MARKERS = (
    "--nogui",
    "paper-",
    "paperclip",
    "spigot",
    "purpur",
    "fabric-server",
)


def _thumb_candidates() -> list[Path]:
    thumbs = config.MEDIA_DIR / "images" / "thumbnails"
    names = (
        "thumb-minecraft-offline.jpg",
        "thumb-minecraft-offline.png",
        "thumb-rootmc-offline.jpg",
        "minecraft-offline.jpg",
        "rootmc-offline.jpg",
    )
    return [thumbs / n for n in names]


def offline_thumb() -> Path | None:
    for p in _thumb_candidates():
        if p.is_file() and p.stat().st_size > 1000:
            return p
    return None


def _cmdlines() -> list[str]:
    out = []
    try:
        for d in Path("/proc").iterdir():
            if not d.name.isdigit():
                continue
            try:
                raw = (d / "cmdline").read_bytes()
            except OSError:
                continue
            text = raw.replace(b"\x00", b" ").decode("utf-8", "replace").strip().lower()
            if text:
                out.append(text)
    except OSError:
        pass
    return out


def client_running() -> bool:
    for cmd in _cmdlines():
        if any(s in cmd for s in _SERVER_MARKERS) and "net.minecraft.client" not in cmd:
            continue
        if any(m in cmd for m in _CLIENT_MARKERS):
            return True
        if "minecraft" in cmd and "java" in cmd and "--nogui" not in cmd and "paper-" not in cmd:
            return True
    return False


def load_state() -> dict:
    if not STATE_PATH.is_file():
        return {}
    try:
        return json.loads(STATE_PATH.read_text())
    except Exception:
        return {}


def save_state(data: dict) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(data, indent=2))


def snapshot(*, players_online: int | None = None) -> dict:
    """ingame = local Minecraft client, with a short drop-out grace."""
    now = time.time()
    prev = load_state()
    live_now = client_running()
    last_seen = float(prev.get("last_seen") or 0)
    if live_now:
        last_seen = now
    ingame = live_now or (last_seen and (now - last_seen) < GRACE_S)
    thumb = offline_thumb()
    data = {
        "ingame": bool(ingame),
        "was_ingame": bool(prev.get("ingame")),
        "client_now": live_now,
        "last_seen": last_seen or None,
        "grace_s": GRACE_S,
        "players_online": players_online,
        "offline_thumb": str(thumb) if thumb else None,
        "thumb_ready": bool(thumb),
        "updated_at": now,
        "ticks_mc": int(prev.get("ticks_mc") or 0),
        "ticks_other": int(prev.get("ticks_other") or 0),
    }
    save_state(data)
    return data


def record_tick(mc: bool) -> dict:
    st = load_state()
    key = "ticks_mc" if mc else "ticks_other"
    st[key] = int(st.get(key) or 0) + 1
    # keep ratio from exploding
    if st.get("ticks_mc", 0) + st.get("ticks_other", 0) > 40:
        st["ticks_mc"] = max(1, int(st.get("ticks_mc") or 0) // 2)
        st["ticks_other"] = max(1, int(st.get("ticks_other") or 0) // 2)
    save_state(st)
    return st


def mc_share() -> float:
    st = load_state()
    mc = int(st.get("ticks_mc") or 0)
    other = int(st.get("ticks_other") or 0)
    total = mc + other
    return (mc / total) if total else 0.0

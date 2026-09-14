"""
Player economy cron — snapshot, Kīlauea multiplier check, post to #automations.

Runs every 10 minutes. Reads current Kīlauea alert level from the kilauea cron
state file and applies the economy multiplier via RCON if it has changed.
"""

from __future__ import annotations

import json
import logging
import os
import socket
from datetime import datetime
from pathlib import Path

log = logging.getLogger("ava.cron.economy")

# Path to kilauea alert state written by the kilauea cron
_KILAUEA_STATE_PATH: Path | None = None
_last_multiplier: float = 1.0
_last_alert: str = "normal"


def _kilauea_state_path() -> Path:
    global _KILAUEA_STATE_PATH
    if _KILAUEA_STATE_PATH is None:
        from apps.core import config
        _KILAUEA_STATE_PATH = config.DATA_DIR / "state" / "kilauea-alert.json"
    return _KILAUEA_STATE_PATH


def _read_alert_level() -> str:
    """Read latest Kīlauea alert level from state file. Defaults to 'normal'."""
    p = _kilauea_state_path()
    try:
        if p.exists():
            data = json.loads(p.read_text())
            return data.get("alert_level", "normal")
    except Exception as e:
        log.debug("Could not read kilauea alert state: %s", e)
    return "normal"


def _rcon_command(host: str, port: int, password: str, command: str, timeout: int = 5) -> str:
    """Send a single RCON command. Returns response string or error."""
    import struct

    def _pack(req_id: int, req_type: int, body: str) -> bytes:
        payload = body.encode("utf-8") + b"\x00\x00"
        length = 4 + 4 + len(payload)
        return struct.pack("<iii", length, req_id, req_type) + payload

    def _unpack(data: bytes) -> tuple[int, int, str]:
        length, req_id, req_type = struct.unpack("<iii", data[:12])
        body = data[12:12 + length - 10].decode("utf-8", errors="replace")
        return req_id, req_type, body

    try:
        with socket.create_connection((host, port), timeout=timeout) as s:
            # Auth
            s.sendall(_pack(1, 3, password))
            auth_resp = s.recv(4096)
            req_id, _, _ = _unpack(auth_resp)
            if req_id == -1:
                return "RCON auth failed"
            # Command
            s.sendall(_pack(2, 2, command))
            resp = s.recv(4096)
            _, _, body = _unpack(resp)
            return body.strip()
    except Exception as e:
        return f"RCON error: {e}"


def _apply_multiplier_rcon(multiplier: float) -> bool:
    """
    Push the economy multiplier to the live server via RCON.
    Uses /rooteconomy multiplier <value> — adjust command if plugin differs.
    """
    from apps.core import config
    host = os.getenv("AVA_RCON_PRIMARY_HOST") or os.getenv("AVA_RCON_HOST", "")
    port = int(os.getenv("AVA_RCON_PRIMARY_PORT") or os.getenv("AVA_RCON_PORT", "25575"))
    password = os.getenv("AVA_RCON_PRIMARY_PASSWORD") or os.getenv("AVA_RCON_PASSWORD", "")

    if not host or not password:
        log.warning("RCON not configured — multiplier not pushed to server")
        return False

    cmd = f"rooteconomy multiplier {multiplier:.2f}"
    resp = _rcon_command(host, port, password, cmd)
    log.info("RCON multiplier set %.2f → %r", multiplier, resp)
    return "error" not in resp.lower() and "failed" not in resp.lower()


async def run():
    global _last_multiplier, _last_alert

    from apps.core import config
    from apps.core.services import discord
    from apps.core.crons.kilauea import get_multiplier

    now_hst = datetime.now().strftime("%H:%M HST — %a, %b %-d")

    # ── Kīlauea multiplier check ────────────────────────────────────────────
    alert_level = _read_alert_level()
    multiplier = get_multiplier(alert_level)

    multiplier_changed = abs(multiplier - _last_multiplier) > 0.01
    if multiplier_changed:
        log.info("Kīlauea alert changed: %s → %s (multiplier %.1f → %.1f)",
                 _last_alert, alert_level, _last_multiplier, multiplier)
        _apply_multiplier_rcon(multiplier)
        _last_multiplier = multiplier
        _last_alert = alert_level

        # Write updated state for other crons to read
        state_path = _kilauea_state_path()
        state_path.parent.mkdir(parents=True, exist_ok=True)
        state_path.write_text(json.dumps({
            "alert_level": alert_level,
            "multiplier": multiplier,
            "updated_at": datetime.utcnow().isoformat(),
        }))

    # ── Economy snapshot ────────────────────────────────────────────────────
    # TODO: replace stub with MySQL query once economy DB is hooked up
    # query: SELECT COUNT(*) as players, SUM(balance) as total_gold FROM root_economy_balances
    economy_note = "_(economy DB hookup pending — MySQL creds ready in .env)_"

    mult_line = ""
    if multiplier != 1.0:
        mult_line = f"\n🌋 **Kīlauea {alert_level.title()}** — economy multiplier **×{multiplier:.1f}** active"
    if multiplier_changed and multiplier != 1.0:
        mult_line += " _(just applied via RCON)_"

    content = (
        f"**Player base + economy** — {now_hst}\n"
        f"{economy_note}"
        f"{mult_line}"
    )

    await discord.post_message(config.DISCORD_CHANNELS.get("automations", ""), content)
    log.info("Player economy posted (alert=%s mult=%.2f changed=%s)",
             alert_level, multiplier, multiplier_changed)

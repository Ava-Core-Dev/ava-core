"""
Source RCON client (asyncio) — replaces the retired Node rconGuard.mjs.

Protocol, little-endian throughout:
    int32 length (bytes that follow) | int32 request id | int32 type | body\\0\\0

Types: 3 = auth, 2 = exec command / auth response, 0 = response value.
A response id of -1 to an auth request means the password was rejected.
"""

from __future__ import annotations

import asyncio
import logging
import struct
import time

from .. import config

log = logging.getLogger("ava.rcon")

AUTH = 3
AUTH_RESPONSE = 2
EXEC = 2
RESPONSE_VALUE = 0

# Commands that can wipe or hand over the server. Blocked unless allow=True.
DESTRUCTIVE = (
    "stop", "restart", "ban", "ban-ip", "pardon", "op", "deop",
    "whitelist off", "kill @a", "gamerule", "difficulty", "save-off",
)

_quiet_until = 0.0
_QUIET_S = 600.0


class RconError(Exception):
    pass


def _packet(req_id: int, kind: int, body: str) -> bytes:
    payload = struct.pack("<ii", req_id, kind) + body.encode("utf-8") + b"\x00\x00"
    return struct.pack("<i", len(payload)) + payload


async def _read_packet(reader: asyncio.StreamReader) -> tuple[int, int, str]:
    raw_len = await reader.readexactly(4)
    (length,) = struct.unpack("<i", raw_len)
    payload = await reader.readexactly(length)
    req_id, kind = struct.unpack("<ii", payload[:8])
    body = payload[8:].rstrip(b"\x00").decode("utf-8", errors="replace")
    return req_id, kind, body


def resolve_target(target: str | None) -> tuple[str, str, int, str]:
    """Return (name, host, port, password) for a target key."""
    name = (target or config.RCON_DEFAULT_TARGET or "test").strip().lower()
    if name not in config.RCON_TARGETS:
        raise RconError(
            f"unknown target {name!r}; known: {', '.join(sorted(config.RCON_TARGETS))}"
        )
    host, port, password = config.RCON_TARGETS[name]
    if not host or not password:
        raise RconError(f"target {name!r} is missing host or password in .env")
    return name, host, port, password


def is_destructive(command: str) -> bool:
    cmd = command.strip().lower().lstrip("/")
    return any(cmd == d or cmd.startswith(d + " ") for d in DESTRUCTIVE)


async def execute(
    command: str,
    target: str | None = None,
    allow: bool = False,
    timeout: float = 15.0,
) -> dict:
    """Run one RCON command. Returns a dict rather than raising, so route
    handlers can pass the result straight through to the GUI."""
    cmd = command.strip()
    if not cmd:
        return {"ok": False, "reason": "empty"}

    try:
        name, host, port, password = resolve_target(target)
    except RconError as e:
        return {"ok": False, "reason": "target", "detail": str(e)}

    global _quiet_until
    if _quiet_until and time.monotonic() < _quiet_until:
        return {"ok": False, "reason": "error", "target": name, "detail": "rcon_backoff"}

    if is_destructive(cmd) and not allow:
        return {
            "ok": False,
            "reason": "blocked",
            "detail": f"{cmd!r} is destructive; resend with allow=true to confirm",
            "target": name,
        }

    try:
        return await asyncio.wait_for(
            _run(cmd, name, host, port, password), timeout=timeout
        )
    except asyncio.TimeoutError:
        _quiet_until = time.monotonic() + _QUIET_S
        return {"ok": False, "reason": "timeout", "target": name,
                "detail": f"no response from {host}:{port} in {timeout}s"}
    except Exception as e:  # connection refused, auth failure, protocol error
        _quiet_until = time.monotonic() + _QUIET_S
        log.warning("RCON %s failed: %s — quiet %ss", name, e, int(_QUIET_S))
        return {"ok": False, "reason": "error", "target": name, "detail": str(e)}


async def _run(cmd: str, name: str, host: str, port: int, password: str) -> dict:
    reader, writer = await asyncio.open_connection(host, port)
    try:
        writer.write(_packet(1, AUTH, password))
        await writer.drain()

        # Some servers emit an empty RESPONSE_VALUE before the auth response.
        req_id, kind, _ = await _read_packet(reader)
        if kind == RESPONSE_VALUE:
            req_id, kind, _ = await _read_packet(reader)
        if req_id == -1:
            raise RconError("authentication failed (bad RCON password)")

        writer.write(_packet(2, EXEC, cmd))
        await writer.drain()
        _, _, body = await _read_packet(reader)

        return {
            "ok": True,
            "target": name,
            "host": f"{host}:{port}",
            "command": cmd,
            "output": body.strip(),
        }
    finally:
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass

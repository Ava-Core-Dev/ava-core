"""Minecraft server status, log tail, RCON and service control routes.

These back the Minecraft tab of the desktop GUI, which used to import the Node
modules minecraftControl.mjs / rconGuard.mjs directly.
"""
from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter
from pydantic import BaseModel

from .. import config
from ..services import rcon as rcon_service

router = APIRouter(prefix="/api/minecraft")
log = logging.getLogger("ava.minecraft")


async def _ping(host: str, port: int) -> dict:
    """Simple TCP ping to check if a Minecraft server is accepting connections."""
    started = asyncio.get_event_loop().time()
    try:
        _, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port), timeout=5
        )
        writer.close()
        await writer.wait_closed()
        ms = int((asyncio.get_event_loop().time() - started) * 1000)
        return {"online": True, "host": host, "port": port, "latency_ms": ms}
    except Exception as e:
        return {"online": False, "host": host, "port": port, "error": str(e)}


async def _unit_state(unit: str) -> dict:
    try:
        proc = await asyncio.create_subprocess_exec(
            "systemctl",
            "show",
            unit,
            "-p",
            "ActiveState",
            "-p",
            "SubState",
            "-p",
            "MainPID",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=3)
    except Exception as e:
        return {"active": False, "pid": 0, "detail": str(e)}
    fields = {}
    for line in out.decode("utf-8", errors="replace").splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            fields[k.strip()] = v.strip()
    pid = 0
    try:
        pid = int(fields.get("MainPID") or 0)
    except ValueError:
        pid = 0
    return {
        "active": fields.get("ActiveState") == "active",
        "sub": fields.get("SubState") or "",
        "pid": pid,
    }


def _paper_meta() -> dict:
    d = config.MC_TEST_DIR
    jars = sorted(d.glob("paper*.jar")) + sorted(d.glob("server.jar"))
    plugins = list((d / "plugins").glob("*.jar")) if (d / "plugins").is_dir() else []
    log_path = d / "logs" / "latest.log"
    return {
        "jar": jars[0].name if jars else None,
        "plugins": len(plugins),
        "logFile": str(log_path) if log_path.is_file() else None,
        "logBytes": log_path.stat().st_size if log_path.is_file() else 0,
    }


@router.get("/status")
async def minecraft_status():
    live, test, unit = await asyncio.gather(
        _ping(config.MC_LIVE_HOST, config.MC_LIVE_PORT),
        _ping(config.MC_TEST_HOST, config.MC_TEST_PORT),
        _unit_state(config.MC_UNIT),
    )
    running = bool(unit.get("active") or test.get("online"))
    test_rcon = config.RCON_TARGETS.get("test") or ("127.0.0.1", 25575, "")
    rcon_targets = [
        {"id": name, "host": host, "port": port}
        for name, (host, port, _pw) in config.RCON_TARGETS.items()
        if host
    ]
    meta = _paper_meta()
    pid = unit.get("pid") or 0
    return {
        "ok": True,
        "running": running,
        "pids": [pid] if pid else [],
        "serverPort": config.MC_TEST_PORT,
        "rconPort": test_rcon[1],
        "rconTargets": rcon_targets,
        "motd": test.get("motd") or ("Paper test up" if running else ""),
        "plugins": meta["plugins"],
        "jar": meta["jar"],
        "logFile": meta["logFile"],
        "logBytes": meta["logBytes"],
        "live": live,
        "test": test,
        "unitState": unit,
        "online": running,
        "players": {"online": live.get("players_online"), "max": live.get("players_max")},
        "latency_ms": test.get("latency_ms") if running else live.get("latency_ms"),
        "version": live.get("version"),
        "dir": str(config.MC_TEST_DIR),
        "dirPresent": config.MC_TEST_DIR.is_dir(),
        "unit": config.MC_UNIT,
        "join": config.MC_TEST_JOIN,
    }


@router.get("/log")
async def minecraft_log(bytes: int = 200_000, lines: int = 220):
    """Tail the Paper server log. Reads only the last `bytes` of the file so a
    multi-hundred-megabyte latest.log never lands in memory."""
    path = config.MC_TEST_DIR / "logs" / "latest.log"
    if not path.is_file():
        return {
            "ok": False,
            "detail": f"log not found at {path}",
            "path": str(path),
            "lines": [],
        }
    try:
        window = max(1024, min(int(bytes), 4_000_000))
        size = path.stat().st_size
        with path.open("rb") as fh:
            if size > window:
                fh.seek(size - window)
                fh.readline()  # discard the partial first line
            tail = fh.read().decode("utf-8", errors="replace")
        out = tail.splitlines()[-max(1, min(int(lines), 5000)):]
        return {
            "ok": True,
            "path": str(path),
            "size": size,
            "lines": out,
            "text": "\n".join(out),
        }
    except Exception as e:
        log.warning("log tail failed: %s", e)
        return {"ok": False, "detail": str(e), "path": str(path), "lines": []}


class RconBody(BaseModel):
    command: str
    target: str | None = None
    allow: bool = False


@router.post("/rcon")
async def minecraft_rcon(body: RconBody):
    return await rcon_service.execute(
        body.command, target=body.target, allow=body.allow
    )


class ControlBody(BaseModel):
    action: str


@router.post("/control")
async def minecraft_control(body: ControlBody):
    """Start/stop/restart the Paper test server via its systemd unit.

    Runs `sudo -n` so it never blocks on a password prompt; if no passwordless
    rule exists the response says exactly which sudoers line to add.
    """
    action = body.action.strip().lower()
    if action not in {"start", "stop", "restart"}:
        return {"ok": False, "detail": "action must be start|stop|restart"}

    unit = config.MC_UNIT
    cmd = ["sudo", "-n", "systemctl", action, unit]
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=120)
    except asyncio.TimeoutError:
        return {"ok": False, "action": action, "unit": unit,
                "detail": f"systemctl {action} timed out after 120s"}
    except FileNotFoundError as e:
        return {"ok": False, "action": action, "unit": unit, "detail": str(e)}

    err = stderr.decode("utf-8", errors="replace").strip()
    if proc.returncode != 0 and ("password" in err.lower() or "sudo:" in err.lower()):
        return {
            "ok": False,
            "action": action,
            "unit": unit,
            "reason": "needs_sudo_rule",
            "detail": (
                "passwordless systemctl is not configured. Add via `sudo visudo -f "
                f"/etc/sudoers.d/ava-minecraft`:\n"
                f"ava-core ALL=(root) NOPASSWD: /usr/bin/systemctl start {unit}, "
                f"/usr/bin/systemctl stop {unit}, /usr/bin/systemctl restart {unit}"
            ),
            "stderr": err,
        }

    return {
        "ok": proc.returncode == 0,
        "action": action,
        "unit": unit,
        "code": proc.returncode,
        "stdout": stdout.decode("utf-8", errors="replace").strip(),
        "stderr": err,
    }

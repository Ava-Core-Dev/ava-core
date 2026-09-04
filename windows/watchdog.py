"""Keep origin and the tunnel up. No console. Called by pythonw from Task Scheduler."""
from __future__ import annotations

import os
import socket
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

_DIR = Path(__file__).resolve().parent
if str(_DIR) not in sys.path:
    sys.path.insert(0, str(_DIR))
import net_gate  # noqa: E402


CREATE_NO_WINDOW = 0x08000000
# Leave Task Scheduler's job so ExecutionTimeLimit cannot kill long-lived origin/tunnel.
CREATE_BREAKAWAY_FROM_JOB = 0x01000000
CREATE_NEW_PROCESS_GROUP = 0x00000200
_SPAWN_FLAGS = CREATE_NO_WINDOW | CREATE_BREAKAWAY_FROM_JOB | CREATE_NEW_PROCESS_GROUP
REPO = Path(__file__).resolve().parents[1]
HOME = Path(os.environ.get("AVA_HOME", str(Path.home() / "ava")))
os.environ["AVA_HOME"] = str(HOME)
os.environ.setdefault("PYTHONUNBUFFERED", "1")


def _port_open(host: str = "127.0.0.1", port: int = 8787) -> bool:
    try:
        with socket.create_connection((host, port), timeout=1):
            return True
    except OSError:
        return False


def _health_ok() -> bool:
    try:
        with urllib.request.urlopen("http://127.0.0.1:8787/health", timeout=4) as r:
            return r.status == 200
    except Exception:
        return False


CF_EXES = (
    Path(r"C:\Program Files\cloudflared\cloudflared.exe"),
    Path(r"C:\Program Files (x86)\cloudflared\cloudflared.exe"),
)
CF_TOKEN = Path.home() / ".cloudflared" / "origin.token"


def _quiet_startupinfo() -> subprocess.STARTUPINFO:
    info = subprocess.STARTUPINFO()
    info.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    info.wShowWindow = 0
    return info


def _tunnel_running() -> bool:
    """A live cloudflared reconnects on its own, so presence is the only check."""
    try:
        out = subprocess.run(
            ["tasklist", "/FI", "IMAGENAME eq cloudflared.exe", "/NH"],
            capture_output=True,
            text=True,
            timeout=10,
            creationflags=CREATE_NO_WINDOW,
            startupinfo=_quiet_startupinfo(),
        )
        return "cloudflared.exe" in out.stdout
    except Exception:
        return True  # Cannot tell — never spawn a second connector on a guess.


def _ensure_tunnel() -> None:
    """origin.avaivy.cloud only answers while this connector is up."""
    if _tunnel_running() or not CF_TOKEN.is_file():
        return
    exe = next((p for p in CF_EXES if p.is_file()), None)
    if exe is None:
        return
    log = REPO / "data" / "logs" / "cloudflared.log"
    log.parent.mkdir(parents=True, exist_ok=True)
    with open(log, "a", encoding="utf-8", buffering=1) as fh:
        fh.write(f"\n---- {datetime.now(timezone.utc).isoformat()} watchdog spawn tunnel ----\n")
        subprocess.Popen(
            [str(exe), "tunnel", "run", "--token-file", str(CF_TOKEN)],
            creationflags=_SPAWN_FLAGS,
            startupinfo=_quiet_startupinfo(),
            stdout=fh,
            stderr=fh,
            stdin=subprocess.DEVNULL,
        )


online = net_gate.internet_up()
origin_up = _health_ok() or _port_open()
decision = net_gate.tick(online=online, origin_up=origin_up)
if not decision.get("allow_origin"):
    sys.exit(0)

_ensure_tunnel()

if _health_ok() or _port_open():
    if decision.get("restart_desk"):
        net_gate.start_desk()
    sys.exit(0)


def _with_jdk(env: dict) -> dict:
    """MSI PATH updates are invisible to Task Scheduler until logoff. Inject known JDKs."""
    bins: list[Path] = []
    j17: Path | None = None
    for root in (
        Path(r"C:\Program Files\Microsoft"),
        Path(r"C:\Program Files\Eclipse Adoptium"),
        Path(r"C:\Program Files\Java"),
    ):
        if not root.is_dir():
            continue
        for java in root.glob("jdk-*/bin/java.exe"):
            bins.append(java.parent)
            if "jdk-17" in java.parent.parent.name:
                j17 = java.parent.parent
    if bins:
        env["PATH"] = os.pathsep.join(str(b) for b in bins) + os.pathsep + env.get("PATH", "")
    if j17 and not env.get("JAVA_HOME"):
        env["JAVA_HOME"] = str(j17)
    return env


pythonw = REPO / ".venv" / "Scripts" / "pythonw.exe"
if not pythonw.is_file():
    sys.exit(1)

si = subprocess.STARTUPINFO()
si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
si.wShowWindow = 0

log_path = REPO / "data" / "logs" / "origin-uvicorn.log"
log_path.parent.mkdir(parents=True, exist_ok=True)
log_f = open(log_path, "a", encoding="utf-8", buffering=1)
log_f.write(f"\n---- {datetime.now(timezone.utc).isoformat()} watchdog spawn origin ----\n")
log_f.flush()

# pythonw -m uvicorn, never uvicorn.exe (console wrapper flashes a window).
# stdout/stderr must be a file — DEVNULL hid every origin line after the 2:30 spawn.
subprocess.Popen(
    [
        str(pythonw),
        "-m",
        "uvicorn",
        "apps.core.main:app",
        "--host",
        "127.0.0.1",
        "--port",
        "8787",
        "--log-level",
        "info",
        "--no-access-log",
    ],
    cwd=str(REPO),
    env=_with_jdk(os.environ.copy()),
    creationflags=_SPAWN_FLAGS,
    startupinfo=si,
    stdout=log_f,
    stderr=log_f,
    stdin=subprocess.DEVNULL,
)
if decision.get("restart_desk"):
    net_gate.start_desk()
sys.exit(0)

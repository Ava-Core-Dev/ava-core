"""Keep origin up. No console. Called by pythonw from Task Scheduler."""
from __future__ import annotations

import os
import socket
import subprocess
import sys
import urllib.request
from pathlib import Path

CREATE_NO_WINDOW = 0x08000000
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


if _health_ok() or _port_open():
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

# pythonw -m uvicorn, never uvicorn.exe (console wrapper flashes a window).
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
    creationflags=CREATE_NO_WINDOW,
    startupinfo=si,
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
    stdin=subprocess.DEVNULL,
)
sys.exit(0)

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
import operator_purge  # noqa: E402


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


def _origin_pids() -> list[int]:
    """PIDs for uvicorn apps.core (and music bed helpers when recycling hung stack)."""
    try:
        import psutil
    except Exception:
        return []
    out: list[int] = []
    try:
        for p in psutil.process_iter(["pid", "cmdline", "create_time"]):
            parts = p.info.get("cmdline") or []
            if not parts or (len(parts) > 1 and parts[1] == "-c"):
                continue
            cmd = " ".join(parts).lower()
            if "uvicorn" in cmd and "apps.core" in cmd:
                out.append(int(p.info["pid"]))
            elif "play_music_bed" in cmd:
                out.append(int(p.info["pid"]))
    except Exception:
        return out
    return out


def _youngest_origin_age_s() -> float | None:
    """Seconds since newest uvicorn apps.core started. None if none."""
    try:
        import psutil
        import time as _time
    except Exception:
        return None
    ages: list[float] = []
    try:
        now = _time.time()
        for p in psutil.process_iter(["cmdline", "create_time"]):
            parts = p.info.get("cmdline") or []
            if not parts:
                continue
            cmd = " ".join(parts).lower()
            if "uvicorn" in cmd and "apps.core" in cmd:
                ages.append(max(0.0, now - float(p.info.get("create_time") or now)))
    except Exception:
        return None
    return min(ages) if ages else None


def _origin_process_present() -> bool:
    """True if a uvicorn origin is already running (even while :8787 is briefly unbound).

    Agents that kill+respawn race the watchdog; spawning a second origin causes
    kill storms and public holding. Presence alone means do not spawn — unless
    health is dark (hung port-open stack); see _recycle_hung_origin.
    """
    try:
        import psutil
    except Exception:
        return False
    try:
        for p in psutil.process_iter(["pid", "cmdline"]):
            parts = p.info.get("cmdline") or []
            if not parts or (len(parts) > 1 and parts[1] == "-c"):
                continue
            cmd = " ".join(parts).lower()
            # Require uvicorn + apps.core so ad-hoc `python -c "...apps.core..."` is ignored.
            if "uvicorn" in cmd and "apps.core" in cmd:
                return True
    except Exception:
        return False
    return False


def _recycle_hung_origin() -> bool:
    """Kill origin when port/process exist but /health fails (wedged event loop).

    Public chat Worker then returns the offline stub. Watchdog used to treat
    port-open as healthy and never respawned. Returns True if a kill ran.
    """
    if _health_ok():
        return False
    if not (_port_open() or _origin_process_present()):
        return False
    age = _youngest_origin_age_s()
    # Boot prelims (Kīlauea cloud generate, NWS, …) can run several minutes.
    # Killing mid-boot caused public chat offline flaps.
    if age is not None and age < 300.0:
        return False
    # Cooldown file so Task Scheduler ticks do not thrash.
    stamp = REPO / "data" / "state" / "watchdog-hung-recycle.json"
    try:
        import json
        import time as _time

        stamp.parent.mkdir(parents=True, exist_ok=True)
        if stamp.is_file():
            prev = json.loads(stamp.read_text(encoding="utf-8"))
            last = float(prev.get("at_unix") or 0)
            if _time.time() - last < 120.0:
                return False
        stamp.write_text(
            json.dumps(
                {
                    "at_unix": _time.time(),
                    "at": datetime.now(timezone.utc).isoformat(),
                    "reason": "health_fail_port_or_process_present",
                    "pids": _origin_pids(),
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
    except Exception:
        pass
    for pid in _origin_pids():
        try:
            subprocess.run(
                ["taskkill", "/PID", str(pid), "/T", "/F"],
                capture_output=True,
                creationflags=CREATE_NO_WINDOW,
                startupinfo=_quiet_startupinfo(),
                timeout=15,
            )
        except Exception:
            pass
    # Brief wait so :8787 unbinds before spawn.
    try:
        import time as _time

        _time.sleep(2)
    except Exception:
        pass
    return True


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


# Operator "Clear desk" purge — stay dark until windows/operator_purge.py --clear
if operator_purge.is_active():
    sys.exit(0)

online = net_gate.internet_up()
# Prefer real health for net_gate. Port-open alone hid hung origins from the gate.
origin_up = _health_ok()
decision = net_gate.tick(online=online, origin_up=origin_up)
if not decision.get("allow_origin"):
    sys.exit(0)

_ensure_tunnel()

# Hung: process/port up but /health dark → kill once, then spawn below.
recycled = _recycle_hung_origin()

if _health_ok():
    if decision.get("restart_desk"):
        net_gate.start_desk()
    sys.exit(0)

# Still warming (young process, health not ready) — do not dual-spawn.
age = _youngest_origin_age_s()
if (not recycled) and _origin_process_present() and age is not None and age < 300.0:
    sys.exit(0)

# Process still listed after a failed/cooldown recycle — wait next tick.
if (not recycled) and _origin_process_present():
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
env = _with_jdk(os.environ.copy())
env.setdefault("PYTHONUTF8", "1")
env.setdefault("PYTHONIOENCODING", "utf-8")
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
    env=env,
    creationflags=_SPAWN_FLAGS,
    startupinfo=si,
    stdout=log_f,
    stderr=log_f,
    stdin=subprocess.DEVNULL,
)
if decision.get("restart_desk"):
    net_gate.start_desk()
sys.exit(0)

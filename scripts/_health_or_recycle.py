"""Quick health + optional recycle. Kill all uvicorn+beds; one origin only."""
from __future__ import annotations

import subprocess
import sys
import time
import urllib.request

ROOT = r"C:\Users\rootr\ava"
PYW = ROOT + r"\.venv\Scripts\pythonw.exe"
WD = r"C:\Users\rootr\RootRecord Core Ops\WatchDog\watchdog.py"


def health(timeout: float = 4.0) -> str:
    try:
        with urllib.request.urlopen("http://127.0.0.1:8787/health", timeout=timeout) as r:
            return r.read().decode("utf-8", "replace")
    except Exception as e:
        return f"FAIL:{type(e).__name__}:{e}"


def _kill_ava_stack() -> list[str]:
    """Kill every uvicorn apps.core + music bed helper. Return killed PIDs."""
    killed: list[str] = []
    try:
        import psutil
    except Exception:
        psutil = None  # type: ignore
    if psutil is not None:
        for proc in psutil.process_iter(["pid", "cmdline"]):
            try:
                cmd = " ".join(proc.info.get("cmdline") or [])
            except Exception:
                continue
            if "uvicorn apps.core.main:app" in cmd or "play_music_bed" in cmd:
                pid = str(proc.info["pid"])
                print("kill", pid, cmd[:120])
                subprocess.run(["taskkill", "/PID", pid, "/T", "/F"], capture_output=True)
                killed.append(pid)
    # Also netstat listeners on 8787
    try:
        out = subprocess.check_output(["netstat", "-ano"], text=True, errors="replace")
    except Exception as e:
        print("netstat", e)
        return killed
    for line in out.splitlines():
        if "127.0.0.1:8787" in line and "LISTEN" in line:
            parts = line.split()
            if parts:
                pid = parts[-1]
                if pid not in killed:
                    print("kill listen", pid)
                    subprocess.run(["taskkill", "/PID", pid, "/T", "/F"], capture_output=True)
                    killed.append(pid)
    return killed


def main() -> int:
    h = health()
    print("health1", h[:200])
    if h.startswith("{") and '"ok"' in h:
        return 0
    _kill_ava_stack()
    time.sleep(2)
    # Clear bed wanted so watchdog does not immediately respawn music under a half-dead origin.
    try:
        wanted = ROOT + r"\data\state\music-bed-wanted.txt"
        with open(wanted, "w", encoding="utf-8") as f:
            f.write("0\n")
    except Exception:
        pass
    subprocess.Popen([PYW, WD], cwd=ROOT, close_fds=True)
    for i in range(20):
        time.sleep(2)
        h = health()
        print(f"wait{i}", h[:160])
        if h.startswith("{") and '"ok"' in h:
            return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())

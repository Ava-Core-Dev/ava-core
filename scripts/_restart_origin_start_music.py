"""Recycle origin once (watchdog), start music bed, print status. No Grok."""
from __future__ import annotations

import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def http_json(method: str, url: str, body: dict | None = None, timeout: float = 8.0):
    data = None
    headers = {}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def main() -> int:
    # Find listener on 8787
    try:
        out = subprocess.check_output(
            ["netstat", "-ano"], text=True, stderr=subprocess.DEVNULL
        )
    except Exception as e:
        print("netstat failed", e)
        return 1
    pids = set()
    for line in out.splitlines():
        if "127.0.0.1:8787" in line and "LISTENING" in line:
            parts = line.split()
            if parts:
                pids.add(parts[-1])
    for pid in sorted(pids):
        print("kill listen", pid)
        subprocess.run(["taskkill", "/F", "/PID", pid, "/T"], capture_output=True)
    time.sleep(1.5)
    pyw = Path(sys.executable).with_name("pythonw.exe")
    if not pyw.is_file():
        pyw = Path(sys.executable)
    wd = Path.home() / "RootRecord Core Ops" / "WatchDog" / "watchdog.py"
    subprocess.Popen(
        [str(pyw), str(wd)],
        cwd=str(ROOT),
        close_fds=True,
    )
    print("watchdog spawned", pyw)
    for i in range(40):
        time.sleep(1)
        try:
            h = http_json("GET", "http://127.0.0.1:8787/health", timeout=3)
            if h.get("ok"):
                print("health", h)
                break
        except Exception as e:
            print("wait", i, type(e).__name__)
    else:
        print("health never came back")
        return 2
    try:
        stop = http_json(
            "POST",
            "http://127.0.0.1:8787/api/voice/music",
            {"action": "stop"},
            timeout=5,
        )
        print("stop", stop)
    except Exception as e:
        print("stop err", e)
    time.sleep(0.5)
    start = http_json(
        "POST",
        "http://127.0.0.1:8787/api/voice/music",
        {"action": "start"},
        timeout=15,
    )
    print("start", start)
    time.sleep(2)
    st = http_json("GET", "http://127.0.0.1:8787/api/voice/status", timeout=5)
    music = (st or {}).get("music") or st
    print("status", json.dumps(music if isinstance(music, dict) else st, indent=2)[:1200])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

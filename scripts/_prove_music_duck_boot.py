"""Single-origin boot + music + duck proof. Kills every apps.core uvicorn first."""
from __future__ import annotations

import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CREATE_NO_WINDOW = 0x08000000


def http(method: str, url: str, body: dict | None = None, timeout: float = 8.0):
    data = None
    headers = {}
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def kill_all_origin_and_bed() -> None:
    try:
        out = subprocess.check_output(
            [
                "powershell",
                "-NoProfile",
                "-Command",
                "Get-CimInstance Win32_Process | "
                "Where-Object { $_.CommandLine -match 'uvicorn.*apps.core|play_music_bed|AVA_MUSIC_BED|AVA_VOICE_CLIP' } | "
                "ForEach-Object { $_.ProcessId }",
            ],
            text=True,
            stderr=subprocess.DEVNULL,
            creationflags=CREATE_NO_WINDOW,
        )
    except Exception:
        out = ""
    for line in out.splitlines():
        pid = line.strip()
        if pid.isdigit():
            print("kill", pid)
            subprocess.run(
                ["taskkill", "/F", "/PID", pid],
                capture_output=True,
                creationflags=CREATE_NO_WINDOW,
            )
    time.sleep(2.0)


def main() -> int:
    kill_all_origin_and_bed()
    pyw = ROOT / ".venv" / "Scripts" / "pythonw.exe"
    if not pyw.is_file():
        pyw = Path(sys.executable).with_name("pythonw.exe")
    subprocess.Popen(
        [
            str(pyw),
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
        cwd=str(ROOT),
        creationflags=CREATE_NO_WINDOW,
    )
    print("spawned origin")
    for i in range(40):
        time.sleep(1)
        try:
            h = http("GET", "http://127.0.0.1:8787/health", timeout=3)
            if h.get("ok"):
                print("health", h)
                break
        except Exception as e:
            print("wait", i, type(e).__name__)
    else:
        print("health never came back")
        return 2

    # Wait out startup / nws voice if any
    for i in range(90):
        st = http("GET", "http://127.0.0.1:8787/api/voice/status", timeout=5)
        if not st.get("current"):
            print("voice idle at", i)
            break
        print("voice busy", st.get("current"))
        time.sleep(1)

    http("POST", "http://127.0.0.1:8787/api/voice/music", {"action": "stop"}, timeout=5)
    time.sleep(0.5)
    start = http("POST", "http://127.0.0.1:8787/api/voice/music", {"action": "start"}, timeout=8)
    print("start", start.get("ok"), start.get("tracks"))
    time.sleep(2.5)
    before = http("GET", "http://127.0.0.1:8787/api/voice/status", timeout=5)
    m0 = before.get("music") or {}
    track = m0.get("current")
    print("BEFORE", track, "ducked", m0.get("ducked"), "pid", m0.get("player_pid"))
    if not track:
        print("no track playing")
        return 3

    http(
        "POST",
        "http://127.0.0.1:8787/api/voice/play",
        {"clip": "status", "priority": "REPORT"},
        timeout=5,
    )
    saw_duck = False
    same = True
    for i in range(20):
        time.sleep(0.3)
        st = http("GET", "http://127.0.0.1:8787/api/voice/status", timeout=5)
        m = st.get("music") or {}
        ducked = bool(m.get("ducked") or m.get("hold"))
        if ducked:
            saw_duck = True
        if m.get("current") and m.get("current") != track:
            same = False
        print(
            f"t+{0.3*(i+1):.1f} voice={st.get('current')} track={m.get('current')} "
            f"ducked={ducked} playing={(st.get('currently_playing') or {}).get('music', {}).get('playing')}"
        )
        if saw_duck and st.get("current") == "status":
            # enough evidence mid-clip
            pass
        if saw_duck and not st.get("current") and i > 4:
            break

    time.sleep(1.0)
    after = http("GET", "http://127.0.0.1:8787/api/voice/status", timeout=5)
    m1 = after.get("music") or {}
    print(
        "AFTER",
        m1.get("current"),
        "ducked",
        m1.get("ducked"),
        "hold",
        m1.get("hold"),
    )
    print(
        "PROOF",
        {
            "saw_duck": saw_duck,
            "same_track_during": same,
            "track_before": track,
            "track_after": m1.get("current"),
            "health_ok": http("GET", "http://127.0.0.1:8787/health", timeout=3).get("ok"),
        },
    )
    return 0 if saw_duck and same else 1


if __name__ == "__main__":
    raise SystemExit(main())

"""Start Ava Desk from C:\\Users\\rootr\\ava. pythonw. No powershell.exe."""
from __future__ import annotations

import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

CREATE_NO_WINDOW = 0x08000000
REPO = Path(__file__).resolve().parents[1]
DESK = REPO / "apps" / "desktop"
ELECTRON = DESK / "node_modules" / "electron" / "dist" / "electron.exe"
PYTHONW = REPO / ".venv" / "Scripts" / "pythonw.exe"
WATCHDOG = Path.home() / "RootRecord Core Ops" / "WatchDog" / "watchdog.py"


def _si_hidden():
    info = subprocess.STARTUPINFO()
    info.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    info.wShowWindow = 0
    return info


def _origin_up() -> bool:
    try:
        with urllib.request.urlopen("http://127.0.0.1:8787/health", timeout=3) as r:
            return r.status == 200
    except Exception:
        return False


def _ensure_origin() -> None:
    if _origin_up():
        return
    if not PYTHONW.is_file() or not WATCHDOG.is_file():
        return
    env = os.environ.copy()
    env["AVA_HOME"] = str(REPO)
    env["AVA_HANDOFF"] = str(REPO)
    subprocess.Popen(
        [str(PYTHONW), str(WATCHDOG)],
        cwd=str(REPO),
        env=env,
        creationflags=CREATE_NO_WINDOW,
        startupinfo=_si_hidden(),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    for _ in range(20):
        time.sleep(0.5)
        if _origin_up():
            return


def _kill_desk() -> None:
    try:
        import psutil
    except Exception:
        subprocess.run(
            ["taskkill", "/F", "/IM", "electron.exe"],
            capture_output=True,
            creationflags=CREATE_NO_WINDOW,
        )
        return
    electron = str(ELECTRON).lower()
    desk = str(DESK).lower()
    for p in psutil.process_iter(["pid", "name", "cmdline", "exe"]):
        name = str(p.info.get("name") or "").lower()
        if name != "electron.exe":
            continue
        cmd = " ".join(str(x) for x in (p.info.get("cmdline") or [])).lower()
        if "--type=" in cmd:
            continue
        exe = str(p.info.get("exe") or "").lower()
        if electron in exe or electron in cmd or desk in cmd:
            try:
                p.kill()
            except Exception:
                pass
    time.sleep(0.4)


def main() -> int:
    os.environ["AVA_HOME"] = str(REPO)
    os.environ["AVA_HANDOFF"] = str(REPO)
    os.environ["AVA_ENV_FILE"] = str(REPO / ".env")
    # Opening Desk undoes Clear desk purge (tasks + origin) without a manual command.
    try:
        win_dir = str(Path(__file__).resolve().parent)
        watchdog_dir = str(Path.home() / "RootRecord Core Ops" / "WatchDog")
        for import_dir in (watchdog_dir, win_dir):
            if import_dir not in sys.path:
                sys.path.insert(0, import_dir)
        import operator_purge

        operator_purge.clear_if_active()
    except Exception:
        pass
    os.chdir(str(DESK))
    if not ELECTRON.is_file():
        return 1
    _ensure_origin()
    _kill_desk()
    env = os.environ.copy()
    si = subprocess.STARTUPINFO()
    si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    si.wShowWindow = 1  # SW_SHOWNORMAL
    subprocess.Popen(
        [str(ELECTRON), "."],
        cwd=str(DESK),
        env=env,
        startupinfo=si,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

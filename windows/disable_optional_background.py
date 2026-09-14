"""Disable optional HP, Discord, and AMD UI background processes on Windows."""
from __future__ import annotations

import json
import os
import subprocess
import time
from pathlib import Path


CREATE_NO_WINDOW = 0x08000000
ROOT = Path(__file__).resolve().parents[1]
BACKUP_DIR = ROOT / "data" / "backups" / "optional-background"

HP_SERVICES = (
    "HP Comm Recover",
    "HPAppHelperCap",
    "HPDiagsCap",
    "HPNetworkCap",
    "HPSysInfoCap",
    "HpTouchpointAnalyticsService",
)
HP_TASKS = (
    ("\\", "Find My HP by Absolute"),
    (r"\Hewlett-Packard\HP Support Assistant", "HP Support Assistant Update Notice"),
    (r"\Hewlett-Packard\HP Support Assistant", "WarrantyChecker"),
    (r"\Hewlett-Packard\HP Support Assistant", "WarrantyChecker_DeviceScan"),
)
KILL_NAMES = {
    "hpselectperks.exe",
    "hpsystemeventutilityhost.exe",
    "hpsystemeventutilitybackground.exe",
    "hpmedianetwork.exe",
    "hp select perks.exe",
    "hp.taskgroupsmanager.exe",
    "touchpointanalyticsclientservice.exe",
    "radeonsoftware.exe",
    "cncmd.exe",
}
STARTUP_NAME_PARTS = ("hpseu", "offerupdater", "hp select", "discord")


def run(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=20,
        creationflags=CREATE_NO_WINDOW,
    )


def task_action(path: str, name: str, action: str, actions: list[str]) -> None:
    task = f"{path}{name}" if path == "\\" else f"{path}\\{name}"
    result = run(["schtasks", "/CHANGE", "/TN", task, f"/{action}"])
    actions.append(f"task {action.lower()} {task}: rc={result.returncode}")


def disable_services(actions: list[str]) -> None:
    for service in HP_SERVICES:
        run(["sc.exe", "stop", service])
        result = run(["sc.exe", "config", service, "start=", "disabled"])
        actions.append(f"service disable {service}: rc={result.returncode}")


def disable_tasks(actions: list[str]) -> None:
    for path, name in HP_TASKS:
        task_action(path, name, "DISABLE", actions)


def backup_and_remove_startup(actions: list[str]) -> None:
    backup: dict[str, dict[str, str]] = {}
    try:
        import winreg

        keys = (
            (winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Run", "HKCU"),
            (winreg.HKEY_LOCAL_MACHINE, r"Software\Microsoft\Windows\CurrentVersion\Run", "HKLM"),
        )
        for hive, subkey, label in keys:
            with winreg.OpenKey(hive, subkey, 0, winreg.KEY_READ | winreg.KEY_WRITE) as key:
                values: dict[str, str] = {}
                index = 0
                while True:
                    try:
                        name, value, _kind = winreg.EnumValue(key, index)
                    except OSError:
                        break
                    values[name] = str(value)
                    index += 1
                backup[label] = values
                for name, value in values.items():
                    blob = f"{name} {value}".lower()
                    if any(part in blob for part in STARTUP_NAME_PARTS):
                        winreg.DeleteValue(key, name)
                        actions.append(f"startup removed {label}:{name}")
    except (ImportError, OSError, PermissionError) as exc:
        actions.append(f"startup registry skipped: {exc}")

    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    backup_path = BACKUP_DIR / f"run-keys-{time.strftime('%Y%m%d-%H%M%S')}.json"
    backup_path.write_text(json.dumps(backup, indent=2) + "\n", encoding="utf-8")
    actions.append(f"startup backup {backup_path}")

    startup = Path(os.environ.get("APPDATA", "")) / r"Microsoft\Windows\Start Menu\Programs\Startup"
    for shortcut in startup.glob("*.lnk"):
        if any(part in shortcut.name.lower() for part in STARTUP_NAME_PARTS):
            shortcut.unlink(missing_ok=True)
            actions.append(f"startup shortcut removed {shortcut.name}")


def kill_processes(actions: list[str]) -> None:
    try:
        import psutil
    except ImportError as exc:
        actions.append(f"process cleanup skipped: {exc}")
        return
    for process in psutil.process_iter(["pid", "name"]):
        name = str(process.info.get("name") or "").lower()
        if name not in KILL_NAMES:
            continue
        try:
            process.kill()
            actions.append(f"killed {name} pid={process.pid}")
        except psutil.Error as exc:
            actions.append(f"kill failed {name} pid={process.pid}: {exc}")


def main() -> int:
    actions: list[str] = []
    disable_services(actions)
    disable_tasks(actions)
    backup_and_remove_startup(actions)
    kill_processes(actions)
    print(json.dumps({"ok": True, "actions": actions}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
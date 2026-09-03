"""Live host metrics for AVA-CORE on Windows (and Linux when sensors exist).

OmniBook: Ryzen AI 5 430 + Radeon 840M. NPU watts are not sampled — stock
Ollama does not use the NPU. Never invent watts.
"""
from __future__ import annotations

import os
import time
import winreg
from pathlib import Path
from typing import Any

import psutil

CREATE_NO_WINDOW = 0x08000000


def _kelvin_raw_to_c(raw: float) -> float | None:
    """Win32 thermal counters are Kelvin, tenths-Kelvin, or already °C."""
    if 200 <= raw <= 450:
        c = raw - 273.15
    elif 2000 <= raw <= 4500:
        c = raw / 10.0 - 273.15
    elif 10 <= raw <= 120:
        c = raw
    else:
        return None
    if -20 <= c <= 110:
        return round(c, 1)
    return None


def _pdh_double(counter_path: str) -> float | None:
    if os.name != "nt":
        return None
    import ctypes
    from ctypes import wintypes

    pdh = ctypes.windll.pdh
    PDH_FMT_DOUBLE = 0x00000200

    class PDH_FMT_COUNTERVALUE(ctypes.Structure):
        _fields_ = [
            ("CStatus", wintypes.DWORD),
            ("_pad", wintypes.DWORD),
            ("doubleValue", ctypes.c_double),
        ]

    h_query = wintypes.HANDLE()
    if pdh.PdhOpenQueryW(None, None, ctypes.byref(h_query)) != 0:
        return None
    try:
        h_counter = wintypes.HANDLE()
        if pdh.PdhAddEnglishCounterW(h_query, counter_path, None, ctypes.byref(h_counter)) != 0:
            return None
        pdh.PdhCollectQueryData(h_query)
        time.sleep(0.05)
        pdh.PdhCollectQueryData(h_query)
        val = PDH_FMT_COUNTERVALUE()
        if pdh.PdhGetFormattedCounterValue(h_counter, PDH_FMT_DOUBLE, None, ctypes.byref(val)) != 0:
            return None
        if val.CStatus != 0:
            return None
        return float(val.doubleValue)
    except Exception:
        return None
    finally:
        pdh.PdhCloseQuery(h_query)


def host_temp_c() -> tuple[float | None, str | None]:
    """Best-effort thermal zone / CPU temp. Returns (celsius, source)."""
    try:
        temps = getattr(psutil, "sensors_temperatures", lambda: None)() or {}
    except Exception:
        temps = {}
    prefer = ("coretemp", "k10temp", "zenpower", "cpu_thermal", "acpitz", "dell_smm")
    for name in prefer:
        entries = temps.get(name) or []
        for e in entries:
            cur = getattr(e, "current", None)
            if cur is None:
                continue
            try:
                val = float(cur)
            except (TypeError, ValueError):
                continue
            if -20 <= val <= 110:
                return round(val, 1), name
        if entries:
            try:
                val = float(entries[0].current)
                if -20 <= val <= 110:
                    return round(val, 1), name
            except (TypeError, ValueError, IndexError):
                pass
    for name, entries in temps.items():
        for e in entries:
            try:
                val = float(e.current)
            except (TypeError, ValueError, AttributeError):
                continue
            if -20 <= val <= 110:
                return round(val, 1), str(name)
    if os.name == "nt":
        for path in (
            r"\Thermal Zone Information(*)\Temperature",
            r"\Thermal Zone Information(_TZ.THRM)\Temperature",
        ):
            raw = _pdh_double(path)
            if raw is None:
                continue
            c = _kelvin_raw_to_c(raw)
            if c is not None:
                return c, "acpi_thermal_zone"
    return None, None


def host_battery() -> dict[str, Any] | None:
    try:
        batt = psutil.sensors_battery()
    except Exception:
        return None
    if batt is None:
        return None
    pct = getattr(batt, "percent", None)
    if pct is None:
        return None
    try:
        pct_f = round(float(pct), 1)
    except (TypeError, ValueError):
        return None
    plugged = bool(getattr(batt, "power_plugged", False))
    secs = getattr(batt, "secsleft", None)
    out: dict[str, Any] = {"pct": pct_f, "plugged": plugged}
    try:
        secs_i = int(secs)
        if secs_i > 0:
            out["secsleft"] = secs_i
    except (TypeError, ValueError):
        pass
    return out


def host_disks() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for part in psutil.disk_partitions(all=False):
        mp = part.mountpoint
        if not mp or mp in seen:
            continue
        seen.add(mp)
        try:
            u = psutil.disk_usage(mp)
        except OSError:
            continue
        rows.append(
            {
                "mount": mp,
                "pct": round(float(u.percent), 1),
                "used_gb": round(u.used / (1024 ** 3), 1),
                "total_gb": round(u.total / (1024 ** 3), 1),
            }
        )
    return rows


def host_disk_pct(home: Path | None = None) -> float | None:
    target = str(home) if home else os.environ.get("AVA_HOME") or str(Path.home() / "ava")
    try:
        return round(float(psutil.disk_usage(target).percent), 1)
    except OSError:
        try:
            return round(float(psutil.disk_usage("C:\\").percent), 1)
        except OSError:
            return None


def gpu_name() -> str | None:
    if os.name != "nt":
        return None
    class_root = r"SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}"
    try:
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, class_root) as root:
            for i in range(0, 8):
                sub = f"{i:04d}"
                try:
                    with winreg.OpenKey(root, sub) as k:
                        desc, _ = winreg.QueryValueEx(k, "DriverDesc")
                except OSError:
                    continue
                name = str(desc or "").strip()
                if name and "microsoft basic" not in name.lower():
                    return name
    except OSError:
        return None
    return None


def npu_present() -> bool:
    """Device present. Does not mean Ollama or Windows is using it."""
    if os.name != "nt":
        return False
    # Compute Accelerator class (AMD XDNA / NPU Compute Accelerator Device)
    try:
        with winreg.OpenKey(
            winreg.HKEY_LOCAL_MACHINE,
            r"SYSTEM\CurrentControlSet\Control\Class\{f01a9d53-3ff6-48d2-9f97-c8a7004be10c}",
        ):
            return True
    except OSError:
        pass
    try:
        with winreg.OpenKey(
            winreg.HKEY_LOCAL_MACHINE,
            r"SYSTEM\CurrentControlSet\Enum\PCI\VEN_1022&DEV_17F0&SUBSYS_8EF8103C&REV_20",
        ):
            return True
    except OSError:
        return False


def snapshot(*, home: Path | None = None) -> dict[str, Any]:
    """One live host sample. Safe to persist as jsonl."""
    cpu = float(psutil.cpu_percent(interval=0.1))
    mem = psutil.virtual_memory()
    temp_c, temp_src = host_temp_c()
    batt = host_battery()
    disk_pct = host_disk_pct(home)
    now = time.time()
    row: dict[str, Any] = {
        "at": int(now * 1000),
        "cpu_pct": round(cpu, 2),
        "mem_pct": round(float(mem.percent), 2),
        "mem_used_gb": round(mem.used / (1024 ** 3), 1),
        "mem_total_gb": round(mem.total / (1024 ** 3), 1),
        "uptime_s": int(now - psutil.boot_time()),
        "cpu_count": psutil.cpu_count() or 1,
    }
    if temp_c is not None:
        row["temp_c"] = temp_c
        if temp_src:
            row["temp_src"] = temp_src
    if batt:
        row["battery_pct"] = batt["pct"]
        row["battery_plugged"] = batt["plugged"]
        if "secsleft" in batt:
            row["battery_secsleft"] = batt["secsleft"]
    if disk_pct is not None:
        row["disk_pct"] = disk_pct
    name = gpu_name()
    if name:
        row["gpu_name"] = name
    return row

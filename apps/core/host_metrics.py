"""Live host metrics for AVA-CORE on Windows (and Linux when sensors exist).

OmniBook: Ryzen AI 5 430 + Radeon 840M. NPU watts are not sampled — stock
Ollama does not use the NPU. Never invent watts.
"""
from __future__ import annotations

import os
import shutil
import subprocess
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


# GPU Engine PDH is slow the first time. Keep the last good sample for a few seconds.
_gpu_cache: tuple[float, float | None] = (0.0, None)
_npu_cache: tuple[float, float | None] = (0.0, None)
_GPU_CACHE_S = 8.0
_NPU_MISS_RETRY_S = 300.0
_GPU_ENGINE_TYPES = frozenset(
    {"3d", "compute", "compute 0", "video codec engine", "video jpeg 0"}
)


def _pdh_counter_array(counter_path: str, *, wait_s: float = 0.75) -> list[tuple[str, float]]:
    """One PDH wildcard collect. Returns (instance_name, value) pairs."""
    if os.name != "nt":
        return []
    import ctypes
    from ctypes import wintypes

    pdh = ctypes.windll.pdh
    PDH_FMT_DOUBLE = 0x00000200
    PDH_MORE_DATA = 0x800007D2
    PDH_NO_DATA = 0x800007D5

    class PDH_FMT_COUNTERVALUE(ctypes.Structure):
        _fields_ = [
            ("CStatus", wintypes.DWORD),
            ("_pad", wintypes.DWORD),
            ("doubleValue", ctypes.c_double),
        ]

    class PDH_FMT_COUNTERVALUE_ITEM(ctypes.Structure):
        _fields_ = [
            ("szName", wintypes.LPWSTR),
            ("FmtValue", PDH_FMT_COUNTERVALUE),
        ]

    h_query = wintypes.HANDLE()
    if pdh.PdhOpenQueryW(None, None, ctypes.byref(h_query)) != 0:
        return []
    try:
        h_counter = wintypes.HANDLE()
        add = pdh.PdhAddEnglishCounterW(
            h_query, counter_path, None, ctypes.byref(h_counter)
        )
        if add != 0:
            # Localized install fallback.
            if pdh.PdhAddCounterW(h_query, counter_path, None, ctypes.byref(h_counter)) != 0:
                return []
        pdh.PdhCollectQueryData(h_query)
        time.sleep(max(0.2, wait_s))
        pdh.PdhCollectQueryData(h_query)

        def _read_array() -> list[tuple[str, float]]:
            buf_size = wintypes.DWORD(0)
            item_count = wintypes.DWORD(0)
            st = pdh.PdhGetFormattedCounterArrayW(
                h_counter,
                PDH_FMT_DOUBLE,
                ctypes.byref(buf_size),
                ctypes.byref(item_count),
                None,
            )
            code = st & 0xFFFFFFFF
            if code == PDH_NO_DATA:
                return []
            if buf_size.value <= 0:
                return []
            # First call is usually MORE_DATA with the required buffer size.
            if code not in (0, PDH_MORE_DATA):
                return []
            buf = (ctypes.c_byte * buf_size.value)()
            st = pdh.PdhGetFormattedCounterArrayW(
                h_counter,
                PDH_FMT_DOUBLE,
                ctypes.byref(buf_size),
                ctypes.byref(item_count),
                buf,
            )
            if (st & 0xFFFFFFFF) != 0 or item_count.value <= 0:
                return []
            items = ctypes.cast(buf, ctypes.POINTER(PDH_FMT_COUNTERVALUE_ITEM))
            out: list[tuple[str, float]] = []
            for i in range(item_count.value):
                item = items[i]
                if item.FmtValue.CStatus != 0 or not item.szName:
                    continue
                out.append((str(item.szName), float(item.FmtValue.doubleValue)))
            return out

        out = _read_array()
        if not out:
            # Second beat — first PDH sample is often empty.
            time.sleep(0.35)
            pdh.PdhCollectQueryData(h_query)
            out = _read_array()
        return out
    except Exception:
        return []
    finally:
        pdh.PdhCloseQuery(h_query)


def _parse_gpu_instance(name: str) -> tuple[str, str] | None:
    """pid_…_luid_HI_LO_phys_N_eng_N_engtype_TYPE → (luid, engtype)."""
    low = name.lower()
    if "luid_" not in low or "engtype_" not in low:
        return None
    try:
        after = low.split("luid_", 1)[1]
        parts = after.split("_")
        # luid_0x00000000_0x0001157F_phys_…
        luid = f"{parts[0]}_{parts[1]}"
        eng = low.split("engtype_", 1)[1].strip()
    except (IndexError, ValueError):
        return None
    return luid, eng


def gpu_pct() -> float | None:
    """Radeon 840M utilization from GPU Engine counters. None if not sampled.

    Per-process engine percents are summed per engine type, then the highest
    of 3D / Compute / video is kept — same shape Task Manager uses. Cached.
    """
    global _gpu_cache
    now = time.time()
    ts, cached = _gpu_cache
    if now - ts < _GPU_CACHE_S and cached is not None:
        return cached
    rows = _pdh_counter_array(r"\GPU Engine(*)\Utilization Percentage", wait_s=0.75)
    if not rows:
        # Do not bump success timestamp on miss — allow a quick retry next call.
        # Keep a recent last-good briefly so jsonl does not go blank on one miss.
        if cached is not None and now - ts < 90.0:
            return cached
        return None
    by_luid_eng: dict[tuple[str, str], float] = {}
    engines_by_luid: dict[str, set[str]] = {}
    for name, val in rows:
        parsed = _parse_gpu_instance(name)
        if parsed is None:
            continue
        luid, eng = parsed
        engines_by_luid.setdefault(luid, set()).add(eng)
        key = (luid, eng)
        by_luid_eng[key] = by_luid_eng.get(key, 0.0) + max(0.0, val)

    def score(luid: str) -> int:
        names = engines_by_luid.get(luid) or set()
        return sum(1 for n in names if n in _GPU_ENGINE_TYPES or n.startswith("compute"))

    if not engines_by_luid:
        if cached is not None and now - ts < 90.0:
            return cached
        return None
    luid = max(engines_by_luid, key=score)
    useful = [
        v
        for (lu, eng), v in by_luid_eng.items()
        if lu == luid and (eng in _GPU_ENGINE_TYPES or eng.startswith("compute"))
    ]
    if not useful:
        if cached is not None and now - ts < 90.0:
            return cached
        return None
    pct = round(min(100.0, max(useful)), 1)
    _gpu_cache = (now, pct)
    return pct


def _npu_via_get_counter() -> float | None:
    """PowerShell Get-Counter fallback. None when the NPU object is missing."""
    if os.name != "nt":
        return None
    ps = shutil.which("powershell") or shutil.which("pwsh")
    if not ps:
        return None
    script = (
        "$ErrorActionPreference='Stop'; "
        "try { "
        "$c=Get-Counter -Counter '\\NPU Engine(*)\\Utilization Percentage' "
        "-SampleInterval 1 -MaxSamples 1; "
        "($c.CounterSamples | Measure-Object -Property CookedValue -Maximum).Maximum "
        "} catch { '' }"
    )
    try:
        out = subprocess.run(
            [ps, "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
            capture_output=True,
            text=True,
            timeout=8,
            creationflags=CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
    except Exception:
        return None
    raw = (out.stdout or "").strip().splitlines()
    if not raw:
        return None
    try:
        return round(min(100.0, max(0.0, float(raw[-1]))), 1)
    except ValueError:
        return None


def npu_pct() -> float | None:
    """NPU utilization if Windows exposes it. None when not sampled.

    This PC (XDNA 2) has no ``NPU Engine`` PDH object in typeperf today — Task
    Manager can still show a row. Do not invent 0% from presence alone.
    """
    global _npu_cache
    now = time.time()
    ts, cached = _npu_cache
    if cached is not None and now - ts < _GPU_CACHE_S:
        return cached
    if cached is None and now - ts < _NPU_MISS_RETRY_S and ts > 0:
        return None
    for path in (
        r"\NPU Engine(*)\Utilization Percentage",
        r"\NPU(*)\Utilization Percentage",
    ):
        rows = _pdh_counter_array(path, wait_s=0.4)
        if rows:
            vals = [max(0.0, v) for _n, v in rows]
            if vals:
                pct = round(min(100.0, max(vals)), 1)
                _npu_cache = (now, pct)
                return pct
    got = _npu_via_get_counter()
    if got is not None:
        _npu_cache = (now, got)
        return got
    _npu_cache = (now, None)
    return None


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
    igpu = gpu_pct()
    if igpu is not None:
        row["gpu_pct"] = igpu
    npu = npu_pct()
    if npu is not None:
        row["npu_pct"] = npu
    row["npu_present"] = npu_present()
    return row

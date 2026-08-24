#!/usr/bin/env python3
"""
system.py

Collects system info once and saves to /home/ava-core/Database/system/system.db.

Requirements:
  pip install psutil

Optional for SMART:
  apt-get install smartmontools
  sudo to allow smartctl to access disks

Run:
  sudo python3 system.py
"""

import os
import sys
import sqlite3
import json
import time
import datetime
import shutil
import subprocess
import re
from pathlib import Path

try:
    import psutil
except Exception as exc:
    print("Missing dependency: psutil is required. Install with: pip install psutil", file=sys.stderr)
    raise

DB_PATH = Path("/home/ava-core/Database/system/system.db")
DB_DIR = DB_PATH.parent
SMART_TIMEOUT = 15  # seconds per-device


def ensure_db_dir():
    DB_DIR.mkdir(parents=True, exist_ok=True)


def connect_db():
    ensure_db_dir()
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def create_tables(conn):
    c = conn.cursor()
    c.execute("""
    CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY,
        ts_utc TEXT NOT NULL,
        hostname TEXT,
        os_info TEXT,
        uptime_seconds REAL
    )""")

    c.execute("""
    CREATE TABLE IF NOT EXISTS cpu ( run_id INTEGER, info TEXT, FOREIGN KEY(run_id) REFERENCES runs(id) )
    """)
    c.execute("""
    CREATE TABLE IF NOT EXISTS memory ( run_id INTEGER, info TEXT, FOREIGN KEY(run_id) REFERENCES runs(id) )
    """)
    c.execute("""
    CREATE TABLE IF NOT EXISTS disks (
        run_id INTEGER, device TEXT, mountpoint TEXT, fstype TEXT, usage TEXT, extra TEXT,
        FOREIGN KEY(run_id) REFERENCES runs(id)
    )""")
    c.execute("""
    CREATE TABLE IF NOT EXISTS temps ( run_id INTEGER, sensor_key TEXT, entries TEXT, FOREIGN KEY(run_id) REFERENCES runs(id) )
    """)
    c.execute("""
    CREATE TABLE IF NOT EXISTS battery ( run_id INTEGER, info TEXT, FOREIGN KEY(run_id) REFERENCES runs(id) )
    """)
    c.execute("""
    CREATE TABLE IF NOT EXISTS network (
        run_id INTEGER, iface TEXT, addrs TEXT, stats TEXT, io TEXT, FOREIGN KEY(run_id) REFERENCES runs(id)
    )""")
    c.execute("""
    CREATE TABLE IF NOT EXISTS processes (
        run_id INTEGER, pid INTEGER, username TEXT, name TEXT, status TEXT, create_time REAL,
        cpu_percent REAL, memory_percent REAL, memory_info TEXT, cmdline TEXT, exe TEXT, cwd TEXT, env TEXT,
        FOREIGN KEY(run_id) REFERENCES runs(id)
    )""")
    c.execute("""
    CREATE TABLE IF NOT EXISTS misc ( run_id INTEGER, key TEXT, value TEXT )
    """)
    c.execute("""
    CREATE TABLE IF NOT EXISTS smart (
        run_id INTEGER, device TEXT, kname TEXT, info TEXT, FOREIGN KEY(run_id) REFERENCES runs(id)
    )""")
    conn.commit()


def iso_ts():
    return datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def collect_os_info():
    info = {}
    try:
        info["platform"] = sys.platform
        if hasattr(os, "uname"):
            u = os.uname()
            info["uname"] = {
                "system": u.sysname,
                "nodename": u.nodename,
                "release": u.release,
                "version": u.version,
                "machine": u.machine
            }
    except Exception:
        info["uname_error"] = "failed to collect os.uname()"

    try:
        with open("/etc/os-release", "r") as f:
            for line in f:
                if "=" in line:
                    k, v = line.strip().split("=", 1)
                    info.setdefault("os_release", {})[k] = v.strip('"')
    except Exception:
        # not fatal on non-Linux platforms
        pass

    try:
        import platform
        info["platform_info"] = {
            "platform": platform.platform(),
            "system": platform.system(),
            "release": platform.release(),
            "version": platform.version(),
            "machine": platform.machine(),
            "processor": platform.processor()
        }
    except Exception:
        pass

    return info


def collect_cpu():
    try:
        return {
            "physical_count": psutil.cpu_count(logical=False),
            "logical_count": psutil.cpu_count(logical=True),
            "percent": psutil.cpu_percent(interval=0.1, percpu=False),
            "percent_per_cpu": psutil.cpu_percent(interval=0.1, percpu=True),
            "times": getattr(psutil.cpu_times(), "_asdict", lambda: psutil.cpu_times())(),
            "freq": psutil.cpu_freq()._asdict() if psutil.cpu_freq() else None,
        }
    except Exception as e:
        return {"error": str(e)}


def collect_memory():
    try:
        return {"virtual_memory": psutil.virtual_memory()._asdict(), "swap": psutil.swap_memory()._asdict()}
    except Exception as e:
        return {"error": str(e)}


def collect_disks():
    partitions = []
    try:
        for p in psutil.disk_partitions(all=True):
            try:
                usage = None
                try:
                    usage = psutil.disk_usage(p.mountpoint)._asdict()
                except Exception:
                    usage = None
                partitions.append({
                    "device": p.device,
                    "mountpoint": p.mountpoint,
                    "fstype": p.fstype,
                    "opts": p.opts,
                    "usage": usage
                })
            except Exception:
                continue
    except Exception:
        partitions = [{"error": "failed to list partitions"}]

    lsblk_json = None
    if shutil.which("lsblk"):
        try:
            res = subprocess.run(["lsblk", "-J", "-o", "NAME,KNAME,MODEL,SERIAL,TYPE,SIZE,ROTA,RM,MOUNTPOINT,VENDOR"],
                                 capture_output=True, text=True, timeout=5)
            if res.returncode == 0:
                try:
                    lsblk_json = json.loads(res.stdout)
                except Exception:
                    lsblk_json = None
        except Exception:
            lsblk_json = None

    return {"partitions": partitions, "lsblk": lsblk_json}


def collect_temps():
    try:
        temps = psutil.sensors_temperatures(fahrenheit=False)
        out = {}
        for k, entries in (temps or {}).items():
            out[k] = [getattr(e, "_asdict", lambda: e)() for e in entries]
        return out
    except Exception as e:
        return {"error": str(e)}


def collect_battery():
    try:
        b = psutil.sensors_battery()
        return b._asdict() if b and hasattr(b, "_asdict") else None
    except Exception as e:
        return {"error": str(e)}


def collect_network():
    try:
        if_addrs = psutil.net_if_addrs()
        if_stats = psutil.net_if_stats()
        io = psutil.net_io_counters(pernic=True)
        net = {}
        for iface, addrs in if_addrs.items():
            net[iface] = {
                "addrs": [getattr(a, "_asdict", lambda: a)() for a in addrs],
                "stats": if_stats.get(iface)._asdict() if if_stats.get(iface) and hasattr(if_stats.get(iface), "_asdict") else None,
                "io": io.get(iface)._asdict() if io.get(iface) and hasattr(io.get(iface), "_asdict") else None
            }
        return net
    except Exception as e:
        return {"error": str(e)}


def collect_processes(limit=None):
    procs = []
    try:
        for p in psutil.process_iter(attrs=['pid', 'name', 'username', 'status', 'create_time']):
            try:
                info = p.info
                try:
                    info['cpu_percent'] = p.cpu_percent(interval=0.0)
                except Exception:
                    info['cpu_percent'] = None
                try:
                    info['memory_percent'] = p.memory_percent()
                    info['memory_info'] = p.memory_info()._asdict()
                except Exception:
                    info['memory_percent'] = None
                    info['memory_info'] = None
                try:
                    cmd = p.cmdline() or []
                    info['cmdline'] = " ".join(cmd) if cmd else None
                except Exception:
                    info['cmdline'] = None
                try:
                    info['exe'] = p.exe()
                except Exception:
                    info['exe'] = None
                try:
                    info['cwd'] = p.cwd()
                except Exception:
                    info['cwd'] = None
                try:
                    info['env'] = dict(p.environ())
                except Exception:
                    info['env'] = None
                procs.append(info)
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
    except Exception:
        pass

    if limit:
        procs = sorted(procs, key=lambda x: (x.get('memory_percent') or 0), reverse=True)[:limit]
    return procs


def collect_uptime():
    try:
        boot = psutil.boot_time()
        now = time.time()
        return {"boot_time": datetime.datetime.utcfromtimestamp(boot).isoformat() + "Z", "uptime_seconds": now - boot}
    except Exception as e:
        return {"error": str(e)}


def run_smartctl(devpath):
    """Run smartctl -a -j and return JSON or an error dict."""
    if not shutil.which("smartctl"):
        return {"error": "smartctl not installed"}
    try:
        res = subprocess.run(["smartctl", "-a", "-j", devpath], capture_output=True, text=True, timeout=SMART_TIMEOUT)
        # smartctl may return non-zero but still produce JSON; try parse stdout first
        if res.stdout:
            try:
                return json.loads(res.stdout)
            except Exception:
                return {"error": "smartctl returned non-JSON output", "stdout": res.stdout, "stderr": res.stderr, "rc": res.returncode}
        return {"error": "smartctl failure", "stderr": res.stderr, "rc": res.returncode}
    except subprocess.TimeoutExpired:
        return {"error": f"smartctl timeout after {SMART_TIMEOUT}s"}
    except Exception as e:
        return {"error": str(e)}


def collect_smart(lsblk_json=None):
    results = []
    if not shutil.which("smartctl"):
        return {"error": "smartctl not found"}

    devices = []
    if lsblk_json and isinstance(lsblk_json, dict):
        for d in lsblk_json.get("blockdevices", []) if isinstance(lsblk_json.get("blockdevices", []), list) else []:
            try:
                if d.get("type") == "disk":
                    k = d.get("kname") or d.get("name")
                    if k:
                        devices.append(k)
            except Exception:
                continue

    if not devices:
        try:
            seen = set()
            for p in psutil.disk_partitions(all=True):
                dev = p.device
                if isinstance(dev, str) and dev.startswith("/dev/"):
                    base = re.sub(r'((?:p)?\d+)$', '', dev)
                    k = os.path.basename(base)
                    if k and k not in seen:
                        seen.add(k)
                        devices.append(k)
        except Exception:
            pass

    if not devices:
        devices = ["sda", "nvme0n1"]

    for k in devices:
        devpath = "/dev/" + k
        smart = run_smartctl(devpath)
        results.append({"device": devpath, "kname": k, "smart": smart})

    return results


def save_all(conn, collected):
    c = conn.cursor()
    meta = collected["meta"]
    c.execute("INSERT INTO runs (ts_utc, hostname, os_info, uptime_seconds) VALUES (?, ?, ?, ?)",
              (meta["ts_utc"], meta.get("hostname"), json.dumps(meta.get("os_info") or {}), meta.get("uptime_seconds")))
    run_id = c.lastrowid

    c.execute("INSERT INTO cpu (run_id, info) VALUES (?, ?)", (run_id, json.dumps(collected.get("cpu") or {})))
    c.execute("INSERT INTO memory (run_id, info) VALUES (?, ?)", (run_id, json.dumps(collected.get("memory") or {})))

    disks = collected.get("disks", {}) or {}
    for p in disks.get("partitions", []):
        c.execute("INSERT INTO disks (run_id, device, mountpoint, fstype, usage, extra) VALUES (?, ?, ?, ?, ?, ?)",
                  (run_id, p.get("device"), p.get("mountpoint"), p.get("fstype"), json.dumps(p.get("usage") or {}), json.dumps(disks.get("lsblk") or {})))

    for k, v in (collected.get("temps") or {}).items():
        c.execute("INSERT INTO temps (run_id, sensor_key, entries) VALUES (?, ?, ?)", (run_id, k, json.dumps(v)))

    c.execute("INSERT INTO battery (run_id, info) VALUES (?, ?)", (run_id, json.dumps(collected.get("battery"))))

    for iface, details in (collected.get("network") or {}).items():
        c.execute("INSERT INTO network (run_id, iface, addrs, stats, io) VALUES (?, ?, ?, ?, ?)",
                  (run_id, iface, json.dumps(details.get("addrs")), json.dumps(details.get("stats")), json.dumps(details.get("io"))))

    procs = collected.get("processes") or []
    if procs:
        rows = []
        for p in procs:
            rows.append((
                run_id,
                p.get("pid"),
                p.get("username"),
                p.get("name"),
                p.get("status"),
                p.get("create_time"),
                p.get("cpu_percent"),
                p.get("memory_percent"),
                json.dumps(p.get("memory_info") or {}),
                p.get("cmdline"),
                p.get("exe"),
                p.get("cwd"),
                json.dumps(p.get("env") or {})
            ))
        c.executemany("""INSERT INTO processes (run_id, pid, username, name, status, create_time, cpu_percent, memory_percent, memory_info, cmdline, exe, cwd, env)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", rows)

    for k, v in (collected.get("misc") or {}).items():
        c.execute("INSERT INTO misc (run_id, key, value) VALUES (?, ?, ?)", (run_id, k, json.dumps(v)))

    smart = collected.get("smart")
    if isinstance(smart, list):
        for s in smart:
            c.execute("INSERT INTO smart (run_id, device, kname, info) VALUES (?, ?, ?, ?)",
                      (run_id, s.get("device"), s.get("kname"), json.dumps(s.get("smart"))))
    elif isinstance(smart, dict):
        c.execute("INSERT INTO smart (run_id, device, kname, info) VALUES (?, ?, ?, ?)",
                  (run_id, None, None, json.dumps(smart)))

    conn.commit()
    return run_id


def collect_all(limit_procs=None):
    meta = {"ts_utc": iso_ts(), "hostname": os.uname().nodename if hasattr(os, "uname") else None}
    meta["os_info"] = collect_os_info()
    uptime = collect_uptime()
    meta["uptime_seconds"] = uptime.get("uptime_seconds") if isinstance(uptime, dict) else None

    disks = collect_disks()
    lsblk = disks.get("lsblk") if isinstance(disks, dict) else None

    collected = {
        "meta": meta,
        "cpu": collect_cpu(),
        "memory": collect_memory(),
        "disks": disks,
        "temps": collect_temps(),
        "battery": collect_battery(),
        "network": collect_network(),
        "processes": collect_processes(limit=limit_procs),
        "smart": collect_smart(lsblk_json=lsblk),
        "misc": {"uptime": uptime, "timestamp_epoch": time.time()}
    }
    return collected


def main():
    conn = connect_db()
    create_tables(conn)
    print(f"Collecting system info at {iso_ts()} ...")
    collected = collect_all(limit_procs=None)
    run_id = save_all(conn, collected)
    conn.close()
    print(f"Saved run id {run_id} to {DB_PATH}")


if __name__ == "__main__":
    main()
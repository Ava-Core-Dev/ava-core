"""
FastAPI endpoint for live processes + disk usage.
Run on the machine you want to monitor.

Requires:
  pip install fastapi uvicorn psutil

Usage:
  uvicorn api_processes_stub:app --host 0.0.0.0 --port 8793
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import psutil
from datetime import datetime
import platform
import time
import os
from pathlib import Path

app = FastAPI(title="System Live Processes")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten in production
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def human_bytes(n: int) -> str:
    if n is None or n < 0:
        return "—"
    for unit in ("B", "KB", "MB", "GB", "TB", "PB"):
        if n < 1024:
            return f"{n:.1f} {unit}" if unit != "B" else f"{n} B"
        n /= 1024
    return f"{n:.1f} EB"


def dir_size(path: str, max_depth: int = 2, timeout_s: float = 8.0) -> int:
    """Approximate directory size with depth limit and timeout for safety."""
    start = time.time()
    total = 0
    root_depth = path.rstrip(os.sep).count(os.sep)

    try:
        for root, dirs, files in os.walk(path, onerror=lambda e: None):
            if time.time() - start > timeout_s:
                break
            depth = root.count(os.sep) - root_depth
            if depth > max_depth:
                dirs.clear()
                continue
            # Skip common noisy / huge virtual filesystems
            dirs[:] = [
                d for d in dirs
                if d not in {
                    "proc", "sys", "dev", "run", "snap", "tmp",
                    ".cache", "lost+found", "docker", "containerd",
                }
            ]
            for f in files:
                try:
                    fp = os.path.join(root, f)
                    total += os.path.getsize(fp)
                except (OSError, PermissionError):
                    continue
    except (OSError, PermissionError):
        pass
    return total


@app.get("/api/processes")
def list_processes():
    # First call often returns 0; a tiny sleep helps get meaningful cpu_percent
    for p in psutil.process_iter(["pid"]):
        try:
            p.cpu_percent(interval=None)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    time.sleep(0.15)

    procs = []
    for p in psutil.process_iter(
        ["pid", "name", "username", "cpu_percent", "memory_percent", "status", "create_time"]
    ):
        try:
            info = p.info
            procs.append({
                "pid": info["pid"],
                "name": info["name"],
                "user": info["username"] or "—",
                "cpu": round(info["cpu_percent"] or 0, 1),
                "mem": round(info["memory_percent"] or 0, 1),
                "status": info["status"],
                "started": datetime.fromtimestamp(info["create_time"]).isoformat()
                           if info["create_time"] else None,
            })
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue

    procs.sort(key=lambda x: x["cpu"], reverse=True)

    boot = datetime.fromtimestamp(psutil.boot_time()).isoformat()
    mem = psutil.virtual_memory()

    return {
        "ts": datetime.utcnow().isoformat() + "Z",
        "host": platform.node() or "localhost",
        "platform": platform.system() + " " + platform.release(),
        "cpu_count": psutil.cpu_count(),
        "mem_total_gb": round(mem.total / (1024**3), 1),
        "mem_used_pct": round(mem.percent, 1),
        "boot_time": boot,
        "count": len(procs),
        "processes": procs[:300],
    }


@app.get("/api/disk")
def disk_usage():
    """
    Overall disk stats + size breakdown of major top-level directories.
    Also groups common functional areas (home, var, usr, etc.).
    """
    # --- Overall mounts ---
    mounts = []
    seen = set()
    for part in psutil.disk_partitions(all=False):
        if part.device in seen:
            continue
        # Skip special / virtual mounts
        if part.fstype in ("", "tmpfs", "devtmpfs", "squashfs", "overlay", "nsfs"):
            continue
        try:
            usage = psutil.disk_usage(part.mountpoint)
        except (PermissionError, OSError):
            continue
        seen.add(part.device)
        mounts.append({
            "device": part.device,
            "mount": part.mountpoint,
            "fstype": part.fstype,
            "total": usage.total,
            "used": usage.used,
            "free": usage.free,
            "percent": round(usage.percent, 1),
            "total_h": human_bytes(usage.total),
            "used_h": human_bytes(usage.used),
            "free_h": human_bytes(usage.free),
        })

    # Prefer root filesystem as primary
    primary = next((m for m in mounts if m["mount"] == "/"), mounts[0] if mounts else None)

    # --- Major directory groups (top-level under /) ---
    # These are the functional groups users care about
    SCAN_ROOTS = [
        ("/", "root (/)"),           # only direct children will be measured below
        ("/home", "Home"),
        ("/var", "Var (logs, cache, lib)"),
        ("/usr", "Usr (programs)"),
        ("/opt", "Opt (optional software)"),
        ("/tmp", "Tmp"),
        ("/boot", "Boot"),
        ("/snap", "Snap packages"),
        ("/srv", "Srv"),
    ]

    # Also include the current user's home if not already covered
    home = str(Path.home())
    if home and home not in [r[0] for r in SCAN_ROOTS]:
        SCAN_ROOTS.append((home, f"User home ({os.path.basename(home)})"))

    groups = []
    for path, label in SCAN_ROOTS:
        if not os.path.isdir(path):
            continue
        try:
            # Shallow-ish scan; deeper for home/var which tend to hold the bulk
            depth = 3 if path in ("/home", home, "/var") else 2
            size = dir_size(path, max_depth=depth, timeout_s=6.0)
            if size <= 0 and path != "/":
                # Fallback: try du -sb for better accuracy when available
                try:
                    import subprocess
                    out = subprocess.check_output(
                        ["du", "-sb", "--max-depth=0", path],
                        stderr=subprocess.DEVNULL,
                        timeout=5,
                        text=True,
                    )
                    size = int(out.split()[0])
                except Exception:
                    pass
            groups.append({
                "path": path,
                "label": label,
                "size": size,
                "size_h": human_bytes(size),
            })
        except Exception:
            continue

    # Sort by size desc
    groups.sort(key=lambda x: x["size"], reverse=True)

    # --- Top-level children of / for finer breakdown ---
    top_level = []
    try:
        for name in os.listdir("/"):
            p = os.path.join("/", name)
            if not os.path.isdir(p):
                continue
            if name in {"proc", "sys", "dev", "run", "tmp"}:
                continue
            try:
                size = dir_size(p, max_depth=2, timeout_s=4.0)
                if size > 0:
                    top_level.append({
                        "path": p,
                        "label": name,
                        "size": size,
                        "size_h": human_bytes(size),
                    })
            except Exception:
                continue
        top_level.sort(key=lambda x: x["size"], reverse=True)
        top_level = top_level[:15]
    except Exception:
        pass

    return {
        "ts": datetime.utcnow().isoformat() + "Z",
        "primary": primary,
        "mounts": mounts,
        "groups": groups,
        "top_level": top_level,
    }


@app.get("/api/host")
def host_summary():
    mem = psutil.virtual_memory()
    disk = psutil.disk_usage("/")
    return {
        "ts": datetime.utcnow().isoformat() + "Z",
        "host": platform.node(),
        "platform": platform.platform(),
        "cpu_percent": psutil.cpu_percent(interval=0.2),
        "cpu_count": psutil.cpu_count(),
        "mem_percent": mem.percent,
        "mem_used_gb": round(mem.used / (1024**3), 1),
        "mem_total_gb": round(mem.total / (1024**3), 1),
        "disk_percent": disk.percent,
        "boot_time": datetime.fromtimestamp(psutil.boot_time()).isoformat(),
        "uptime_seconds": int(time.time() - psutil.boot_time()),
    }


@app.get("/api/services")
def list_systemd_services():
    """Optional: requires systemd."""
    import subprocess
    try:
        out = subprocess.check_output(
            ["systemctl", "list-units", "--type=service", "--state=running",
             "--no-pager", "--plain"],
            text=True,
            timeout=5,
        )
        lines = [l.strip() for l in out.splitlines() if l.strip() and not l.startswith("UNIT")]
        services = []
        for line in lines:
            parts = line.split()
            if parts:
                services.append({
                    "unit": parts[0],
                    "load": parts[1] if len(parts) > 1 else "",
                    "active": parts[2] if len(parts) > 2 else "",
                })
        return {"ts": datetime.utcnow().isoformat() + "Z", "services": services}
    except Exception as e:
        return {"error": str(e), "services": []}


@app.get("/api/service/{service_name}/status")
def service_status(service_name: str):
    """Get status of a systemd service."""
    import subprocess
    try:
        if not service_name.replace("-", "").replace("_", "").isalnum():
            return {"error": "Invalid service name", "status": None}
        out = subprocess.check_output(
            ["systemctl", "is-active", service_name],
            text=True,
            timeout=5,
        )
        status = out.strip()
        return {"ts": datetime.utcnow().isoformat() + "Z", "service": service_name, "status": status}
    except subprocess.CalledProcessError as e:
        return {"ts": datetime.utcnow().isoformat() + "Z", "service": service_name, "status": "inactive", "error": str(e)}
    except Exception as e:
        return {"error": str(e), "status": None}


@app.post("/api/service/{service_name}/start")
def service_start(service_name: str):
    """Start a systemd service."""
    import subprocess
    try:
        if not service_name.replace("-", "").replace("_", "").isalnum():
            return {"error": "Invalid service name", "success": False}
        subprocess.run(
            ["sudo", "systemctl", "start", service_name],
            check=True,
            timeout=10,
        )
        return {"ts": datetime.utcnow().isoformat() + "Z", "service": service_name, "action": "start", "success": True}
    except Exception as e:
        return {"error": str(e), "success": False}


@app.post("/api/service/{service_name}/stop")
def service_stop(service_name: str):
    """Stop a systemd service."""
    import subprocess
    try:
        if not service_name.replace("-", "").replace("_", "").isalnum():
            return {"error": "Invalid service name", "success": False}
        subprocess.run(
            ["sudo", "systemctl", "stop", service_name],
            check=True,
            timeout=10,
        )
        return {"ts": datetime.utcnow().isoformat() + "Z", "service": service_name, "action": "stop", "success": True}
    except Exception as e:
        return {"error": str(e), "success": False}


@app.post("/api/service/{service_name}/restart")
def service_restart(service_name: str):
    """Restart a systemd service."""
    import subprocess
    try:
        if not service_name.replace("-", "").replace("_", "").isalnum():
            return {"error": "Invalid service name", "success": False}
        subprocess.run(
            ["sudo", "systemctl", "restart", service_name],
            check=True,
            timeout=10,
        )
        return {"ts": datetime.utcnow().isoformat() + "Z", "service": service_name, "action": "restart", "success": True}
    except Exception as e:
        return {"error": str(e), "success": False}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8793)

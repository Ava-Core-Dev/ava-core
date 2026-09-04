"""Localhost product pages for the HI Pacific Solar Root Server.

Not /ops. Public / tunnel requests get 404. Loopback sees live boards.
"""
from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
import psutil
from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, JSONResponse

from .. import config
from ..services import energy

router = APIRouter()

HST = ZoneInfo("Pacific/Honolulu")
STATIC = Path(__file__).resolve().parent.parent / "static"
BOARD_HTML = STATIC / "local" / "board.html"
HOLDING_HTML = STATIC / "maintenance.html"
SKIP_DIRS = {"obs-backup", "__pycache__", "node_modules", ".git"}
CRON_BUCKETS = ("always-on", "on-time", "since-last-fire", "in-order-on-boot")


def _local(request: Request) -> bool:
    if request.headers.get("cf-ray") or request.headers.get("cf-connecting-ip"):
        return False
    host = request.client.host if request.client else ""
    return host in {"127.0.0.1", "::1"}


def _deny() -> JSONResponse:
    return JSONResponse({"ok": False}, status_code=404)


def _html(path: Path, status: int = 200):
    if not path.is_file():
        return JSONResponse({"ok": False, "detail": "page missing"}, status_code=500)
    return FileResponse(
        path,
        media_type="text/html",
        status_code=status,
        headers={"Cache-Control": "no-store", "X-Robots-Tag": "noindex"},
    )


def _iso_mtime(path: Path) -> str | None:
    try:
        return datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat()
    except OSError:
        return None


def _tail_jsonl(path: Path, n: int = 1) -> list[dict]:
    if not path.is_file():
        return []
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []
    out: list[dict] = []
    for line in reversed(lines):
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except Exception:
            continue
        if isinstance(row, dict):
            out.append(row)
        if len(out) >= n:
            break
    out.reverse()
    return out


def _solar_safe(snap: dict) -> dict:
    devices = []
    for d in snap.get("devices") or []:
        if not isinstance(d, dict):
            continue
        devices.append(
            {
                "label": d.get("label") or "pack",
                "soc": d.get("soc"),
                "online": bool(d.get("online")),
                "pv_w": d.get("pv_w"),
                "ac_out_w": d.get("ac_out_w"),
                "watts_in": d.get("watts_in"),
                "watts_out": d.get("watts_out"),
            }
        )
    src = snap.get("source")
    pv = snap.get("solar_in_w") if snap.get("solar_in_w") is not None else snap.get("power_w")
    load = snap.get("load_w")
    return {
        "ok": True,
        "live": src == "ecoflow_live",
        "source": src,
        "battery_pct": snap.get("battery_pct") if snap.get("battery_pct") is not None else snap.get("bank_pct"),
        "solar_in_w": pv,
        "load_w": load,
        "state": snap.get("state"),
        "devices": devices,
        "energy": energy.summary(devices, pv_w=pv, load_w=load),
    }


def _folder_map(root: Path, *, budget_s: float = 1.2) -> dict:
    if not root.is_dir():
        return {"exists": False, "path": str(root), "types": []}
    types = []
    t0 = time.monotonic()
    try:
        entries = sorted(
            [p for p in root.iterdir() if p.is_dir() and p.name not in SKIP_DIRS],
            key=lambda p: p.name.lower(),
        )
    except OSError as e:
        return {"exists": True, "path": str(root), "error": str(e)[:120], "types": []}
    for t in entries[:16]:
        if time.monotonic() - t0 > budget_s:
            types.append({"name": t.name, "categories": [], "note": "listing stopped (slow disk)"})
            break
        cats: list[str] = []
        try:
            cats = sorted(
                c.name
                for c in t.iterdir()
                if c.is_dir() and c.name not in SKIP_DIRS
            )[:40]
        except OSError:
            cats = []
        types.append({"name": t.name, "categories": cats})
    return {"exists": True, "path": str(root), "types": types}


def _cronologicals() -> dict:
    root = config.AVA_HOME / "operations" / "cronologicals"
    buckets = []
    for name in CRON_BUCKETS:
        folder = root / name
        jobs = []
        if folder.is_dir():
            try:
                jobs = sorted(
                    p.stem
                    for p in folder.glob("*.py")
                    if p.name != "__init__.py"
                )
            except OSError:
                jobs = []
        buckets.append({"name": name, "exists": folder.is_dir(), "jobs": jobs})
    return {"path": str(root), "exists": root.is_dir(), "buckets": buckets}


async def _tunnel_note() -> dict:
    n = 0
    try:
        for p in psutil.process_iter(["name"]):
            if "cloudflared" in (p.info.get("name") or "").lower():
                n += 1
    except Exception:
        n = 0
    connections = None
    metrics_ok = False
    try:
        async with httpx.AsyncClient(timeout=1.5) as client:
            r = await client.get("http://127.0.0.1:20241/ready")
        if r.status_code == 200:
            metrics_ok = True
            try:
                body = r.json()
            except Exception:
                body = {}
            if isinstance(body, dict):
                raw = body.get("readyConnections")
                if isinstance(raw, int):
                    connections = raw
    except Exception:
        metrics_ok = False
    note = "No cloudflared process on this PC."
    if n == 1 and metrics_ok:
        note = "One tunnel process. Metrics answered."
    elif n == 1:
        note = "One tunnel process. Metrics did not answer."
    elif n > 1:
        note = f"{n} tunnel processes. Leave one."
    return {
        "process_count": n,
        "metrics_ok": metrics_ok,
        "connections": connections,
        "note": note,
    }


def _origin_procs() -> dict:
    uvicorn_n = 0
    electron_n = 0
    try:
        for p in psutil.process_iter(["name", "cmdline"]):
            name = (p.info.get("name") or "").lower()
            cmd = " ".join(p.info.get("cmdline") or []).lower()
            if "uvicorn" in cmd or "apps.core.main" in cmd:
                uvicorn_n += 1
            if "electron" in name or "ava desk" in cmd:
                electron_n += 1
    except Exception:
        pass
    log_path = config.AVA_HOME / "data" / "logs" / "origin-uvicorn.log"
    if not log_path.is_file():
        log_path = config.DATA_DIR / "logs" / "origin-uvicorn.log"
    return {
        "uvicorn_n": uvicorn_n,
        "electron_n": electron_n,
        "origin_log_mtime": _iso_mtime(log_path) if log_path.is_file() else None,
        "watchdog": "Watchdog only starts origin when /health is down. Do not start a second copy.",
    }


def _inbox_safe() -> dict:
    token_set = False
    try:
        token_set = bool(config.discord_bot_token())
    except Exception:
        token_set = False
    subs = 0
    try:
        from apps.core.services import subscribers as sub_svc

        subs = len(sub_svc.list_all())
    except Exception:
        subs = 0
    inbox = config.DATA_DIR / "state" / "report-inbox.json"
    return {
        "discord_token_set": token_set,
        "report_subscribers": subs,
        "inbox_file": inbox.is_file(),
    }


def _host_last() -> dict | None:
    from apps.core.services.data_layout import host_history_path

    for path in (host_history_path(),):
        rows = _tail_jsonl(path, 1)
        if not rows:
            continue
        row = dict(rows[-1])
        secs = row.get("battery_secsleft")
        try:
            if secs is not None and int(secs) > 10_000_000:
                row.pop("battery_secsleft", None)
        except (TypeError, ValueError):
            row.pop("battery_secsleft", None)
        row["file"] = str(path)
        return row
    return None


def _business_safe() -> dict:
    from apps.core.services import public_finance as fin

    ledger = fin._finance_file("ops-ledger.json")
    snap = fin._finance_file("stripe-snapshot.json")
    if not ledger or not ledger.is_file():
        return {"ok": False, "status": "held", "detail": "No local ledger file."}
    try:
        board = fin.public_finance_board()
    except Exception as e:
        return {"ok": False, "status": "held", "detail": f"Ledger unreadable: {e}"}
    expenses = (board.get("expenses") or {}).get("all") or []
    income = (board.get("income") or {}).get("all") or []
    stripe_live = False
    stripe: dict = {"live": False}
    if snap and snap.is_file():
        try:
            raw = json.loads(snap.read_text(encoding="utf-8"))
        except Exception:
            raw = {}
        if isinstance(raw, dict) and raw.get("ok") is not False:
            stripe_live = True
            for key in ("income30dUsd", "fees30dUsd", "payouts30dUsd", "usdAvailable", "usdPending"):
                val = raw.get(key)
                if isinstance(val, (int, float)):
                    stripe[key] = val
            stripe["live"] = True
            fetched = raw.get("fetchedAt")
            if isinstance(fetched, str):
                stripe["fetched_at"] = fetched
    lines = []
    for row in expenses[:40]:
        lines.append(
            {
                "kind": "expense",
                "label": row.get("label") or "Expense",
                "project": row.get("project") or "",
                "monthly_usd": row.get("monthlyUsd"),
            }
        )
    for row in income[:40]:
        lines.append(
            {
                "kind": "income",
                "label": row.get("label") or "Income",
                "project": row.get("project") or "",
                "monthly_usd": row.get("monthlyUsd"),
            }
        )
    return {
        "ok": True,
        "status": "internal",
        "ledger_ok": True,
        "public": False,
        "ledger_path": str(ledger),
        "expense_rows": len(expenses),
        "income_rows": len(income),
        "expense_monthly_usd": (board.get("expenses") or {}).get("monthlyTotalUsd"),
        "income_monthly_usd": (board.get("income") or {}).get("monthlyTotalUsd"),
        "lines": lines,
        "stripe": stripe,
        "stripe_live": stripe_live,
    }


def _identity_safe() -> dict:
    from apps.core.services import identities as ident_svc

    counts = ident_svc.counts()
    by_kind = {
        k[3:]: counts[k]
        for k in (
            "id_email",
            "id_discord",
            "id_uuid",
            "id_solana",
            "id_username",
            "id_account_id",
            "id_membership_id",
        )
        if k in counts
    }
    return {
        "ok": True,
        "identities": counts.get("identities"),
        "members_flagged": counts.get("members_flagged"),
        "uuid_present": counts.get("uuid_present"),
        "by_kind": by_kind,
        "store": "identities.sqlite on this PC",
    }


def _membership_safe(raw: dict) -> dict:
    if not isinstance(raw, dict):
        return {"ok": False, "status": "DOWN", "detail": "Membership did not answer."}
    if not raw.get("ok"):
        return {
            "ok": False,
            "status": raw.get("status") or "held",
            "canonical_ok": raw.get("canonical_ok"),
            "note": raw.get("note") or "RootMC membership JSON is not live on api.rootmc.net.",
        }
    keep = (
        "ok",
        "paid_pro",
        "lifetime",
        "paid_members",
        "mrr_usd",
        "development_available",
        "canonical_ok",
        "fallback_used",
        "api_host",
    )
    out = {k: raw.get(k) for k in keep}
    out["ok"] = True
    if raw.get("canonical_ok") is False:
        out["note"] = "api.rootmc.net is held. Counts came from the RootMC worker."
    return out


def _minecraft_safe(raw: dict) -> dict:
    live = raw.get("live") if isinstance(raw.get("live"), dict) else {}
    test = raw.get("test") if isinstance(raw.get("test"), dict) else {}
    return {
        "ok": bool(raw.get("ok")),
        "live": {
            "host": live.get("host"),
            "port": live.get("port"),
            "online": bool(live.get("online")),
            "latency_ms": live.get("latency_ms"),
        },
        "test": {
            "online": bool(test.get("online")),
            "latency_ms": test.get("latency_ms"),
        },
        "jar": raw.get("jar"),
        "plugins": raw.get("plugins"),
        "dir_present": raw.get("dirPresent"),
    }


async def _mysql_note() -> dict:
    try:
        from apps.core.services import mysql as mysql_svc

        return await mysql_svc.status()
    except Exception:
        return {"live": False, "local_3306": False, "shockbyte": False}


async def build_board() -> dict:
    from apps.core.heartbeat import last_success_age_s
    from apps.core.host_metrics import gpu_name, host_battery, host_disk_pct, host_disks, host_temp_c, npu_present
    from apps.core.services import membership as membership_svc
    from apps.core.services import ollama as ollama_svc

    solar: dict = {}
    try:
        from apps.core.crons.since_last_fire.solar_weather import live_snapshot

        solar = _solar_safe(await live_snapshot())
    except Exception as e:
        solar = {"ok": False, "live": False, "detail": str(e)[:160]}

    weather: dict = {"ok": False}
    kilauea: dict = {"ok": False}
    try:
        from apps.core.routes.realworld import api_kilauea, api_weather

        w = await api_weather()
        if isinstance(w, JSONResponse):
            weather = {"ok": False, "status": "DOWN", "detail": "No weather report yet."}
        elif isinstance(w, dict):
            weather = {"ok": True, **{k: w.get(k) for k in ("period", "temperature_f", "forecast", "alerts_active", "updated_at")}}
        k = await api_kilauea()
        if isinstance(k, JSONResponse):
            kilauea = {"ok": False, "status": "DOWN", "detail": "No Kīlauea state yet."}
        elif isinstance(k, dict):
            kilauea = {
                "ok": True,
                "alert_level": k.get("alert_level"),
                "multiplier": k.get("multiplier"),
                "events_nearby": k.get("events_nearby"),
                "max_magnitude": k.get("max_magnitude"),
                "updated_at": k.get("updated_at"),
                "source": k.get("source"),
            }
    except Exception as e:
        weather = {"ok": False, "detail": str(e)[:160]}
        kilauea = {"ok": False, "detail": str(e)[:160]}

    ollama_up, models = await ollama_svc.tags()
    hb = last_success_age_s()
    temp_c, temp_src = await asyncio.to_thread(host_temp_c)
    batt = host_battery() or {}
    mem = psutil.virtual_memory()
    cpu = psutil.cpu_percent(interval=None)
    jobs = []
    try:
        from apps.core.scheduler import get_scheduler

        sched = get_scheduler()
        if sched:
            jobs = [
                {"id": j.get("id"), "name": j.get("name"), "next_run": j.get("next_run")}
                for j in (sched.get_jobs() or [])[:40]
            ]
    except Exception:
        jobs = []

    mc_raw: dict = {}
    try:
        from apps.core.routes.minecraft import minecraft_status

        mc_raw = await minecraft_status()
    except Exception:
        mc_raw = {"ok": False}

    try:
        rootmc = _membership_safe(await membership_svc.rootmc_stats())
    except Exception:
        rootmc = {"ok": False, "status": "DOWN"}

    # Host battery is only known here, so fold it into the energy totals.
    if isinstance(solar.get("energy"), dict) and solar["energy"].get("ok"):
        solar["energy"] = energy.summary(
            solar.get("devices") or [],
            pv_w=solar.get("solar_in_w"),
            load_w=solar.get("load_w"),
            host_battery_pct=batt.get("pct"),
        )
        en = solar["energy"]
        tot = solar.setdefault("totals", {})
        if isinstance(tot, dict) and en.get("total_pct") is not None:
            tot["bank_pct_weighted"] = en["total_pct"]
            tot["site_bank_pct"] = en.get("site_bank_pct", en.get("bank_pct"))
            tot["total_pct"] = en["total_pct"]
            tot["total_stored_wh"] = en.get("total_stored_wh")
            tot["total_capacity_wh"] = en.get("total_capacity_wh")

    sun = {}
    up = {}
    try:
        from apps.core.services import sun_times, uptime_log
        sun = sun_times.facts()
        up = uptime_log.facts()
    except Exception:
        pass

    return {
        "ok": True,
        "public": False,
        "site": "HI Pacific Solar Root Server",
        "clock_hst": datetime.now(HST).strftime("%Y-%m-%d %H:%M:%S HST"),
        "origin": {
            "health": True,
            "bind": "127.0.0.1:8787",
            "uptime_s": int(time.time() - psutil.boot_time()),
            "desk_uptime_s": up.get("desk_uptime_s"),
            "last_return_at": up.get("last_return_at"),
            "sunrise": sun.get("sunrise"),
            "sunset": sun.get("sunset"),
            "d1_heartbeat_age_s": round(hb, 1) if hb is not None else None,
            "d1_heartbeat": "live" if hb is not None else "not live",
            "jobs_n": len(jobs),
            "jobs": jobs,
        },
        "tunnel": await _tunnel_note(),
        "procs": _origin_procs(),
        "ollama": {
            "up": ollama_up,
            "url": "http://127.0.0.1:11434",
            "models": models,
        },
        "mysql": await _mysql_note(),
        "inbox": _inbox_safe(),
        "solar": solar,
        "host": {
            "cpu_pct": round(float(cpu), 1),
            "mem_pct": round(float(mem.percent), 1),
            "mem_used_gb": round(mem.used / (1024**3), 1),
            "mem_total_gb": round(mem.total / (1024**3), 1),
            "temp_c": temp_c,
            "temp_src": temp_src,
            "host_battery_pct": batt.get("pct"),
            "host_battery_plugged": batt.get("plugged"),
            "disk_pct": host_disk_pct(config.AVA_HOME),
            "disks": (await asyncio.to_thread(host_disks))[:8],
            "gpu_name": gpu_name(),
            "npu_present": npu_present(),
            "npu_watts": None,
            "history_last": _host_last(),
        },
        "weather": weather,
        "kilauea": kilauea,
        "business": _business_safe(),
        "identities": _identity_safe(),
        "rootmc_membership": rootmc,
        "minecraft": _minecraft_safe(mc_raw if isinstance(mc_raw, dict) else {}),
        "media": {
            "public": await asyncio.to_thread(_folder_map, Path(config.PUBLIC_MEDIA)),
            "private": await asyncio.to_thread(_folder_map, Path(config.PRIVATE_MEDIA)),
        },
        "cronologicals": await asyncio.to_thread(_cronologicals),
    }


def home_response(request: Request):
    """Loopback home HTML, or None so callers can keep the public JSON."""
    if not _local(request):
        return None
    return _html(BOARD_HTML)


@router.get("/system")
@router.get("/host")
@router.get("/ecoflow")
@router.get("/business")
@router.get("/identities")
@router.get("/media")
@router.get("/minecraft")
async def board_page(request: Request):
    if not _local(request):
        return _deny()
    return _html(BOARD_HTML)


@router.get("/holding")
async def holding_preview(request: Request):
    if not _local(request):
        return _deny()
    return _html(HOLDING_HTML, status=200)


@router.get("/api/local/board")
async def api_local_board(request: Request):
    if not _local(request):
        return _deny()
    try:
        return await build_board()
    except Exception as e:
        return JSONResponse({"ok": False, "detail": str(e)[:200]}, status_code=500)

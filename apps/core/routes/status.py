"""Status, solar, and power routes."""

from __future__ import annotations

import json
import platform
import time
from datetime import datetime, timezone
from pathlib import Path

import psutil
from fastapi import APIRouter
from fastapi.responses import HTMLResponse, JSONResponse

from .. import config
from ..heartbeat import last_success_age_s
from ..scheduler import Scheduler

router = APIRouter()

_start_time = time.time()


@router.get("/")
async def root():
    return JSONResponse({"redirect": "https://avaivy.cloud/solar", "ava": "online"})


def _solar_html() -> str:
    path = Path(__file__).resolve().parent.parent / "templates" / "solar.html"
    return path.read_text(encoding="utf-8") if path.is_file() else "<p>solar desk missing</p>"


@router.get("/solar")
@router.get("/solar/")
async def solar_page():
    return HTMLResponse(_solar_html())


@router.get("/health")
async def health():
    return {"ok": True, "uptime_s": int(time.time() - _start_time)}


@router.get("/api/status")
async def api_status():
    cpu = psutil.cpu_percent(interval=None)
    mem = psutil.virtual_memory()
    uptime = int(time.time() - _start_time)
    heartbeat_age = last_success_age_s()
    from apps.core.services.broadcast import live_payload

    live = await live_payload()

    return {
        "version": "2.0.0",
        "ts": datetime.now(timezone.utc).isoformat(),
        "uptime_s": uptime,
        "host": platform.node(),
        "cpu_pct": cpu,
        "mem_pct": round(mem.percent, 1),
        "heartbeat_age_s": round(heartbeat_age, 1) if heartbeat_age is not None else None,
        "streaming": bool(live.get("streaming")),
        "live": live,
        "config": {
            "port": config.AVA_PORT,
            "env": config.AVA_ENV,
            "scheduler": config.ENABLE_SCHEDULER,
            "voice_mode": config.VOICE_MODE,
        },
    }


@router.get("/api/live")
async def api_live():
    from apps.core.services.broadcast import live_payload

    return await live_payload()


@router.get("/api/solar")
async def api_solar():
    """Solar dashboard JSON — live EcoFlow when configured, else latest report."""
    import json, re
    from pathlib import Path

    try:
        from apps.core.crons.solar_weather import live_snapshot
        live = await live_snapshot()
        if live.get("battery_pct") is not None or live.get("power_w"):
            return live
    except Exception:
        live = {}

    reports = list(config.REPORTS_DIR.glob("solar-weather-*.md"))
    if not reports:
        if live:
            return live
        return JSONResponse({"error": "no solar reports found"}, status_code=404)

    latest = max(reports, key=lambda p: p.stat().st_mtime)
    text = latest.read_text(errors="replace")

    def find(pattern: str, default=None):
        m = re.search(pattern, text, re.IGNORECASE)
        return m.group(1).strip() if m else default

    bank = find(r"SOC\s*(\d+)%") or find(r"Bank:\s*(\d+)%")
    watts = find(r"in\s*(\d+)W") or find(r"solar in\s*(\d+)W")
    offline = "offline" in text.lower() and not bank
    return {
        "report_file": latest.name,
        "bank_pct": bank,
        "solar_in_w": watts,
        "delta2_soc": find(r"Delta 2.*?SOC\s*(\d+)%"),
        "river2_soc": find(r"River 2 Pro.*?SOC\s*(\d+)%"),
        "conditions": find(r"Conditions:\s*(.+)"),
        "voltage": None,
        "current": None,
        "power_w": int(watts) if watts and str(watts).isdigit() else watts,
        "battery_pct": int(bank) if bank and str(bank).isdigit() else ("offline" if offline else bank),
        "state": "offline" if offline else (find(r"state[:\s]+(\w+)") or "see report"),
        "kwh_today": find(r"kwh[_\s-]*today[:\s]+([\d.]+)"),
        "kwh_total": find(r"kwh[_\s-]*total[:\s]+([\d.]+)"),
        "panel_temp_c": find(r"temp[:\s]+([\d.]+)"),
        "raw": text[:2000],
        "source": "report_file",
    }


@router.get("/api/solar/history")
async def api_solar_history(hours: float = 12):
    """EcoFlow + host history — solar/load/soc/cpu/mem/temp over the last N hours."""
    try:
        from apps.core.crons.solar_weather import history_points, history_rollups
        out = history_points(hours)
        try:
            out["rollups"] = (history_rollups() or {}).get("windows") or {}
        except Exception:
            out["rollups"] = {}
        return out
    except Exception as exc:
        return JSONResponse(
            {"ok": False, "points": [], "hours": hours, "error": str(exc)[:200]},
            status_code=500,
        )


@router.get("/api/solar/rollups")
async def api_solar_rollups():
    """Averages / totals for 1h · 6h · 12h · 24h · 7d · lifetime."""
    try:
        from apps.core.crons.solar_weather import history_rollups
        return history_rollups()
    except Exception as exc:
        return JSONResponse({"ok": False, "windows": {}, "error": str(exc)[:200]}, status_code=500)


@router.get("/api/desk/notifications")
async def api_desk_notifications(limit: int = 40):
    """System-wide desk notifications (status events, banner, shutdown, host alerts)."""
    n = max(1, min(int(limit or 40), 100))
    items: list[dict] = []
    now = datetime.now(timezone.utc)

    # Disruption banner
    try:
        from apps.core.routes.desktop import disruption_banner
        ban = await disruption_banner(None)
        if isinstance(ban, dict) and ban.get("show"):
            items.append({
                "id": "disruption",
                "level": "warning",
                "source": "banner",
                "title": ban.get("title") or "Service notice",
                "detail": ban.get("detail") or "",
                "at": now.isoformat().replace("+00:00", "Z"),
                "meta": {
                    "category": ban.get("category"),
                    "untilLabel": ban.get("untilLabel"),
                    "untilMs": ban.get("untilMs"),
                },
            })
    except Exception:
        pass

    # Projected shutdown
    for p in (
        config.DATA_DIR / "state" / "projected-shutdown.json",
        Path.home() / "ava" / "data" / "state" / "projected-shutdown.json",
    ):
        if not p.is_file():
            continue
        try:
            raw = json.loads(p.read_text(encoding="utf-8"))
            t = str(raw.get("timeHst") or "").strip()
            if t:
                items.append({
                    "id": "shutdown",
                    "level": "info",
                    "source": "shutdown",
                    "title": f"Projected shutdown {t} HST",
                    "detail": str(raw.get("source") or "desk"),
                    "at": now.isoformat().replace("+00:00", "Z"),
                })
            break
        except Exception:
            pass

    # status-events.jsonl (tab-separated or json lines) — prefer live desk paths
    ev_paths = [
        config.DATA_DIR / "state" / "status-events.jsonl",
        config.DATA_DIR / "status-events.jsonl",
        Path("/home/ava-core/ava/data/status-events.jsonl"),
        Path("/home/ava-core/ava/ava-core-v2/data/state/status-events.jsonl"),
    ]
    # Known-noise: retired Discord #proposals channel + feedback inbox when gov key missing
    NOISE = (
        "proposal queue",
        "feedback inbox",
    )
    MAX_AGE_H = 36.0
    for ev_path in ev_paths:
        if not ev_path.is_file():
            continue
        try:
            lines = ev_path.read_text(encoding="utf-8", errors="replace").splitlines()[-n * 3 :]
            for line in reversed(lines):
                line = line.strip()
                if not line:
                    continue
                if line.startswith("{"):
                    try:
                        row = json.loads(line)
                        title = str(row.get("title") or row.get("message") or "Event")
                        if any(x in title.lower() for x in NOISE) and "fail" in title.lower():
                            continue
                        items.append({
                            "id": f"event-{row.get('id') or abs(hash(line)) % 10_000_000}",
                            "level": row.get("level") or "info",
                            "source": row.get("source") or "event",
                            "title": title,
                            "detail": row.get("detail") or "",
                            "at": row.get("at") or row.get("ts") or now.isoformat().replace("+00:00", "Z"),
                        })
                        continue
                    except Exception:
                        pass
                parts = line.split("\t", 1)
                at = parts[0] if parts else ""
                msg = parts[1] if len(parts) > 1 else line
                low = msg.lower()
                # Drop stale governance noise (channel 404 / missing workstation key)
                if any(x in low for x in NOISE) and ("fail" in low or "error" in low):
                    continue
                # Age filter
                try:
                    at_dt = datetime.fromisoformat(at.replace("Z", "+00:00"))
                    age_h = (now - at_dt.astimezone(timezone.utc)).total_seconds() / 3600.0
                    if age_h > MAX_AGE_H:
                        continue
                except Exception:
                    pass
                level = "error" if ("error" in low or " · fail" in low or low.endswith(" fail")) else "info"
                if " · ok" in low or low.endswith(" ok"):
                    level = "info"
                items.append({
                    "id": f"evt-{abs(hash(line)) % 10_000_000}",
                    "level": level,
                    "source": "status-events",
                    "title": msg[:120],
                    "detail": "",
                    "at": at,
                })
            break  # first existing file wins
        except Exception:
            continue

    # Live host alerts
    try:
        cpu = psutil.cpu_percent(interval=None)
        mem = psutil.virtual_memory().percent
        if cpu >= 85:
            items.insert(0, {
                "id": "host-cpu",
                "level": "warning",
                "source": "host",
                "title": f"High CPU {cpu:.0f}%",
                "detail": "Root server load is elevated",
                "at": now.isoformat().replace("+00:00", "Z"),
            })
        if mem >= 90:
            items.insert(0, {
                "id": "host-ram",
                "level": "warning",
                "source": "host",
                "title": f"High RAM {mem:.0f}%",
                "detail": "Memory pressure on the root server",
                "at": now.isoformat().replace("+00:00", "Z"),
            })
    except Exception:
        pass

    # de-dupe by id, keep order
    seen: set[str] = set()
    uniq = []
    for it in items:
        iid = str(it.get("id") or "")
        if iid in seen:
            continue
        seen.add(iid)
        uniq.append(it)
    return {"ok": True, "items": uniq[:n], "count": len(uniq[:n])}


@router.get("/api/finance/public")
async def api_finance_public():
    """Sanitized Ava finance board for avaivy.cloud/finance."""
    try:
        from apps.core.services.public_finance import public_finance_board
        return public_finance_board()
    except Exception as exc:
        return JSONResponse({"ok": False, "error": str(exc)[:200]}, status_code=500)


@router.get("/status")
@router.get("/status/")
@router.get("/ava")
@router.get("/ava/")
@router.get("/ava/status")
@router.get("/ava/status/")
async def ava_status_page():
    """Full solar desk — same board as /solar — for every /status surface."""
    return HTMLResponse(_solar_html())


@router.get("/ava/status.json")
async def ava_status_json():
    age = last_success_age_s()
    return {
        "host": platform.node() or "ava-core",
        "online": True,
        "last_seen": datetime.now(timezone.utc).isoformat(),
        "heartbeat_age_s": round(age, 1) if age is not None else None,
        "reason": "ok",
    }

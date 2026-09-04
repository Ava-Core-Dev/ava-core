"""Live API data pages — public facts Grok (and later local) can read by URL.

Each resource exposes the same measured facts as the JSON APIs, in plain
markdown / HTML. Never invent watts. No env dumps or stack traces.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from zoneinfo import ZoneInfo

from apps.core import config

log = logging.getLogger("ava.live_data")
HST = ZoneInfo("Pacific/Honolulu")

# Stable public / origin URLs. Prefer Pages-facing hosts when known.
PUBLIC_ORIGIN = "https://origin.avaivy.cloud"
PUBLIC_ROOT = "https://rootrecord.cloud"
PUBLIC_AVA = "https://avaivy.cloud"


def _read_json(path: Path) -> dict:
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _now_line() -> str:
    now = datetime.now(HST)
    return now.strftime("%A, %B ") + str(now.day) + now.strftime(", %Y · %H:%M Hawaiian Standard Time")


def _state(name: str) -> dict:
    return _read_json(config.DATA_DIR / "state" / name)


def resource_catalog() -> list[dict[str, str]]:
    """Canonical list of live data resources for reports + GEO."""
    return [
        {
            "id": "origin",
            "title": "Origin health",
            "summary": "Local origin uptime, host load, tunnel posture.",
            "api": "/api/status",
            "page": "/data/origin",
        },
        {
            "id": "power",
            "title": "Power / solar",
            "summary": "Site bank and solar watts when measured live.",
            "api": "/api/solar",
            "page": "/data/power",
        },
        {
            "id": "weather",
            "title": "Weather",
            "summary": "Hawaii weather samples from on-disk / live feed.",
            "api": "/api/weather",
            "page": "/data/weather",
        },
        {
            "id": "kilauea",
            "title": "Kīlauea",
            "summary": "Alert level and erupting flag — advisory is not eruption.",
            "api": "/api/kilauea",
            "page": "/data/kilauea",
        },
        {
            "id": "chat",
            "title": "Public chat",
            "summary": "On-device brain posture for public replies.",
            "api": "/api/context",
            "page": "/data/chat",
        },
        {
            "id": "packs",
            "title": "Voice packs",
            "summary": "Local clip packs vs paid cloud voice.",
            "api": "/api/status",
            "page": "/data/packs",
        },
        {
            "id": "day-board",
            "title": "Day board",
            "summary": "Remaining day-board jobs and phrase clips.",
            "api": "/api/reports/day-board",
            "page": "/data/day-board",
        },
        {
            "id": "minecraft",
            "title": "Minecraft live",
            "summary": "RootMC live snapshot when on file.",
            "api": "/api/minecraft/status",
            "page": "/data/minecraft",
        },
        {
            "id": "context",
            "title": "Context hub",
            "summary": "Identity + GEO context pointers.",
            "api": "/api/context",
            "page": "/data/context",
        },
    ]


def link_bundle(*, report_type: str = "morning") -> dict:
    """URLs to hand Grok (and later local) for a full report."""
    resources = resource_catalog()
    pages = []
    for row in resources:
        pages.append(
            {
                "id": row["id"],
                "title": row["title"],
                "origin": f"{PUBLIC_ORIGIN}{row['page']}",
                "rootrecord": f"{PUBLIC_ROOT}{row['page']}",
                "md": f"{PUBLIC_ORIGIN}{row['page']}?format=md",
                "json": f"{PUBLIC_ORIGIN}{row['page']}?format=json",
                "api": f"{PUBLIC_ORIGIN}{row['api']}",
            }
        )
    return {
        "schema": "ava-report-link-bundle/v1",
        "report_type": report_type,
        "built_hst": _now_line(),
        "context": {
            "hub": f"{PUBLIC_AVA}/context",
            "hub_rootrecord": f"{PUBLIC_ROOT}/context",
            "dev": f"{PUBLIC_AVA}/context/dev",
            "llms": f"{PUBLIC_ROOT}/llms.txt",
            "llms_ava": f"{PUBLIC_AVA}/llms.txt",
            "ai": f"{PUBLIC_ROOT}/ai.txt",
            "ai_ava": f"{PUBLIC_AVA}/ai.txt",
            "context_md": f"{PUBLIC_ROOT}/context.md",
            "context_md_ava": f"{PUBLIC_AVA}/context.md",
            "status_desk": f"{PUBLIC_ROOT}/status",
            "status_ava": f"{PUBLIC_AVA}/status",
            "solar": f"{PUBLIC_ROOT}/solar",
            "solar_ava": f"{PUBLIC_AVA}/solar",
            "data_hub": f"{PUBLIC_ORIGIN}/data",
            "report_links": f"{PUBLIC_ORIGIN}/data/report-links?type={report_type}",
        },
        "resources": pages,
        "note": (
            "Prefer these live pages over scraping internals. "
            "Do not invent watts, balances, or eruption state."
        ),
    }


def build_origin() -> dict[str, Any]:
    origin_up = False
    brain_up = False
    brain_detail = ""
    try:
        from apps.core.services import boot_report

        origin_up = bool(boot_report._origin_up())
        brain_up, brain_detail = boot_report._brain_up()
    except Exception as e:
        brain_detail = type(e).__name__

    status: dict[str, Any] = {}
    try:
        import psutil

        mem = psutil.virtual_memory()
        status = {
            "host": config.AVA_HOME.name if hasattr(config, "AVA_HOME") else "Ava Core",
            "cpu_pct": psutil.cpu_percent(interval=None),
            "mem_pct": round(mem.percent, 1),
            "mem_used_gb": round(mem.used / (1024**3), 1),
            "mem_total_gb": round(mem.total / (1024**3), 1),
        }
    except Exception:
        pass

    uptime = _state("uptime-marker.json")
    net = _state("net-gate.json")
    return {
        "resource": "origin",
        "title": "Origin health",
        "as_of": _now_line(),
        "origin": "UP" if origin_up else "DOWN",
        "on_device_brain": "UP" if brain_up else "DOWN",
        "brain_detail": brain_detail,
        "host": status,
        "uptime": {
            "last_return_at": uptime.get("last_return_at"),
            "origin_started_at": uptime.get("origin_started_at"),
        },
        "net_gate": {
            "restored_at": net.get("restored_at"),
            "gap_s": net.get("gap_s") or net.get("gap_seconds"),
        },
        "spoken_rules": [
            "Host name: Ava Core",
            "Role: Hawaii Pacific Solar Root Server",
            "Timezone: Hawaiian Standard Time",
            "Public doors: rootrecord.cloud and avaivy.cloud",
        ],
    }


def build_power() -> dict[str, Any]:
    lines: list[str] = []
    eco = ""
    host = ""
    try:
        from apps.core.services import db_facts

        eco = db_facts.ecoflow_line()
        host = db_facts.host_line()
        lines = [eco, host]
    except Exception as e:
        lines = [f"Power numbers unavailable ({type(e).__name__})"]

    snap: dict[str, Any] = {}
    try:
        # Prefer sync read of latest state if live_snapshot is async-only elsewhere.
        from apps.core.crons.since_last_fire import solar_weather as sw

        hist = getattr(sw, "history_points", None)
        if callable(hist):
            pts = hist(1) or {}
            snap = {
                "points": len(pts.get("points") or []) if isinstance(pts, dict) else 0,
                "hours": 1,
            }
    except Exception:
        pass

    return {
        "resource": "power",
        "title": "Power / solar",
        "as_of": _now_line(),
        "lines": lines,
        "ecoflow_line": eco,
        "host_line": host,
        "history_hint": snap,
        "rules": [
            "Off-grid solar only. Never advise wall power, plug-in, or AC outlet.",
            "Do not invent watts or percents. Missing means say not live.",
        ],
    }


def build_weather() -> dict[str, Any]:
    rows: list[str] = []
    hurricane = ""
    try:
        from apps.core.services import live_wx

        rows = list(live_wx.weather_lines_sync() or [])
        hurricane = live_wx.hurricane_line() or ""
    except Exception as e:
        rows = [f"Weather unavailable ({type(e).__name__})"]

    nws_age = None
    try:
        nws = sorted(
            config.REPORTS_DIR.glob("nws-weather-*.md"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        if nws:
            age_min = (datetime.now(timezone.utc).timestamp() - nws[0].stat().st_mtime) / 60.0
            nws_age = {"file": nws[0].name, "age_min": round(age_min, 0)}
    except Exception:
        pass

    counties = None
    try:
        from apps.core.services import nws_hawaii

        st = nws_hawaii.load_state()
        if st:
            counties = {
                "source": st.get("source"),
                "alert_count": st.get("alert_count"),
                "by_county": st.get("by_county"),
                "spoken": st.get("spoken"),
                "last_poll_hst": st.get("last_poll_hst"),
                "hash": st.get("hash"),
            }
            if st.get("spoken"):
                rows = list(rows) + [str(st.get("spoken"))]
    except Exception:
        pass

    return {
        "resource": "weather",
        "title": "Weather",
        "as_of": _now_line(),
        "lines": rows,
        "hurricane": hurricane,
        "nws_report": nws_age,
        "nws_hawaii_counties": counties,
    }


def build_kilauea() -> dict[str, Any]:
    alert = _state("kilauea-alert.json")
    situation = _state("kilauea-situation.json")
    level = alert.get("alert_level") or alert.get("alert") or "unknown"
    erupting = bool(alert.get("erupting")) if alert else None
    return {
        "resource": "kilauea",
        "title": "Kīlauea",
        "as_of": _now_line(),
        "alert_level": level if alert else None,
        "erupting": erupting,
        "headline": alert.get("headline") if alert else None,
        "color": alert.get("color") if alert else None,
        "updated": alert.get("updated") or alert.get("at") or alert.get("updated_at"),
        "situation_keys": sorted(situation.keys())[:12] if situation else [],
        "rules": [
            "Advisory / not erupting / paused is NOT an eruption.",
            "Say advisory and not erupting when erupting is false.",
            "Pronounce Kīlauea with the macron in speech notes.",
        ],
        "on_file": bool(alert),
    }


def build_chat() -> dict[str, Any]:
    brain_ok = False
    detail = ""
    try:
        from apps.core.services import boot_report

        brain_ok, detail = boot_report._brain_up()
    except Exception as e:
        detail = type(e).__name__
    grok = _state("grok-status.json")
    return {
        "resource": "chat",
        "title": "Public chat",
        "as_of": _now_line(),
        "on_device_brain": "UP" if brain_ok else "DOWN",
        "brain_detail": detail,
        "paid_cloud_voice": "halted" if grok.get("halt") else "check_ledger",
        "path": "edge → origin → on-device brain when warm",
        "rules": [
            "Public replies stay short and plain.",
            "No Aloha. No wall-power advice.",
        ],
    }


def build_packs() -> dict[str, Any]:
    grok = _state("grok-status.json")
    startup = _state("startup-voice.json")
    words = config.PUBLIC_MEDIA / "audio" / "words"
    count = 0
    try:
        if words.is_dir():
            count = sum(1 for _ in words.glob("*.mp3"))
    except Exception:
        pass
    return {
        "resource": "packs",
        "title": "Voice packs",
        "as_of": _now_line(),
        "mode": "local clip packs",
        "word_clips_on_disk": count,
        "paid_cloud_voice_halt": bool(grok.get("halt")),
        "startup_voice": {
            "ok": startup.get("ok"),
            "mode": startup.get("mode") or startup.get("voice_mode"),
        },
        "rules": [
            "Prefer local phrase clips over paid TTS when halted.",
            "Full report MP3 only when report-generation toggle tts is on and spend is allowed.",
        ],
    }


def build_day_board() -> dict[str, Any]:
    remaining: list[Any] = []
    try:
        from apps.core.services import day_board

        remaining = day_board.remaining() or []
    except Exception as e:
        remaining = [{"error": type(e).__name__}]
    board = _state("day-board.json")
    return {
        "resource": "day-board",
        "title": "Day board",
        "as_of": _now_line(),
        "remaining_count": len(remaining) if isinstance(remaining, list) else 0,
        "remaining": remaining[:20] if isinstance(remaining, list) else remaining,
        "state_keys": sorted(board.keys())[:20] if board else [],
    }


def build_minecraft() -> dict[str, Any]:
    live = _state("minecraft-live.json")
    return {
        "resource": "minecraft",
        "title": "Minecraft live",
        "as_of": _now_line(),
        "on_file": bool(live),
        "snapshot": live if live else None,
        "public": {
            "play": "https://play.rootmc.net/",
            "site": "https://rootmc.net/",
        },
    }


def build_context() -> dict[str, Any]:
    return {
        "resource": "context",
        "title": "Context hub",
        "as_of": _now_line(),
        "links": {
            "hub": f"{PUBLIC_AVA}/context",
            "dev": f"{PUBLIC_AVA}/context/dev",
            "api": f"{PUBLIC_ROOT}/api/context",
            "md": f"{PUBLIC_ROOT}/context.md",
            "llms": f"{PUBLIC_ROOT}/llms.txt",
            "ai": f"{PUBLIC_ROOT}/ai.txt",
            "data_hub": f"{PUBLIC_ORIGIN}/data",
        },
        "note": "Static GEO under /context; live measured facts under /data/*.",
    }


_BUILDERS: dict[str, Callable[[], dict[str, Any]]] = {
    "origin": build_origin,
    "power": build_power,
    "weather": build_weather,
    "kilauea": build_kilauea,
    "chat": build_chat,
    "packs": build_packs,
    "day-board": build_day_board,
    "minecraft": build_minecraft,
    "context": build_context,
}


def known_resources() -> list[str]:
    return list(_BUILDERS.keys())


def build_resource(resource_id: str) -> dict[str, Any] | None:
    fn = _BUILDERS.get(resource_id)
    if not fn:
        return None
    try:
        return fn()
    except Exception as e:
        log.warning("live data %s failed: %s", resource_id, e)
        return {
            "resource": resource_id,
            "title": resource_id,
            "as_of": _now_line(),
            "ok": False,
            "detail": "unavailable",
            "error_type": type(e).__name__,
        }


def build_all() -> dict[str, Any]:
    return {
        "schema": "ava-live-data-hub/v1",
        "as_of": _now_line(),
        "resources": {rid: build_resource(rid) for rid in known_resources()},
        "catalog": resource_catalog(),
        "link_bundle": link_bundle(),
    }


def to_markdown(payload: dict[str, Any]) -> str:
    """Human + machine readable markdown for a resource or hub."""
    if "resources" in payload and payload.get("schema") == "ava-live-data-hub/v1":
        lines = [
            "# Ava live data hub",
            "",
            f"As of: {payload.get('as_of')}",
            "",
            "Stable pages for report generation. Measured facts only.",
            "",
        ]
        for row in payload.get("catalog") or []:
            lines.append(f"- **{row['title']}** — `{row['page']}` · API `{row['api']}`")
        lines.append("")
        lines.append("## Snapshots")
        lines.append("")
        for rid, body in (payload.get("resources") or {}).items():
            lines.append(f"### {rid}")
            lines.append("")
            lines.append("```json")
            lines.append(json.dumps(body, indent=2, ensure_ascii=False, default=str))
            lines.append("```")
            lines.append("")
        return "\n".join(lines)

    title = payload.get("title") or payload.get("resource") or "Live data"
    lines = [
        f"# {title}",
        "",
        f"As of: {payload.get('as_of')}",
        "",
        "Measured facts only. Do not invent numbers.",
        "",
        "```json",
        json.dumps(payload, indent=2, ensure_ascii=False, default=str),
        "```",
        "",
    ]
    return "\n".join(lines)


def facts_block_for_report(*, report_type: str = "morning") -> str:
    """Concatenated markdown of all live resources + link URLs for the model."""
    bundle = link_bundle(report_type=report_type)
    parts = [
        f"LINK BUNDLE for {report_type} report. Prefer these URLs; facts below are fetched live.",
        f"Built: {bundle['built_hst']}",
        "",
        "Context:",
    ]
    for k, v in (bundle.get("context") or {}).items():
        parts.append(f"- {k}: {v}")
    parts.append("")
    parts.append("Live data pages:")
    for row in bundle.get("resources") or []:
        parts.append(f"- {row['title']}: {row['md']}")
    parts.append("")
    for rid in known_resources():
        body = build_resource(rid) or {}
        parts.append(f"--- {rid} ---")
        parts.append(to_markdown(body))
        parts.append("")
    return "\n".join(parts)

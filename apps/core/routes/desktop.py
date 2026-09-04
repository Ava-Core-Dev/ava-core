"""Desktop GUI contract — Node-era /api/* the Electron client still calls."""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import psutil
from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from .. import config
from ..services import ollama as ollama_svc
from ..services import persona as persona_svc

router = APIRouter(prefix="/api")
HST = ZoneInfo("Pacific/Honolulu")
STATE = config.DATA_DIR / "state"

WEATHER_COLLECTOR = Path.home() / "Desktop" / "ava-weather-gif-collector-hawaii-pacific-v7." / "ava-weather-gif-collector"
WEATHER_GIFS = config.MEDIA_DIR / "weather" / "gifs"


def _read_json(path: Path, default):
    if not path.is_file():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def _write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")


def _parse_hhmm(value: str) -> tuple[int, int] | None:
    raw = str(value or "").strip()
    if not raw or ":" not in raw:
        return None
    hh, mm = raw.split(":", 1)
    try:
        h, m = int(hh), int(mm)
    except ValueError:
        return None
    if not (0 <= h <= 23 and 0 <= m <= 59):
        return None
    return h, m


def _next_hst(hh: int, mm: int) -> datetime:
    now = datetime.now(HST)
    at = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
    if at <= now:
        at += timedelta(days=1)
    return at


def _clock_payload(kind: str, time_hst: str, *, source: str = "manual", extra: dict | None = None):
    parsed = _parse_hhmm(time_hst) or (22 if kind == "shutdown" else 10, 0)
    at = _next_hst(*parsed)
    label = at.strftime("%-I:%M %p HST") if os.name != "nt" else at.strftime("%I:%M %p HST")
    body = {
        "ok": True,
        "kind": kind,
        "timeHst": f"{parsed[0]:02d}:{parsed[1]:02d}",
        "atMs": int(at.timestamp() * 1000),
        "atIso": at.isoformat(),
        "label": label,
        "source": source,
        **(extra or {}),
    }
    return body


class TimeBody(BaseModel):
    time: str | None = None
    updatedBy: str | None = None
    useAverage: bool = False


class BannerBody(BaseModel):
    enabled: bool | None = None
    category: str | None = None
    title: str | None = None
    detail: str | None = None
    untilDate: str | None = None
    untilTimeHst: str | None = None


class OpsBannerBody(BaseModel):
    enabled: bool | None = None
    autoLowBank: bool | None = None
    showStart: bool | None = None
    showShutdown: bool | None = None


class RewriteBody(BaseModel):
    text: str = ""
    surface: str = "discord"
    context: list = Field(default_factory=list)
    provider: str = "exact"
    compare: bool = False


class CoreChatBody(BaseModel):
    text: str = ""
    messages: list = Field(default_factory=list)
    sessionId: str | None = None
    save: bool = True


class GoldBody(BaseModel):
    question: str = ""
    answer: str = ""
    sessionId: str | None = None
    provider: str = "ollama"
    source: str = "desktop"


class EnhanceBody(BaseModel):
    draft: str = ""
    context: list = Field(default_factory=list)
    provider: str = "dream"
    sessionId: str | None = None


class FinanceBody(BaseModel):
    action: str = ""
    model_config = {"extra": "allow"}


class BizBody(BaseModel):
    action: str = ""
    projectId: str | None = None
    categoryId: str | None = None
    description: str | None = None
    model_config = {"extra": "allow"}


class CronConfigBody(BaseModel):
    id: str
    disabled: bool | None = None
    everyMs: int | None = None


# ── Weather GIFs ──────────────────────────────────────────────────────────────

def _dir_info(kind: str, path: Path) -> dict:
    files = 0
    latest = 0
    if path.is_dir():
        for p in path.rglob("*"):
            if p.is_file():
                files += 1
                latest = max(latest, int(p.stat().st_mtime * 1000))
    return {
        "kind": kind,
        "abs": str(path),
        "rel": str(path),
        "files": files,
        "latestMtimeMs": latest or None,
    }


@router.get("/weather-gifs")
async def weather_gifs():
    leftover = config.MEDIA_DIR / "weather"
    dirs = [
        _dir_info("media-weather", leftover),
        _dir_info("gifs", WEATHER_GIFS),
        _dir_info("collector", WEATHER_COLLECTOR),
    ]
    return {
        "ok": True,
        "message": "Collector lives on the desktop Hawaii-Pacific v7 tree, not Ava-core.",
        "collector": str(WEATHER_COLLECTOR),
        "updater": {"abs": str(WEATHER_COLLECTOR)},
        "directories": dirs,
    }


# ── Projected shutdown / start / disruption / GFS ─────────────────────────────

@router.get("/projected-shutdown")
@router.post("/projected-shutdown")
async def projected_shutdown(body: TimeBody | None = None):
    from apps.core.services import schedule_clock

    path = STATE / "projected-shutdown.json"
    stored = _read_json(path, {"timeHst": "22:00", "source": "default"})
    stats = schedule_clock.stop_stats()
    avg = stats.get("average")
    sample = stats.get("sampleDays") or 0
    if body:
        if body.useAverage and avg:
            stored = {"timeHst": avg, "source": "average", "sampleDays": sample}
        elif body.time:
            stored = {"timeHst": body.time, "source": "manual", "updatedBy": body.updatedBy, "sampleDays": sample}
        _write_json(path, stored)
    source = stored.get("source") or "default"
    time_hst = stored.get("timeHst") or "22:00"
    if source != "manual" and avg:
        time_hst = avg
        source = "average" if sample else source
    extra = {
        "sampleDays": sample,
        "averageLabel": avg,
        "note": source,
    }
    return _clock_payload("shutdown", time_hst, source=source, extra=extra)


@router.get("/projected-start")
@router.post("/projected-start")
async def projected_start(body: TimeBody | None = None):
    from apps.core.services import schedule_clock

    path = STATE / "projected-start.json"
    stored = _read_json(path, {"timeHst": "10:00", "source": "default"})
    stats = schedule_clock.start_stats()
    avg = stats.get("average")
    sample = stats.get("sampleDays") or 0
    if body:
        if body.useAverage:
            stored = {
                "timeHst": avg or stored.get("timeHst") or "07:30",
                "source": "average",
                "sampleDays": sample,
            }
        elif body.time:
            stored = {"timeHst": body.time, "source": "manual", "updatedBy": body.updatedBy, "sampleDays": sample}
        _write_json(path, stored)
    source = stored.get("source") or "default"
    time_hst = stored.get("timeHst") or "10:00"
    if source != "manual" and avg:
        time_hst = avg
        source = "average"
    extra = {
        "sampleDays": sample,
        "note": source,
        "averageLabel": avg,
    }
    return _clock_payload(
        "start",
        time_hst,
        source=source,
        extra=extra,
    )


def _banner_payload(raw: dict) -> dict:
    enabled = bool(raw.get("enabled"))
    title = str(raw.get("title") or "").strip()
    detail = str(raw.get("detail") or "").strip()
    until_date = str(raw.get("untilDate") or "").strip()
    until_time = str(raw.get("untilTimeHst") or "").strip() or "10:00"
    until_ms = None
    until_label = ""
    ended = False
    if until_date:
        try:
            hhmm = _parse_hhmm(until_time) or (10, 0)
            at = datetime.strptime(until_date, "%Y-%m-%d").replace(tzinfo=HST)
            at = at.replace(hour=hhmm[0], minute=hhmm[1], second=0, microsecond=0)
            until_ms = int(at.timestamp() * 1000)
            until_label = at.strftime("%a %-I:%M %p HST")
            ended = at <= datetime.now(HST)
        except ValueError:
            until_ms = None
    show = enabled and bool(title or detail) and not ended
    cats = {
        "weather": "Weather",
        "power": "Power",
        "network": "Network",
        "maintenance": "Maintenance",
    }
    cat = raw.get("category") or "weather"
    return {
        "ok": True,
        "enabled": enabled,
        "show": show,
        "category": cat,
        "categoryLabel": cats.get(cat, cat),
        "title": title,
        "detail": detail,
        "untilDate": until_date,
        "untilTimeHst": until_time if until_date else "",
        "untilMs": until_ms,
        "untilLabel": until_label or "—",
        "ended": ended,
    }


@router.get("/disruption-banner")
@router.post("/disruption-banner")
async def disruption_banner(body: BannerBody | None = None):
    path = STATE / "disruption-banner.json"
    stored = _read_json(path, {})
    if body is not None and any(
        getattr(body, f) is not None
        for f in ("enabled", "category", "title", "detail", "untilDate", "untilTimeHst")
    ):
        patch = body.model_dump(exclude_none=True)
        stored.update(patch)
        _write_json(path, stored)
    return _banner_payload(stored)


async def _ops_paint_args() -> dict:
    from apps.core.services import ops_banner, sun_times

    hours = None
    host_pct = None
    plugged = None
    start_label = ""
    shutdown_label = ""
    try:
        from apps.core.crons.since_last_fire.solar_weather import live_snapshot
        snap = await live_snapshot() or {}
        energy = snap.get("energy") or {}
        flow = energy.get("flow") or {}
        hours = flow.get("hours_to_empty")
        tot = snap.get("totals") or {}
        cats = tot.get("categories") or {}
        site_w = (
            float(cats.get("server_mobile_w") or 0)
            + float(cats.get("starlink_lights_w") or 0)
            + float(cats.get("appliances_w") or 0)
            + float(cats.get("emergency_pack_w") or 0)
            + float(cats.get("hard_drives_12v_w") or 0)
        )
        stored = energy.get("stored_wh")
        if stored and site_w >= 20:
            hours = round(float(stored) / site_w, 1)
    except Exception:
        snap = {}
    if hours is None:
        remains = []
        for d in (snap.get("devices") or []):
            m = d.get("remain_min")
            try:
                if m is not None and float(m) > 0:
                    remains.append(float(m) / 60.0)
            except (TypeError, ValueError):
                pass
        if remains:
            hours = round(min(remains), 1)
    try:
        from apps.core.host_metrics import host_battery
        hb = host_battery() or {}
        host_pct = hb.get("pct")
        plugged = hb.get("plugged")
    except Exception:
        pass
    try:
        start = await projected_start(None)
        shutdown = await projected_shutdown(None)
        start_label = start.get("label") or ""
        shutdown_label = shutdown.get("label") or ""
    except Exception:
        pass
    sun = {}
    try:
        sun = sun_times.facts()
    except Exception:
        pass
    return ops_banner.paint(
        hours_to_empty=hours,
        host_battery_pct=host_pct,
        host_plugged=plugged,
        start_label=start_label,
        shutdown_label=shutdown_label,
        after_sunset=bool(sun.get("after_sunset")),
        sun=sun,
    )


@router.get("/ops-schedule-banner")
@router.post("/ops-schedule-banner")
async def ops_schedule_banner(body: OpsBannerBody | None = None):
    from apps.core.services import ops_banner

    if body is not None and any(
        getattr(body, f) is not None for f in ("enabled", "autoLowBank", "showStart", "showShutdown")
    ):
        ops_banner.write(body.model_dump(exclude_none=True))
    return await _ops_paint_args()


@router.get("/gfs")
async def gfs_outlook():
    return {
        "ok": True,
        "configured": False,
        "nextSunny": None,
        "error": None,
        "detail": "GFS collector is not on Python origin yet",
    }


@router.post("/gfs/refresh")
async def gfs_refresh():
    return await gfs_outlook()


# ── Rewrite / summarize / core-chat ───────────────────────────────────────────

_PROVIDERS = [
    {"id": "exact", "label": "Exactly the same"},
    {"id": "dream", "label": "Dream / Grok"},
    {"id": "cursor", "label": "Cursor / Root Server"},
    {"id": "ollama", "label": "Ollama"},
    {"id": "google", "label": "Google / Gemini"},
]


@router.get("/rewrite-providers")
async def rewrite_providers():
    up, models = await ollama_svc.tags()
    return {
        "ok": True,
        "providers": _PROVIDERS,
        "model": models[0] if models else config.OLLAMA_MODEL,
        "detail": "ready" if up else "ollama_down",
        "baseUrl": config.OLLAMA_URL,
    }


@router.get("/core-chat/status")
async def core_chat_status():
    up, models = await ollama_svc.tags()
    model = config.OLLAMA_MODEL
    if models and not any(config.OLLAMA_MODEL in m for m in models):
        model = models[0]
    _, source = persona_svc.system_prompt(surface="desk")
    return {
        "ok": up,
        "model": model,
        "providers": [p for p in _PROVIDERS if p["id"] != "exact"],
        "detail": "persona" if up else "ollama_down",
        "baseUrl": "http://127.0.0.1:8787",
        "direct": False,
        "persona": True,
        "personaSource": source,
        "via": "origin",
    }


@router.post("/rewrite")
async def api_rewrite(body: RewriteBody):
    text = (body.text or "").strip()
    if body.provider == "exact" or not text:
        cleaned = text.replace("$ ", "").strip() or text
        return {"ok": True, "text": cleaned, "via": "exact", "provider": "exact"}
    reply = await ollama_svc.chat(
        [
            {
                "role": "system",
                "content": "Rewrite this as Ava Ivy for public chat. Keep facts. Short. No invented numbers.",
            },
            {"role": "user", "content": text},
        ],
        timeout=25,
    )
    if not reply:
        return {"ok": True, "text": text, "via": "offline-fallback", "provider": body.provider}
    return {"ok": True, "text": reply.strip(), "via": "ollama", "provider": "ollama"}


@router.post("/summarize")
async def api_summarize(body: dict):
    text = str(body.get("text") or "")
    if not text.strip():
        return {"ok": False, "detail": "empty"}
    reply = await ollama_svc.chat(
        [
            {"role": "system", "content": "Summarize this channel dump for Alex. Short bullets."},
            {"role": "user", "content": text[:12000]},
        ],
        timeout=40,
    )
    return {"ok": bool(reply), "text": reply or "", "provider": "ollama"}


@router.post("/core-chat")
async def api_core_chat(body: CoreChatBody):
    history = [
        {"role": m.get("role"), "content": str(m.get("content") or "")[:8000]}
        for m in (body.messages or [])
        if m.get("role") in {"user", "assistant"}
    ]
    if body.text:
        history.append({"role": "user", "content": body.text})
    if not history:
        return {"ok": False, "detail": "empty_text"}
    started = time.time()
    _, source = persona_svc.system_prompt(surface="desk")
    facts = await persona_svc.live_facts()
    reply = await ollama_svc.chat(
        persona_svc.core_messages(history, facts=facts), timeout=120
    )
    ms = int((time.time() - started) * 1000)
    if not reply:
        return {"ok": False, "detail": "ollama_fail", "ms": ms, "persona": True}
    saved = False
    if body.save:
        gold = await api_core_gold(
            GoldBody(question=body.text, answer=reply, sessionId=body.sessionId, source="core-http")
        )
        saved = bool(gold.get("ok"))
    return {
        "ok": True,
        "reply": reply,
        "ms": ms,
        "model": config.OLLAMA_MODEL,
        "saved": saved,
        "sessionId": body.sessionId,
        "messages": history + [{"role": "assistant", "content": reply}],
        "direct": False,
        "persona": True,
        "personaSource": source,
        "via": "origin",
    }


@router.post("/core-chat/gold")
async def api_core_gold(body: GoldBody):
    path = config.DATA_DIR / "training" / "core-sessions.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    row = {
        "at": int(time.time() * 1000),
        "sessionId": body.sessionId,
        "kind": "gold",
        "provider": body.provider,
        "question": (body.question or "")[:4000],
        "answer": (body.answer or "")[:8000],
        "source": body.source,
    }
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(row) + "\n")
    return {"ok": True, "path": str(path)}


@router.post("/core-chat/enhance")
async def api_core_enhance(body: EnhanceBody):
    draft = (body.draft or "").strip()
    if not draft:
        return {"ok": False, "detail": "empty_draft"}
    reply = await ollama_svc.chat(
        [
            {"role": "system", "content": "Improve this Ava draft. Keep voice. Do not invent facts."},
            {"role": "user", "content": draft[:8000]},
        ],
        timeout=60,
    )
    if not reply:
        return {"ok": False, "detail": "enhance_unavailable", "provider": body.provider}
    return {"ok": True, "text": reply.strip(), "provider": "ollama"}


@router.get("/early-login")
@router.post("/early-login")
async def early_login():
    return {"ok": True, "detail": "noop"}


# ── Finance / biz ─────────────────────────────────────────────────────────────

@router.get("/finance")
@router.post("/finance")
async def api_finance(request: Request, body: FinanceBody | None = None):
    from apps.core.services import finance_desk, stripe_poll

    force = str(request.query_params.get("refresh") or "").lower() in {"1", "true", "yes"}
    if body and str(body.action or "").lower() in {"refresh", "stripe"}:
        force = True
    snap = await stripe_poll.ensure_snapshot(force=force)
    payload = finance_desk.desk_payload(snap)
    if body and body.action:
        payload["lastAction"] = body.action
    return payload


def _biz_payload() -> dict:
    stored = _read_json(STATE / "biz.json", {"entries": [], "active": {}})
    now = datetime.now(HST)
    cpu = psutil.cpu_percent(interval=None)
    procs = []
    for p in psutil.process_iter(["pid", "name", "cmdline", "cpu_percent", "memory_percent", "create_time"]):
        try:
            cmd = " ".join(p.info.get("cmdline") or [])
            name = p.info.get("name") or ""
            kind = None
            if "ollama" in name or "ollama" in cmd:
                kind = "ollama"
            elif "uvicorn" in cmd or "apps.core.main" in cmd or "electron" in name:
                kind = "ava"
            if not kind:
                continue
            procs.append(
                {
                    "kind": kind,
                    "pid": p.info["pid"],
                    "cpu": round(float(p.info.get("cpu_percent") or 0), 1),
                    "mem": round(float(p.info.get("memory_percent") or 0), 1),
                    "comm": name,
                    "etime": "",
                    "args": cmd[:80],
                }
            )
        except (psutil.Error, TypeError):
            continue
    ava_up = any(x["kind"] == "ava" for x in procs)
    return {
        "ok": True,
        "hstDay": now.strftime("%Y-%m-%d"),
        "ava": {"online": ava_up, "uptimeLabel": ""},
        "cpu": {"host": cpu, "ava": 0, "ollama": 0, "series": [], "procs": procs[:12]},
        "today": {"alexLabel": "0m", "avaLabel": "0m"},
        "week": {"alexH": 0, "avaH": 0},
        "active": stored.get("active") or {"alex": {"active": False, "projectId": "proj-ava", "categoryId": "cat-dev"}},
        "projects": stored.get("projects") or [{"id": "proj-ava", "name": "Ava"}],
        "categories": stored.get("categories") or [{"id": "cat-dev", "name": "Development"}],
        "entries": stored.get("entries") or [],
        "charts": {"hours7": []},
    }


@router.get("/biz")
@router.post("/biz")
async def api_biz(body: BizBody | None = None):
    path = STATE / "biz.json"
    stored = _read_json(path, {"entries": [], "active": {"alex": {"active": False}}})
    if body and body.action:
        active = stored.setdefault("active", {}).setdefault("alex", {"active": False})
        if body.action in {"clock-in", "in"}:
            active.update(
                {
                    "active": True,
                    "projectId": body.projectId or "proj-ava",
                    "categoryId": body.categoryId or "cat-dev",
                    "startAt": int(time.time() * 1000),
                }
            )
        elif body.action in {"clock-out", "out"} and active.get("active"):
            start = int(active.get("startAt") or time.time() * 1000)
            stored.setdefault("entries", []).insert(
                0,
                {
                    "personId": "alex",
                    "ms": int(time.time() * 1000) - start,
                    "description": body.description or "desktop",
                    "source": "desktop",
                    "startAt": start,
                    "projectId": active.get("projectId"),
                },
            )
            active["active"] = False
        stored["active"]["alex"] = active
        _write_json(path, stored)
    payload = _biz_payload()
    payload["active"] = stored.get("active") or payload["active"]
    payload["entries"] = stored.get("entries") or []
    return payload


# ── Cron config / restart / voice status ──────────────────────────────────────

@router.get("/cron/config")
@router.post("/cron/config")
async def cron_config(body: CronConfigBody | None = None):
    path = STATE / "cron-disabled.json"
    disabled = _read_json(path, {})
    if body and body.id:
        if body.disabled is not None:
            disabled[body.id] = bool(body.disabled)
            _write_json(path, disabled)
        return {"ok": True, "id": body.id, "disabled": bool(disabled.get(body.id))}
    return {"ok": True, "disabled": disabled}


@router.post("/restart")
async def api_restart():
    return {
        "ok": True,
        "detail": "origin_stays_up",
        "hint": "Desktop watchdog restarts Ava Core if /health dies. GUI close does not stop origin.",
    }


@router.post("/upgrade")
async def api_upgrade():
    return {"ok": False, "detail": "upgrade_not_from_http", "hint": "Pull on the SSD repo from a shell, then let the watchdog recycle origin."}


@router.get("/voice/status")
async def voice_status():
    try:
        from apps.voice.director import get_director

        return {"ok": True, **get_director().get_status()}
    except Exception as e:
        return {"ok": False, "detail": str(e)}


@router.post("/plugins/bump")
@router.post("/plugins/build")
@router.post("/plugins/release")
@router.post("/apps/bump")
@router.post("/apps/build")
@router.post("/apps/release")
async def release_action():
    return {
        "ok": False,
        "accepted": False,
        "detail": "release_pipeline_not_on_python_origin",
        "hint": "Use the workstation plugin/app trees. Origin will not spawn JDK builds from HTTP.",
    }

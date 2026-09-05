"""Report generation — local or cloud text + local|cloud MP3, with blog auto-save.

Toggle store: data/state/report-generation.json
Desk labels: Local | Cloud (internal cloud binding only). Scrub third-party names
from spoken/public text. NWS bodies never enter cloud generation packages.
"""
from __future__ import annotations

import json
import logging
import re
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from apps.core import config

log = logging.getLogger("ava.report_generation")
HST = ZoneInfo("Pacific/Honolulu")

STATE_PATH = config.DATA_DIR / "state" / "report-generation.json"
MIDDAY_SPEND_WINDOW_PATH = config.DATA_DIR / "state" / "midday-grok-window.json"

_ENGINE_ALIASES = {"grok": "cloud", "xai": "cloud", "ara": "cloud"}
_MP3_ALIASES = {"grok": "cloud", "xai": "cloud", "ara": "cloud", "stitch": "local"}

_DEFAULT_CONTEXT = [
    "https://avaivy.cloud/context",
    "https://avaivy.cloud/context.md",
    "https://avaivy.cloud/llms.txt",
    "https://avaivy.cloud/ai.txt",
    "https://avaivy.cloud/context/dev",
    "https://rootrecord.cloud/context",
    "https://rootrecord.cloud/context.md",
    "https://rootrecord.cloud/llms.txt",
    "https://rootrecord.cloud/ai.txt",
    "https://rootrecord.cloud/status",
    "https://origin.avaivy.cloud/data",
    "https://origin.avaivy.cloud/data/power",
    "https://origin.avaivy.cloud/data/weather",
    "https://origin.avaivy.cloud/data/kilauea",
    "https://origin.avaivy.cloud/data/origin",
    "https://origin.avaivy.cloud/data/day-board",
    # Kind is rewritten at package build time to morning|midday|evening.
    "https://origin.avaivy.cloud/data/report-links?type=morning&format=md",
]

_DEFAULT_FETCH = [
    "https://avaivy.cloud/context.md",
    "https://avaivy.cloud/llms.txt",
    "https://rootrecord.cloud/context.md",
]

_DEFAULT_REPORT = {
    "engine": "local",
    "mp3": "local",
    "tts": True,
    "blog": True,
    "blog_brands": ["ava", "rootrecord"],
    "max_tokens": 1800,
    "category": "runtime",
}


def normalize_engine(value: Any) -> str:
    s = str(value or "local").strip().lower()
    s = _ENGINE_ALIASES.get(s, s)
    return s if s in {"local", "cloud"} else "local"


def normalize_mp3(value: Any) -> str:
    s = str(value or "local").strip().lower()
    s = _MP3_ALIASES.get(s, s)
    return s if s in {"local", "cloud"} else "local"


def _default_config() -> dict:
    daily = {
        **_DEFAULT_REPORT,
        "engine": "local",
        "mp3": "local",
        "tts": True,
    }
    return {
        "version": 2,
        "week_of_grok": False,
        "week_note": (
            "Per-type toggles: engine local|cloud and mp3 local|cloud. "
            "Desk shows Local / Cloud only. Prefer local when cloud is unavailable. "
            "NWS never uses cloud generation."
        ),
        "context_urls": list(_DEFAULT_CONTEXT),
        "fetch_urls": list(_DEFAULT_FETCH),
        "reports": {
            "morning": dict(daily),
            "midday": dict(daily),
            "evening": dict(daily),
            "late": dict(daily),
            "hourly": {
                **_DEFAULT_REPORT,
                "engine": "local",
                "mp3": "local",
                "blog": False,
                "tts": False,
                "blog_brands": [],
            },
            "slot": {
                **_DEFAULT_REPORT,
                "engine": "local",
                "mp3": "local",
                "blog": False,
                "tts": False,
                "blog_brands": [],
            },
        },
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def _read() -> dict:
    if not STATE_PATH.is_file():
        return {}
    try:
        data = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _write(data: dict) -> dict:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    data = dict(data)
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    STATE_PATH.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    return data


def ensure_config() -> dict:
    """Load config; create defaults or merge missing report types / live data URLs."""
    cfg = _read()
    if not cfg:
        return _write(_default_config())

    changed = False
    base = _default_config()
    if "version" not in cfg:
        cfg["version"] = 2
        changed = True
    elif int(cfg.get("version") or 1) < 2:
        cfg["version"] = 2
        changed = True
    if "week_of_grok" not in cfg:
        cfg["week_of_grok"] = False
        changed = True
    if "week_note" not in cfg:
        cfg["week_note"] = base["week_note"]
        changed = True
    if not isinstance(cfg.get("context_urls"), list):
        cfg["context_urls"] = list(_DEFAULT_CONTEXT)
        changed = True
    else:
        # Ensure live /data hub is listed once.
        for url in (
            "https://origin.avaivy.cloud/data",
            "https://origin.avaivy.cloud/data/power",
            "https://origin.avaivy.cloud/data/weather",
            "https://origin.avaivy.cloud/data/kilauea",
            "https://origin.avaivy.cloud/data/origin",
            "https://origin.avaivy.cloud/data/day-board",
        ):
            if url not in cfg["context_urls"]:
                cfg["context_urls"].append(url)
                changed = True
    if not isinstance(cfg.get("fetch_urls"), list):
        cfg["fetch_urls"] = list(_DEFAULT_FETCH)
        changed = True
    reports = cfg.setdefault("reports", {})
    if not isinstance(reports, dict):
        cfg["reports"] = deepcopy(base["reports"])
        changed = True
        reports = cfg["reports"]
    for kind, row in base["reports"].items():
        if kind not in reports or not isinstance(reports[kind], dict):
            reports[kind] = dict(row)
            changed = True
        else:
            for field, val in row.items():
                if field not in reports[kind]:
                    reports[kind][field] = deepcopy(val)
                    changed = True
            # Migrate legacy grok → cloud for engine/mp3.
            eng = reports[kind].get("engine")
            if eng is not None:
                norm = normalize_engine(eng)
                if str(eng).strip().lower() != norm:
                    reports[kind]["engine"] = norm
                    changed = True
            mp3 = reports[kind].get("mp3")
            if mp3 is not None:
                norm_m = normalize_mp3(mp3)
                if str(mp3).strip().lower() != norm_m:
                    reports[kind]["mp3"] = norm_m
                    changed = True
            elif "mp3" not in reports[kind]:
                reports[kind]["mp3"] = "local"
                changed = True
    if changed:
        return _write(cfg)
    return cfg


def load() -> dict:
    return ensure_config()


def status() -> dict:
    cfg = load()
    from apps.core.services import xai

    window = _read_midday_window()
    reports = cfg.get("reports") or {}
    # Normalized view for Desk Local|Cloud toggles.
    normalized = {}
    for kind, row in reports.items() if isinstance(reports, dict) else []:
        if not isinstance(row, dict):
            continue
        normalized[kind] = {
            **row,
            "engine": normalize_engine(row.get("engine")),
            "mp3": normalize_mp3(row.get("mp3")),
        }
    return {
        "ok": True,
        "path": str(STATE_PATH),
        "week_of_grok": bool(cfg.get("week_of_grok")),
        "week_note": cfg.get("week_note"),
        "reports": normalized or reports,
        "context_urls": cfg.get("context_urls") or [],
        "fetch_urls": cfg.get("fetch_urls") or [],
        "grok_halted": bool(xai.grok_is_down()),
        "cloud_spend_ok": _spend_ok(),
        "midday_spend_window": window,
        "updated_at": cfg.get("updated_at"),
        "live_data_hub": "https://origin.avaivy.cloud/data",
        "engines": ["local", "cloud"],
        "mp3_modes": ["local", "cloud"],
    }


def _read_midday_window() -> dict:
    if not MIDDAY_SPEND_WINDOW_PATH.is_file():
        return {"active": False}
    try:
        data = json.loads(MIDDAY_SPEND_WINDOW_PATH.read_text(encoding="utf-8-sig"))
        return data if isinstance(data, dict) else {"active": False}
    except Exception:
        return {"active": False}


def open_midday_spend_window(*, note: str = "midday live Grok test") -> dict:
    """Lift Grok halt + spend_master for midday text only (TTS stays gated by toggle).

    Prior flags saved so close_midday_spend_window can restore. Idempotent.
    """
    from apps.core.services import api_ledger, xai

    prior = _read_midday_window()
    if prior.get("active") and prior.get("prior_grok") is not None:
        # Already open — refresh note/timestamp only.
        prior["note"] = str(note)[:200]
        prior["refreshed_at"] = datetime.now(HST).isoformat()
        MIDDAY_SPEND_WINDOW_PATH.write_text(
            json.dumps(prior, indent=2) + "\n", encoding="utf-8"
        )
        return {"ok": True, "already_open": True, "window": prior}

    grok_path = config.DATA_DIR / "state" / "grok-status.json"
    prior_grok = grok_path.read_text(encoding="utf-8") if grok_path.is_file() else None
    prior_flags = api_ledger.flags()
    window = {
        "active": True,
        "opened_at": datetime.now(HST).isoformat(),
        "note": str(note)[:200],
        "restore_after_midday": True,
        "tts_stays_off": True,
        "prior_grok": prior_grok,
        "prior_spend_master": bool(prior_flags.get("spend_master")),
        "prior_xai_allowed": bool(
            (prior_flags.get("accounts") or {}).get("xai", {}).get("spend_allowed")
        ),
        "prior_capture_enabled": bool(prior_flags.get("capture_enabled")),
    }
    MIDDAY_SPEND_WINDOW_PATH.parent.mkdir(parents=True, exist_ok=True)
    MIDDAY_SPEND_WINDOW_PATH.write_text(
        json.dumps(window, indent=2) + "\n", encoding="utf-8"
    )
    grok_path.write_text(
        json.dumps(
            {
                "ok": True,
                "halt": False,
                "at": datetime.now(timezone.utc).isoformat(),
                "note": str(note)[:200],
                "midday_window": True,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    api_ledger.write_flags(
        {
            "spend_master": True,
            "accounts": {"xai": {"spend_allowed": True}},
        }
    )
    log.info("midday Grok spend window OPEN (%s) halted=%s", note, xai.grok_is_down())
    return {
        "ok": True,
        "opened": True,
        "grok_halted": bool(xai.grok_is_down()),
        "may_spend": api_ledger.may_spend("xai"),
        "window_path": str(MIDDAY_SPEND_WINDOW_PATH),
    }


def close_midday_spend_window(*, reason: str = "midday_done") -> dict:
    """Restore operator halt / spend_master after midday live test."""
    from apps.core.services import api_ledger

    window = _read_midday_window()
    if not window.get("active"):
        return {"ok": True, "skipped": True, "reason": "no_active_window"}
    if not window.get("restore_after_midday", True):
        window["active"] = False
        window["closed_at"] = datetime.now(HST).isoformat()
        window["close_reason"] = str(reason)[:160]
        MIDDAY_SPEND_WINDOW_PATH.write_text(
            json.dumps(window, indent=2) + "\n", encoding="utf-8"
        )
        return {"ok": True, "skipped": True, "reason": "restore_disabled"}

    grok_path = config.DATA_DIR / "state" / "grok-status.json"
    prior_grok = window.get("prior_grok")
    try:
        if isinstance(prior_grok, str) and prior_grok.strip():
            grok_path.write_text(prior_grok, encoding="utf-8")
        else:
            grok_path.write_text(
                json.dumps(
                    {
                        "ok": False,
                        "halt": True,
                        "reason": "operator spend halt",
                        "at": datetime.now(timezone.utc).isoformat(),
                        "restored_after": "midday_window",
                    },
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )
        api_ledger.write_flags(
            {
                "spend_master": bool(window.get("prior_spend_master")),
                "capture_enabled": bool(window.get("prior_capture_enabled", True)),
                "accounts": {
                    "xai": {
                        "spend_allowed": bool(window.get("prior_xai_allowed")),
                    }
                },
            }
        )
        # Hard assert off if prior was off (common).
        if not window.get("prior_spend_master"):
            api_ledger.write_flags(
                {
                    "spend_master": False,
                    "accounts": {"xai": {"spend_allowed": False}},
                }
            )
    except Exception as e:
        log.warning("close midday spend window failed: %s", e)
        return {"ok": False, "detail": type(e).__name__}

    window["active"] = False
    window["closed_at"] = datetime.now(HST).isoformat()
    window["close_reason"] = str(reason)[:160]
    # Drop bulky prior_grok from closed record.
    window.pop("prior_grok", None)
    MIDDAY_SPEND_WINDOW_PATH.write_text(
        json.dumps(window, indent=2) + "\n", encoding="utf-8"
    )
    from apps.core.services import xai

    log.info(
        "midday Grok spend window CLOSED (%s) halted=%s",
        reason,
        xai.grok_is_down(),
    )
    return {
        "ok": True,
        "closed": True,
        "grok_halted": bool(xai.grok_is_down()),
        "may_spend": api_ledger.may_spend("xai"),
        "reason": reason,
    }


def patch(updates: dict) -> dict:
    cfg = load()
    if "week_of_grok" in updates:
        cfg["week_of_grok"] = bool(updates["week_of_grok"])
    if "week_note" in updates and updates["week_note"]:
        cfg["week_note"] = str(updates["week_note"])
    if "context_urls" in updates and isinstance(updates["context_urls"], list):
        cfg["context_urls"] = [str(u) for u in updates["context_urls"] if str(u).strip()]
    if "fetch_urls" in updates and isinstance(updates["fetch_urls"], list):
        cfg["fetch_urls"] = [str(u) for u in updates["fetch_urls"] if str(u).strip()]
    if "reports" in updates and isinstance(updates["reports"], dict):
        reports = cfg.setdefault("reports", {})
        for kind, row in updates["reports"].items():
            if not isinstance(row, dict):
                continue
            cur = reports.setdefault(str(kind), dict(_DEFAULT_REPORT))
            for k, v in row.items():
                if k == "engine":
                    cur[k] = normalize_engine(v)
                    continue
                if k == "mp3":
                    cur[k] = normalize_mp3(v)
                    continue
                cur[k] = v
    # Drop legacy dual-schema keys so one shape wins.
    cfg.pop("types", None)
    cfg.pop("defaults", None)
    cfg.pop("schema", None)
    cfg.pop("note", None)
    return _write(cfg)


def type_settings(kind: str) -> dict:
    cfg = load()
    row = dict(_DEFAULT_REPORT)
    row.update((cfg.get("reports") or {}).get(kind) or {})
    row["engine"] = normalize_engine(row.get("engine"))
    row["mp3"] = normalize_mp3(row.get("mp3"))
    row["kind"] = kind
    return row


def engine_for(kind: str) -> str:
    return normalize_engine(type_settings(kind).get("engine"))


def mp3_for(kind: str) -> str:
    return normalize_mp3(type_settings(kind).get("mp3"))


def set_engine(kind: str, engine: str) -> dict:
    engine = normalize_engine(engine)
    if engine not in {"local", "cloud"}:
        raise ValueError("engine must be local or cloud")
    return patch({"reports": {kind: {"engine": engine}}})


def set_mp3(kind: str, mp3: str) -> dict:
    mp3 = normalize_mp3(mp3)
    if mp3 not in {"local", "cloud"}:
        raise ValueError("mp3 must be local or cloud")
    return patch({"reports": {kind: {"mp3": mp3}}})


def _spend_ok() -> bool:
    from apps.core.services import xai

    return not xai.grok_is_down()


def resolve_engine(kind: str, *, offline: bool = False, force: str | None = None) -> str:
    if offline:
        return "local"
    if force:
        wanted = normalize_engine(force)
    else:
        wanted = engine_for(kind)
    if wanted == "cloud" and not _spend_ok():
        log.info("%s: toggle=cloud but spend halted — local", kind)
        return "local"
    return wanted


def resolve_mp3(kind: str, *, force: str | None = None) -> str:
    wanted = normalize_mp3(force) if force else mp3_for(kind)
    if wanted == "cloud" and not _spend_ok():
        log.info("%s: mp3=cloud but spend halted — local stitch", kind)
        return "local"
    return wanted


def _context_urls_for_kind(kind: str, cfg: dict | None = None) -> list[str]:
    """Config context URLs with report-links typed for this kind + required /data pages."""
    from apps.core.services import live_data_pages

    cfg = cfg or load()
    kind = (kind or "morning").strip().lower()
    urls: list[str] = []
    seen: set[str] = set()

    def _add(url: str) -> None:
        u = str(url or "").strip()
        if not u or u in seen:
            return
        seen.add(u)
        urls.append(u)

    for raw in cfg.get("context_urls") or []:
        u = str(raw or "").strip()
        if "report-links" in u and "type=" in u:
            # Never hand morning links to a midday Grok call (and vice versa).
            if f"type={kind}" in u:
                _add(u)
            else:
                _add(
                    f"https://origin.avaivy.cloud/data/report-links?type={kind}&format=md"
                )
            continue
        _add(u)

    live = live_data_pages.link_bundle(report_type=kind)
    ctx = live.get("context") or {}
    for key in (
        "data_hub",
        "hub",
        "hub_rootrecord",
        "llms",
        "llms_ava",
        "context_md",
        "context_md_ava",
        "status_desk",
        "status_ava",
        "solar",
        "solar_ava",
    ):
        val = ctx.get(key)
        if val:
            _add(str(val))
    rl = ctx.get("report_links")
    if rl:
        rl_s = str(rl)
        _add(f"{rl_s}&format=md" if "?" in rl_s else f"{rl_s}?format=md")
    for row in live.get("resources") or []:
        md = row.get("md")
        if md:
            _add(str(md))
    for must in (
        f"https://origin.avaivy.cloud/data/report-links?type={kind}&format=md",
        "https://origin.avaivy.cloud/data/power?format=md",
        "https://origin.avaivy.cloud/data/weather?format=md",
        "https://origin.avaivy.cloud/data/kilauea?format=md",
        "https://origin.avaivy.cloud/data/origin?format=md",
        "https://origin.avaivy.cloud/data/day-board?format=md",
    ):
        _add(must)
    return urls


def link_bundle(kind: str = "morning") -> dict:
    """Context URLs from config + live /data pages (kind-correct report-links)."""
    from apps.core.services import live_data_pages

    cfg = load()
    live = live_data_pages.link_bundle(report_type=kind)
    return {
        "schema": "ava-report-link-bundle/v1",
        "kind": kind,
        "built_hst": datetime.now(HST).strftime("%Y-%m-%d %H:%M Hawaiian Standard Time"),
        "context_urls": _context_urls_for_kind(kind, cfg),
        "fetch_urls": list(cfg.get("fetch_urls") or []),
        "live_data": live,
    }


def _fetch_url_text(url: str, *, timeout: int = 20) -> str:
    try:
        import requests

        r = requests.get(url, timeout=timeout)
        if r.status_code >= 400:
            return f"[fetch {url} → HTTP {r.status_code}]"
        text = (r.text or "")[:12000]
        return f"### {url}\n\n{text}\n"
    except Exception as e:
        return f"[fetch {url} → {type(e).__name__}]\n"


def _kind_operator_facts(kind: str) -> str:
    """Midday/morning spoken FACTS block (Broken / Already landed / diffs / Priority).

    live_data_pages alone does not carry these — Grok noon 2026-09-04 said
    'I do not have it live' for Broken/Already landed because they were missing.
    """
    kind = (kind or "morning").strip().lower()
    try:
        if kind == "midday":
            from apps.core.services import midday_report

            return midday_report.build_facts(source="report_generation_grok", include_timestamp=True)
        if kind == "morning":
            from apps.core.services import boot_report

            return boot_report.build_facts(source="report_generation_grok")
    except Exception as e:
        log.warning("%s operator facts failed: %s", kind, e)
        return f"[operator facts unavailable: {type(e).__name__}]"
    return ""


_REQUIRED_MARKERS = {
    "midday": (
        "Broken / needs work",
        "Already landed",
        "Priority:",
        "Kīlauea",
    ),
    "morning": (
        "Broken / needs work",
        "Already landed",
        "Priority:",
        "Kīlauea",
    ),
}

_REQUIRED_LIVE_IDS = (
    "origin",
    "power",
    "weather",
    "kilauea",
    "day-board",
)


def validate_prompt_package(pkg: dict, *, kind: str) -> dict:
    """Fail loud when the Grok package is incomplete — do not spend on thin garbage."""
    kind = (kind or "morning").strip().lower()
    missing: list[str] = []
    facts = str(pkg.get("local_live_facts") or "")
    op = str(pkg.get("operator_facts") or "")
    combined = facts + "\n" + op
    fetched = str(pkg.get("fetched_markdown") or "")
    bundle = pkg.get("bundle") if isinstance(pkg.get("bundle"), dict) else {}
    urls = [str(u) for u in (bundle.get("context_urls") or [])]
    live = bundle.get("live_data") if isinstance(bundle.get("live_data"), dict) else {}
    live_ids = {str(r.get("id") or "") for r in (live.get("resources") or []) if isinstance(r, dict)}

    if len(facts.strip()) < 800:
        missing.append("local_live_facts_too_short")
    if kind in _REQUIRED_MARKERS and len(op.strip()) < 400:
        missing.append("operator_facts_too_short")
    for marker in _REQUIRED_MARKERS.get(kind, ()):
        if marker not in combined:
            missing.append(f"marker:{marker}")
    for rid in _REQUIRED_LIVE_IDS:
        if rid not in live_ids:
            missing.append(f"live_resource:{rid}")
    report_link = f"report-links?type={kind}"
    if not any(report_link in u for u in urls):
        missing.append(f"url:{report_link}")
    for must in ("/data/power", "/data/weather", "/data/kilauea", "/data/day-board"):
        if not any(must in u for u in urls):
            missing.append(f"url:{must}")
    fetch_errors = fetched.count("[fetch ")
    fetch_ok_blocks = fetched.count("### http")
    if fetch_ok_blocks < 1:
        missing.append("fetched_context_empty")
    if fetch_errors and fetch_ok_blocks == 0:
        missing.append("fetched_context_all_failed")

    ok = not missing
    return {
        "ok": ok,
        "kind": kind,
        "missing": missing,
        "facts_chars": len(facts),
        "operator_facts_chars": len(op),
        "fetched_chars": len(fetched),
        "context_url_count": len(urls),
        "live_resource_count": len(live_ids),
        "detail": "complete" if ok else "incomplete_package:" + ",".join(missing[:12]),
    }


def _nws_cloud_safe_lines() -> list[str]:
    """Short NWS one-liners only — never full CAP / spoken body for cloud prompts."""
    try:
        from apps.core.services import nws_hawaii

        lines = []
        for line in nws_hawaii.facts_lines():
            s = str(line or "").strip()
            if not s:
                continue
            # Drop full spoken script / CAP dump lines.
            if s.lower().startswith("nws county spoken script"):
                continue
            if len(s) > 240:
                s = s[:237] + "…"
            lines.append(s)
        return lines[:24]
    except Exception as e:
        return [f"NWS Hawaii: unavailable ({type(e).__name__})."]


def _scrub_nws_from_facts(text: str) -> str:
    """Remove bulky NWS bodies from a facts block before cloud generation."""
    out = text or ""
    # Drop spoken script lines / long CAP blobs.
    cleaned: list[str] = []
    for line in out.splitlines():
        low = line.lower()
        if "nws county spoken script" in low:
            continue
        if "\"raw\"" in low or "\"description\"" in low and len(line) > 400:
            continue
        cleaned.append(line)
    body = "\n".join(cleaned)
    # Append safe short lines so weather context remains.
    safe = _nws_cloud_safe_lines()
    if safe:
        body = (
            body.rstrip()
            + "\n\n=== NWS Hawaii (short local summary only; no CAP body) ===\n"
            + "\n".join(safe)
            + "\n"
        )
    return body


def build_prompt_package(kind: str, *, for_cloud: bool = False) -> dict:
    """URLs + fetched context + live /data facts + kind operator FACTS for cloud/local."""
    from apps.core.services import live_data_pages

    cfg = load()
    kind = (kind or "morning").strip().lower()
    bundle = link_bundle(kind)
    fetched: list[str] = []
    for url in cfg.get("fetch_urls") or []:
        fetched.append(_fetch_url_text(str(url)))
    # Always include origin live facts (no public round-trip required).
    local_facts = live_data_pages.facts_block_for_report(report_type=kind)
    if for_cloud:
        # NWS bodies must never go to cloud generation.
        local_facts = _scrub_nws_from_facts(local_facts)
    operator_facts = _kind_operator_facts(kind)
    # Single block handed to the model: live pages + spoken FACTS with Broken/landed/Priority.
    combined = local_facts
    if operator_facts.strip():
        combined = (
            local_facts.rstrip()
            + "\n\n=== KIND OPERATOR FACTS (required spoken sections) ===\n"
            + operator_facts.strip()
            + "\n"
        )
    pkg = {
        "bundle": bundle,
        "fetched_markdown": "\n".join(fetched),
        "local_live_facts": combined,
        "operator_facts": operator_facts,
        "live_data_facts_only": local_facts,
        "for_cloud": bool(for_cloud),
        "nws_policy": "short_local_only" if for_cloud else "full_local_ok",
    }
    pkg["validation"] = validate_prompt_package(pkg, kind=kind)
    return pkg


def dump_prompt_package(kind: str, *, dest: Path | None = None) -> dict:
    """Write a dry package dump for operator proof (no Grok spend)."""
    kind = (kind or "morning").strip().lower()
    pkg = build_prompt_package(kind)
    path = dest or (config.DATA_DIR / "state" / f"report-package-dump-{kind}.md")
    path.parent.mkdir(parents=True, exist_ok=True)
    val = pkg.get("validation") or {}
    urls = "\n".join(f"- {u}" for u in ((pkg.get("bundle") or {}).get("context_urls") or []))
    body = (
        f"# Report package dump — {kind}\n\n"
        f"Built: {datetime.now(HST).isoformat()}\n"
        f"Validation: {json.dumps(val, ensure_ascii=False)}\n\n"
        f"## Context URLs ({val.get('context_url_count')})\n\n{urls}\n\n"
        f"## Fetched context ({val.get('fetched_chars')} chars)\n\n"
        f"{pkg.get('fetched_markdown') or ''}\n\n"
        f"## Combined live + operator facts ({val.get('facts_chars')} chars)\n\n"
        f"{pkg.get('local_live_facts') or ''}\n"
    )
    path.write_text(body, encoding="utf-8")
    meta = {
        "ok": bool(val.get("ok")),
        "kind": kind,
        "path": str(path),
        "validation": val,
        "bytes": len(body.encode("utf-8")),
    }
    meta_path = config.DATA_DIR / "state" / f"report-package-dump-{kind}.json"
    meta_path.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    return meta


def _persona_lock(kind: str) -> str:
    if kind == "midday":
        try:
            from apps.core.services import midday_report

            return midday_report.load_midday_lock()
        except Exception:
            pass
    if kind == "morning":
        try:
            from apps.core.services import boot_report

            return boot_report.load_boot_lock()
        except Exception:
            pass
    return (
        "You ARE Ava Ivy writing an Ava Core Root Record status for easy audio readout. "
        "No Aloha. Never invent watts. Off-grid only — never advise wall power. "
        "Kīlauea advisory ≠ erupting. Short sentences. OUTPUT ONLY the report text."
    )


def _text_has_required_sections(kind: str, text: str) -> tuple[bool, list[str]]:
    """Reject Grok output that still claims required sections are not live."""
    t = text or ""
    low = t.lower()
    missing: list[str] = []
    if "end of status" not in low:
        missing.append("End of status")
    for lead in ("Broken / needs work", "Already landed", "Priority"):
        if lead.lower() not in low:
            missing.append(lead)
    # Only fail when Broken / Already landed still claim "not live" (the noon bug).
    for section in ("broken / needs work", "already landed"):
        idx = low.find(section)
        if idx < 0:
            continue
        window = low[idx : idx + 320]
        if "i do not have it live" in window:
            missing.append(f"{section}:still_not_live")
    if kind == "midday" and "12 noon" not in low and "noon" not in low:
        missing.append("noon_clock")
    return (not missing), missing


def _generate_grok(kind: str, *, max_tokens: int = 1800) -> dict:
    from apps.core.services import boot_report, xai

    pkg = build_prompt_package(kind, for_cloud=True)
    val = pkg.get("validation") or validate_prompt_package(pkg, kind=kind)
    if not val.get("ok"):
        log.error(
            "%s cloud blocked — incomplete package: %s",
            kind,
            val.get("detail"),
        )
        return {
            "ok": False,
            "engine": "cloud",
            "detail": val.get("detail") or "incomplete_package",
            "package": pkg,
            "validation": val,
            "blocked": True,
        }

    bundle = pkg["bundle"]
    stamp_note = "Include a Hawaiian Standard Time clock stamp in the opening line."
    if kind == "midday":
        stamp_note = (
            'Open with noon clock: "about 12 noon Hawaiian Standard Time" '
            "(even if built at 11:55)."
        )
    # Full link list (not capped so hard that day-board / report-links drop off).
    url_list = list(bundle.get("context_urls") or [])
    urls = "\n".join(f"- {u}" for u in url_list[:48])
    live_urls = ""
    live = bundle.get("live_data") or {}
    for row in live.get("resources") or []:
        live_urls += f"- {row.get('title')}: {row.get('md')}\n"
    ctx_ptrs = ""
    for k, v in (live.get("context") or {}).items():
        ctx_ptrs += f"- {k}: {v}\n"

    user = (
        f"Write today's {kind} Ava Core Root Record full status.\n"
        f"{stamp_note}\n\n"
        "Use ONLY measured facts from the pages/blocks below. Do not invent.\n"
        "Broken / needs work, Already landed, and Priority ARE in the FACTS — "
        "do not say you do not have them live.\n"
        "Never name third-party vendors or engines in the report text.\n\n"
        f"Context / discovery URLs:\n{urls}\n\n"
        f"Live data pages:\n{live_urls}\n"
        f"Link bundle pointers:\n{ctx_ptrs}\n"
        f"Fetched context:\n{pkg['fetched_markdown'][:24000]}\n\n"
        f"Origin live facts + kind operator FACTS:\n{pkg['local_live_facts'][:28000]}\n"
    )
    messages = [
        {"role": "system", "content": _persona_lock(kind)},
        {"role": "user", "content": user},
    ]
    text = xai.try_chat(messages, max_tokens=max_tokens, timeout=120)
    if not text or len(text.strip()) < 80:
        return {
            "ok": False,
            "engine": "cloud",
            "detail": "thin_or_empty",
            "package": pkg,
            "validation": val,
        }
    scrubbed = boot_report.scrub_spoken(text)
    sections_ok, section_missing = _text_has_required_sections(kind, scrubbed)
    if not sections_ok:
        log.error(
            "%s cloud output rejected — missing sections %s",
            kind,
            section_missing,
        )
        return {
            "ok": False,
            "engine": "cloud",
            "detail": "incomplete_output:" + ",".join(section_missing),
            "package": pkg,
            "validation": val,
            "text_rejected": scrubbed[:500],
            "blocked": True,
        }
    return {
        "ok": True,
        "engine": "cloud",
        "text": scrubbed,
        "include_timestamp": True,
        "package": pkg,
        "validation": val,
        "source_urls": url_list,
    }


def _generate_local(kind: str, *, offline: bool = False) -> dict:
    if kind == "midday":
        from apps.core.services import midday_report

        return midday_report.generate_spoken(
            source="report_generation",
            include_timestamp=not offline,
            offline=offline,
        )
    if kind == "morning":
        from apps.core.services import boot_report

        return boot_report.generate_spoken(
            source="report_generation",
            include_timestamp=not offline,
            offline=offline,
        )
    from apps.core.services import boot_report, live_data_pages, ollama as ollama_svc

    facts = live_data_pages.facts_block_for_report(report_type=kind)
    if offline:
        return {
            "ok": True,
            "engine": "offline_stub",
            "text": f"This is the Ava Core Root Record {kind} status. End of status.\n",
            "include_timestamp": False,
        }
    reply = ollama_svc.chat_sync(
        [
            {"role": "system", "content": _persona_lock(kind)},
            {"role": "user", "content": f"Write today's {kind} status from FACTS only.\n\n{facts}"},
        ],
        timeout=180,
        num_predict=1200,
        keep_alive="10m",
    )
    if not reply or len(reply.strip()) < 80:
        return {
            "ok": True,
            "engine": "offline_stub",
            "text": f"This is the Ava Core Root Record {kind} status. End of status.\n",
            "include_timestamp": False,
        }
    return {
        "ok": True,
        "engine": "local",
        "text": boot_report.scrub_spoken(reply),
        "include_timestamp": True,
    }


def _write_files(kind: str, text: str, *, stamped: bool) -> dict:
    from apps.core.services import boot_report

    now = datetime.now(HST)
    day = now.strftime("%Y-%m-%d")
    config.REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    body = text if text.endswith("\n") else text + "\n"
    if kind == "midday":
        dated = config.REPORTS_DIR / f"midday-boot-{day}.md"
        current = config.REPORTS_DIR / "midday-boot-current.md"
    elif kind == "morning":
        dated = config.REPORTS_DIR / f"morning-boot-{day}.md"
        current = config.REPORTS_DIR / "morning-boot-current.md"
        (config.REPORTS_DIR / "morning-report-current.md").write_text(body, encoding="utf-8")
    else:
        dated = config.REPORTS_DIR / f"{kind}-{day}.md"
        current = config.REPORTS_DIR / f"{kind}-current.md"
    dated.write_text(body, encoding="utf-8")
    current.write_text(body, encoding="utf-8")
    return {
        "dated": str(dated),
        "current": str(current),
        "day": day,
        "bytes": len(body.encode("utf-8")),
        "scrub": boot_report.scrub_path_clean(body),
        "stamp": (
            now.strftime("%Y-%m-%d %H:%M") + " Hawaiian Standard Time" if stamped else None
        ),
    }


def generate(
    kind: str,
    *,
    dry_run: bool = True,
    force_engine: str | None = None,
    force_mp3: str | None = None,
    allow_tts: bool = False,
    publish: bool | None = None,
    offline: bool = False,
    update_board: bool = True,
    play_after: bool = False,
) -> dict:
    """Main entry used by crons + /api/reports/generation/run.

    dry_run=True (default for API): package + resolved engine only — no model,
    no Media write, no blog, no TTS. Cron passes dry_run=False.
    """
    kind = (kind or "morning").strip().lower()
    settings = type_settings(kind)
    wanted = normalize_engine(force_engine) if force_engine else engine_for(kind)
    engine = resolve_engine(kind, offline=offline, force=force_engine)
    wanted_mp3 = normalize_mp3(force_mp3) if force_mp3 else mp3_for(kind)
    mp3_mode = resolve_mp3(kind, force=force_mp3)
    max_tokens = int(settings.get("max_tokens") or 1800)

    if dry_run:
        pkg = None
        try:
            pkg = build_prompt_package(kind, for_cloud=(engine == "cloud"))
        except Exception as e:
            pkg = {"error": type(e).__name__}
        fetched_n = 0
        if isinstance(pkg, dict) and pkg.get("fetched_markdown"):
            fetched_n = len(str(pkg.get("fetched_markdown")))
        val = (pkg or {}).get("validation") if isinstance(pkg, dict) else None
        # Optional offline stub preview (no Ollama/cloud) so operators can see shape.
        preview = ""
        preview_engine = None
        if offline:
            stub = _generate_local(kind, offline=True)
            preview = str(stub.get("text") or "")
            preview_engine = stub.get("engine") or "offline_stub"
        return {
            "ok": bool((val or {}).get("ok", True)),
            "dry_run": True,
            "kind": kind,
            "engine": preview_engine or engine,
            "engine_would": engine,
            "wanted_engine": wanted,
            "mp3_would": mp3_mode,
            "wanted_mp3": wanted_mp3,
            "include_timestamp": False if offline else (engine != "local" or not offline),
            "text": preview or None,
            "text_preview": (preview[:500] + ("…" if len(preview) > 500 else "")) if preview else None,
            "settings": {
                "engine": settings.get("engine"),
                "mp3": settings.get("mp3"),
                "tts": settings.get("tts"),
                "blog": settings.get("blog"),
                "blog_brands": settings.get("blog_brands"),
            },
            "tts_would": bool(settings.get("tts"))
            and allow_tts
            and (mp3_mode == "local" or _spend_ok()),
            "blog_would": bool(settings.get("blog"))
            if publish is None
            else bool(publish),
            "package_chars": fetched_n,
            "local_facts_chars": len(str((pkg or {}).get("local_live_facts") or "")),
            "operator_facts_chars": len(str((pkg or {}).get("operator_facts") or "")),
            "context_urls": (pkg or {}).get("bundle", {}).get("context_urls")
            if isinstance(pkg, dict)
            else None,
            "validation": val,
            "note": (
                "dry_run — no Media write, no blog, no TTS"
                + ("; offline stub text included" if offline else "; no model call")
            ),
            "cloud_spend_ok": _spend_ok(),
            "grok_spend_ok": _spend_ok(),  # back-compat
        }

    if update_board and kind in {"morning", "midday", "evening", "late"}:
        try:
            from apps.core.services import daily_report_board

            daily_report_board.ensure_today()
            daily_report_board.mark_running(kind)
        except Exception as e:
            log.debug("board mark_running skipped: %s", e)

    if engine == "cloud":
        gen = _generate_grok(kind, max_tokens=max_tokens)
        if not gen.get("ok"):
            # Incomplete package / rejected output: fail loud — do not publish thin garbage
            # or burn TTS. Local fallback only when cloud was thin_or_empty (API miss),
            # not when the package itself was incomplete.
            if gen.get("blocked"):
                log.error(
                    "%s cloud blocked — no publish/TTS (%s)",
                    kind,
                    gen.get("detail"),
                )
                out_blocked = {
                    "ok": False,
                    "kind": kind,
                    "engine": "cloud",
                    "wanted_engine": settings.get("engine"),
                    "wanted_mp3": wanted_mp3,
                    "dry_run": False,
                    "detail": gen.get("detail"),
                    "validation": gen.get("validation"),
                    "blocked": True,
                    "files": {},
                    "blog": {"ok": False, "skipped": True, "detail": "blocked_incomplete"},
                    "tts": {"ok": False, "skipped": True, "detail": "blocked_incomplete"},
                    "text_preview": gen.get("text_rejected"),
                }
                if update_board and kind in {"morning", "midday", "evening", "late"}:
                    try:
                        from apps.core.services import daily_report_board

                        daily_report_board.mark_failed(
                            kind, error=str(gen.get("detail") or "blocked")
                        )
                    except Exception:
                        pass
                return out_blocked
            log.warning("%s cloud thin — local fallback", kind)
            gen = _generate_local(kind, offline=False)
            engine = str(gen.get("engine") or "local")
    else:
        gen = _generate_local(kind, offline=offline)
        engine = str(gen.get("engine") or engine)

    text = str(gen.get("text") or "").strip()
    from apps.core.services import boot_report

    if text:
        text = boot_report.scrub_spoken(text).strip()
    stamped = bool(gen.get("include_timestamp"))
    preview = text[:500] + ("…" if len(text) > 500 else "")
    source_urls = list(gen.get("source_urls") or [])
    if not source_urls and isinstance(gen.get("package"), dict):
        source_urls = list(
            ((gen.get("package") or {}).get("bundle") or {}).get("context_urls") or []
        )
    out: dict[str, Any] = {
        "ok": bool(text),
        "kind": kind,
        "engine": engine,
        "wanted_engine": settings.get("engine"),
        "wanted_mp3": wanted_mp3,
        "mp3_mode": mp3_mode,
        "include_timestamp": stamped,
        "dry_run": False,
        "text_preview": preview,
        "validation": gen.get("validation"),
        "settings": {
            "engine": settings.get("engine"),
            "mp3": settings.get("mp3"),
            "tts": settings.get("tts"),
            "blog": settings.get("blog"),
            "blog_brands": settings.get("blog_brands"),
        },
        "files": {},
        "blog": {"ok": False, "skipped": True},
        "tts": {"ok": False, "skipped": True},
    }
    if not text:
        out["detail"] = "empty"
        if update_board and kind in {"morning", "midday", "evening", "late"}:
            try:
                from apps.core.services import daily_report_board

                daily_report_board.mark_failed(kind, error="empty")
            except Exception:
                pass
        return out

    files = _write_files(kind, text, stamped=stamped)
    out["files"] = files
    out["text"] = text

    do_blog = settings.get("blog") if publish is None else bool(publish)
    if do_blog:
        from apps.core.services import report_blog

        blog = report_blog.publish_report_post(
            report_type=kind,
            text=text,
            engine=engine,
            brands=list(settings.get("blog_brands") or ["ava", "rootrecord"]),
            audio_rel=None,
            source_urls=source_urls or None,
            sync=True,
        )
        out["blog"] = blog

    tts_toggle = bool(settings.get("tts"))
    if allow_tts and tts_toggle:
        if mp3_mode == "local":
            tts = synthesize_local_mp3(kind, text)
            out["tts"] = tts
        else:
            tts = synthesize_mp3(kind, text)
            if not tts.get("ok"):
                # Cloud voice blocked/failed → local stitch fallback.
                log.info("%s cloud mp3 failed (%s) — local stitch", kind, tts.get("detail"))
                tts = synthesize_local_mp3(kind, text)
                tts["fallback_from"] = "cloud"
            out["tts"] = tts
        if tts.get("ok") and out.get("blog", {}).get("ok"):
            from apps.core.services import report_blog

            out["blog"] = report_blog.publish_report_post(
                report_type=kind,
                text=text,
                engine=engine,
                brands=list(settings.get("blog_brands") or ["ava", "rootrecord"]),
                audio_rel=tts.get("rel"),
                source_urls=source_urls or None,
                sync=True,
            )
    else:
        out["tts"] = {
            "ok": False,
            "skipped": True,
            "detail": "tts_off_or_not_allowed",
            "toggle": tts_toggle,
            "allow_tts": allow_tts,
            "mp3_mode": mp3_mode,
        }

    if update_board and kind in {"morning", "midday", "evening", "late"}:
        try:
            from apps.core.services import daily_report_board

            tts = out.get("tts") or {}
            mp3_path = tts.get("current") or tts.get("mp3")
            # Text success marks done even if MP3 skipped (play cron can use prior file).
            daily_report_board.mark_done(
                kind,
                mp3=str(mp3_path) if mp3_path else None,
                engine=str(engine),
            )
        except Exception as e:
            log.debug("board mark_done skipped: %s", e)

    if play_after:
        out["play_deferred"] = True
        out["play_hint"] = "await voice_events.play_report_mp3 after success"

    return out


# Back-compat alias used by earlier drafts in this pass.
generate_report = generate


_MULTIWORD_PHRASES = (
    "end_of_status",
    "root_record",
    "ava_core",
    "ava_ivy",
    "hawaiian_standard_time",
    "already_landed",
    "hawaii_pacific_solar_root_server",
    "root_server",
    "this_is",
    "partly_cloudy",
    "state_of_charge",
)


def text_to_clip_tokens(text: str, *, max_tokens: int = 120) -> str:
    """Map scrubbed report prose → space-separated local clip stems."""
    from apps.voice.clips import _find_clip

    raw = (text or "").lower()
    raw = re.sub(r"[^\w\sʻ'`\-]", " ", raw)
    raw = raw.replace("ʻ", "").replace("'", "")
    # Prefer known multiword stems.
    for phrase in _MULTIWORD_PHRASES:
        spaced = phrase.replace("_", " ")
        if spaced in raw:
            raw = raw.replace(spaced, f" {phrase} ")
    raw = raw.replace("kīlauea", "kilauea").replace("kilauea", "kilauea")
    bits: list[str] = []
    for tok in raw.split():
        clean = re.sub(r"[^a-z0-9_]", "", tok)
        if not clean:
            continue
        if _find_clip(clean):
            bits.append(clean)
            if len(bits) >= max_tokens:
                break
            continue
        if clean.isdigit():
            bits.append(clean)
            if len(bits) >= max_tokens:
                break
    return " ".join(bits)


def _kind_identity_script(kind: str) -> str:
    from apps.voice.clips import _find_clip
    from apps.voice.local_tts import clock_tokens, date_tokens

    now = datetime.now(HST)
    bits: list[str] = []
    for tok in ("this_is", "this", "is", "the", "ava_core", "ava", "core", "root_record", "status", "for"):
        if _find_clip(tok) or tok.isdigit():
            if tok in {"this", "is"} and "this_is" in bits:
                continue
            bits.append(tok)
            if tok == "this_is":
                break
    bits += [t for t in date_tokens(now) if _find_clip(t) or t.isdigit()]
    bits.append("about")
    bits += [t for t in clock_tokens(now.hour, now.minute)]
    kind_tok = {
        "morning": "morning",
        "midday": "midday",
        "evening": "evening",
        "late": "late",
    }.get(kind, "report")
    for tok in (kind_tok, "report", "end_of_status", "end"):
        if _find_clip(tok):
            bits.append(tok)
    # Dedupe consecutive.
    out: list[str] = []
    for b in bits:
        if out and out[-1] == b:
            continue
        out.append(b)
    return " ".join(out)


def synthesize_local_mp3(kind: str, text: str) -> dict:
    """Local clip stitch from report tokens, or reuse existing current MP3."""
    from apps.voice.local_tts import speak_script

    now = datetime.now(HST)
    stamp = now.strftime("%Y%m%d-%H%M")
    dest = config.GENERATED_DIR / f"{kind}-report-{stamp}.mp3"
    current = config.GENERATED_DIR / f"{kind}-report-current.mp3"
    config.GENERATED_DIR.mkdir(parents=True, exist_ok=True)

    script = text_to_clip_tokens(text)
    if script.count(" ") < 7:
        script = _kind_identity_script(kind)

    built = speak_script(script, dest)
    if built.get("ok") and dest.is_file() and dest.stat().st_size > 0:
        try:
            current.write_bytes(dest.read_bytes())
        except OSError:
            pass
        rel = f"audio/voice/generated/{dest.name}"
        return {
            "ok": True,
            "engine": "local",
            "mp3": str(dest),
            "current": str(current),
            "rel": rel,
            "script": script,
            "clips": built.get("clips"),
            "missing": built.get("missing") or [],
            "chars": len(text or ""),
        }

    # Fall back to existing current MP3 (play path without restitch).
    if current.is_file() and current.stat().st_size > 0:
        return {
            "ok": True,
            "engine": "local",
            "mp3": str(current),
            "current": str(current),
            "rel": f"audio/voice/generated/{current.name}",
            "reused": True,
            "detail": built.get("detail") or "stitched_thin_reused_current",
            "missing": built.get("missing") or [],
            "script": script,
        }
    return {
        "ok": False,
        "engine": "local",
        "detail": built.get("detail") or "local_stitch_failed",
        "missing": built.get("missing") or [],
        "script": script,
        "skipped": False,
    }


def synthesize_mp3(kind: str, text: str) -> dict:
    """Paid cloud TTS. Metered — only when toggle + allow_tts + spend open."""
    from apps.core.services import xai

    if not _spend_ok():
        return {"ok": False, "detail": "spend_halted", "skipped": True, "engine": "cloud"}
    now = datetime.now(HST)
    stamp = now.strftime("%Y%m%d-%H%M")
    dest = config.GENERATED_DIR / f"{kind}-report-{stamp}.mp3"
    current = config.GENERATED_DIR / f"{kind}-report-current.mp3"
    try:
        config.GENERATED_DIR.mkdir(parents=True, exist_ok=True)
        xai.tts(text, dest)
        current.write_bytes(dest.read_bytes())
    except Exception as e:
        log.warning("report TTS failed: %s", e)
        return {"ok": False, "detail": type(e).__name__, "skipped": False, "engine": "cloud"}
    rel = f"audio/voice/generated/{dest.name}"
    return {
        "ok": True,
        "engine": "cloud",
        "mp3": str(dest),
        "current": str(current),
        "rel": rel,
        "chars": len(text),
    }

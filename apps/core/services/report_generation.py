"""Report generation — Grok-from-URLs (week one) then local, with blog auto-save.

Toggle store: data/state/report-generation.json
Live facts: /data/* pages + context URLs in the link bundle.
"""
from __future__ import annotations

import json
import logging
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
    "https://origin.avaivy.cloud/data/report-links?type=morning&format=md",
]

_DEFAULT_FETCH = [
    "https://avaivy.cloud/context.md",
    "https://avaivy.cloud/llms.txt",
    "https://rootrecord.cloud/context.md",
]

_DEFAULT_REPORT = {
    "engine": "grok",
    "tts": False,
    "blog": True,
    "blog_brands": ["ava", "rootrecord"],
    "max_tokens": 1800,
    "category": "runtime",
}


def _default_config() -> dict:
    return {
        "version": 1,
        "week_of_grok": True,
        "week_note": (
            "Accumulate published Grok reports + context so later local "
            "generation has examples. Prefer engine=grok for morning/midday "
            "until local is ready. Keep tts=false until text is right (~$0.10 Ara/success)."
        ),
        "context_urls": list(_DEFAULT_CONTEXT),
        "fetch_urls": list(_DEFAULT_FETCH),
        "reports": {
            "morning": {**_DEFAULT_REPORT, "engine": "grok", "tts": False},
            "midday": {**_DEFAULT_REPORT, "engine": "grok", "tts": False},
            "evening": {**_DEFAULT_REPORT, "engine": "local", "tts": False},
            "hourly": {
                **_DEFAULT_REPORT,
                "engine": "local",
                "blog": False,
                "tts": False,
                "blog_brands": [],
            },
            "slot": {
                **_DEFAULT_REPORT,
                "engine": "local",
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
        cfg["version"] = 1
        changed = True
    if "week_of_grok" not in cfg:
        cfg["week_of_grok"] = True
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
    if changed:
        return _write(cfg)
    return cfg


def load() -> dict:
    return ensure_config()


def status() -> dict:
    cfg = load()
    from apps.core.services import xai

    window = _read_midday_window()
    return {
        "ok": True,
        "path": str(STATE_PATH),
        "week_of_grok": bool(cfg.get("week_of_grok")),
        "week_note": cfg.get("week_note"),
        "reports": cfg.get("reports") or {},
        "context_urls": cfg.get("context_urls") or [],
        "fetch_urls": cfg.get("fetch_urls") or [],
        "grok_halted": bool(xai.grok_is_down()),
        "midday_spend_window": window,
        "updated_at": cfg.get("updated_at"),
        "live_data_hub": "https://origin.avaivy.cloud/data",
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
                if k == "engine" and str(v).lower() not in {"grok", "local"}:
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
    row["kind"] = kind
    return row


def engine_for(kind: str) -> str:
    return str(type_settings(kind).get("engine") or "grok").lower()


def set_engine(kind: str, engine: str) -> dict:
    engine = (engine or "").strip().lower()
    if engine not in {"grok", "local"}:
        raise ValueError("engine must be grok or local")
    return patch({"reports": {kind: {"engine": engine}}})


def _spend_ok() -> bool:
    from apps.core.services import xai

    return not xai.grok_is_down()


def resolve_engine(kind: str, *, offline: bool = False, force: str | None = None) -> str:
    if offline:
        return "local"
    if force in {"grok", "local"}:
        wanted = force
    else:
        wanted = engine_for(kind)
    if wanted == "grok" and not _spend_ok():
        log.info("%s: toggle=grok but spend halted — local", kind)
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
    for key in (
        "data_hub",
        "report_links",
        "hub",
        "hub_rootrecord",
        "llms",
        "context_md",
        "status_desk",
        "solar",
    ):
        val = (live.get("context") or {}).get(key)
        if val:
            _add(str(val) if "format=" in str(val) or not str(val).endswith("/data/report-links") else f"{val}?format=md")
    # report_links without format — add md form explicitly
    rl = (live.get("context") or {}).get("report_links")
    if rl:
        _add(f"{rl}&format=md" if "?" in str(rl) else f"{rl}?format=md")
    for row in live.get("resources") or []:
        md = row.get("md")
        if md:
            _add(str(md))
    # Hard requirements for noon/morning packages
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


def build_prompt_package(kind: str) -> dict:
    """URLs + fetched context + live /data facts + kind operator FACTS for Grok/local."""
    from apps.core.services import live_data_pages

    cfg = load()
    kind = (kind or "morning").strip().lower()
    bundle = link_bundle(kind)
    fetched: list[str] = []
    for url in cfg.get("fetch_urls") or []:
        fetched.append(_fetch_url_text(str(url)))
    # Always include origin live facts (no public round-trip required).
    local_facts = live_data_pages.facts_block_for_report(report_type=kind)
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


def _generate_grok(kind: str, *, max_tokens: int = 1800) -> dict:
    from apps.core.services import boot_report, xai

    pkg = build_prompt_package(kind)
    bundle = pkg["bundle"]
    stamp_note = "Include a Hawaiian Standard Time clock stamp in the opening line."
    if kind == "midday":
        stamp_note = (
            'Open with noon clock: "about 12 noon Hawaiian Standard Time" '
            "(even if built at 11:55)."
        )
    urls = "\n".join(f"- {u}" for u in (bundle.get("context_urls") or [])[:24])
    live_urls = ""
    live = bundle.get("live_data") or {}
    for row in live.get("resources") or []:
        live_urls += f"- {row.get('title')}: {row.get('md')}\n"

    user = (
        f"Write today's {kind} Ava Core Root Record full status.\n"
        f"{stamp_note}\n\n"
        "Use ONLY measured facts from the pages/blocks below. Do not invent.\n\n"
        f"Context / discovery URLs:\n{urls}\n\n"
        f"Live data pages:\n{live_urls}\n\n"
        f"Fetched context:\n{pkg['fetched_markdown'][:20000]}\n\n"
        f"Origin live facts:\n{pkg['local_live_facts'][:20000]}\n"
    )
    messages = [
        {"role": "system", "content": _persona_lock(kind)},
        {"role": "user", "content": user},
    ]
    text = xai.try_chat(messages, max_tokens=max_tokens, timeout=120)
    if not text or len(text.strip()) < 80:
        return {"ok": False, "engine": "grok", "detail": "thin_or_empty", "package": pkg}
    return {
        "ok": True,
        "engine": "grok",
        "text": boot_report.scrub_spoken(text),
        "include_timestamp": True,
        "package": pkg,
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
    allow_tts: bool = False,
    publish: bool | None = None,
    offline: bool = False,
) -> dict:
    """Main entry used by crons + /api/reports/generation/run.

    dry_run=True (default for API): package + resolved engine only — no model,
    no Media write, no blog, no TTS. Cron passes dry_run=False.
    """
    kind = (kind or "morning").strip().lower()
    settings = type_settings(kind)
    wanted = force_engine or engine_for(kind)
    engine = resolve_engine(kind, offline=offline, force=force_engine)
    max_tokens = int(settings.get("max_tokens") or 1800)

    if dry_run:
        pkg = None
        try:
            pkg = build_prompt_package(kind)
        except Exception as e:
            pkg = {"error": type(e).__name__}
        fetched_n = 0
        if isinstance(pkg, dict) and pkg.get("fetched_markdown"):
            fetched_n = len(str(pkg.get("fetched_markdown")))
        # Optional offline stub preview (no Ollama/Grok) so operators can see shape.
        preview = ""
        preview_engine = None
        if offline:
            stub = _generate_local(kind, offline=True)
            preview = str(stub.get("text") or "")
            preview_engine = stub.get("engine") or "offline_stub"
        return {
            "ok": True,
            "dry_run": True,
            "kind": kind,
            "engine": preview_engine or engine,
            "engine_would": engine,
            "wanted_engine": wanted,
            "include_timestamp": False if offline else (engine != "local" or not offline),
            "text": preview or None,
            "text_preview": (preview[:500] + ("…" if len(preview) > 500 else "")) if preview else None,
            "settings": {
                "engine": settings.get("engine"),
                "tts": settings.get("tts"),
                "blog": settings.get("blog"),
                "blog_brands": settings.get("blog_brands"),
            },
            "tts_would": bool(settings.get("tts")) and allow_tts and _spend_ok(),
            "blog_would": bool(settings.get("blog"))
            if publish is None
            else bool(publish),
            "package_chars": fetched_n,
            "local_facts_chars": len(str((pkg or {}).get("local_live_facts") or "")),
            "context_urls": (pkg or {}).get("bundle", {}).get("context_urls")
            if isinstance(pkg, dict)
            else None,
            "note": (
                "dry_run — no Media write, no blog, no TTS"
                + ("; offline stub text included" if offline else "; no model call")
            ),
            "grok_spend_ok": _spend_ok(),
        }

    if engine == "grok":
        gen = _generate_grok(kind, max_tokens=max_tokens)
        if not gen.get("ok"):
            log.warning("%s Grok thin — local fallback", kind)
            gen = _generate_local(kind, offline=False)
            engine = str(gen.get("engine") or "local")
    else:
        gen = _generate_local(kind, offline=offline)
        engine = str(gen.get("engine") or engine)

    text = str(gen.get("text") or "").strip()
    stamped = bool(gen.get("include_timestamp"))
    preview = text[:500] + ("…" if len(text) > 500 else "")
    out: dict[str, Any] = {
        "ok": bool(text),
        "kind": kind,
        "engine": engine,
        "wanted_engine": settings.get("engine"),
        "include_timestamp": stamped,
        "dry_run": False,
        "text_preview": preview,
        "settings": {
            "engine": settings.get("engine"),
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
            sync=True,
        )
        out["blog"] = blog

    tts_toggle = bool(settings.get("tts"))
    if allow_tts and tts_toggle and _spend_ok():
        tts = synthesize_mp3(kind, text)
        out["tts"] = tts
        if tts.get("ok") and out.get("blog", {}).get("ok"):
            from apps.core.services import report_blog

            out["blog"] = report_blog.publish_report_post(
                report_type=kind,
                text=text,
                engine=engine,
                brands=list(settings.get("blog_brands") or ["ava", "rootrecord"]),
                audio_rel=tts.get("rel"),
                sync=True,
            )
    elif allow_tts and tts_toggle:
        out["tts"] = {"ok": False, "skipped": True, "detail": "spend_or_engine"}
    else:
        out["tts"] = {
            "ok": False,
            "skipped": True,
            "detail": "tts_off_or_not_allowed",
            "toggle": tts_toggle,
            "allow_tts": allow_tts,
        }

    return out


# Back-compat alias used by earlier drafts in this pass.
generate_report = generate


def synthesize_mp3(kind: str, text: str) -> dict:
    """Paid Ara/xAI TTS. Metered — only when toggle + allow_tts + spend open."""
    from apps.core.services import xai

    if not _spend_ok():
        return {"ok": False, "detail": "spend_halted", "skipped": True}
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
        return {"ok": False, "detail": type(e).__name__, "skipped": False}
    rel = f"audio/voice/generated/{dest.name}"
    return {"ok": True, "mp3": str(dest), "current": str(current), "rel": rel, "chars": len(text)}

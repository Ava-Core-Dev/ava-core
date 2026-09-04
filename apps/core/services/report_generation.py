"""Report generation toggles + Grok/local orchestrator.

Near-term default for full morning/midday: Grok fed a link bundle + live
facts pages. After ~1 week of saved blog corpus, flip toggles to local.
Hourly/slot stay local by default.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from apps.core import config

log = logging.getLogger("ava.report_generation")
HST = ZoneInfo("Pacific/Honolulu")

CONFIG_NAME = "report-generation.json"

# Full long-form types default to grok for the corpus week.
# Short/offline stubs always force local/factual (no clock stamp).
DEFAULT_TYPES = {
    "morning": {
        "engine": "grok",
        "auto_blog": True,
        "tts": True,
        "brands": ["ava"],
        "include_timestamp": True,
    },
    "midday": {
        "engine": "grok",
        "auto_blog": True,
        "tts": True,
        "brands": ["ava"],
        "include_timestamp": True,
        "trigger_hst": "11:55",
        "presents_as": "12:00 noon",
    },
    "evening": {
        "engine": "grok",
        "auto_blog": True,
        "tts": False,
        "brands": ["ava"],
        "include_timestamp": True,
    },
    "hourly": {
        "engine": "local",
        "auto_blog": False,
        "tts": False,
        "brands": [],
        "include_timestamp": False,
    },
    "slot": {
        "engine": "local",
        "auto_blog": False,
        "tts": False,
        "brands": [],
        "include_timestamp": False,
    },
}


def config_path() -> Path:
    return config.DATA_DIR / "state" / CONFIG_NAME


def _read_json(path: Path) -> dict:
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def default_config() -> dict:
    return {
        "schema": "ava-report-generation/v1",
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "note": (
            "Per-type engine: grok | local. Grok is week-one default for full "
            "morning/midday/evening. Spend halt still blocks paid calls. "
            "Offline stubs always local with no clock stamp."
        ),
        "defaults": {
            "engine": "grok",
            "auto_blog": True,
            "tts": True,
        },
        "types": {k: dict(v) for k, v in DEFAULT_TYPES.items()},
    }


def ensure_config() -> dict:
    path = config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    existing = _read_json(path)
    if existing.get("schema") == "ava-report-generation/v1" and existing.get("types"):
        # Fill any missing type keys without overwriting operator choices.
        types = existing.setdefault("types", {})
        changed = False
        for key, row in DEFAULT_TYPES.items():
            if key not in types:
                types[key] = dict(row)
                changed = True
            else:
                for field, val in row.items():
                    if field not in types[key]:
                        types[key][field] = val
                        changed = True
        if changed:
            existing["updated_at"] = datetime.now(timezone.utc).isoformat()
            path.write_text(json.dumps(existing, indent=2) + "\n", encoding="utf-8")
        return existing
    payload = default_config()
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return payload


def load() -> dict:
    return ensure_config()


def save(payload: dict) -> dict:
    path = config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = dict(payload)
    payload["schema"] = "ava-report-generation/v1"
    payload["updated_at"] = datetime.now(timezone.utc).isoformat()
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return payload


def set_engine(report_type: str, engine: str) -> dict:
    engine = (engine or "").strip().lower()
    if engine not in {"grok", "local"}:
        raise ValueError("engine must be grok or local")
    cfg = load()
    row = cfg.setdefault("types", {}).setdefault(report_type, {})
    row["engine"] = engine
    return save(cfg)


def type_settings(report_type: str) -> dict:
    cfg = load()
    defaults = cfg.get("defaults") or {}
    row = dict(defaults)
    row.update((cfg.get("types") or {}).get(report_type) or {})
    row["report_type"] = report_type
    return row


def engine_for(report_type: str) -> str:
    return str(type_settings(report_type).get("engine") or "grok").lower()


def _grok_spend_ok() -> bool:
    from apps.core.services import xai

    return not xai.grok_is_down()


def resolve_engine(report_type: str, *, offline: bool = False) -> str:
    """Effective engine after toggles + spend halt + offline."""
    if offline:
        return "local"
    wanted = engine_for(report_type)
    if wanted == "grok" and not _grok_spend_ok():
        log.info("%s: toggle=grok but spend halted — using local", report_type)
        return "local"
    return wanted


_GROK_SYSTEM = """You ARE Ava Ivy writing an Ava Core Root Record status for easy audio readout.

Hard rules:
- No "Aloha". Never say HP, OmniBook, laptop brand, or any PC maker name.
- Never name third parties or engines: no Cloudflare, Grok, Ollama, Electron, Vulkan, Radeon, Shockbyte, GitHub, Discord product pitches, llama, qwen, Cursor, xAI, ChatGPT.
- Say instead: on-device brain, paid cloud voice, public tunnel, Ava Desk, edge, local graphics, public code host, player chat, dream state.
- Never invent watts, percents, times, or alert levels. Use ONLY the FACTS / live data block. If a fact is missing, say you do not have it live.
- Off-grid solar site only. Never advise wall power, plug in, AC power, wall outlet, or dock as power advice.
- No repo paths, env vars, stack traces, or raw JSON dumps in the spoken report.
- Short sentences. Numbers spoken naturally. Separate paragraphs with blank lines.
- Do not use markdown ## headings. Use spoken lead-ins as plain sentences.
- Pronunciation: Ava / Ava Core / Ava Ivy / Root Record. Never bare HI or HST — say Hawaii / Hawaiian Standard Time.
- Kīlauea: advisory / not erupting is NOT an eruption.

OUTPUT ONLY the report text. No preamble.
"""


def _persona_lock(report_type: str) -> str:
    if report_type == "midday":
        try:
            from apps.core.services import midday_report

            return midday_report.load_midday_lock()
        except Exception:
            pass
    if report_type == "morning":
        try:
            from apps.core.services import boot_report

            return boot_report.load_boot_lock()
        except Exception:
            pass
    return _GROK_SYSTEM


def generate_via_grok(
    report_type: str,
    *,
    include_timestamp: bool = True,
    max_tokens: int = 1400,
) -> dict:
    """Full Grok path: link bundle + live facts pages → text. No TTS here."""
    from apps.core.services import live_data_pages, xai

    facts = live_data_pages.facts_block_for_report(report_type=report_type)
    bundle = live_data_pages.link_bundle(report_type=report_type)
    stamp_note = (
        "Include a clear Hawaiian Standard Time clock stamp in the opening line."
        if include_timestamp
        else "Do not put any clock time in the opening — weekday date only."
    )
    if report_type == "midday" and include_timestamp:
        stamp_note = (
            'Open with noon clock: "about 12 noon Hawaiian Standard Time" '
            "(even if built at 11:55)."
        )

    system = _persona_lock(report_type)
    user = (
        f"Write today's {report_type} Ava Core Root Record status from the live data below.\n"
        f"{stamp_note}\n\n"
        "Public URLs (cite mentally; do not invent):\n"
        + "\n".join(
            f"- {r['title']}: {r['md']}" for r in (bundle.get("resources") or [])
        )
        + "\n\n"
        + facts
    )
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    text = xai.try_chat(messages, max_tokens=max_tokens, timeout=120)
    if not text or len(text.strip()) < 80:
        return {
            "ok": False,
            "engine": "grok",
            "detail": "thin_or_empty",
            "include_timestamp": include_timestamp,
            "link_bundle": bundle,
            "facts": facts,
        }
    from apps.core.services import boot_report

    cleaned = boot_report.scrub_spoken(text)
    return {
        "ok": True,
        "engine": "grok",
        "text": cleaned,
        "include_timestamp": include_timestamp,
        "link_bundle": bundle,
        "facts": facts,
        "tts": False,
    }


def generate_via_local(
    report_type: str,
    *,
    include_timestamp: bool = True,
    offline: bool = False,
) -> dict:
    """Delegate to existing morning/midday on-device paths."""
    if report_type == "midday":
        from apps.core.services import midday_report

        return midday_report.generate_spoken(
            source="report_generation",
            include_timestamp=include_timestamp and not offline,
            offline=offline,
        )
    if report_type == "morning":
        from apps.core.services import boot_report

        return boot_report.generate_spoken(
            source="report_generation",
            include_timestamp=include_timestamp and not offline,
            offline=offline,
        )
    # Generic local via Ollama using live facts.
    from apps.core.services import live_data_pages, ollama as ollama_svc
    from apps.core.services import boot_report

    facts = live_data_pages.facts_block_for_report(report_type=report_type)
    if offline:
        return {
            "ok": True,
            "engine": "offline_stub",
            "text": (
                f"This is the Ava Core Root Record {report_type} status. "
                "Live details are not in this short sample. End of status.\n"
            ),
            "include_timestamp": False,
            "facts": facts,
        }
    messages = [
        {"role": "system", "content": _persona_lock(report_type)},
        {
            "role": "user",
            "content": f"Write today's {report_type} status from these FACTS only.\n\n{facts}",
        },
    ]
    reply = ollama_svc.chat_sync(messages, timeout=180, num_predict=1200, keep_alive="10m")
    if not reply or len(reply.strip()) < 80:
        return {
            "ok": True,
            "engine": "offline_stub",
            "text": (
                f"This is the Ava Core Root Record {report_type} status. "
                "The on-device brain was thin. End of status.\n"
            ),
            "include_timestamp": False,
            "facts": facts,
        }
    return {
        "ok": True,
        "engine": "local",
        "text": boot_report.scrub_spoken(reply),
        "include_timestamp": include_timestamp,
        "facts": facts,
    }


def generate_report(
    report_type: str,
    *,
    offline: bool = False,
    dry_run: bool = False,
    force_engine: str | None = None,
) -> dict:
    """Generate full text, optionally auto-blog + TTS per toggles.

    dry_run: write nothing to blog / no TTS. Still returns text.
    """
    settings = type_settings(report_type)
    include_timestamp = bool(settings.get("include_timestamp", True)) and not offline
    engine = (force_engine or resolve_engine(report_type, offline=offline)).lower()

    if engine == "grok":
        gen = generate_via_grok(report_type, include_timestamp=include_timestamp)
        if not gen.get("ok"):
            log.warning("%s Grok failed (%s) — falling back local", report_type, gen.get("detail"))
            gen = generate_via_local(
                report_type, include_timestamp=include_timestamp, offline=False
            )
            engine = gen.get("engine") or "local"
    else:
        gen = generate_via_local(
            report_type, include_timestamp=include_timestamp, offline=offline
        )
        engine = gen.get("engine") or engine

    text = str(gen.get("text") or "").strip()
    stamped = bool(gen.get("include_timestamp"))
    out: dict = {
        "ok": bool(text),
        "report_type": report_type,
        "engine": engine,
        "wanted_engine": settings.get("engine"),
        "include_timestamp": stamped,
        "text": text + ("\n" if text and not text.endswith("\n") else ""),
        "dry_run": dry_run,
        "settings": settings,
        "link_bundle": gen.get("link_bundle"),
    }
    if not text:
        out["detail"] = "empty"
        return out

    # Persist markdown into reports dir for morning/midday compatibility.
    if not dry_run:
        written = _write_report_files(report_type, out["text"], engine=engine, stamped=stamped)
        out.update(written)

        if settings.get("auto_blog"):
            from apps.core.services import report_blog

            blog = report_blog.publish_report_post(
                report_type=report_type,
                text=out["text"],
                engine=str(engine),
                brands=list(settings.get("brands") or ["ava"]),
                audio_rel=None,
                sync=False,
            )
            out["blog"] = blog

        if settings.get("tts") and engine == "grok" and _grok_spend_ok():
            # TTS is opt-in via toggle; foundation records intent. Callers may
            # synthesize separately to avoid double spend.
            out["tts_wanted"] = True
        else:
            out["tts_wanted"] = False
    return out


def _write_report_files(
    report_type: str, text: str, *, engine: str, stamped: bool
) -> dict:
    now = datetime.now(HST)
    day = now.strftime("%Y-%m-%d")
    config.REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    body = text if text.endswith("\n") else text + "\n"
    if report_type == "midday":
        dated = config.REPORTS_DIR / f"midday-boot-{day}.md"
        current = config.REPORTS_DIR / "midday-boot-current.md"
    elif report_type == "morning":
        dated = config.REPORTS_DIR / f"morning-boot-{day}.md"
        current = config.REPORTS_DIR / "morning-boot-current.md"
        # Also keep morning-report-current for desk board.
        (config.REPORTS_DIR / "morning-report-current.md").write_text(body, encoding="utf-8")
    else:
        dated = config.REPORTS_DIR / f"{report_type}-{day}.md"
        current = config.REPORTS_DIR / f"{report_type}-current.md"
    dated.write_text(body, encoding="utf-8")
    current.write_text(body, encoding="utf-8")
    return {
        "day": day,
        "dated": str(dated),
        "current": str(current),
        "bytes": len(body.encode("utf-8")),
        "stamp": now.strftime("%Y-%m-%d %H:%M") + " Hawaiian Standard Time" if stamped else None,
        "engine_written": engine,
    }


def synthesize_mp3(report_type: str, text: str) -> dict:
    """Paid Ara/xAI TTS for a full report. Metered — call sparingly."""
    from apps.core.services import xai

    if not _grok_spend_ok():
        return {"ok": False, "detail": "spend_halted"}
    now = datetime.now(HST)
    stamp = now.strftime("%Y%m%d-%H%M")
    dest = config.GENERATED_DIR / f"{report_type}-report-{stamp}.mp3"
    current = config.GENERATED_DIR / f"{report_type}-report-current.mp3"
    try:
        xai.tts(text, dest)
        current.write_bytes(dest.read_bytes())
    except Exception as e:
        log.warning("report TTS failed: %s", e)
        return {"ok": False, "detail": type(e).__name__}
    rel = f"audio/voice/generated/{dest.name}"
    return {
        "ok": True,
        "mp3": str(dest),
        "current": str(current),
        "rel": rel,
        "chars": len(text),
    }

"""Long-form report generation: Grok-from-context-URLs or local, then blog + optional Ara.

Week-of-Grok foundation (2026-09-04): prefer public GEO/context links over ad-hoc
local fact scraping. Text first; Ara TTS only when the per-type toggle allows it
(~$0.10/success). Spend halt / spend_master still gate live xAI calls.
"""
from __future__ import annotations

import json
import logging
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from apps.core import config

log = logging.getLogger("ava.report_generation")
HST = ZoneInfo("Pacific/Honolulu")

STATE_PATH = config.DATA_DIR / "state" / "report-generation.json"
REPORT_TYPES = ("morning", "midday", "evening")

# Live public URLs only (probed 2026-09-04 HST). status/solar 503 when origin dark.
DEFAULT_CONTEXT_URLS = (
    "https://avaivy.cloud/context",
    "https://avaivy.cloud/context.md",
    "https://avaivy.cloud/llms.txt",
    "https://avaivy.cloud/ai.txt",
    "https://avaivy.cloud/context/dev",
    "https://rootrecord.cloud/context",
    "https://rootrecord.cloud/context.md",
    "https://rootrecord.cloud/llms.txt",
    "https://rootrecord.cloud/ai.txt",
    # Live when origin is up (do not invent numbers if these 503):
    "https://rootrecord.cloud/status",
    "https://rootrecord.cloud/solar",
    "https://avaivy.cloud/status",
    "https://avaivy.cloud/solar",
)

# Prefer markdown/agent maps for prompt packing (HTML hubs stay as citation links).
FETCH_URLS = (
    "https://avaivy.cloud/context.md",
    "https://avaivy.cloud/llms.txt",
    "https://rootrecord.cloud/context.md",
)

DEFAULTS = {
    "version": 1,
    "week_of_grok": True,
    "week_note": (
        "Accumulate published Grok reports + context so later local generation "
        "has examples. Prefer engine=grok for morning/midday until local is ready. "
        "Keep tts=false until text is right (~$0.10 Ara/success)."
    ),
    "context_urls": list(DEFAULT_CONTEXT_URLS),
    "fetch_urls": list(FETCH_URLS),
    "reports": {
        "morning": {
            "engine": "grok",
            "tts": False,
            "blog": True,
            "blog_brands": ["ava", "rootrecord"],
            "max_tokens": 1800,
            "category": "runtime",
        },
        "midday": {
            "engine": "grok",
            "tts": False,
            "blog": True,
            "blog_brands": ["ava", "rootrecord"],
            "max_tokens": 1800,
            "category": "runtime",
        },
        "evening": {
            "engine": "local",
            "tts": False,
            "blog": True,
            "blog_brands": ["ava", "rootrecord"],
            "max_tokens": 1800,
            "category": "runtime",
        },
    },
}

VOICE_LOCK = """Public voice lock (hard):
- No "Aloha". Say Ava (ah-vah), never all-caps AVA as a standalone token.
- Hawaii / Hawaiian Standard Time — never bare HI or HST.
- Kīlauea advisory / not erupting is NOT an eruption.
- Off-grid solar only — never advise wall power, wall outlet, or plug-in AC.
- Never name OmniBook, HP, laptop brands, Cloudflare, Grok, Ollama, Cursor, xAI, Discord product pitches.
- Say instead: on-device brain, paid cloud voice, public tunnel, Ava Desk, edge, public code host.
- Never invent watts, percents, alert levels, or balances. If a source is missing or 503, say you do not have it live.
- Short sentences. Blank lines between paragraphs. No markdown ## headings for the spoken body.
- End with the exact line: End of status.
"""


def _hst_now() -> datetime:
    return datetime.now(HST)


def _deep_merge(base: dict, overlay: dict) -> dict:
    out = dict(base)
    for k, v in (overlay or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def load() -> dict:
    """Read toggles; write defaults on first use."""
    if not STATE_PATH.is_file():
        return save(DEFAULTS)
    try:
        raw = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return save(DEFAULTS)
    if not isinstance(raw, dict):
        return save(DEFAULTS)
    merged = _deep_merge(DEFAULTS, raw)
    # Keep operator edits; ensure all report types exist.
    reports = dict(merged.get("reports") or {})
    for kind in REPORT_TYPES:
        reports[kind] = _deep_merge(
            DEFAULTS["reports"][kind], reports.get(kind) or {}
        )
    merged["reports"] = reports
    return merged


def save(data: dict) -> dict:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = dict(data)
    payload["updated_at"] = datetime.now(timezone.utc).isoformat()
    STATE_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return payload


def patch(updates: dict) -> dict:
    cur = load()
    merged = _deep_merge(cur, updates or {})
    return save(merged)


def config_for(kind: str) -> dict:
    kind = str(kind or "").strip().lower()
    if kind not in REPORT_TYPES:
        kind = "morning"
    row = (load().get("reports") or {}).get(kind) or {}
    return dict(row)


def engine_for(kind: str) -> str:
    eng = str(config_for(kind).get("engine") or "local").strip().lower()
    return eng if eng in {"grok", "local"} else "local"


def posts_dir() -> Path:
    """Canonical blog markdown tree (sync-blogs + ops prefer public)."""
    public = config.PUBLIC_MEDIA / "documents" / "reports" / "posts"
    legacy = config.MEDIA_DIR / "documents" / "reports" / "posts"
    if public.is_dir():
        return public
    return legacy


def _slug(title: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (title or "").lower()).strip("-")
    return (s or "report")[:80]


def _fetch_text(url: str, *, timeout: int = 20, limit: int = 14000) -> dict:
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "AvaIvy-report-generation/1.0"},
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            status = int(resp.status)
            raw = resp.read(limit + 200)
            text = raw[:limit].decode("utf-8", "replace")
            return {
                "url": url,
                "ok": 200 <= status < 400,
                "status": status,
                "bytes": len(raw),
                "text": text,
            }
    except Exception as e:
        return {
            "url": url,
            "ok": False,
            "status": 0,
            "bytes": 0,
            "text": "",
            "error": f"{type(e).__name__}: {e}",
        }


def fetch_context_pack(*, cfg: dict | None = None) -> dict:
    """Pull live markdown/agent maps. Keep HTML hubs as citation links only."""
    cfg = cfg or load()
    urls = list(cfg.get("fetch_urls") or FETCH_URLS)
    cite = list(cfg.get("context_urls") or DEFAULT_CONTEXT_URLS)
    parts: list[dict] = []
    blob_bits: list[str] = []
    for url in urls:
        row = _fetch_text(url)
        summary = {k: row[k] for k in ("url", "ok", "status", "bytes") if k in row}
        if row.get("error"):
            summary["error"] = row["error"]
        parts.append(summary)
        if row.get("ok") and row.get("text"):
            blob_bits.append(f"### SOURCE {url}\n{row['text'].strip()}\n")
    return {
        "ok": any(p.get("ok") for p in parts),
        "fetched": parts,
        "cite_urls": cite,
        "pack": "\n".join(blob_bits).strip(),
    }


def _persona_lock(kind: str) -> str:
    from apps.core.services import boot_report, midday_report

    if kind == "midday":
        return midday_report.load_midday_lock()
    if kind == "evening":
        return (
            "You ARE Ava Ivy writing the Ava Core Root Record evening status "
            "for easy audio readout.\n" + VOICE_LOCK + "\n"
            "Open: This is the Ava Core Root Record evening status for "
            "[weekday date], about [time] Hawaiian Standard Time.\n"
            "Cover: day wrap, weather, Kīlauea, power/bank if measured, "
            "what landed, what is broken, overnight priority.\n"
            "OUTPUT ONLY the report text."
        )
    return boot_report.load_boot_lock()


def build_prompt(kind: str, *, pack: str, cite_urls: list[str]) -> list[dict]:
    kind = str(kind or "morning").strip().lower()
    now = _hst_now()
    day = now.strftime("%A, %B ") + str(now.day) + now.strftime(", %Y")
    if kind == "midday":
        clock = "about 12 noon Hawaiian Standard Time"
        title = "midday status"
    elif kind == "evening":
        clock = f"about {now.strftime('%H:%M')} Hawaiian Standard Time"
        title = "evening status"
    else:
        clock = f"about {now.strftime('%H:%M')} Hawaiian Standard Time"
        title = "morning Boot Report / morning status"

    links = "\n".join(f"- {u}" for u in cite_urls)
    system = _persona_lock(kind) + "\n\n" + VOICE_LOCK
    user = (
        f"Write today's full Ava Core Root Record {title} as spoken-ready prose.\n"
        f"Weekday date: {day}. Opening clock stamp: {clock}.\n"
        f"Timestamps are allowed on this full Grok path.\n\n"
        "Primary sources are these public context pages (prefer them over inventing):\n"
        f"{links}\n\n"
        "Fetched live excerpts follow. Use measured numbers only from these "
        "excerpts or clearly say a fact is not live. If status/solar pages were "
        "unavailable, do not invent watts or desk metrics.\n\n"
        f"{pack or '(no fetched pack — rely on link list and say what is not live)'}\n\n"
        "OUTPUT ONLY the report text. No preamble."
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


def _scrub(kind: str, text: str) -> str:
    from apps.core.services import boot_report

    return boot_report.scrub_spoken(text or "")


def write_report_files(kind: str, text: str, *, source: str, engine: str) -> dict:
    """Dated + current markdown under REPORTS_DIR."""
    from apps.core.services import boot_report, midday_report

    kind = str(kind or "morning").strip().lower()
    body = (text or "").strip()
    if not body:
        return {"ok": False, "detail": "empty"}
    body = body if body.endswith("\n") else body + "\n"
    now = _hst_now()
    day = now.strftime("%Y-%m-%d")
    config.REPORTS_DIR.mkdir(parents=True, exist_ok=True)

    if kind == "midday":
        dated = config.REPORTS_DIR / f"midday-boot-{day}.md"
        current = config.REPORTS_DIR / midday_report.CURRENT_NAME
    elif kind == "evening":
        dated = config.REPORTS_DIR / f"evening-boot-{day}.md"
        current = config.REPORTS_DIR / "evening-boot-current.md"
    else:
        dated = config.REPORTS_DIR / f"morning-boot-{day}.md"
        current = config.REPORTS_DIR / boot_report.CURRENT_NAME

    dated.write_text(body, encoding="utf-8")
    current.write_text(body, encoding="utf-8")
    meta = {
        "ok": True,
        "kind": kind,
        "source": source,
        "engine": engine,
        "day": day,
        "stamp": now.strftime("%Y-%m-%d %H:%M") + " Hawaiian Standard Time",
        "dated": str(dated),
        "current": str(current),
        "bytes": len(body.encode("utf-8")),
        "scrub": boot_report.scrub_path_clean(body),
        "text": body,
    }
    meta_path = config.DATA_DIR / "state" / f"report-generation-last-{kind}.json"
    meta_path.parent.mkdir(parents=True, exist_ok=True)
    slim = {k: v for k, v in meta.items() if k != "text"}
    slim["updated_at"] = datetime.now(timezone.utc).isoformat()
    meta_path.write_text(json.dumps(slim, indent=2) + "\n", encoding="utf-8")
    return meta


def publish_blog(
    kind: str,
    text: str,
    *,
    brands: list[str] | None = None,
    category: str = "runtime",
    sync: bool = True,
) -> dict:
    """Write markdown posts matching sync-blogs /ops frontmatter conventions."""
    kind = str(kind or "morning").strip().lower()
    body = (text or "").strip()
    if not body:
        return {"ok": False, "detail": "empty"}
    now = _hst_now()
    day = now.strftime("%Y-%m-%d")
    title_map = {
        "morning": f"Morning status — {day}",
        "midday": f"Midday status — {day}",
        "evening": f"Evening status — {day}",
    }
    title = title_map.get(kind, f"Status — {day}")
    slug = _slug(f"{kind}-status-{day}")
    teaser = " ".join(body.split())[:180]
    brands = brands or ["ava", "rootrecord"]
    root = posts_dir()
    saved: list[dict] = []
    for brand in brands:
        b = str(brand).strip().lower()
        if b not in {"ava", "rootrecord", "rootmc", "alex"}:
            continue
        label = {
            "ava": "Ava",
            "rootrecord": "Root Record",
            "rootmc": "RootMC",
            "alex": "Alex",
        }[b]
        folder = root / b
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / f"{slug}.md"
        lines = [
            "---",
            f"slug: {slug}",
            f"date: {day}",
            f"published: {now.strftime('%Y-%m-%d %H:%M')} Hawaiian Standard Time",
            f"title: {title}",
            f"teaser: {teaser}",
            f"brand: {label}",
            f"categories: {category}",
            "---",
            "",
            body,
            "",
        ]
        path.write_text("\n".join(lines), encoding="utf-8")
        saved.append({"brand": b, "path": str(path), "slug": slug})
    sync_result = None
    if sync and saved:
        sync_result = _run_sync_blogs()
    return {"ok": bool(saved), "saved": saved, "sync": sync_result, "slug": slug}


def _run_sync_blogs() -> dict:
    import subprocess
    import sys

    script = config.AVA_HOME / "scripts" / "sync-blogs.py"
    if not script.is_file():
        return {"ok": False, "detail": "sync-blogs.py missing"}
    try:
        r = subprocess.run(
            [sys.executable, str(script)],
            capture_output=True,
            text=True,
            timeout=120,
            cwd=str(config.AVA_HOME),
        )
        return {
            "ok": r.returncode == 0,
            "log": ((r.stdout or "") + "\n" + (r.stderr or ""))[-2500:],
        }
    except Exception as e:
        return {"ok": False, "detail": str(e)}


def maybe_tts(kind: str, text: str, *, force: bool = False) -> dict:
    """Ara TTS via existing broadcast_render path. Default off; ~$0.10/success."""
    cfg = config_for(kind)
    if not force and not cfg.get("tts"):
        return {"ok": True, "skipped": True, "reason": "tts_toggle_off"}
    from apps.core.services import xai

    if xai.grok_is_down():
        return {"ok": False, "skipped": True, "reason": "grok_halt_or_down"}
    spoken = " ".join((text or "").split()).strip()
    if not spoken:
        return {"ok": False, "detail": "empty"}
    try:
        from apps.core.broadcast_render import spoken_script, synthesize

        script = spoken_script(spoken)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M")
        dest = config.GENERATED_DIR / f"{kind}-report-{stamp}.mp3"
        out = synthesize(script or spoken, dest)
        current = config.GENERATED_DIR / f"{kind}-report-current.mp3"
        try:
            current.write_bytes(out.read_bytes())
        except OSError:
            pass
        library = Path(config.AUDIO_CURRENT_DIR) / f"{kind}-report-current.mp3"
        try:
            library.parent.mkdir(parents=True, exist_ok=True)
            library.write_bytes(out.read_bytes())
        except OSError:
            pass
        return {
            "ok": True,
            "mp3": str(out),
            "current": str(current if current.exists() else out),
            "library": str(library) if library.exists() else None,
            "booked_usd": 0.10,
        }
    except Exception as e:
        log.exception("report TTS failed kind=%s", kind)
        return {"ok": False, "detail": str(e)}


def generate(
    kind: str,
    *,
    dry_run: bool = False,
    force_engine: str | None = None,
    allow_tts: bool = False,
    publish: bool | None = None,
) -> dict:
    """Run one report type. dry_run builds prompt + pack, never calls xAI/TTS/blog."""
    from apps.core.services import boot_report, midday_report, xai

    kind = str(kind or "morning").strip().lower()
    if kind not in REPORT_TYPES:
        return {"ok": False, "detail": "bad_kind", "kind": kind}

    cfg = config_for(kind)
    engine = (force_engine or cfg.get("engine") or "local").strip().lower()
    if engine not in {"grok", "local"}:
        engine = "local"

    pack_info = fetch_context_pack()
    messages = build_prompt(
        kind, pack=pack_info.get("pack") or "", cite_urls=pack_info.get("cite_urls") or []
    )

    if dry_run:
        return {
            "ok": True,
            "dry_run": True,
            "kind": kind,
            "engine_would": engine,
            "tts_would": bool(cfg.get("tts")) and allow_tts,
            "blog_would": bool(cfg.get("blog")) if publish is None else bool(publish),
            "context": {
                "ok": pack_info.get("ok"),
                "fetched": pack_info.get("fetched"),
                "cite_urls": pack_info.get("cite_urls"),
                "pack_bytes": len((pack_info.get("pack") or "").encode("utf-8")),
            },
            "prompt_chars": sum(len(m.get("content") or "") for m in messages),
            "spend": {
                "grok_halt": xai.grok_is_down(),
                "note": "No xAI/TTS/blog on dry_run",
            },
            "state_path": str(STATE_PATH),
        }

    used = engine
    text = ""
    grok_called = False

    if engine == "grok":
        if xai.grok_is_down():
            log.info("report_generation kind=%s grok wanted but halted — local fallback", kind)
            used = "local_fallback_halt"
        else:
            reply = xai.try_chat(
                messages,
                max_tokens=int(cfg.get("max_tokens") or 1800),
                temperature=0.3,
            )
            grok_called = True
            if reply and len(reply.strip()) > 80:
                text = _scrub(kind, reply)
                used = "grok"
            else:
                log.warning("report_generation grok thin/empty kind=%s — local fallback", kind)
                used = "local_fallback_thin"

    if not text:
        if kind == "midday":
            written = midday_report.write_midday_report(
                source=f"report_generation_{used}",
                include_timestamp=True,
            )
            text = written.get("text") or ""
            used = written.get("engine") or used
            files = {
                "dated": written.get("dated"),
                "current": written.get("current"),
                "scrub": written.get("scrub"),
            }
        elif kind == "evening":
            # No dedicated evening local writer yet — short stub from midday shape.
            gen = midday_report.generate_spoken(
                source="evening_local_stub",
                include_timestamp=True,
                offline=True,
            )
            text = _scrub(
                kind,
                (gen.get("text") or "").replace("midday status", "evening status"),
            )
            files = write_report_files(kind, text, source="report_generation", engine=used)
        else:
            written = boot_report.write_boot_report(source=f"report_generation_{used}")
            text = written.get("text") or ""
            used = written.get("engine") or used
            files = {
                "dated": written.get("dated"),
                "current": written.get("current"),
                "scrub": written.get("scrub"),
            }
    else:
        files = write_report_files(kind, text, source="report_generation", engine=used)

    do_blog = bool(cfg.get("blog")) if publish is None else bool(publish)
    blog = None
    if do_blog and text.strip():
        blog = publish_blog(
            kind,
            text,
            brands=list(cfg.get("blog_brands") or ["ava", "rootrecord"]),
            category=str(cfg.get("category") or "runtime"),
            sync=True,
        )

    tts = None
    if allow_tts or cfg.get("tts"):
        tts = maybe_tts(kind, text, force=bool(allow_tts))
    else:
        tts = {"ok": True, "skipped": True, "reason": "tts_toggle_off"}

    return {
        "ok": bool(text.strip()),
        "kind": kind,
        "engine": used,
        "engine_requested": engine,
        "grok_called": grok_called,
        "include_timestamp": True if used == "grok" else None,
        "files": files,
        "blog": blog,
        "tts": tts,
        "context": {
            "ok": pack_info.get("ok"),
            "fetched": pack_info.get("fetched"),
        },
        "bytes": len(text.encode("utf-8")),
        "text_preview": text[:400],
    }


def status() -> dict:
    cfg = load()
    from apps.core.services import xai

    return {
        "ok": True,
        "path": str(STATE_PATH),
        "week_of_grok": bool(cfg.get("week_of_grok")),
        "week_note": cfg.get("week_note"),
        "reports": cfg.get("reports"),
        "context_urls": cfg.get("context_urls"),
        "fetch_urls": cfg.get("fetch_urls"),
        "posts_dir": str(posts_dir()),
        "grok_halt": xai.grok_is_down(),
        "updated_at": cfg.get("updated_at"),
    }

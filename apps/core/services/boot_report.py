"""Morning Boot Report — spoken Ava Core Root Record status.

Prelims refresh first (caller). Prose comes from the on-device brain with a
fixed format lock. Never Grok. Never paid cloud voice. Never secrets.
Never emit all-caps AVA as a standalone TTS token (Ara spells A-V-A).
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from apps.core import config

log = logging.getLogger("ava.boot_report")
HST = ZoneInfo("Pacific/Honolulu")

CURRENT_NAME = "morning-boot-current.md"
PROMPT_NAME = "MORNING_BOOT_REPORT.txt"

# Spoken format lock — also mirrored under Media/public/documents/persona/
BOOT_LOCK = """You ARE Ava Ivy writing the Ava Core Root Record morning Boot Report for easy audio readout.

Hard rules:
- No "Aloha". Never say HP, OmniBook, laptop brand, or any PC maker name.
- Never name third parties or engines: no Cloudflare, Grok, Ollama, Electron, Vulkan, Radeon, Shockbyte, GitHub, Discord product pitches, llama, qwen, Cursor, xAI, ChatGPT.
- Say instead: on-device brain, paid cloud voice, public tunnel, Ava Desk, edge, local graphics, public code host, player chat, dream state.
- Never invent watts, percents, times, or alert levels. Use ONLY the FACTS block. If a fact is missing, say you do not have it live.
- No repo paths, env vars, stack traces, ports as "colon numbers" jargon, or raw JSON.
- Short sentences. Numbers spoken naturally (seven fifty-four, not 07:54). Separate paragraphs with blank lines.
- Do not use markdown ## headings. Use spoken lead-ins as plain sentences.
- Pronunciation: never write all-caps AVA as a standalone token. TTS spells A-V-A. Prefer “Ava”, “Ava Core”, “Ava Ivy”, or “Root Record”. Say host name as “Ava Core”, not AVA-CORE.

Required shape:
1. Open exactly in this spirit: "This is the Ava Core Root Record morning status for [weekday date], about [time] Hawaiian Standard Time."
2. Then Root Server / host Ava Core / C-only / public doors / public tunnel → origin — plain spoken sentences.
3. Then these paragraphs, each with a clear spoken lead-in:
   - Boot Summary (overnight downtime, restore/boot time, net-gate stop/restore, desk restore issues if any)
   - System Summary (origin, tunnel, on-device brain, Desk, watchdog tasks, voice mode local, public chat path when warm)
   - Weather Summary (use the weather facts; say how fresh if age is given)
   - Kīlauea Summary
   - Power / bank if measured numbers exist
   - Broken / needs work
   - Already landed (recent)
   - Priority (keep paid cloud voice off)
4. End with the exact line: End of status.

OUTPUT ONLY the report text. No preamble. No "here is the report".
"""


def _read_json(path: Path) -> dict:
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _iso_spoken(raw: str | None) -> str:
    if not raw:
        return "unknown"
    try:
        t = datetime.fromisoformat(str(raw).replace("Z", "+00:00")).astimezone(HST)
        h, m = t.hour, t.minute
        ampm = "in the morning" if h < 12 else ("in the afternoon" if h < 17 else "in the evening")
        h12 = h % 12 or 12
        if m == 0:
            clock = f"{h12} o'clock"
        else:
            clock = f"{h12} {m:02d}"
        return f"{t.strftime('%A')} about {clock} {ampm} Hawaiian Standard Time ({t.strftime('%Y-%m-%d %H:%M HST')})"
    except Exception:
        return str(raw)[:40]


def _gap_minutes(stopped_at: str | None, restored_at: str | None) -> int | None:
    try:
        a = datetime.fromisoformat(str(stopped_at).replace("Z", "+00:00"))
        b = datetime.fromisoformat(str(restored_at).replace("Z", "+00:00"))
        return max(0, int((b - a).total_seconds() // 60))
    except Exception:
        return None


def _origin_up() -> bool:
    try:
        import urllib.request

        req = urllib.request.Request(
            "http://127.0.0.1:8787/health",
            headers={"User-Agent": "AvaIvy-boot-report"},
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=3) as resp:
            return 200 <= int(resp.status) < 500
    except Exception:
        return False


def _brain_up() -> tuple[bool, str]:
    try:
        import urllib.request

        req = urllib.request.Request(
            "http://127.0.0.1:11434/api/tags",
            headers={"User-Agent": "AvaIvy-boot-report"},
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=3) as resp:
            raw = json.loads(resp.read().decode("utf-8", "replace"))
        n = len(raw.get("models") or [])
        return True, f"{n} models on disk"
    except Exception:
        return False, "not reachable"


def prompt_path() -> Path | None:
    pub = config.PUBLIC_MEDIA / "documents" / "persona" / PROMPT_NAME
    return pub if pub.is_file() else None


def load_boot_lock() -> str:
    path = prompt_path()
    if path:
        try:
            text = path.read_text(encoding="utf-8").strip()
            if text:
                return text
        except Exception as e:
            log.warning("boot prompt unreadable: %s", e)
    return BOOT_LOCK


def build_facts(*, source: str = "boot") -> str:
    """Operator/facts block for the on-device brain. Plain words. Measured only."""
    now = datetime.now(HST)
    net = _read_json(config.DATA_DIR / "state" / "net-gate.json")
    uptime = _read_json(config.DATA_DIR / "state" / "uptime-marker.json")
    startup = _read_json(config.DATA_DIR / "state" / "startup-voice.json")
    grok = _read_json(config.DATA_DIR / "state" / "grok-status.json")
    alert = _read_json(config.DATA_DIR / "state" / "kilauea-alert.json")

    lines = [
        f"FACTS for morning Boot Report (source {source}). Use only these. Do not invent.",
        f"Now: {now.strftime('%A, %B %d, %Y')}, about {now.strftime('%H:%M')} Hawaiian Standard Time.",
        "Host name (spoken as Ava Core): AVA-CORE. Role: HI Pacific Solar Root Server. Live tree: C only.",
        "Public doors: rootrecord.cloud and avaivy.cloud. Public tunnel reaches local origin.",
    ]

    stopped = net.get("stopped_at")
    restored = net.get("restored_at")
    gap = _gap_minutes(stopped, restored)
    lines.append(f"Net-gate online: {bool(net.get('online'))}.")
    if stopped:
        lines.append(f"Net-gate stopped_at: {_iso_spoken(str(stopped))}.")
    if restored:
        lines.append(f"Net-gate restored_at: {_iso_spoken(str(restored))}.")
    if gap is not None:
        hours, mins = divmod(gap, 60)
        if hours:
            lines.append(f"Overnight gap about {hours} hours {mins} minutes.")
        else:
            lines.append(f"Overnight gap about {mins} minutes.")
    lines.append(f"Desk was open at restore sample: {net.get('desk_was_open')}.")
    lines.append(f"On-device brain was up at restore sample: {net.get('ollama_was_up')}.")
    if startup.get("last_clip"):
        lines.append(f"Startup voice last clip name on file: {startup.get('last_clip')}.")

    origin_ok = _origin_up()
    brain_ok, brain_detail = _brain_up()
    lines.append(f"Origin health now: {'UP' if origin_ok else 'DOWN'}.")
    lines.append(f"On-device brain now: {'UP' if brain_ok else 'DOWN'} ({brain_detail}).")
    lines.append("Voice mode: local clip packs. Paid cloud voice: OFF (operator halt).")
    if grok.get("halt"):
        lines.append("Paid cloud voice spend: halted by operator. Do not ask to turn it on.")

    try:
        from apps.core.services import db_facts

        lines.append(db_facts.host_line())
        lines.append(db_facts.ecoflow_line())
    except Exception as e:
        lines.append(f"Host/bank: unavailable ({type(e).__name__})")

    try:
        from apps.core.services import live_wx

        for row in live_wx.weather_lines_sync():
            lines.append(row)
    except Exception as e:
        lines.append(f"Weather: unavailable ({type(e).__name__})")

    nws = sorted(
        config.REPORTS_DIR.glob("nws-weather-*.md"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    if nws:
        age_min = (datetime.now(timezone.utc).timestamp() - nws[0].stat().st_mtime) / 60.0
        lines.append(f"Latest NWS report file age: about {age_min:.0f} minutes ({nws[0].name}).")

    if alert:
        bits = [
            str(alert.get("alert_level") or alert.get("alert") or "unknown"),
            str(alert.get("color") or ""),
            str(alert.get("updated") or alert.get("at") or alert.get("updated_at") or ""),
        ]
        lines.append("Kīlauea on file: " + " · ".join(b for b in bits if b))
    else:
        lines.append("Kīlauea: no alert file.")

    try:
        from apps.core.services import live_wx

        lines.append(live_wx.hurricane_line())
    except Exception:
        pass

    lines.append(
        "Broken / needs work (operator notes if known): after restore, public chat can show "
        "offline until origin and on-device brain are warm; paid cloud voice stays off; "
        "prefer wall power if the site bank is low."
    )
    lines.append(
        "Already landed (recent, if true on this host): net-gate restore, Ava Desk visible launch, "
        "day board, guest reply cap, persona live facts for public chat."
    )
    lines.append(
        "Priority: keep paid cloud voice off; keep AC and site bank alive; leave public chat on the "
        "on-device brain; wait for warm load after restores."
    )
    return "\n".join(lines)


_FORBIDDEN = re.compile(
    r"\b(Aloha|OmniBook|Cloudflare|Ollama|Electron|Vulkan|Radeon|Shockbyte|"
    r"GitHub|Grok|xAI|ChatGPT|Claude|Cursor|llama|qwen|Llama|Qwen)\b",
    re.I,
)


def scrub_spoken(text: str) -> str:
    """Strip common third-party leaks after generation; keep TTS pronunciation-safe."""
    out = (text or "").strip()
    out = _FORBIDDEN.sub("the local stack", out)
    out = re.sub(r"(?i)\baloha[,!]?\s*", "", out)
    out = re.sub(r"(?i)\bHP\b", "this host", out)
    # Ara spells all-caps AVA letter-by-letter. Never leave it as a TTS token.
    out = re.sub(r"\bAVA-CORE\b", "Ava Core", out)
    out = re.sub(r"\bAVA Core\b", "Ava Core", out)
    out = re.sub(r"\bAVA Ivy\b", "Ava Ivy", out)
    out = re.sub(r"\bAVA\b", "Ava", out)
    if not out.rstrip().endswith("End of status."):
        if "End of status" not in out:
            out = out.rstrip() + "\n\nEnd of status."
    return out.strip() + "\n"


def _fallback_spoken(facts: str, *, now: datetime | None = None) -> str:
    """Deterministic spoken draft if the on-device brain is cold."""
    now = now or datetime.now(HST)
    weekday = now.strftime("%A, %B ") + str(now.day) + now.strftime(", %Y")
    hour = now.hour % 12 or 12
    minute = now.minute
    about = f"{hour} {minute:02d}" if minute else f"{hour} o'clock"
    net = _read_json(config.DATA_DIR / "state" / "net-gate.json")
    gap = _gap_minutes(net.get("stopped_at"), net.get("restored_at"))
    gap_txt = f"about {gap} minutes" if gap is not None else "not measured on file"
    origin = "up" if _origin_up() else "down"
    brain_ok, _ = _brain_up()
    brain = "up" if brain_ok else "down"

    wx = "Weather is not on file."
    try:
        from apps.core.services import live_wx

        rows = live_wx.weather_lines_sync()
        if rows:
            wx = rows[0].replace("Weather (", "Weather sample (")
    except Exception:
        pass

    kil = "Kīlauea alert is not on file."
    alert = _read_json(config.DATA_DIR / "state" / "kilauea-alert.json")
    if alert:
        kil = (
            f"Kīlauea on file is {alert.get('alert_level') or alert.get('alert') or 'unknown'}"
            f"{', ' + str(alert.get('color')) if alert.get('color') else ''}."
        )

    power = "Power numbers are not in this sample."
    try:
        from apps.core.services import db_facts

        power = db_facts.ecoflow_line() + " " + db_facts.host_line()
    except Exception:
        pass

    body = f"""This is the Ava Core Root Record morning status for {weekday}, about {about} Hawaiian Standard Time.

You are listening on the HI Pacific Solar Root Server. Host name Ava Core. The live tree is on C only. Public doors are rootrecord.cloud and avaivy.cloud. The public tunnel reaches the local origin.

Boot Summary. Net-gate stopped overnight and restored this morning. Gap on file is {gap_txt}. Restore stamp is {_iso_spoken(str(net.get('restored_at') or ''))}. Desk should be visible after restore. If Desk ever opens as a blank shell, use the start-desk path.

System Summary. Origin is {origin}. The public tunnel should reach origin when the edge is healthy. The on-device brain is {brain}. Voice mode is local clip packs. Paid cloud voice stays off. Public chat runs edge to origin to the on-device brain when warm. Watchdog tasks keep origin and Desk under watch.

Weather Summary. {wx}

Kīlauea Summary. {kil}

Power. {power}

Broken / needs work. After a restore, public chat can say offline until origin and the on-device brain are warm. Paid cloud voice stays off. Prefer wall power if the site bank is low.

Already landed. Net-gate restore, visible Ava Desk launch, day board, guest reply cap, and persona live facts for public chat are on this host.

Priority. Keep paid cloud voice off. Keep AC and the site bank alive. Leave public chat on the on-device brain. After restores, wait for warm load before the first public reply.

End of status.
"""
    return scrub_spoken(body)


def generate_spoken(*, source: str = "boot", timeout: int = 180) -> dict:
    """Refresh is caller's job. Generate with on-device brain; fallback if cold. No Grok."""
    from apps.core.services import ollama as ollama_svc
    from apps.core.services import xai

    if not xai.grok_is_down():
        # Still never call Grok here — operator asked for local only.
        log.info("boot report: Grok not halted, still using on-device brain only")

    facts = build_facts(source=source)
    lock = load_boot_lock()
    messages = [
        {"role": "system", "content": lock},
        {
            "role": "user",
            "content": (
                "Write today's morning Boot Report from these FACTS only.\n\n" + facts
            ),
        },
    ]

    # Warm minimal ping, then full generate.
    warm = ollama_svc.chat_sync(
        [{"role": "user", "content": "Reply with the single word READY."}],
        timeout=60,
        num_predict=8,
        keep_alive="10m",
    )
    reply = ollama_svc.chat_sync(
        messages,
        timeout=timeout,
        num_predict=1200,
        keep_alive="10m",
    )
    used = "on_device_brain"
    if not reply or len(reply.strip()) < 80:
        log.warning("boot report brain thin/empty — using spoken fallback")
        text = _fallback_spoken(facts)
        used = "fallback_spoken"
    else:
        text = scrub_spoken(reply)

    return {
        "ok": True,
        "text": text,
        "source": source,
        "engine": used,
        "warm": bool(warm),
        "grok": False,
        "facts": facts,
    }


def write_boot_report(*, source: str = "boot", text: str | None = None) -> dict:
    """Write dated + current Boot Report markdown."""
    if text is None:
        gen = generate_spoken(source=source)
        text = gen["text"]
        engine = gen.get("engine")
    else:
        engine = "provided"
        gen = {"ok": True, "engine": engine, "grok": False}

    now = datetime.now(HST)
    day = now.strftime("%Y-%m-%d")
    config.REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    dated = config.REPORTS_DIR / f"morning-boot-{day}.md"
    current = config.REPORTS_DIR / CURRENT_NAME
    body = text if text.endswith("\n") else text + "\n"
    dated.write_text(body, encoding="utf-8")
    current.write_text(body, encoding="utf-8")
    log.info(
        "boot report written source=%s engine=%s dated=%s bytes=%s",
        source,
        engine,
        dated.name,
        len(body.encode("utf-8")),
    )
    return {
        "ok": True,
        "source": source,
        "engine": engine,
        "day": day,
        "stamp": now.strftime("%Y-%m-%d %H:%M HST"),
        "dated": str(dated),
        "current": str(current),
        "bytes": len(body.encode("utf-8")),
        "text": body,
        "grok": False,
    }


# Back-compat for callers that still want a non-LLM facts dump
def build_text(*, source: str = "boot") -> str:
    gen = generate_spoken(source=source)
    return gen["text"]

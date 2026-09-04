"""Morning Boot Report — spoken Ava Core Root Record status.

Prelims refresh first (caller). Prose comes from the on-device brain with a
fixed format lock. Never Grok. Never paid cloud voice. Never secrets.
Never emit all-caps AVA as a standalone TTS token (Ara spells A-V-A).
Never emit bare HI or HST in TTS text (Ara spells H-I / H-S-T).
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
- Off-grid solar site only. There is no grid wall outlet. Never say prefer wall power, plug in, AC power, wall outlet, or dock as power advice. Power advice is keep Starlink and the site bank alive on solar packs, sun, and load management.
- No repo paths, env vars, stack traces, ports as "colon numbers" jargon, or raw JSON.
- Short sentences. Numbers spoken naturally (seven fifty-four, not 07:54). Separate paragraphs with blank lines.
- Do not use markdown ## headings. Use spoken lead-ins as plain sentences.
- Pronunciation: never write all-caps AVA as a standalone token. TTS spells A-V-A. Prefer “Ava”, “Ava Core”, “Ava Ivy”, or “Root Record”. Say host name as “Ava Core”, not AVA-CORE.
- Pronunciation: never write bare HI or HST. TTS spells H-I / H-S-T. Prefer “Hawaii”, “Hawaiian Standard Time”, and “Hawaii Pacific Solar Root Server” (or “the Hawaii Pacific Solar Root Server”). Do not write “HI Pacific…”.

Required shape:
1. Open exactly in this spirit: "This is the Ava Core Root Record morning status for [weekday date], about [time] Hawaiian Standard Time."
2. Then Hawaii Pacific Solar Root Server / host Ava Core / C-only / public doors / public tunnel → origin — plain spoken sentences.
3. Then these paragraphs, each with a clear spoken lead-in:
   - Boot Summary (overnight downtime, restore/boot time, net-gate stop/restore, desk restore issues if any)
   - System Summary (origin, tunnel, on-device brain, Desk, watchdog tasks, voice mode local, public chat path when warm)
   - Weather Summary (use the weather facts; say how fresh if age is given)
   - Kīlauea Summary (advisory / not erupting is NOT an eruption; use erupting=false when present)
   - Power / bank if measured numbers exist
   - Change vs previous morning Boot Report when DIFFERENTIALS are in FACTS (bank %, pack SOC, host charge, hours — measured only)
   - Broken / needs work
   - Already landed (recent)
   - Priority (keep paid cloud voice off; keep Starlink and site bank on solar packs / sun / load management)
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
        return (
            f"{t.strftime('%A')} about {clock} {ampm} Hawaiian Standard Time "
            f"({t.strftime('%Y-%m-%d %H:%M')})"
        )
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


def load_previous_boot_report(
    *, exclude_day: str | None = None
) -> tuple[Path | None, str]:
    """Newest morning-boot-*.md on disk (dated files), optionally skipping one day."""
    try:
        config.REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass
    dated = sorted(
        (
            p
            for p in config.REPORTS_DIR.glob("morning-boot-*.md")
            if p.name != CURRENT_NAME and "draft" not in p.name.lower()
        ),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    for path in dated:
        if exclude_day and exclude_day in path.name:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        if text.strip():
            return path, text
    current = config.REPORTS_DIR / CURRENT_NAME
    if current.is_file():
        try:
            text = current.read_text(encoding="utf-8", errors="replace")
            if text.strip():
                return current, text
        except Exception:
            pass
    return None, ""


def _first_pct(text: str, *patterns: str) -> float | None:
    for pat in patterns:
        m = re.search(pat, text, re.I)
        if m:
            try:
                return float(m.group(1))
            except Exception:
                continue
    return None


def _first_hours(text: str, *patterns: str) -> float | None:
    for pat in patterns:
        m = re.search(pat, text, re.I)
        if not m:
            continue
        try:
            if m.lastindex and m.lastindex >= 2 and m.group(2) is not None:
                return float(m.group(1)) + float(m.group(2)) / 60.0
            return float(m.group(1))
        except Exception:
            continue
    return None


def _extract_boot_metrics(text: str) -> dict[str, float]:
    """Pull measured percents / hours from a prior Boot Report. Missing keys stay out."""
    out: dict[str, float] = {}
    host = _first_pct(text, r"charge\s+(\d+(?:\.\d+)?)\s*%", r"host[^%\n]{0,40}?(\d+(?:\.\d+)?)\s*%\s*charg")
    if host is not None:
        out["host_charge_pct"] = host
    bank = _first_pct(
        text,
        r"Bank combined[^%\n]{0,80}?(\d+(?:\.\d+)?)\s*%",
        r"bank[^%\n]{0,40}?(\d+(?:\.\d+)?)\s*%\s*capacity",
        r"(\d+(?:\.\d+)?)\s*%\s*capacity-weighted",
    )
    if bank is not None:
        out["bank_pct"] = bank
    delta = _first_pct(text, r"DELTA\s*2[^%\n]{0,40}?(\d+(?:\.\d+)?)\s*%\s*SOC")
    if delta is not None:
        out["delta2_soc_pct"] = delta
    river = _first_pct(text, r"RIVER\s*2\s*Pro[^%\n]{0,40}?(\d+(?:\.\d+)?)\s*%\s*SOC")
    if river is not None:
        out["river2_soc_pct"] = river
    hours = _first_hours(
        text,
        r"~\s*(\d+(?:\.\d+)?)\s*h\s+to\s+full",
        r"about\s+(\d+)\s+hours?\s+(\d+)\s+minutes?\s+to\s+full",
        r"(\d+(?:\.\d+)?)\s*hours?\s+to\s+full",
    )
    if hours is not None:
        out["hours_to_full"] = hours
    gap = _first_hours(
        text,
        r"Overnight gap about\s+(\d+)\s+hours?\s+(\d+)\s+minutes?",
        r"Overnight gap about\s+(\d+)\s+minutes?",
        r"gap on file is about\s+(\d+)\s+hours?\s+(\d+)\s+minutes?",
    )
    if gap is not None:
        out["overnight_gap_hours"] = gap
    return out


def _live_boot_metrics() -> dict[str, float]:
    """Measured live metrics for differential lines. Skip anything not on disk."""
    out: dict[str, float] = {}
    try:
        from apps.core.services import db_facts

        host = db_facts.host_line()
        eco = db_facts.ecoflow_line()
    except Exception:
        return out
    h = _first_pct(host, r"charge\s+(\d+(?:\.\d+)?)\s*%")
    if h is not None:
        out["host_charge_pct"] = h
    d = _first_pct(eco, r"DELTA\s*2[^%\n]{0,40}?(\d+(?:\.\d+)?)\s*%\s*SOC")
    if d is not None:
        out["delta2_soc_pct"] = d
    r = _first_pct(eco, r"RIVER\s*2\s*Pro[^%\n]{0,40}?(\d+(?:\.\d+)?)\s*%\s*SOC")
    if r is not None:
        out["river2_soc_pct"] = r
    b = _first_pct(
        eco,
        r"Bank combined[^%\n]{0,120}?(\d+(?:\.\d+)?)\s*%",
        r"(\d+(?:\.\d+)?)\s*%\s*capacity-weighted",
    )
    if b is not None:
        out["bank_pct"] = b
    hours = _first_hours(eco, r"~\s*(\d+(?:\.\d+)?)\s*h\s+to\s+full")
    if hours is not None:
        out["hours_to_full"] = hours
    return out


def build_diff_facts(previous_text: str) -> list[str]:
    """Human lines: previous → now with absolute and percent change when both exist."""
    prev = _extract_boot_metrics(previous_text)
    live = _live_boot_metrics()
    labels = {
        "host_charge_pct": "Host charge",
        "bank_pct": "Bank capacity-weighted",
        "delta2_soc_pct": "DELTA 2 SOC",
        "river2_soc_pct": "RIVER 2 Pro SOC",
        "hours_to_full": "Hours to full (packs)",
        "overnight_gap_hours": "Overnight gap hours",
    }
    lines: list[str] = []
    for key, label in labels.items():
        if key not in prev or key not in live:
            continue
        a = prev[key]
        b = live[key]
        delta = b - a
        if abs(a) > 1e-6:
            pct = (delta / abs(a)) * 100.0
            pct_s = f"{pct:+.1f}% relative"
        else:
            pct_s = "relative n/a (previous was zero)"
        unit = " h" if "hours" in key or key.endswith("_hours") else " %"
        # overnight_gap_hours / hours_to_full already hours; percents already %
        if key.endswith("_pct"):
            lines.append(
                f"- {label}: previous {a:.1f}% → now {b:.1f}% (change {delta:+.1f} points, {pct_s})."
            )
        else:
            lines.append(
                f"- {label}: previous {a:.2f}{unit} → now {b:.2f}{unit} (change {delta:+.2f}{unit}, {pct_s})."
            )
    return lines


def scrub_path_clean(text: str) -> dict:
    """Confidence checks for morning automation: pronunciation + off-grid voice."""
    t = text or ""
    bad = []
    if re.search(r"\bAVA\b", t) and not re.search(r"\bAva\b", t):
        bad.append("standalone_AVA")
    if re.search(r"\bAVA-CORE\b", t):
        bad.append("AVA-CORE")
    if re.search(r"\bHI\b", t):
        bad.append("bare_HI")
    if re.search(r"\bHST\b", t):
        bad.append("bare_HST")
    if re.search(r"(?i)\b(prefer\s+wall\s+power|wall\s+outlet|plug\s+in(?:to)?\s+the\s+wall)\b", t):
        bad.append("wall_power_advice")
    scrubbed = scrub_spoken(t)
    if re.search(r"\bAVA\b", scrubbed):
        bad.append("scrub_left_AVA")
    if re.search(r"\bHI\b", scrubbed):
        bad.append("scrub_left_HI")
    if re.search(r"\bHST\b", scrubbed):
        bad.append("scrub_left_HST")
    return {"ok": not bad, "bad": bad}


def automation_flag_path() -> Path:
    return config.DATA_DIR / "state" / "morning-boot-automation.json"


def set_morning_automation(enabled: bool, *, reason: str) -> dict:
    path = automation_flag_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "enabled": bool(enabled),
        "reason": reason,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "engine": "on_device_brain",
        "tts": False,
        "grok": False,
    }
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return payload


def morning_automation_enabled() -> bool:
    row = _read_json(automation_flag_path())
    return bool(row.get("enabled"))


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
        "Host name spoken: Ava Core (never AVA-CORE letters). Role spoken: Hawaii Pacific Solar Root Server (never HI Pacific). Live tree: C only.",
        "Public doors: rootrecord.cloud and avaivy.cloud. Public tunnel reaches local origin.",
        "Timezone spoken: Hawaiian Standard Time (never bare HST).",
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
        level = str(alert.get("alert_level") or alert.get("alert") or "unknown")
        erupting = bool(alert.get("erupting"))
        bits = [
            level,
            f"erupting={str(erupting).lower()}",
            "not erupting" if not erupting else "is erupting",
            str(alert.get("headline") or ""),
            str(alert.get("color") or ""),
            str(alert.get("updated") or alert.get("at") or alert.get("updated_at") or ""),
        ]
        lines.append("Kīlauea on file: " + " · ".join(b for b in bits if b))
        lines.append(
            "Kīlauea speak rule: advisory / not erupting / paused is NOT an eruption. "
            "Say advisory and not erupting when erupting=false."
        )
    else:
        lines.append("Kīlauea: no alert file.")

    # Differentials vs last morning-boot-*.md on disk (measured numbers only).
    prev_path, prev_text = load_previous_boot_report(exclude_day=None)
    if prev_path and prev_text:
        lines.append(f"Previous morning Boot Report on disk: {prev_path.name}.")
        diff_lines = build_diff_facts(prev_text)
        if diff_lines:
            lines.append("DIFFERENTIALS vs that previous report (measured only — do not invent):")
            lines.extend(diff_lines)
        else:
            lines.append(
                "DIFFERENTIALS: previous report on disk but no comparable measured percents/hours found."
            )
    else:
        lines.append("Previous morning Boot Report: none on disk yet — no differentials.")

    try:
        from apps.core.services import live_wx

        lines.append(live_wx.hurricane_line())
    except Exception:
        pass

    lines.append(
        "Broken / needs work (operator notes if known): after restore, public chat can show "
        "offline until origin and on-device brain are warm; paid cloud voice stays off; "
        "this site is off-grid solar — if the site bank is low, manage load and sun, never advise wall power."
    )
    lines.append(
        "Already landed (recent, if true on this host): net-gate restore, Ava Desk visible launch, "
        "day board, guest reply cap, persona live facts for public chat."
    )
    lines.append(
        "Priority: keep paid cloud voice off; keep Starlink and the site bank alive on solar packs, "
        "sun, and load management; leave public chat on the on-device brain; wait for warm load after restores."
    )
    return "\n".join(lines)


_FORBIDDEN = re.compile(
    r"\b(Aloha|OmniBook|Cloudflare|Ollama|Electron|Vulkan|Radeon|Shockbyte|"
    r"GitHub|Grok|xAI|ChatGPT|Claude|Cursor|llama|qwen|Llama|Qwen)\b",
    re.I,
)


_WALL_POWER_ADVICE = re.compile(
    r"(?i)(?<!never advise )(?<!never say )(?<!never say prefer )(?<!do not advise )\b("
    r"prefer(?:ence)?(?:\s+is\s+to\s+use)?\s+wall\s+power(?:\s+if\s+the\s+site\s+bank\s+is\s+low)?"
    r"|a\s+preference\s+for\s+wall\s+power(?:\s+when\s+the\s+site\s+bank\s+is\s+low)?"
    r"|preference\s+is\s+to\s+use\s+wall\s+power(?:\s+if\s+the\s+site\s+bank\s+is\s+low)?"
    r"|use\s+wall\s+power(?:\s+if\s+the\s+site\s+bank\s+is\s+low)?"
    r"|wall\s+outlet"
    r"|AC\s+power"
    r"|plug(?:\s+it)?\s+in(?:to)?(?:\s+(?:the\s+)?(?:wall|outlet|grid))?"
    r"|dock\s+(?:for\s+)?(?:power|charging)"
    r"|on\s+(?:the\s+)?(?:wall\s+)?dock\s+for\s+power"
    r"|wall\s+power"
    r")\b",
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
    # Island / timezone: never bare HI or HST (Ara spells H-I / H-S-T).
    out = re.sub(r"\bHI Pacific Solar Root Server\b", "Hawaii Pacific Solar Root Server", out)
    out = re.sub(r"\bthe HI Pacific\b", "the Hawaii Pacific", out)
    out = re.sub(r"\bHI Pacific\b", "Hawaii Pacific", out)
    out = re.sub(r"\bHST\b", "Hawaiian Standard Time", out)
    out = re.sub(r"Hawai[`ʻ']i", "Hawaii", out)
    out = re.sub(r"\bHI\b", "Hawaii", out)
    # Off-grid: never advise grid wall power for this Root Server.
    out = _WALL_POWER_ADVICE.sub(
        "keep Starlink and the site bank alive on solar packs, sun, and load management",
        out,
    )
    out = re.sub(
        r"(?i)\bkeep\s+AC\s+and\s+(?:the\s+)?site\s+bank\s+alive\b",
        "keep Starlink and the site bank alive on solar packs, sun, and load management",
        out,
    )
    # Host charge state: never leave bare "AC" after a percent (sounds like wall power).
    out = re.sub(r"(?i)(\d+\s*%)\s+AC\b", r"\1 charging", out)
    out = re.sub(r"[ \t]{2,}", " ", out)
    out = re.sub(r"\n{3,}", "\n\n", out)
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
        level = alert.get("alert_level") or alert.get("alert") or "unknown"
        erupting = bool(alert.get("erupting"))
        if erupting:
            kil = f"Kīlauea on file is {level} and is erupting."
        else:
            kil = (
                f"Kīlauea on file is {level}, not erupting"
                f"{', ' + str(alert.get('headline')) if alert.get('headline') else ''}."
            )

    power = "Power numbers are not in this sample."
    try:
        from apps.core.services import db_facts

        power = db_facts.ecoflow_line() + " " + db_facts.host_line()
    except Exception:
        pass

    body = f"""This is the Ava Core Root Record morning status for {weekday}, about {about} Hawaiian Standard Time.

You are listening on the Hawaii Pacific Solar Root Server. Host name Ava Core. The live tree is on C only. Public doors are rootrecord.cloud and avaivy.cloud. The public tunnel reaches the local origin.

Boot Summary. Net-gate stopped overnight and restored this morning. Gap on file is {gap_txt}. Restore stamp is {_iso_spoken(str(net.get('restored_at') or ''))}. Desk should be visible after restore. If Desk ever opens as a blank shell, use the start-desk path.

System Summary. Origin is {origin}. The public tunnel should reach origin when the edge is healthy. The on-device brain is {brain}. Voice mode is local clip packs. Paid cloud voice stays off. Public chat runs edge to origin to the on-device brain when warm. Watchdog tasks keep origin and Desk under watch.

Weather Summary. {wx}

Kīlauea Summary. {kil}

Power. {power}

Broken / needs work. After a restore, public chat can say offline until origin and the on-device brain are warm. Paid cloud voice stays off. This site is off-grid solar. If the site bank is low, manage load and sun — never advise wall power.

Already landed. Net-gate restore, visible Ava Desk launch, day board, guest reply cap, and persona live facts for public chat are on this host.

Priority. Keep paid cloud voice off. Keep Starlink and the site bank alive on solar packs, sun, and load management. Leave public chat on the on-device brain. After restores, wait for warm load before the first public reply.

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
        "stamp": now.strftime("%Y-%m-%d %H:%M") + " Hawaiian Standard Time",
        "dated": str(dated),
        "current": str(current),
        "bytes": len(body.encode("utf-8")),
        "text": body,
        "grok": False,
        "scrub": scrub_path_clean(body),
    }


def write_boot_draft(*, source: str = "simulate_boot", text: str | None = None) -> dict:
    """Operator-review draft only — does not replace morning-boot-current.md / dated."""
    if text is None:
        gen = generate_spoken(source=source)
        text = gen["text"]
        engine = gen.get("engine")
        facts = gen.get("facts")
    else:
        engine = "provided"
        facts = None
        gen = {"ok": True, "engine": engine, "grok": False}
    now = datetime.now(HST)
    stamp = now.strftime("%Y%m%d-%H%M%S")
    config.REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    draft = config.REPORTS_DIR / f"morning-boot-draft-{stamp}.md"
    state_draft = config.DATA_DIR / "state" / f"morning-boot-draft-{stamp}.md"
    body = text if text.endswith("\n") else text + "\n"
    header = (
        f"# Morning Boot Report DRAFT (text only — no Ara / no TTS)\n"
        f"source={source} engine={engine} stamp={now.strftime('%Y-%m-%d %H:%M')} Hawaiian Standard Time\n\n"
    )
    full = header + body
    draft.write_text(full, encoding="utf-8")
    state_draft.parent.mkdir(parents=True, exist_ok=True)
    state_draft.write_text(full, encoding="utf-8")
    return {
        "ok": True,
        "source": source,
        "engine": engine,
        "draft": str(draft),
        "state_draft": str(state_draft),
        "bytes": len(full.encode("utf-8")),
        "text": body,
        "full": full,
        "grok": False,
        "tts": False,
        "scrub": scrub_path_clean(body),
        "facts": facts,
    }


# Back-compat for callers that still want a non-LLM facts dump
def build_text(*, source: str = "boot") -> str:
    gen = generate_spoken(source=source)
    return gen["text"]

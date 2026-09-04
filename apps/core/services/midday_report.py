"""Midday status report — spoken Ava Core Root Record noon brief.

Prebuild fires at 11:55 HST; the spoken/text report presents as 12 noon / midday.
Prelims → on-device brain → file. Never Grok spend while halted. No Ara TTS here.
scrub_spoken from boot_report (Ava / Hawaii / off-grid / advisory≠eruption).
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from apps.core import config
from apps.core.services import boot_report

log = logging.getLogger("ava.midday_report")
HST = ZoneInfo("Pacific/Honolulu")

CURRENT_NAME = "midday-boot-current.md"
PROMPT_NAME = "MIDDAY_BOOT_REPORT.txt"
PRESENT_AS_NOON = "about 12 noon Hawaiian Standard Time"

MIDDAY_LOCK = """You ARE Ava Ivy writing the Ava Core Root Record midday status for easy audio readout.

Hard rules:
- No "Aloha". Never say HP, OmniBook, laptop brand, or any PC maker name.
- Never name third parties or engines: no Cloudflare, Grok, Ollama, Electron, Vulkan, Radeon, Shockbyte, GitHub, Discord product pitches, llama, qwen, Cursor, xAI, ChatGPT.
- Say instead: on-device brain, paid cloud voice, public tunnel, Ava Desk, edge, local graphics, public code host, player chat, dream state.
- Never invent watts, percents, times, or alert levels. Use ONLY the FACTS block. If a fact is missing, say you do not have it live.
- Off-grid solar site only. There is no grid wall outlet. Never say prefer wall power, plug in, AC power, wall outlet, or dock as power advice. Power advice is keep Starlink and the site bank alive on solar packs, sun, and load management.
- No repo paths, env vars, stack traces, or raw JSON.
- Short sentences. Numbers spoken naturally. Separate paragraphs with blank lines.
- Do not use markdown ## headings. Use spoken lead-ins as plain sentences.
- Pronunciation: never write all-caps AVA as a standalone token. Prefer “Ava”, “Ava Core”, “Ava Ivy”, or “Root Record”. Host name “Ava Core”.
- Pronunciation: never write bare HI or HST. Prefer “Hawaii”, “Hawaiian Standard Time”, “Hawaii Pacific Solar Root Server”.
- Kīlauea: advisory / not erupting is NOT an eruption.

Required shape:
1. Open: "This is the Ava Core Root Record midday status for [weekday date], about 12 noon Hawaiian Standard Time."
2. Hawaii Pacific Solar Root Server / host Ava Core / C-only / public doors / public tunnel → origin.
3. Midday Summary, System Summary, Weather Summary, Kīlauea Summary, Power, Change vs previous midday when DIFFERENTIALS exist, Broken / needs work, Already landed, Priority.
4. End with: End of status.

OUTPUT ONLY the report text. No preamble.
"""


def _read_json(path: Path) -> dict:
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def prompt_path() -> Path | None:
    pub = config.PUBLIC_MEDIA / "documents" / "persona" / PROMPT_NAME
    return pub if pub.is_file() else None


def load_midday_lock() -> str:
    path = prompt_path()
    if path:
        try:
            text = path.read_text(encoding="utf-8").strip()
            if text:
                return text
        except Exception as e:
            log.warning("midday prompt unreadable: %s", e)
    return MIDDAY_LOCK


def automation_flag_path() -> Path:
    return config.DATA_DIR / "state" / "midday-boot-automation.json"


def set_midday_automation(enabled: bool, *, reason: str) -> dict:
    path = automation_flag_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "enabled": bool(enabled),
        "reason": reason,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "engine": "on_device_brain",
        "tts": False,
        "grok": False,
        "trigger_hst": "11:55",
        "presents_as": "12:00 noon",
    }
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return payload


def midday_automation_enabled() -> bool:
    row = _read_json(automation_flag_path())
    return bool(row.get("enabled"))


def load_previous_midday_report(
    *, exclude_day: str | None = None
) -> tuple[Path | None, str]:
    """Newest midday-boot-*.md on disk (dated), optionally skipping one day."""
    try:
        config.REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass
    dated = sorted(
        (
            p
            for p in config.REPORTS_DIR.glob("midday-boot-*.md")
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


def weekday_line(now: datetime | None = None) -> str:
    now = now or datetime.now(HST)
    return now.strftime("%A, %B ") + str(now.day) + now.strftime(", %Y")


def open_line(*, include_timestamp: bool, now: datetime | None = None) -> str:
    """Full path may stamp noon; offline short stub must not get a clock stamp."""
    day = weekday_line(now)
    if include_timestamp:
        return (
            f"This is the Ava Core Root Record midday status for {day}, "
            f"{PRESENT_AS_NOON}."
        )
    return f"This is the Ava Core Root Record midday status for {day}."


def build_facts(
    *, source: str = "midday", include_timestamp: bool = True
) -> str:
    """Operator/facts block for the on-device brain. Measured only."""
    now = datetime.now(HST)
    alert = _read_json(config.DATA_DIR / "state" / "kilauea-alert.json")
    grok = _read_json(config.DATA_DIR / "state" / "grok-status.json")

    lines = [
        f"FACTS for midday status (source {source}). Use only these. Do not invent.",
        f"Presentation clock: always noon / midday ({PRESENT_AS_NOON}) even if built at 11:55.",
        f"Include opening clock stamp in spoken report: {'yes' if include_timestamp else 'no (offline stub)'}."
        if True
        else "",
        f"Weekday date: {weekday_line(now)}.",
        "Host name spoken: Ava Core (never AVA-CORE letters). Role spoken: Hawaii Pacific Solar Root Server (never HI Pacific). Live tree: C only.",
        "Public doors: rootrecord.cloud and avaivy.cloud. Public tunnel reaches local origin.",
        "Timezone spoken: Hawaiian Standard Time (never bare HST).",
    ]
    lines = [ln for ln in lines if ln]

    origin_ok = boot_report._origin_up()
    brain_ok, brain_detail = boot_report._brain_up()
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

    morning = config.REPORTS_DIR / "morning-boot-current.md"
    if morning.is_file():
        lines.append(f"Morning Boot Report on disk: {morning.name} (context only — do not copy wholesale).")

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

    prev_path, prev_text = load_previous_midday_report(exclude_day=None)
    if prev_path and prev_text:
        lines.append(f"Previous midday status on disk: {prev_path.name}.")
        diff_lines = boot_report.build_diff_facts(prev_text)
        if diff_lines:
            lines.append("DIFFERENTIALS vs that previous midday (measured only — do not invent):")
            lines.extend(diff_lines)
        else:
            lines.append(
                "DIFFERENTIALS: previous midday on disk but no comparable measured percents/hours found."
            )
    else:
        lines.append("Previous midday status: none on disk yet — no differentials.")

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
        "Already landed (recent, if true on this host): morning Boot Report, day board, "
        "guest reply cap, persona live facts for public chat."
    )
    lines.append(
        "Priority: keep paid cloud voice off; keep Starlink and the site bank alive on solar packs, "
        "sun, and load management; leave public chat on the on-device brain."
    )
    return "\n".join(lines)


def _fallback_spoken(
    *, include_timestamp: bool = False, now: datetime | None = None
) -> str:
    """Deterministic short/offline stub. Never stamps the clock (operator rule)."""
    # Offline / short stub path — force no clock stamp regardless of caller.
    include_timestamp = False
    now = now or datetime.now(HST)
    opener = open_line(include_timestamp=include_timestamp, now=now)
    origin = "up" if boot_report._origin_up() else "down"
    brain_ok, _ = boot_report._brain_up()
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

    body = f"""{opener}

You are listening on the Hawaii Pacific Solar Root Server. Host name Ava Core. The live tree is on C only. Public doors are rootrecord.cloud and avaivy.cloud. The public tunnel reaches the local origin.

Midday Summary. This is the noon status check. Sun and load posture matter most through the afternoon. Paid cloud voice stays off.

System Summary. Origin is {origin}. The on-device brain is {brain}. Voice mode is local clip packs. Public chat runs edge to origin to the on-device brain when warm.

Weather Summary. {wx}

Kīlauea Summary. {kil}

Power. {power}

Broken / needs work. After a restore, public chat can say offline until origin and the on-device brain are warm. This site is off-grid solar. If the site bank is low, manage load and sun — never advise wall power.

Already landed. Morning Boot Report and day board paths are on this host when those files exist.

Priority. Keep paid cloud voice off. Keep Starlink and the site bank alive on solar packs, sun, and load management.

End of status.
"""
    return boot_report.scrub_spoken(body)


def generate_spoken(
    *,
    source: str = "midday",
    timeout: int = 180,
    include_timestamp: bool = True,
    offline: bool = False,
) -> dict:
    """Prelim refresh is caller's job. On-device brain; offline stub if cold. No Grok."""
    from apps.core.services import ollama as ollama_svc
    from apps.core.services import xai

    if offline:
        text = _fallback_spoken(include_timestamp=False)
        return {
            "ok": True,
            "text": text,
            "source": source,
            "engine": "offline_stub",
            "include_timestamp": False,
            "grok": False,
            "facts": build_facts(source=source, include_timestamp=False),
            "tts": False,
        }

    if not xai.grok_is_down():
        log.info("midday report: Grok not halted, still using on-device brain only this path")

    facts = build_facts(source=source, include_timestamp=include_timestamp)
    lock = load_midday_lock()
    stamp_note = (
        f'Open with noon clock: "{PRESENT_AS_NOON}".'
        if include_timestamp
        else "OFFLINE STUB MODE: do not put any clock time in the opening line — weekday date only."
    )
    messages = [
        {"role": "system", "content": lock},
        {
            "role": "user",
            "content": (
                f"Write today's midday status from these FACTS only.\n{stamp_note}\n\n"
                + facts
            ),
        },
    ]

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
    stamped = include_timestamp
    if not reply or len(reply.strip()) < 80:
        log.warning("midday report brain thin/empty — using offline stub (no clock stamp)")
        text = _fallback_spoken(include_timestamp=False)
        used = "offline_stub"
        stamped = False
    else:
        text = boot_report.scrub_spoken(reply)
        opener_full = open_line(include_timestamp=True, now=datetime.now(HST))
        opener_bare = open_line(include_timestamp=False, now=datetime.now(HST))
        if include_timestamp:
            if not re.search(r"(?i)midday status for", text):
                text = opener_full + "\n\n" + text.lstrip()
            elif "12 noon" not in text and "noon" not in text.lower():
                text = re.sub(
                    r"(?i)^(This is the Ava Core Root Record midday status for [^.\n]+)\.?",
                    rf"\1, {PRESENT_AS_NOON}.",
                    text,
                    count=1,
                )
            # Model sometimes emits only the clock fragment — replace with full opener.
            if re.match(r"(?i)^\s*about\s+12\s+noon", text):
                text = opener_full + "\n\n" + re.sub(
                    r"(?i)^\s*about\s+12\s+noon[^.]*\.\s*", "", text, count=1
                )
        else:
            if not re.search(r"(?i)midday status for", text):
                text = opener_bare + "\n\n" + text.lstrip()
        text = boot_report.scrub_spoken(text)

    return {
        "ok": True,
        "text": text,
        "source": source,
        "engine": used,
        "warm": bool(warm),
        "include_timestamp": stamped,
        "grok": False,
        "facts": facts,
        "tts": False,
    }


def write_midday_report(
    *,
    source: str = "midday",
    text: str | None = None,
    include_timestamp: bool = True,
) -> dict:
    """Write dated + current midday markdown. No Ara TTS."""
    if text is None:
        gen = generate_spoken(source=source, include_timestamp=include_timestamp)
        text = gen["text"]
        engine = gen.get("engine")
        stamped = gen.get("include_timestamp")
    else:
        engine = "provided"
        stamped = include_timestamp
        gen = {"ok": True, "engine": engine, "grok": False}

    now = datetime.now(HST)
    day = now.strftime("%Y-%m-%d")
    config.REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    dated = config.REPORTS_DIR / f"midday-boot-{day}.md"
    current = config.REPORTS_DIR / CURRENT_NAME
    body = text if text.endswith("\n") else text + "\n"
    dated.write_text(body, encoding="utf-8")
    current.write_text(body, encoding="utf-8")
    log.info(
        "midday report written source=%s engine=%s dated=%s bytes=%s stamp=%s",
        source,
        engine,
        dated.name,
        len(body.encode("utf-8")),
        stamped,
    )
    return {
        "ok": True,
        "source": source,
        "engine": engine,
        "day": day,
        "trigger_hst": "11:55",
        "presents_as": "12:00 noon",
        "include_timestamp": stamped,
        "stamp": now.strftime("%Y-%m-%d %H:%M") + " Hawaiian Standard Time",
        "dated": str(dated),
        "current": str(current),
        "bytes": len(body.encode("utf-8")),
        "text": body,
        "grok": False,
        "tts": False,
        "scrub": boot_report.scrub_path_clean(body),
    }


def write_midday_draft(
    *,
    source: str = "simulate_1155",
    text: str | None = None,
    include_timestamp: bool = True,
) -> dict:
    """Operator-review draft only — does not replace midday-boot-current.md / dated."""
    if text is None:
        gen = generate_spoken(source=source, include_timestamp=include_timestamp)
        text = gen["text"]
        engine = gen.get("engine")
        facts = gen.get("facts")
        stamped = gen.get("include_timestamp")
    else:
        engine = "provided"
        facts = None
        stamped = include_timestamp
        gen = {"ok": True, "engine": engine, "grok": False}
    now = datetime.now(HST)
    stamp = now.strftime("%Y%m%d-%H%M%S")
    config.REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    draft = config.REPORTS_DIR / f"midday-boot-draft-{stamp}.md"
    state_draft = config.DATA_DIR / "state" / f"midday-boot-draft-{stamp}.md"
    body = text if text.endswith("\n") else text + "\n"
    header = (
        f"# Midday status DRAFT (text only — no Ara / no TTS)\n"
        f"trigger=11:55 HST presents_as=12:00 noon include_timestamp={stamped}\n"
        f"source={source} engine={engine} built={now.strftime('%Y-%m-%d %H:%M')} Hawaiian Standard Time\n\n"
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
        "include_timestamp": stamped,
        "trigger_hst": "11:55",
        "presents_as": "12:00 noon",
        "grok": False,
        "tts": False,
        "scrub": boot_report.scrub_path_clean(body),
        "facts": facts,
    }


def grok_full_scaffold_ok(*, include_timestamp: bool = True) -> dict:
    """Point at report_generation Grok-from-URL path. Does NOT call xAI / TTS."""
    from apps.core.services import report_generation

    eng = report_generation.engine_for("midday")
    return {
        "ok": True,
        "wired": True,
        "called": False,
        "engine_toggle": eng,
        "include_timestamp": include_timestamp,
        "state": str(report_generation.config_path()),
        "note": (
            "Full Grok midday may stamp noon; offline stub must not. "
            "Live call only when engine=grok and spend is open."
        ),
    }

"""Hourly clip-pack reports: local facts → clip script → one MP3. No Grok TTS."""
from __future__ import annotations

import logging
import re
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from apps.core import config
from apps.voice.local_tts import GENERATED, speak_script

log = logging.getLogger("ava.cron.hourly_clip_reports")
HST = ZoneInfo("Pacific/Honolulu")


def _int(tok: str) -> str | None:
    m = re.search(r"-?\d+", tok.replace(",", ""))
    return m.group(0) if m else None


def _has_clip(name: str) -> bool:
    from apps.voice.clips import _find_clip

    if re.fullmatch(r"-?\d+", name or ""):
        return bool(_find_clip(name))
    return bool(_find_clip(name))


def _join(bits: list[str]) -> str:
    """Drop tokens with no clip so the pack does not skip mid-sentence."""
    out: list[str] = []
    for tok in bits:
        raw = (tok or "").strip()
        if not raw:
            continue
        if re.fullmatch(r"-?\d+", raw) or _has_clip(raw):
            out.append(raw)
            continue
        if raw.count("_") == 1:
            a, b = raw.split("_", 1)
            if _has_clip(a) and _has_clip(b):
                out.append(raw)
    return " ".join(out)


def _ac_role_tokens() -> list[str]:
    """Leftover house AC → starlink. Other leftover AC → emergency. Transfer separate.

    Do not scan live_facts for the word Starlink — energy.facts_lines always
    mentions Starlink on the host-battery disclaimer.
    """
    bits: list[str] = []
    try:
        from apps.core.crons.since_last_fire.solar_weather import _quota_snapshot
        from apps.core.services import load_categories

        snap = _quota_snapshot() or {}
        devices = list(snap.get("devices") or [])
        if not devices:
            return bits
        load_categories.apply_roles(devices)
        cats = load_categories.categories(devices)
    except Exception:
        return bits
    if float(cats.get("transfer_w") or 0) >= 20:
        bits.append("transfer")
    if float(cats.get("starlink_lights_w") or 0) >= 20:
        bits.append("starlink")
    if float(cats.get("emergency_pack_w") or 0) >= 20:
        bits.append("emergency")
    return [t for t in bits if _has_clip(t)]


def _clip_or(name: str, fallback: list[str]) -> list[str]:
    from apps.voice.clips import _find_clip

    if _find_clip(name):
        return [name]
    return [t for t in fallback if _has_clip(t) or re.fullmatch(r"-?\d+", t)]


def _pack_soc(facts: str, label: str) -> str | None:
    m = re.search(rf"{re.escape(label)}:\s*(\d+(?:\.\d+)?)\s*%", facts, re.I)
    if m:
        return m.group(1).split(".")[0]
    m = re.search(rf"{re.escape(label)}[^\n]{{0,80}}?(\d+(?:\.\d+)?)\s*%\s*SOC", facts, re.I)
    return m.group(1).split(".")[0] if m else None


def solar_script(facts: str, now: datetime) -> str:
    bits = _clip_or(
        "phrase_hourly_solar",
        ["solar", "report"],
    )
    low = facts.lower()
    delta_pct = _pack_soc(facts, "DELTA 2")
    if delta_pct:
        bits += ["delta", delta_pct, "percent"]
    elif "delta" in low:
        bits += ["delta"]
    river_pct = _pack_soc(facts, "RIVER 2 Pro")
    if river_pct:
        bits += ["river", river_pct, "percent"]
    elif "river" in low:
        bits += ["river"]
    m = re.search(r"E-Batt in\s+(\d+)\s*W", facts, re.I)
    if m:
        bits += ["emergency", "in", m.group(1), "watts"]
    else:
        m = re.search(r"Bank combined[^\n]*PV in\s+(\d+)\s*W", facts, re.I) or re.search(
            r"PV in\s+(\d+)\s*W", facts, re.I
        )
        if m:
            bits += ["solar", "in", m.group(1), "watts"]
    m = re.search(r"load out\s+(\d+)\s*W", facts, re.I)
    if m:
        bits += ["load", "out", m.group(1), "watts"]
    m = re.search(r"~(\d+(?:\.\d+)?)\s*h (?:left|to full)", facts, re.I)
    if m:
        hours = m.group(1).split(".")[0]
        bits += [hours, "hours"]
    bits += _ac_role_tokens()
    if "DOWN" in facts and "EcoFlow" in facts:
        bits = _clip_or("phrase_hourly_solar", ["solar", "status", "offline"])
    return _join(bits)


def system_script(facts: str, now: datetime) -> str:
    bits = _clip_or("phrase_hourly_system", ["system", "report"])
    m = re.search(r"CPU\s+(\d+)\s*%", facts, re.I)
    if m:
        bits += ["cpu", m.group(1), "percent"]
    m = re.search(r"RAM\s+(\d+)\s*%", facts, re.I)
    if m:
        bits += ["memory", m.group(1), "percent"]
    if re.search(r"\bnpu\b", facts.lower()):
        bits += ["npu", "load"]
    if "840m" in facts.lower() or "igpu" in facts.lower() or "i_gpu" in facts.lower() or "radeon" in facts.lower():
        bits += ["i_gpu", "load"]
    return _join(bits)


def weather_script(facts: str, now: datetime) -> str:
    bits = _clip_or("phrase_hourly_weather", ["weather", "report"])
    line = ""
    for row in facts.splitlines():
        low = row.lower()
        if low.startswith("weather") or "nws" in low or "noaa" in low:
            line = low
            break
    condition = ""
    for word in (
        "partly_cloudy",
        "mostly_cloudy",
        "partly_sunny",
        "sunny",
        "cloudy",
        "overcast",
        "rain",
        "showers",
        "windy",
        "breezy",
        "foggy",
        "stormy",
        "clear",
        "humid",
        "hot",
        "cold",
    ):
        if word.replace("_", " ") in line or word in line:
            condition = word
            break
    if condition:
        bits.append(condition)
    m = re.search(r"(\d+)\s*°?\s*f\b", line, re.I)
    if not m:
        m = re.search(r"(\d+)\s*f\b", line, re.I)
    if m:
        bits += [m.group(1), "degrees", "fahrenheit"]
    return _join(bits)


def kilauea_script(facts: str, now: datetime) -> str:
    line = ""
    for row in facts.splitlines():
        if row.lower().startswith("kilauea"):
            line = row.lower()
            break
    low = line
    # Order matters: headline "not erupting" contains the substring "erupting".
    # Advisory / paused / not-erupting must win over the eruption phrase.
    if (
        "not erupting" in low
        or "erupting=false" in low
        or "erupting: false" in low
        or re.search(r"\bpaused\b", low)
    ):
        if "advisory" in low or "yellow" in low:
            return _join(_clip_or("phrase_kilauea_advisory", ["kilauea", "advisory"]))
        if "normal" in low or "green" in low:
            return _join(_clip_or("phrase_kilauea_normal", ["kilauea", "normal"]))
        return _join(_clip_or("phrase_kilauea_advisory", ["kilauea", "advisory"]))
    if "advisory" in low or "yellow" in low:
        return _join(_clip_or("phrase_kilauea_advisory", ["kilauea", "advisory"]))
    if "watch" in low:
        return _join(_clip_or("phrase_kilauea_watch", ["kilauea", "watch"]))
    if re.search(r"\bis erupting\b", low) or (
        "eruption" in low and "paused" not in low and "not erupting" not in low
    ):
        return _join(_clip_or("phrase_kilauea_eruption", ["kilauea", "eruption"]))
    if "normal" in low or "green" in low:
        return _join(_clip_or("phrase_kilauea_normal", ["kilauea", "normal"]))
    return _join(["kilauea", "status", "report"])


def _facts_sync() -> str:
    from apps.core.services import db_facts
    from apps.core.services.persona import _kilauea_line

    lines = [db_facts.ecoflow_line(), db_facts.host_line(), _kilauea_line()]
    try:
        from apps.core.services import live_wx

        lines.extend(live_wx.weather_lines_sync())
    except Exception:
        pass
    return "\n".join(lines)


async def _facts_live() -> str:
    try:
        from apps.core.services import persona as persona_svc

        return await persona_svc.live_facts()
    except Exception:
        return _facts_sync()


def build_all(facts: str | None = None) -> dict[str, dict]:
    facts = _facts_sync() if facts is None else facts
    now = datetime.now(HST)
    stamp = now.strftime("%Y%m%d-%H")
    out: dict[str, dict] = {}
    jobs = {
        "solar": solar_script(facts, now),
        "system": system_script(facts, now),
        "weather": weather_script(facts, now),
        "kilauea": kilauea_script(facts, now),
    }
    current_names = {
        "solar": "solar-weather-current.mp3",
        "system": "system-performance-current.mp3",
        "weather": "nws-hawaii-current.mp3",
        "kilauea": "Kilauea_Current.mp3",
    }
    for cat, script in jobs.items():
        dest = Path(GENERATED) / f"hourly-{cat}-{stamp}.mp3"
        latest = Path(GENERATED) / f"hourly-{cat}-current.mp3"
        result = speak_script(script, dest)
        if result.get("ok"):
            import shutil

            shutil.copy2(dest, latest)
            pub = Path(config.AUDIO_CURRENT_DIR) / current_names[cat]
            try:
                pub.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(dest, pub)
            except OSError:
                pass
        result["script"] = script
        out[cat] = result
        log.info("clip report %s ok=%s missing=%s", cat, result.get("ok"), result.get("missing"))
    Path(GENERATED).mkdir(parents=True, exist_ok=True)
    (Path(GENERATED) / "hourly-scripts.txt").write_text(
        "\n".join(f"{k}: {v.get('script')}" for k, v in out.items()),
        encoding="utf-8",
    )
    return out


async def prebuild() -> dict:
    return build_all(await _facts_live())


async def play() -> dict:
    from apps.voice.director import Priority, get_director

    director = get_director()
    played = []
    for cat in ("solar", "system", "weather", "kilauea"):
        p = Path(GENERATED) / f"hourly-{cat}-current.mp3"
        if not p.is_file():
            continue
        await director.queue(p, name=f"hourly_{cat}", priority=Priority.REPORT, scene=None)
        played.append(cat)
    return {"ok": True, "played": played}


async def run() -> dict:
    """Top of hour: ensure MP3s exist, then play."""
    built = build_all(await _facts_live())
    played = await play()
    return {"built": {k: v.get("ok") for k, v in built.items()}, "played": played}

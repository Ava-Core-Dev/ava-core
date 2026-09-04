"""Hourly clip-pack reports: local facts → clip script → one MP3. No Grok TTS."""
from __future__ import annotations

import logging
import re
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from apps.core import config
from apps.voice.local_tts import GENERATED, clock_tokens, speak_script

log = logging.getLogger("ava.cron.hourly_clip_reports")
HST = ZoneInfo("Pacific/Honolulu")


def _int(tok: str) -> str | None:
    m = re.search(r"-?\d+", tok.replace(",", ""))
    return m.group(0) if m else None


def _stamp_prefix(now: datetime) -> list[str]:
    """Clock only. Hourly packs do not lead with weekday or calendar date."""
    minute = 0 if now.minute < 15 else 30 if now.minute < 45 else 0
    hour = now.hour
    if now.minute >= 45:
        hour = (hour + 1) % 24
    if now.minute in (0, 30):
        hour, minute = now.hour, now.minute
    return clock_tokens(hour, minute)


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
    return bits


def _clip_or(name: str, fallback: list[str]) -> list[str]:
    from apps.voice.clips import _find_clip

    if _find_clip(name):
        return [name]
    return list(fallback)


def solar_script(facts: str, now: datetime) -> str:
    bits = _stamp_prefix(now) + _clip_or(
        "phrase_hourly_solar",
        ["solar", "report"],
    )
    low = facts.lower()
    if "delta" in low:
        bits += ["delta"]
        m = re.search(r"DELTA[^%\d]{0,40}(\d{1,3})\s*%", facts, re.I)
        if m:
            bits += [m.group(1), "percent"]
    if "river" in low:
        bits += ["river"]
        m = re.search(r"RIVER[^%\d]{0,40}(\d{1,3})\s*%", facts, re.I)
        if m:
            bits += [m.group(1), "percent"]
    m = re.search(r"PV in\s+(\d+)\s*W", facts, re.I)
    if m:
        bits += ["solar", "in", m.group(1), "watts"]
    m = re.search(r"load out\s+(\d+)\s*W", facts, re.I)
    if m:
        bits += ["load", "out", m.group(1), "watts"]
    m = re.search(r"~(\d+(?:\.\d+)?)\s*h left", facts, re.I)
    if m:
        hours = m.group(1).split(".")[0]
        bits += ["hours_remaining", hours, "hours"]
    bits += _ac_role_tokens()
    if "DOWN" in facts and "EcoFlow" in facts:
        bits = _stamp_prefix(now) + ["solar", "status", "offline"]
    return " ".join(bits)


def system_script(facts: str, now: datetime) -> str:
    bits = _stamp_prefix(now) + _clip_or("phrase_hourly_system", ["system", "report"])
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
    return " ".join(bits)


def weather_script(facts: str, now: datetime) -> str:
    bits = _stamp_prefix(now)
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
    # Never lead with “…as of” unless a condition clip follows — that hung mid-sentence.
    if condition:
        bits += _clip_or("phrase_hourly_weather", ["weather"]) + [condition]
    else:
        bits += _clip_or("phrase_hourly_weather", ["weather", "report"])
    return " ".join(bits)


def kilauea_script(facts: str, now: datetime) -> str:
    low = facts.lower()
    prefix = " ".join(_stamp_prefix(now))
    if "erupting" in low or "eruption" in low:
        return f"{prefix} phrase_kilauea_eruption"
    if "watch" in low:
        return f"{prefix} phrase_kilauea_watch"
    if "advisory" in low:
        return f"{prefix} phrase_kilauea_advisory"
    if "normal" in low or "green" in low:
        return f"{prefix} phrase_kilauea_normal"
    return f"{prefix} kilauea status report"


def _facts_sync() -> str:
    import asyncio

    from apps.core.services import persona as persona_svc

    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            return "\n".join(
                [
                    __import__("apps.core.services.db_facts", fromlist=["ecoflow_line"]).ecoflow_line(),
                    __import__("apps.core.services.db_facts", fromlist=["host_line"]).host_line(),
                ]
            )
    except Exception:
        pass
    from apps.core.services import db_facts

    return "\n".join([db_facts.ecoflow_line(), db_facts.host_line()])


def build_all() -> dict[str, dict]:
    facts = _facts_sync()
    try:
        from apps.core.services import persona as persona_svc
        import asyncio

        async def _more():
            return await persona_svc.live_facts()

        try:
            facts = asyncio.run(_more())
        except RuntimeError:
            pass
    except Exception:
        pass
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
    return build_all()


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
    built = build_all()
    played = await play()
    return {"built": {k: v.get("ok") for k, v in built.items()}, "played": played}

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


def solar_script(facts: str) -> str:
    # Prefer whole-phrase opener from the new kit.
    bits = ["here_are_the_local_solar_and_system_statistics"]
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
    if "DOWN" in facts and "EcoFlow" in facts:
        bits = ["solar", "status", "offline"]
    return " ".join(bits)


def system_script(facts: str) -> str:
    bits = ["system", "performance"]
    m = re.search(r"CPU\s+(\d+)\s*%", facts, re.I)
    if m:
        bits += ["cpu", m.group(1), "percent"]
    m = re.search(r"RAM\s+(\d+)\s*%", facts, re.I)
    if m:
        bits += ["memory", m.group(1), "percent"]
    return " ".join(bits)


def weather_script(facts: str) -> str:
    bits = ["weather_details_as_of"]
    line = ""
    for row in facts.splitlines():
        if "weather" in row.lower() or "nws" in row.lower() or "NOAA" in row:
            line = row.lower()
            break
    for word in (
        "sunny",
        "cloudy",
        "partly_cloudy",
        "mostly_cloudy",
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
            bits.append(word)
            break
    return " ".join(bits)


def kilauea_script(facts: str) -> str:
    low = facts.lower()
    if "erupting" in low or "eruption" in low:
        return "phrase_kilauea_eruption"
    if "watch" in low:
        return "phrase_kilauea_watch"
    if "advisory" in low:
        return "phrase_kilauea_advisory"
    if "normal" in low or "green" in low:
        return "phrase_kilauea_normal"
    return "kilauea status report"


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
        "solar": solar_script(facts),
        "system": system_script(facts),
        "weather": weather_script(facts),
        "kilauea": kilauea_script(facts),
    }
    for cat, script in jobs.items():
        dest = Path(GENERATED) / f"hourly-{cat}-{stamp}.mp3"
        latest = Path(GENERATED) / f"hourly-{cat}-current.mp3"
        result = speak_script(script, dest)
        if result.get("ok"):
            import shutil

            shutil.copy2(dest, latest)
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

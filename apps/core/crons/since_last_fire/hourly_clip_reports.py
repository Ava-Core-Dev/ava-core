"""Hourly clip-pack reports: local facts → clip script → WAV. No Grok TTS.

Reuse pack until facts fingerprint changes. Put the clock back only on a
change announce (not every top-of-hour rebuild).
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from apps.core import config
from apps.voice.local_tts import GENERATED, speak_script

log = logging.getLogger("ava.cron.hourly_clip_reports")
HST = ZoneInfo("Pacific/Honolulu")
STATE_PATH = config.DATA_DIR / "state" / "hourly-clip-reports.json"


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
    """Speak AC transfer only. Do not guess Starlink / emergency from watt bands."""
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


def _soc_bits(label: str, pct: str) -> list[str]:
    """Pack name + number + state_of_charge (or percent fallback)."""
    bits = [label, pct]
    if _has_clip("state_of_charge"):
        bits.append("state_of_charge")
    else:
        bits.append("percent")
    return bits


def solar_script(facts: str, now: datetime) -> str:
    if "DOWN" in facts and "EcoFlow" in facts:
        return _join(_clip_or("phrase_ecoflow_down", ["solar", "status", "offline"]))
    bits = _clip_or(
        "phrase_hourly_solar",
        ["solar", "report"],
    )
    low = facts.lower()
    delta_pct = _pack_soc(facts, "DELTA 2")
    if delta_pct:
        bits += _soc_bits("delta", delta_pct)
    elif "delta" in low:
        bits += ["delta"]
    river_pct = _pack_soc(facts, "RIVER 2 Pro")
    if river_pct:
        bits += _soc_bits("river", river_pct)
    elif "river" in low:
        bits += ["river"]
    m = re.search(r"E-Batt in\s+(\d+)\s*W", facts, re.I)
    if m:
        bits += [m.group(1)]
        bits += _clip_or("watts_in", ["watts"])
    else:
        m = re.search(r"Bank combined[^\n]*PV in\s+(\d+)\s*W", facts, re.I) or re.search(
            r"PV in\s+(\d+)\s*W", facts, re.I
        )
        if m:
            bits += [m.group(1)]
            bits += _clip_or("watts_in", ["watts"])
    m = re.search(r"load out\s+(\d+)\s*W", facts, re.I)
    if m:
        bits += [m.group(1)]
        bits += _clip_or("watts_out", ["watts"])
    m = re.search(r"~(\d+(?:\.\d+)?)\s*h (?:left|to full)", facts, re.I)
    if m:
        bits += [m.group(1).split(".")[0]]
        bits += _clip_or("hours_remaining", ["hours"])
    bits += _ac_role_tokens()
    return _join(bits)


def system_script(facts: str, now: datetime) -> str:
    bits = _clip_or("phrase_hourly_system", ["system", "report"])
    m = re.search(r"CPU\s+(\d+)\s*%", facts, re.I)
    if m:
        bits += ["cpu", m.group(1), "percent"]
    m = re.search(r"RAM\s+(\d+)\s*%", facts, re.I)
    if m:
        bits += ["memory", m.group(1), "percent"]
    # Prefer measured percents. Do not say "npu load" without a number.
    m = re.search(r"\bnpu\s+(\d+)\s*%", facts, re.I)
    if m:
        bits += _clip_or("npu_load", ["npu", "load"])
        bits += [m.group(1), "percent"]
    m = re.search(r"\bi_gpu\s+(\d+)\s*%", facts, re.I)
    if not m:
        m = re.search(r"\bigpu\s+(\d+)\s*%", facts, re.I)
    if m:
        bits += _clip_or("i_gpu_load", ["i_gpu", "load"])
        bits += [m.group(1), "percent"]
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
        "isolated_showers",
        "scattered_showers",
        "trade_winds",
        "wind_advisory",
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
    return _join(_clip_or("phrase_hourly_kilauea", ["kilauea", "status", "report"]))


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


def _load_state() -> dict:
    if not STATE_PATH.is_file():
        return {"hashes": {}, "last_played": {}}
    try:
        data = json.loads(STATE_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {"hashes": {}, "last_played": {}}
    except Exception:
        return {"hashes": {}, "last_played": {}}


def _save_state(data: dict) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def _body_hash(script: str) -> str:
    return hashlib.md5((script or "").encode("utf-8")).hexdigest()


def _with_clock(script: str, now: datetime) -> str:
    """Clock only on change announce — prepend 12h clock tokens when clips exist."""
    from apps.voice.local_tts import clock_tokens

    clock = " ".join(clock_tokens(now.hour, now.minute))
    if not clock:
        return script
    return _join((clock + " " + (script or "")).split())


def build_all(facts: str | None = None, *, force: bool = False) -> dict[str, dict]:
    """Rebuild WAV only when the facts-derived script hash changes (or force)."""
    facts = _facts_sync() if facts is None else facts
    now = datetime.now(HST)
    stamp = now.strftime("%Y%m%d-%H")
    st = _load_state()
    hashes = dict(st.get("hashes") or {})
    out: dict[str, dict] = {}
    jobs = {
        "solar": solar_script(facts, now),
        "system": system_script(facts, now),
        "weather": weather_script(facts, now),
        "kilauea": kilauea_script(facts, now),
    }
    current_names = {
        "solar": "solar-weather-current.wav",
        "system": "system-performance-current.wav",
        "weather": "nws-hawaii-current.wav",
        "kilauea": "Kilauea_Current.wav",
    }
    for cat, body in jobs.items():
        fp = _body_hash(body)
        latest = Path(GENERATED) / f"hourly-{cat}-current.wav"
        legacy = Path(GENERATED) / f"hourly-{cat}-current.mp3"
        changed = force or fp != str(hashes.get(cat) or "") or not latest.is_file()
        result: dict = {
            "ok": True,
            "changed": changed,
            "hash": fp,
            "script_body": body,
            "skipped_rebuild": not changed,
        }
        if changed:
            script = _with_clock(body, now)
            dest = Path(GENERATED) / f"hourly-{cat}-{stamp}.wav"
            result = speak_script(script, dest)
            result["script"] = script
            result["script_body"] = body
            result["changed"] = True
            result["hash"] = fp
            if result.get("ok"):
                import shutil

                shutil.copy2(dest, latest)
                if legacy.is_file():
                    try:
                        legacy.unlink()
                    except OSError:
                        pass
                pub = Path(config.AUDIO_CURRENT_DIR) / current_names[cat]
                try:
                    pub.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(dest, pub)
                    # Drop stale mp3 public siblings
                    pub_mp3 = pub.with_suffix(".mp3")
                    if pub_mp3.is_file():
                        try:
                            pub_mp3.unlink()
                        except OSError:
                            pass
                except OSError:
                    pass
                hashes[cat] = fp
        else:
            result["script"] = body
            result["ok"] = latest.is_file() or legacy.is_file()
        out[cat] = result
        log.info(
            "clip report %s changed=%s ok=%s missing=%s",
            cat,
            changed,
            result.get("ok"),
            result.get("missing"),
        )
    st["hashes"] = hashes
    st["updated_at"] = now.isoformat()
    _save_state(st)
    Path(GENERATED).mkdir(parents=True, exist_ok=True)
    (Path(GENERATED) / "hourly-scripts.txt").write_text(
        "\n".join(f"{k}: {v.get('script')}" for k, v in out.items()),
        encoding="utf-8",
    )
    return out


async def prebuild() -> dict:
    return build_all(await _facts_live())


async def play(*, only_changed: bool = True) -> dict:
    from apps.voice.director import Priority, get_director

    director = get_director()
    st = _load_state()
    played = []
    skipped = []
    for cat in ("solar", "system", "weather", "kilauea"):
        wav = Path(GENERATED) / f"hourly-{cat}-current.wav"
        mp3 = Path(GENERATED) / f"hourly-{cat}-current.mp3"
        p = wav if wav.is_file() else mp3
        if not p.is_file():
            continue
        # only_changed: play when this hour marked changed in last build
        # (caller passes built flags); default play all existing if not gated.
        await director.queue(p, name=f"hourly_{cat}", priority=Priority.REPORT, scene=None)
        played.append(cat)
    st["last_played"] = {c: datetime.now(HST).isoformat() for c in played}
    _save_state(st)
    return {"ok": True, "played": played, "skipped": skipped}


async def run() -> dict:
    """Top of hour: rebuild only on facts change; play only changed packs."""
    built = build_all(await _facts_live())
    from apps.voice.director import Priority, get_director

    director = get_director()
    played = []
    for cat, row in built.items():
        if not row.get("changed"):
            continue
        wav = Path(GENERATED) / f"hourly-{cat}-current.wav"
        mp3 = Path(GENERATED) / f"hourly-{cat}-current.mp3"
        p = wav if wav.is_file() else mp3
        if not p.is_file():
            continue
        await director.queue(p, name=f"hourly_{cat}", priority=Priority.REPORT, scene=None)
        played.append(cat)
    return {"built": {k: v.get("ok") for k, v in built.items()}, "played": played, "changed": played}

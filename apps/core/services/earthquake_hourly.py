"""Local hourly earthquake clip report — Hawaii first, then global half.

No Grok TTS. Clip-stitch → WAV. Trigger: top of hour, or new local M≥2.0.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx

from apps.core import config

log = logging.getLogger("ava.earthquake_hourly")
HST = ZoneInfo("Pacific/Honolulu")

STATE_PATH = config.DATA_DIR / "state" / "earthquake-hourly.json"
USGS = "https://earthquake.usgs.gov/fdsnws/event/1/query"

# Cap spoken regions (clip inventory).
_MAX_HI = 6
_MAX_GLOBAL = 8
_LOCAL_M_MIN = 2.0

HAWAII_BBOX = {
    "minlatitude": 18.5,
    "maxlatitude": 22.5,
    "minlongitude": -160.5,
    "maxlongitude": -154.5,
}


def _load_state() -> dict:
    if not STATE_PATH.is_file():
        return {}
    try:
        data = json.loads(STATE_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_state(data: dict) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def _place_token(place: str) -> str | None:
    """Map USGS place → clip stem when we have one."""
    from apps.voice.clips import _find_clip

    raw = (place or "").lower()
    # Prefer last comma segment (often state/country).
    parts = [p.strip() for p in re.split(r",", place or "") if p.strip()]
    candidates: list[str] = []
    for p in reversed(parts):
        stem = re.sub(r"[^a-z0-9]+", "_", p.lower()).strip("_")
        if stem:
            candidates.append(stem)
    # Common HI islands / regions.
    for needle, stem in (
        ("island of hawaii", "big_island"),
        ("hawaii", "hawaii"),
        ("maui", "maui"),
        ("oahu", "oahu"),
        ("kauai", "kauai"),
        ("alaska", "alaska"),
        ("california", "california"),
        ("japan", "japan"),
        ("indonesia", "indonesia"),
        ("chile", "chile"),
        ("greece", "greece"),
        ("fiji", "fiji"),
        ("china", "china"),
        ("mexico", "mexico"),
        ("peru", "peru"),
        ("turkey", "turkey"),
        ("italy", "italy"),
        ("philippines", "philippines"),
        ("new zealand", "new_zealand"),
        ("russia", "russia"),
        ("canada", "canada"),
    ):
        if needle in raw:
            candidates.insert(0, stem)
    for stem in candidates:
        if _find_clip(stem):
            return stem
    return None


def _mag_token(mag: float | None) -> list[str]:
    if mag is None:
        return []
    # Speak whole magnitude as integer when close; else skip decimals.
    n = int(round(float(mag)))
    bits = [str(n)]
    from apps.voice.clips import _find_clip

    if _find_clip("magnitude"):
        bits = ["magnitude"] + bits
    return bits


def _mag_buckets(events: list[dict]) -> list[tuple[int, int]]:
    """(rounded_mag, count) ascending. Skips unreadable mags."""
    from collections import Counter

    counts: Counter[int] = Counter()
    for e in events:
        try:
            mag = float(e.get("mag"))
        except (TypeError, ValueError):
            continue
        n = int(round(mag))
        if n < 1:
            continue
        counts[n] += 1
    return sorted(counts.items(), key=lambda t: t[0])


def _bucket_bits(buckets: list[tuple[int, int]]) -> list[str]:
    """Speak counts per magnitude — not one 'magnitude N' per quake."""
    bits: list[str] = []
    for mag, count in buckets:
        if count < 1:
            continue
        bits.append(str(int(count)))
        bits += _mag_token(float(mag))
    return bits


async def _fetch(params: dict) -> list[dict]:
    q = dict(params)
    q.setdefault("format", "geojson")
    q.setdefault("orderby", "time")
    async with httpx.AsyncClient(timeout=25) as client:
        r = await client.get(USGS, params=q)
        r.raise_for_status()
        features = (r.json() or {}).get("features") or []
    out: list[dict] = []
    for f in features:
        props = f.get("properties") or {}
        geom = f.get("geometry") or {}
        coords = geom.get("coordinates") or [None, None, None]
        out.append(
            {
                "id": f.get("id"),
                "mag": props.get("mag"),
                "place": props.get("place") or "",
                "time": props.get("time"),
                "lon": coords[0],
                "lat": coords[1],
                "depth_km": coords[2],
            }
        )
    return out


async def fetch_bundle() -> dict:
    hi = await _fetch(
        {
            **HAWAII_BBOX,
            "minmagnitude": 1.0,
            "limit": 40,
        }
    )
    global_ev = await _fetch(
        {
            "minmagnitude": 4.5,
            "limit": 40,
        }
    )
    # Drop Hawaii duplicates from global half.
    hi_ids = {e["id"] for e in hi}
    global_ev = [e for e in global_ev if e.get("id") not in hi_ids]
    return {"hawaii": hi, "global": global_ev}


def facts_fingerprint(bundle: dict) -> str:
    rows = []
    for e in (bundle.get("hawaii") or [])[:12]:
        rows.append(f"hi|{e.get('id')}|{e.get('mag')}")
    for e in (bundle.get("global") or [])[:12]:
        rows.append(f"g|{e.get('id')}|{e.get('mag')}")
    return hashlib.md5("\n".join(rows).encode()).hexdigest()


def build_clip_script(bundle: dict, *, now: datetime | None = None) -> str:
    from apps.voice.clips import _find_clip
    from apps.voice.local_tts import clock_tokens

    now = now or datetime.now(HST)
    bits: list[str] = []
    for stem in ("hawaii", "earthquake", "report"):
        if _find_clip(stem):
            bits.append(stem)
    bits += clock_tokens(now.hour, now.minute)

    # Hawaii: counts by magnitude (e.g. "3 magnitude 2") — never spam one line per quake.
    hi = list(bundle.get("hawaii") or [])
    hi_buckets = _mag_buckets(hi)
    if hi_buckets:
        if _find_clip("hawaii"):
            bits.append("hawaii")
        bits += _bucket_bits(hi_buckets[:_MAX_HI])
    else:
        if _find_clip("hawaii") and _find_clip("quiet"):
            bits += ["hawaii", "quiet"]

    # Global: same rollup (M≥4.5 feed). Cap distinct magnitude buckets.
    glob = list(bundle.get("global") or [])
    glob_buckets = _mag_buckets(glob)
    if glob_buckets:
        if _find_clip("global"):
            bits.append("global")
        if _find_clip("earthquakes"):
            bits.append("earthquakes")
        bits += _bucket_bits(glob_buckets[:_MAX_GLOBAL])

    if _find_clip("end_of_status"):
        bits.append("end_of_status")

    # De-dupe consecutive
    out: list[str] = []
    for b in bits:
        if out and out[-1] == b:
            continue
        out.append(b)
    return " ".join(out)


def new_local_m2(bundle: dict, prev_ids: set[str]) -> list[dict]:
    fresh = []
    for e in bundle.get("hawaii") or []:
        try:
            mag = float(e.get("mag") or 0)
        except (TypeError, ValueError):
            continue
        if mag >= _LOCAL_M_MIN and e.get("id") and e["id"] not in prev_ids:
            fresh.append(e)
    return fresh


async def build_and_maybe_play(
    *,
    reason: str = "hourly",
    force: bool = False,
    play: bool = True,
) -> dict:
    """Fetch → clip script → WAV current. Play when hourly, forced, or new local M≥2."""
    from apps.voice.local_tts import speak_script
    from apps.core.services import voice_events

    prev = _load_state()
    bundle = await fetch_bundle()
    fp = facts_fingerprint(bundle)
    prev_ids = set(prev.get("seen_ids") or [])
    fresh_m2 = new_local_m2(bundle, prev_ids)
    changed = fp != str(prev.get("hash") or "")
    should_announce = bool(force or reason == "hourly" or fresh_m2)

    dest = config.GENERATED_DIR / "earthquake-hourly-current.wav"
    dest.parent.mkdir(parents=True, exist_ok=True)
    script = build_clip_script(bundle)
    stitch = {"ok": True, "skipped": True}
    if should_announce or changed or not dest.is_file():
        # Tight gaps — magnitude buckets are short tokens.
        stitch = speak_script(script, dest, silence_ms=0)
        stitch["script"] = script
        # Drop legacy mp3
        legacy = dest.with_suffix(".mp3")
        if legacy.is_file():
            try:
                legacy.unlink()
            except OSError:
                pass

    text_path = config.REPORTS_DIR / "earthquake-hourly-current.md"
    try:
        config.REPORTS_DIR.mkdir(parents=True, exist_ok=True)
        lines = [
            f"# Earthquake hourly — {datetime.now(HST).isoformat()}",
            f"reason: {reason}",
            f"script: {script}",
            "",
            "## Hawaii",
        ]
        for e in (bundle.get("hawaii") or [])[:12]:
            lines.append(f"- M{e.get('mag')} {e.get('place')}")
        lines.append("")
        lines.append("## Global")
        for e in (bundle.get("global") or [])[:12]:
            lines.append(f"- M{e.get('mag')} {e.get('place')}")
        text_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    except Exception as e:
        log.warning("EQ text write failed: %s", e)

    seen = set(prev_ids)
    for e in (bundle.get("hawaii") or []) + (bundle.get("global") or []):
        if e.get("id"):
            seen.add(e["id"])
    # Cap memory
    seen_list = list(seen)[-400:]
    state = {
        "hash": fp,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "reason": reason,
        "hawaii_n": len(bundle.get("hawaii") or []),
        "global_n": len(bundle.get("global") or []),
        "fresh_local_m2": [e.get("id") for e in fresh_m2],
        "seen_ids": seen_list,
        "script": script,
        "wav": str(dest) if dest.is_file() else None,
    }
    _save_state(state)

    play_out = {"ok": True, "skipped": True}
    if play and should_announce and dest.is_file():
        play_out = await voice_events.play_report_mp3(
            dest, name="earthquake_hourly", kind=None
        )
    return {
        "ok": bool(stitch.get("ok")),
        "changed": changed,
        "announce": should_announce,
        "fresh_local_m2": len(fresh_m2),
        "stitch": stitch,
        "play": play_out,
        "wav": str(dest) if dest.is_file() else None,
        "text": str(text_path) if text_path.is_file() else None,
    }

"""Offline concatenative TTS: clip tokens → one MP3. No Grok.

llama3.2 is text-only. Phoneme files can spell unknown words; prefer whole-word clips.
"""
from __future__ import annotations

import logging
import re
from pathlib import Path

from apps.core import config
from apps.voice.clips import (
    _find_clip,
    _number_to_clips,
    concatenate_clips,
    ffmpeg_bin,
)

log = logging.getLogger("ava.local_tts")

GENERATED = config.GENERATED_DIR


def _token_clip(token: str) -> Path | None:
    raw = (token or "").strip()
    if not raw:
        return None
    if re.fullmatch(r"-?\d+", raw):
        names = _number_to_clips(int(raw))
        found = [_find_clip(n) for n in names]
        found = [p for p in found if p]
        if len(found) == 1:
            return found[0]
        if found:
            dest = GENERATED / f"tok-{raw}.wav"
            try:
                return concatenate_clips(found, dest)
            except Exception:
                return found[0]
        return None
    clean = re.sub(r"[^a-z0-9_]", "", raw.lower())
    if not clean:
        return None
    p = _find_clip(clean)
    if p:
        return p
    # One underscore only (partly_cloudy). Longer names must be a whole clip —
    # stitching eight words makes “here are the local…” sound chopped.
    if clean.count("_") == 1:
        a, b = clean.split("_", 1)
        left, right = _find_clip(a), _find_clip(b)
        if left and right:
            dest = GENERATED / f"tok-{clean}.wav"
            try:
                return concatenate_clips([left, right], dest)
            except Exception:
                return left
    return None


WEEKDAYS = (
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
)
MONTHS = (
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
)


def date_tokens(now) -> list[str]:
    """Weekday + month + day. For calendar/report stamps, not the hourly clock."""
    bits = [WEEKDAYS[now.weekday()], MONTHS[now.month - 1], str(int(now.day))]
    if _find_clip("week"):
        bits.append("week")
    return bits


def clock_tokens(hour: int, minute: int) -> list[str]:
    """12-hour clock from number clips + am/pm + Hawaiian Standard Time.

    Does not use time_HHMM.mp3 — those files are the old full announcements
    and already say AM/PM/HST. Stacking them on the new clips repeats the old take.
    """
    mer = "am" if hour < 12 else "pm"
    if hour == 0 and minute == 0:
        bits = ["midnight"]
        if _find_clip("hawaiian_standard_time"):
            bits.append("hawaiian_standard_time")
        return bits
    if hour == 12 and minute == 0 and _find_clip("noon"):
        bits = ["noon"]
        if _find_clip("hawaiian_standard_time"):
            bits.append("hawaiian_standard_time")
        return bits
    h12 = hour % 12
    if h12 == 0:
        h12 = 12
    bits = [str(h12)]
    if minute:
        bits.append(str(int(minute)))
    elif _find_clip("oclock"):
        bits.append("oclock")
    bits += [mer, "hawaiian_standard_time"]
    return bits


def script_to_paths(script: str) -> tuple[list[Path], list[str]]:
    """Split a space-separated clip script. Returns (paths, missing tokens)."""
    missing: list[str] = []
    paths: list[Path] = []
    for tok in script.split():
        p = _token_clip(tok)
        if p:
            paths.append(p)
        else:
            missing.append(tok)
    return paths, missing


def speak_script(script: str, out_path: Path, *, silence_ms: int | None = None) -> dict:
    """Build one WAV from a clip script. Copy if a single matching WAV; else ffmpeg."""
    dest = Path(out_path)
    if dest.suffix.lower() != ".wav":
        dest = dest.with_suffix(".wav")
    dest.parent.mkdir(parents=True, exist_ok=True)
    paths, missing = script_to_paths(script)
    if not paths:
        return {"ok": False, "detail": "no_clips", "missing": missing}
    if len(paths) == 1 and paths[0].suffix.lower() == ".wav":
        # Normalize even a single clip so stereo converts never leak into play.
        try:
            concatenate_clips(paths, dest, silence_ms=silence_ms)
        except Exception:
            import shutil

            shutil.copy2(paths[0], dest)
        return {
            "ok": True,
            "mp3": str(dest),
            "wav": str(dest),
            "clips": 1,
            "missing": missing,
            "ffmpeg": bool(ffmpeg_bin()),
        }
    try:
        concatenate_clips(paths, dest, silence_ms=silence_ms)
    except FileNotFoundError:
        return {"ok": False, "detail": "no_ffmpeg", "missing": missing, "clips": len(paths)}
    except Exception as e:
        return {"ok": False, "detail": str(e)[:200], "missing": missing}
    return {
        "ok": True,
        "mp3": str(dest),
        "wav": str(dest),
        "clips": len(paths),
        "missing": missing,
        "bytes": dest.stat().st_size if dest.is_file() else 0,
    }


def build_time_announcement(hour: int, minute: int, out_path: Path, now=None) -> dict:
    """bell + 12-hour clock + am/pm + HST → one MP3. No weekday or calendar date."""
    from apps.voice.clips import SOUNDS_DIR

    clock = clock_tokens(hour, minute)
    script = " ".join(["bell"] + clock)
    parts: list[Path] = []
    missing: list[str] = []
    bell = SOUNDS_DIR / "futuristic_bell.mp3"
    if bell.is_file():
        parts.append(bell)
    else:
        missing.append("bell")
    for tok in clock:
        p = _token_clip(tok)
        if p:
            parts.append(p)
        else:
            missing.append(tok)
    if not parts:
        return {"ok": False, "detail": "no_time_clips", "missing": missing, "script": script}
    dest = Path(out_path)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if len(parts) == 1:
        import shutil

        shutil.copy2(parts[0], dest)
        return {"ok": True, "mp3": str(dest), "clips": 1, "missing": missing, "script": script}
    concatenate_clips(parts, dest)
    return {
        "ok": True,
        "mp3": str(dest),
        "clips": len(parts),
        "bytes": dest.stat().st_size if dest.is_file() else 0,
        "missing": missing,
        "script": script,
    }

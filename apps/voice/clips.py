"""
Local clip engine — concatenates pre-recorded MP3 clips via ffmpeg.
Ported from voice/report_speaker.py and voice/ara_grok_report.py.
No API calls. Used for deterministic content (numbers, time, status phrases).
"""

from __future__ import annotations

import logging
import re
import subprocess
import tempfile
from pathlib import Path

log = logging.getLogger("ava.clips")

# Clips live in the central media library (media/audio), not apps/voice/assets.
from apps.core import config as _cfg
ASSETS_DIR  = _cfg.ASSETS_DIR
NUMBERS_DIR = ASSETS_DIR / "numbers"
WORDS_DIR   = ASSETS_DIR / "words"
TIME_DIR    = ASSETS_DIR / "time_clips"
SOUNDS_DIR  = ASSETS_DIR / "sounds"

SILENCE_MS  = 90  # gap between clips in ms


def _number_to_clips(n: int) -> list[str]:
    """
    Decompose integer n into clip filenames.
    Prefers a direct clip file (e.g. '1000000.mp3') over decomposing into
    sub-words, so large number clips recorded by Ara play naturally.
    """
    if n < 0:
        return ["negative"] + _number_to_clips(-n)
    if n == 0:
        return ["0"]

    # If there's a direct clip for this exact number, use it
    if (NUMBERS_DIR / f"{n}.mp3").exists():
        return [str(n)]

    clips: list[str] = []
    if n >= 1_000_000_000:
        clips += _number_to_clips(n // 1_000_000_000) + ["billion"]
        n %= 1_000_000_000
        if n:
            clips += _number_to_clips(n)
        return clips
    if n >= 1_000_000:
        clips += _number_to_clips(n // 1_000_000) + ["million"]
        n %= 1_000_000
        if n:
            clips += _number_to_clips(n)
        return clips
    if n >= 1_000:
        clips += _number_to_clips(n // 1_000) + ["thousand"]
        n %= 1_000
        if n:
            clips += _number_to_clips(n)
        return clips
    if n >= 100:
        clips += _number_to_clips(n // 100) + ["hundred"]
        n %= 100
        if n:
            clips += ["and"] + _number_to_clips(n)
        return clips
    clips.append(str(n))
    return clips


def _find_clip(name: str) -> Path | None:
    """Search for a clip by name in words/, numbers/, and assets root."""
    for directory in (WORDS_DIR, NUMBERS_DIR, ASSETS_DIR):
        for ext in (".mp3", ".wav"):
            p = directory / (name + ext)
            if p.exists():
                return p
    return None


def _make_silence(ms: int = SILENCE_MS) -> Path:
    """Generate a short silence file via ffmpeg."""
    tmp = tempfile.NamedTemporaryFile(suffix=".mp3", delete=False)
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", f"anullsrc=r=44100:cl=mono",
         "-t", str(ms / 1000), "-q:a", "9", tmp.name],
        capture_output=True, check=True,
    )
    return Path(tmp.name)


def concatenate_clips(clips: list[Path], out_path: Path) -> Path:
    """Concatenate MP3 clips with silence gaps using ffmpeg concat demuxer."""
    silence = _make_silence(SILENCE_MS)
    with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
        list_file = Path(f.name)
        for clip in clips:
            f.write(f"file '{clip}'\n")
            f.write(f"file '{silence}'\n")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(list_file),
         "-c", "copy", str(out_path)],
        capture_output=True, check=True,
    )
    list_file.unlink(missing_ok=True)
    silence.unlink(missing_ok=True)
    return out_path


def speak_text(text: str, out_path: Path) -> Path | None:
    """
    Attempt to build an MP3 from pre-recorded clips for the given text.
    Handles numbers and known phrase tokens. Returns None if clips are missing.
    """
    tokens = text.lower().strip().split()
    clip_paths: list[Path] = []

    for token in tokens:
        # Try numeric
        try:
            n = int(re.sub(r"[^0-9-]", "", token))
            for clip_name in _number_to_clips(n):
                p = _find_clip(clip_name)
                if p:
                    clip_paths.append(p)
            continue
        except ValueError:
            pass

        # Try word/phrase clip
        clean = re.sub(r"[^a-z0-9_]", "", token)
        p = _find_clip(clean)
        if p:
            clip_paths.append(p)
        else:
            log.debug("No clip for token: %s", token)

    if not clip_paths:
        log.warning("No clips found for text: %s", text[:80])
        return None

    return concatenate_clips(clip_paths, out_path)


def speak_time(hour: int, minute: int, out_path: Path) -> Path | None:
    """Speak a time using pre-recorded time clips (time_HHMM.mp3)."""
    name = f"time_{hour:02d}{minute:02d}"
    p = TIME_DIR / f"{name}.mp3"
    if not p.exists():
        log.warning("Time clip not found: %s", p)
        return None
    import shutil
    shutil.copy2(p, out_path)
    return out_path

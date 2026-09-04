"""
Local clip engine — concatenates pre-recorded MP3 clips via ffmpeg.
Ported from voice/report_speaker.py and voice/ara_grok_report.py.
No API calls. Used for deterministic content (numbers, time, status phrases).
"""

from __future__ import annotations

import logging
import os
import re
import subprocess
import tempfile
from pathlib import Path

log = logging.getLogger("ava.clips")

CREATE_NO_WINDOW = 0x08000000


def _run(cmd: list[str], **kwargs):
    if os.name == "nt":
        kwargs.setdefault("creationflags", CREATE_NO_WINDOW)
    return subprocess.run(cmd, **kwargs)

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
    """Search numbers/ first so 1.mp3 is the digit, not a word collision."""
    for directory in (NUMBERS_DIR, WORDS_DIR, ASSETS_DIR):
        for ext in (".mp3", ".wav"):
            p = directory / (name + ext)
            if p.exists():
                return p
    return None


def _escape_concat_path(path: Path) -> str:
    return str(path.resolve()).replace("'", r"'\''")


def concatenate_clips(clips: list[Path], out_path: Path) -> Path:
    """
    Concatenate clips into one real MP3.

    Must re-encode. `-c copy` glues separate MPEG bitstreams; Discord (and
    many players) then only play the first clip — e.g. 1241414 starts with
    1.mp3 so you only hear “one”.
    """
    if not clips:
        raise ValueError("No clips to concatenate")

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    gap = SILENCE_MS / 1000.0

    with tempfile.TemporaryDirectory() as tmp:
        tmpdir = Path(tmp)
        list_file = tmpdir / "concat.txt"
        with open(list_file, "w", encoding="utf-8") as f:
            for i, clip in enumerate(clips):
                f.write(f"file '{_escape_concat_path(Path(clip))}'\n")
                if i < len(clips) - 1 and SILENCE_MS > 0:
                    f.write(f"file '{_escape_concat_path(tmpdir / 'silence.mp3')}'\n")

        if SILENCE_MS > 0 and len(clips) > 1:
            silence = tmpdir / "silence.mp3"
            _run(
                [
                    "ffmpeg", "-y",
                    "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
                    "-t", f"{gap:.3f}",
                    "-c:a", "libmp3lame", "-q:a", "9",
                    str(silence),
                ],
                capture_output=True,
                check=True,
            )

        result = _run(
            [
                "ffmpeg", "-y",
                "-f", "concat", "-safe", "0",
                "-i", str(list_file),
                "-c:a", "libmp3lame",
                "-ar", "44100",
                "-ac", "1",
                "-q:a", "2",
                "-id3v2_version", "3",
                str(out_path),
            ],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise RuntimeError(f"ffmpeg concat failed:\n{result.stderr}")
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


def speak_number(n: int, out_path: Path) -> Path | None:
    """Concatenate Ara number clips for one integer. No API."""
    names = _number_to_clips(int(n))
    clip_paths: list[Path] = []
    for name in names:
        p = _find_clip(name)
        if p:
            clip_paths.append(p)
        else:
            log.warning("No number clip: %s", name)
    if not clip_paths:
        return None
    dest = Path(out_path)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if len(clip_paths) == 1:
        import shutil
        shutil.copy2(clip_paths[0], dest)
        return dest
    try:
        return concatenate_clips(clip_paths, dest)
    except FileNotFoundError:
        log.warning("ffmpeg missing — queue clips one at a time from director")
        return None


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


if __name__ == "__main__":
    import argparse
    import json
    import sys

    p = argparse.ArgumentParser(description="Ara number clips → MP3")
    p.add_argument("--number", required=True, help="Integer only")
    p.add_argument("--out", required=True)
    args = p.parse_args()
    raw = str(args.number).strip()
    if not re.fullmatch(r"-?\d+", raw):
        print(json.dumps({"ok": False, "reason": "numbers_only"}))
        sys.exit(1)
    dest = Path(args.out)
    got = speak_number(int(raw, 10), dest)
    if not got or not got.exists():
        print(json.dumps({"ok": False, "reason": "no_clips"}))
        sys.exit(1)
    print(json.dumps({"ok": True, "mp3": str(got.resolve())}))
    sys.exit(0)

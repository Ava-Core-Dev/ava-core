"""
Local clip engine — concatenates pre-recorded clips via ffmpeg.
Canonical output: WAV 44.1 kHz 16-bit PCM. Prefers .wav stems over .mp3.
No API calls. Used for deterministic content (numbers, time, status phrases).
"""

from __future__ import annotations

import logging
import os
import re
import shutil
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
PHONEME_DIR = ASSETS_DIR / "phonemes"

SILENCE_MS  = 50  # gap between clips in ms (tight radio blend; was 90)


def ffmpeg_bin() -> str | None:
    from_env = (os.getenv("AVA_FFMPEG") or "").strip()
    if from_env and Path(from_env).is_file():
        return from_env
    found = shutil.which("ffmpeg")
    if found:
        return found
    try:
        import imageio_ffmpeg

        exe = imageio_ffmpeg.get_ffmpeg_exe()
        if exe and Path(exe).is_file():
            return exe
    except Exception:
        pass
    return None


def _number_to_clips(n: int) -> list[str]:
    """
    Decompose integer n into clip filenames.
    Prefers a direct clip file (e.g. '1000000.wav') over decomposing into
    sub-words, so large number clips recorded by Ara play naturally.
    """
    if n < 0:
        return ["negative"] + _number_to_clips(-n)
    if n == 0:
        return ["0"]

    # If there's a direct clip for this exact number, use it
    if (NUMBERS_DIR / f"{n}.wav").exists() or (NUMBERS_DIR / f"{n}.mp3").exists():
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
    """Search numbers/ first so 1.wav is the digit, not a word collision.

    Prefers .wav over .mp3 when both exist (canonical desk format).
    Also checks words/nws/ (NWS All Hazards) and words/ecoflow/ (AC solar-gate
    pack) after flat words/ so existing weather/number clips keep priority and
    each pack stays a separable subtree.
    """
    search_dirs = (
        NUMBERS_DIR,
        WORDS_DIR,
        WORDS_DIR / "nws",
        WORDS_DIR / "ecoflow",
        TIME_DIR,
        SOUNDS_DIR,
        PHONEME_DIR,
        ASSETS_DIR,
    )
    for directory in search_dirs:
        for ext in (".wav", ".mp3"):
            p = directory / (name + ext)
            if p.exists():
                return p
    return None


def _escape_concat_path(path: Path) -> str:
    return str(path.resolve()).replace("'", r"'\''")


def concatenate_clips(
    clips: list[Path],
    out_path: Path,
    *,
    silence_ms: int | None = None,
) -> Path:
    """
    Concatenate clips into one WAV (44.1 kHz 16-bit PCM mono).

    Must re-encode. `-c copy` fails across mixed containers (wav/mp3).
    Every input is normalized to mono 44.1k first — mixing zip mono Ara
    stems with stereo converts made numbers play in slow-mo.

    Skip inserted silence next to pause clips (comma_pause / period_pause /
    section_pause) — those files are already open space.

    silence_ms: override SILENCE_MS (use 0 for dense NWS/radio packs).
    """
    if not clips:
        raise ValueError("No clips to concatenate")

    out_path = Path(out_path)
    if out_path.suffix.lower() != ".wav":
        out_path = out_path.with_suffix(".wav")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    gap_ms = SILENCE_MS if silence_ms is None else max(0, int(silence_ms))
    gap = gap_ms / 1000.0
    pause_names = {"comma_pause", "period_pause", "section_pause"}

    def _is_pause(p: Path) -> bool:
        return p.stem.lower() in pause_names

    ff = ffmpeg_bin()
    if not ff:
        raise FileNotFoundError("ffmpeg missing")

    with tempfile.TemporaryDirectory() as tmp:
        tmpdir = Path(tmp)
        list_file = tmpdir / "concat.txt"
        need_silence = False
        norm_paths: list[Path] = []

        def _normalize(src: Path, dest: Path) -> None:
            result = _run(
                [
                    ff, "-y",
                    "-i", str(Path(src).resolve()),
                    "-acodec", "pcm_s16le",
                    "-ar", "44100",
                    "-ac", "1",
                    str(dest),
                ],
                capture_output=True,
                text=True,
            )
            if result.returncode != 0 or not dest.is_file():
                raise RuntimeError(
                    f"ffmpeg normalize failed for {src.name}:\n{result.stderr}"
                )

        for i, clip in enumerate(clips):
            norm = tmpdir / f"n{i:04d}.wav"
            _normalize(Path(clip), norm)
            norm_paths.append(norm)

        with open(list_file, "w", encoding="utf-8") as f:
            for i, norm in enumerate(norm_paths):
                f.write(f"file '{_escape_concat_path(norm)}'\n")
                if i >= len(norm_paths) - 1 or gap_ms <= 0:
                    continue
                a = Path(clips[i])
                b = Path(clips[i + 1])
                if _is_pause(a) or _is_pause(b):
                    continue
                f.write(f"file '{_escape_concat_path(tmpdir / 'silence.wav')}'\n")
                need_silence = True

        if need_silence:
            silence = tmpdir / "silence.wav"
            _run(
                [
                    ff, "-y",
                    "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
                    "-t", f"{gap:.3f}",
                    "-c:a", "pcm_s16le",
                    str(silence),
                ],
                capture_output=True,
                check=True,
            )

        result = _run(
            [
                ff, "-y",
                "-f", "concat", "-safe", "0",
                "-i", str(list_file),
                "-c:a", "pcm_s16le",
                "-ar", "44100",
                "-ac", "1",
                str(out_path),
            ],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise RuntimeError(f"ffmpeg concat failed:\n{result.stderr}")
    return out_path


_DURATION_RE = re.compile(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)")


def mp3_duration_s(path: Path) -> float | None:
    """Seconds from ffmpeg -i. None if ffmpeg missing or no Duration line."""
    ff = ffmpeg_bin()
    if not ff or not path or not Path(path).is_file():
        return None
    result = _run(
        [ff, "-i", str(path)],
        capture_output=True,
        text=True,
    )
    blob = (result.stderr or "") + (result.stdout or "")
    m = _DURATION_RE.search(blob)
    if not m:
        return None
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))


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
    """Speak a time using pre-recorded time clips (time_HHMM.wav preferred)."""
    name = f"time_{hour:02d}{minute:02d}"
    p = TIME_DIR / f"{name}.wav"
    if not p.exists():
        p = TIME_DIR / f"{name}.mp3"
    if not p.exists():
        log.warning("Time clip not found: %s", name)
        return None
    import shutil
    dest = Path(out_path)
    if dest.suffix.lower() != ".wav":
        dest = dest.with_suffix(".wav")
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(p, dest)
    return dest


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

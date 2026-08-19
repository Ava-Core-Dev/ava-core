"""Still-image + MP3 → MP4 using the daily broadcast thumbnail."""

from __future__ import annotations

import logging
import shutil
import subprocess
from pathlib import Path

from . import config

log = logging.getLogger("ava.mp4")


def convert_if_needed(mp3_path: Path, *, thumbnail: Path | None = None) -> Path | None:
    src = Path(mp3_path)
    if not src.exists() or src.suffix.lower() != ".mp3":
        return None
    out = src.with_suffix(".mp4")
    thumb = Path(thumbnail) if thumbnail else Path(config.THUMBNAIL_PATH)
    if not thumb.exists():
        log.warning("mp4 convert skipped — no thumbnail at %s", thumb)
        return None
    ffmpeg = shutil.which("ffmpeg") or str(Path.home() / ".local/bin/ffmpeg")
    cmd = [
        ffmpeg,
        "-y",
        "-loop",
        "1",
        "-i",
        str(thumb),
        "-i",
        str(src),
        "-c:v",
        "libx264",
        "-tune",
        "stillimage",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-shortest",
        "-movflags",
        "+faststart",
        str(out),
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=120)
    except Exception as e:
        log.warning("mp4 convert failed: %s", e)
        return None
    return out if out.exists() else None

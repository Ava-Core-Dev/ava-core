"""Still-image + MP3 → MP4 using the daily broadcast thumbnail.

Writes into the media library:
  video/current  — latest OBS / current copy (MP4_DIR)
  video/reports  — titled YouTube morning files when --out is set there
"""

from __future__ import annotations

import argparse
import json
import logging
import shutil
import subprocess
import sys
from pathlib import Path

from . import config

log = logging.getLogger("ava.mp4")


def daily_thumbnail(explicit: Path | None = None) -> Path | None:
    if explicit and Path(explicit).exists():
        return Path(explicit)
    thumb = Path(getattr(config, "DAILY_BROADCAST_THUMB", config.THUMBNAIL_PATH))
    if thumb.exists():
        return thumb
    fallback = Path(config.THUMBNAIL_PATH)
    return fallback if fallback.exists() else None


def convert_if_needed(
    mp3_path: Path,
    *,
    thumbnail: Path | None = None,
    out_path: Path | None = None,
    current_path: Path | None = None,
) -> Path | None:
    src = Path(mp3_path)
    if not src.exists() or src.suffix.lower() != ".mp3":
        return None
    dest = Path(out_path) if out_path else (config.MP4_DIR / src.with_suffix(".mp4").name)
    dest.parent.mkdir(parents=True, exist_ok=True)
    thumb = daily_thumbnail(Path(thumbnail) if thumbnail else None)
    if not thumb:
        log.warning("mp4 convert skipped — no thumbnail")
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
        str(dest),
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=180)
    except Exception as e:
        log.warning("mp4 convert failed: %s", e)
        return None
    if not dest.exists():
        return None
    if current_path:
        current = Path(current_path)
        current.parent.mkdir(parents=True, exist_ok=True)
        try:
            shutil.copy2(dest, current)
        except OSError as e:
            log.warning("mp4 current copy failed: %s", e)
    return dest


def _cli(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Ava still-image MP3→MP4 converter")
    p.add_argument("--mp3", required=True, help="Source MP3")
    p.add_argument("--out", default="", help="Destination MP4 path")
    p.add_argument("--thumb", default="", help="Still image (defaults to daily broadcast thumb)")
    p.add_argument(
        "--current",
        default="",
        help="Also copy to this path (default: video/current/Morning_Broadcast_Current.mp4 when --out is set)",
    )
    args = p.parse_args(argv)
    src = Path(args.mp3)
    out = Path(args.out) if args.out else None
    thumb = Path(args.thumb) if args.thumb else None
    current = None
    if args.current:
        current = Path(args.current)
    elif out:
        current = config.MP4_DIR / "Morning_Broadcast_Current.mp4"
    dest = convert_if_needed(src, thumbnail=thumb, out_path=out, current_path=current)
    if not dest:
        print(json.dumps({"ok": False, "reason": "convert_failed"}))
        return 1
    print(
        json.dumps(
            {
                "ok": True,
                "mp4": str(dest),
                "thumbnail": str(daily_thumbnail(thumb) or ""),
                "current": str(current) if current and current.exists() else None,
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(_cli())

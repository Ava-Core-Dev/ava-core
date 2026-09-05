"""FFmpeg program-bus remux for Root Record Radio (no desktop loopback).

When on air, `/radio/live.mp3` pipes the current bed/report file through ffmpeg
as MP3. Icecast is optional later for multi-listener mounts; this is enough for
HTML <audio> and Desk localhost listen.
"""
from __future__ import annotations

import asyncio
import logging
import subprocess
from pathlib import Path

log = logging.getLogger("ava.radio_encode")

CREATE_NO_WINDOW = 0x08000000


def _ffmpeg() -> str | None:
    try:
        from apps.voice.clips import ffmpeg_bin

        return ffmpeg_bin()
    except Exception:
        return None


def current_program_path() -> Path | None:
    try:
        from apps.voice.director import get_director

        cur = (get_director().get_status().get("music") or {}).get("current")
        if cur:
            p = Path(cur)
            if p.is_file():
                return p
    except Exception:
        pass
    try:
        from apps.voice import desk_audio

        p = desk_audio.bed_path()
        if p and Path(p).is_file():
            return Path(p)
    except Exception:
        pass
    return None


async def iter_mp3_for_file(path: Path):
    """Yield MP3 bytes for one program file. Stops when ffmpeg exits."""
    ff = _ffmpeg()
    if not ff or not path.is_file():
        return
    kwargs: dict = {
        "stdout": asyncio.subprocess.PIPE,
        "stderr": asyncio.subprocess.DEVNULL,
    }
    import os

    if os.name == "nt":
        kwargs["creationflags"] = CREATE_NO_WINDOW
    proc = await asyncio.create_subprocess_exec(
        ff,
        "-hide_banner",
        "-loglevel",
        "error",
        "-re",
        "-i",
        str(path.resolve()),
        "-vn",
        "-acodec",
        "libmp3lame",
        "-ab",
        "128k",
        "-f",
        "mp3",
        "pipe:1",
        **kwargs,
    )
    assert proc.stdout is not None
    try:
        while True:
            chunk = await proc.stdout.read(16 * 1024)
            if not chunk:
                break
            yield chunk
    finally:
        try:
            if proc.returncode is None:
                proc.kill()
        except Exception:
            pass
        try:
            await proc.wait()
        except Exception:
            pass

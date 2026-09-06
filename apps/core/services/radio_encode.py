"""FFmpeg program-bus remux for Root Record Radio (no desktop loopback).

When on air, `/radio/live.mp3` pipes the current bed/report file through ffmpeg
as MP3. No Icecast required for single-listener HTML audio.
"""
from __future__ import annotations

import asyncio
import logging
import os
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
        from apps.voice import desk_audio

        p = desk_audio.bed_path()
        if p and Path(p).is_file():
            return Path(p)
    except Exception:
        pass
    try:
        from apps.voice.director import get_director

        d = get_director()
        cur = getattr(d, "_music_current", None)
        if cur is not None and Path(cur).is_file():
            return Path(cur)
    except Exception:
        pass
    try:
        from apps.core.services import radio as radio_svc

        last = str(radio_svc.load().get("last_track") or "").strip()
        if last and Path(last).is_file():
            return Path(last)
    except Exception:
        pass
    return None


def _spawn_ffmpeg(path: Path) -> subprocess.Popen | None:
    ff = _ffmpeg()
    if not ff or not path.is_file():
        return None
    kwargs: dict = {
        "stdout": subprocess.PIPE,
        "stderr": subprocess.PIPE,
        "stdin": subprocess.DEVNULL,
    }
    if os.name == "nt":
        kwargs["creationflags"] = CREATE_NO_WINDOW
    try:
        return subprocess.Popen(
            [
                ff,
                "-hide_banner",
                "-loglevel",
                "error",
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
            ],
            **kwargs,
        )
    except Exception as e:
        log.warning("ffmpeg spawn failed: %s", e)
        return None


async def iter_mp3_for_file(path: Path):
    """Yield MP3 bytes for one program file (thread reader — Windows-safe)."""
    proc = await asyncio.to_thread(_spawn_ffmpeg, path)
    if proc is None or proc.stdout is None:
        return
    loop = asyncio.get_running_loop()

    def _read_chunk() -> bytes:
        try:
            return proc.stdout.read(16 * 1024) if proc.stdout else b""
        except Exception:
            return b""

    try:
        while True:
            chunk = await loop.run_in_executor(None, _read_chunk)
            if not chunk:
                break
            yield chunk
    finally:
        try:
            if proc.poll() is None:
                proc.kill()
        except Exception:
            pass
        try:
            await asyncio.to_thread(proc.wait, 3)
        except Exception:
            pass
        err = b""
        try:
            if proc.stderr:
                err = proc.stderr.read() or b""
        except Exception:
            pass
        if err:
            log.debug("ffmpeg live stderr: %s", err[:300].decode("utf-8", "replace"))

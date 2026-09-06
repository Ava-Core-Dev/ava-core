"""FFmpeg program-bus remux for Root Record Radio (no desktop loopback).

``/radio/live.mp3`` is a continuous MP3: music bed, interrupted by report/chime
inserts (same files the director plays locally). No Icecast required.
"""
from __future__ import annotations

import asyncio
import logging
import os
import subprocess
import threading
import time
from pathlib import Path

log = logging.getLogger("ava.radio_encode")

CREATE_NO_WINDOW = 0x08000000

_lock = threading.RLock()
_insert_path: Path | None = None
_insert_name: str = ""
_generation = 0
_bed_started_mono: float | None = None
_bed_path_key: str | None = None


def _ffmpeg() -> str | None:
    try:
        from apps.voice.clips import ffmpeg_bin

        return ffmpeg_bin()
    except Exception:
        return None


def bump() -> int:
    global _generation
    with _lock:
        _generation += 1
        return _generation


def generation() -> int:
    with _lock:
        return _generation


def push_insert(path: Path | str, *, name: str = "") -> None:
    """Foreground a report/chime on the public stream (interrupts bed remux)."""
    global _insert_path, _insert_name
    p = Path(path)
    if not p.is_file():
        return
    with _lock:
        _insert_path = p.resolve()
        _insert_name = (name or p.stem)[:120]
        global _generation
        _generation += 1
    log.info("radio insert on  name=%s  file=%s", _insert_name, p.name)


def clear_insert(*, path: Path | str | None = None) -> None:
    """Clear insert; if path set, only clear when it still matches."""
    global _insert_path, _insert_name, _generation
    with _lock:
        if _insert_path is None:
            return
        if path is not None:
            try:
                if Path(path).resolve() != _insert_path:
                    return
            except Exception:
                return
        _insert_path = None
        _insert_name = ""
        _generation += 1
    log.info("radio insert off")


def insert_active() -> dict | None:
    with _lock:
        if _insert_path is None:
            return None
        return {"path": str(_insert_path), "name": _insert_name}


def _note_bed_start(path: Path) -> None:
    global _bed_started_mono, _bed_path_key
    key = str(path.resolve())
    with _lock:
        if _bed_path_key != key:
            _bed_path_key = key
            _bed_started_mono = time.monotonic()


def _bed_seek_s(path: Path) -> float:
    key = str(path.resolve())
    with _lock:
        if _bed_path_key != key or _bed_started_mono is None:
            return 0.0
        return max(0.0, time.monotonic() - _bed_started_mono)


def current_program_path() -> Path | None:
    with _lock:
        if _insert_path is not None and _insert_path.is_file():
            return _insert_path
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


def _spawn_ffmpeg(path: Path, *, seek_s: float = 0.0) -> subprocess.Popen | None:
    ff = _ffmpeg()
    if not ff or not path.is_file():
        return None
    args = [ff, "-hide_banner", "-loglevel", "error"]
    if seek_s >= 0.5:
        args += ["-ss", f"{seek_s:.2f}"]
    args += [
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
    ]
    kwargs: dict = {
        "stdout": subprocess.PIPE,
        "stderr": subprocess.PIPE,
        "stdin": subprocess.DEVNULL,
    }
    if os.name == "nt":
        kwargs["creationflags"] = CREATE_NO_WINDOW
    try:
        return subprocess.Popen(args, **kwargs)
    except Exception as e:
        log.warning("ffmpeg spawn failed: %s", e)
        return None


def _kill_proc(proc: subprocess.Popen | None) -> None:
    if proc is None:
        return
    try:
        if proc.poll() is None:
            proc.kill()
    except Exception:
        pass
    try:
        proc.wait(timeout=3)
    except Exception:
        pass


async def iter_mp3_for_file(path: Path, *, seek_s: float = 0.0, gen_watch: int | None = None):
    """Yield MP3 bytes for one program file. Stops early if generation bumps."""
    proc = await asyncio.to_thread(_spawn_ffmpeg, path, seek_s=seek_s)
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
            if gen_watch is not None and generation() != gen_watch:
                break
            chunk = await loop.run_in_executor(None, _read_chunk)
            if not chunk:
                break
            yield chunk
            if gen_watch is not None and generation() != gen_watch:
                break
    finally:
        await asyncio.to_thread(_kill_proc, proc)


async def iter_live_program():
    """Endless program bus for ``/radio/live.mp3`` — bed + voice inserts."""
    idle_since = time.monotonic()
    while True:
        try:
            from apps.core.services import radio as radio_svc

            if not radio_svc.load().get("on_air"):
                break
        except Exception:
            break

        path = current_program_path()
        if path is None:
            if time.monotonic() - idle_since > 120:
                break
            await asyncio.sleep(0.4)
            continue

        idle_since = time.monotonic()
        gen = generation()
        is_insert = False
        with _lock:
            is_insert = _insert_path is not None and path == _insert_path

        seek = 0.0
        if not is_insert:
            _note_bed_start(path)
            seek = _bed_seek_s(path)

        log.debug(
            "radio live segment  insert=%s  seek=%.1f  file=%s  gen=%s",
            is_insert,
            seek,
            path.name,
            gen,
        )
        async for chunk in iter_mp3_for_file(path, seek_s=seek, gen_watch=gen):
            yield chunk

        # Insert finished naturally — clear so bed resumes.
        if is_insert and generation() == gen:
            clear_insert(path=path)
            try:
                bed = current_program_path()
                if bed is not None:
                    from apps.core.services import radio as radio_svc

                    radio_svc.announce_program_file(bed)
            except Exception:
                pass
        elif generation() == gen:
            # Bed file ended — allow director to advance; brief pause.
            await asyncio.sleep(0.15)
        else:
            # Interrupted (new insert or clear) — loop immediately.
            await asyncio.sleep(0.02)

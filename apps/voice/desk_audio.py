"""Desk audio — duck levels for Ava over music (Windows).

Bed playback runs in a **subprocess** (`play_music_bed_pygame.py`) so large WAV
loads never hold the origin GIL. This module tracks the process and sends
IDLE / DUCK / STOP on stdin.

Levels (fixed):
  music idle 0.50 · music ducked 0.20 · duck lead-in 1.0s
  Voice stays on winsound helper (separate process).
"""
from __future__ import annotations

import logging
import os
import subprocess
import sys
import threading
from pathlib import Path

log = logging.getLogger("ava.desk_audio")

MUSIC_IDLE = 0.50
MUSIC_DUCKED = 0.20
VOICE_LEVEL = 0.60  # documented target; voice uses winsound (system volume)
DUCK_LEAD_S = 1.0

CREATE_NO_WINDOW = 0x08000000

_lock = threading.RLock()
_bed_proc: subprocess.Popen | None = None
_bed_path: Path | None = None
_ducked = False
_muted = False


def ensure_mixer() -> bool:
    """Compatibility no-op — bed mixer lives in the child process."""
    return True


def _helper() -> Path:
    return Path(__file__).resolve().parent / "play_music_bed_pygame.py"


def _python() -> str:
    executable = str(sys.executable)
    if os.name == "nt":
        # pythonw.exe is a launcher on this host: Popen tracks the short-lived
        # wrapper while pygame continues in its child. Use python.exe and hide
        # the console with CREATE_NO_WINDOW so the tracked PID is the player.
        separator = max(executable.rfind("/"), executable.rfind("\\"))
        if executable[separator + 1 :].lower() == "pythonw.exe":
            if "/bin/" in executable:
                executable = executable.replace("/bin/", "/Scripts\\")
                separator = executable.rfind("\\")
            return executable[: separator + 1] + "python.exe"
    current = Path(executable)
    return str(current if current.is_file() else sys.executable)


def set_ducked(ducked: bool) -> None:
    global _ducked
    with _lock:
        _ducked = bool(ducked)
        if _muted:
            _send_locked("MUTE")
        else:
            _send_locked(f"VOLUME {_speech_volume() if _ducked else _music_volume():.3f}")


def set_muted(muted: bool) -> None:
    """Silence speakers while keeping the bed process (for on-air without local)."""
    global _muted
    with _lock:
        _muted = bool(muted)
        if _muted:
            _send_locked("MUTE")
        else:
            _send_locked(f"VOLUME {_speech_volume() if _ducked else _music_volume():.3f}")


def is_ducked() -> bool:
    with _lock:
        return _ducked


def is_muted() -> bool:
    with _lock:
        return _muted


def set_bed_volume(volume: float) -> None:
    """Map approximate volume to DUCK/IDLE commands."""
    with _lock:
        if float(volume) <= (MUSIC_DUCKED + MUSIC_IDLE) / 2:
            _send_locked(f"VOLUME {min(1.0, max(0.0, float(volume))):.3f}")
        else:
            _send_locked(f"VOLUME {_music_volume():.3f}")


def _music_volume() -> float:
    try:
        from apps.core.services import radio

        return min(1.0, max(0.0, float(radio.load().get("music_volume", MUSIC_IDLE))))
    except Exception:
        return MUSIC_IDLE


def _speech_volume() -> float:
    try:
        from apps.core.services import radio

        return min(1.0, max(0.0, float(radio.load().get("speech_music_volume", MUSIC_DUCKED))))
    except Exception:
        return MUSIC_DUCKED


def _send_locked(cmd: str) -> None:
    proc = _bed_proc
    if proc is None or proc.poll() is not None:
        return
    try:
        if proc.stdin is not None:
            proc.stdin.write((cmd + "\n").encode("utf-8"))
            proc.stdin.flush()
    except Exception as e:
        log.debug("desk_audio stdin %s failed: %s", cmd, e)


def play_bed(path: Path, *, volume: float | None = None) -> bool:
    """Start bed subprocess for one track (replaces any prior)."""
    global _bed_proc, _bed_path
    path = Path(path)
    if not path.is_file():
        log.warning("desk_audio play_bed missing %s", path)
        return False
    with _lock:
        _stop_locked()
        helper = _helper()
        if not helper.is_file():
            log.warning("desk_audio helper missing %s", helper)
            return False
        kwargs: dict = {
            "stdin": subprocess.PIPE,
            "stdout": subprocess.DEVNULL,
            "stderr": subprocess.DEVNULL,
        }
        if os.name == "nt":
            kwargs["creationflags"] = CREATE_NO_WINDOW
            si = subprocess.STARTUPINFO()
            si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            si.wShowWindow = 0
            kwargs["startupinfo"] = si
        try:
            proc = subprocess.Popen(
                [_python(), str(helper), "AVA_MUSIC_BED", str(path.resolve())],
                **kwargs,
            )
        except Exception as e:
            log.warning("desk_audio spawn failed: %s", e)
            return False
        _bed_proc = proc
        _bed_path = path
        if _muted:
            _send_locked("MUTE")
        elif volume is not None:
            _send_locked(f"VOLUME {min(1.0, max(0.0, float(volume))):.3f}")
        else:
            _send_locked(f"VOLUME {_speech_volume() if _ducked else _music_volume():.3f}")
        log.info(
            "desk_audio bed play  name=%s  pid=%s  ducked=%s  muted=%s",
            path.name,
            proc.pid,
            _ducked,
            _muted,
        )
        return True


def _stop_locked() -> None:
    global _bed_proc, _bed_path
    proc = _bed_proc
    _bed_proc = None
    if proc is not None:
        try:
            if proc.poll() is None and proc.stdin is not None:
                proc.stdin.write(b"STOP\n")
                proc.stdin.flush()
        except Exception:
            pass
        try:
            if proc.poll() is None:
                proc.kill()
        except Exception:
            pass
        try:
            proc.wait(timeout=2)
        except Exception:
            pass
    _bed_path = None


def stop_bed() -> None:
    with _lock:
        _stop_locked()


def refresh_bed_busy() -> bool:
    """Poll child process; update path when dead."""
    global _bed_path
    with _lock:
        proc = _bed_proc
        if proc is None:
            return False
        if proc.poll() is not None:
            _bed_path = None
            return False
        return True


def bed_busy() -> bool:
    with _lock:
        proc = _bed_proc
        return proc is not None and proc.poll() is None


def bed_path() -> Path | None:
    with _lock:
        return _bed_path


def bed_pid() -> int | None:
    with _lock:
        proc = _bed_proc
        if proc is None or proc.poll() is not None:
            return None
        try:
            return int(proc.pid)
        except Exception:
            return None


def play_voice(path: Path, *, volume: float | None = None) -> bool:
    """Not used on AVA-CORE (winsound helper). Kept for API compatibility."""
    log.warning("desk_audio.play_voice unused — use winsound helper")
    return False


def stop_voice() -> None:
    return


def voice_busy() -> bool:
    return False


def snapshot() -> dict:
    with _lock:
        busy = _bed_proc is not None and _bed_proc.poll() is None
        pid = None
        if busy and _bed_proc is not None:
            try:
                pid = int(_bed_proc.pid)
            except Exception:
                pid = None
        return {
            "mixer": True,
            "ducked": _ducked,
            "bed_busy": busy,
            "bed_path": str(_bed_path) if _bed_path else None,
            "bed_pid": pid,
            "muted": _muted,
            "levels": {
                "music_idle": MUSIC_IDLE,
                "music_ducked": _speech_volume(),
                "music_volume": _music_volume(),
                "voice": VOICE_LEVEL,
                "duck_lead_s": DUCK_LEAD_S,
            },
        }


def status() -> dict:
    refresh_bed_busy()
    return snapshot()

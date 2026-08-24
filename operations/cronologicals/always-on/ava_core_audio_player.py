#!/usr/bin/env python3
"""
AVA Core Background Audio Player
Recursively scans CRONO_ROOT for .mp3 files.
    *.mp3            = enabled
    *.mp3.disabled   = disabled
Skips always-on and __pycache__ directories.
Plays enabled tracks sequentially in a continuous background loop.
"""
import logging, os, random, shutil, signal, subprocess, time
from pathlib import Path

CRONO_ROOT = Path("/home/ava-core/operations/cronologicals")
LOG_FILE = Path("/home/ava-core/Database/logs/ava-core-audio.log")
EXCLUDED_DIRS = {"always-on", "__pycache__"}
RESCAN_SECONDS = 5
STOP = False

LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
logging.basicConfig(
    filename=LOG_FILE, level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s %(message)s"
)
log = logging.getLogger("ava-audio")

def on_signal(signum, frame):
    global STOP
    STOP = True

signal.signal(signal.SIGTERM, on_signal)
signal.signal(signal.SIGINT, on_signal)

def find_player():
    # Each command receives a filename appended to it.
    candidates = [
        ("ffplay", ["ffplay", "-nodisp", "-autoexit", "-loglevel", "error"]),
        ("mpg123", ["mpg123", "-q"]),
        ("cvlc", ["cvlc", "--intf", "dummy", "--play-and-exit"]),
        ("vlc", ["vlc", "--intf", "dummy", "--play-and-exit"]),
    ]
    for name, cmd in candidates:
        if shutil.which(cmd[0]):
            return name, cmd
    return None, None

def audio_files():
    found = []
    if not CRONO_ROOT.exists():
        return found
    for p in CRONO_ROOT.rglob("*"):
        if not p.is_file() or any(part in EXCLUDED_DIRS for part in p.parts):
            continue
        if p.name.lower().endswith(".mp3"):
            found.append(p)
    return sorted(found, key=lambda p: str(p).lower())

def main():
    log.info("=" * 60)
    log.info("AVA CORE BACKGROUND AUDIO PLAYER STARTING")
    log.info("Watching: %s", CRONO_ROOT)
    log.info("Log: %s", LOG_FILE)
    log.info("=" * 60)

    player_name, player_cmd = find_player()
    if not player_cmd:
        log.error("No supported audio player found. Install ffplay, mpg123, or VLC.")
        while not STOP:
            time.sleep(10)
        return

    log.info("Audio backend: %s", player_name)
    last_signature = None

    while not STOP:
        tracks = audio_files()
        signature = tuple(str(p) + ":" + str(p.stat().st_mtime_ns) for p in tracks if p.exists())
        if signature != last_signature:
            last_signature = signature
            log.info("Audio scan: %d enabled MP3 file(s)", len(tracks))

        if not tracks:
            time.sleep(RESCAN_SECONDS)
            continue

        for track in tracks:
            if STOP:
                break
            # File may have been disabled/deleted after the scan.
            if not track.exists() or not track.name.lower().endswith(".mp3"):
                continue

            log.info("PLAY  %s", track)
            try:
                proc = subprocess.Popen(
                    player_cmd + [str(track)],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    start_new_session=True,
                )
                while proc.poll() is None and not STOP:
                    # Stop immediately if renamed to .disabled while playing.
                    if not track.exists():
                        try:
                            proc.terminate()
                        except Exception:
                            pass
                        break
                    time.sleep(0.5)
                if STOP and proc.poll() is None:
                    proc.terminate()
                    try:
                        proc.wait(timeout=5)
                    except Exception:
                        proc.kill()
            except Exception as e:
                log.exception("PLAY FAILED %s: %s", track, e)
                time.sleep(2)

    log.info("AVA CORE BACKGROUND AUDIO PLAYER STOPPED")

if __name__ == "__main__":
    main()

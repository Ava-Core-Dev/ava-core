"""Subprocess music bed with volume (pygame). Marker AVA_MUSIC_BED on argv.

Origin must not import pygame for the bed — loading large WAVs holds the GIL and
wedges uvicorn. This process owns the mixer; parent sends volume commands on stdin:

  IDLE  → MUSIC_IDLE (0.50)
  DUCK  → MUSIC_DUCKED (0.20)
  STOP  → stop and exit

Usage: python play_music_bed_pygame.py AVA_MUSIC_BED <path.wav>
"""
from __future__ import annotations

import sys
import threading
from pathlib import Path

MUSIC_MARKER = "AVA_MUSIC_BED"
MUSIC_IDLE = 0.50
MUSIC_DUCKED = 0.20


def main(argv: list[str]) -> int:
    if MUSIC_MARKER not in argv:
        print(f"missing marker {MUSIC_MARKER}", file=sys.stderr)
        return 2
    paths = [a for a in argv[1:] if a != MUSIC_MARKER]
    if not paths:
        print("missing audio path", file=sys.stderr)
        return 2
    path = Path(paths[-1])
    if not path.is_file():
        print(f"missing file {path}", file=sys.stderr)
        return 1

    import pygame

    pygame.mixer.init(frequency=44100, size=-16, channels=2, buffer=2048)
    try:
        pygame.mixer.music.load(str(path.resolve()))
    except Exception as e:
        print(f"load failed: {e}", file=sys.stderr)
        return 3
    vol = MUSIC_IDLE
    pygame.mixer.music.set_volume(vol)
    pygame.mixer.music.play()

    stop = threading.Event()

    def _stdin_loop() -> None:
        nonlocal vol
        while not stop.is_set():
            line = sys.stdin.readline()
            if line == "":
                stop.set()
                break
            cmd = line.strip().upper()
            if cmd == "STOP":
                stop.set()
                break
            if cmd == "MUTE":
                vol = 0.0
                pygame.mixer.music.set_volume(vol)
            elif cmd.startswith("VOLUME "):
                try:
                    vol = min(1.0, max(0.0, float(cmd.split(" ", 1)[1])))
                    pygame.mixer.music.set_volume(vol)
                except (IndexError, ValueError):
                    pass
            elif cmd == "DUCK":
                vol = MUSIC_DUCKED
                pygame.mixer.music.set_volume(vol)
            elif cmd == "IDLE":
                vol = MUSIC_IDLE
                pygame.mixer.music.set_volume(vol)

    t = threading.Thread(target=_stdin_loop, name="bed-stdin", daemon=True)
    t.start()

    while not stop.is_set():
        if not pygame.mixer.music.get_busy():
            break
        pygame.time.wait(100)

    try:
        pygame.mixer.music.stop()
    except Exception:
        pass
    stop.set()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

"""
Hourly Chime Plugin
===================
Plays a short futuristic bell at the top of every hour, then announces the
current time using the matching clip from voice/time_clips/.

Configurable via .env:
  HOURLY_CHIME=true|false          (default: true)
  HOURLY_CHIME_FILE=...            (path to mp3/wav; default: ava-core/sounds/futuristic_bell.mp3)
  HOURLY_CHIME_VOLUME=0.0-1.0      (ffplay volume, default 0.8)
  TIME_CLIPS_DIR=...               (default: ~/ava/voice/time_clips  or relative voice/time_clips)
  HOURLY_ANNOUNCE_TIME=true|false  (default: true)  – play time clip after the bell
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import time
from datetime import datetime
from pathlib import Path

from apps.voice.plugin import Plugin
from apps.core import config

log = logging.getLogger("ava.plugin.hourly_chime")

# Default sound lives next to the package
_DEFAULT_SOUND = Path(__file__).resolve().parent.parent.parent / "sounds" / "futuristic_bell.mp3"

# Candidate locations for the 48 time clips (time_HHMM.mp3)
_DEFAULT_TIME_DIRS = [
    Path.home() / "ava" / "voice" / "time_clips",
    Path(__file__).resolve().parent.parent.parent / "voice" / "time_clips",
    Path(__file__).resolve().parent.parent.parent.parent / "voice" / "time_clips",
]


class HourlyChimePlugin(Plugin):
    name = "hourly_chime"
    version = "1.1.0"
    description = "Futuristic bell + time announcement at the top of every hour"

    def on_load(self) -> None:
        enabled = os.getenv("HOURLY_CHIME", "true").lower() in {"1", "true", "yes", "on"}
        sound = Path(os.getenv("HOURLY_CHIME_FILE", str(_DEFAULT_SOUND))).expanduser()
        self.enabled = enabled
        self.sound_path = sound
        self.volume = float(os.getenv("HOURLY_CHIME_VOLUME", "0.8"))
        self.announce_time = os.getenv("HOURLY_ANNOUNCE_TIME", "true").lower() in {
            "1", "true", "yes", "on"
        }

        # Resolve time-clips directory
        env_dir = os.getenv("TIME_CLIPS_DIR")
        if env_dir:
            self.time_clips_dir = Path(env_dir).expanduser()
        else:
            self.time_clips_dir = next(
                (d for d in _DEFAULT_TIME_DIRS if d.exists()),
                _DEFAULT_TIME_DIRS[0],
            )

        if self.enabled and not self.sound_path.exists():
            log.warning("Hourly chime enabled but sound file missing: %s", self.sound_path)
        if self.announce_time and not self.time_clips_dir.exists():
            log.warning("Time clips directory missing: %s", self.time_clips_dir)

        log.info(
            "HourlyChimePlugin loaded  enabled=%s  file=%s  volume=%.2f  "
            "announce_time=%s  time_clips=%s",
            self.enabled,
            self.sound_path,
            self.volume,
            self.announce_time,
            self.time_clips_dir,
        )

    def run(self, force: bool = False, **kwargs):
        """Manual trigger (also used by --run hourly_chime)."""
        return self._play()

    def on_hour(self) -> None:
        if not self.enabled:
            return
        self._play()

    def _play(self) -> Path | None:
        """Play bell, then the matching time announcement."""
        if not self.sound_path.exists():
            log.error("Chime file not found: %s", self.sound_path)
            return None

        player = self._find_player()
        if not player:
            log.error("No audio player found (tried ffplay, aplay, paplay, play)")
            return None

        # 1) Play the bell
        log.info("Playing hourly chime: %s", self.sound_path.name)
        self._spawn_player(player, self.sound_path)

        # 2) After a short gap, play the time announcement
        if self.announce_time:
            time_clip = self._resolve_time_clip()
            if time_clip and time_clip.exists():
                # Give the bell a moment to start / finish
                time.sleep(1.8)
                log.info("Announcing time: %s", time_clip.name)
                self._spawn_player(player, time_clip)
            else:
                log.warning("No matching time clip found for current hour")

        return self.sound_path

    def _resolve_time_clip(self) -> Path | None:
        """Return path to time_HH00.mp3 for the current hour (HST / local)."""
        now = datetime.now()
        # Always use the on-the-hour clip (HH00) for the hourly chime
        name = f"time_{now.hour:02d}00.mp3"
        candidate = self.time_clips_dir / name
        if candidate.exists():
            return candidate
        # Fallback: try a couple of alternate naming styles just in case
        for alt in (f"time_{now.hour:02d}00.mp3", f"{now.hour:02d}00.mp3"):
            p = self.time_clips_dir / alt
            if p.exists():
                return p
        return None

    def _spawn_player(self, player: str, path: Path) -> None:
        """Fire-and-forget audio playback."""
        try:
            if player == "ffplay":
                cmd = [
                    "ffplay",
                    "-nodisp",
                    "-autoexit",
                    "-loglevel", "quiet",
                    "-volume", str(int(self.volume * 100)),
                    str(path),
                ]
            elif player == "aplay":
                cmd = ["aplay", "-q", str(path)]
            elif player == "paplay":
                cmd = ["paplay", str(path)]
            else:  # sox play
                cmd = ["play", "-q", "-v", str(self.volume), str(path)]

            subprocess.Popen(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
        except Exception as e:
            log.error("Failed to play %s: %s", path.name, e)

    @staticmethod
    def _find_player() -> str | None:
        for name in ("ffplay", "aplay", "paplay", "play"):
            if shutil.which(name):
                return name
        return None

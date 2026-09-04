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
_DEFAULT_SOUND = config.ASSETS_DIR / "sounds" / "futuristic_bell.mp3"

# Candidate locations for the 48 time clips (time_HHMM.mp3)
_DEFAULT_TIME_DIRS = [
    config.ASSETS_DIR / "time_clips",
    Path.home() / "Ava" / "Media" / "audio" / "time_clips",
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
        """Play one concatenated chime (bell + clock). Never stack time_HHMM.mp3."""
        from zoneinfo import ZoneInfo

        from apps.voice.local_tts import GENERATED, build_time_announcement

        player = self._find_player()
        if not player:
            log.error("No audio player found (tried ffplay, aplay, paplay, play)")
            return None

        now = datetime.now(ZoneInfo("Pacific/Honolulu"))
        hour, minute = now.hour, (0 if now.minute < 15 else 30 if now.minute < 45 else 0)
        if now.minute >= 45:
            hour = (hour + 1) % 24
        if now.minute in (0, 30):
            hour, minute = now.hour, now.minute
        dest = GENERATED / f"chime-{hour:02d}{minute:02d}.mp3"
        built = build_time_announcement(hour, minute, dest, now=now)
        if not built.get("ok"):
            log.error("Chime concat failed: %s", built)
            return None
        log.info("Playing hourly chime concat %s clips=%s", dest.name, built.get("clips"))
        self._spawn_player(player, dest)
        return dest

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

            flags = 0x08000000 if os.name == "nt" else 0
            subprocess.Popen(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
                creationflags=flags,
            )
        except Exception as e:
            log.error("Failed to play %s: %s", path.name, e)

    @staticmethod
    def _find_player() -> str | None:
        for name in ("ffplay", "aplay", "paplay", "play"):
            if shutil.which(name):
                return name
        return None

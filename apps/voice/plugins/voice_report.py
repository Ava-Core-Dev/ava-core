"""
Voice Report Plugin
===================
Wraps the Ara Grok / local clip logic so Ava Core can drive it.

Listens for:
  - new report files (on_new_report)
  - top of the hour (on_hour)

Respects VOICE_MODE from central config (grok | local | disabled).
"""

from __future__ import annotations

import logging
import shutil
import sys
from datetime import datetime
from pathlib import Path

from apps.voice.plugin import Plugin
from apps.core import config

log = logging.getLogger("ava.plugin.voice_report")

# Make sure the original voice module path is importable
_VOICE_SCRIPT = config.VOICE_DIR / "ara_grok_report.py"
if config.VOICE_DIR not in sys.path:
    sys.path.insert(0, str(config.VOICE_DIR))


class VoiceReportPlugin(Plugin):
    name = "voice_report"
    version = "1.0.0"
    description = "Combined solar + system → one Ara voice report (≤ 1 min)"

    def on_load(self) -> None:
        log.info(
            "VoiceReportPlugin loaded  mode=%s  voice_dir=%s",
            config.VOICE_MODE,
            config.VOICE_DIR,
        )

    def run(self, force: bool = False, **kwargs):
        """Generate a combined report right now."""
        return self._generate(force=force)

    def on_new_report(self, path: Path) -> None:
        # Any new solar/system/morning report triggers a fresh combined report
        name = path.name.lower()
        if any(k in name for k in ("solar", "system", "weather", "performance", "morning")):
            log.info("New relevant report → generating combined voice report")
            self._generate(force=True)

    def on_hour(self) -> None:
        log.info("Hourly tick → generating combined voice report")
        self._generate(force=True)

    # ------------------------------------------------------------------
    def _generate(self, force: bool = False):
        mode = config.VOICE_MODE
        if mode == "disabled":
            log.info("VOICE_MODE=disabled – skipping")
            return None

        # Import the functions from the existing ara_grok_report.py
        # (keeps a single source of truth for Grok / local logic)
        try:
            import ara_grok_report as voice
        except ImportError as e:
            log.error(
                "Could not import ara_grok_report from %s – is it installed? %s",
                config.VOICE_DIR,
                e,
            )
            return None

        # Override the module-level paths/mode so it respects central config
        voice.REPORTS_DIR = config.REPORTS_DIR
        voice.VOICE_DIR = config.VOICE_DIR
        voice.GENERATED_DIR = config.GENERATED_DIR
        voice.VOICE_MODE = mode
        voice.XAI_API_KEY = config.XAI_API_KEY
        voice.GROK_MODEL = config.GROK_MODEL
        voice.TTS_VOICE = config.TTS_VOICE
        voice.MAX_SECONDS = config.MAX_SECONDS

        solar, system = voice.get_two_reports()
        if not solar and not system:
            log.warning("No solar or system reports found")
            return None

        log.info(
            "Generating voice report  mode=%s  solar=%s  system=%s",
            mode,
            solar.name if solar else None,
            system.name if system else None,
        )
        result = voice.generate(solar, system, force=force)
        if result:
            log.info("Voice report ready: %s", result)
            # Auto-convert the current MP3 → MP4 into ava-core/mp4/
            try:
                from ava_core.mp4_converter import convert_if_needed
                mp4 = convert_if_needed(result)
                if mp4:
                    log.info("MP4 ready: %s", mp4)
            except Exception as e:
                log.warning("MP4 conversion skipped: %s", e)
        return result

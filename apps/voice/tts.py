"""
TTS facade — tries local clip engine first, falls back to xAI Ara TTS.
Clips are used for deterministic content (time, numbers, status phrases).
xAI TTS is used only for dynamic natural-language summaries.
"""

from __future__ import annotations

import logging
from pathlib import Path

from apps.core import config
from apps.core.services import xai as xai_client

log = logging.getLogger("ava.tts")


def synthesize(text: str, out_path: Path, *, force_grok: bool = False) -> Path | None:
    """
    Generate speech for text. Returns out_path on success, None on failure.
    - mode=local: clip engine only (no API)
    - mode=grok: xAI TTS (falls back to local on failure)
    - mode=disabled: no-op
    """
    mode = config.VOICE_MODE

    if mode == "disabled":
        return None

    if mode == "grok" or force_grok:
        try:
            return xai_client.tts(text, out_path)
        except xai_client.XAIError as e:
            log.warning("xAI TTS failed, trying local: %s", e)

    # Local clip fallback
    try:
        from .clips import speak_text
        return speak_text(text, out_path)
    except Exception as e:
        log.error("Local TTS also failed: %s", e)
        return None

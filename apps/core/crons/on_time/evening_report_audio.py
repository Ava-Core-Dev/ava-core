"""Evening report audio — play operator-selected MP3 (no TTS spend).

Text evening long-form may still be local/slot reports elsewhere. This job only
handles scheduled desk playback of a manually chosen evening file.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

log = logging.getLogger("ava.cron.evening_report_audio")


async def run():
    log.info("Evening report audio  %s", datetime.now(timezone.utc).isoformat())
    from apps.core.services import report_audio_manual

    play = await report_audio_manual.play_scheduled("evening")
    log.info("evening manual play=%s", play)
    return {"ok": True, "play": play}

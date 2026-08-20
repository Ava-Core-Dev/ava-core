"""
Half-hourly time chime — :00 and :30 HST.
Plays futuristic_bell.mp3 then the matching time_HHMM.mp3 clip
(all 48 clips: time_0000 … time_2330) through the Stream Director
so audio hits both desktop speakers and OBS.
"""

from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from apps.core import config

log = logging.getLogger("ava.cron.hourly_chime")

HST = ZoneInfo("Pacific/Honolulu")
BELL = config.ASSETS_DIR / "sounds" / "futuristic_bell.mp3"
TIME_DIR = config.ASSETS_DIR / "time_clips"


def _time_clip(hour: int, minute: int) -> Path | None:
    name = f"time_{hour:02d}{minute:02d}.mp3"
    p = TIME_DIR / name
    return p if p.exists() else None


async def run() -> None:
    from apps.voice.director import get_director, Priority

    now = datetime.now(HST)
    # Cron fires at :00 and :30 — use that exact slot
    hour, minute = now.hour, (0 if now.minute < 15 else 30 if now.minute < 45 else 0)
    if now.minute >= 45:
        hour = (hour + 1) % 24
    if now.minute in (0, 30):
        hour, minute = now.hour, now.minute

    director = get_director()

    if BELL.exists():
        await director.queue(
            BELL,
            name="chime",
            priority=Priority.SCHEDULED,
            scene=None,
        )
        log.info("Queued chime bell")
    else:
        log.warning("Bell missing: %s", BELL)

    clip = _time_clip(hour, minute)
    if clip:
        await director.queue(
            clip,
            name=f"time_{hour:02d}{minute:02d}",
            priority=Priority.SCHEDULED,
            scene=None,
        )
        log.info("Queued time announcement: %s", clip.name)
    else:
        log.warning("No time clip for %02d:%02d — expected %s",
                    hour, minute, TIME_DIR / f"time_{hour:02d}{minute:02d}.mp3")

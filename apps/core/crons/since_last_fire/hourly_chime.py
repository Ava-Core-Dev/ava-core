"""
Half-hourly time chime — :00 and :30 HST.
Concatenates bell + hour + am/pm + Hawaiian Standard Time into one MP3,
then plays windowless through the Stream Director. No weekday, no calendar date.
Does not use old time_HHMM.mp3 files (those already contain AM/PM/HST).
"""

from __future__ import annotations

import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from apps.core import config
from apps.voice.local_tts import GENERATED, build_time_announcement

log = logging.getLogger("ava.cron.hourly_chime")

HST = ZoneInfo("Pacific/Honolulu")


async def run() -> None:
    from apps.voice.director import Priority, get_director

    now = datetime.now(HST)
    hour, minute = now.hour, (0 if now.minute < 15 else 30 if now.minute < 45 else 0)
    if now.minute >= 45:
        hour = (hour + 1) % 24
    if now.minute in (0, 30):
        hour, minute = now.hour, now.minute

    dest = GENERATED / f"chime-{hour:02d}{minute:02d}.mp3"
    built = build_time_announcement(hour, minute, dest, now=now)
    if not built.get("ok"):
        log.warning("Chime concat failed: %s", built)
        return
    director = get_director()
    await director.queue(
        dest,
        name=f"chime_{hour:02d}{minute:02d}",
        priority=Priority.SCHEDULED,
        scene=None,
    )
    log.info("Queued concatenated chime %s clips=%s", dest.name, built.get("clips"))

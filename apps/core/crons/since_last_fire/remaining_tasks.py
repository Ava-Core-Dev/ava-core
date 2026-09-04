"""Every :30 HST: remaining clocked work in the next 4 hours, plus drafts you must approve.

Does not list interval jobs. Does not play items more than 4 hours ahead.
Uses local clips only. Missing phrase files are skipped, not invented by Grok.
"""
from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from apps.voice.local_tts import GENERATED, speak_script

log = logging.getLogger("ava.cron.remaining_tasks")
HST = ZoneInfo("Pacific/Honolulu")
MAX_SPOKEN = 8


def _script(items: list[dict], _now: datetime) -> str:
    # No clock_tokens — time-chime already speaks the clock at :30.
    bits: list[str] = []
    lead = "phrase_remaining_tasks"
    from apps.voice.clips import _find_clip

    if _find_clip(lead):
        bits.append(lead)
    else:
        bits += ["remaining", "tasks"]
    spoken = 0
    for row in items:
        if spoken >= MAX_SPOKEN:
            break
        phrase = str(row.get("phrase") or "").strip()
        if not phrase:
            continue
        if _find_clip(phrase):
            bits.append(phrase)
            spoken += 1
    return " ".join(bits)


async def run() -> dict:
    from apps.core.services import day_board
    from apps.voice.director import Priority, get_director

    now = datetime.now(HST)
    board = day_board.remaining(now=now)
    items = list(board.get("items") or [])
    dest_txt = Path(GENERATED) / "remaining-tasks-current.txt"
    dest_txt.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        f"{now.isoformat()}",
        f"horizon {board.get('horizon')}",
        "",
    ]
    for row in items:
        flag = "MANUAL" if row.get("manual") else "auto"
        lines.append(f"{flag}\t{row.get('hour'):02d}:{int(row.get('minute') or 0):02d}\t{row.get('label')}")
    dest_txt.write_text("\n".join(lines) + "\n", encoding="utf-8")

    if not items:
        log.info("remaining tasks: clear window")
        return {"ok": True, "items": 0, "played": False}

    script = _script(items, now)
    dest = Path(GENERATED) / f"remaining-{now.strftime('%H%M')}.mp3"
    built = speak_script(script, dest)
    built["script"] = script
    if not built.get("ok"):
        log.info("remaining tasks concat skipped missing=%s", built.get("missing"))
        return {"ok": True, "items": len(items), "played": False, "built": built, "path": str(dest_txt)}

    latest = Path(GENERATED) / "remaining-tasks-current.mp3"
    try:
        import shutil

        shutil.copy2(dest, latest)
    except OSError:
        pass
    director = get_director()
    await director.queue(dest, name="remaining_tasks", priority=Priority.SCHEDULED, scene=None)
    log.info("remaining tasks queued n=%s clips=%s", len(items), built.get("clips"))
    return {
        "ok": True,
        "items": len(items),
        "manual": len(board.get("manual") or []),
        "played": True,
        "script": script,
        "missing": built.get("missing") or [],
    }

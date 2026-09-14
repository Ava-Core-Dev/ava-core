"""Write a public report: Grok first, Cursor only if Grok is down, else facts.

Cursor is rate-limited (2×/day). Callers must still publish the factual
excerpt immediately so Kīlauea cannot go silent for days.
"""

from __future__ import annotations

import hashlib
import logging

from . import cursor_fallback, xai

log = logging.getLogger("ava.synth")


def source_hash(*parts: str) -> str:
    blob = "\n".join(parts).encode()
    return hashlib.sha256(blob).hexdigest()[:16]


def polish(kind: str, system: str, user: str, *, factual: str, channel: str | None = None) -> str:
    """Return Grok/Cursor prose if cheaply available, else the factual text."""
    h = source_hash(kind, user)
    grok = xai.try_chat(
        [{"role": "system", "content": system}, {"role": "user", "content": user}],
        max_tokens=400,
    )
    if grok:
        return grok
    cursor_fallback.enqueue(kind, system, user, source_hash=h, channel=channel)
    log.info("%s: Grok missed — queued Cursor, posting facts now", kind)
    return factual

"""Cursor ask-mode fallback when Grok is out of credits.

Hard caps: 2 jobs/day, 6 hours between jobs, one job per source hash.
Ask mode is read-only — we pass the source text in and take stdout.
This is not a scan loop.
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from .. import config

log = logging.getLogger("ava.cursor_fallback")
HST = ZoneInfo("Pacific/Honolulu")
_REPO = Path(__file__).resolve().parent.parent.parent.parent


def _queue_path() -> Path:
    return config.DATA_DIR / "state" / "cursor-fallback-queue.json"


def _budget_path() -> Path:
    return config.DATA_DIR / "state" / "cursor-fallback.json"


def _load(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError:
        return default


def _save(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n")


def enqueue(kind: str, system: str, user: str, *, source_hash: str, channel: str | None = None) -> None:
    """Remember one missing Grok function. Deduped by kind+hash."""
    q = _load(_queue_path(), {"jobs": []})
    jobs = [j for j in q.get("jobs") or [] if not (j.get("kind") == kind and j.get("hash") == source_hash)]
    jobs.append({
        "kind": kind,
        "hash": source_hash,
        "system": system[:1500],
        "user": user[:6000],
        "channel": channel,
        "queued_at": datetime.now(timezone.utc).isoformat(),
    })
    # Keep the newest few only — never a scan backlog
    q["jobs"] = jobs[-8:]
    _save(_queue_path(), q)
    log.info("queued cursor fallback  kind=%s hash=%s", kind, source_hash[:12])


def pending() -> list[dict[str, Any]]:
    return list((_load(_queue_path(), {"jobs": []}).get("jobs") or []))


def _budget_ok() -> bool:
    st = _load(_budget_path(), {})
    today = datetime.now(HST).strftime("%Y-%m-%d")
    if st.get("date") != today:
        return True
    if int(st.get("count") or 0) >= max(1, config.CURSOR_MAX_PER_DAY):
        return False
    last = st.get("last_at")
    if last:
        try:
            last_dt = datetime.fromisoformat(last)
            if datetime.now(timezone.utc) - last_dt < timedelta(hours=max(1, config.CURSOR_MIN_HOURS)):
                return False
        except ValueError:
            pass
    return True


def _note_run() -> None:
    today = datetime.now(HST).strftime("%Y-%m-%d")
    st = _load(_budget_path(), {})
    count = int(st.get("count") or 0) + 1 if st.get("date") == today else 1
    _save(_budget_path(), {
        "date": today,
        "count": count,
        "last_at": datetime.now(timezone.utc).isoformat(),
    })


def _pop(kind: str, source_hash: str) -> None:
    q = _load(_queue_path(), {"jobs": []})
    q["jobs"] = [j for j in q.get("jobs") or [] if not (j.get("kind") == kind and j.get("hash") == source_hash)]
    _save(_queue_path(), q)


def ask(system: str, user: str) -> str | None:
    """One-shot Cursor ask. No repo scan instruction. Returns text or None."""
    if not config.CURSOR_FALLBACK or not config.CURSOR_API_KEY:
        return None
    if not _budget_ok():
        log.info("cursor fallback skipped — daily/min-interval budget")
        return None
    prompt = (
        f"{system.strip()}\n\n"
        "Use only the source text below. Do not search the repository. "
        "Do not call tools. Reply with the report text only.\n\n"
        f"{user.strip()}"
    )
    cmd = [
        "cursor", "agent", "-p",
        "--mode", "ask",
        "--output-format", "text",
        "--model", "composer-2.5",
        prompt,
    ]
    env = os.environ.copy()
    env["CURSOR_API_KEY"] = config.CURSOR_API_KEY
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(_REPO),
            env=env,
            capture_output=True,
            text=True,
            timeout=180,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired) as e:
        log.warning("cursor agent failed to start: %s", e)
        return None
    _note_run()
    text = (proc.stdout or "").strip()
    if proc.returncode != 0 or not text:
        log.warning("cursor agent rc=%s stderr=%s", proc.returncode, (proc.stderr or "")[:300])
        return None
    # Drop any leading CLI chrome
    lines = [ln for ln in text.splitlines() if not ln.startswith("Cursor ") or len(ln) > 40]
    out = "\n".join(lines).strip()
    return out[:4000] if out else None


def drain_one() -> dict[str, Any] | None:
    """Run at most one queued job. Prefer kilauea, then morning/summary."""
    jobs = pending()
    if not jobs:
        return None
    order = {"kilauea": 0, "summary": 1, "morning": 2}
    jobs.sort(key=lambda j: order.get(j.get("kind") or "", 9))
    job = jobs[0]
    text = ask(job.get("system") or "", job.get("user") or "")
    _pop(job.get("kind") or "", job.get("hash") or "")
    if not text:
        return None
    return {**job, "text": text}

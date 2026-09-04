"""Fan-out for public Ava reports (channels + subscriber DMs).

Use this for morning / solar / weather / Kīlauea.
Do not use this for operator-only or development messages.
"""
from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from .. import config
from . import discord, subscribers, telegram

log = logging.getLogger("ava.reports")

HST = ZoneInfo("Pacific/Honolulu")

# Public report kinds subscribers opted into. Everything else stays off the list.
PUBLIC_KINDS = {"morning", "summary", "solar", "weather", "kilauea"}

CURRENT_MD_NAME = "morning-report-current.md"
QUEUE_DIR_NAME = "queue"
_REPORT_JOBS = (
    ("day-reports-morning", "Morning slot reports", "10:00 HST"),
    ("morning-report", "Morning report", "10:00 HST"),
    ("merged-morning-summary", "Merged morning summary", "10:05 HST"),
    ("day-reports-midday", "Midday slot reports", "13:00 HST"),
    ("economy-brief", "Economy brief", "15:00 HST"),
    ("day-reports-evening", "Evening slot reports", "18:00 HST"),
    ("adsense-eod", "AdSense EOD close", "21:00 HST (+ boot)"),
    ("admob-eod", "AdMob EOD close", "21:05 HST (+ boot)"),
    ("overnight-relay", "Late-night relay", "overnight"),
    ("remaining-tasks", "Remaining tasks", "every :30 · next 4h"),
)


def latest_report(pattern: str) -> Path | None:
    """Newest non-empty markdown in REPORTS_DIR. Empty stubs must not win."""
    files = [
        p
        for p in config.REPORTS_DIR.glob(pattern)
        if p.is_file() and p.stat().st_size > 0
    ]
    if not files:
        return None
    return max(files, key=lambda p: p.stat().st_mtime)


def current_md_path() -> Path:
    return config.REPORTS_DIR / CURRENT_MD_NAME


def queue_dir() -> Path:
    p = config.REPORTS_DIR / QUEUE_DIR_NAME
    p.mkdir(parents=True, exist_ok=True)
    return p


def _hst_now() -> datetime:
    return datetime.now(HST)


def _file_info(path: Path, *, kind: str = "") -> dict:
    st = path.stat()
    rel = str(path)
    try:
        rel = str(path.relative_to(config.MEDIA_DIR))
    except ValueError:
        pass
    return {
        "name": path.name,
        "label": path.name,
        "path": str(path),
        "rel": rel,
        "kind": kind or ("current" if "current" in path.name.lower() else "report"),
        "dir": path.is_dir(),
        "mtimeMs": int(st.st_mtime * 1000),
        "size": st.st_size if path.is_file() else 0,
    }


def read_current() -> dict:
    """Latest written daily report (current pointer, else newest morning-*.md)."""
    config.REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    path = current_md_path()
    if not path.exists():
        dated = sorted(
            config.REPORTS_DIR.glob("morning-*.md"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        path = dated[0] if dated else None
    if not path or not path.exists():
        return {"ok": True, "exists": False, "text": "", "path": str(current_md_path())}
    text = path.read_text(encoding="utf-8", errors="replace")
    st = path.stat()
    return {
        "ok": True,
        "exists": True,
        "text": text,
        "path": str(path),
        "name": path.name,
        "mtimeMs": int(st.st_mtime * 1000),
        "bytes": st.st_size,
        "current": path.name == CURRENT_MD_NAME,
    }


def write_current(text: str, *, kind: str = "summary", source: str = "manual") -> dict:
    """Write the dated archive + morning-report-current.md. No model calls."""
    body = str(text or "").strip()
    if not body:
        return {"ok": False, "detail": "empty"}
    kind = str(kind or "summary").strip().lower()
    if kind not in PUBLIC_KINDS:
        kind = "summary"
    now = _hst_now()
    stamp = now.strftime("%Y-%m-%d %H:%M HST")
    day = now.strftime("%Y-%m-%d")
    header = {
        "morning": "Ava morning report",
        "summary": "Ava morning summary",
        "solar": "Ava solar + weather",
        "weather": "Ava weather alert",
        "kilauea": "Ava Kīlauea report",
    }.get(kind, "Ava report")
    if not body.lower().lstrip().startswith("**"):
        body = f"**{header}** — {stamp}\n\n{body}"
    config.REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    dated = config.REPORTS_DIR / f"morning-{day}.md"
    current = current_md_path()
    dated.write_text(body + "\n", encoding="utf-8")
    current.write_text(body + "\n", encoding="utf-8")
    log.info("current report written source=%s kind=%s file=%s", source, kind, current.name)
    return {
        "ok": True,
        "kind": kind,
        "source": source,
        "day": day,
        "stamp": stamp,
        "text": body,
        "dated": str(dated),
        "current": str(current),
    }


def status_board() -> dict:
    """Desktop Reports page: due jobs + generated markdown, including current."""
    now = _hst_now()
    current = read_current()
    generated: list[dict] = []
    cur_path = current_md_path()
    if cur_path.exists():
        generated.append(_file_info(cur_path, kind="current"))
    files = [
        p
        for p in config.REPORTS_DIR.glob("*.md")
        if p.is_file() and p.name != CURRENT_MD_NAME
    ]
    files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    for p in files[:48]:
        generated.append(_file_info(p))

    due_today = []
    recurring = []
    sched = None
    try:
        from ..scheduler import get_scheduler
        sched = get_scheduler()
    except Exception:
        sched = None
    jobs = {j["id"]: j for j in (sched.get_jobs() if sched else [])}
    current_done = False
    if current.get("exists") and current.get("mtimeMs"):
        m = datetime.fromtimestamp(current["mtimeMs"] / 1000, tz=HST)
        current_done = m.date() == now.date()

    for job_id, label, when in _REPORT_JOBS:
        job = jobs.get(job_id) or {}
        next_run = job.get("next_run")
        next_at = 0
        if next_run:
            try:
                next_at = int(datetime.fromisoformat(next_run).timestamp() * 1000)
            except ValueError:
                next_at = 0
        row = {
            "id": job_id,
            "label": label,
            "when": when,
            "nextAt": next_at,
            "done": bool(current_done and job_id in {"morning-report", "merged-morning-summary"}),
            "status": "done" if (current_done and job_id in {"morning-report", "merged-morning-summary"}) else "upcoming",
        }
        due_today.append(row)
        recurring.append({**row, "lastKey": current.get("name") or "", "lastAt": current.get("mtimeMs") or 0})

    return {
        "ok": True,
        "hstDay": now.strftime("%Y-%m-%d"),
        "asleep": False,
        "current": current,
        "dueToday": due_today,
        "recurring": recurring,
        "generated": generated,
    }


def queue_public_draft(kind: str, text: str, *, source: str = "cron") -> dict:
    """Store a public report draft for operator review."""
    kind = str(kind or "summary").strip().lower()
    if kind not in PUBLIC_KINDS:
        kind = "summary"
    body = str(text or "").strip()
    if not body:
        return {"ok": False, "detail": "empty"}
    now = _hst_now()
    stamp = now.strftime("%Y-%m-%d %H:%M HST")
    name = f"{now.strftime('%Y-%m-%dT%H%M%S')}-{kind}-{source}.md"
    path = queue_dir() / name
    if not body.lower().lstrip().startswith("**"):
        body = f"**Ava {kind} report** — {stamp}\n\n{body}"
    path.write_text(body + "\n", encoding="utf-8")
    return {
        "ok": True,
        "kind": kind,
        "source": source,
        "name": name,
        "path": str(path),
        "stamp": stamp,
    }


def list_queue() -> dict:
    qd = queue_dir()
    rows = []
    for p in sorted(qd.glob("*.md"), key=lambda x: x.stat().st_mtime, reverse=True):
        st = p.stat()
        rows.append(
            {
                "name": p.name,
                "path": str(p),
                "mtimeMs": int(st.st_mtime * 1000),
                "bytes": st.st_size,
            }
        )
    return {"ok": True, "count": len(rows), "items": rows}


async def publish_queued(name: str, *, channel: str | None = None) -> dict:
    q = queue_dir() / str(name or "").strip()
    if not q.exists() or not q.is_file():
        return {"ok": False, "detail": "not_found", "name": name}
    text = q.read_text(encoding="utf-8", errors="replace").strip()
    k = "summary"
    for candidate in sorted(PUBLIC_KINDS):
        if f"-{candidate}-" in q.name:
            k = candidate
            break
    posted = await publish(k, text, channel=channel or "ava_home")
    if posted.get("ok"):
        write_current(text, kind=k, source="queued")
        done_dir = queue_dir() / "published"
        done_dir.mkdir(parents=True, exist_ok=True)
        q.rename(done_dir / q.name)
    return {"ok": bool(posted.get("ok")), "posted": posted, "kind": k, "name": q.name}


async def publish(
    kind: str,
    text: str,
    *,
    channel: str | None = "automations",
) -> dict:
    """Post a public report to a Discord channel (optional) and every subscriber DM."""
    kind = str(kind or "").strip().lower()
    body = str(text or "").strip()
    result = {"ok": True, "kind": kind, "channel": False, "dms": 0, "failed": 0}
    if kind not in PUBLIC_KINDS:
        log.warning("refusing non-public report kind %r", kind)
        return {"ok": False, "detail": "not_a_public_report", **result}
    if not body:
        return {"ok": False, "detail": "empty", **result}

    header = {
        "morning": "Ava morning report",
        "summary": "Ava morning summary",
        "solar": "Ava solar + weather",
        "weather": "Ava weather alert",
        "kilauea": "Ava Kīlauea report",
    }.get(kind, "Ava report")
    dm_text = body if body.lower().startswith("**ava") else f"**{header}**\n\n{body}"

    if channel:
        ch_id = config.DISCORD_CHANNELS.get("ava_home") or config.DISCORD_CHANNELS.get(channel, channel)
        if ch_id:
            posted = await discord.post_message(ch_id, body[:1900])
            result["channel"] = bool(posted)

    for row in subscribers.list_all():
        if not subscribers.wants_reports(row):
            continue
        surface = str(row.get("surface") or "")
        sid = str(row.get("id") or "")
        try:
            sent = None
            if surface == "telegram":
                sent = await telegram.send_message(sid, dm_text)
            elif surface == "discord":
                sent = await discord.send_dm(sid, dm_text[:1900])
            if sent:
                result["dms"] += 1
            else:
                result["failed"] += 1
        except Exception as e:
            result["failed"] += 1
            log.warning("report DM %s:%s failed: %s", surface, sid, e)

    log.info(
        "report %s channel=%s dms=%s failed=%s",
        kind, result["channel"], result["dms"], result["failed"],
    )
    return result


async def submit_manual(
    text: str,
    *,
    kind: str = "summary",
    post: bool = True,
) -> dict:
    """Operator paste → current markdown + optional Discord/#updates fan-out.

    Does not call Grok or Cursor. TTS/MP4 is not required for the text current file.
    """
    written = write_current(text, kind=kind, source="manual")
    if not written.get("ok"):
        return written
    kind = written["kind"]
    body = written["text"]
    channel = "ava_home"
    posted = {"ok": True, "skipped": True}
    if post:
        posted = await publish(kind, body, channel=channel)
    return {
        **written,
        "posted": posted,
        "channel": channel if post else None,
    }

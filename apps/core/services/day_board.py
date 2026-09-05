"""Daily task board: what must fire, when reports land, what's left in 1 hour.

Clock times are HST. Interval jobs keep running; remaining-task voice only
lists clocked reports within the hour, plus any failed/due daily reports,
and operator leftovers. Does not call cloud text APIs.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from apps.core import config

log = logging.getLogger("ava.day_board")
HST = ZoneInfo("Pacific/Honolulu")

LOOKAHEAD_H = 1
STATE_PATH = config.DATA_DIR / "state" / "day-board.json"
REMAINING_PATH = config.DATA_DIR / "state" / "remaining-tasks.json"

# One function per (kind, slot). Spoken clip name = function name.
REPORT_KINDS = (
    "solar",
    "weather",
    "kilauea",
    "host",
    "economy",
    "adsense",
    "admob",
    "finance",
    "governance",
    "identity",
    "community",
)
SLOTS = ("morning", "midday", "evening")
SLOT_HOUR = {"morning": 10, "midday": 13, "evening": 18}

# Always-on / interval — must keep running. Not spoken on the :30s.
MUST_FIRE_INTERVAL = (
    {"id": "heartbeat", "every": "60s", "manual": False, "note": "Cloudflare standby ping"},
    {"id": "ecoflow-quota", "every": "2m", "manual": False, "note": "Pack watts and percent"},
    {"id": "host-sample", "every": "1m", "manual": False, "note": "CPU RAM for the desk"},
    {"id": "kilauea-cams", "every": "5m", "manual": False, "note": "V1 V2 V3 stills"},
    {"id": "d1-sync", "every": "6h", "manual": False, "note": "MySQL to D1 cache (throttled)"},
    {"id": "inbox-drain", "every": "5m", "manual": False, "note": "Offline inbox to local"},
    {"id": "vercel-builds", "every": "5m", "manual": False, "note": "Build logs to docs"},
    {"id": "nhc-media", "every": "10m", "manual": False, "note": "EPAC and CPAC maps"},
    {"id": "hurricane-tracker", "every": "15m", "manual": False, "note": "Storm slides"},
    {"id": "broadcast-loop", "every": "20s", "manual": False, "note": "OBS daily loop"},
    {"id": "minecraft-live", "every": "45s", "manual": False, "note": "In-game detect"},
    {"id": "player-economy", "every": "30m", "manual": False, "note": "Gold snapshot"},
    {"id": "stripe-poll", "every": "30m", "manual": False, "note": "Stripe desk snapshot"},
    {"id": "user-qrcodes", "every": "6h", "manual": False, "note": "QR backfill"},
    {"id": "account-import", "every": "6h", "manual": False, "note": "Identity import"},
)

# Top of hour — auto. Hourly clip reports already speak solar/weather/kilauea/host.
MUST_FIRE_HOURLY = (
    {"id": "rr-noaa", "when": ":00", "manual": False, "note": "NOAA weather"},
    {"id": "nws-hawaii-counties", "when": "every 15m", "manual": False, "note": "NWS Hawaii by county (hash-gated)"},
    {"id": "rr-kilauea", "when": ":00", "manual": False, "note": "Kīlauea hash"},
    {"id": "hourly-solar-weather", "when": ":00", "manual": False, "note": "Solar plus weather file"},
    {"id": "system-performance", "when": ":00", "manual": False, "note": "Host performance file"},
    {"id": "hourly-clip-reports", "when": ":00", "manual": False, "note": "Play hourly clip packs"},
    {"id": "hourly-clip-prebuild", "when": ":55", "manual": False, "note": "Build next hour clips"},
    {"id": "time-chime", "when": ":00 and :30", "manual": False, "note": "Bell plus clock"},
)

# Named daily clock jobs (HST). remaining-tasks speaks these if due within 1h.
CLOCK_JOBS = (
    {
        "id": "day-reports-morning",
        "label": "Morning slot reports",
        "hour": 10,
        "minute": 0,
        "manual": False,
        "phrase": "phrase_morning_slot",
        "note": "All morning_* functions",
    },
    {
        "id": "morning-report",
        "label": "Long-form morning report",
        "hour": 10,
        "minute": 0,
        "manual": True,
        "phrase": "phrase_morning_report",
        "note": "Drafts for you to approve",
    },
    {
        "id": "merged-morning-summary",
        "label": "Merged morning summary",
        "hour": 10,
        "minute": 5,
        "manual": True,
        "phrase": "phrase_merged_morning",
        "note": "Drafts for you to approve",
    },
    {
        "id": "governance-daily",
        "label": "Governance daily",
        "hour": 10,
        "minute": 8,
        "manual": False,
        "phrase": "phrase_governance_daily",
        "note": "Off until the desk switch is on",
    },
    {
        "id": "api-prices",
        "label": "API price catalog",
        "hour": 10,
        "minute": 10,
        "manual": False,
        "phrase": "phrase_api_prices",
        "note": "Public list prices, no spend",
    },
    {
        "id": "cursor-fallback-am",
        "label": "Cursor report drain",
        "hour": 10,
        "minute": 12,
        "manual": False,
        "phrase": "phrase_cursor_fallback",
        "note": "Only if the queue has a job",
    },
    {
        "id": "midday-report",
        "label": "Midday status (noon)",
        "hour": 11,
        "minute": 55,
        "manual": True,
        "phrase": "phrase_midday_report",
        "note": "Prebuild at 11:55; presents as 12 noon. Text first; Ara later",
    },
    {
        "id": "day-reports-midday",
        "label": "Midday slot reports",
        "hour": 13,
        "minute": 0,
        "manual": False,
        "phrase": "phrase_midday_slot",
        "note": "All midday_* functions",
    },
    {
        "id": "economy-brief",
        "label": "Economy brief",
        "hour": 15,
        "minute": 0,
        "manual": False,
        "phrase": "phrase_economy_brief",
        "note": "RootMC gold snapshot",
    },
    {
        "id": "cursor-fallback-pm",
        "label": "Cursor report drain",
        "hour": 16,
        "minute": 12,
        "manual": False,
        "phrase": "phrase_cursor_fallback",
        "note": "Only if the queue has a job",
    },
    {
        "id": "day-reports-evening",
        "label": "Evening slot reports",
        "hour": 18,
        "minute": 0,
        "manual": False,
        "phrase": "phrase_evening_slot",
        "note": "All evening_* functions",
    },
    {
        "id": "adsense-eod",
        "label": "AdSense end of day",
        "hour": 21,
        "minute": 0,
        "manual": False,
        "phrase": "phrase_adsense_eod",
        "note": "Close report plus Discord",
    },
    {
        "id": "admob-eod",
        "label": "AdMob end of day",
        "hour": 21,
        "minute": 5,
        "manual": False,
        "phrase": "phrase_admob_eod",
        "note": "Close report plus Discord",
    },
    {
        "id": "log-cleanup",
        "label": "Log cleanup",
        "hour": 4,
        "minute": 20,
        "manual": False,
        "phrase": "phrase_log_cleanup",
        "note": "Delete logs older than 7 days",
    },
)

BOOT_JOBS = (
    {"id": "startup-voice", "manual": False, "note": "Reconnect or all-systems clip"},
    {"id": "adsense-boot", "manual": False, "note": "AdSense boot report"},
    {"id": "admob-boot", "manual": False, "note": "AdMob boot report"},
    {"id": "account-import-boot", "manual": False, "note": "Identity import"},
    {"id": "governance-boot", "manual": False, "note": "Governance snapshot, no self-update"},
    {"id": "api-prices-boot", "manual": False, "note": "Price catalog at start"},
    {
        "id": "boot-prelims",
        "manual": False,
        "note": "NOAA + Kīlauea + morning Boot Report before day-board (no Grok)",
    },
    {
        "id": "day-board-boot",
        "manual": False,
        "note": "Morning slots after prelims if origin starts before noon",
    },
)

EVENT_PHRASES = (
    {"id": "phrase_new_guest", "when": "A new unsigned visitor talks on public Ava chat"},
    {"id": "phrase_guest_limit", "when": "That guest used three live replies today"},
    {"id": "phrase_origin_up", "when": "Origin is back after a real gap — already phrase_all_systems_running"},
    {"id": "phrase_satellite", "when": "Short flap under a minute — already satellite_connection"},
    {"id": "phrase_looker", "when": "Looker actually captioned a still"},
    {"id": "phrase_ecoflow_down", "when": "EcoFlow sample is DOWN"},
    {"id": "phrase_manual_drafts", "when": "Public report drafts are waiting for you"},
    {"id": "phrase_remaining_tasks", "when": "Lead-in for the :30 remaining-task brief"},
    {"id": "phrase_clear_window", "when": "Nothing left in the next four hours and no drafts"},
    {"id": "phrase_midday_report", "when": "Long-form midday status due (11:55 → noon)"},
)


def hst_now() -> datetime:
    return datetime.now(HST)


def today() -> str:
    return hst_now().strftime("%Y-%m-%d")


def _load() -> dict:
    if not STATE_PATH.is_file():
        return {"day": today(), "fired": {}, "slots": {}}
    try:
        data = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {"day": today(), "fired": {}, "slots": {}}
    if data.get("day") != today():
        return {"day": today(), "fired": {}, "slots": {}}
    data.setdefault("fired", {})
    data.setdefault("slots", {})
    return data


def _save(data: dict) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    data["updated"] = hst_now().isoformat()
    STATE_PATH.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def slot_key(kind: str, slot: str) -> str:
    return f"{slot}_{kind}"


def fired_today(kind: str, slot: str) -> bool:
    data = _load()
    return bool((data.get("fired") or {}).get(slot_key(kind, slot)))


def mark_fired(kind: str, slot: str, *, extra: dict | None = None) -> None:
    data = _load()
    row = {"at": hst_now().isoformat()}
    if extra:
        row.update(extra)
    data["fired"][slot_key(kind, slot)] = row
    slots = data.setdefault("slots", {})
    kinds = slots.setdefault(slot, [])
    if kind not in kinds:
        kinds.append(kind)
    _save(data)


def mark_job(job_id: str) -> None:
    data = _load()
    jobs = data.setdefault("jobs", {})
    jobs[job_id] = {"at": hst_now().isoformat()}
    _save(data)


def job_fired_today(job_id: str) -> bool:
    data = _load()
    return bool((data.get("jobs") or {}).get(job_id))


def pending_drafts() -> list[dict]:
    try:
        from apps.core.services import reports

        items = (reports.list_queue() or {}).get("items") or []
        return [x for x in items if x.get("name")]
    except Exception:
        return []


def _due_dt(hour: int, minute: int, now: datetime) -> datetime:
    due = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if due + timedelta(minutes=2) < now:
        due = due + timedelta(days=1)
    return due


def remaining(*, lookahead_h: int = LOOKAHEAD_H, now: datetime | None = None) -> dict:
    """Clocked work still due today (or next-day wrap) within lookahead_h.

    Does not list interval jobs. Manual drafts always appear if the queue has files.
    """
    now = now or hst_now()
    horizon = now + timedelta(hours=lookahead_h)
    items: list[dict] = []

    drafts = pending_drafts()
    if drafts:
        items.append(
            {
                "id": "manual-drafts",
                "label": "Reports waiting for you to approve",
                "manual": True,
                "due": now.isoformat(),
                "hour": now.hour,
                "minute": now.minute,
                "phrase": "phrase_manual_drafts",
                "function": None,
                "count": len(drafts),
            }
        )

    for job in CLOCK_JOBS:
        due = _due_dt(int(job["hour"]), int(job["minute"]), now)
        if due > horizon or due < now - timedelta(minutes=2):
            continue
        if due.date() != now.date() and int(job["hour"]) >= 6:
            continue
        if job_fired_today(job["id"]):
            continue
        items.append(
            {
                "id": job["id"],
                "label": job["label"],
                "manual": bool(job.get("manual")),
                "due": due.isoformat(),
                "hour": int(job["hour"]),
                "minute": int(job["minute"]),
                "phrase": job["phrase"],
                "function": None,
                "note": job.get("note") or "",
            }
        )

    overnight_hours = []
    for h in (22, 23, 0, 1, 2, 3, 4, 5):
        due = _due_dt(h, 0, now)
        if now - timedelta(minutes=2) <= due <= horizon:
            overnight_hours.append(h)
    if overnight_hours:
        items.append(
            {
                "id": "overnight-relay",
                "label": "Late-night relay",
                "manual": False,
                "due": _due_dt(overnight_hours[0], 0, now).isoformat(),
                "hour": overnight_hours[0],
                "minute": 0,
                "phrase": "phrase_overnight_relay",
                "function": None,
                "note": "On the hour until morning",
            }
        )

    # Failed / still-due daily reports (same HST day) — always include, even past 1h window.
    try:
        from apps.core.services import daily_report_board

        board = daily_report_board.ensure_today()
        daily_report_board.mark_due()
        board = daily_report_board.ensure_today()
        for slot, row in (board.get("slots") or {}).items():
            if not isinstance(row, dict):
                continue
            st = str(row.get("status") or "")
            if st not in ("due", "failed"):
                continue
            phrase = {
                "morning": "phrase_morning_report",
                "midday": "midday_report",
                "evening": "evening",
                "late": "late",
            }.get(slot, "reports")
            items.append(
                {
                    "id": f"daily-report-{slot}",
                    "label": f"{slot} report still due ({st})",
                    "manual": False,
                    "due": now.isoformat(),
                    "hour": now.hour,
                    "minute": now.minute,
                    "phrase": phrase,
                    "function": None,
                    "note": "Failed or overdue — still owed today",
                    "failed_or_due": True,
                }
            )
    except Exception as e:
        log.debug("daily report due merge skipped: %s", e)

    seen: set[str] = set()
    uniq: list[dict] = []
    for row in items:
        key = str(row.get("id") or "")
        if key in seen:
            continue
        seen.add(key)
        uniq.append(row)

    payload = {
        "ok": True,
        "day": today(),
        "now": now.isoformat(),
        "horizon": horizon.isoformat(),
        "lookahead_h": lookahead_h,
        "manual": [x for x in uniq if x.get("manual")],
        "auto": [x for x in uniq if not x.get("manual")],
        "items": uniq,
    }
    try:
        REMAINING_PATH.parent.mkdir(parents=True, exist_ok=True)
        REMAINING_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    except OSError:
        pass
    return payload


def catalog() -> dict:
    functions = [slot_key(kind, slot) for slot in SLOTS for kind in REPORT_KINDS]
    return {
        "ok": True,
        "timezone": "Pacific/Honolulu",
        "lookahead_h": LOOKAHEAD_H,
        "report_kinds": list(REPORT_KINDS),
        "slots": dict(SLOT_HOUR),
        "functions": functions,
        "must_fire_interval": list(MUST_FIRE_INTERVAL),
        "must_fire_hourly": list(MUST_FIRE_HOURLY),
        "clock_jobs": list(CLOCK_JOBS),
        "boot_jobs": list(BOOT_JOBS),
        "event_phrases": list(EVENT_PHRASES),
        "remaining_job": {"id": "remaining-tasks", "when": "every :30", "lookahead_h": LOOKAHEAD_H},
    }


def snapshot_dir() -> Path:
    p = config.REPORTS_DIR / "day-board"
    p.mkdir(parents=True, exist_ok=True)
    return p

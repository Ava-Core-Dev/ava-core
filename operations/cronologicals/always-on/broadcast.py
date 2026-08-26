#!/usr/bin/env python3
"""
Ava broadcast — EcoFlow APIs + static Pages + transparent /directory browser.

Directory root: /home/ava-core.
Toggle:        presence of directory.enabled next to this script = ON
               rename to directory.enabled.disabled (or delete) = OFF

Secrets are never listed or served: .env, credentials, tokens, keys, etc.
Sensitive paths appear in the tree but content is blocked.
"""
from __future__ import annotations

import json
import mimetypes
import os
import sqlite3
import stat
import subprocess
import re
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse
from urllib.request import Request, urlopen

HOST = "0.0.0.0"
PORT = 8080
def _resolve_pages_root() -> Path:
    return Path("/home/ava-core/web/sites")

PAGES_ROOT = _resolve_pages_root()
DB_ROOT = Path("/home/ava-core/database")
ENHANCED_DB = DB_ROOT / "ecoflow-1min.db"
LIVE_DB = DB_ROOT / "ecoflow-10s.db"
SYSTEM_DB = DB_ROOT / "system.db"
SYSTEM_MIN_DB = DB_ROOT / "system-1min.db"
UPTIME_DB = DB_ROOT / "uptime.db"
QUAKES_DB = DB_ROOT / "quakes.db"
WEATHER_DB = DB_ROOT / "weather.db"
HAWAII_TZ = ZoneInfo("Pacific/Honolulu")
WEB_MEDIA_ROOT = Path("/home/ava-core/web/web-media")
EXCLUDED_ECOFLOW_SNS = {"R331ZAB5SG755642"}
NAME_MAP = {
    "R621ZA16XH6K1155": "Primary",
    "R331ZAB5SG6S2858": "Backup",
}
WINDOW_SECONDS = {"1m":60,"15m":900,"1h":3600,"8h":28800,"12h":43200,"24h":86400,"48h":172800,"3d":259200,"7d":604800,"month":30*86400,"year":365*86400,"all":None}


ALWAYS_ON_DIR = Path(__file__).resolve().parent
DIR_FLAG = ALWAYS_ON_DIR / "directory.enabled"
DIR_FLAG_DISABLED = ALWAYS_ON_DIR / "directory.enabled.disabled"

# AVA Core is the live home.
DIR_ROOT = Path("/home/ava-core")

MAX_TEXT_BYTES = 2 * 1024 * 1024  # 2 MiB text preview/serve
MAX_LIST_ENTRIES = 5000
SKIP_DIR_NAMES = {
    "__pycache__",
    ".git",
    ".svn",
    ".hg",
    "node_modules",
    ".tox",
    ".venv",
    "venv",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".parcel-cache",
    ".next",
    ".nuxt",
    "coverage",
    ".cache",
    ".thumbnails",
    "snap",
    # home / tooling clutter
    ".agents",
    ".ava",
    ".cargo",
    ".cloudflared",
    ".codex",
    ".config",
    ".cursor",
    ".git-ava-core-backup",
    ".gradle",
    ".local",
    ".minecraft",
    ".npm",
    ".ollama",
    ".pki",
    ".rustup",
    ".venvs",
    ".ssh",
    ".gnupg",
    "desktop",
    "downloads",
    "documents",
    "pictures",
    "screenshots",
    "gemini_env",
    "credentials",
    "credentials",
}
# Names / substrings that must never appear in listings or be readable.
HIDDEN_NAME_PARTS = (
    "files.zip",
    "MANIFEST.json",
    "file_mapping.txt",
    "file_mapping.json",
    "gitconfig",
    ".bash_history",
    ".env",
    "credentials",
    "credential",
    "secret",
    "passwd",
    "password",
    "private_key",
    "privatekey",
    "id_rsa",
    "id_ed25519",
    "id_ecdsa",
    ".pem",
    ".key",
    "token",
    "tunnel.token",
    "ava-core-v2.token",
    "credentials.env",
    "env backups",
    "env-clean",
)
# Paths (relative to DIR_ROOT) that are hidden entirely from the public tree.
HIDDEN_PATH_PREFIXES = (
    "credentials",
    "credentials",
    ".ssh",
    ".gnupg",
    ".aws",
    ".config",
    ".config/gcloud",
    "web/cloudflare",
    "Web/cloudflare",
    "Desktop",
    "Downloads",
    "Pictures",
    "Screenshots",
    "gemini_env",
    ".agents",
    ".ava",
    ".cargo",
    ".cloudflared",
    ".codex",
    ".cursor",
    ".git-ava-core-backup",
    ".gradle",
    ".local",
    ".minecraft",
    ".npm",
    ".ollama",
    ".pki",
    ".rustup",
    ".venvs",
)
# Paths that may be listed but content is never served.
SENSITIVE_PATH_PREFIXES = (
    "database/sessions",
    "database/notes",
    "operations/cronologicals/.ava-core-state.json",
    "operations/cronologicals/.run-ava-state.json",
)
SENSITIVE_NAME_PARTS = (
    "session",
    "account",
    "cookie",
    "auth",
    "oauth",
    "apikey",
    "api_key",
    "api-key",
)


def directory_enabled() -> bool:
    if DIR_FLAG_DISABLED.exists():
        return False
    # Default ON when Ava is running unless explicitly disabled.
    return True if not DIR_FLAG.exists() and not DIR_FLAG_DISABLED.exists() else DIR_FLAG.exists()


def cols(db, table):
    if not db.exists():
        return set()
    try:
        with sqlite3.connect(db) as c:
            return {r[1] for r in c.execute(f"PRAGMA table_info({table})")}
    except Exception:
        return set()


def q(db, sql, args=()):
    if not db.exists():
        return []
    try:
        with sqlite3.connect(db) as c:
            c.row_factory = sqlite3.Row
            return [dict(r) for r in c.execute(sql, args).fetchall()]
    except Exception as e:
        print("EcoFlow DB error:", e)
        return []


def select_expr(available, name, default="NULL"):
    return name if name in available else f"{default} AS {name}"


def latest_enhanced():
    """Return the latest 1-minute EcoFlow summary for each device."""
    c = cols(ENHANCED_DB, "summary")
    if not c:
        return []
    wanted = [
        "name", "soc_avg", "in_w_avg", "out_w_avg", "solar_w_avg",
        "net_w_avg", "soc_delta", "energy_in_wh", "energy_out_wh",
        "trend", "samples", "bucket_key", "load_ratio", "online_pct",
    ]
    fields = ", ".join(select_expr(c, x) for x in wanted)
    rows = q(
        ENHANCED_DB,
        f"""SELECT {fields} FROM summary WHERE id IN
        (SELECT MAX(id) FROM summary GROUP BY COALESCE(name, sn))
        ORDER BY CASE name WHEN 'Primary' THEN 1 WHEN 'security' THEN 2
        WHEN 'Backup' THEN 3 ELSE 9 END""",
    )
    return [r for r in rows if r.get("sn") not in EXCLUDED_ECOFLOW_SNS and str(r.get("name", "")).lower() != "security"]


def _window_seconds(value, default="12h"):
    return WINDOW_SECONDS.get(value, WINDOW_SECONDS[default])

def _window_from_query(parsed, default="12h"):
    qv = parse_qs(parsed.query)
    if "window" in qv: return qv["window"][0] if qv["window"][0] in WINDOW_SECONDS else default
    if "hours" in qv:
        try:
            h=float(qv["hours"][0]); return min(WINDOW_SECONDS, key=lambda k: abs((WINDOW_SECONDS[k] or 10**18)-h*3600))
        except Exception: pass
    return default

# Metrics where summing samples is meaningless (rates / levels).
_RATE_OR_LEVEL_KEYS = {
    "soc_avg", "solar_w_avg", "in_w_avg", "out_w_avg", "net_w_avg",
    "cpu", "memory", "recv_bps", "sent_bps",
}
# Metrics where a window sum is meaningful (energy amounts over the window).
_SUMMABLE_KEYS = {
    "energy_in_wh", "energy_out_wh", "energy_solar_wh",
}


def _percent_change(prev, cur):
    """Relative change first→last sample. Suppress extremes when baseline ~0."""
    if prev is None or cur is None:
        return None
    try:
        prev = float(prev)
        cur = float(cur)
    except (TypeError, ValueError):
        return None
    if abs(prev) < 1e-6:
        if abs(cur) < 1e-6:
            return 0.0
        return None  # avoid -100% / +inf when baseline is ~0
    return (cur - prev) / abs(prev) * 100.0


def _aggregate(rows, keys):
    """Window stats for dashboard tables.

    - current / average / min / max: always from samples
    - total: only for summable energy keys; rates/levels stay null (UI shows —)
    - percent_change: first→last relative change with near-zero baseline guard
    """
    out = {}
    for key in keys:
        vals = []
        for r in rows:
            try:
                v = float(r.get(key))
                if v == v and abs(v) != float("inf"):
                    vals.append(v)
            except Exception:
                pass
        if vals:
            prev, cur = vals[0], vals[-1]
            avg = sum(vals) / len(vals)
            if key in _SUMMABLE_KEYS or key.endswith("_wh"):
                total = sum(vals)
            else:
                # rates (W, B/s) and levels (%) must not be summed
                total = None
            out[key] = {
                "current": cur,
                "average": avg,
                "total": total,
                "min": min(vals),
                "max": max(vals),
                "percent_change": _percent_change(prev, cur),
                "sample_count": len(vals),
            }
        else:
            out[key] = {
                "current": None,
                "average": None,
                "total": None,
                "min": None,
                "max": None,
                "percent_change": None,
                "sample_count": 0,
            }
    return out

def history(hours=12, window=None):
    """Return EcoFlow history for any dashboard window, excluding security."""
    c = cols(ENHANCED_DB, "summary")
    if not c: return []
    wanted = ["bucket_key","ts","sn","name","soc_avg","in_w_avg","out_w_avg","solar_w_avg","net_w_avg","soc_delta","energy_in_wh","energy_out_wh","energy_solar_wh","trend","samples","load_ratio","online_pct"]
    fields = ", ".join(select_expr(c, x) for x in wanted)
    rows = q(ENHANCED_DB, f"SELECT {fields} FROM summary ORDER BY bucket_key, name")
    seconds=_window_seconds(window or "12h"); cutoff=None if seconds is None else datetime.now(timezone.utc).timestamp()-seconds
    out=[]
    for r in rows:
        if r.get("sn") in EXCLUDED_ECOFLOW_SNS or str(r.get("name","")).lower()=="security": continue
        stamp=None
        for key in ("bucket_key","ts"):
            value=r.get(key)
            if not value: continue
            try: stamp=datetime.fromisoformat(str(value).replace("Z","+00:00")).timestamp(); break
            except Exception: pass
        if stamp is not None and (cutoff is None or stamp>=cutoff):
            r["minute_key"]=r.get("bucket_key") or r.get("ts"); out.append(r)
    return out


def live_now():
    c=cols(LIVE_DB,"snapshots")
    if not c: return []
    wanted=["sn","online","soc","in_w","out_w","solar_w","ts"]
    fields=", ".join(select_expr(c,x) for x in wanted)
    rows=q(LIVE_DB,f"SELECT {fields} FROM snapshots WHERE id IN (SELECT MAX(id) FROM snapshots GROUP BY sn)")
    out=[]
    for r in rows:
        if r.get("sn") in EXCLUDED_ECOFLOW_SNS: continue
        r["name"]=NAME_MAP.get(r.get("sn"),r.get("sn")); out.append(r)
    return out


def _json_value(value, fallback=None):
    try:
        return json.loads(value) if value else fallback
    except (TypeError, ValueError):
        return fallback


def _latest_system_row(table):
    rows = q(SYSTEM_MIN_DB, f"SELECT * FROM {table} ORDER BY minute_ts DESC LIMIT 1")
    return rows[0] if rows else {}


def system_now():
    """Latest host telemetry strictly from the one-minute aggregate databases."""
    run = _latest_system_row("minute_runs")
    cpu = _json_value(_latest_system_row("minute_cpu").get("stats"), {})
    memory = _json_value(_latest_system_row("minute_memory").get("stats"), {})
    battery = _json_value(_latest_system_row("minute_battery").get("stats"), {})
    minute_ts = run.get("minute_ts")
    network = q(
        SYSTEM_MIN_DB,
        "SELECT iface, stats FROM minute_network WHERE minute_ts=?",
        (minute_ts,),
    ) if minute_ts is not None else []
    net_in = net_out = 0.0
    for row in network:
        stats = _json_value(row.get("stats"), {})
        net_in += float(stats.get("bytes_recv_per_sec") or 0)
        net_out += float(stats.get("bytes_sent_per_sec") or 0)
    uptime = q(UPTIME_DB, "SELECT * FROM uptime_summary WHERE summary_key='global'")
    return {
        "ts": datetime.now(timezone.utc).isoformat(),
        "minute_ts": minute_ts,
        "collection": run,
        "cpu": cpu,
        "memory": memory,
        "battery": battery,
        "network": {"interfaces": len(network), "recv_bps": net_in, "sent_bps": net_out},
        "uptime": uptime[0] if uptime else {},
        "uptime_periods": uptime_report(),
        "source": {"db": str(SYSTEM_MIN_DB), "cadence_seconds": 60},
    }


def system_history(hours=12, window=None):
    """One-minute host time series for local browser charts.

    Filters by window against the latest sample time in the DB (not wall clock alone),
    so partial datasets still zoom correctly when the UI changes range.
    """
    seconds = _window_seconds(window or "12h")
    rows = {}
    # Load a generous candidate set, then filter in Python with reliable int timestamps.
    wall_cutoff = 0 if seconds is None else int(datetime.now(timezone.utc).timestamp() - seconds) - 120
    for table, key in (("minute_cpu", "cpu"), ("minute_memory", "memory"), ("minute_battery", "battery")):
        for row in q(
            SYSTEM_MIN_DB,
            f"SELECT minute_ts, stats FROM {table} WHERE CAST(minute_ts AS INTEGER) >= ? ORDER BY CAST(minute_ts AS INTEGER)",
            (wall_cutoff,),
        ):
            try:
                ts = int(float(row["minute_ts"]))
            except Exception:
                continue
            item = rows.setdefault(ts, {"minute_ts": ts})
            item[key] = _json_value(row.get("stats"), {})
    for row in q(
        SYSTEM_MIN_DB,
        "SELECT minute_ts, stats FROM minute_network WHERE CAST(minute_ts AS INTEGER) >= ? ORDER BY CAST(minute_ts AS INTEGER)",
        (wall_cutoff,),
    ):
        try:
            ts = int(float(row["minute_ts"]))
        except Exception:
            continue
        item = rows.setdefault(ts, {"minute_ts": ts})
        stats = _json_value(row.get("stats"), {})
        item["recv_bps"] = item.get("recv_bps", 0) + float(stats.get("bytes_recv_per_sec") or 0)
        item["sent_bps"] = item.get("sent_bps", 0) + float(stats.get("bytes_sent_per_sec") or 0)

    out = [rows[k] for k in sorted(rows)]
    if not out or seconds is None:
        return out
    # Anchor to latest sample so short windows zoom even if wall-clock skew exists
    latest = out[-1]["minute_ts"]
    cutoff = latest - int(seconds)
    return [r for r in out if r["minute_ts"] >= cutoff]


def uptime_report():
    """Calculate availability using wall-clock time."""
    rows = q(
        UPTIME_DB,
        "SELECT source_ts_utc, current_uptime_seconds "
        "FROM uptime_events ORDER BY source_ts_utc",
    )

    events = []

    for row in rows:
        try:
            ts = datetime.fromisoformat(
                str(row["source_ts_utc"]).replace("Z", "+00:00")
            ).timestamp()

            events.append(
                (ts, float(row["current_uptime_seconds"]))
            )
        except Exception:
            continue

    now = datetime.now(timezone.utc).timestamp()
    report = {}

    for name, seconds in WINDOW_SECONDS.items():

        start = (
            events[0][0]
            if seconds is None and events
            else now
            if seconds is None
            else now - seconds
        )

        selected = [
            e for e in events
            if start <= e[0] <= now
        ]

        # Include the sample immediately before the window
        # so the first interval is measurable.
        prior = [
            e for e in events
            if e[0] < start
        ]

        points = ([prior[-1]] if prior else []) + selected

        online = 0.0

        for (ta, ua), (tb, ub) in zip(points, points[1:]):

            a = max(ta, start)
            b = min(tb, now)

            if b <= a:
                continue

            span = b - a

            # Normal collector cadence is ~60 seconds.
            # A large gap means the collector was offline.
            if span <= 90 and ub >= ua:
                online += min(span, ub - ua)

        # Count the live tail only when the collector is fresh.
        if selected:

            tail = now - selected[-1][0]

            if 0 <= tail <= 90:
                online += tail

        total = max(0.0, now - start)
        offline = max(0.0, total - online)

        vals = [e[1] for e in selected]

        current = vals[-1] if vals else None
        previous = vals[0] if vals else None

        report[name] = {
            "samples": len(selected),
            "current_uptime_seconds": current,
            "average_uptime_seconds":
                sum(vals) / len(vals) if vals else None,
            "online_seconds": online,
            "offline_seconds": offline,
            "observed_seconds": online,
            "window_seconds": total,
            "availability_percent":
                online / total * 100
                if total else None,
            "percent_change":
                (
                    (current - previous)
                    / abs(previous) * 100
                    if current is not None and previous
                    else None
                ),
        }

    return report


def uptime_history(window="all"):
    seconds = _window_seconds(window or "all")

    now = datetime.now(timezone.utc).timestamp()

    start = (
        0
        if seconds is None
        else now - seconds
    )

    rows = q(
        UPTIME_DB,
        "SELECT source_ts_utc, current_uptime_seconds "
        "FROM uptime_events ORDER BY source_ts_utc",
    )

    out = []

    for row in rows:
        try:
            ts = datetime.fromisoformat(
                str(row["source_ts_utc"]).replace("Z", "+00:00")
            ).timestamp()

            if ts >= start:
                out.append(
                    {
                        "ts": ts,
                        "uptime_seconds":
                            float(row["current_uptime_seconds"]),
                    }
                )

        except Exception:
            continue

    return out

def operations_status():
    """Full Cronological inventory — every lane, every script (no silent truncation)."""
    cron_root = Path("/home/ava-core/operations/cronologicals")
    pending = []
    avg_hour = 0.0
    next_hour = 0
    interval_re = re.compile(
        r"every-(\d+)-(seconds|minutes|hours|days|weeks|months|years)$"
    )
    interval_seconds = {
        "seconds": 1, "minutes": 60, "hours": 3600, "days": 86400,
        "weeks": 604800, "months": 30 * 86400, "years": 365 * 86400,
    }
    now = datetime.now()

    def add(path: Path, enabled: bool, schedule: str, next_due, next_due_label: str, lane: str):
        try:
            rel = str(path.relative_to(cron_root))
        except Exception:
            rel = str(path)
        if rel.endswith(".py.disabled"):
            rel = rel[:-9]
        pending.append({
            "path": rel,
            "enabled": enabled,
            "schedule": schedule,
            "lane": lane,
            "next_due": next_due,
            "next_due_label": next_due_label,
        })

    try:
        # --- on-time / HH:MM ---
        ontime = cron_root / "on-time"
        if ontime.is_dir():
            for d in sorted(ontime.iterdir()):
                if not d.is_dir():
                    continue
                m = re.fullmatch(r"(\d{2}):(\d{2})", d.name)
                if not m:
                    # nested buckets (e.g. locations/) — still list scripts
                    for p in sorted(d.rglob("*.py")):
                        if "__pycache__" in p.parts:
                            continue
                        add(p, True, d.name, None, d.name, "on-time")
                    continue
                hour, minute = map(int, m.groups())
                if hour > 23:
                    # non-clock slots used as :MM of every hour (legacy state news packing)
                    minute = hour % 60
                    hour = None
                jobs = [p for p in d.glob("*.py") if p.is_file()]
                if not jobs:
                    continue
                if hour is not None:
                    avg_hour += len(jobs) / 24.0
                    candidate = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
                    if candidate <= now:
                        candidate += timedelta(days=1)
                    if candidate <= now + timedelta(hours=1):
                        next_hour += len(jobs)
                    due = candidate.isoformat()
                    due_label = candidate.strftime("%H:%M")
                else:
                    # every hour at :MM
                    avg_hour += len(jobs)
                    candidate = now.replace(minute=minute, second=0, microsecond=0)
                    if candidate <= now:
                        candidate += timedelta(hours=1)
                    if candidate <= now + timedelta(hours=1):
                        next_hour += len(jobs)
                    due = candidate.isoformat()
                    due_label = f":{minute:02d}/hr"
                for p in jobs:
                    add(p, True, d.name, due, due_label, "on-time")

        # --- since-last-fire / every-N ---
        since = cron_root / "since-last-fire"
        if since.is_dir():
            for d in sorted(since.iterdir()):
                if not d.is_dir():
                    continue
                m = interval_re.fullmatch(d.name)
                if not m:
                    for p in sorted(d.glob("*.py")):
                        if p.is_file():
                            add(p, True, d.name, "recurring", d.name, "since-last-fire")
                    continue
                interval = int(m.group(1)) * interval_seconds[m.group(2)]
                if interval <= 0:
                    continue
                jobs = [p for p in d.glob("*.py") if p.is_file()]
                if not jobs:
                    continue
                avg_hour += len(jobs) * 3600 / interval
                next_hour += len(jobs) * max(1, int((3600 + interval - 1) // interval))
                for p in jobs:
                    add(p, True, d.name, "recurring", d.name, "since-last-fire")

        # --- always-on ---
        always = cron_root / "always-on"
        if always.is_dir():
            for p in sorted(always.glob("*.py")):
                if p.is_file():
                    add(p, True, "always-on", "continuous", "always-on", "always-on")

        # --- in-order-on-boot ---
        boot = cron_root / "in-order-on-boot"
        if boot.is_dir():
            for p in sorted(boot.rglob("*.py")):
                if "__pycache__" in p.parts:
                    continue
                if p.is_file():
                    add(p, True, "on-boot", "boot", "on-boot", "in-order-on-boot")

        # --- disabled ---
        for p in sorted(cron_root.rglob("*.py.disabled")):
            if "__pycache__" in p.parts:
                continue
            add(p, False, "disabled", None, "disabled", "disabled")

    except Exception as e:
        add(Path("(scan-error)"), False, "error", None, str(e)[:80], "error")

    # Stable sort: enabled first, then next_due label, then path
    def sort_key(item):
        return (
            0 if item.get("enabled") else 1,
            item.get("next_due_label") or "zzz",
            item.get("path") or "",
        )
    pending.sort(key=sort_key)

    processes = []
    try:
        proc = subprocess.run(
            ["ps", "-eo", "pid=,etime=,comm=,args="],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=2,
        )
        for line in (proc.stdout or "").splitlines()[:800]:
            bits = line.strip().split(None, 3)
            if len(bits) >= 3:
                processes.append({
                    "pid": bits[0],
                    "elapsed": bits[1],
                    "name": bits[2],
                    "command": bits[3] if len(bits) > 3 else bits[2],
                })
    except Exception as exc:
        processes = [{"pid": "—", "elapsed": "—", "name": "unavailable", "command": str(exc)}]

    rates = {
        "avg_per_hour": round(avg_hour, 3),
        "avg_per_minute": round(avg_hour / 60, 3),
        "next_hour": next_hour,
        "total_jobs": len(pending),
        "enabled_jobs": sum(1 for x in pending if x.get("enabled")),
    }
    windows = {
        key: {
            "avg_per_hour": rates["avg_per_hour"],
            "avg_per_minute": rates["avg_per_minute"],
            "next_hour": next_hour,
            "total_jobs": rates["total_jobs"],
        }
        for key in ("1m", "15m", "1h", "8h", "12h", "24h", "48h", "3d", "7d", "month", "year", "all")
    }
    return {
        "pending_crons": pending,
        "processes": processes,
        "rates": rates,
        "windows": windows,
    }



def _norm_rel(rel: str) -> str:
    rel = unquote(rel or "").replace("\\", "/").strip("/")
    parts = [p for p in rel.split("/") if p and p != "."]
    if any(p == ".." for p in parts):
        raise ValueError("path traversal")
    return "/".join(parts)


def resolve_under_root(rel: str) -> Path:
    rel = _norm_rel(rel)
    root = DIR_ROOT.resolve()
    target = (root / rel).resolve() if rel else root
    if not str(target).startswith(str(root)):
        raise ValueError("path outside root")
    return target


def is_hidden_name(name: str) -> bool:
    lower = name.lower()
    if lower in SKIP_DIR_NAMES:
        return True
    for part in HIDDEN_NAME_PARTS:
        if part.lower() in lower:
            return True
    # hidden dotfiles that are credential-like already covered; keep .env* out
    if lower.startswith(".env"):
        return True
    if lower in {".gitignore", ".gitattributes", ".gitmodules"}:
        return True
    return False


def is_hidden_rel(rel: str) -> bool:
    if not rel:
        return False
    lower = rel.lower().replace("\\", "/")
    for pref in HIDDEN_PATH_PREFIXES:
        p = pref.lower().rstrip("/")
        if lower == p or lower.startswith(p + "/"):
            return True
    for part in lower.split("/"):
        if is_hidden_name(part):
            return True
    return False


def is_sensitive_rel(rel: str) -> bool:
    if not rel:
        return False
    lower = rel.lower().replace("\\", "/")
    for pref in SENSITIVE_PATH_PREFIXES:
        p = pref.lower().rstrip("/")
        if lower == p or lower.startswith(p + "/"):
            return True
    name = Path(rel).name.lower()
    # Telemetry databases are useful to show in the tree, but must never be
    # downloadable or previewed from the public directory surface.
    if Path(name).suffix in {".db", ".sqlite", ".sqlite3"}:
        return True
    for part in SENSITIVE_NAME_PARTS:
        if part in name:
            return True
    # email-looking session folders
    if "@" in name and ("." in name):
        return True
    return False


def human_size(n: int) -> str:
    if n < 1024:
        return f"{n} B"
    for unit, div in (("KB", 1024), ("MB", 1024**2), ("GB", 1024**3), ("TB", 1024**4)):
        if n < div * 1024 or unit == "TB":
            return f"{n / div:.1f} {unit}"
    return f"{n} B"


def entry_meta(path: Path, rel: str) -> dict:
    try:
        st = path.lstat()
    except OSError:
        return {
            "name": path.name,
            "rel": rel,
            "type": "unknown",
            "size": None,
            "size_h": None,
            "mtime": None,
            "sensitive": True,
            "readable": False,
        }
    is_dir = stat.S_ISDIR(st.st_mode)
    is_link = stat.S_ISLNK(st.st_mode)
    sensitive = is_sensitive_rel(rel)
    kind = "dir" if is_dir else ("link" if is_link else "file")
    mtime = datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat()
    size = None if is_dir else st.st_size
    return {
        "name": path.name or "/",
        "rel": rel,
        "type": kind,
        "size": size,
        "size_h": None if size is None else human_size(size),
        "mtime": mtime,
        "sensitive": sensitive,
        "readable": (not is_dir) and (not sensitive) and (not is_hidden_rel(rel)),
    }


def list_dir(rel: str = "", recursive: bool = False) -> dict:
    target = resolve_under_root(rel)
    if not target.exists():
        return {"ok": False, "error": "not found", "root": str(DIR_ROOT), "rel": rel}
    if not target.is_dir():
        return {"ok": False, "error": "not a directory", "root": str(DIR_ROOT), "rel": rel}

    entries = []
    root_resolved = DIR_ROOT.resolve()
    count = 0

    def add_one(p: Path):
        nonlocal count
        if count >= MAX_LIST_ENTRIES:
            return
        try:
            r = str(p.resolve().relative_to(root_resolved)).replace("\\", "/")
        except ValueError:
            return
        if r == ".":
            r = ""
        if is_hidden_rel(r) or is_hidden_name(p.name):
            return
        entries.append(entry_meta(p, r))
        count += 1

    if recursive:
        for dirpath, dirnames, filenames in os.walk(target, followlinks=False):
            # prune hidden dirs in-place
            dirnames[:] = [d for d in dirnames if not is_hidden_name(d)]
            base = Path(dirpath)
            for d in sorted(dirnames, key=str.lower):
                add_one(base / d)
                if count >= MAX_LIST_ENTRIES:
                    break
            for f in sorted(filenames, key=str.lower):
                if is_hidden_name(f):
                    continue
                add_one(base / f)
                if count >= MAX_LIST_ENTRIES:
                    break
            if count >= MAX_LIST_ENTRIES:
                break
    else:
        try:
            children = sorted(target.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
        except OSError as e:
            return {"ok": False, "error": str(e), "root": str(DIR_ROOT), "rel": rel}
        for p in children:
            if is_hidden_name(p.name):
                continue
            try:
                r = str(p.resolve().relative_to(root_resolved)).replace("\\", "/")
            except ValueError:
                continue
            if is_hidden_rel(r):
                continue
            add_one(p)

    # sort: dirs first, then name
    entries.sort(key=lambda e: (0 if e["type"] == "dir" else 1, e["name"].lower()))
    parent = ""
    if rel:
        parent = str(Path(rel).parent).replace("\\", "/")
        if parent == ".":
            parent = ""
    return {
        "ok": True,
        "enabled": True,
        "root": str(DIR_ROOT),
        "rel": rel,
        "parent": parent,
        "count": len(entries),
        "truncated": count >= MAX_LIST_ENTRIES,
        "entries": entries,
    }


def read_file_safe(rel: str) -> tuple[int, bytes, str, dict]:
    """Returns (status, body, content_type, meta)."""
    if is_hidden_rel(rel) or is_hidden_name(Path(rel).name):
        return 404, b"not found", "text/plain", {}
    if is_sensitive_rel(rel):
        meta = {"rel": rel, "sensitive": True, "blocked": True}
        msg = (
            "# Content blocked\n\n"
            "This path is marked sensitive (accounts, sessions, auth-related).\n"
            "It is listed for transparency but its contents are not served.\n"
        ).encode()
        return 403, msg, "text/plain; charset=utf-8", meta

    path = resolve_under_root(rel)
    if not path.is_file():
        return 404, b"not found", "text/plain", {}

    try:
        size = path.stat().st_size
    except OSError as e:
        return 500, str(e).encode(), "text/plain", {}

    ct = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    meta = entry_meta(path, rel)
    meta["content_type"] = ct

    # Only serve text-like or small binary with explicit view; large binaries blocked for safety
    name_lower = path.name.lower()
    suffix = path.suffix.lower()

    TEXT_SUFFIXES = {
        ".py", ".js", ".ts", ".tsx", ".jsx", ".css", ".html", ".htm",
        ".md", ".txt", ".json", ".yml", ".yaml", ".toml", ".ini", ".cfg",
        ".conf", ".sh", ".bash", ".zsh", ".ps1", ".sql", ".csv", ".log",
        ".svg", ".xml", ".c", ".h", ".cpp", ".hpp", ".rs", ".go", ".java",
        ".rb", ".php", ".r", ".lua", ".pl", ".pm", ".swift", ".kt", ".kts",
        ".scala", ".cs", ".fs", ".ex", ".exs", ".erl", ".hrl", ".clj",
        ".edn", ".rake", ".gemspec", ".podspec", ".gradle", ".tf", ".hcl",
        ".proto", ".graphql", ".gql", ".vue", ".svelte", ".astro",
        ".env.example", ".sample", ".template", ".in", ".am", ".ac",
        ".service", ".timer", ".socket", ".desktop", ".list", ".sources",
    }

    TEXT_NAMES = {
        "makefile", "gnumakefile", "dockerfile", "containerfile",
        "vagrantfile", "gemfile", "rakefile", "procfile", "brewfile",
        "cmakelists.txt", "readme", "license", "licence", "copying",
        "authors", "contributors", "changelog", "changes", "news",
        "todo", "notes", "manifest", "history",
        ".bashrc", ".bash_profile", ".bash_logout", ".profile",
        ".zshrc", ".zprofile", ".zlogin", ".zlogout",
        ".gitignore", ".gitattributes", ".gitmodules", ".gitconfig",
        ".npmrc", ".nvmrc", ".node-version", ".python-version",
        ".editorconfig", ".prettierrc", ".eslintrc", ".babelrc",
        ".dockerignore", ".curlrc", ".wget-hsts", ".inputrc",
        ".vimrc", ".tmux.conf", ".screenrc",
    }

    textish = (
        ct.startswith("text/")
        or ct in (
            "application/json",
            "application/javascript",
            "application/xml",
            "application/x-yaml",
            "application/toml",
            "application/sql",
            "application/x-sh",
            "application/x-shellscript",
        )
        or suffix in TEXT_SUFFIXES
        or name_lower in TEXT_NAMES
        or name_lower.startswith(".eslintrc")
        or name_lower.startswith(".prettierrc")
        or (name_lower.endswith("rc") and not name_lower.endswith(".png"))
    )

    if not textish and size <= 512 * 1024:
        try:
            sample = path.read_bytes()[:4096]
            if sample and not any(b == 0 for b in sample[:512]):
                printable = sum(1 for b in sample if 9 <= b <= 13 or 32 <= b <= 126)
                if printable / max(len(sample), 1) >= 0.85:
                    textish = True
                    ct = "text/plain"
        except OSError:
            pass

    if not textish:
        note = (
            f"# Binary / non-text file\n\n"
            f"path: {rel}\n"
            f"location: {rel}\n"
            f"raw_url: /ava-ivy/file/{rel}\n"
            f"size: {human_size(size)}\n"
            f"type: {ct}\n\n"
            f"Contents are not inlined. Agents may still reference the path.\n"
        ).encode()
        meta["blocked"] = True
        meta["reason"] = "binary"
        return 200, note, "text/plain; charset=utf-8", meta

    if size > MAX_TEXT_BYTES:
        note = (
            f"# File too large for inline view ({human_size(size)} > {human_size(MAX_TEXT_BYTES)})\n"
            f"path: {rel}\n"
        ).encode()
        meta["blocked"] = True
        meta["reason"] = "too_large"
        return 200, note, "text/plain; charset=utf-8", meta

    try:
        data = path.read_bytes()
    except OSError as e:
        return 500, str(e).encode(), "text/plain", {}

    # Extra guard: if content looks like secrets, redact
    lower = data[:4096].lower()
    if any(
        x in lower
        for x in (
            b"-----begin private key-----",
            b"-----begin rsa private key-----",
            b"aws_secret",
            b"api_key=",
            b"apikey=",
            b"password=",
            b"client_secret",
        )
    ):
        note = b"# Content blocked - file appears to contain secrets.\n"
        meta["blocked"] = True
        meta["reason"] = "secret_pattern"
        return 403, note, "text/plain; charset=utf-8", meta

    if not ct.startswith("text/") and "json" not in ct and "xml" not in ct and "javascript" not in ct:
        ct = "text/plain; charset=utf-8"
    elif "charset" not in ct:
        ct = ct + "; charset=utf-8"
    return 200, data, ct, meta



def build_status() -> dict:
    """Public health snapshot for /api/status and /status page."""
    dir_on = directory_enabled()
    enhanced = []
    try:
        enhanced = latest_enhanced() or []
    except Exception as e:
        enhanced = []
        energy_err = str(e)
    else:
        energy_err = None

    services = []
    units = []
    for r in enhanced:
        units.append(
            {
                "name": r.get("name"),
                "soc_avg": r.get("soc_avg"),
                "in_w_avg": r.get("in_w_avg"),
                "out_w_avg": r.get("out_w_avg"),
                "net_w_avg": r.get("net_w_avg"),
                "solar_w_avg": r.get("solar_w_avg"),
                "trend": r.get("trend"),
                "samples": r.get("samples"),
            }
        )
    ops = operations_status()
    # ok = core surfaces answering; energy error degrades but does not alone mean offline
    ok = energy_err is None and DIR_ROOT.is_dir()
    return {
        "ok": ok,
        "ts": datetime.now(timezone.utc).isoformat(),
        "host": "ava-core",
        "directory": {
            "enabled": dir_on,
            "root": str(DIR_ROOT),
            "root_exists": DIR_ROOT.is_dir(),
        },
        "services": services,
        "operations": ops,
        "energy": {"units": units, "error": energy_err},
        "links": {
            "json": "/api/status",
            "html": "/status",
            "system": "/system/",
            "energy": "/energy/",
            "directory": "/directory",
            "uptime": "/uptime/",
            "llms": "/llms.txt",
        },
    }


GLOBAL_LOCATIONS_PATH = Path("/home/ava-core/config/locations/global-locations.json")
if not GLOBAL_LOCATIONS_PATH.is_file():
    GLOBAL_LOCATIONS_PATH = Path(__file__).resolve().parents[3] / "config/locations/global-locations.json"
GLOBAL_EARTHQUAKES_DB = DB_ROOT / "earthquakes.db"
GLOBAL_QUAKES_DB = DB_ROOT / "quakes.db"
LEGACY_QUAKES_DB = DB_ROOT / "quakes.db"
GLOBAL_NEWS_JSON = Path("/home/ava-core/web/sites/avaivy.cloud/data/global-news.json")
if not GLOBAL_NEWS_JSON.is_file():
    GLOBAL_NEWS_JSON = Path(__file__).resolve().parents[3] / "web/sites/avaivy.cloud/data/global-news.json"

def _load_global_locations():
    try:
        return json.loads(GLOBAL_LOCATIONS_PATH.read_text(encoding="utf-8")).get("locations", [])
    except Exception:
        return []

GLOBAL_LOCATIONS = _load_global_locations()

def _geo_match(country="", state="", location=""):
    country=(country or "").strip().lower(); state=(state or "").strip().lower(); location=(location or "").strip().lower()
    def cslug(v):
        import re
        return re.sub(r"[^a-z0-9]+","-",str(v or "").lower()).strip("-")
    return [x for x in GLOBAL_LOCATIONS if (not country or cslug(x.get("country") or x.get("country_name"))==country) and (not state or str(x.get("admin1_slug") or "").lower()==state) and (not location or str(x.get("slug") or "").lower()==location)]

def geography_weather(country="", state="", location=""):
    matches=_geo_match(country,state,location)
    if not matches: return {"ok":False,"error":"Unknown geography"}
    ids=tuple(x["id"] for x in matches); qmarks=','.join('?' for _ in ids)
    if not WEATHER_DB.exists(): return {"ok":True,"locations":matches,"observations":0,"providers":0,"weather":{}}
    con=sqlite3.connect(str(WEATHER_DB)); con.row_factory=sqlite3.Row
    try:
        rows=con.execute(f"SELECT w.* FROM weather w WHERE w.location_id IN ({qmarks}) ORDER BY w.obs_ts DESC LIMIT {max(1,len(ids)*24)}",ids).fetchall()
        latest=rows[0] if rows else None
        stats=con.execute(f"SELECT COUNT(*) observations, COUNT(DISTINCT provider) providers, AVG(temp_c) avg_temp_c, AVG(humidity_pct) avg_humidity_pct, AVG(wind_kph) avg_wind_kph FROM weather WHERE location_id IN ({qmarks})",ids).fetchone()
        return {"ok":True,"locations":matches,"observations":stats["observations"],"providers":stats["providers"],"avg_temp_c":stats["avg_temp_c"],"weather":{"current_temperature":latest["temp_c"] if latest else None,"current":{"temperature_c":latest["temp_c"] if latest else None,"humidity_pct":latest["humidity_pct"] if latest else None,"wind_kph":latest["wind_kph"] if latest else None,"precipitation_mm":latest["precipitation_mm"] if latest else None,"observed_at":latest["obs_ts"] if latest else None}}}
    finally: con.close()

def geography_earthquakes(
    country="",
    state="",
    location="",
):
    matches = _geo_match(
        country,
        state,
        location,
    )

    ids = [x["id"] for x in matches]

    events = []

    if GLOBAL_EARTHQUAKES_DB.exists():

        con = sqlite3.connect(
            str(GLOBAL_EARTHQUAKES_DB)
        )

        con.row_factory = sqlite3.Row

        try:

            if ids:

                marks = ",".join(
                    "?" for _ in ids
                )

                rows = con.execute(
                    f"""
                    SELECT *
                    FROM earthquakes
                    WHERE location_id IN ({marks})
                    ORDER BY observed_at DESC
                    LIMIT 100
                    """,
                    ids,
                ).fetchall()

            elif country:

                rows = con.execute(
                    """
                    SELECT *
                    FROM earthquakes
                    WHERE lower(country_code)
                        = lower(?)
                    ORDER BY observed_at DESC
                    LIMIT 100
                    """,
                    (country,),
                ).fetchall()

            else:

                rows = con.execute(
                    """
                    SELECT *
                    FROM earthquakes
                    ORDER BY observed_at DESC
                    LIMIT 100
                    """
                ).fetchall()

            events = [
                dict(row)
                for row in rows
            ]

        finally:
            con.close()

    elif GLOBAL_QUAKES_DB.exists():

        con = sqlite3.connect(
            str(GLOBAL_QUAKES_DB)
        )

        con.row_factory = sqlite3.Row

        try:

            rows = con.execute(
                """
                SELECT
                    id,
                    time_utc AS observed_at,
                    mag AS magnitude,
                    depth_km,
                    place,
                    latitude AS lat,
                    longitude AS lon,
                    url AS source_url
                FROM quakes
                ORDER BY time_ms DESC
                LIMIT 100
                """
            ).fetchall()

            events = [
                dict(row)
                for row in rows
            ]

        finally:
            con.close()

    return {
        "ok": True,
        "events": events,
        "locations": matches,
    }

def geography_news(country="", state="", location=""):
    """Serve the generated global index, rebuilding a lightweight fallback from state DBs."""
    data={"items":[],"events":[]}
    try:
        if GLOBAL_NEWS_JSON.exists():
            data=json.loads(GLOBAL_NEWS_JSON.read_text(encoding="utf-8"))
    except Exception:
        data={"items":[],"events":[]}
    if not data.get("items"):
        items=[]; events=[]
        states_dir=DB_ROOT/"states"
        if states_dir.is_dir():
            for sdir in sorted(states_dir.iterdir()):
                if not sdir.is_dir(): continue
                for gdb in sdir.glob("*_news.db"):
                    try:
                        con=sqlite3.connect(str(gdb)); con.row_factory=sqlite3.Row
                        for r in con.execute("select p.*, s.publisher from posts p left join sources s on p.source_id=s.source_id order by p.published_at desc limit 200"):
                            st=sdir.name.replace("-"," ").title()
                            items.append({"title":r["title"],"summary":r["summary"],"link":r["url"],"published_label":r["published_at"],"published_ts":0,"category":r["category"] or "general","category_label":(r["category"] or "General").replace("-"," ").title(),"source_id":r["source_id"],"source":r["publisher"] or r["source_id"] or "Source","country_code":"US","state_code":None,"state_name":st,"region":"north-america","location":None,"importance":40})
                        con.close()
                    except Exception:
                        pass
        data={"items":items,"events":events}
    items=data.get("items",[])
    if country:
        wanted="US" if country=="united-states" else country
        items=[x for x in items if str(x.get("country_code") or "US").lower()==wanted.lower()]
    if state:
        items=[x for x in items if str(x.get("state_code") or "").lower()==state.lower() or str(x.get("state_name") or "").lower()==state.lower()]
    if location:
        items=[x for x in items if str(x.get("location") or "").lower()==location.lower()]
    return {"ok":True,"items":items[:100],"events":data.get("events",[])[:100]}

HAWAII_REGISTRY_PATH = Path("/home/ava-core/web/sites/avaivy.cloud/data/hawaii-locations.json")
if not HAWAII_REGISTRY_PATH.is_file():
    HAWAII_REGISTRY_PATH = Path(__file__).resolve().parents[3] / "web/sites/avaivy.cloud/data/hawaii-locations.json"

def _load_hawaii_registry():
    try:
        data = json.loads(HAWAII_REGISTRY_PATH.read_text(encoding="utf-8"))
        return {i["slug"]: {loc["slug"]: loc for loc in i.get("locations", [])} for i in data.get("islands", [])}
    except Exception:
        return {}

HAWAII_LOCATIONS = _load_hawaii_registry()

def _hawaii_report_matches(location_name):
    try:
        data = context_reports("weather", location_name)
        return data.get("reports", [])[:8]
    except Exception:
        return []

def weather_aggregate_data():
    """Return statistics over every stored weather observation, not one location.

    The weather database is intentionally treated as a growing observation store.
    Aggregates are weighted by actual stored rows, so a location/provider with more
    observations contributes proportionally to the overall averages.
    """
    generated = datetime.now(timezone.utc).isoformat()
    if not WEATHER_DB.exists():
        return {
            "ok": False,
            "generated_utc": generated,
            "error": "Weather database not found",
            "summary": {"observations": 0, "locations": 0, "providers": 0},
            "providers": [], "regions": [], "locations": []
        }
    conn = sqlite3.connect(str(WEATHER_DB))
    conn.row_factory = sqlite3.Row
    try:
        # Keep the global database cheap to query as it grows.
        conn.execute("CREATE INDEX IF NOT EXISTS idx_weather_obs_ts ON weather(obs_ts)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_weather_location ON weather(location_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_weather_provider ON weather(provider)")
        conn.commit()
        row = conn.execute("""
            SELECT
              COUNT(*) observations,
              COUNT(DISTINCT location_id) locations,
              COUNT(DISTINCT provider) providers,
              COUNT(temp_c) temperature_points,
              ROUND(AVG(temp_c),3) avg_temp_c,
              MIN(temp_c) min_temp_c,
              MAX(temp_c) max_temp_c,
              COUNT(humidity_pct) humidity_points,
              ROUND(AVG(humidity_pct),3) avg_humidity_pct,
              COUNT(wind_kph) wind_points,
              ROUND(AVG(wind_kph),3) avg_wind_kph,
              MIN(wind_kph) min_wind_kph,
              MAX(wind_kph) max_wind_kph,
              COUNT(precipitation_mm) precipitation_points,
              ROUND(AVG(precipitation_mm),3) avg_precipitation_mm,
              MIN(obs_ts) first_observation,
              MAX(obs_ts) last_observation
            FROM weather
        """).fetchone()
        summary=dict(row) if row else {}
        summary["avg_temp_f"] = round(summary["avg_temp_c"] * 9/5 + 32, 3) if summary.get("avg_temp_c") is not None else None
        summary["min_temp_f"] = round(summary["min_temp_c"] * 9/5 + 32, 3) if summary.get("min_temp_c") is not None else None
        summary["max_temp_f"] = round(summary["max_temp_c"] * 9/5 + 32, 3) if summary.get("max_temp_c") is not None else None
        summary["avg_wind_mph"] = round(summary["avg_wind_kph"] * 0.621371, 3) if summary.get("avg_wind_kph") is not None else None

        providers=[dict(r) for r in conn.execute("""
            SELECT provider, COUNT(*) observations,
                   COUNT(DISTINCT location_id) locations,
                   ROUND(AVG(temp_c),3) avg_temp_c,
                   ROUND(AVG(humidity_pct),3) avg_humidity_pct,
                   ROUND(AVG(wind_kph),3) avg_wind_kph,
                   ROUND(AVG(precipitation_mm),3) avg_precipitation_mm
            FROM weather GROUP BY provider ORDER BY observations DESC
        """)]
        for r in providers:
            r["avg_temp_f"] = round(r["avg_temp_c"]*9/5+32,3) if r.get("avg_temp_c") is not None else None
            r["avg_wind_mph"] = round(r["avg_wind_kph"]*0.621371,3) if r.get("avg_wind_kph") is not None else None

        regions=[dict(r) for r in conn.execute("""
            SELECT COALESCE(l.country_code,'US') country_code,
                   COALESCE(l.admin1_code,'HI') admin1_code,
                   COALESCE(l.region,l.island,'Unknown') region,
                   COUNT(*) observations,
                   COUNT(DISTINCT w.location_id) locations,
                   ROUND(AVG(w.temp_c),3) avg_temp_c,
                   ROUND(AVG(w.humidity_pct),3) avg_humidity_pct,
                   ROUND(AVG(w.wind_kph),3) avg_wind_kph,
                   ROUND(AVG(w.precipitation_mm),3) avg_precipitation_mm
            FROM weather w JOIN locations l ON l.id=w.location_id
            GROUP BY country_code, admin1_code, region
            ORDER BY observations DESC
        """)]
        for r in regions:
            r["avg_temp_f"] = round(r["avg_temp_c"]*9/5+32,3) if r.get("avg_temp_c") is not None else None
            r["avg_wind_mph"] = round(r["avg_wind_kph"]*0.621371,3) if r.get("avg_wind_kph") is not None else None

        locations=[dict(r) for r in conn.execute("""
            SELECT l.id, l.name, l.island, COALESCE(l.country_code,'US') country_code,
                   COALESCE(l.admin1_code,'HI') admin1_code, l.lat, l.lon,
                   COUNT(w.id) observations, COUNT(DISTINCT w.provider) providers,
                   ROUND(AVG(w.temp_c),3) avg_temp_c,
                   ROUND(AVG(w.humidity_pct),3) avg_humidity_pct,
                   ROUND(AVG(w.wind_kph),3) avg_wind_kph,
                   ROUND(AVG(w.precipitation_mm),3) avg_precipitation_mm,
                   MIN(w.obs_ts) first_observation, MAX(w.obs_ts) last_observation
            FROM locations l JOIN weather w ON w.location_id=l.id
            GROUP BY l.id
            ORDER BY observations DESC, l.name
        """)]
        for r in locations:
            r["avg_temp_f"] = round(r["avg_temp_c"]*9/5+32,3) if r.get("avg_temp_c") is not None else None
            r["avg_wind_mph"] = round(r["avg_wind_kph"]*0.621371,3) if r.get("avg_wind_kph") is not None else None

        # A short recent window helps the UI show current coverage without replacing
        # the all-time database statistics above.
        recent=conn.execute("""
            SELECT COUNT(*) observations, COUNT(DISTINCT location_id) locations,
                   ROUND(AVG(temp_c),3) avg_temp_c,
                   ROUND(AVG(humidity_pct),3) avg_humidity_pct,
                   ROUND(AVG(wind_kph),3) avg_wind_kph,
                   ROUND(AVG(precipitation_mm),3) avg_precipitation_mm
            FROM weather
            WHERE obs_ts >= datetime('now','-24 hours')
        """).fetchone()
        recent=dict(recent) if recent else {}
        recent["avg_temp_f"] = round(recent["avg_temp_c"]*9/5+32,3) if recent.get("avg_temp_c") is not None else None
        recent["avg_wind_mph"] = round(recent["avg_wind_kph"]*0.621371,3) if recent.get("avg_wind_kph") is not None else None
        return {"ok": True, "generated_utc": generated, "summary": summary,
                "recent_24h": recent, "providers": providers,
                "regions": regions, "locations": locations,
                "database": {"path": "database/weather.db", "scope": "all stored observations"}}
    except Exception as e:
        return {"ok": False, "generated_utc": generated, "error": str(e),
                "summary": {"observations": 0, "locations": 0, "providers": 0},
                "providers": [], "regions": [], "locations": []}
    finally:
        conn.close()


def hawaii_location_data(island, location):
    item = HAWAII_LOCATIONS.get(island, {}).get(location)
    if not item:
        return None
    lat, lon = item["lat"], item["lon"]
    now = datetime.now(timezone.utc)
    url = ("https://api.open-meteo.com/v1/forecast?latitude=%s&longitude=%s"
           "&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m"
           "&daily=sunrise,sunset,temperature_2m_max,temperature_2m_min,precipitation_probability_max"
           "&timezone=Pacific%%2FHonolulu") % (lat, lon)
    weather={"ok":False}
    try:
        req=Request(url, headers={"User-Agent":"AvaIvy/1.0"})
        with urlopen(req, timeout=10) as response:
            raw=json.loads(response.read().decode("utf-8"))
        weather={"ok":True,"current":raw.get("current",{}),"daily":raw.get("daily",{}),"units":raw.get("current_units",{})}
    except Exception as e:
        weather={"ok":False,"error":str(e)}
    return {"state":{"id":"hawaii","name":"Hawaiʻi","timezone":"Pacific/Honolulu"},"location":{"slug":location,**item},"generated_utc":now.isoformat(),"weather":weather,"reports":_hawaii_report_matches(item.get("name", ""))}

def hawaii_directory_data():
    islands=[]
    for island, locations in HAWAII_LOCATIONS.items():
        islands.append({"slug":island,"name":next(iter(locations.values()))["island"],"locations":[{"slug":k,**v} for k,v in locations.items()]})
    return {"state":"hawaii","islands":islands,"location_count":sum(len(x) for x in HAWAII_LOCATIONS.values()),"generated_utc":datetime.now(timezone.utc).isoformat()}

def hawaii_state_data():
    """Reusable state payload. Hawaiʻi is the first state template."""
    lat, lon = 19.5429, -155.1086  # Mountain View, Hawaiʻi
    now = datetime.now(timezone.utc)
    url = ("https://api.open-meteo.com/v1/forecast?latitude=%s&longitude=%s"
           "&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m"
           "&daily=sunrise,sunset,temperature_2m_max,temperature_2m_min,precipitation_probability_max"
           "&timezone=Pacific%%2FHonolulu&forecast_days=3" % (lat, lon))
    weather = {"ok": False}
    try:
        req = Request(url, headers={"User-Agent":"AvaIvy-State/1.0"})
        with urlopen(req, timeout=20) as r:
            raw = json.loads(r.read().decode("utf-8"))
        weather = {"ok": True, "current": raw.get("current", {}), "daily": raw.get("daily", {}), "units": raw.get("current_units", {})}
    except Exception as e:
        weather = {"ok": False, "error": str(e)}

    quakes=[]
    try:
        quakes=q(QUAKES_DB, "SELECT time_utc,mag,depth_km,place,latitude,longitude,tsunami,url FROM quakes WHERE source='hawaii' ORDER BY time_ms DESC LIMIT 25")
    except Exception as e:
        quake_error=str(e)
    else: quake_error=None

    first_solar=None
    try:
        rows=q(ENHANCED_DB, "SELECT ts,solar_w_avg FROM summary ORDER BY ts DESC LIMIT 5000")
        today=datetime.now(HAWAII_TZ).date().isoformat()
        candidates=[]
        for r in rows:
            ts=str(r.get("ts") or "")
            try:
                dt=datetime.fromisoformat(ts.replace("Z","+00:00")).astimezone(HAWAII_TZ)
                if dt.date().isoformat()==today and float(r.get("solar_w_avg") or 0)>0: candidates.append((dt,r.get("solar_w_avg")))
            except Exception: pass
        if candidates:
            dt,w=sorted(candidates,key=lambda x:x[0])[0]; first_solar={"time":dt.isoformat(),"watts":w}
    except Exception: pass
    return {"state":{"id":"hawaii","name":"Hawaiʻi","timezone":"Pacific/Honolulu","locality":"Mountain View, Big Island","coordinates":{"lat":lat,"lon":lon}},"generated_utc":now.isoformat(),"weather":weather,"earthquakes":{"events":quakes,"error":quake_error},"energy_context":{"first_recorded_solar":first_solar}}



REPORTS_ROOT = WEB_MEDIA_ROOT / "context" / "reports"

def _report_asset_url(path: Path):
    try:
        rel = path.resolve().relative_to(WEB_MEDIA_ROOT.resolve())
        return "/web-media/" + quote(str(rel).replace(os.sep, "/"))
    except Exception:
        return None

def context_reports(category="", query_text=""):
    """Discover metadata-driven public reports without exposing files outside REPORTS_ROOT."""
    rows = []
    if not REPORTS_ROOT.exists():
        return {"generated_utc": datetime.now(timezone.utc).isoformat(), "reports": rows}
    category = (category or "").strip().strip("/")
    qtext = (query_text or "").lower().strip()
    for meta in REPORTS_ROOT.rglob("metadata.json"):
        try:
            bundle = meta.parent.resolve()
            if REPORTS_ROOT.resolve() not in bundle.parents and bundle != REPORTS_ROOT.resolve():
                continue
            data = json.loads(meta.read_text(encoding="utf-8"))
            cat = str(data.get("category") or "").strip().strip("/")
            if category and not (cat == category or (category == "weather" and cat.startswith("weather/"))):
                continue
            title = str(data.get("title") or bundle.name)
            summary = str(data.get("summary") or "")
            location = str(data.get("location") or "")
            hay = " ".join([title, summary, location, cat, str(data.get("event") or "")]).lower()
            if qtext and qtext not in hay:
                continue
            assets = {}
            raw_assets = data.get("assets") if isinstance(data.get("assets"), dict) else {}
            for key in ("text", "audio", "image"):
                raw = raw_assets.get(key)
                if raw:
                    fp = (bundle / str(raw)).resolve()
                    if fp.is_file() and str(fp).startswith(str(REPORTS_ROOT.resolve())):
                        assets[key] = _report_asset_url(fp)
            # Sensible discovery fallback when metadata omits an asset map.
            for key, names in {
                "text": ("report.txt", "report.md", "report.html"),
                "audio": ("report.mp3", "report.wav", "report.m4a"),
                "image": ("report.jpg", "report.jpeg", "report.png", "report.webp"),
            }.items():
                if key not in assets:
                    for name in names:
                        fp = bundle / name
                        if fp.is_file():
                            assets[key] = _report_asset_url(fp)
                            break
            rows.append({
                "id": data.get("id") or str(bundle.relative_to(REPORTS_ROOT)),
                "title": title,
                "category": cat,
                "location": location,
                "state": data.get("state"),
                "country": data.get("country"),
                "created_at": data.get("created_at"),
                "published_at": data.get("published_at") or data.get("created_at"),
                "event": data.get("event"),
                "tags": data.get("tags") if isinstance(data.get("tags"), list) else [],
                "summary": summary,
                "assets": assets,
            })
        except Exception:
            continue
    rows.sort(key=lambda x: str(x.get("published_at") or ""), reverse=True)
    return {"generated_utc": datetime.now(timezone.utc).isoformat(), "category": category or None, "reports": rows, "count": len(rows)}



def context_report_locations(category=""):
    data = context_reports(category, "")
    groups = {}
    for row in data.get("reports", []):
        loc = row.get("location") or "Unspecified"
        groups.setdefault(loc, 0)
        groups[loc] += 1
    return {"category": category or None, "locations": [{"name": k, "count": v} for k, v in sorted(groups.items())]}

class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def sendb(self, code, b, ct="text/html; charset=utf-8", extra_headers=None):
        self.send_response(code)
        self.send_header("Content-Type", ct)
        self.send_header("Content-Length", str(len(b)))
        self.send_header("Cache-Control", "no-store")
        if extra_headers:
            for k, v in extra_headers.items():
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(b)

    def js(self, o, code=200):
        self.sendb(code, json.dumps(o, default=str).encode(), "application/json; charset=utf-8")

    def api(self, path, parsed):
        if path in ("/api/context/reports", "/context/reports/api"):
            qs = parse_qs(parsed.query)
            category = (qs.get("category") or [""])[0]
            query_text = (qs.get("q") or [""])[0]
            self.js(context_reports(category, query_text))
            return True

        if path == "/api/context/locations":
            qs = parse_qs(parsed.query)
            category = (qs.get("category") or [""])[0]
            self.js(context_report_locations(category))
            return True

        if path == "/api/weather/aggregate":
            self.js(weather_aggregate_data())
            return True

        if path == "/api/earthquakes/global":
            self.js(geography_earthquakes())
            return True
        if path == "/api/news/global":
            self.js(geography_news())
            return True
        if path.startswith("/api/geography/"):
            product=path.split("/")[3] if len(path.split("/"))>3 else ""
            qs=parse_qs(parsed.query); country=(qs.get("country") or [""])[0]; state=(qs.get("state") or [""])[0]; location=(qs.get("location") or [""])[0]
            fn={"weather":geography_weather,"earthquakes":geography_earthquakes,"news":geography_news}.get(product)
            if fn:
                self.js(fn(country,state,location)); return True
            self.js({"ok":False,"error":"Unknown geography product"},404); return True

        if path == "/api/states/hawaii":
            self.js(hawaii_state_data())
            return True
        if path == "/api/states/hawaii/directory":
            self.js(hawaii_directory_data())
            return True
        if path.startswith("/api/states/hawaii/island/"):
            parts=[x for x in path.split("/") if x]
            if len(parts)==6 and parts[:4]==["api","states","hawaii","island"]:
                data=hawaii_location_data(parts[4], parts[5])
                if data:
                    self.js(data)
                    return True
            self.js({"error":"Unknown Hawaiʻi location"}, 404)
            return True

        if path in ("/api/health", "/system/api/health", "/health"):
            data = build_status()
            self.js({
                "ok": bool(data.get("ok")),
                "ts": data.get("ts"),
                "host": data.get("host"),
                "directory_enabled": (data.get("directory") or {}).get("enabled"),
                "energy_error": (data.get("energy") or {}).get("error"),
                "status_url": "/api/status",
            })
            return

        if path == "/api/status":
            qs = parse_qs(parsed.query)
            window = (qs.get("window") or ["1h"])[0]
            try:
                data = build_status()
            except Exception as e:
                data = {
                    "ok": False,
                    "ts": datetime.now(timezone.utc).isoformat(),
                    "host": "ava-core",
                    "error": f"build_status: {e}",
                }
            try:
                data["operations"] = operations_status()
            except Exception as e:
                data["operations"] = {
                    "pending_crons": [],
                    "processes": [],
                    "rates": {"avg_per_hour": None, "avg_per_minute": None, "next_hour": None},
                    "windows": {},
                    "error": str(e),
                }
            data["window"] = window if window in WINDOW_SECONDS else "1h"
            self.js(data)
            return True

        if path in ("/api/system/now", "/system/api/now"):
            self.js(system_now())
            return True
        if path in ("/api/uptime", "/uptime/api"):
            window = _window_from_query(parsed)
            periods = uptime_report()

            self.js(
                {
                    "ts":
                        datetime.now(
                            timezone.utc
                        ).isoformat(),
                    "window": window,
                    "period":
                        periods.get(
                            window,
                            periods.get("12h", {}),
                        ),
                    "periods": periods,
                    "history":
                        uptime_history(window),
                }
            )
            return True
        if path.startswith("/api/system/history") or path.startswith("/system/api/history"):
            window=_window_from_query(parsed); rows=system_history(window=window)
            self.js({"window":window,"cadence_seconds":60,"rows":rows,"aggregate":_aggregate(rows,["recv_bps","sent_bps"]) | _aggregate([{**r,"cpu":(_json_value(r.get("cpu"),{}) if isinstance(r.get("cpu"),str) else r.get("cpu") or {}).get("percent",{}).get("mean"),"memory":(_json_value(r.get("memory"),{}) if isinstance(r.get("memory"),str) else r.get("memory") or {}).get("percent",{}).get("mean")} for r in rows],["cpu","memory"])})
            return True

        # Canonical energy API, with legacy aliases retained locally for compatibility.
        if path in ("/api/energy/now", "/energy/api/now", "/ecoflow/api/now", "/system/api/now"):
            self.js({
                "ts": datetime.now(timezone.utc).isoformat(),
                "enhanced": latest_enhanced(),
                "live": live_now(),
            })
            return True
        if path in ("/api/energy/debug", "/energy/api/debug", "/ecoflow/api/debug", "/system/api/debug"):
            self.js({
                "db_root": str(DB_ROOT),
                "enhanced_db": str(ENHANCED_DB),
                "live_db": str(LIVE_DB),
                "system_db": str(SYSTEM_DB),
                "minute_summary_columns": sorted(cols(ENHANCED_DB, "summary")),
                "snapshots_columns": sorted(cols(LIVE_DB, "snapshots")),
            })
            return True
        if (path.startswith("/api/energy/history") or path.startswith("/energy/api/history")
                or path.startswith("/ecoflow/api/history")):
            window=_window_from_query(parsed); rows=history(window=window)
            self.js({"window":window,"rows":rows,"aggregate":_aggregate(rows,["soc_avg","solar_w_avg","in_w_avg","out_w_avg","net_w_avg","energy_in_wh","energy_out_wh","energy_solar_wh"])})
            return True

        # ---- Directory API ----
        if path in ("/api/directory/status", "/directory/api/status"):
            self.js(
                {
                    "enabled": directory_enabled(),
                    "root": str(DIR_ROOT),
                    "root_exists": DIR_ROOT.is_dir(),
                    "flag": str(DIR_FLAG),
                    "flag_disabled": str(DIR_FLAG_DISABLED),
                }
            )
            return True

        if path in ("/api/directory", "/api/directory/list", "/directory/api/list"):
            if not directory_enabled():
                self.js({"ok": False, "error": "directory service disabled", "enabled": False}, 503)
                return True
            qs = parse_qs(parsed.query)
            rel = (qs.get("path") or qs.get("rel") or [""])[0]
            recursive = (qs.get("recursive") or ["0"])[0] in ("1", "true", "yes")
            try:
                self.js(list_dir(rel, recursive=recursive))
            except ValueError as e:
                self.js({"ok": False, "error": str(e)}, 400)
            except Exception as e:
                self.js({"ok": False, "error": str(e)}, 500)
            return True

        if path in ("/api/directory/file", "/directory/api/file"):
            if not directory_enabled():
                self.js({"ok": False, "error": "directory service disabled", "enabled": False}, 503)
                return True
            qs = parse_qs(parsed.query)
            rel = (qs.get("path") or qs.get("rel") or [""])[0]
            if not rel:
                self.js({"ok": False, "error": "path required"}, 400)
                return True
            try:
                code, body, ct, meta = read_file_safe(rel)
                # For API, always wrap as JSON when Accept prefers json or ?format=json
                fmt = (qs.get("format") or ["auto"])[0]
                accept = self.headers.get("Accept", "")
                if fmt == "json" or "application/json" in accept:
                    text = body.decode("utf-8", errors="replace") if body else ""
                    self.js(
                        {
                            "ok": code == 200,
                            "status": code,
                            "meta": meta,
                            "content": text,
                            "content_type": ct,
                        },
                        200 if code in (200, 403) else code,
                    )
                else:
                    self.sendb(code, body, ct)
            except ValueError as e:
                self.js({"ok": False, "error": str(e)}, 400)
            except Exception as e:
                self.js({"ok": False, "error": str(e)}, 500)
            return True

        return False

    def serve(self, site, rel):
        root = (PAGES_ROOT / site).resolve()
        fp = (root / rel).resolve()
        if not str(fp).startswith(str(root)) or not root.is_dir():
            self.sendb(404, b"not found")
            return
        if fp.is_dir():
            fp = fp / "index.html"
        if fp.is_file():
            self.sendb(200, fp.read_bytes(), mimetypes.guess_type(str(fp))[0] or "application/octet-stream")
        else:
            self.sendb(404, b"not found")

    def serve_media(self, rel):
        root = WEB_MEDIA_ROOT.resolve()
        fp = (root / rel).resolve()
        if not str(fp).startswith(str(root)) or not fp.is_file():
            self.sendb(404, b"not found")
            return
        self.sendb(200, fp.read_bytes(), mimetypes.guess_type(str(fp))[0] or "application/octet-stream")

    def serve_directory_page(self, u=None):
        """SPA shell for /directory — prefers static page, falls back to minimal embed.

        Visual page is served byte-for-byte unchanged. Machine-readable
        discovery of the JSON API is done via an HTTP Link header (RFC 8288)
        instead, so agents/crawlers/tools can find /api/directory/list
        without any change to what a human sees in the browser.
        """
        page = PAGES_ROOT / "avaivy.cloud" / "directory" / "index.html"
        api_link = '<{}>; rel="alternate"; type="application/json"; title="directory-json-api"'.format(
            "/api/directory/list?recursive=1"
        )
        if page.is_file():
            self.sendb(200, page.read_bytes(), extra_headers={"Link": api_link})
            return
        # minimal fallback
        html = """<!doctype html><html><head><meta charset=utf-8><title>Ava Directory</title>
<style>body{font-family:system-ui;background:#0b0d12;color:#d8e6f3;margin:2rem}
a{color:#53d8ff}</style></head><body>
<h1>Ava Directory</h1><p>Static page missing. API is at <code>/api/directory/list</code>.</p>
</body></html>"""
        self.sendb(200, html.encode(), extra_headers={"Link": api_link})

    def _directory_disabled_page(self):
        self.sendb(
            503,
            b"<!doctype html><html><body style='background:#0b0d12;color:#d8e6f3;font-family:system-ui;padding:2rem'>"
            b"<h1>Directory service disabled</h1>"
            b"<p>Toggle it on from the Ava Core Visual CLI (<code>directory-toggle</code>).</p>"
            b"</body></html>",
        )

    def _serve_directory_asset(self, rel: str) -> bool:
        page_root = PAGES_ROOT / "avaivy.cloud" / "directory"
        fp = (page_root / rel).resolve()
        if str(fp).startswith(str(page_root.resolve())) and fp.is_file():
            self.sendb(
                200,
                fp.read_bytes(),
                mimetypes.guess_type(str(fp))[0] or "application/octet-stream",
            )
            return True
        return False

    def do_GET(self):
        u = urlparse(self.path)
        path = u.path
        host = self.headers.get("Host", "").split(":", 1)[0].lower()

        # The localhost server is the canonical truth server. Cloudflare is intentionally
        # irrelevant here: every Ava Ivy page is served from one solid tree.
        dir_host = host in ("directory.avaivy.cloud", "www.directory.avaivy.cloud")

        if self.api(path, u):
            return

        if path in ("/status", "/status/", "/status.html"):
            self.serve("avaivy.cloud", "status/index.html")
            return

        if path in ("/llms.txt", "/.well-known/llms.txt"):
            self.serve("avaivy.cloud", "llms.txt")
            return

        if path.startswith("/web-media/"):
            self.serve_media(path[len("/web-media/"):])
            return

        # The directory UI keeps human-friendly absolute paths in its address bar.
        if path == "/home/ava-core" or path.startswith("/home/ava-core/"):
            self.serve_directory_page()
            return

        # Compatibility aliases used by the older local Ava Ivy page links.
        if path.startswith("/avaivy.cloud/"):
            path = "/" + path[len("/avaivy.cloud/"):]

        # Directory file endpoints remain available on localhost and the optional subdomain.
        if path.startswith("/directory/view") or (dir_host and path.startswith("/view")):
            if not directory_enabled():
                self.sendb(503, b"disabled")
                return
            qs = parse_qs(u.query)
            rel = (qs.get("path") or qs.get("rel") or [""])[0]
            try:
                code, body, ct, _meta = read_file_safe(rel)
                self.sendb(code, body, ct)
            except ValueError as e:
                self.sendb(400, str(e).encode())
            except Exception as e:
                self.sendb(500, str(e).encode())
            return

        if path.startswith("/ava-ivy/file/"):
            if not directory_enabled():
                self.sendb(503, b"disabled")
                return
            rel = unquote(path[len("/ava-ivy/file/"):])
            try:
                code, body, ct, _meta = read_file_safe(rel)
                self.sendb(code, body, ct)
            except ValueError as e:
                self.sendb(400, str(e).encode())
            except Exception as e:
                self.sendb(500, str(e).encode())
            return

        if path.startswith("/directory/") and not path.startswith("/directory/api"):
            rel = path[len("/directory/"):]
            if self._serve_directory_asset(rel):
                return

        if dir_host:
            if not directory_enabled():
                self._directory_disabled_page()
                return
            self.serve_directory_page()
            return


        if path in ("/", "/index.html"):
            self.serve("avaivy.cloud", "index.html")
            return

        # Everything else is resolved strictly inside web/sites/avaivy.cloud.
        rel = path.lstrip("/") or "index.html"
        self.serve("avaivy.cloud", rel)


if __name__ == "__main__":
    print(f"Ava broadcast listening on {PORT}")
    print(f"Directory root: {DIR_ROOT} (enabled={directory_enabled()})")
    ThreadingHTTPServer((HOST, PORT), H).serve_forever()

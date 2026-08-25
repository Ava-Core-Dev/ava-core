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
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse

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
WEB_MEDIA_ROOT = Path("/home/ava-core/web/web-media")
NAME_MAP = {
    "R331ZAB5SG755642": "security",
    "R621ZA16XH6K1155": "Primary",
    "R331ZAB5SG6S2858": "Backup",
}

ALWAYS_ON_DIR = Path(__file__).resolve().parent
DIR_FLAG = ALWAYS_ON_DIR / "directory.enabled"
DIR_FLAG_DISABLED = ALWAYS_ON_DIR / "directory.enabled.disabled"

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
    return q(
        ENHANCED_DB,
        f"""SELECT {fields} FROM summary WHERE id IN
        (SELECT MAX(id) FROM summary GROUP BY COALESCE(name, sn))
        ORDER BY CASE name WHEN 'Primary' THEN 1 WHEN 'security' THEN 2
        WHEN 'Backup' THEN 3 ELSE 9 END""",
    )


def history(hours=12):
    """Return 1-minute EcoFlow history from the canonical database."""
    c = cols(ENHANCED_DB, "summary")
    if not c:
        return []
    wanted = [
        "bucket_key", "ts", "name", "soc_avg", "in_w_avg", "out_w_avg",
        "solar_w_avg", "net_w_avg", "soc_delta", "energy_in_wh",
        "energy_out_wh", "trend", "samples", "load_ratio", "online_pct",
    ]
    fields = ", ".join(select_expr(c, x) for x in wanted)
    rows = q(ENHANCED_DB, f"SELECT {fields} FROM summary ORDER BY bucket_key, name")
    cutoff = datetime.now(timezone.utc).timestamp() - hours * 3600
    out = []
    for r in rows:
        stamp = None
        for key in ("bucket_key", "ts"):
            value = r.get(key)
            if not value:
                continue
            try:
                stamp = datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
                break
            except Exception:
                pass
        if stamp is not None and stamp >= cutoff:
            r["minute_key"] = r.get("bucket_key") or r.get("ts")
            out.append(r)
    return out


def live_now():
    c = cols(LIVE_DB, "snapshots")
    if not c:
        return []
    wanted = ["sn", "online", "soc", "in_w", "out_w", "solar_w", "ts"]
    fields = ", ".join(select_expr(c, x) for x in wanted)
    rows = q(
        LIVE_DB,
        f"SELECT {fields} FROM snapshots WHERE id IN (SELECT MAX(id) FROM snapshots GROUP BY sn)",
    )
    for r in rows:
        r["name"] = NAME_MAP.get(r.get("sn"), r.get("sn"))
    return rows


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


def system_history(hours=12):
    """One-minute host time series for local browser charts."""
    cutoff = int(datetime.now(timezone.utc).timestamp() - hours * 3600)
    rows = {}
    for table, key in (("minute_cpu", "cpu"), ("minute_memory", "memory"), ("minute_battery", "battery")):
        for row in q(SYSTEM_MIN_DB, f"SELECT minute_ts, stats FROM {table} WHERE minute_ts>=? ORDER BY minute_ts", (cutoff,)):
            item = rows.setdefault(row["minute_ts"], {"minute_ts": row["minute_ts"]})
            item[key] = _json_value(row.get("stats"), {})
    for row in q(SYSTEM_MIN_DB, "SELECT minute_ts, stats FROM minute_network WHERE minute_ts>=? ORDER BY minute_ts", (cutoff,)):
        item = rows.setdefault(row["minute_ts"], {"minute_ts": row["minute_ts"]})
        stats = _json_value(row.get("stats"), {})
        item["recv_bps"] = item.get("recv_bps", 0) + float(stats.get("bytes_recv_per_sec") or 0)
        item["sent_bps"] = item.get("sent_bps", 0) + float(stats.get("bytes_sent_per_sec") or 0)
    return [rows[key] for key in sorted(rows)]


def uptime_report():
    """Observed uptime ratios from persistent events, grouped by useful windows."""
    rows = q(UPTIME_DB, "SELECT source_ts_utc, current_uptime_seconds FROM uptime_events ORDER BY source_ts_utc")
    events = []
    for row in rows:
        try:
            events.append((datetime.fromisoformat(str(row["source_ts_utc"]).replace("Z", "+00:00")).timestamp(), float(row["current_uptime_seconds"])))
        except (TypeError, ValueError):
            continue
    now = datetime.now(timezone.utc).timestamp()
    report = {}
    for name, seconds in {"hour": 3600, "day": 86400, "week": 7 * 86400, "month": 30 * 86400, "all_time": None}.items():
        selected = [event for event in events if seconds is None or event[0] >= now - seconds]
        observed = elapsed = 0.0
        for (ts_a, up_a), (ts_b, up_b) in zip(selected, selected[1:]):
            span = max(0.0, ts_b - ts_a)
            elapsed += span
            if up_b >= up_a:
                observed += min(span, up_b - up_a)
        report[name] = {"samples": len(selected), "average_uptime_seconds": (sum(x[1] for x in selected) / len(selected)) if selected else None, "observed_seconds": observed, "window_seconds": elapsed, "availability_percent": (observed / elapsed * 100) if elapsed else None}
    return report


def operations_status():
    """Local scheduler inventory and a current process snapshot for the status page."""
    cron_root = Path("/home/ava-core/operations/cronologicals")
    pending = []
    if cron_root.is_dir():
        for path in sorted(cron_root.rglob("*.py")):
            if "always-on" in path.parts or "__pycache__" in path.parts:
                continue
            pending.append({"path": str(path.relative_to(cron_root)), "enabled": True})
        for path in sorted(cron_root.rglob("*.py.disabled")):
            if "always-on" in path.parts or "__pycache__" in path.parts:
                continue
            pending.append({"path": str(path.relative_to(cron_root))[:-9], "enabled": False})
    try:
        proc = subprocess.run(
            ["ps", "-eo", "pid=,etime=,comm=,args="], text=True,
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=3,
        )
        processes = []
        for line in proc.stdout.splitlines():
            bits = line.strip().split(None, 3)
            if len(bits) >= 3:
                processes.append({"pid": bits[0], "elapsed": bits[1], "name": bits[2], "command": bits[3] if len(bits) > 3 else bits[2]})
    except Exception as e:
        processes = [{"pid": "—", "elapsed": "—", "name": "unavailable", "command": str(e)}]
    return {"pending_crons": pending, "processes": processes}


# ---------------------------------------------------------------------------
# Directory browser — safety helpers
# ---------------------------------------------------------------------------

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
    ok = energy_err is None
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
        if path == "/api/status":
            self.js(build_status())
            return True

        if path in ("/api/system/now", "/system/api/now"):
            self.js(system_now())
            return True
        if path in ("/api/uptime", "/uptime/api"):
            self.js({"ts": datetime.now(timezone.utc).isoformat(), "periods": uptime_report()})
            return True
        if path.startswith("/api/system/history") or path.startswith("/system/api/history"):
            try:
                hours = max(1, min(168, int(parse_qs(parsed.query).get("hours", ["12"])[0])))
            except ValueError:
                hours = 12
            self.js({"hours": hours, "cadence_seconds": 60, "rows": system_history(hours)})
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
                or path.startswith("/ecoflow/api/history") or path.startswith("/system/api/history")):
            try:
                h = max(1, min(168, int(parse_qs(parsed.query).get("hours", ["12"])[0])))
            except Exception:
                h = 12
            self.js({"hours": h, "rows": history(h)})
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

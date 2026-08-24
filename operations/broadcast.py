#!/usr/bin/env python3
"""
Ava broadcast — EcoFlow APIs + static Pages + transparent /directory browser.

Directory root: /home/ava-ivy (falls back to /home/ava-core).
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
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse

HOST = "0.0.0.0"
PORT = 8080
PAGES_ROOT = Path("/home/ava-core/Web/Pages")
ECO_DIR = Path("/home/ava-core/Database/ecoflow")
ENHANCED_DB = ECO_DIR / "ecoflow-data-enhanced.db"
LIVE_DB = ECO_DIR / "ecoflow-data.db"
NAME_MAP = {
    "R331ZAB5SG755642": "security",
    "R621ZA16XH6K1155": "Primary",
    "R331ZAB5SG6S2858": "Backup",
}

ALWAYS_ON_DIR = Path(__file__).resolve().parent
DIR_FLAG = ALWAYS_ON_DIR / "directory.enabled"
DIR_FLAG_DISABLED = ALWAYS_ON_DIR / "directory.enabled.disabled"

# Prefer ava-ivy as requested; fall back to ava-core if that tree is the live home.
_CANDIDATES = [Path("/home/ava-ivy"), Path("/home/ava-core")]
DIR_ROOT = next((p for p in _CANDIDATES if p.is_dir()), _CANDIDATES[0])

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
}
# Names / substrings that must never appear in listings or be readable.
HIDDEN_NAME_PARTS = (
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
    "Credentials",
    "credentials",
    ".ssh",
    ".gnupg",
    ".aws",
    ".config/gcloud",
    "Web/cloudflare",  # contains tunnel tokens / certs
)
# Paths that may be listed but content is never served.
SENSITIVE_PATH_PREFIXES = (
    "Database/sessions",
    "Database/notes",
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
    c = cols(ENHANCED_DB, "minute_summary")
    if not c:
        return []
    wanted = [
        "name",
        "soc_avg",
        "in_w_avg",
        "out_w_avg",
        "solar_w_avg",
        "net_w_avg",
        "soc_delta",
        "energy_in_wh",
        "energy_out_wh",
        "trend",
        "samples",
        "minute_key",
    ]
    fields = ", ".join(select_expr(c, x) for x in wanted)
    group = "name" if "name" in c else "id"
    return q(
        ENHANCED_DB,
        f"""SELECT {fields} FROM minute_summary WHERE id IN
        (SELECT MAX(id) FROM minute_summary GROUP BY {group})
        ORDER BY CASE name WHEN 'Primary' THEN 1 WHEN 'security' THEN 2
        WHEN 'Backup' THEN 3 ELSE 9 END""",
    )


def history(hours=12):
    c = cols(ENHANCED_DB, "minute_summary")
    if not c:
        return []
    wanted = [
        "minute_key",
        "name",
        "soc_avg",
        "in_w_avg",
        "out_w_avg",
        "solar_w_avg",
        "net_w_avg",
        "soc_delta",
        "energy_in_wh",
        "energy_out_wh",
        "trend",
        "samples",
    ]
    fields = ", ".join(select_expr(c, x) for x in wanted)
    if "minute_key" in c:
        cutoff = datetime.now().astimezone().timestamp() - hours * 3600
        rows = q(ENHANCED_DB, f"SELECT {fields} FROM minute_summary ORDER BY minute_key,name")
        out = []
        for r in rows:
            k = str(r.get("minute_key") or "")
            try:
                dt = datetime.fromisoformat(k.replace("Z", "+00:00"))
                stamp = dt.timestamp()
            except Exception:
                continue
            if stamp >= cutoff:
                out.append(r)
        return out
    return []


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

    services = [
        {
            "name": "broadcast",
            "ok": True,
            "detail": f"0.0.0.0:{PORT}",
        },
        {
            "name": "directory",
            "ok": dir_on and DIR_ROOT.is_dir(),
            "detail": str(DIR_ROOT) if dir_on else "disabled",
        },
        {
            "name": "ecoflow_enhanced_db",
            "ok": ENHANCED_DB.is_file(),
            "detail": str(ENHANCED_DB) if ENHANCED_DB.is_file() else "missing",
        },
        {
            "name": "ecoflow_live_db",
            "ok": LIVE_DB.is_file(),
            "detail": str(LIVE_DB) if LIVE_DB.is_file() else "missing",
        },
    ]
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
    ok = all(s["ok"] for s in services) and energy_err is None
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
        "energy": {"units": units, "error": energy_err},
        "links": {
            "json": "/api/status",
            "html": "/status",
            "system": "/avaivy.cloud/system/",
            "directory": "/directory",
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
        if path in ("/api/now", "/system/api/now"):
            self.js(
                {
                    "ts": datetime.now(timezone.utc).isoformat(),
                    "enhanced": latest_enhanced(),
                    "live": live_now(),
                }
            )
            return True
        if path in ("/api/debug", "/system/api/debug"):
            self.js(
                {
                    "enhanced_db": str(ENHANCED_DB),
                    "live_db": str(LIVE_DB),
                    "minute_summary_columns": sorted(cols(ENHANCED_DB, "minute_summary")),
                    "snapshots_columns": sorted(cols(LIVE_DB, "snapshots")),
                }
            )
            return True
        if path.startswith("/api/history") or path.startswith("/system/api/history"):
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

        # directory.avaivy.cloud → live browser at /
        # avaivy.cloud → live browser only at /directory
        dir_host = host in ("directory.avaivy.cloud", "www.directory.avaivy.cloud")
        apex_host = host in ("avaivy.cloud", "www.avaivy.cloud")

        if self.api(path, u):
            return

        # llms.txt — served on every host from a single canonical file,
        # ahead of any host-specific catch-all (e.g. directory.avaivy.cloud's
        # SPA fallback, which would otherwise swallow this path).

        # Public status page (HTML) + already handled JSON in api()
        if path in ("/status", "/status/", "/status.html"):
            page = PAGES_ROOT / "avaivy.cloud" / "status.html"
            if page.is_file():
                self.sendb(200, page.read_bytes(), "text/html; charset=utf-8")
            else:
                # minimal fallback if static file missing
                body = (
                    "<!doctype html><meta charset=utf-8><title>Ava Status</title>"
                    "<p>OK — see <a href=/api/status>/api/status</a></p>"
                ).encode()
                self.sendb(200, body, "text/html; charset=utf-8")
            return

        if path in ("/llms.txt", "/.well-known/llms.txt"):
            llms_fp = PAGES_ROOT / "avaivy.cloud" / "llms.txt"
            if llms_fp.is_file():
                self.sendb(200, llms_fp.read_bytes(), "text/plain; charset=utf-8")
            else:
                self.sendb(404, b"not found", "text/plain; charset=utf-8")
            return

        # File content endpoint (both hosts)
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

        # Clean, crawlable file URLs: /ava-ivy/file/<relative/path/to/file>
        # Same read_file_safe() safety checks as /directory/view — sensitive
        # paths still 403, hidden paths still 404 — just a path-based URL
        # instead of a query string, so agents/tools can address a specific
        # file directly (e.g. https://directory.avaivy.cloud/ava-ivy/file/
        # operations/broadcast.py) without needing JS or an API call first.
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

        # Static assets for the directory UI (css/js) — keep /directory/* working on both hosts
        if path.startswith("/directory/") and not path.startswith("/directory/api"):
            rel = path[len("/directory/") :]
            if self._serve_directory_asset(rel):
                return

        # On dedicated subdomain, also allow /directory.css style roots if referenced
        if dir_host and path in ("/directory.css", "/directory.js"):
            if self._serve_directory_asset(path.lstrip("/")):
                return

        # --- Dedicated host: directory.avaivy.cloud ---
        if dir_host:
            if not directory_enabled():
                self._directory_disabled_page()
                return
            # / and /directory both show the browser
            if path in ("/", "/index.html", "/directory", "/directory/"):
                self.serve_directory_page()
                return
            # unknown path on this host → still directory UI (SPA-ish) or 404
            self.serve_directory_page()
            return

        # --- Apex avaivy.cloud: only /directory is the live browser ---
        if path in ("/directory", "/directory/"):
            if not directory_enabled():
                self._directory_disabled_page()
                return
            self.serve_directory_page()
            return

        if apex_host:
            self.serve("avaivy.cloud", path.lstrip("/") or "index.html")
            return

        if path in ("/system", "/system/"):
            self.send_response(302)
            self.send_header("Location", "/avaivy.cloud/system/")
            self.end_headers()
            return

        if path in ("/", "/index.html"):
            p = PAGES_ROOT / "index.html"
            if p.is_file():
                self.sendb(200, p.read_bytes())
            else:
                self.sendb(404, b"not found")
            return

        parts = [x for x in path.strip("/").split("/") if x]
        if not parts:
            self.sendb(404, b"not found")
            return
        self.serve(parts[0], "/".join(parts[1:]) if len(parts) > 1 else "index.html")


if __name__ == "__main__":
    print(f"Ava broadcast listening on {PORT}")
    print(f"Directory root: {DIR_ROOT} (enabled={directory_enabled()})")
    ThreadingHTTPServer((HOST, PORT), H).serve_forever()

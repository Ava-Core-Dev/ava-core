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
def _resolve_pages_root() -> Path:
    for p in (Path("/home/ava-core/web/Pages"), Path("/home/ava-core/Web/Pages")):
        if p.is_dir():
            return p
    return Path("/home/ava-core/web/Pages")  # prefer lowercase going forward

PAGES_ROOT = _resolve_pages_root()
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
    "web/cloudflare",  # contains tunnel tokens / certs
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

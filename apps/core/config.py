"""
Unified configuration for Ava Core.
Ports config.mjs channel IDs, token loaders, and env vars into Python.
Single source of truth for all apps in this monorepo.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

# ── Home resolution ────────────────────────────────────────────────────────────
_DEFAULT_HOME = Path.home() / "ava"
AVA_HOME = Path(os.getenv("AVA_HOME", str(_DEFAULT_HOME))).expanduser().resolve()

# Load .env from several candidates — first found for each key wins
_ENV_CANDIDATES = [
    Path(__file__).resolve().parent.parent.parent / ".env",   # repo root
    AVA_HOME / ".env",
    Path.cwd() / ".env",
]
for _p in _ENV_CANDIDATES:
    if _p.exists():
        load_dotenv(_p, override=False)

# Re-resolve after env load
AVA_HOME = Path(os.getenv("AVA_HOME", str(AVA_HOME))).expanduser().resolve()

# ── Runtime paths ──────────────────────────────────────────────────────────────
DATA_DIR      = Path(os.getenv("DATA_DIR",      str(AVA_HOME / "data"))).expanduser().resolve()
REPORTS_DIR   = Path(os.getenv("REPORTS_DIR",   str(DATA_DIR / "reports"))).expanduser().resolve()
GENERATED_DIR = Path(os.getenv("GENERATED_DIR", str(DATA_DIR / "generated"))).expanduser().resolve()
LOG_DIR       = Path(os.getenv("LOG_DIR",       str(DATA_DIR / "logs"))).expanduser().resolve()
DB_DIR        = Path(os.getenv("DB_DIR",        str(DATA_DIR / "db"))).expanduser().resolve()
PLUGIN_DIR    = Path(os.getenv("PLUGIN_DIR",    str(AVA_HOME / "plugins"))).expanduser().resolve()

_REPO_ROOT    = Path(__file__).resolve().parent.parent.parent
VOICE_DIR     = _REPO_ROOT / "apps" / "voice"
MEDIA_DIR     = _REPO_ROOT / "apps" / "media"
ASSETS_DIR    = VOICE_DIR / "assets"
MP4_DIR       = Path(os.getenv("MP4_DIR", str(DATA_DIR / "generated" / "mp4"))).expanduser().resolve()
# Prefer staged media library thumbnail; fall back to voice/assets copy
_THUMB_CANDIDATES = [
    MEDIA_DIR / "thumbnails" / "DEFAULT.jpg",
    MEDIA_DIR / "thumbnails" / "thumb-daily-broadcast.jpg",
    ASSETS_DIR / "thumbnail.jpg",
]
THUMBNAIL_PATH = next((p for p in _THUMB_CANDIDATES if p.exists()), _THUMB_CANDIDATES[-1])
PORTRAIT_OPS   = MEDIA_DIR / "portraits" / "ava-desk-ops.png"
PORTRAIT_WAVE  = MEDIA_DIR / "portraits" / "ava-hologram-wave.png"
ICON_1024      = MEDIA_DIR / "brand" / "ava-icon-1024.png"

# ── Server ─────────────────────────────────────────────────────────────────────
def _env_int(key: str, default: int) -> int:
    raw = os.getenv(key, "")
    val = raw.split("#")[0].strip()  # strip inline comments
    return int(val) if val else default


def _first_env(*keys: str, default: str = "") -> str:
    """First non-empty value among aliases. systemd EnvironmentFile keeps inline
    comments in the value, so strip them here too."""
    for key in keys:
        val = os.getenv(key, "").split("#")[0].strip()
        if val:
            return val
    return default

AVA_PORT = _env_int("AVA_PORT", 8787)
def _env_str(key: str, default: str) -> str:
    raw = os.getenv(key, "")
    val = raw.split("#")[0].strip()
    return val.lower() if val else default

AVA_ENV  = _env_str("AVA_ENV", "production")

# ── xAI / Grok ────────────────────────────────────────────────────────────────
XAI_API_KEY  = os.getenv("XAI_API_KEY", "").strip()
GROK_MODEL   = os.getenv("GROK_MODEL", "grok-4.6").strip()
TTS_VOICE    = os.getenv("TTS_VOICE", "ara").strip()
VOICE_MODE   = _env_str("VOICE_MODE", "grok")
MAX_SECONDS  = int(os.getenv("MAX_SECONDS", "55"))

# ── Discord ───────────────────────────────────────────────────────────────────
DISCORD_API     = "https://discord.com/api/v10"
ROOTMC_GUILD_ID = os.getenv("ROOTMC_GUILD_ID", "1516108585740800042").strip()
AVA_BOT_APP_ID  = os.getenv("AVA_DISCORD_APPLICATION_ID", "1532751879875072070").strip()


def discord_bot_token() -> str:
    for key in ("AVA_DISCORD_BOT_TOKEN", "SEXI_DISCORD_BOT_TOKEN",
                "DISCORD_ROOTMC_BOT_TOKEN", "DISCORD_BOT_TOKEN"):
        v = os.getenv(key, "").strip()
        if v:
            return v.removeprefix("Bot ").removeprefix("bot ")
    return ""


# Named Discord channel IDs (ported from AVA_CHANNELS in config.mjs)
DISCORD_CHANNELS: dict[str, str] = {
    "general":           "1516108586307158088",
    "admins":            "1516121832493678612",
    "proposals":         "1526664180491358419",
    "governance":        "1522406451413385317",
    "voting":            "1522413185364398090",
    "constitution":      "1522406019152478210",
    "development":       "1532929974154166522",
    "memes_media":       "1516389376198840421",
    "ava_media":         "1533268458668687392",
    "random_facts":      "1531432703675596942",
    "updates":           "1520665313631408251",   # merged morning summary only
    "automations":       "1535712809399361668",   # hourly cron reports
    "daily_summary":     "1516395175780286615",
    "economy_info":      "1516804780884889621",
    "ava_progress":      "1534974849489965197",
    "hourly_snapshots":  "1528956490831102093",
    "ingame_chat":       "1516706598519832677",
    "livestream_updates": os.getenv("AVA_LIVESTREAM_UPDATES_CHANNEL_ID", "1536631631572377712"),
    "ava_home":          os.getenv("AVA_HOME_CHANNEL_ID", "1516121832493678612"),
    "audit":             os.getenv("AVA_AUDIT_CHANNEL_ID", ""),
    "changelog":         os.getenv("AVA_CHANGELOG_CHANNEL_ID", "1535712809399361668"),
    "work_orders":       "1537366733659185193",
    "kilauea":           "1537290494135111730",
}

# Discord users Ava must never @mention
NEVER_MENTION: set[str] = {
    "788153722198294618",  # ZuppaFredda — opted out of pings
}

# Default channels Ava watches for incoming messages
DEFAULT_WATCH_CHANNELS: list[str] = [
    "1526664180491358419",  # proposals
    "1516121832493678612",  # admins
    "1516108586307158088",  # general
    "1522406451413385317",  # governance
    "1522413185364398090",  # voting
    "1522406019152478210",  # constitution
    "1516389376198840421",  # memes-and-media
    "1532929974154166522",  # development
    "1520665313631408251",  # updates
    "1534974849489965197",  # ava-progress
    "1535712809399361668",  # automations
]

# ── Slack ─────────────────────────────────────────────────────────────────────
def slack_bot_token() -> str:
    return os.getenv("AVA_SLACK_BOT_TOKEN", "").strip()

def slack_app_token() -> str:
    return os.getenv("AVA_SLACK_APP_TOKEN", "").strip()

def slack_bot_user_id() -> str:
    return os.getenv("AVA_SLACK_BOT_USER_ID", "").strip()

SLACK_CHANNELS: dict[str, str] = {
    "dev":         "C0BMCPMDDQR",   # #development-feed
    "plans":       "C0BM4P3GVDX",   # #new-plugin-development-plans
    "automations": "C0BM6KVFS0L",   # #automated-reports
    "crons":       "C0BLMHKTCTH",   # #crons-automation
    "solar_feed":  os.getenv("AVA_SLACK_SOLAR_FEED_CHANNEL", ""),
}

SLACK_OPERATOR_IDS: list[str] = [
    "U0BLWBTGYTU",  # Alexrs94
    "U0BLQ5Q8WTD",  # Alexander Storey
]

# ── Telegram ──────────────────────────────────────────────────────────────────
def telegram_bot_token() -> str:
    return os.getenv("AVA_TELEGRAM_BOT_TOKEN", os.getenv("TELEGRAM_BOT_TOKEN", "")).strip()

def telegram_enabled() -> bool:
    v = os.getenv("AVA_TELEGRAM_ENABLED", "").strip().lower()
    if v in ("0", "false"): return False
    if v in ("1", "true"):  return True
    return bool(telegram_bot_token())

# ── Ollama (local brain) ──────────────────────────────────────────────────────
OLLAMA_URL   = os.getenv("AVA_OLLAMA_URL",   "http://127.0.0.1:11434").strip()
OLLAMA_MODEL = os.getenv("AVA_OLLAMA_MODEL", "ava-ivy").strip()

# ── OBS WebSocket ─────────────────────────────────────────────────────────────
OBS_WS_URL      = os.getenv("OBS_WS_URL",      "ws://localhost:4455").strip()
OBS_WS_PASSWORD = os.getenv("OBS_WS_PASSWORD", "").strip()

# ── Cloudflare ────────────────────────────────────────────────────────────────
# CF_* is the canonical name here; CLOUDFLARE_* is what wrangler and the .env
# use, so accept either rather than silently running without credentials.
CF_API_TOKEN             = _first_env("CF_API_TOKEN", "CLOUDFLARE_API_TOKEN")
# A cfk_-prefixed value is an account API key, not a scoped token: it only
# authenticates via X-Auth-Email/X-Auth-Key. Letting one through as a Bearer
# token yields a 401 that looks like a revoked credential.
if CF_API_TOKEN.startswith("cfk_"):
    CF_API_TOKEN = ""
CF_ACCOUNT_ID            = _first_env("CF_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID")
CF_D1_HEARTBEAT_DB_ID    = _first_env("CF_D1_HEARTBEAT_DB_ID")
CF_EMAIL                 = _first_env("CLOUDFLARE_EMAIL", "CF_EMAIL")
CF_GLOBAL_API_KEY        = _first_env(
    "CLOUDFLARE_API_KEY", "CLOUDFLARE_GLOBAL_API_KEY", "CF_GLOBAL_API_KEY"
)

# ── Scheduler ─────────────────────────────────────────────────────────────────
POLL_INTERVAL    = int(os.getenv("POLL_INTERVAL", "30"))
ENABLE_SCHEDULER = os.getenv("ENABLE_SCHEDULER", "true").lower() in {"1", "true", "yes", "on"}

# ── YouTube ───────────────────────────────────────────────────────────────────
YOUTUBE_API_KEY    = os.getenv("YOUTUBE_API_KEY", "").strip()
YOUTUBE_CHANNEL_ID = os.getenv("YOUTUBE_CHANNEL_ID", "").strip()


def ensure_dirs() -> None:
    for d in (DATA_DIR, REPORTS_DIR, GENERATED_DIR, LOG_DIR, DB_DIR, PLUGIN_DIR, MP4_DIR):
        d.mkdir(parents=True, exist_ok=True)


def as_dict() -> dict[str, Any]:
    return {
        "AVA_HOME":        str(AVA_HOME),
        "AVA_PORT":        AVA_PORT,
        "AVA_ENV":         AVA_ENV,
        "REPORTS_DIR":     str(REPORTS_DIR),
        "GENERATED_DIR":   str(GENERATED_DIR),
        "LOG_DIR":         str(LOG_DIR),
        "VOICE_MODE":      VOICE_MODE,
        "GROK_MODEL":      GROK_MODEL,
        "TTS_VOICE":       TTS_VOICE,
        "OLLAMA_URL":      OLLAMA_URL,
        "OLLAMA_MODEL":    OLLAMA_MODEL,
        "XAI_API_KEY_SET": bool(XAI_API_KEY),
        "DISCORD_BOT_SET": bool(discord_bot_token()),
        "SLACK_BOT_SET":   bool(slack_bot_token()),
        "OBS_WS_URL":      OBS_WS_URL,
    }

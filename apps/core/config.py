"""
Unified configuration for Ava Core.
Ports config.mjs channel IDs, token loaders, and env vars into Python.
Single source of truth for all apps in this monorepo.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from dotenv import dotenv_values, load_dotenv

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
for _p in (
    AVA_HOME / "credentials.env",
    Path.home() / "Ava" / "credentials.env",
    Path(__file__).resolve().parent.parent.parent / "credentials.env",
):
    if _p.exists():
        load_dotenv(_p, override=False)
for _p in (
    AVA_HOME / "credentials.env",
    Path.home() / "Ava" / "credentials.env",
    Path(__file__).resolve().parent.parent.parent / "credentials.env",
):
    if _p.exists():
        load_dotenv(_p, override=False)


def _is_home_stub(path: Path) -> bool:
    """Path('/home/...') on Windows is C:\\home\\... — empty dirs, not the USB media tree."""
    try:
        return str(path.expanduser().resolve()).lower().startswith(r"c:\home")
    except OSError:
        return False


def _windows_dir(env_name: str, default: Path) -> Path:
    """Linux /home/ava-core paths in credentials.env are this user's home on Windows."""
    default = default.expanduser()
    raw = (os.getenv(env_name) or "").strip()
    candidates: list[Path] = []
    if raw:
        if raw.startswith("/home/ava-core"):
            rest = raw[len("/home/ava-core"):].lstrip("/").replace("/", os.sep)
            candidates.append(Path.home() / rest)
        candidates.append(Path(raw))
    candidates.append(default)
    for p in candidates:
        try:
            r = p.expanduser()
            if r.exists() and not _is_home_stub(r):
                return r.resolve()
        except OSError:
            continue
    return default.resolve()


def _media_subpath(env_name: str, default: Path) -> Path:
    """Use public/{type}/{category} when it exists. Skip Linux /home and C:\\home stubs."""
    default = default.expanduser()
    raw = (os.getenv(env_name) or "").strip()
    if not raw or raw.startswith("/home/") or _is_home_stub(Path(raw)):
        return default.resolve()
    p = Path(raw).expanduser()
    try:
        if p.exists() and not _is_home_stub(p):
            return p.resolve()
    except OSError:
        pass
    return default.resolve()


# ── Runtime paths ──────────────────────────────────────────────────────────────
# One media library: $AVA_HOME/Media
# Layout: public/{type}/{category}/  and  private/{type}/{category}/
# No second copy in private if the file is already public.
_REPO_ROOT    = Path(__file__).resolve().parent.parent.parent
VOICE_DIR     = _windows_dir("VOICE_DIR", _REPO_ROOT / "apps" / "voice")
MEDIA_DIR     = _windows_dir("AVA_MEDIA_DIR", AVA_HOME / "Media")
PUBLIC_MEDIA  = MEDIA_DIR / "public"
PRIVATE_MEDIA = MEDIA_DIR / "private"

DATA_DIR      = _windows_dir("DATA_DIR", AVA_HOME / "Data")
REPORTS_DIR   = _media_subpath("REPORTS_DIR", PUBLIC_MEDIA / "documents" / "reports")
GENERATED_DIR = _media_subpath("GENERATED_DIR", PUBLIC_MEDIA / "audio" / "voice" / "generated")
LOG_DIR       = _windows_dir("LOG_DIR", PRIVATE_MEDIA / "documents" / "logs")
DB_DIR        = _windows_dir("DB_DIR", DATA_DIR / "db")
PLUGIN_DIR    = _windows_dir("PLUGIN_DIR", AVA_HOME / "Plugins")
AUTOMATION_DROP_DIR = Path(
    os.getenv(
        "AVA_AUTOMATION_DROP_DIR",
        str(_REPO_ROOT / "tools" / "Automated New Python Scripts Confirmed Working for Automation Drag and Drop"),
    )
).expanduser().resolve()
ASSETS_DIR    = PUBLIC_MEDIA / "audio"   # words / numbers / time_clips / sounds / station / reports
MP4_DIR       = _media_subpath("MP4_DIR", PUBLIC_MEDIA / "video" / "current")
AUDIO_CURRENT_DIR = _media_subpath("AUDIO_CURRENT_DIR", PUBLIC_MEDIA / "audio" / "current")
VIDEO_REPORTS_DIR = _media_subpath("VIDEO_REPORTS_DIR", PUBLIC_MEDIA / "video" / "reports")
YOUTUBE_AUDIO_DIR = _media_subpath("YOUTUBE_AUDIO_DIR", PUBLIC_MEDIA / "audio" / "youtube")
YOUTUBE_VIDEO_DIR = _media_subpath("YOUTUBE_VIDEO_DIR", PUBLIC_MEDIA / "video" / "youtube")

_THUMB_CANDIDATES = [
    PUBLIC_MEDIA / "images" / "thumbnails" / "DEFAULT.jpg",
    PUBLIC_MEDIA / "images" / "thumbnails" / "thumb-daily-broadcast.jpg",
    PUBLIC_MEDIA / "images" / "thumnails" / "DEFAULT.jpg",
    ASSETS_DIR / "thumbnail.jpg",
]
THUMBNAIL_PATH = next((p for p in _THUMB_CANDIDATES if p.exists()), _THUMB_CANDIDATES[0])
_DAILY_THUMB_CANDIDATES = [
    PUBLIC_MEDIA / "images" / "thumbnails" / "thumb-daily-broadcast.jpg",
    THUMBNAIL_PATH,
]
DAILY_BROADCAST_THUMB = next(
    (p for p in _DAILY_THUMB_CANDIDATES if p and Path(p).exists()),
    _DAILY_THUMB_CANDIDATES[0],
)
_PORTRAIT_OPS_CANDIDATES = [
    PUBLIC_MEDIA / "images" / "character" / "ava-desk-ops.png",
    PUBLIC_MEDIA / "images" / "character" / "ava-05-desk-root-server.png",
]
_PORTRAIT_WAVE_CANDIDATES = [
    PUBLIC_MEDIA / "images" / "character" / "ava-hologram-wave.png",
    PUBLIC_MEDIA / "images" / "thumbnails" / "thumb-main-hologram-wave.jpg",
    PUBLIC_MEDIA / "images" / "emojis" / "discord" / "ava_wave.png",
]
PORTRAIT_OPS = next((p for p in _PORTRAIT_OPS_CANDIDATES if p.exists()), _PORTRAIT_OPS_CANDIDATES[0])
PORTRAIT_WAVE = next((p for p in _PORTRAIT_WAVE_CANDIDATES if p.exists()), _PORTRAIT_WAVE_CANDIDATES[0])
ICON_1024      = PUBLIC_MEDIA / "images" / "brand" / "ava-icon-1024.png"

MEDIA_SUBDIRS = (
    "public/audio/station", "public/audio/reports", "public/audio/crons",
    "public/audio/words", "public/audio/numbers",
    "public/audio/time_clips", "public/audio/sounds", "public/audio/voice",
    "public/audio/voice/generated", "public/audio/current", "public/audio/youtube",
    "public/video/clips", "public/video/reports", "public/video/current",
    "public/video/appearance", "public/video/youtube",
    "public/images/channels", "public/images/character", "public/images/thumbnails",
    "public/images/discord", "public/images/slack", "public/images/telegram",
    "public/images/brand", "public/images/emojis/discord", "public/images/qrcodes",
    "public/images/imports", "public/images/nhc/current", "public/images/nhc/archive",
    "public/documents/discord", "public/documents/reports", "public/documents/slack",
    "public/documents/telegram", "public/documents/persona", "public/documents/notes",
    "public/documents/plans", "public/documents/docs",
    "public/stream/overlays", "public/stream/obs-cams",
    "private/1-1/discord", "private/1-1/slack", "private/1-1/telegram",
    "private/life-story", "private/profiling", "private/accounts",
    "private/users", "private/documents/logs", "private/documents/vercel-builds",
    "private/documents/notes/alex", "private/documents/persona",
)

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
XAI_API_KEY  = _first_env("XAI_API_KEY", "AVA_XAI_API_KEY", "SEXI_XAI_API_KEY")
GROK_MODEL   = _first_env("GROK_MODEL", "AVA_GROK_MODEL", default="grok-4.6")
TTS_VOICE    = os.getenv("TTS_VOICE", "ara").strip()
VOICE_MODE   = _env_str("VOICE_MODE", "grok")
MAX_SECONDS  = int(os.getenv("MAX_SECONDS", "55"))
CURSOR_API_KEY = _first_env("CURSOR_API_KEY")
# Cursor ask-mode fallback when Grok credits are dead. Keep this rare.
CURSOR_FALLBACK = _env_str("AVA_CURSOR_FALLBACK", "1") not in {"0", "false", "no"}
CURSOR_MAX_PER_DAY = _env_int("AVA_CURSOR_MAX_PER_DAY", 2)
CURSOR_MIN_HOURS = _env_int("AVA_CURSOR_MIN_HOURS", 6)
GROK_DOWN_HOURS = _env_int("AVA_GROK_DOWN_HOURS", 12)


def vercel_token() -> str:
    return _first_env("VERCEL_TOKEN", "VERCEL_API_TOKEN")


def vercel_team_id() -> str:
    return _first_env("VERCEL_TEAM_ID", "VERCEL_ORG_ID")


def vercel_webhook_secret() -> str:
    return _first_env("VERCEL_WEBHOOK_SECRET")

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
# Ava's public home — reports, automations, and global chat all land here.
_raw_home = os.getenv("AVA_HOME_CHANNEL_ID", "1539779979280257054").strip()
AVA_DISCORD_HOME = (
    _raw_home
    if _raw_home and _raw_home != "1516121832493678612"
    else "1539779979280257054"
)

DISCORD_CHANNELS: dict[str, str] = {
    "general":           "1545284354157187083",
    "admins":            "1516121832493678612",
    "proposals":         "1526664180491358419",
    "governance":        "1522406451413385317",
    "voting":            "1522413185364398090",
    "constitution":      "1522406019152478210",
    "development":       "1532929974154166522",
    "memes_media":       "1516389376198840421",
    "ava_media":         "1533268458668687392",
    "random_facts":      "1531432703675596942",
    "updates":           "1545284423740563528",   # pointer / forwards only — not report dump
    # Real #automations (economy + cron posts). Override with DISCORD_AUTOMATIONS_CHANNEL_ID.
    "automations":       os.getenv("DISCORD_AUTOMATIONS_CHANNEL_ID", "1545284463783710720").strip()
                         or "1545284463783710720",
    "daily_summary":     AVA_DISCORD_HOME,
    # Live economy stats land in #automations unless DISCORD_ECONOMY_STATS_CHANNEL_ID is set.
    "economy_info":      os.getenv(
                             "DISCORD_ECONOMY_STATS_CHANNEL_ID",
                             os.getenv("DISCORD_AUTOMATIONS_CHANNEL_ID", "1545284463783710720"),
                         ).strip()
                         or "1545284463783710720",
    "ava_progress":      AVA_DISCORD_HOME,
    "hourly_snapshots":  AVA_DISCORD_HOME,
    "ingame_chat":       "1545284399107547179",
    "livestream_updates": os.getenv("AVA_LIVESTREAM_UPDATES_CHANNEL_ID", "1545284480812449793"),
    "ava_home":          AVA_DISCORD_HOME,
    "audit":             os.getenv("AVA_AUDIT_CHANNEL_ID", ""),
    "changelog":         AVA_DISCORD_HOME,
    "work_orders":       "1537366733659185193",
    "kilauea":           AVA_DISCORD_HOME,
}

# Discord users Ava must never @mention
NEVER_MENTION: set[str] = {
    "788153722198294618",  # ZuppaFredda — opted out of pings
}

# Default channels Ava watches for incoming messages
DEFAULT_WATCH_CHANNELS: list[str] = [
    # #proposals 1526664180491358419 404s — skip until the channel exists again
    "1516121832493678612",  # admins
    "1545284354157187083",  # general
    "1522406451413385317",  # governance
    "1522413185364398090",  # voting
    "1522406019152478210",  # constitution
    "1516389376198840421",  # memes-and-media
    "1532929974154166522",  # development
    "1545284423740563528",  # updates
    AVA_DISCORD_HOME,       # Ava home — reports + global chat
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
OLLAMA_MODEL = os.getenv("AVA_OLLAMA_MODEL", "llama3.2:latest").strip()
OLLAMA_EMBED_MODEL = os.getenv("AVA_OLLAMA_EMBED_MODEL", "nomic-embed-text").strip()
OLLAMA_CODER_MODEL = os.getenv("AVA_OLLAMA_CODER_MODEL", "qwen2.5-coder:7b").strip()
# llama3.2 defaulted to 2048 unless we send options.num_ctx. Cap 8192 on 16 GB.
OLLAMA_NUM_CTX = min(8192, max(2048, _env_int("AVA_OLLAMA_NUM_CTX", 4096)))

# Public fundraising / goals UI. Off until inventory is sorted.
PUBLIC_GOALS = os.getenv("AVA_PUBLIC_GOALS", "0").lower() in {"1", "true", "yes", "on"}
# OBS / chime / broadcast_loop. Off until OBS is confirmed on this PC.
ENABLE_OBS = os.getenv("AVA_ENABLE_OBS", "0").lower() in {"1", "true", "yes", "on"}
# 1=heartbeat+weather/kilauea/ecoflow … 6=full clone including OBS jobs (OBS still no-ops unless ENABLE_OBS).
CRON_WAVE = _env_int("AVA_CRON_WAVE", 6)
# Worker-facing tunnel hostname (not rootmc.net).
AVA_ORIGIN_PUBLIC = os.getenv("AVA_ORIGIN_URL", "https://origin.avaivy.cloud").strip()

# ── Minecraft / RCON ──────────────────────────────────────────────────────────
# Paper test server working directory. Override with ROOTMC_TEST_DIR.
MC_TEST_DIR = Path(
    _first_env(
        "ROOTMC_TEST_DIR",
        default=str(AVA_HOME / "workstations" / "minecraft-test"),
    )
).expanduser()

# The Paper test server runs on this box, so probe loopback. The LAN address in
# ROOTMC_PRIMARY_JOIN is what players connect to and is reported separately.
MC_TEST_HOST   = _first_env("ROOTMC_TEST_HOST", default="127.0.0.1")
MC_TEST_PORT   = _env_int("ROOTMC_TEST_PORT", 24945)
MC_LIVE_HOST   = _first_env("ROOTMC_PLAY_HOST", default="play.rootmc.net")
MC_LIVE_PORT   = _env_int("ROOTMC_PLAY_PORT", 25565)
# Ava origin calls RootMC's API as a client. Never bind Ava routes to this host.
ROOTMC_API_BASE = _first_env("ROOTMC_API_BASE", default="https://api.rootmc.net").rstrip("/")
# Live Worker behind api.rootmc.net (packages/workers/src/rootmc-api/worker.ts).
ROOTMC_API_UPSTREAM = _first_env(
    "ROOTMC_API_UPSTREAM", default="https://rootmc-api.root-337.workers.dev"
).rstrip("/")
MC_UNIT        = _first_env("ROOTMC_TEST_UNIT", default="ava-minecraft-test")
MC_TEST_JOIN   = _first_env("ROOTMC_PRIMARY_JOIN", default="")

RCON_DEFAULT_TARGET = _first_env("AVA_RCON_DEFAULT_TARGET", default="test")

# target name → (host, port, password)
RCON_TARGETS: dict[str, tuple[str, int, str]] = {
    "test": (
        _first_env("AVA_RCON_TEST_HOST", default="127.0.0.1"),
        _env_int("AVA_RCON_TEST_PORT", 25575),
        _first_env("AVA_RCON_TEST_PASSWORD"),
    ),
    "primary": (
        _first_env("AVA_RCON_PRIMARY_HOST", "ROOTMC_PRIMARY_RCON_HOST"),
        _env_int("AVA_RCON_PRIMARY_PORT", 21531),
        _first_env("AVA_RCON_PRIMARY_PASSWORD"),
    ),
    "prod": (
        _first_env("AVA_RCON_PROD_HOST"),
        _env_int("AVA_RCON_PROD_PORT", 21531),
        _first_env("AVA_RCON_PROD_PASSWORD"),
    ),
    "claims": (
        _first_env("AVA_RCON_CLAIMS_HOST"),
        _env_int("AVA_RCON_CLAIMS_PORT", 27355),
        _first_env("AVA_RCON_PASSWORD"),
    ),
    "towny": (
        _first_env("AVA_RCON_TOWNY_HOST"),
        _env_int("AVA_RCON_TOWNY_PORT", 21531),
        _first_env("AVA_RCON_TOWNY_PASSWORD"),
    ),
}


# ── OBS WebSocket ─────────────────────────────────────────────────────────────
OBS_WS_URL      = os.getenv("OBS_WS_URL",      "ws://localhost:4455").strip()
OBS_WS_PASSWORD = os.getenv("OBS_WS_PASSWORD", "").strip()

# ── Cloudflare ────────────────────────────────────────────────────────────────
# CF_* is the canonical name here; CLOUDFLARE_* is what wrangler and the .env
# use, so accept either rather than silently running without credentials.
CF_API_TOKEN             = _first_env("CF_API_TOKEN", "CLOUDFLARE_API_TOKEN")
# Gmail-account token for Zone DNS Edit + Bulk/Single Redirects. Empty until
# the operator pastes it into repo-root .env. Not used as the Workers bearer.
CF_DNS_TOKEN             = _first_env("CLOUDFLARE_DNS_TOKEN")
# A cfk_-prefixed value is an account API key, not a scoped token: it only
# authenticates via X-Auth-Email/X-Auth-Key. Letting one through as a Bearer
# token yields a 401 that looks like a revoked credential.
if CF_API_TOKEN.startswith("cfk_"):
    CF_API_TOKEN = ""
if CF_DNS_TOKEN.startswith("cfk_"):
    CF_DNS_TOKEN = ""
CF_ACCOUNT_ID            = _first_env("CF_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID")
CF_D1_HEARTBEAT_DB_ID    = _first_env("CF_D1_HEARTBEAT_DB_ID")
CF_D1_ROOTMC_DB_ID       = _first_env("CF_D1_ROOTMC_DB_ID", "D1_ROOTMC_LIVE_ID")
CF_D1_ROOTMC_ACCOUNT_ID  = _first_env("ROOTMC_CLOUDFLARE_ACCOUNT_ID")
CF_D1_ACCOUNT_DB_ID      = _first_env("CF_D1_ACCOUNT_DB_ID", "D1_DATABASE_ID")
# license_accounts live on the Root Record D1 (account 2b317e91…), not the
# Ava/workers account that holds ava-heartbeat + rootmc-live (d2daf263…).
CF_D1_ACCOUNT_ACCOUNT_ID = _first_env(
    "CF_D1_ACCOUNT_ACCOUNT_ID", "ROOTRECORD_CLOUDFLARE_ACCOUNT_ID"
)
CF_D1_ACCOUNT_EMAIL      = _first_env("CF_D1_ACCOUNT_EMAIL")
CF_D1_ACCOUNT_API_KEY    = _first_env("CF_D1_ACCOUNT_API_KEY")
CF_HYPERDRIVE_ROOTMC_ID  = _first_env("CF_HYPERDRIVE_ROOTMC_ID", "HYPERDRIVE_ROOTMC_ID")
CF_EMAIL                 = _first_env("CLOUDFLARE_EMAIL", "CF_EMAIL")
CF_GLOBAL_API_KEY        = _first_env(
    "CLOUDFLARE_API_KEY", "CLOUDFLARE_GLOBAL_API_KEY", "CF_GLOBAL_API_KEY"
)
# Process env + credentials.env can mix Root Record email with the Ava API
# key (401 / 7403 on ava-heartbeat). Heartbeat and rootmc-live always use the
# pair written in the repo .env unless CF_WORKERS_* is set.
_REPO_DOTENV = dotenv_values(_REPO_ROOT / ".env")
CF_WORKERS_EMAIL = (
    _first_env("CF_WORKERS_EMAIL")
    or (_REPO_DOTENV.get("CLOUDFLARE_EMAIL") or "").strip()
    or CF_EMAIL
)
CF_WORKERS_API_KEY = (
    _first_env("CF_WORKERS_API_KEY")
    or (_REPO_DOTENV.get("CLOUDFLARE_API_KEY") or "").strip()
    or CF_GLOBAL_API_KEY
)

# ── Scheduler ─────────────────────────────────────────────────────────────────
POLL_INTERVAL    = int(os.getenv("POLL_INTERVAL", "30"))
ENABLE_SCHEDULER = os.getenv("ENABLE_SCHEDULER", "true").lower() in {"1", "true", "yes", "on"}


def hst_now_text(*, date_first: bool = False) -> str:
    """Local HST-ish clock label. Windows strftime has no Linux ``%-d``."""
    from datetime import datetime

    now = datetime.now()
    if date_first:
        return f"{now:%a, %b }{now.day}, {now:%H:%M HST}"
    return f"{now:%H:%M HST — %a, %b }{now.day}"

# ── YouTube ───────────────────────────────────────────────────────────────────
YOUTUBE_API_KEY     = os.getenv("YOUTUBE_API_KEY", "").strip()
YOUTUBE_CHANNEL_ID  = (
    os.getenv("YOUTUBE_CHANNEL_ID", "").strip() or "UC6M7U4fXAWuVYhgm_veKecA"
)
YOUTUBE_CHANNEL_URL = (
    os.getenv("YOUTUBE_CHANNEL_URL", "").strip()
    or "https://www.youtube.com/@AvaIvyRootMC/live"
)


def ensure_dirs() -> None:
    for d in (
        DATA_DIR, REPORTS_DIR, GENERATED_DIR, LOG_DIR, DB_DIR, PLUGIN_DIR,
        MP4_DIR, AUDIO_CURRENT_DIR, VIDEO_REPORTS_DIR, MEDIA_DIR,
        PUBLIC_MEDIA, PRIVATE_MEDIA,
    ):
        d.mkdir(parents=True, exist_ok=True)
    from apps.core.services.data_layout import ensure_data_layout
    ensure_data_layout()
    for sub in MEDIA_SUBDIRS:
        try:
            (MEDIA_DIR / sub).mkdir(parents=True, exist_ok=True)
        except OSError:
            # Junction / Windows path limits / missing USB parent — do not take origin down.
            continue
    # Older code writes audio/generated — keep that as an alias of voice/generated.
    compat = PUBLIC_MEDIA / "audio" / "generated"
    if compat.is_symlink() or compat.exists():
        return
    try:
        compat.symlink_to("voice/generated")
    except OSError:
        compat.mkdir(parents=True, exist_ok=True)


def as_dict() -> dict[str, Any]:
    return {
        "AVA_HOME":        str(AVA_HOME),
        "AVA_PORT":        AVA_PORT,
        "AVA_ENV":         AVA_ENV,
        "MEDIA_DIR":       str(MEDIA_DIR),
        "PUBLIC_MEDIA":    str(PUBLIC_MEDIA),
        "PRIVATE_MEDIA":   str(PRIVATE_MEDIA),
        "ASSETS_DIR":      str(ASSETS_DIR),
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

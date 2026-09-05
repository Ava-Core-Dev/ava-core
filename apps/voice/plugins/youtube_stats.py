"""
YouTube Stats Plugin
====================
Polls YouTube channel statistics via the official Data API v3,
stores snapshots in SQLite, detects meaningful changes, and
produces a short Ara voice report (≤ 60 s).

Config (.env):
  YOUTUBE_API_KEY=AIza...
  YOUTUBE_CHANNEL_IDS=UCxxxxxxxx,UCyyyyyyyy   # comma-separated

Behaviour:
  - Data poll every 15 minutes (via tick)
  - Voice report on significant change OR on demand
  - Always starts with "YouTube Report at <time>."
"""

from __future__ import annotations

import json
import logging
import sqlite3
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

from apps.voice.plugin import Plugin
from apps.core import config

log = logging.getLogger("ava.plugin.youtube")

HST = ZoneInfo("Pacific/Honolulu")
DB_PATH = config.AVA_HOME / "Data" / "youtube_stats.db"
API_BASE = "https://www.googleapis.com/youtube/v3"


class YouTubeStatsPlugin(Plugin):
    name = "youtube_stats"
    version = "1.0.0"
    description = "YouTube channel stats + change detection → 60s Ara voice report"

    def __init__(self, core=None):
        super().__init__(core)
        self._last_poll = 0.0
        self.api_key = (config.XAI_API_KEY and None)  # placeholder; real key below
        self.api_key = __import__("os").getenv("YOUTUBE_API_KEY", "").strip()
        raw_ids = __import__("os").getenv("YOUTUBE_CHANNEL_IDS", "").strip()
        self.channel_ids = [c.strip() for c in raw_ids.split(",") if c.strip()]

    def on_load(self) -> None:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()
        if not self.api_key:
            log.warning("YOUTUBE_API_KEY not set – plugin will be idle until configured")
        if not self.channel_ids:
            log.warning("YOUTUBE_CHANNEL_IDS not set – add at least one channel ID")
        log.info(
            "YouTubeStatsPlugin loaded  channels=%s  key_set=%s",
            self.channel_ids or "(none)",
            bool(self.api_key),
        )

    def run(self, force: bool = False, **kwargs):
        self._poll(force=True)
        return self._maybe_voice(force=True)

    def on_hour(self) -> None:
        # Stats poll only — Grok TTS soft-disabled (local clips own desk audio).
        self._poll()
        log.info("Hourly YouTube stats — voice skipped (Grok TTS soft-disabled; use local clip services)")

    def tick(self) -> None:
        now = time.time()
        if now - self._last_poll >= 15 * 60:
            self._poll()
            self._last_poll = now
            # Voice soft-disabled; keep DB snapshots only.

    # ------------------------------------------------------------------
    def _init_db(self) -> None:
        with sqlite3.connect(DB_PATH) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS snapshots (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    channel_id TEXT NOT NULL,
                    title TEXT,
                    fetched_at TEXT NOT NULL,
                    subscriber_count INTEGER,
                    view_count INTEGER,
                    video_count INTEGER,
                    hidden_subscribers INTEGER,
                    raw_json TEXT
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS meta (
                    key TEXT PRIMARY KEY,
                    value TEXT
                )
            """)
            conn.commit()

    def _poll(self, force: bool = False) -> None:
        if not self.api_key or not self.channel_ids:
            return
        log.info("Polling YouTube stats for %d channel(s)…", len(self.channel_ids))
        for cid in self.channel_ids:
            try:
                data = self._fetch_channel(cid)
                if data:
                    self._save(cid, data)
            except Exception as e:
                log.warning("Channel %s failed: %s", cid, e)
            time.sleep(0.3)
        log.info("YouTube poll complete")

    def _fetch_channel(self, channel_id: str) -> dict | None:
        params = {
            "part": "snippet,statistics",
            "id": channel_id,
            "key": self.api_key,
        }
        r = requests.get(f"{API_BASE}/channels", params=params, timeout=20)
        r.raise_for_status()
        items = r.json().get("items") or []
        return items[0] if items else None

    def _save(self, channel_id: str, data: dict) -> None:
        snip = data.get("snippet") or {}
        stats = data.get("statistics") or {}
        fetched = datetime.now(HST).isoformat()
        with sqlite3.connect(DB_PATH) as conn:
            conn.execute(
                """INSERT INTO snapshots
                   (channel_id, title, fetched_at, subscriber_count, view_count,
                    video_count, hidden_subscribers, raw_json)
                   VALUES (?,?,?,?,?,?,?,?)""",
                (
                    channel_id,
                    snip.get("title"),
                    fetched,
                    int(stats.get("subscriberCount") or 0),
                    int(stats.get("viewCount") or 0),
                    int(stats.get("videoCount") or 0),
                    1 if stats.get("hiddenSubscriberCount") else 0,
                    json.dumps(data),
                ),
            )
            conn.commit()

    def _latest_and_previous(self, channel_id: str) -> tuple[dict | None, dict | None]:
        with sqlite3.connect(DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """SELECT * FROM snapshots
                   WHERE channel_id = ?
                   ORDER BY id DESC LIMIT 2""",
                (channel_id,),
            ).fetchall()
        if not rows:
            return None, None
        latest = dict(rows[0])
        prev = dict(rows[1]) if len(rows) > 1 else None
        return latest, prev

    def _detect_changes(self) -> list[str]:
        """Return human-readable change lines (empty if nothing notable)."""
        lines = []
        for cid in self.channel_ids:
            latest, prev = self._latest_and_previous(cid)
            if not latest:
                continue
            title = latest.get("title") or cid
            subs = latest["subscriber_count"]
            views = latest["view_count"]
            videos = latest["video_count"]

            if not prev:
                lines.append(f"{title}: {subs:,} subscribers, {views:,} views, {videos} videos.")
                continue

            d_subs = subs - prev["subscriber_count"]
            d_views = views - prev["view_count"]
            d_videos = videos - prev["video_count"]

            bits = [f"{title}:"]
            if d_subs:
                bits.append(f"{d_subs:+,} subscribers (now {subs:,})")
            else:
                bits.append(f"{subs:,} subscribers")
            if d_views:
                bits.append(f"{d_views:+,} views (now {views:,})")
            else:
                bits.append(f"{views:,} total views")
            if d_videos:
                bits.append(f"{d_videos:+} videos (now {videos})")
            lines.append(" ".join(bits) + ".")
        return lines

    def _maybe_voice(self, force: bool = False) -> Path | None:
        # Soft-disable paid Grok/xAI TTS — SQLite polls stay; no Current.mp3 writes.
        log.info(
            "Grok/xAI TTS soft-disabled — skip YouTube_Current.mp3; "
            "use local clip services instead"
        )
        return None

    def _summarize(self, raw: str) -> str | None:
        from ava_core.xai_client import chat, XAIError

        now = datetime.now(HST).strftime("%-I %M %p").replace(" 0", " ")
        system = f"""You are Ara, calm clear voice for channel statistics.
Turn the YouTube stats into ONE short spoken report (under 60 seconds, max ~150 words).

ALWAYS begin with exactly: "YouTube Report at {now}."

Then summarize subscriber, view, and video counts and any changes in plain English.
No markdown, no lists. End cleanly.
"""
        user = f"Stats:\n{raw}\n\nStart with the title line then continue."
        try:
            return chat(
                [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                temperature=0.3,
                max_tokens=250,
            )
        except XAIError as e:
            log.error("%s", e)
            return None

    def _tts(self, text: str, out_path: Path) -> None:
        from ava_core.xai_client import tts
        tts(text, out_path)

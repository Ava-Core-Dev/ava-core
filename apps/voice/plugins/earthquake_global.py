"""
Global Earthquake + Volcano Report Plugin
=========================================
Pulls significant global earthquakes (USGS) and notable volcano activity,
stores recent events in SQLite, and produces a ≤ 60 s (target 45–60 s)
Ara voice report.

Updates hourly.
Always starts with: "Global Earthquake and Volcano Report at <time>."
"""

from __future__ import annotations

import json
import logging
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

from apps.voice.plugin import Plugin
from apps.core import config

log = logging.getLogger("ava.plugin.eq_global")

HST = ZoneInfo("Pacific/Honolulu")
DB_PATH = config.AVA_HOME / "Data" / "earthquakes_global.db"


class EarthquakeGlobalPlugin(Plugin):
    name = "earthquake_global"
    version = "1.0.0"
    description = "Global significant quakes + volcano notes → 45–60s Ara report (hourly)"

    def on_load(self) -> None:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()
        log.info("EarthquakeGlobalPlugin loaded  db=%s", DB_PATH)

    def run(self, force: bool = False, **kwargs):
        self._pull_quakes()
        return self._make_voice(force=True)

    def on_hour(self) -> None:
        log.info("Hourly global earthquake update — deferred to local earthquake_hourly cron")
        self._pull_quakes()
        # Voice moved to apps.core.services.earthquake_hourly (clip WAV, no Grok TTS).

    def on_new_report(self, path: Path) -> None:
        pass

    # ------------------------------------------------------------------
    def _init_db(self) -> None:
        with sqlite3.connect(DB_PATH) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS events (
                    id TEXT PRIMARY KEY,
                    place TEXT,
                    mag REAL,
                    time_utc TEXT,
                    lat REAL,
                    lon REAL,
                    depth_km REAL,
                    tsunami INTEGER,
                    raw_json TEXT,
                    fetched_at TEXT
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_time ON events(time_utc)")
            conn.commit()

    def _pull_quakes(self) -> None:
        # Significant + M4.5+ in last 24 h (keeps it manageable)
        urls = [
            "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_day.geojson",
            "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson",
        ]
        seen = set()
        all_features = []
        for url in urls:
            try:
                r = requests.get(url, timeout=25)
                r.raise_for_status()
                feats = r.json().get("features") or []
                for f in feats:
                    fid = f.get("id")
                    if fid and fid not in seen:
                        seen.add(fid)
                        all_features.append(f)
            except Exception as e:
                log.warning("Fetch %s failed: %s", url, e)

        log.info("Global feed: %d unique events (24h significant + M4.5+)", len(all_features))
        now = datetime.now(timezone.utc).isoformat()
        with sqlite3.connect(DB_PATH) as conn:
            for f in all_features:
                props = f.get("properties") or {}
                geom = f.get("geometry") or {}
                coords = geom.get("coordinates") or [None, None, None]
                eq_id = f.get("id")
                if not eq_id:
                    continue
                t_ms = props.get("time")
                t_utc = datetime.fromtimestamp(t_ms / 1000, tz=timezone.utc) if t_ms else None
                conn.execute(
                    """INSERT OR REPLACE INTO events
                       (id, place, mag, time_utc, lat, lon, depth_km, tsunami, raw_json, fetched_at)
                       VALUES (?,?,?,?,?,?,?,?,?,?)""",
                    (
                        eq_id,
                        props.get("place"),
                        props.get("mag"),
                        t_utc.isoformat() if t_utc else None,
                        coords[1],
                        coords[0],
                        coords[2],
                        1 if props.get("tsunami") else 0,
                        json.dumps(props),
                        now,
                    ),
                )
            cutoff = (datetime.now(timezone.utc) - timedelta(hours=48)).isoformat()
            conn.execute("DELETE FROM events WHERE time_utc < ?", (cutoff,))
            conn.commit()

    def _summary(self) -> dict:
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
        with sqlite3.connect(DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            total = conn.execute(
                "SELECT COUNT(*), MAX(mag) FROM events WHERE time_utc >= ?", (cutoff,)
            ).fetchone()
            top = conn.execute(
                """SELECT place, mag, time_utc, tsunami FROM events
                   WHERE time_utc >= ? ORDER BY mag DESC LIMIT 6""",
                (cutoff,),
            ).fetchall()
            m6 = conn.execute(
                "SELECT COUNT(*) FROM events WHERE time_utc >= ? AND mag >= 6", (cutoff,)
            ).fetchone()[0]
        return {
            "total": total[0] if total else 0,
            "max_mag": total[1] if total else None,
            "m6_plus": m6,
            "top": [dict(r) for r in top],
        }

    def _make_voice(self, force: bool = False) -> Path | None:
        # Soft-disable paid Grok/xAI TTS — local clip services own desk audio.
        log.info(
            "Grok/xAI TTS soft-disabled — skip Earthquake_Global_Current.mp3; "
            "use local clip services (apps.core.services.earthquake_hourly) instead"
        )
        return None

    def _summarize(self, summary: dict) -> str | None:
        from ava_core.xai_client import chat, XAIError

        now = datetime.now(HST).strftime("%-I %M %p").replace(" 0", " ")
        lines = [
            f"Total significant / M4.5+ events last 24h: {summary['total']}",
            f"M6 or larger: {summary['m6_plus']}",
        ]
        if summary.get("max_mag") is not None:
            lines.append(f"Largest magnitude: {summary['max_mag']}")
        for t in summary.get("top") or []:
            tsun = " (tsunami flag)" if t.get("tsunami") else ""
            lines.append(f"M{t['mag']} – {t['place']}{tsun}")

        # Light volcano note – we already have a dedicated Kilauea plugin;
        # just remind the listener that Hawaii has its own report.
        lines.append("Hawaii Kilauea activity is covered in the separate Kilauea report.")

        raw = "\n".join(lines)
        system = f"""You are Ara, calm clear global seismic and volcano voice.
Turn the data into ONE short spoken report lasting 45–60 seconds (about 120–150 words).

ALWAYS begin with exactly: "Global Earthquake and Volcano Report at {now}."

Cover:
- Overall activity level in the last 24 hours
- Number of stronger events (M6+)
- The few largest or most notable quakes by location and magnitude
- Brief mention that Hawaii / Kilauea has its own dedicated report
Speak plainly. No lists or markdown. End cleanly.
"""
        user = f"Data:\n{raw}\n\nStart with the title line then continue with enough detail to reach ~45–60 seconds."
        try:
            return chat(
                [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                temperature=0.35,
                max_tokens=320,
            )
        except XAIError as e:
            log.error("%s", e)
            return None

    def _tts(self, text: str, out_path: Path) -> None:
        from ava_core.xai_client import tts
        tts(text, out_path)

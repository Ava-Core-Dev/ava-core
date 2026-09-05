"""
Hawaii Earthquake Plugin
========================
Pulls USGS earthquakes near the Hawaiian Islands (especially Big Island),
stores 24-hour history in SQLite, and produces a ≤ 60 s Ara voice report.

Updates hourly (on_hour) and on demand.
Always starts with: "Hawaii Earthquake Report at <time>."
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

log = logging.getLogger("ava.plugin.eq_hawaii")

HST = ZoneInfo("Pacific/Honolulu")
DB_PATH = config.AVA_HOME / "Data" / "earthquakes.db"

# Rough bounding box around the Hawaiian Islands
HAWAII_BBOX = {
    "minlatitude": 18.5,
    "maxlatitude": 22.5,
    "minlongitude": -160.5,
    "maxlongitude": -154.5,
}


class EarthquakeHawaiiPlugin(Plugin):
    name = "earthquake_hawaii"
    version = "1.0.0"
    description = "Hawaii / Big Island 24h earthquake totals → 60s Ara report (hourly)"

    def on_load(self) -> None:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()
        log.info("EarthquakeHawaiiPlugin loaded  db=%s", DB_PATH)

    def run(self, force: bool = False, **kwargs):
        self._pull()
        return self._make_voice(force=True)

    def on_hour(self) -> None:
        log.info("Hourly Hawaii earthquake update — deferred to local earthquake_hourly cron")
        self._pull()
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
                    time_hst TEXT,
                    lat REAL,
                    lon REAL,
                    depth_km REAL,
                    region TEXT,
                    raw_json TEXT,
                    fetched_at TEXT
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_time ON events(time_utc)")
            conn.commit()

    def _pull(self) -> None:
        # USGS FDSN query – last 24 h, Hawaii box, M≥1.0
        start = (datetime.now(timezone.utc) - timedelta(hours=24)).strftime("%Y-%m-%dT%H:%M:%S")
        params = {
            "format": "geojson",
            "starttime": start,
            "minmagnitude": 1.0,
            **HAWAII_BBOX,
            "orderby": "time",
        }
        try:
            r = requests.get(
                "https://earthquake.usgs.gov/fdsnws/event/1/query",
                params=params,
                timeout=30,
            )
            r.raise_for_status()
            data = r.json()
        except Exception as e:
            log.error("USGS fetch failed: %s", e)
            return

        features = data.get("features") or []
        log.info("USGS returned %d Hawaii-region events (24h)", len(features))

        now = datetime.now(timezone.utc).isoformat()
        with sqlite3.connect(DB_PATH) as conn:
            for f in features:
                props = f.get("properties") or {}
                geom = f.get("geometry") or {}
                coords = geom.get("coordinates") or [None, None, None]
                eq_id = f.get("id") or props.get("code")
                if not eq_id:
                    continue
                t_ms = props.get("time")
                t_utc = datetime.fromtimestamp(t_ms / 1000, tz=timezone.utc) if t_ms else None
                t_hst = t_utc.astimezone(HST).isoformat() if t_utc else None

                # Simple region tag
                place = props.get("place") or ""
                region = "Hawaii Island"
                if "maui" in place.lower() or "kahului" in place.lower():
                    region = "Maui"
                elif "oahu" in place.lower() or "honolulu" in place.lower():
                    region = "Oahu"
                elif "kauai" in place.lower() or "lihue" in place.lower():
                    region = "Kauai"

                conn.execute(
                    """INSERT OR REPLACE INTO events
                       (id, place, mag, time_utc, time_hst, lat, lon, depth_km, region, raw_json, fetched_at)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        eq_id,
                        place,
                        props.get("mag"),
                        t_utc.isoformat() if t_utc else None,
                        t_hst,
                        coords[1],
                        coords[0],
                        coords[2],
                        region,
                        json.dumps(props),
                        now,
                    ),
                )
            # prune older than 48 h
            cutoff = (datetime.now(timezone.utc) - timedelta(hours=48)).isoformat()
            conn.execute("DELETE FROM events WHERE time_utc < ?", (cutoff,))
            conn.commit()

    def _summary_rows(self) -> dict:
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
        with sqlite3.connect(DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """SELECT region, COUNT(*) as cnt, MAX(mag) as max_mag, AVG(mag) as avg_mag
                   FROM events WHERE time_utc >= ?
                   GROUP BY region ORDER BY cnt DESC""",
                (cutoff,),
            ).fetchall()
            total = conn.execute(
                "SELECT COUNT(*), MAX(mag) FROM events WHERE time_utc >= ?", (cutoff,)
            ).fetchone()
            largest = conn.execute(
                """SELECT place, mag, time_hst FROM events
                   WHERE time_utc >= ? ORDER BY mag DESC LIMIT 3""",
                (cutoff,),
            ).fetchall()
        return {
            "by_region": [dict(r) for r in rows],
            "total": total[0] if total else 0,
            "max_mag": total[1] if total else None,
            "largest": [dict(r) for r in largest],
        }

    def _make_voice(self, force: bool = False) -> Path | None:
        # Soft-disable paid Grok/xAI TTS — local clip services own desk audio.
        log.info(
            "Grok/xAI TTS soft-disabled — skip Earthquake_Hawaii_Current.mp3; "
            "use local clip services (apps.core.services.earthquake_hourly) instead"
        )
        return None

    def _summarize(self, summary: dict) -> str | None:
        from ava_core.xai_client import chat, XAIError

        now = datetime.now(HST).strftime("%-I %M %p").replace(" 0", " ")
        lines = [f"Total events last 24 hours: {summary['total']}"]
        if summary.get("max_mag") is not None:
            lines.append(f"Largest magnitude: {summary['max_mag']}")
        for r in summary.get("by_region") or []:
            lines.append(f"{r['region']}: {r['cnt']} events, max {r['max_mag']}")
        for L in summary.get("largest") or []:
            lines.append(f"Notable: M{L['mag']} – {L['place']} at {L['time_hst']}")

        raw = "\n".join(lines)
        system = f"""You are Ara, calm clear Hawaii seismic voice.
Turn the 24-hour earthquake totals into ONE short spoken report (45–60 seconds, about 120–150 words).

ALWAYS begin with exactly: "Hawaii Earthquake Report at {now}."

Focus on Big Island / Hawaii Island first, then other islands if present.
Mention total count, largest magnitude, and any notable events in plain English.
If there were zero events, say so calmly. End cleanly.
"""
        user = f"Data:\n{raw}\n\nStart with the title line then continue."
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

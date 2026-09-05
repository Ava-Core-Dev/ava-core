"""
NWS Weather Plugin
==================
Pulls National Weather Service data for all Hawaiian Islands / counties
via api.weather.gov, stores snapshots in SQLite, and produces short
Ara voice reports (target ≤ 30 s).

Schedule:
  - Data refresh every 15 minutes
  - Voice reports: on boot, 05:00 HST, 17:00 HST
  - Also available on demand via --run nws_weather

Focus locations (Big Island villages + major islands):
  Mountain View, Volcano (HVO), Hilo, Kailua-Kona,
  Honolulu, Kahului, Lihue + statewide summary.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import requests

from apps.voice.plugin import Plugin
from apps.core import config

log = logging.getLogger("ava.plugin.nws")

HST = ZoneInfo("Pacific/Honolulu")
USER_AGENT = "(AvaCore, ava-core@local; educational Hawaii weather)"

# Key points across the islands (lat, lon, friendly name, island/county tag)
LOCATIONS = [
    # Hawaiʻi Island (Big Island)
    (19.5500, -155.1000, "Mountain View", "Hawaii"),
    (19.4300, -155.2600, "Volcano Observatory", "Hawaii"),
    (19.7297, -155.0900, "Hilo", "Hawaii"),
    (19.6400, -155.9969, "Kailua-Kona", "Hawaii"),
    # Maui
    (20.8893, -156.4729, "Kahului", "Maui"),
    # Oʻahu
    (21.3069, -157.8583, "Honolulu", "Honolulu"),
    # Kauaʻi
    (21.9811, -159.3711, "Lihue", "Kauai"),
]

DB_PATH = config.AVA_HOME / "Data" / "nws_weather.db"


class NWSWeatherPlugin(Plugin):
    name = "nws_weather"
    version = "1.0.0"
    description = "NWS Hawaii multi-island weather → SQLite + 60s Ara voice reports (5am/5pm + 15min data)"

    def __init__(self, core=None):
        super().__init__(core)
        self._last_data_pull = 0.0
        self._last_voice_hour: int | None = None
        self._boot_done = False

    def on_load(self) -> None:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()
        log.info("NWSWeatherPlugin loaded  db=%s", DB_PATH)

    def run(self, force: bool = False, **kwargs):
        """Force a full data pull + voice report."""
        self._pull_all(force=True)
        return self._make_voice_report(force=True)

    def on_hour(self) -> None:
        # Data is refreshed by the 15-min tick; Grok TTS soft-disabled (local clips own voice).
        log.info("Hourly NWS tick — voice skipped (Grok TTS soft-disabled; use local clip services)")

    def on_new_report(self, path: Path) -> None:
        pass  # independent of solar/system reports

    # Called from core loop every POLL_INTERVAL – we throttle to 15 min
    def tick(self) -> None:
        now = time.time()
        if now - self._last_data_pull >= 15 * 60:
            self._pull_all()
            self._last_data_pull = now

        if not self._boot_done:
            self._boot_done = True
            log.info("Boot-time NWS — data path only; Grok TTS soft-disabled")

    # ------------------------------------------------------------------
    # SQLite
    # ------------------------------------------------------------------
    def _init_db(self) -> None:
        with sqlite3.connect(DB_PATH) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS forecasts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    location TEXT NOT NULL,
                    island TEXT,
                    fetched_at TEXT NOT NULL,
                    period_name TEXT,
                    temperature INTEGER,
                    temperature_unit TEXT,
                    wind_speed TEXT,
                    wind_direction TEXT,
                    short_forecast TEXT,
                    detailed_forecast TEXT,
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

    def _save_forecast(self, location: str, island: str, periods: list[dict], raw: dict) -> None:
        fetched = datetime.now(timezone.utc).isoformat()
        with sqlite3.connect(DB_PATH) as conn:
            # Keep only the latest 2 periods per location to stay light
            conn.execute("DELETE FROM forecasts WHERE location = ?", (location,))
            for p in periods[:4]:
                conn.execute(
                    """INSERT INTO forecasts
                       (location, island, fetched_at, period_name, temperature,
                        temperature_unit, wind_speed, wind_direction,
                        short_forecast, detailed_forecast, raw_json)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        location,
                        island,
                        fetched,
                        p.get("name"),
                        p.get("temperature"),
                        p.get("temperatureUnit"),
                        p.get("windSpeed"),
                        p.get("windDirection"),
                        p.get("shortForecast"),
                        p.get("detailedForecast"),
                        json.dumps(p),
                    ),
                )
            conn.commit()

    def _latest_summary_rows(self) -> list[dict]:
        with sqlite3.connect(DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """SELECT location, island, period_name, temperature,
                          temperature_unit, wind_speed, short_forecast
                   FROM forecasts
                   WHERE period_name IN ('Today','This Afternoon','Tonight','Overnight','This Morning')
                      OR id IN (
                          SELECT MAX(id) FROM forecasts GROUP BY location
                      )
                   ORDER BY island, location"""
            ).fetchall()
            return [dict(r) for r in rows]

    # ------------------------------------------------------------------
    # NWS API
    # ------------------------------------------------------------------
    def _pull_all(self, force: bool = False) -> None:
        log.info("Pulling NWS forecasts for %d locations…", len(LOCATIONS))
        headers = {"User-Agent": USER_AGENT, "Accept": "application/geo+json"}
        for lat, lon, name, island in LOCATIONS:
            try:
                # 1) resolve grid
                pt = requests.get(
                    f"https://api.weather.gov/points/{lat},{lon}",
                    headers=headers,
                    timeout=20,
                )
                pt.raise_for_status()
                props = pt.json()["properties"]
                forecast_url = props["forecast"]

                # 2) get 12-h forecast
                fc = requests.get(forecast_url, headers=headers, timeout=20)
                fc.raise_for_status()
                periods = fc.json()["properties"]["periods"]
                self._save_forecast(name, island, periods, fc.json())
                log.debug("  %s (%s) ok", name, island)
            except Exception as e:
                log.warning("  %s failed: %s", name, e)
            time.sleep(0.4)  # be polite to the API
        log.info("NWS data pull complete")

    # ------------------------------------------------------------------
    # Voice report (≤ 30 s target)
    # ------------------------------------------------------------------
    def _make_voice_report(self, force: bool = False) -> Path | None:
        # Soft-disable paid Grok/xAI TTS — SQLite pulls stay; no Current.mp3 writes.
        log.info(
            "Grok/xAI TTS soft-disabled — skip NWS_Hawaii_Current.mp3; "
            "use local clip services (apps.core.services.nws_hawaii) instead"
        )
        return None

    def _summarize(self, raw: str) -> str | None:
        from ava_core.xai_client import chat, XAIError

        system = f"""You are Ara, calm clear Hawaii weather voice.
Turn the multi-island NWS snapshot into ONE short spoken report.
Hard limit: 45–60 seconds when spoken (about 120–150 words).

ALWAYS begin with exactly: "NWS Hawaii Report at <time>."
Example: "NWS Hawaii Report at 5 00 AM."

Then cover:
- Big Island highlights (Mountain View / Volcano / Hilo / Kona) first
- Then one-line each for Maui, Oahu, Kauai if data present
- Mention any notable wind, rain, or temperature extremes
- Plain English only, no lists or markdown. End cleanly.
"""
        now = datetime.now(HST).strftime("%-I %M %p").replace(" 0", " ")
        user = f"Current local time for the title: {now}\n\nCurrent NWS data:\n{raw}\n\nStart with: \"NWS Hawaii Report at {now}.\" Then continue with the spoken content only."
        try:
            return chat(
                [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                temperature=0.3,
                max_tokens=220,
            )
        except XAIError as e:
            log.error("%s", e)
            return None

    def _tts(self, text: str, out_path: Path) -> None:
        from ava_core.xai_client import tts
        tts(text, out_path)

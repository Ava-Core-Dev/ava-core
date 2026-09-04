"""
Open-Meteo Weather Plugin (backup / extra)
==========================================
Free, no-key weather for key Hawaii points via Open-Meteo.
Complements the NWS plugin. Hourly voice report, 45–60 s.
"""

from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

from apps.voice.plugin import Plugin
from apps.core import config

log = logging.getLogger("ava.plugin.open_meteo")
HST = ZoneInfo("Pacific/Honolulu")

POINTS = [
    (19.55, -155.10, "Mountain View"),
    (19.43, -155.26, "Volcano"),
    (19.73, -155.09, "Hilo"),
    (19.64, -156.00, "Kailua-Kona"),
    (21.31, -157.86, "Honolulu"),
    (20.89, -156.47, "Kahului"),
    (21.98, -159.37, "Lihue"),
]


class OpenMeteoPlugin(Plugin):
    name = "open_meteo"
    version = "1.0.0"
    description = "Open-Meteo Hawaii weather backup → 45–60s Ara report (hourly)"

    def on_load(self) -> None:
        log.info("OpenMeteoPlugin loaded")

    def run(self, force: bool = False, **kwargs):
        return self._make_voice(force=True)

    def on_hour(self) -> None:
        self._make_voice(force=True)

    def on_new_report(self, path: Path) -> None:
        pass

    def _fetch(self) -> list[str]:
        lines = []
        for lat, lon, name in POINTS:
            try:
                r = requests.get(
                    "https://api.open-meteo.com/v1/forecast",
                    params={
                        "latitude": lat,
                        "longitude": lon,
                        "current_weather": "true",
                        "temperature_unit": "fahrenheit",
                        "windspeed_unit": "mph",
                        "timezone": "Pacific/Honolulu",
                    },
                    timeout=15,
                )
                r.raise_for_status()
                cw = r.json().get("current_weather") or {}
                lines.append(
                    f"{name}: {cw.get('temperature')} F, "
                    f"wind {cw.get('windspeed')} mph, "
                    f"code {cw.get('weathercode')}"
                )
            except Exception as e:
                log.warning("%s failed: %s", name, e)
        return lines

    def _make_voice(self, force: bool = False) -> Path | None:
        if config.VOICE_MODE == "disabled":
            return None
        from apps.core.services import xai
        if xai.grok_is_down():
            log.info("Grok down — skip Open-Meteo grok voice")
            return None
        lines = self._fetch()
        if not lines:
            return None
        spoken = self._summarize("\n".join(lines))
        if not spoken:
            return None
        log.info("Open-Meteo Ara script:\n%s", spoken)

        stamp = datetime.now(HST).strftime("%Y-%m-%dT%H")
        archive = config.GENERATED_DIR / f"open-meteo-{stamp}.mp3"
        current = config.GENERATED_DIR / "OpenMeteo_Current.mp3"
        try:
            self._tts(spoken, archive)
            import shutil
            shutil.copy2(archive, current)
            log.info("Saved OpenMeteo_Current.mp3")
            try:
                from ava_core.mp4_converter import convert_if_needed
                convert_if_needed(current)
            except Exception:
                pass
            return current
        except Exception as e:
            log.error("TTS failed: %s", e)
            return None

    def _summarize(self, raw: str) -> str | None:
        from ava_core.xai_client import chat, XAIError

        now = datetime.now(HST).strftime("%-I %M %p").replace(" 0", " ")
        system = f"""You are Ara, calm Hawaii weather voice.
Turn the Open-Meteo snapshot into ONE spoken report lasting 45–60 seconds (about 120–150 words).

ALWAYS begin with exactly: "Open Meteo Weather Report at {now}."

Cover Big Island points first (Mountain View, Volcano, Hilo, Kona), then the other islands.
Speak temperatures and winds naturally. Plain English, no lists. End cleanly.
"""
        user = f"Data:\n{raw}\n\nStart with the title then give a full 45–60 second report."
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

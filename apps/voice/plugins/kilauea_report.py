"""
Kilauea Report Plugin
=====================
Fetches the latest Hawaiian Volcano Observatory (HVO) notice for Kīlauea,
asks Grok to turn it into a short spoken summary (45–60 s), then synthesizes
with the Ara voice.

Only regenerates the MP3 when:
  - Kilauea_Current.mp3 is missing, OR
  - the source notice content has changed (hash comparison)

Output:
  generated/Kilauea_Current.mp3
  generated/kilauea-YYYY-MM-DDTHH.mp3  (archive)
"""

from __future__ import annotations

import hashlib
import logging
import re
import shutil
from datetime import datetime
from pathlib import Path

import requests

from apps.voice.plugin import Plugin
from apps.core import config

log = logging.getLogger("ava.plugin.kilauea")

HANS_LIST = "https://volcanoes.usgs.gov/hans-public/"
HANS_NOTICE = "https://volcanoes.usgs.gov/hans-public/notice/{id}"
USER_AGENT = "AvaCore/1.0 (Kilauea status reader; educational)"


class KilaueaReportPlugin(Plugin):
    name = "kilauea_report"
    version = "1.0.0"
    description = "Latest HVO Kīlauea notice → short Ara voice report (only on change)"

    def on_load(self) -> None:
        log.info("KilaueaReportPlugin loaded")

    def run(self, force: bool = False, **kwargs):
        return self._generate(force=force)

    def on_hour(self) -> None:
        # Voice moved off paid Grok TTS; local clip / report services own desk audio.
        log.info("Hourly Kilauea update — Grok TTS soft-disabled (no Kilauea_Current.mp3)")

    def on_new_report(self, path: Path) -> None:
        # Ignore solar/system reports – this plugin is independent
        pass

    # ------------------------------------------------------------------
    def _generate(self, force: bool = False):
        # Soft-disable paid Grok/xAI TTS — keep plugin loaded; no Current.mp3 writes.
        log.info(
            "Grok/xAI TTS soft-disabled — skip Kilauea_Current.mp3; "
            "use local clip services (report/clip stitch) instead"
        )
        return None

    # ------------------------------------------------------------------
    def _fetch_latest_notice(self) -> tuple[str, str]:
        headers = {"User-Agent": USER_AGENT}
        r = requests.get(HANS_LIST, headers=headers, timeout=30)
        r.raise_for_status()
        # Find the newest DOI-USGS-HVO-… id
        ids = re.findall(r"DOI-USGS-HVO-[\dT:+\-]+", r.text)
        if not ids:
            raise RuntimeError("No HVO notice IDs found on list page")
        notice_id = ids[0]  # first = newest

        url = HANS_NOTICE.format(id=notice_id)
        r2 = requests.get(url, headers=headers, timeout=30)
        r2.raise_for_status()

        # Strip tags roughly and keep the useful paragraphs
        text = re.sub(r"<script[^>]*>.*?</script>", " ", r2.text, flags=re.S | re.I)
        text = re.sub(r"<style[^>]*>.*?</style>", " ", text, flags=re.S | re.I)
        text = re.sub(r"<[^>]+>", "\n", text)
        text = re.sub(r"[ \t]+", " ", text)
        text = re.sub(r"\n{3,}", "\n\n", text).strip()

        # Keep only the Kilauea-relevant portion if possible
        if "KĪLAUEA" in text or "Kilauea" in text:
            # Start from the first Kilauea heading
            m = re.search(r"(KĪLAUEA|Kilauea).*", text, re.S)
            if m:
                text = m.group(0)[:6000]  # hard cap

        return notice_id, text

    def _summarize_with_grok(self, raw: str) -> str | None:
        from apps.core.services import synth

        now = datetime.now().strftime("%-I %M %p").replace(" 0", " ")
        system = """You are Ara, a calm clear voice for Hawaii volcano status.
Turn the official HVO Kīlauea notice into ONE short spoken report (45–60 seconds, about 120–150 words).

Rules:
- Plain spoken English only. No markdown, bullets, or stage directions.
- ALWAYS begin with exactly: "Kilauea Report at <time>."
- Then cover: current alert level / aviation code, whether it is erupting or paused, last episode if relevant, and the most important next forecast or hazard note.
- Skip instrument noise, long hazard lists, and links.
- Near the end, add one short natural sentence advertising the Kilauea Alerts app.
- End cleanly after that.
"""
        user = (
            f"Current local time for the title: {now}\n\n"
            f"Official notice text:\n\n{raw[:4500]}\n\n"
            f"Start with: \"Kilauea Report at {now}.\" Then continue with the spoken content only."
        )
        factual = (
            f"Kilauea Report at {now}. "
            "Here is the latest Hawaiian Volcano Observatory notice, unedited for honesty. "
            + " ".join(raw.split())[:900]
        )
        return synth.polish("kilauea", system, user, factual=factual, channel="kilauea")

    def _tts(self, text: str, out_path: Path) -> None:
        from ava_core.xai_client import tts
        tts(text, out_path)

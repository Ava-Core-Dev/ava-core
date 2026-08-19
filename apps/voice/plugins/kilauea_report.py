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
        # Check once an hour – only rebuilds if content changed
        self._generate(force=False)

    def on_new_report(self, path: Path) -> None:
        # Ignore solar/system reports – this plugin is independent
        pass

    # ------------------------------------------------------------------
    def _generate(self, force: bool = False):
        if config.VOICE_MODE == "disabled":
            log.info("VOICE_MODE=disabled – skipping Kilauea report")
            return None

        current_mp3 = config.GENERATED_DIR / "Kilauea_Current.mp3"
        state_file = config.GENERATED_DIR / ".kilauea_last_hash"

        try:
            notice_id, raw_text = self._fetch_latest_notice()
        except Exception as e:
            log.error("Failed to fetch HVO notice: %s", e)
            return None

        content_hash = hashlib.sha256(raw_text.encode("utf-8")).hexdigest()[:16]

        # Skip if nothing changed and the MP3 already exists
        if not force and current_mp3.exists() and state_file.exists():
            if state_file.read_text().strip() == content_hash:
                log.info("Kilauea content unchanged – keeping existing MP3")
                return current_mp3

        log.info("New/changed Kilauea notice (%s) – generating voice report", notice_id)

        # Ask Grok for a short spoken summary
        spoken = self._summarize_with_grok(raw_text)
        if not spoken:
            return None

        log.info("Ara script:\n%s", spoken)

        # TTS
        stamp = datetime.now().strftime("%Y-%m-%dT%H")
        archive = config.GENERATED_DIR / f"kilauea-{stamp}.mp3"
        try:
            self._tts(spoken, archive)
            shutil.copy2(archive, current_mp3)
            state_file.write_text(content_hash)
            log.info("Saved Kilauea_Current.mp3  (+ archive %s)", archive.name)
            try:
                from ava_core.mp4_converter import convert_if_needed
                convert_if_needed(current_mp3)
            except Exception:
                pass
            return current_mp3
        except Exception as e:
            log.error("TTS failed: %s", e)
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
        from ava_core.xai_client import chat, XAIError

        system = """You are Ara, a calm clear voice for Hawaii volcano status.
Turn the official HVO Kīlauea notice into ONE short spoken report (45–60 seconds, about 120–150 words).

Rules:
- Plain spoken English only. No markdown, bullets, or stage directions.
- ALWAYS begin with exactly: "Kilauea Report at <time>."
  Example: "Kilauea Report at 12 34 AM."
- Then cover: current alert level / aviation code, whether it is erupting or paused, last episode if relevant, and the most important next forecast or hazard note.
- Skip instrument noise, long hazard lists, and links.
- Near the end, add one short natural sentence advertising the Kilauea Alerts app, for example:
  "For real-time alerts on your phone, get the Kilauea Alerts app."
  Keep it brief and conversational — do not make it sound like a hard sales pitch.
- End cleanly after that.
"""

        from datetime import datetime
        now = datetime.now().strftime("%-I %M %p").replace(" 0", " ")
        user = f"Current local time for the title: {now}\n\nOfficial notice text:\n\n{raw[:4500]}\n\nStart with: \"Kilauea Report at {now}.\" Then continue with the spoken content only."

        try:
            return chat(
                [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                temperature=0.3,
                max_tokens=340,
            )
        except XAIError as e:
            log.error("%s", e)
            return None

    def _tts(self, text: str, out_path: Path) -> None:
        from ava_core.xai_client import tts
        tts(text, out_path)

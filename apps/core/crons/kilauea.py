"""
Kīlauea / USGS + HVO cron.
Hourly poll. Hash ignores the clock so unchanged data does not republish.
Grok/Cursor polish is queued; facts still go out immediately.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path

import httpx

log = logging.getLogger("ava.cron.kilauea")

USGS_QUAKE_URL = (
    "https://earthquake.usgs.gov/fdsnws/event/1/query"
    "?format=geojson&minmagnitude=1&maxradiuskm=150"
    "&latitude=19.421&longitude=-155.287&orderby=time&limit=20"
)
HANS_LIST = "https://volcanoes.usgs.gov/hans-public/"
HANS_NOTICE = "https://volcanoes.usgs.gov/hans-public/notice/{id}"
HVO_UA = {"User-Agent": "AvaIvy/2.0 rootmc.net"}

_last_hash: str = ""

MULTIPLIERS = {
    "normal":   1.0,
    "advisory": 2.0,
    "watch":    2.5,
    "eruption": 3.0,
}


def _event_fingerprint(features: list) -> str:
    rows = []
    for f in features[:8]:
        props = f.get("properties") or {}
        rows.append(f"{f.get('id')}|{props.get('mag')}|{props.get('place')}")
    return "\n".join(rows)


async def _fetch_hvo(client: httpx.AsyncClient) -> tuple[str, str]:
    r = await client.get(HANS_LIST)
    r.raise_for_status()
    ids = re.findall(r"DOI-USGS-HVO-[\dT:+\-]+", r.text)
    if not ids:
        return "", ""
    notice_id = ids[0]
    r2 = await client.get(HANS_NOTICE.format(id=notice_id))
    r2.raise_for_status()
    text = re.sub(r"<script[^>]*>.*?</script>", " ", r2.text, flags=re.S | re.I)
    text = re.sub(r"<style[^>]*>.*?</style>", " ", text, flags=re.S | re.I)
    text = re.sub(r"<[^>]+>", "\n", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    m = re.search(r"(KĪLAUEA|Kilauea).*", text, re.S)
    if m:
        text = m.group(0)[:4000]
    return notice_id, text


async def run():
    global _last_hash
    log.info("Kīlauea cron running  %s", datetime.now(timezone.utc).isoformat())
    try:
        async with httpx.AsyncClient(timeout=20, headers=HVO_UA) as client:
            r = await client.get(USGS_QUAKE_URL)
            if r.status_code != 200:
                log.warning("USGS quake fetch failed: %s", r.status_code)
                return
            features = r.json().get("features", [])
            notice_id, hvo_text = "", ""
            try:
                notice_id, hvo_text = await _fetch_hvo(client)
            except Exception as e:
                log.warning("HVO fetch failed: %s", e)

            fp = hashlib.md5(f"{notice_id}\n{_event_fingerprint(features)}".encode()).hexdigest()
            if fp == _last_hash:
                log.debug("Kīlauea: no change since last run")
                return
            _last_hash = fp

            from apps.core import config
            from apps.core.services import reports, synth

            lines = [
                f"# Kīlauea\n",
                f"HVO notice: {notice_id or 'none'}\n",
                f"USGS events M≥1 ≤150km: {len(features)}\n",
            ]
            for f in features[:5]:
                props = f.get("properties") or {}
                lines.append(
                    f"- M{props.get('mag', '?')} {props.get('place', '?')} — {props.get('type', '?')}"
                )
            if hvo_text:
                lines.append("\n## HVO excerpt\n")
                lines.append(hvo_text[:1800])
            factual = "\n".join(lines)

            system = (
                "You are Ava Ivy. Write a short public Kīlauea status for Discord. "
                "Use only the source text. No invented alert levels or numbers. "
                "Cover: alert/aviation if stated, erupting or paused, last episode if given, "
                "one hazard note. Under 220 words. No vendor names."
            )
            user = factual[:4500]
            content = synth.polish(
                "kilauea", system, user, factual=factual[:1900], channel="kilauea"
            )

            report_path = config.REPORTS_DIR / f"kilauea-{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H')}.md"
            report_path.write_text(content)
            log.info("Kīlauea report written: %s", report_path.name)
            await reports.publish("kilauea", content[:1900], channel="kilauea")

            alert_level = _infer_alert_level(features, hvo_text)
            _write_alert_state(config, alert_level)

    except Exception:
        log.exception("Kīlauea cron failed")


def _infer_alert_level(features: list, hvo_text: str) -> str:
    blob = (hvo_text or "").lower()
    if "eruption" in blob or "erupting" in blob or " aviation color code red" in blob:
        return "eruption"
    if "watch" in blob or "orange" in blob:
        return "watch"
    if "advisory" in blob or "yellow" in blob:
        return "advisory"
    if not features:
        return "normal"
    max_mag = max((f.get("properties", {}).get("mag") or 0 for f in features), default=0)
    if max_mag >= 5.0:
        return "watch"
    if max_mag >= 4.0:
        return "advisory"
    return "normal"


def _write_alert_state(config, alert_level: str) -> None:
    try:
        state_dir = config.DATA_DIR / "state"
        state_dir.mkdir(parents=True, exist_ok=True)
        state_path = state_dir / "kilauea-alert.json"
        state_path.write_text(json.dumps({
            "alert_level": alert_level,
            "multiplier": get_multiplier(alert_level),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }))
        log.debug("Kīlauea alert state written: %s", alert_level)
    except Exception as e:
        log.warning("Could not write kilauea alert state: %s", e)


def get_multiplier(alert_level: str) -> float:
    level = alert_level.lower().strip()
    if "erupt" in level or "red" in level:
        return MULTIPLIERS["eruption"]
    if "watch" in level or "orange" in level:
        return MULTIPLIERS["watch"]
    if "advisory" in level or "yellow" in level:
        return MULTIPLIERS["advisory"]
    return MULTIPLIERS["normal"]

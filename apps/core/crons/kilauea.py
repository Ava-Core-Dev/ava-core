"""
Kīlauea / USGS volcano cron — real local driver (replaces CF proxy).
Fetches HVO notices + USGS quake data. Triggers economy multiplier on eruption.
"""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone
from pathlib import Path

import httpx

log = logging.getLogger("ava.cron.kilauea")

USGS_QUAKE_URL = (
    "https://earthquake.usgs.gov/fdsnws/event/1/query"
    "?format=geojson&minmagnitude=1&maxradiuskm=150"
    "&latitude=19.421&longitude=-155.287&orderby=time&limit=20"
)
HVO_NOTICE_URL = "https://www.usgs.gov/volcanoes/kilauea/volcano-updates"

_last_hash: str = ""

# Economy multipliers — set via in-game economy cron when level changes
MULTIPLIERS = {
    "normal":   1.0,
    "advisory": 2.0,   # Kīlauea Advisory / Yellow
    "watch":    2.5,   # Kīlauea Watch / Orange
    "eruption": 3.0,   # Active eruption / Red
}


async def run():
    global _last_hash
    log.info("Kīlauea cron running  %s", datetime.now(timezone.utc).isoformat())
    try:
        async with httpx.AsyncClient(timeout=20,
                                     headers={"User-Agent": "AvaIvy/2.0 rootmc.net"}) as client:
            r = await client.get(USGS_QUAKE_URL)
            if r.status_code != 200:
                log.warning("USGS quake fetch failed: %s", r.status_code)
                return

            data = r.json()
            features = data.get("features", [])
            log.info("USGS: %d events near Kīlauea", len(features))

            # Build report content
            from apps.core import config
            lines = [f"# Kīlauea + USGS Quakes — {datetime.now(timezone.utc).isoformat()}\n",
                     f"Events (M≥1, ≤150km): {len(features)}\n"]
            for f in features[:5]:
                props = f.get("properties", {})
                lines.append(
                    f"- M{props.get('mag', '?')} "
                    f"{props.get('place', '?')} "
                    f"— {props.get('type', '?')}"
                )

            content = "\n".join(lines)
            content_hash = hashlib.md5(content.encode()).hexdigest()

            if content_hash == _last_hash:
                log.debug("Kīlauea: no change since last run")
                return

            _last_hash = content_hash
            report_path = config.REPORTS_DIR / f"kilauea-{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H')}.md"
            report_path.write_text(content)
            log.info("Kīlauea report written: %s", report_path.name)

    except Exception:
        log.exception("Kīlauea cron failed")


def get_multiplier(alert_level: str) -> float:
    """Return the economy gold multiplier for the current alert level."""
    level = alert_level.lower().strip()
    if "erupt" in level or "red" in level:
        return MULTIPLIERS["eruption"]
    if "watch" in level or "orange" in level:
        return MULTIPLIERS["watch"]
    if "advisory" in level or "yellow" in level:
        return MULTIPLIERS["advisory"]
    return MULTIPLIERS["normal"]

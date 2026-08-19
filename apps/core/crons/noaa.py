"""
NOAA / NWS weather cron — real local driver (replaces CF proxy).
Fetches from api.weather.gov for the Big Island point forecast.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

import httpx

log = logging.getLogger("ava.cron.noaa")

# Big Island / Ava host location — Puna district, Hilo side
NWS_POINT_URL = "https://api.weather.gov/points/19.5429,-155.0372"
NWS_ALERTS_URL = "https://api.weather.gov/alerts/active?area=HI"


async def run():
    log.info("NOAA cron running  %s", datetime.now(timezone.utc).isoformat())
    try:
        async with httpx.AsyncClient(timeout=20,
                                     headers={"User-Agent": "AvaIvy/2.0 rootmc.net"}) as client:
            # Get forecast office + grid coordinates
            r = await client.get(NWS_POINT_URL)
            if r.status_code != 200:
                log.warning("NWS point failed: %s", r.status_code)
                return

            data = r.json()
            props = data.get("properties", {})
            forecast_url = props.get("forecast")
            hourly_url   = props.get("forecastHourly")

            if not forecast_url:
                log.warning("No forecast URL in NWS point response")
                return

            rf = await client.get(forecast_url)
            if rf.status_code != 200:
                log.warning("NWS forecast failed: %s", rf.status_code)
                return

            periods = rf.json().get("properties", {}).get("periods", [])
            if periods:
                now_period = periods[0]
                log.info(
                    "NWS: %s — %s°F  %s",
                    now_period.get("name"),
                    now_period.get("temperature"),
                    now_period.get("shortForecast"),
                )

                # Write a summary report for voice to pick up
                from apps.core import config
                report_path = config.REPORTS_DIR / f"nws-weather-{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H')}.md"
                lines = [f"# NWS Weather — {datetime.now(timezone.utc).isoformat()}\n"]
                for p in periods[:4]:
                    lines.append(f"## {p['name']}\n{p['detailedForecast']}\n")
                report_path.write_text("\n".join(lines))
                log.info("NWS report written: %s", report_path.name)

    except Exception:
        log.exception("NOAA cron failed")

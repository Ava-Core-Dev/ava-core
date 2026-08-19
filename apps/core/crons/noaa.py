"""
NOAA / NWS weather cron — real local driver (replaces CF proxy).
Fetches point forecast + active HI alerts from api.weather.gov.
Runs every 15 minutes.
"""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone

import httpx

log = logging.getLogger("ava.cron.noaa")

# Big Island / Puna district — near Ava host location
NWS_POINT_URL   = "https://api.weather.gov/points/19.5429,-155.0372"
NWS_ALERTS_URL  = "https://api.weather.gov/alerts/active?area=HI"

_last_hash: str = ""


async def run():
    global _last_hash
    log.info("NOAA cron running  %s", datetime.now(timezone.utc).isoformat())
    try:
        async with httpx.AsyncClient(
            timeout=20,
            headers={"User-Agent": "AvaIvy/2.0 rootmc.net"},
            follow_redirects=True,
        ) as client:
            # ── Forecast ─────────────────────────────────────────────────────
            r = await client.get(NWS_POINT_URL)
            periods: list[dict] = []
            if r.status_code == 200:
                props = r.json().get("properties", {})
                forecast_url = props.get("forecast")
                if forecast_url:
                    rf = await client.get(forecast_url)
                    if rf.status_code == 200:
                        periods = rf.json().get("properties", {}).get("periods", [])
            else:
                log.warning("NWS point failed: %s", r.status_code)

            # ── Active HI alerts ─────────────────────────────────────────────
            alerts: list[dict] = []
            ra = await client.get(NWS_ALERTS_URL)
            if ra.status_code == 200:
                features = ra.json().get("features", [])
                for f in features:
                    p = f.get("properties", {})
                    alerts.append({
                        "event":    p.get("event", "Unknown"),
                        "headline": p.get("headline", ""),
                        "areas":    p.get("areaDesc", ""),
                        "severity": p.get("severity", ""),
                        "urgency":  p.get("urgency", ""),
                    })
                log.info("NWS: %d active HI alerts", len(alerts))
            else:
                log.warning("NWS alerts fetch failed: %s", ra.status_code)

            # ── Build report ─────────────────────────────────────────────────
            from apps.core import config

            lines = [f"# NWS Weather — {datetime.now(timezone.utc).isoformat()}\n"]

            if alerts:
                lines.append(f"## ⚠️ Active HI Alerts ({len(alerts)})\n")
                for a in alerts[:5]:
                    lines.append(
                        f"**{a['event']}** — {a['severity']} / {a['urgency']}\n"
                        f"{a['headline']}\n"
                        f"_{a['areas']}_\n"
                    )
            else:
                lines.append("## No active HI alerts.\n")

            if periods:
                lines.append("## Forecast\n")
                for p in periods[:4]:
                    lines.append(
                        f"### {p.get('name','?')}\n"
                        f"{p.get('temperature','?')}°{p.get('temperatureUnit','F')} — "
                        f"{p.get('shortForecast','?')}\n"
                        f"{p.get('detailedForecast','')}\n"
                    )
                if periods:
                    log.info(
                        "NWS: %s — %s°F  %s",
                        periods[0].get("name"),
                        periods[0].get("temperature"),
                        periods[0].get("shortForecast"),
                    )

            content = "\n".join(lines)
            content_hash = hashlib.md5(content.encode()).hexdigest()
            if content_hash == _last_hash:
                log.debug("NOAA: no change since last run")
                return

            _last_hash = content_hash
            report_path = config.REPORTS_DIR / f"nws-weather-{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H')}.md"
            report_path.write_text(content)
            log.info("NWS report written: %s  alerts=%d  periods=%d",
                     report_path.name, len(alerts), len(periods))

            # Post high-severity alerts to #automations immediately
            critical = [a for a in alerts if a["severity"].lower() in {"extreme", "severe"}]
            if critical:
                from apps.core.services import discord
                alert_lines = [f"⚠️ **NWS ALERT** — {a['event']}: {a['headline']}" for a in critical[:3]]
                await discord.post_message(
                    config.DISCORD_CHANNELS.get("automations", ""),
                    "\n".join(alert_lines),
                )
                log.info("Posted %d critical NWS alerts to #automations", len(critical))

    except Exception:
        log.exception("NOAA cron failed")

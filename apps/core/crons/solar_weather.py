"""
Hourly solar + weather cron.
Pulls live EcoFlow battery/solar data and the latest NWS forecast,
writes a combined report to disk, and posts a Discord snapshot to #automations.
Runs at the top of every hour.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any

import httpx

log = logging.getLogger("ava.cron.solar_weather")


# ── EcoFlow API helpers ────────────────────────────────────────────────────────

def _ecoflow_headers(access_key: str, secret_key: str, params: dict) -> dict:
    """Build EcoFlow HMAC-SHA256 auth headers."""
    nonce     = str(int(time.time() * 1000) % 1_000_000).zfill(6)
    timestamp = str(int(time.time() * 1000))

    # Sorted query string for signing
    sign_str = "&".join(f"{k}={v}" for k, v in sorted(params.items()))
    sign_str = f"accessKey={access_key}&nonce={nonce}&timestamp={timestamp}&{sign_str}"

    sig = hmac.new(secret_key.encode(), sign_str.encode(), "sha256").hexdigest()

    return {
        "accessKey": access_key,
        "nonce":     nonce,
        "timestamp": timestamp,
        "sign":      sig,
    }


async def _fetch_ecoflow_device(client: httpx.AsyncClient, base_url: str,
                                access_key: str, secret_key: str,
                                sn: str) -> dict[str, Any]:
    """Fetch quota data for one EcoFlow device."""
    params = {"sn": sn}
    headers = _ecoflow_headers(access_key, secret_key, params)
    try:
        r = await client.get(
            f"{base_url}/iot-service/v1/device/quota/all",
            params=params,
            headers=headers,
            timeout=15,
        )
        if r.status_code == 200:
            d = r.json()
            if d.get("code") == "0":
                return d.get("data", {})
            log.warning("EcoFlow API error sn=%s code=%s msg=%s",
                        sn, d.get("code"), d.get("message"))
        else:
            log.warning("EcoFlow HTTP %s sn=%s", r.status_code, sn)
    except Exception as e:
        log.warning("EcoFlow fetch failed sn=%s: %s", sn, e)
    return {}


def _extract_battery(data: dict, label: str) -> str:
    """Extract key metrics from EcoFlow quota response."""
    if not data:
        return f"{label}: offline"

    # Delta 2 / Delta Pro field names
    soc     = data.get("bmsMaster.soc") or data.get("pd.soc")
    watts_in  = data.get("mppt.inWatts") or data.get("pd.inputWatts", 0)
    watts_out = data.get("pd.outputWatts", 0)
    watts_ac  = data.get("inv.inputWatts", 0)
    remain_time = data.get("pd.remainTime")

    parts = [f"{label}:"]
    if soc is not None:
        parts.append(f"SOC {soc}%")
    if watts_in:
        parts.append(f"in {watts_in}W")
    if watts_out:
        parts.append(f"out {watts_out}W")
    if watts_ac:
        parts.append(f"AC {watts_ac}W")
    if remain_time is not None:
        h, m = divmod(int(remain_time), 60)
        parts.append(f"~{h}h{m:02d}m remain")

    return "  ".join(parts) if len(parts) > 1 else f"{label}: no data"


# ── Main cron ─────────────────────────────────────────────────────────────────

_last_hash: str = ""


async def run():
    global _last_hash
    log.info("Solar+weather cron  %s", datetime.now(timezone.utc).isoformat())

    from apps.core import config

    access_key = os.getenv("AVA_ECOFLOW_ACCESS_KEY", "")
    secret_key = os.getenv("AVA_ECOFLOW_SECRET_KEY", "")
    base_url   = os.getenv("AVA_ECOFLOW_BASE_URL", "https://api-a.ecoflow.com")
    serial_nos = [s.strip() for s in os.getenv("AVA_ECOFLOW_SN", "").split(",") if s.strip()]

    now_utc  = datetime.now(timezone.utc)
    now_hst  = datetime.now()  # scheduler runs in Pacific/Honolulu tz
    lines    = [f"# Solar + Weather — {now_utc.isoformat()}\n"]

    # ── EcoFlow live data ────────────────────────────────────────────────────
    if access_key and secret_key and serial_nos:
        labels = ["Delta 2", "River 2 Pro"]
        async with httpx.AsyncClient() as client:
            for i, sn in enumerate(serial_nos):
                label = labels[i] if i < len(labels) else f"Device {i+1}"
                data  = await _fetch_ecoflow_device(client, base_url, access_key, secret_key, sn)
                lines.append(_extract_battery(data, label))

        # Compute composite bank pct (average of available SOCs)
        lines.append("")
    else:
        lines.append("EcoFlow: API keys not configured\n")

    # ── NWS latest conditions ────────────────────────────────────────────────
    nws_reports = sorted(
        config.REPORTS_DIR.glob("nws-weather-*.md"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    if nws_reports:
        nws_age_m = int((time.time() - nws_reports[0].stat().st_mtime) / 60)
        nws_snippet = nws_reports[0].read_text(errors="replace")
        # Pull just the first forecast period for the summary
        import re
        cond_match = re.search(r"###?\s*\w.*?\n(.+)", nws_snippet)
        conditions = cond_match.group(1).strip() if cond_match else "see NWS report"
        lines.append(f"Conditions: {conditions} (NWS {nws_age_m}m ago)\n")
    else:
        lines.append("Conditions: NWS data not yet available\n")

    content = "\n".join(lines)
    content_hash = hashlib.md5(content.encode()).hexdigest()

    # Always write the report; only skip Discord post if unchanged
    ts = now_utc.strftime("%Y-%m-%dT%H")
    report_path = config.REPORTS_DIR / f"solar-weather-{ts}.md"
    report_path.write_text(content)
    log.info("Solar+weather report written: %s", report_path.name)

    if content_hash == _last_hash:
        log.debug("Solar+weather: no change, skipping Discord post")
        return
    _last_hash = content_hash

    from apps.core.services import discord
    await discord.post_message(
        config.DISCORD_CHANNELS.get("automations", ""),
        content[:1900],
    )
    log.info("Solar+weather posted to #automations")

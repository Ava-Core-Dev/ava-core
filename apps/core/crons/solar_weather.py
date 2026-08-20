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
from pathlib import Path

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


def _num(data: dict, *keys: str):
    for k in keys:
        v = data.get(k)
        if v is not None and v != "":
            try:
                return float(v)
            except (TypeError, ValueError):
                continue
    return None


async def live_snapshot() -> dict:
    """Dashboard-shaped EcoFlow snapshot. Empty dict if keys/devices missing."""
    access_key = os.getenv("AVA_ECOFLOW_ACCESS_KEY", "")
    secret_key = os.getenv("AVA_ECOFLOW_SECRET_KEY", "")
    base_url = os.getenv("AVA_ECOFLOW_BASE_URL", "https://api-a.ecoflow.com")
    serial_nos = [s.strip() for s in os.getenv("AVA_ECOFLOW_SN", "").split(",") if s.strip()]
    if not (access_key and secret_key and serial_nos):
        return _quota_snapshot()

    banks: list[float] = []
    watts_in = 0.0
    watts_out = 0.0
    devices: list[dict] = []
    labels = ["Delta 2", "River 2 Pro"]
    async with httpx.AsyncClient() as client:
        for i, sn in enumerate(serial_nos):
            label = labels[i] if i < len(labels) else f"Device {i + 1}"
            data = await _fetch_ecoflow_device(client, base_url, access_key, secret_key, sn)
            soc = _soc_from_quota(data) if data else None
            inn = _num(data, "mppt.inWatts", "pd.inputWatts") or 0
            out = _num(data, "pd.outputWatts", "inv.outputWatts") or 0
            if soc is not None:
                banks.append(soc)
            watts_in += inn
            watts_out += out
            devices.append({"label": label, "soc": soc, "watts_in": inn, "watts_out": out, "online": bool(data)})

    battery = round(sum(banks) / len(banks), 1) if banks else None
    state = "charging" if watts_in > 20 else ("discharging" if watts_out > 20 else "idle")
    live = {
        "voltage": None,
        "current": None,
        "power_w": round(watts_in, 1),
        "battery_pct": battery,
        "state": state if devices else "offline",
        "kwh_today": None,
        "kwh_total": None,
        "panel_temp_c": None,
        "bank_pct": battery,
        "solar_in_w": round(watts_in, 1),
        "load_w": round(watts_out, 1),
        "devices": devices,
        "source": "ecoflow_live",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if battery is None or (battery is not None and battery < 8):
        disk = _quota_snapshot()
        if disk.get("battery_pct") is not None and (
            battery is None or disk["battery_pct"] > battery
        ):
            return disk
    return live


def _quota_snapshot() -> dict:
    """On-disk EcoFlow quota files when the cloud API is down."""
    from apps.core import config

    roots = [
        Path.home() / "ava" / "data" / "ecoflow",
        config.DATA_DIR / "ecoflow",
        config.AVA_HOME / "data" / "ecoflow",
    ]
    root = next((p for p in roots if (p / "quota").is_dir()), None)
    if root is None:
        return {}
    names = {}
    listing = root / "devices" / "list.json"
    if listing.is_file():
        try:
            payload = json_loads(listing.read_text())
            for d in payload.get("devices") or []:
                names[str(d.get("sn") or "")] = d.get("productName") or d.get("sn")
        except Exception:
            pass
    devices = []
    banks = []
    watts_in = 0.0
    watts_out = 0.0
    newest = 0
    for qf in sorted((root / "quota").glob("*.json")):
        try:
            raw = json_loads(qf.read_text())
        except Exception:
            continue
        newest = max(newest, int(raw.get("at") or 0))
        data = ((raw.get("body") or {}).get("data") or raw.get("data") or {})
        if not isinstance(data, dict):
            continue
        sn = qf.stem
        label = names.get(sn) or sn
        soc = _soc_from_quota(data)
        inn = _num(data, "mppt.inWatts", "pd.inputWatts", "pd.wattsInSum") or 0
        out = _num(data, "pd.outputWatts", "inv.outputWatts", "pd.wattsOutSum") or 0
        remain = _num(data, "bms_emsStatus.dsgRemainTime", "pd.remainTime")
        if soc is not None:
            banks.append(soc)
        watts_in += inn
        watts_out += out
        devices.append({
            "label": label,
            "sn": sn,
            "soc": soc,
            "watts_in": inn,
            "watts_out": out,
            "remain_min": remain,
            "temp_c": _num(data, "bms_bmsStatus.temp", "mppt.mpptTemp"),
            "online": True,
        })
    if not devices:
        return {}
    battery = round(sum(banks) / len(banks), 1) if banks else None
    updated = None
    if newest > 1_000_000_000_000:
        newest = newest / 1000
    if newest:
        updated = datetime.fromtimestamp(newest, tz=timezone.utc).isoformat()
    state = "charging" if watts_in > 20 else ("discharging" if watts_out > 20 else "idle")
    return {
        "power_w": round(watts_in, 1),
        "battery_pct": battery,
        "state": state,
        "bank_pct": battery,
        "solar_in_w": round(watts_in, 1),
        "load_w": round(watts_out, 1),
        "devices": devices,
        "source": "ecoflow_quota_cache",
        "updated_at": updated or datetime.now(timezone.utc).isoformat(),
    }


def json_loads(text: str):
    import json
    return json.loads(text)


def _soc_from_quota(data: dict) -> float | None:
    bp = _num(data, "pd.bpPowerSoc")
    bms = _num(data, "bms_bmsStatus.soc", "bms_bmsStatus.f32ShowSoc", "bmsMaster.soc")
    pd = _num(data, "pd.soc")
    if bms is not None and 0 <= bms <= 100:
        return round(bms, 1)
    if bp is not None and 5 < bp <= 100:
        return round(bp, 1)
    if pd is not None and 5 < pd <= 100:
        return round(pd, 1)
    if bp is not None:
        return round(bp, 1)
    return pd


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

    from apps.core.services import reports
    await reports.publish("solar", content[:1900], channel="automations")
    log.info("Solar+weather posted to #automations + report DMs")

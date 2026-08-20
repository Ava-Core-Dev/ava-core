"""
Hourly solar + weather cron.
Pulls live EcoFlow battery/solar data and the latest NWS forecast,
writes a combined report to disk, and posts a Discord snapshot to #automations.
Runs at the top of every hour.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

log = logging.getLogger("ava.cron.solar_weather")

# Physical labels (2026-08-02 rename). Do not use EcoFlow productName — it is swapped.
# R331 = Delta 2 (cucumbers). R621 = River 2 Pro (shackas).
SN_LABELS = {
    "R331ZAB5SG6S2858": "DELTA 2",
    "R621ZA16XH6K1155": "RIVER 2 Pro",
}
ECO_STALE_S = 3 * 60
APPLIANCE_AC_W = 1100
_LIVE_CACHE: dict[str, Any] = {}


def _label_for_sn(sn: str, listed: str | None = None) -> str:
    return SN_LABELS.get(str(sn).strip()) or listed or str(sn)[-6:]


def _sort_devices(devices: list[dict]) -> list[dict]:
    rank = {"DELTA 2": 0, "Delta 2": 0, "RIVER 2 Pro": 1, "River 2 Pro": 1}
    return sorted(devices, key=lambda d: rank.get(str(d.get("label") or ""), 9))


# ── EcoFlow API helpers ────────────────────────────────────────────────────────

def _ecoflow_sign(access_key: str, secret_key: str, params: dict) -> dict:
    """Official Open API HMAC. Query params first, then accessKey/nonce/timestamp.

    GET must not send Content-Type: application/json (EcoFlow 8521).
    """
    nonce = str(int(100000 + (time.time() * 1000) % 900000))
    timestamp = str(int(time.time() * 1000))
    flat = {k: v for k, v in params.items() if v is not None and v != ""}
    param_qs = "&".join(f"{k}={flat[k]}" for k in sorted(flat))
    header_qs = "&".join(
        f"{k}={v}" for k, v in sorted(
            {"accessKey": access_key, "nonce": nonce, "timestamp": timestamp}.items()
        )
    )
    sign_str = f"{param_qs}&{header_qs}" if param_qs else header_qs
    sig = hmac.new(secret_key.encode(), sign_str.encode(), "sha256").hexdigest()
    return {
        "accessKey": access_key,
        "nonce": nonce,
        "timestamp": timestamp,
        "sign": sig,
        "Accept": "application/json",
        "User-Agent": "AvaIvy/2.0 (EcoFlow OpenAPI)",
    }


async def _ecoflow_get(client: httpx.AsyncClient, base_url: str, access_key: str,
                       secret_key: str, path: str, params: dict | None = None) -> dict[str, Any]:
    params = params or {}
    headers = _ecoflow_sign(access_key, secret_key, params)
    try:
        r = await client.get(
            f"{base_url.rstrip('/')}{path}",
            params=params or None,
            headers=headers,
            timeout=15,
        )
        if r.status_code != 200:
            log.warning("EcoFlow HTTP %s %s", r.status_code, path)
            return {}
        d = r.json()
        if str(d.get("code") or "0") not in {"0", "None"}:
            log.warning("EcoFlow API %s code=%s msg=%s", path, d.get("code"), d.get("message"))
            return {}
        return d
    except Exception as e:
        log.warning("EcoFlow fetch failed %s: %s", path, e)
        return {}


async def _fetch_ecoflow_device(client: httpx.AsyncClient, base_url: str,
                                access_key: str, secret_key: str,
                                sn: str) -> dict[str, Any]:
    d = await _ecoflow_get(
        client, base_url, access_key, secret_key,
        "/iot-open/sign/device/quota/all",
        {"sn": sn},
    )
    data = d.get("data") if d else {}
    if isinstance(data, dict) and data:
        _write_quota(sn, d)
        return data
    return {}


def _extract_battery(data: dict, label: str) -> str:
    """Extract key metrics from EcoFlow quota response."""
    if not data:
        return f"{label}: offline"

    pwr = _pack_power(data)
    soc = _soc_from_quota(data)
    remain_time = data.get("pd.remainTime")

    parts = [f"{label}:"]
    if soc is not None:
        parts.append(f"SOC {soc}%")
    if pwr["pv_w"]:
        parts.append(f"PV {pwr['pv_w']:.0f}W")
    if pwr["ac_in_w"]:
        parts.append(f"AC in {pwr['ac_in_w']:.0f}W")
    if pwr["ac_out_w"] >= APPLIANCE_AC_W:
        parts.append(f"appliances {pwr['ac_out_w']:.0f}W")
    elif pwr["ac_out_w"]:
        parts.append(f"AC out {pwr['ac_out_w']:.0f}W")
    if pwr["dc_out_w"]:
        parts.append(f"DC {pwr['dc_out_w']:.0f}W")
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


def _watts(raw) -> float:
    if raw is None:
        return 0.0
    n = float(raw)
    if abs(n) >= 10_000:
        n = n / 1000.0
    return round(max(0.0, n), 1)


def _pack_power(data: dict | None) -> dict:
    """Split PV vs AC. AC is never counted as solar.

    AC in  = generator, unless it matches the other pack's discharge (transfer).
    Matched Delta discharge ≈ River charge is always pack-to-pack transfer.
    Unmatched AC out ≥ 1.1 kW = appliances. DC out = USB / car leftover.
    """
    data = data or {}
    pv = _watts(_num(data, "mppt.inWatts", "mppt.pv1InWatts", "mppt.pv2InWatts"))
    ac_in = _watts(_num(data, "inv.inputWatts", "inv.acInWatts"))
    ac_out = _watts(_num(data, "inv.outputWatts", "inv.outWatts"))
    pd_in = _watts(_num(data, "pd.wattsInSum", "pd.inputWatts"))
    pd_out = _watts(_num(data, "pd.wattsOutSum", "pd.outputWatts"))
    usb = 0.0
    for k in (
        "pd.usb1Watts", "pd.usb2Watts", "pd.qcUsb1Watts",
        "pd.typec1Watts", "pd.typec2Watts", "pd.carWatts",
    ):
        usb += _watts(_num(data, k))
    dc_out = max(usb, max(0.0, pd_out - ac_out))
    # AC charge into the pack (PV already counted separately).
    ac_charge = max(ac_in, max(0.0, pd_in - pv))
    discharge = max(ac_out, pd_out)
    return {
        "pv_w": pv,
        "ac_in_w": ac_in,
        "ac_out_w": ac_out,
        "ac_charge_w": round(ac_charge, 1),
        "discharge_w": round(discharge, 1),
        "dc_out_w": round(dc_out, 1),
        "watts_in": pv,
        "watts_out": round(dc_out, 1),
    }


def _is_delta(d: dict) -> bool:
    sn = str(d.get("sn") or "")
    lab = str(d.get("label") or "").upper()
    return sn.startswith("R331") or "DELTA" in lab


def _is_river(d: dict) -> bool:
    sn = str(d.get("sn") or "")
    lab = str(d.get("label") or "").upper()
    return sn.startswith("R621") or "RIVER" in lab


def _same_watts(a: float, b: float) -> bool:
    """Inverter loss is a few percent; matching discharge vs charge is a transfer."""
    a, b = float(a or 0), float(b or 0)
    if a < 20 or b < 20:
        return False
    slack = max(40.0, 0.12 * max(a, b))
    return abs(a - b) <= slack


def _apply_ac_roles(devices: list[dict]) -> None:
    for d in devices:
        d["ac_role"] = None
        d["transfer_sure"] = False
    delta = next((d for d in devices if _is_delta(d)), None)
    river = next((d for d in devices if _is_river(d)), None)

    def _pair(src: dict, dst: dict) -> bool:
        src_out = max(float(src.get("ac_out_w") or 0), float(src.get("discharge_w") or 0))
        dst_in = max(float(dst.get("ac_in_w") or 0), float(dst.get("ac_charge_w") or 0))
        if not _same_watts(src_out, dst_in):
            return False
        src["ac_role"] = "transfer_out"
        dst["ac_role"] = "transfer_in"
        src["transfer_sure"] = True
        dst["transfer_sure"] = True
        src["transfer_w"] = round(src_out, 1)
        dst["transfer_w"] = round(dst_in, 1)
        return True

    matched = False
    if delta and river:
        matched = _pair(delta, river) or _pair(river, delta)

    if matched:
        return
    # No matched pair — leftover AC is generator (in) or appliances (out ≥ 1.1 kW).
    for d in devices:
        aco = float(d.get("ac_out_w") or 0)
        aci = float(d.get("ac_in_w") or 0)
        if aco >= APPLIANCE_AC_W:
            d["ac_role"] = "appliances"
        elif aci > 20:
            d["ac_role"] = "generator"
        elif aco > 20:
            d["ac_role"] = "ac_out"


def _bank_state(devices: list[dict]) -> str:
    bits: list[str] = []
    roles = {d.get("ac_role") for d in devices}
    if "appliances" in roles:
        bits.append("appliances")
    src = next((d.get("label") for d in devices if d.get("ac_role") == "transfer_out"), None)
    dst = next((d.get("label") for d in devices if d.get("ac_role") == "transfer_in"), None)
    if src and dst:
        bits.append(f"transfer {src} → {dst}")
    elif "transfer_out" in roles or "transfer_in" in roles:
        bits.append("AC transfer")
    if "generator" in roles:
        bits.append("generator")
    if sum(float(d.get("pv_w") or 0) for d in devices) > 20:
        bits.append("PV charging")
    if sum(float(d.get("dc_out_w") or 0) for d in devices) > 20:
        bits.append("DC load")
    return " · ".join(bits) or "idle"


async def live_snapshot() -> dict:
    """Dashboard-shaped EcoFlow snapshot. Empty dict if keys/devices missing."""
    now = time.time()
    cached = _LIVE_CACHE.get("snap")
    cached_at = float(_LIVE_CACHE.get("at") or 0)
    if cached and now - cached_at < 45:
        return cached

    access_key = os.getenv("AVA_ECOFLOW_ACCESS_KEY", "")
    secret_key = os.getenv("AVA_ECOFLOW_SECRET_KEY", "")
    base_url = os.getenv("AVA_ECOFLOW_BASE_URL", "https://api-a.ecoflow.com")
    serial_nos = [s.strip() for s in os.getenv("AVA_ECOFLOW_SN", "").split(",") if s.strip()]
    if not (access_key and secret_key and serial_nos):
        snap = _quota_snapshot()
        _LIVE_CACHE.update({"snap": snap, "at": now})
        return snap

    online_map: dict[str, bool | None] = {}
    banks: list[float] = []
    devices: list[dict] = []
    any_live = False
    async with httpx.AsyncClient() as client:
        listing = await _ecoflow_get(
            client, base_url, access_key, secret_key,
            "/iot-open/sign/device/list", {},
        )
        raw_list = listing.get("data")
        rows = raw_list if isinstance(raw_list, list) else (
            (raw_list or {}).get("devices") or (raw_list or {}).get("list") or []
        )
        for row in rows:
            if not isinstance(row, dict):
                continue
            sn = str(row.get("sn") or "")
            flag = row.get("online", row.get("status"))
            if flag in (0, False, "0", "offline"):
                online_map[sn] = False
            elif flag in (1, True, "1", "online"):
                online_map[sn] = True
        for i, sn in enumerate(serial_nos):
            label = _label_for_sn(sn, f"Device {i + 1}")
            data = await _fetch_ecoflow_device(client, base_url, access_key, secret_key, sn)
            listed_on = online_map.get(sn)
            live = bool(data) and listed_on is not False
            soc = _soc_from_quota(data) if data else None
            pwr = _pack_power(data if live else {})
            if live and soc is not None:
                banks.append(soc)
                any_live = True
            devices.append({
                "label": label,
                "sn": sn,
                "soc": soc,
                "online": live,
                **pwr,
            })
    devices = _sort_devices(devices)

    if not any_live:
        disk = _quota_snapshot()
        if disk:
            _LIVE_CACHE.update({"snap": disk, "at": now})
            return disk

    _apply_ac_roles(devices)
    battery = round(sum(banks) / len(banks), 1) if banks else None
    live = _attach_rollups({
        "voltage": None,
        "current": None,
        "power_w": round(sum(float(d.get("pv_w") or 0) for d in devices), 1),
        "battery_pct": battery,
        "state": _bank_state(devices) if devices else "offline",
        "kwh_today": None,
        "kwh_total": None,
        "panel_temp_c": None,
        "bank_pct": battery,
        "solar_in_w": round(sum(float(d.get("pv_w") or 0) for d in devices), 1),
        "load_w": round(sum(float(d.get("dc_out_w") or 0) for d in devices), 1),
        "devices": devices,
        "source": "ecoflow_live",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    await _push_ecoflow_d1(live)
    _LIVE_CACHE.update({"snap": live, "at": now})
    return live


def _write_quota(sn: str, body: dict) -> None:
    from apps.core import config

    root = config.DATA_DIR / "ecoflow" / "quota"
    try:
        root.mkdir(parents=True, exist_ok=True)
        (root / f"{sn}.json").write_text(
            json.dumps({"at": int(time.time() * 1000), "status": 200, "body": body}),
            encoding="utf-8",
        )
    except OSError as e:
        log.warning("quota write %s: %s", sn, e)


async def _push_ecoflow_d1(snap: dict) -> None:
    """Keep the last live snapshot in the heartbeat D1 so CF can serve it offline."""
    try:
        from apps.core import heartbeat
        from apps.core import config

        if not config.CF_D1_HEARTBEAT_DB_ID:
            return
        payload = json.dumps(snap, default=str)[:120_000]
        sql = (
            "CREATE TABLE IF NOT EXISTS ava_ecoflow ("
            "host TEXT PRIMARY KEY, ts TEXT NOT NULL, json TEXT NOT NULL)"
        )
        upsert = (
            "INSERT INTO ava_ecoflow (host, ts, json) VALUES (?1, ?2, ?3) "
            "ON CONFLICT(host) DO UPDATE SET ts = excluded.ts, json = excluded.json"
        )
        modes = heartbeat._auth_modes()
        if not modes:
            return
        async with httpx.AsyncClient(timeout=10) as client:
            headers = modes[0][1]
            await heartbeat._d1_query(client, sql, headers=headers)
            await heartbeat._d1_query(
                client, upsert,
                [ "ava-core", datetime.now(timezone.utc).isoformat(), payload],
                headers,
            )
    except Exception as e:
        log.debug("ecoflow D1 push skipped: %s", e)


def _quota_snapshot() -> dict:
    """Newest on-disk EcoFlow quota files when the cloud API is down."""
    root = _ecoflow_root()
    if root is None or not (root / "quota").is_dir():
        return {}
    names = {}
    listing = root / "devices" / "list.json"
    if listing.is_file():
        try:
            payload = json_loads(listing.read_text())
            for d in payload.get("devices") or []:
                sn = str(d.get("sn") or "")
                names[sn] = _label_for_sn(sn, d.get("productName") or sn)
        except Exception:
            pass
    devices = []
    banks = []
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
        at = int(raw.get("at") or 0)
        at_s = at / 1000.0 if at > 1_000_000_000_000 else float(at)
        age_s = time.time() - at_s if at_s else 10**9
        fresh = age_s <= ECO_STALE_S
        label = _label_for_sn(sn, names.get(sn))
        soc = _soc_from_quota(data)
        pwr = _pack_power(data)
        remain = _num(data, "bms_emsStatus.dsgRemainTime", "pd.remainTime")
        if fresh and soc is not None:
            banks.append(soc)
        devices.append({
            "label": label,
            "sn": sn,
            "soc": soc,
            "remain_min": remain,
            "temp_c": _num(data, "bms_bmsStatus.temp", "mppt.mpptTemp"),
            "online": fresh,
            "age_s": int(age_s),
            **pwr,
        })
    if not devices:
        return {}
    devices = _sort_devices(devices)
    _apply_ac_roles(devices)
    battery = round(sum(banks) / len(banks), 1) if banks else None
    updated = None
    if newest > 1_000_000_000_000:
        newest = newest / 1000
    if newest:
        updated = datetime.fromtimestamp(newest, tz=timezone.utc).isoformat()
    return _attach_rollups({
        "power_w": round(sum(float(d.get("pv_w") or 0) for d in devices), 1),
        "battery_pct": battery,
        "state": _bank_state(devices),
        "bank_pct": battery,
        "solar_in_w": round(sum(float(d.get("pv_w") or 0) for d in devices), 1),
        "load_w": round(sum(float(d.get("dc_out_w") or 0) for d in devices), 1),
        "devices": devices,
        "source": "ecoflow_quota_cache" if any(d.get("online") for d in devices) else "ecoflow_quota_stale",
        "updated_at": updated or datetime.now(timezone.utc).isoformat(),
    })


def json_loads(text: str):
    return json.loads(text)


def _soc_from_quota(data: dict) -> float | None:
    """Real pack SOC. Never use pd.bpPowerSoc — that is backup-reserve %, not charge."""
    for key in (
        "bms_bmsStatus.soc",
        "bms_bmsStatus.f32ShowSoc",
        "bmsMaster.soc",
        "pd.soc",
        "soc",
        "bmsBattSoc",
        "cmsBattSoc",
    ):
        v = _num(data, key)
        if v is not None and 0 <= v <= 100:
            return round(v, 1)
    return None


def _ecoflow_root() -> Path | None:
    from apps.core import config
    roots = [
        config.DATA_DIR / "ecoflow",
        config.AVA_HOME / "data" / "ecoflow",
        Path.home() / "ava" / "data" / "ecoflow",
    ]
    scored: list[tuple[float, Path]] = []
    for p in roots:
        q = p / "quota"
        if not q.is_dir():
            continue
        files = list(q.glob("*.json"))
        if not files:
            continue
        scored.append((max(f.stat().st_mtime for f in files), p))
    if not scored:
        return next((p for p in roots if (p / "history").is_dir()), None)
    scored.sort(reverse=True)
    return scored[0][1]


def _mean(vals: list[float]) -> float | None:
    return round(sum(vals) / len(vals), 1) if vals else None


def _parse_history_at_ms(row: dict, now_ms: int) -> int | None:
    at = int(row.get("at") or 0)
    if at <= 0:
        return None
    if at > 10_000_000_000:
        at_s = at / 1000.0
    else:
        at_s = float(at)
    return int(at_s * 1000) if at_s < now_ms / 10 else int(at)


def _iter_history_rows(hist: Path, *, tail: int = 800):
    """Yield (device_key, row) from EcoFlow history jsonl (skip *-minutes)."""
    for path in sorted(hist.glob("*.jsonl")):
        if path.name.endswith("-minutes.jsonl"):
            continue
        try:
            lines = path.read_text(errors="replace").splitlines()[-tail:]
        except OSError:
            continue
        device = path.stem
        for line in lines:
            line = line.strip().strip("\x00")
            if not line.startswith("{"):
                continue
            try:
                row = json_loads(line)
            except Exception:
                continue
            yield device, row


def history_points(hours: float = 12) -> dict:
    """Bank time series from EcoFlow history jsonl for the last N hours."""
    hours = max(0.25, min(float(hours or 12), 72))
    root = _ecoflow_root()
    hist = root / "history" if root else None
    if not hist or not hist.is_dir():
        return {"ok": True, "points": [], "hours": hours}
    now_ms = int(time.time() * 1000)
    window_ms = now_ms - int(hours * 3600_000)
    # minute_ms -> device -> latest sample fields
    buckets: dict[int, dict[str, dict[str, float | None]]] = {}
    for device, row in _iter_history_rows(hist):
        at_ms = _parse_history_at_ms(row, now_ms)
        if at_ms is None or at_ms < window_ms:
            continue
        minute = (at_ms // 60_000) * 60_000
        solar = row.get("solarW")
        out = row.get("outW")
        soc = row.get("soc")
        try:
            sample = {
                "solar_w": float(solar) if solar is not None else None,
                "load_w": float(out) if out is not None else None,
                "soc": float(soc) if soc is not None else None,
            }
        except (TypeError, ValueError):
            continue
        buckets.setdefault(minute, {})[device] = sample
    points: list[dict] = []
    for minute in sorted(buckets):
        samples = list(buckets[minute].values())
        solar_vals = [s["solar_w"] for s in samples if s["solar_w"] is not None]
        load_vals = [s["load_w"] for s in samples if s["load_w"] is not None]
        soc_vals = [
            s["soc"] for s in samples
            if s["soc"] is not None and 0 <= float(s["soc"]) <= 100
        ]
        t = datetime.fromtimestamp(minute / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z")
        points.append({
            "t": t,
            "solar_w": round(sum(solar_vals), 1) if solar_vals else None,
            "load_w": round(sum(load_vals), 1) if load_vals else None,
            "soc": round(sum(soc_vals) / len(soc_vals), 1) if soc_vals else None,
        })
    return {"ok": True, "points": points, "hours": hours}


def _history_averages() -> dict:
    """1h and morning (06–12 HST) averages from EcoFlow history jsonl."""
    root = _ecoflow_root()
    hist = root / "history" if root else None
    if not hist or not hist.is_dir():
        return {}
    now_ms = int(time.time() * 1000)
    window_ms = now_ms - 12 * 3600_000
    try:
        from zoneinfo import ZoneInfo
        hst = ZoneInfo("Pacific/Honolulu")
    except Exception:
        hst = timezone.utc
    today = datetime.now(hst).date()
    solar_morn: list[float] = []
    load_recent: list[float] = []
    pv_recent: list[float] = []
    soc_recent: list[float] = []
    for _device, row in _iter_history_rows(hist, tail=400):
        at_ms = _parse_history_at_ms(row, now_ms)
        if at_ms is None:
            continue
        solar = row.get("solarW")
        out = row.get("outW")
        soc = row.get("soc")
        try:
            wall = datetime.fromtimestamp(at_ms / 1000, tz=hst)
        except Exception:
            continue
        if at_ms >= window_ms:
            if out is not None:
                load_recent.append(float(out))
            if solar is not None:
                pv_recent.append(float(solar))
            if soc is not None and 5 < float(soc) <= 100:
                soc_recent.append(float(soc))
        if wall.date() == today and 5 <= wall.hour < 12 and solar is not None:
            solar_morn.append(float(solar))
    return {
        "load_1h_w": _mean(load_recent),
        "solar_1h_w": _mean(pv_recent),
        "soc_1h_pct": _mean(soc_recent),
        "solar_morning_w": _mean(solar_morn),
        "samples_1h": len(load_recent),
    }


def _attach_rollups(snap: dict) -> dict:
    if not snap:
        return snap
    devices = snap.get("devices") or []
    pv = sum(float(d.get("pv_w") or d.get("watts_in") or 0) for d in devices)
    dc = sum(float(d.get("dc_out_w") or 0) for d in devices)
    ac_in = sum(float(d.get("ac_in_w") or 0) for d in devices)
    ac_out = sum(float(d.get("ac_out_w") or 0) for d in devices)
    appliance = sum(float(d.get("ac_out_w") or 0) for d in devices if d.get("ac_role") == "appliances")
    transfer = sum(float(d.get("transfer_w") or d.get("ac_out_w") or 0) for d in devices if d.get("ac_role") == "transfer_out")
    generator = sum(float(d.get("ac_in_w") or 0) for d in devices if d.get("ac_role") == "generator")
    socs = [float(d["soc"]) for d in devices if d.get("soc") is not None and d.get("online") is not False]
    snap["solar_in_w"] = round(pv, 1)
    snap["load_w"] = round(dc, 1)
    snap["power_w"] = round(pv, 1)
    snap["state"] = snap.get("state") or _bank_state(devices)
    snap["totals"] = {
        "solar_in_w": round(pv, 1),
        "load_w": round(dc, 1),
        "dc_load_w": round(dc, 1),
        "ac_in_w": round(ac_in, 1),
        "ac_out_w": round(ac_out, 1),
        "generator_w": round(generator, 1),
        "transfer_w": round(transfer, 1),
        "appliance_w": round(appliance, 1),
        "net_w": round(pv - dc, 1),
        "bank_avg_pct": round(sum(socs) / len(socs), 1) if socs else snap.get("battery_pct"),
        "packs": len(devices),
    }
    snap["averages"] = _history_averages()
    return snap


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
    from apps.core.services.site_ops import pv_line

    lines.append(pv_line() + "\n")

    # ── EcoFlow live data ────────────────────────────────────────────────────
    if access_key and secret_key and serial_nos:
        async with httpx.AsyncClient() as client:
            for i, sn in enumerate(serial_nos):
                label = _label_for_sn(sn, f"Device {i+1}")
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
    reports.queue_public_draft("solar", content[:1900], source="cron")
    log.info("Solar+weather draft queued for operator review")

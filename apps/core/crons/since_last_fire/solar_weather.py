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

from apps.core.services.data_layout import (
    device_role as _device_role,
    ecoflow_dir,
    ecoflow_sn_hidden,
    ecoflow_sn_public,
    ensure_data_layout,
    host_history_path,
    label_for_sn as _label_for_sn,
    public_serials,
)

ECO_STALE_S = 3 * 60
APPLIANCE_AC_W = 1000
_LIVE_CACHE: dict[str, Any] = {}


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
    """Split PV, AC, USB, and 12V. AC is never counted as solar."""
    from apps.core.services.load_categories import pack_power
    return pack_power(data)


def _is_delta(d: dict) -> bool:
    return _device_role(str(d.get("sn") or d.get("label") or "")) == "delta"


def _is_river(d: dict) -> bool:
    return _device_role(str(d.get("sn") or d.get("label") or "")) == "river"


def _same_watts(a: float, b: float) -> bool:
    from apps.core.services.load_categories import same_watts
    return same_watts(a, b)


def _apply_ac_roles(devices: list[dict]) -> None:
    from apps.core.services.load_categories import apply_roles
    apply_roles(devices)


def _bank_state(devices: list[dict]) -> str:
    from apps.core.services.load_categories import bank_state
    return bank_state(devices)


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
    serial_nos = public_serials(os.getenv("AVA_ECOFLOW_SN", "").split(","))
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
            if ecoflow_sn_hidden(sn) or not ecoflow_sn_public(sn):
                continue
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
    if not ecoflow_sn_public(sn):
        return
    ensure_data_layout()
    root = ecoflow_dir() / "quota"
    data = body.get("data") if isinstance(body.get("data"), dict) else {}
    try:
        root.mkdir(parents=True, exist_ok=True)
        (root / f"{sn}.json").write_text(
            json.dumps({"at": int(time.time() * 1000), "status": 200, "body": body}),
            encoding="utf-8",
        )
    except OSError as e:
        log.warning("quota write failed: %s", e)
        return
    if data:
        pwr = _pack_power(data)
        soc = _soc_from_quota(data)
        _append_ecoflow_history(sn, soc=soc, pwr=pwr, online=True)


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
            payload = json_loads(listing.read_text(encoding="utf-8"))
            for d in payload.get("devices") or []:
                sn = str(d.get("sn") or "")
                if not ecoflow_sn_public(sn):
                    continue
                names[sn] = _label_for_sn(sn, d.get("productName") or sn)
        except Exception:
            pass
    devices = []
    banks = []
    newest = 0
    for qf in sorted((root / "quota").glob("*.json")):
        try:
            raw = json_loads(qf.read_text(encoding="utf-8"))
        except Exception:
            continue
        newest = max(newest, int(raw.get("at") or 0))
        data = ((raw.get("body") or {}).get("data") or raw.get("data") or {})
        if not isinstance(data, dict):
            continue
        sn = qf.stem
        if not ecoflow_sn_public(sn):
            continue
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


def _append_ecoflow_sqlite(sn: str, row: dict) -> None:
    """Keep the Linux 10s snapshots db current. jsonl remains the live chart store."""
    import sqlite3

    if not ecoflow_sn_public(sn):
        return
    db = ecoflow_dir() / "ecoflow-10s.db"
    if not db.is_file():
        return
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        con = sqlite3.connect(str(db), timeout=5)
        try:
            con.execute(
                "INSERT INTO snapshots "
                "(ts, sn, online, soc, in_w, out_w, solar_w, raw_json, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    now_iso,
                    sn,
                    1 if row.get("deviceOnline") else 0,
                    row.get("soc"),
                    row.get("inW") or 0,
                    row.get("outW") or 0,
                    row.get("solarW") or 0,
                    json.dumps(row, separators=(",", ":")),
                    now_iso,
                ),
            )
            con.commit()
        finally:
            con.close()
    except Exception as e:
        log.warning("ecoflow sqlite append skipped: %s", e)


def _append_ecoflow_history(sn: str, *, soc, pwr: dict, online: bool) -> None:
    """Keep the jsonl charts current. Quota JSON alone is not a time series."""
    if not ecoflow_sn_public(sn):
        return
    ensure_data_layout()
    hist = ecoflow_dir() / "history"
    row = {
        "at": int(time.time() * 1000),
        "deviceOnline": bool(online),
        "soc": soc,
        "solarW": pwr.get("pv_w") or 0,
        "inW": pwr.get("ac_in_w") or 0,
        "outW": pwr.get("dc_out_w") or 0,
        "offCircuit": not online,
    }
    try:
        hist.mkdir(parents=True, exist_ok=True)
        path = hist / f"{sn}.jsonl"
        with path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(row, separators=(",", ":")) + "\n")
            fh.flush()
            os.fsync(fh.fileno())
    except OSError as e:
        log.warning("ecoflow history write skipped: %s", e)
        return
    _append_ecoflow_sqlite(sn, row)


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


def _ecoflow_roots() -> list[Path]:
    """Live EcoFlow tree only. Leftovers on E: / D: are not read."""
    ensure_data_layout()
    return [ecoflow_dir()]


def _ecoflow_root() -> Path | None:
    ensure_data_layout()
    return ecoflow_dir()


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
        if not ecoflow_sn_public(device):
            continue
        for line in lines:
            line = line.strip().strip("\x00")
            if not line.startswith("{"):
                continue
            try:
                row = json_loads(line)
            except Exception:
                continue
            yield device, row


_HOST_SAMPLE_MIN_GAP_S = 50
_last_host_sample_at = 0.0


def _host_history_paths() -> list[Path]:
    """Live host samples only. One file."""
    ensure_data_layout()
    return [host_history_path()]


def record_host_sample(*, force: bool = False) -> dict | None:
    """Append one CPU/RAM/temp/battery/disk sample (~1/min). Safe from desk/API/cron."""
    global _last_host_sample_at
    now = time.time()
    if not force and now - _last_host_sample_at < _HOST_SAMPLE_MIN_GAP_S:
        return None
    from apps.core import config
    from apps.core.host_metrics import snapshot

    try:
        row = snapshot(home=config.AVA_HOME)
    except Exception as e:
        log.debug("host sample skipped: %s", e)
        return None
    ensure_data_layout()
    out = host_history_path()
    try:
        out.parent.mkdir(parents=True, exist_ok=True)
        with out.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(row, separators=(",", ":")) + "\n")
        _last_host_sample_at = now
    except OSError as e:
        log.debug("host sample write skipped: %s", e)
        return None
    return row


def _host_temp_c() -> float | None:
    """Best-effort CPU / ACPI thermal zone (°C). None if not sampled."""
    try:
        from apps.core.host_metrics import host_temp_c
        c, _src = host_temp_c()
        return c
    except Exception:
        return None


def _cpu_from_row(row: dict) -> float | None:
    for key in ("cpu_pct", "hostCpu", "cpu", "host_cpu"):
        v = row.get(key)
        if v is None or v == "":
            continue
        try:
            n = float(v)
        except (TypeError, ValueError):
            continue
        if 0 <= n <= 100:
            return round(n, 2)
    return None


def _mem_from_row(row: dict) -> float | None:
    for key in ("mem_pct", "ram_pct", "hostRam", "ram"):
        v = row.get(key)
        if v is None or v == "":
            continue
        try:
            n = float(v)
        except (TypeError, ValueError):
            continue
        if 0 <= n <= 100:
            return round(n, 2)
    return None


def _temp_from_row(row: dict) -> float | None:
    for key in ("temp_c", "cpu_temp_c", "cpuTempC", "temp"):
        v = row.get(key)
        if v is None or v == "":
            continue
        try:
            n = float(v)
        except (TypeError, ValueError):
            continue
        if -20 <= n <= 120:
            return round(n, 2)
    return None


def _battery_from_row(row: dict) -> float | None:
    for key in ("battery_pct", "host_battery_pct", "batt_pct"):
        v = row.get(key)
        if v is None or v == "":
            continue
        try:
            n = float(v)
        except (TypeError, ValueError):
            continue
        if 0 <= n <= 100:
            return round(n, 2)
    return None


def _pct_from_row(row: dict, *keys: str) -> float | None:
    for key in keys:
        v = row.get(key)
        if v is None or v == "":
            continue
        try:
            n = float(v)
        except (TypeError, ValueError):
            continue
        if 0 <= n <= 100:
            return round(n, 2)
    return None


def _iter_host_metric_rows(*, tail: int = 2000):
    """Yield host samples from history files."""
    for path in _host_history_paths():
        if not path.is_file():
            continue
        try:
            raw = path.read_bytes()
        except OSError:
            continue
        text = raw.replace(b"\x00", b"").decode("utf-8", errors="replace")
        lines = text.splitlines()[-tail:]
        for line in lines:
            line = line.strip()
            if not line.startswith("{"):
                continue
            try:
                row = json_loads(line)
            except Exception:
                continue
            cpu = _cpu_from_row(row)
            mem = _mem_from_row(row)
            temp = _temp_from_row(row)
            batt = _battery_from_row(row)
            gpu = _pct_from_row(row, "gpu_pct", "igpu_pct")
            npu = _pct_from_row(row, "npu_pct")
            if all(v is None for v in (cpu, mem, temp, batt, gpu, npu)):
                continue
            at_ms = _parse_history_at_ms(row, int(time.time() * 1000))
            if at_ms is None:
                t = row.get("t")
                try:
                    at_ms = int(t)
                    if at_ms < 10_000_000_000:
                        at_ms *= 1000
                except (TypeError, ValueError):
                    continue
            yield {
                "at_ms": at_ms,
                "cpu_pct": cpu,
                "mem_pct": mem,
                "temp_c": temp,
                "battery_pct": batt,
                "gpu_pct": gpu,
                "npu_pct": npu,
            }


def _host_metrics_by_minute(hours: float, now_ms: int) -> dict[int, dict[str, float]]:
    window_ms = now_ms - int(hours * 3600_000)
    by_min: dict[int, dict[str, float]] = {}
    for row in _iter_host_metric_rows(tail=max(400, int(hours * 60) + 120)):
        at_ms = row["at_ms"]
        if at_ms < window_ms:
            continue
        minute = (at_ms // 60_000) * 60_000
        slot = by_min.setdefault(minute, {})
        for key in ("cpu_pct", "mem_pct", "temp_c", "battery_pct", "gpu_pct", "npu_pct"):
            if row.get(key) is not None:
                slot[key] = row[key]
    return by_min


def history_points(hours: float = 12) -> dict:
    """Bank + per-pack (Delta / River) + host time series for the last N hours."""
    hours = max(0.25, min(float(hours or 12), 168))
    record_host_sample()
    now_ms = int(time.time() * 1000)
    window_ms = now_ms - int(hours * 3600_000)
    tail = max(800, int(hours * 60 * 4) + 200)
    # Merge every EcoFlow history tree so Delta + River both appear even if
    # samples live under different data roots.
    buckets: dict[int, dict[str, dict[str, float | None]]] = {}
    sample_at: dict[tuple[int, str], int] = {}
    for root in _ecoflow_roots():
        hist = root / "history"
        if not hist.is_dir():
            continue
        for device, row in _iter_history_rows(hist, tail=tail):
            at_ms = _parse_history_at_ms(row, now_ms)
            if at_ms is None or at_ms < window_ms:
                continue
            minute = (at_ms // 60_000) * 60_000
            key = (minute, device)
            prev = sample_at.get(key)
            if prev is not None and at_ms < prev:
                continue
            solar = row.get("solarW")
            out = row.get("outW")
            soc = row.get("soc")
            try:
                sample = {
                    "solar_w": float(solar) if solar is not None else None,
                    "load_w": float(out) if out is not None else None,
                    "soc": float(soc) if soc is not None else None,
                    "role": _device_role(device),
                }
            except (TypeError, ValueError):
                continue
            buckets.setdefault(minute, {})[device] = sample
            sample_at[key] = at_ms
    host_by_min = _host_metrics_by_minute(hours, now_ms)
    minutes = sorted(set(buckets) | set(host_by_min))
    points: list[dict] = []
    for minute in minutes:
        by_dev = buckets.get(minute, {})
        samples = list(by_dev.values())
        solar_vals = [s["solar_w"] for s in samples if s["solar_w"] is not None]
        load_vals = [s["load_w"] for s in samples if s["load_w"] is not None]
        soc_vals = [
            s["soc"] for s in samples
            if s["soc"] is not None and 0 <= float(s["soc"]) <= 100
        ]

        def role_val(role: str, key: str) -> float | None:
            vals = [
                float(s[key]) for s in samples
                if s.get("role") == role and s.get(key) is not None
            ]
            if key == "soc":
                vals = [v for v in vals if 0 <= v <= 100]
            if not vals:
                return None
            return round(sum(vals) / len(vals), 1) if key == "soc" else round(sum(vals), 1)

        t = datetime.fromtimestamp(minute / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z")
        host = host_by_min.get(minute) or {}
        points.append({
            "t": t,
            "solar_w": round(sum(solar_vals), 1) if solar_vals else None,
            "delta_solar_w": role_val("delta", "solar_w"),
            "river_solar_w": role_val("river", "solar_w"),
            "load_w": round(sum(load_vals), 1) if load_vals else None,
            "soc": round(sum(soc_vals) / len(soc_vals), 1) if soc_vals else None,
            "delta_soc": role_val("delta", "soc"),
            "river_soc": role_val("river", "soc"),
            "cpu_pct": host.get("cpu_pct"),
            "mem_pct": host.get("mem_pct"),
            "temp_c": host.get("temp_c"),
            "host_battery_pct": host.get("battery_pct"),
            "gpu_pct": host.get("gpu_pct"),
            "npu_pct": host.get("npu_pct"),
        })
    return {"ok": True, "points": points, "hours": hours}


def _series_stats(points: list[dict], key: str) -> dict:
    vals = []
    for p in points:
        v = p.get(key)
        if v is None or v == "":
            continue
        try:
            vals.append(float(v))
        except (TypeError, ValueError):
            continue
    if not vals:
        return {"avg": None, "min": None, "max": None, "samples": 0, "sum": None}
    return {
        "avg": round(sum(vals) / len(vals), 2),
        "min": round(min(vals), 2),
        "max": round(max(vals), 2),
        "samples": len(vals),
        "sum": round(sum(vals), 2),
    }


def _energy_wh(points: list[dict], key: str) -> float | None:
    """Approx Wh from ~1-minute average-watt samples."""
    vals = []
    for p in points:
        v = p.get(key)
        if v is None:
            continue
        try:
            vals.append(float(v))
        except (TypeError, ValueError):
            continue
    if not vals:
        return None
    return round(sum(vals) / 60.0, 2)


def history_rollups() -> dict:
    """Averages / min / max / energy totals for several windows."""
    windows = (("1h", 1), ("6h", 6), ("12h", 12), ("24h", 24), ("7d", 168))
    full = history_points(168)
    points = list(full.get("points") or [])
    now_ms = int(time.time() * 1000)
    out: dict[str, dict] = {}
    for label, hours in windows:
        cut = now_ms - int(hours * 3600_000)
        subset = []
        for p in points:
            t = p.get("t") or ""
            try:
                # 2026-08-20T22:20:00Z
                at = datetime.fromisoformat(t.replace("Z", "+00:00")).timestamp() * 1000
            except Exception:
                continue
            if at >= cut:
                subset.append(p)
        out[label] = {
            "hours": hours,
            "points": len(subset),
            "solar_w": _series_stats(subset, "solar_w"),
            "delta_solar_w": _series_stats(subset, "delta_solar_w"),
            "river_solar_w": _series_stats(subset, "river_solar_w"),
            "load_w": _series_stats(subset, "load_w"),
            "soc": _series_stats(subset, "soc"),
            "delta_soc": _series_stats(subset, "delta_soc"),
            "river_soc": _series_stats(subset, "river_soc"),
            "cpu_pct": _series_stats(subset, "cpu_pct"),
            "mem_pct": _series_stats(subset, "mem_pct"),
            "temp_c": _series_stats(subset, "temp_c"),
            "host_battery_pct": _series_stats(subset, "host_battery_pct"),
            "gpu_pct": _series_stats(subset, "gpu_pct"),
            "npu_pct": _series_stats(subset, "npu_pct"),
            "solar_wh": _energy_wh(subset, "solar_w"),
            "load_wh": _energy_wh(subset, "load_w"),
        }
    # Lifetime host metrics if present
    try:
        from apps.core import config
        life_path = config.DATA_DIR / "state" / "host-metrics" / "lifetime.json"
        if life_path.is_file():
            life = json_loads(life_path.read_text(encoding="utf-8"))
            n = int(life.get("sample_total") or 0)
            if n > 0:
                out["lifetime"] = {
                    "hours": None,
                    "points": n,
                    "cpu_pct": {
                        "avg": round(float(life.get("cpu_sum") or 0) / n, 2),
                        "min": None,
                        "max": None,
                        "samples": n,
                        "sum": round(float(life.get("cpu_sum") or 0), 2),
                    },
                    "mem_pct": {
                        "avg": round(float(life.get("ram_sum") or 0) / n, 2),
                        "min": None,
                        "max": None,
                        "samples": n,
                        "sum": round(float(life.get("ram_sum") or 0), 2),
                    },
                    "solar_w": _series_stats([], "solar_w"),
                    "load_w": _series_stats([], "load_w"),
                    "soc": _series_stats([], "soc"),
                    "temp_c": _series_stats([], "temp_c"),
                    "solar_wh": None,
                    "load_wh": None,
                    "note": "Host CPU/RAM lifetime samples from desk metrics",
                }
    except Exception:
        pass
    return {"ok": True, "windows": out}


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
    from apps.core.services import load_categories, sun_times
    cats = load_categories.categories(devices)
    load_categories.append_history(cats)
    sun = sun_times.facts()
    night = load_categories.night_charge_callout(devices, sun=sun)
    solar_w = load_categories.solar_in_w(devices)
    ebatt_w = load_categories.ebatt_in_w(devices)
    in_w = round(solar_w + ebatt_w, 1)
    snap["solar_in_w"] = solar_w
    snap["ebatt_in_w"] = ebatt_w
    snap["load_w"] = round(dc, 1)
    snap["power_w"] = solar_w
    snap["state"] = snap.get("state") or _bank_state(devices)
    snap["sun"] = {
        "sunrise": sun.get("sunrise"),
        "sunset": sun.get("sunset"),
        "after_sunset": sun.get("after_sunset"),
        "before_sunrise": sun.get("before_sunrise"),
    }
    if night:
        snap["night_charge"] = night
    if ebatt_w >= 20:
        snap["ebatt"] = {
            "in_w": ebatt_w,
            "nameplate_wh": load_categories.EBATT_WH,
            "label": "E-Batt input",
        }
    snap["totals"] = {
        "solar_in_w": solar_w,
        "ebatt_in_w": ebatt_w,
        "load_w": round(dc, 1),
        "dc_load_w": round(dc, 1),
        "ac_in_w": round(ac_in, 1),
        "ac_out_w": round(ac_out, 1),
        "generator_w": round(generator, 1),
        "transfer_w": round(transfer, 1),
        "appliance_w": round(appliance, 1),
        "starlink_lights_w": cats["starlink_lights_w"],
        "emergency_pack_w": cats["emergency_pack_w"],
        "server_mobile_w": cats["server_mobile_w"],
        "hard_drives_12v_w": cats["hard_drives_12v_w"],
        "net_w": round(in_w - dc, 1),
        "bank_avg_pct": round(sum(socs) / len(socs), 1) if socs else snap.get("battery_pct"),
        "packs": len(devices),
        "categories": cats,
    }
    # A plain mean of a 1024 Wh and a 768 Wh pack reports a level that does not
    # exist. Weight by capacity and carry the stored kWh alongside it.
    try:
        from apps.core.services import energy
        from apps.core.host_metrics import host_battery

        host_pct = None
        try:
            hb = host_battery() or {}
            host_pct = hb.get("pct")
        except Exception:
            host_pct = None

        summary = energy.summary(
            devices, pv_w=solar_w, load_w=dc, ebatt_w=ebatt_w, host_battery_pct=host_pct
        )
        if summary.get("ok"):
            # Prefer combined packs+host when host SOC is known; keep EcoFlow-only as site_bank.
            weighted = summary.get("total_pct")
            if weighted is None:
                weighted = summary["bank_pct"]
            snap["totals"].update(
                {
                    "bank_pct_weighted": weighted,
                    "site_bank_pct": summary.get("site_bank_pct", summary["bank_pct"]),
                    "stored_wh": summary["stored_wh"],
                    "stored_kwh": summary["stored_kwh"],
                    "capacity_wh": summary["capacity_wh"],
                    "capacity_kwh": summary["capacity_kwh"],
                    "total_pct": summary.get("total_pct"),
                    "total_stored_wh": summary.get("total_stored_wh"),
                    "total_capacity_wh": summary.get("total_capacity_wh"),
                }
            )
            snap["energy"] = summary
    except Exception as e:
        log.debug("energy rollup skipped: %s", e)
    snap["averages"] = _history_averages()
    cat_avg = load_categories.history_averages(1)
    if cat_avg:
        snap["averages"] = {**(snap.get("averages") or {}), "categories_1h": cat_avg}
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
    serial_nos = public_serials(os.getenv("AVA_ECOFLOW_SN", "").split(","))

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
    from apps.core.services.reports import latest_report

    nws_report = latest_report("nws-weather-*.md")
    if nws_report:
        nws_age_m = int((time.time() - nws_report.stat().st_mtime) / 60)
        nws_snippet = nws_report.read_text(encoding="utf-8", errors="replace")
        # Pull just the first forecast period for the summary
        import re
        cond_match = re.search(r"###?\s*\w.*?\n(.+)", nws_snippet)
        conditions = cond_match.group(1).strip() if cond_match else "see NWS report"
        lines.append(f"Conditions: {conditions} (NWS {nws_age_m}m ago)\n")
    else:
        lines.append("Conditions: NWS data not yet available\n")

    content = "\n".join(lines)
    if not content.strip():
        log.warning("Solar+weather: skip empty report")
        return
    content_hash = hashlib.md5(content.encode()).hexdigest()

    # Always write the report; only skip Discord post if unchanged
    ts = now_utc.strftime("%Y-%m-%dT%H")
    report_path = config.REPORTS_DIR / f"solar-weather-{ts}.md"
    report_path.write_text(content, encoding="utf-8")
    log.info("Solar+weather report written: %s", report_path.name)

    if content_hash == _last_hash:
        log.debug("Solar+weather: no change, skipping Discord post")
        return
    _last_hash = content_hash

    from apps.core.services import reports
    reports.queue_public_draft("solar", content[:1900], source="cron")
    log.info("Solar+weather draft queued for operator review")

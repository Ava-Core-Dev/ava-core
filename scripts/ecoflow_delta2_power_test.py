#!/usr/bin/env python3
r"""Safe EcoFlow DELTA 2 outlet / switch test (Open API cloud).

Default is dry-run. Real writes need ``--execute``.

AC master on DELTA 2 is treated as Starlink / site AC today — refuse unless
``--confirm-starlink-risk`` is also passed.

Credential locations (values never printed):
  - ``C:\\Users\\rootr\\ava\\.env`` — ``AVA_ECOFLOW_ACCESS_KEY``,
    ``AVA_ECOFLOW_SECRET_KEY``, ``AVA_ECOFLOW_SN``, optional ``AVA_ECOFLOW_BASE_URL``
  - ``C:\\Users\\rootr\\ava\\credentials.env`` — same keys (fallback)

Connection mode today: cloud Open API (``api-a.ecoflow.com``), not LAN MQTT.
Ava's live watts path is the same HMAC GET quota poller
(``apps/core/crons/since_last_fire/solar_weather.py``), every ~2 minutes.

Windows PowerShell: ``cd`` into the Ava tree first. Use ``.\.venv\Scripts\python.exe``
(leading ``.\``) or the full path — bare ``.venv\...`` is treated as a module
name and fails with CommandNotFoundException. Run one command per line.

Examples (from ``C:\Users\rootr\ava``)::

  .\.venv\Scripts\python.exe scripts\ecoflow_delta2_power_test.py
  .\.venv\Scripts\python.exe scripts\ecoflow_delta2_power_test.py --switch car --off
  .\.venv\Scripts\python.exe scripts\ecoflow_delta2_power_test.py --switch car --off --execute
  .\.venv\Scripts\python.exe scripts\ecoflow_delta2_power_test.py --switch ac --off --execute --confirm-starlink-risk

Full-path form (any cwd)::

  C:\Users\rootr\ava\.venv\Scripts\python.exe C:\Users\rootr\ava\scripts\ecoflow_delta2_power_test.py --switch ac --off
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import sys
import time
from pathlib import Path
from typing import Any
from urllib import error, request

ROOT = Path(__file__).resolve().parents[1]
DELTA_SN = "R331ZAB5SG6S2858"
DEFAULT_BASE = "https://api-a.ecoflow.com"

# Least-dangerous default: 12V car already off on this bank when last checked.
DEFAULT_SWITCH = "car"

SWITCHES: dict[str, dict[str, Any]] = {
    "car": {
        "label": "12V car / cigarette port (mpptCar)",
        "danger": "low",
        "moduleType": 5,
        "operateType": "mpptCar",
        "params_for": lambda on: {"enabled": 1 if on else 0},
        "quota_keys": ("mppt.carState", "pd.carState"),
    },
    "dc": {
        "label": "DC / USB button (dcOutCfg)",
        "danger": "medium — may feed USB / 12V loads (drives)",
        "moduleType": 1,
        "operateType": "dcOutCfg",
        "params_for": lambda on: {"enabled": 1 if on else 0},
        "quota_keys": ("pd.dcOutState",),
    },
    "beep": {
        "label": "Quiet mode / beep (quietMode) — not a power cut",
        "danger": "none (audio only)",
        "moduleType": 5,
        "operateType": "quietMode",
        "params_for": lambda on: {"enabled": 1 if on else 0},  # 1=quiet
        "quota_keys": ("mppt.beepState", "pd.beepMode"),
        "note": "enabled=1 means quiet; --off sends enabled=0 (beep normal)",
    },
    "ac": {
        "label": "AC master / inverter out (acOutCfg)",
        "danger": "HIGH — Starlink + site AC on DELTA 2 leftover AC today",
        "moduleType": 5,
        "operateType": "acOutCfg",
        # Ignore sentinels from EcoFlow / ioBroker Delta 2 docs.
        "params_for": lambda on: {
            "enabled": 1 if on else 0,
            "xboost": 255,
            "out_freq": 255,
            "out_voltage": -1,
        },
        "quota_keys": ("inv.cfgAcEnabled", "pd.acEnabled"),
        "requires_starlink_confirm": True,
    },
}


def _load_env_files() -> None:
    try:
        from dotenv import load_dotenv
    except ImportError:
        load_dotenv = None  # type: ignore
    for p in (ROOT / ".env", ROOT / "credentials.env"):
        if not p.is_file():
            continue
        if load_dotenv:
            load_dotenv(p, override=False)
        else:
            for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
                s = line.strip()
                if not s or s.startswith("#") or "=" not in s:
                    continue
                k, _, v = s.partition("=")
                k, v = k.strip(), v.strip().strip('"').strip("'")
                if k and k not in os.environ:
                    os.environ[k] = v


def _cred_status() -> dict[str, Any]:
    key = bool(os.getenv("AVA_ECOFLOW_ACCESS_KEY", "").strip())
    secret = bool(os.getenv("AVA_ECOFLOW_SECRET_KEY", "").strip())
    sn_raw = os.getenv("AVA_ECOFLOW_SN", "")
    sns = [s.strip().upper() for s in sn_raw.replace(";", ",").split(",") if s.strip()]
    base = (os.getenv("AVA_ECOFLOW_BASE_URL") or DEFAULT_BASE).strip() or DEFAULT_BASE
    return {
        "mode": "cloud_open_api",
        "base_url": base,
        "access_key": "set" if key else "missing",
        "secret_key": "set" if secret else "missing",
        "sn_count": len(sns),
        "delta_in_sn_list": DELTA_SN in sns or not sns,
        "env_files": [
            {"path": str(ROOT / ".env"), "present": (ROOT / ".env").is_file()},
            {
                "path": str(ROOT / "credentials.env"),
                "present": (ROOT / "credentials.env").is_file(),
            },
        ],
    }


def _flatten(obj: Any, prefix: str = "") -> dict[str, str]:
    out: dict[str, str] = {}
    if isinstance(obj, dict):
        for k, v in obj.items():
            key = f"{prefix}.{k}" if prefix else str(k)
            out.update(_flatten(v, key))
    elif isinstance(obj, list):
        for i, item in enumerate(obj):
            key = f"{prefix}[{i}]"
            out.update(_flatten(item, key))
    else:
        out[prefix] = str(obj)
    return out


def _qstring(params: dict[str, str]) -> str:
    return "&".join(f"{k}={params[k]}" for k in sorted(params))


def _sign_headers(access_key: str, secret_key: str, body: dict | None) -> dict[str, str]:
    nonce = str(int(100000 + (time.time() * 1000) % 900000))
    timestamp = str(int(time.time() * 1000))
    headers = {"accessKey": access_key, "nonce": nonce, "timestamp": timestamp}
    flat = _flatten(body) if body else {}
    sign_str = (_qstring(flat) + "&" if flat else "") + _qstring(headers)
    sig = hmac.new(secret_key.encode(), sign_str.encode(), hashlib.sha256).hexdigest()
    headers["sign"] = sig
    headers["Accept"] = "application/json"
    headers["User-Agent"] = "AvaIvy/2.0 (EcoFlow power test)"
    return headers


def _http_json(
    method: str,
    url: str,
    *,
    headers: dict[str, str],
    body: dict | None = None,
    timeout: float = 20,
) -> dict[str, Any]:
    data = None
    hdrs = dict(headers)
    if body is not None:
        data = json.dumps(body, separators=(",", ":")).encode("utf-8")
        hdrs["Content-Type"] = "application/json"
    req = request.Request(url, data=data, headers=hdrs, method=method)
    try:
        with request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            try:
                parsed = json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                parsed = {"_raw": raw[:500]}
            return {
                "http_status": getattr(resp, "status", 200),
                "ok": True,
                "json": parsed,
            }
    except error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            parsed = {"_raw": raw[:500]}
        return {"http_status": e.code, "ok": False, "json": parsed, "error": str(e)}
    except Exception as e:
        return {"http_status": None, "ok": False, "json": {}, "error": str(e)}


def _read_quota_disk(sn: str) -> dict[str, Any]:
    path = ROOT / "data" / "ecoflow" / "quota" / f"{sn}.json"
    if not path.is_file():
        return {"present": False, "path": str(path)}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        return {"present": True, "path": str(path), "error": str(e)}
    at = int(raw.get("at") or 0)
    at_s = at / 1000.0 if at > 1_000_000_000_000 else float(at or 0)
    age_s = int(time.time() - at_s) if at_s else None
    data = (raw.get("body") or {}).get("data") or {}
    return {
        "present": True,
        "path": str(path),
        "age_s": age_s,
        "soc": data.get("bms_bmsStatus.soc") or data.get("pd.soc"),
        "inv.cfgAcEnabled": data.get("inv.cfgAcEnabled"),
        "pd.dcOutState": data.get("pd.dcOutState"),
        "mppt.carState": data.get("mppt.carState"),
        "pd.carState": data.get("pd.carState"),
        "inv.outputWatts": data.get("inv.outputWatts"),
        "pd.wattsOutSum": data.get("pd.wattsOutSum"),
        "nkeys": len(data) if isinstance(data, dict) else 0,
    }


def _build_command(switch: str, turn_on: bool) -> dict[str, Any]:
    meta = SWITCHES[switch]
    return {
        "sn": DELTA_SN,
        "moduleType": meta["moduleType"],
        "operateType": meta["operateType"],
        "params": meta["params_for"](turn_on),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="DELTA 2 EcoFlow switch test (dry-run by default).",
    )
    parser.add_argument(
        "--switch",
        choices=sorted(SWITCHES),
        default=DEFAULT_SWITCH,
        help=f"Which outlet/switch (default: {DEFAULT_SWITCH})",
    )
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--off", action="store_true", default=True, help="Turn OFF (default)")
    group.add_argument("--on", action="store_true", help="Turn ON")
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Actually PUT the command. Without this flag, only print the payload.",
    )
    parser.add_argument(
        "--confirm-starlink-risk",
        action="store_true",
        help="Required together with --execute when --switch ac (kills DELTA AC / Starlink).",
    )
    parser.add_argument(
        "--sn",
        default=DELTA_SN,
        help=f"Device serial (default public DELTA 2 {DELTA_SN})",
    )
    args = parser.parse_args(argv)
    turn_on = bool(args.on)
    if args.sn.strip().upper() != DELTA_SN:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": "refusing non-DELTA-2 serial in this safety harness",
                    "allowed": DELTA_SN,
                    "got": args.sn.strip().upper(),
                },
                indent=2,
            )
        )
        return 2

    _load_env_files()
    creds = _cred_status()
    meta = SWITCHES[args.switch]
    cmd = _build_command(args.switch, turn_on)
    disk = _read_quota_disk(DELTA_SN)

    report: dict[str, Any] = {
        "ok": True,
        "mode": creds,
        "device": {"label": "DELTA 2", "sn": DELTA_SN},
        "disk_quota": disk,
        "switch": {
            "id": args.switch,
            "label": meta["label"],
            "danger": meta["danger"],
            "action": "on" if turn_on else "off",
            "note": meta.get("note"),
        },
        "command": cmd,
        "endpoint": f"{creds['base_url'].rstrip('/')}/iot-open/sign/device/quota",
        "method": "PUT",
        "dry_run": not args.execute,
        "executed": False,
        "response": None,
        "blocked": None,
    }

    if creds["access_key"] == "missing" or creds["secret_key"] == "missing":
        report["ok"] = False
        report["blocked"] = "missing AVA_ECOFLOW_ACCESS_KEY / AVA_ECOFLOW_SECRET_KEY"
        print(json.dumps(report, indent=2))
        return 1

    if not args.execute:
        report["hint"] = (
            "Dry-run only. Re-run with --execute to PUT. "
            "For AC, also pass --confirm-starlink-risk."
        )
        print(json.dumps(report, indent=2))
        return 0

    if meta.get("requires_starlink_confirm") and not args.confirm_starlink_risk:
        report["ok"] = False
        report["blocked"] = (
            "AC execute refused: DELTA leftover AC is Starlink/site load. "
            "Pass --confirm-starlink-risk if you really mean to cut AC."
        )
        print(json.dumps(report, indent=2))
        return 3

    access = os.getenv("AVA_ECOFLOW_ACCESS_KEY", "").strip()
    secret = os.getenv("AVA_ECOFLOW_SECRET_KEY", "").strip()
    url = report["endpoint"]
    headers = _sign_headers(access, secret, cmd)
    # Do not log sign / keys.
    safe_headers = {
        k: ("<redacted>" if k in {"sign", "accessKey"} else v)
        for k, v in headers.items()
    }
    report["request_headers_safe"] = safe_headers
    result = _http_json("PUT", url, headers=headers, body=cmd)
    report["executed"] = True
    report["response"] = result
    code = str((result.get("json") or {}).get("code") or "")
    report["ok"] = bool(result.get("ok")) and code in {"0", "None", ""}
    if not report["ok"]:
        report["blocked"] = (
            f"EcoFlow PUT failed http={result.get('http_status')} "
            f"code={code} msg={(result.get('json') or {}).get('message')}"
        )
        print(json.dumps(report, indent=2))
        return 4

    # Optional post-read of selected quotas (GET all is heavy; use disk after next cron).
    report["post_note"] = (
        "Command accepted by EcoFlow cloud. Wait for next ecoflow-quota (~2 min) "
        "or re-check RootRecord Core Ops/Ecoflow/quota for state change."
    )
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())

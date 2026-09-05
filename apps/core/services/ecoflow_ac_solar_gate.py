"""DELTA 2 AC ↔ solar hysteresis (MPPT fight with RIVER 2).

Gate on Delta PV input (``mppt.inWatts`` — same primary key as ``pack_power`` /
``pv_w``). ``pd.wattsInSum`` / ``pd.inWatts`` are total pack input and are
logged only; they can include non-PV paths and are not the solar-fight signal.

Rules (operator 2026-09-05):
  - input ≥ 300 W → AC OFF (both packs take PV cleanly)
  - input ≤ 200 W (incl. zero) → AC ON (AC out feeds River path; stops solar fight)
  - 200–300 W dead band → no change

Cron: hooked after ``ecoflow-quota`` (~2 min). Not a separate scheduler job.
Disable: set ``enabled`` false in ``data/state/ecoflow-ac-solar-gate.json``
or env ``AVA_ECOFLOW_AC_SOLAR_GATE=0``.

Intentional AC toggles — no interactive ``--confirm-starlink-risk``. Starlink on
DELTA leftover AC is cut when this gate turns AC OFF; see common-bugs.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import os
import time
from pathlib import Path
from typing import Any
from urllib import error, request

from apps.core import config
from apps.core.services.data_layout import ensure_data_layout
from apps.core.services.load_categories import pack_power, watts

log = logging.getLogger("ava.ecoflow.ac_solar_gate")

# Desktop notify phrases (Media/public/audio/words/ecoflow/). Starlink rides
# DELTA leftover AC — OFF uses the Starlink caution line.
PHRASE_AC_ON = "phrase_ecoflow_ac_on_solar_low"
PHRASE_AC_OFF = "phrase_ecoflow_ac_off_starlink"
PHRASE_AC_FAIL = "phrase_ecoflow_ac_change_failed"
PHRASE_GATE_ARMED = "phrase_ecoflow_ac_gate_armed"
PHRASE_GATE_DISABLED = "phrase_ecoflow_ac_gate_disabled"
VOICE_COOLDOWN_S = 90

DELTA_SN = "R331ZAB5SG6S2858"
DEFAULT_BASE = "https://api-a.ecoflow.com"

# Hysteresis (watts). Dead band between ON and OFF thresholds.
OFF_AT_W = 300.0
ON_AT_W = 200.0

# Prefer not flapping around the 2-minute quota cadence.
DEFAULT_COOLDOWN_S = 180
# Match solar_weather ECO_STALE_S — refuse action on stale disk quota.
MAX_QUOTA_AGE_S = 180

STATE_NAME = "ecoflow-ac-solar-gate.json"
# Primary gate field (evidence in data/ecoflow/quota/{DELTA}.json).
GATE_KEY = "mppt.inWatts"
TOTAL_IN_KEYS = ("pd.wattsInSum", "pd.inWatts")
AC_KEYS = ("inv.cfgAcEnabled", "pd.acEnabled", "mppt.cfgAcEnabled")


def state_path() -> Path:
    return config.DATA_DIR / "state" / STATE_NAME


def _env_enabled_override() -> bool | None:
    raw = (os.getenv("AVA_ECOFLOW_AC_SOLAR_GATE") or "").strip().lower()
    if not raw:
        return None
    if raw in {"0", "false", "off", "no", "disabled"}:
        return False
    if raw in {"1", "true", "on", "yes", "enabled"}:
        return True
    return None


def load_state() -> dict[str, Any]:
    path = state_path()
    base: dict[str, Any] = {
        "enabled": True,
        "cooldown_s": DEFAULT_COOLDOWN_S,
        "off_at_w": OFF_AT_W,
        "on_at_w": ON_AT_W,
        "gate_key": GATE_KEY,
        "sn": DELTA_SN,
        "last_input_w": None,
        "last_total_in_w": None,
        "last_ac_enabled": None,
        "desired_ac": None,
        "last_decision": None,
        "last_decision_at": None,
        "last_action": None,
        "last_action_at": None,
        "last_skip_reason": None,
        "starlink_risk_noted": True,
        "note": (
            "DELTA 2 AC solar gate. enabled=false disables. "
            "Env AVA_ECOFLOW_AC_SOLAR_GATE=0 also disables."
        ),
    }
    if not path.is_file():
        return base
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        log.warning("ac-solar-gate state read failed: %s", e)
        return base
    if isinstance(raw, dict):
        base.update(raw)
    return base


def save_state(state: dict[str, Any]) -> None:
    ensure_data_layout()
    path = state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def _quota_path(sn: str = DELTA_SN) -> Path:
    return config.DATA_DIR / "ecoflow" / "quota" / f"{sn}.json"


def read_delta_quota() -> dict[str, Any]:
    """Load Delta quota from disk. Returns measured fields + age."""
    path = _quota_path()
    if not path.is_file():
        return {"ok": False, "error": "quota_missing", "path": str(path)}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        return {"ok": False, "error": str(e), "path": str(path)}
    at = int(raw.get("at") or 0)
    at_s = at / 1000.0 if at > 1_000_000_000_000 else float(at or 0)
    age_s = int(time.time() - at_s) if at_s else None
    data = (raw.get("body") or {}).get("data") or {}
    if not isinstance(data, dict):
        data = {}
    pwr = pack_power(data)
    # Gate = PV into Delta MPPT (mppt.inWatts). Same as pack_power pv_w.
    input_w = float(pwr.get("pv_w") or 0.0)
    total_in = watts(data.get("pd.wattsInSum"))
    if total_in <= 0:
        total_in = watts(data.get("pd.inWatts"))
    ac_raw = None
    for k in AC_KEYS:
        if data.get(k) is not None:
            ac_raw = data.get(k)
            break
    try:
        ac_on = bool(int(ac_raw)) if ac_raw is not None else None
    except (TypeError, ValueError):
        ac_on = None
    return {
        "ok": True,
        "path": str(path),
        "age_s": age_s,
        "fresh": age_s is not None and age_s <= MAX_QUOTA_AGE_S,
        "gate_key": GATE_KEY,
        "input_w": input_w,
        "mppt.inWatts": data.get("mppt.inWatts"),
        "total_in_w": total_in,
        "pd.wattsInSum": data.get("pd.wattsInSum"),
        "pd.inWatts": data.get("pd.inWatts"),
        "ac_on": ac_on,
        "ac_raw": ac_raw,
        "inv.cfgAcEnabled": data.get("inv.cfgAcEnabled"),
        "pd.acEnabled": data.get("pd.acEnabled"),
        "soc": data.get("bms_bmsStatus.soc") or data.get("pd.soc"),
    }


def decide(input_w: float, *, off_at: float = OFF_AT_W, on_at: float = ON_AT_W) -> str | None:
    """Return ``on``, ``off``, or None (dead band)."""
    w = float(input_w or 0.0)
    if w >= float(off_at):
        return "off"
    if w <= float(on_at):
        return "on"
    return None


def phrase_for_action(action: str | None) -> str | None:
    """Map a gate action to a whole-phrase clip id (or None = silence)."""
    if action == "put_ac_on":
        return PHRASE_AC_ON
    if action == "put_ac_off":
        return PHRASE_AC_OFF
    if isinstance(action, str) and action.startswith("put_failed_"):
        return PHRASE_AC_FAIL
    return None


def _enqueue_announce(phrase: str) -> None:
    """Fire-and-forget REPORT announce so the quota cron is not held on audio."""
    name = (phrase or "").strip()
    if not name:
        return

    async def _run() -> None:
        try:
            from apps.core.services import voice_events

            await voice_events.announce(name, cooldown_s=VOICE_COOLDOWN_S, priority="REPORT")
        except Exception as e:
            log.debug("ac-solar-gate voice skip: %s", e)

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        # CLI / no loop — skip desk play; cron path always has a loop.
        log.debug("ac-solar-gate voice skip (no event loop): %s", name)
        return
    loop.create_task(_run())


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
    headers["User-Agent"] = "AvaIvy/2.0 (EcoFlow AC solar gate)"
    return headers


def _ac_command(turn_on: bool) -> dict[str, Any]:
    return {
        "sn": DELTA_SN,
        "moduleType": 5,
        "operateType": "acOutCfg",
        "params": {
            "enabled": 1 if turn_on else 0,
            "xboost": 255,
            "out_freq": 255,
            "out_voltage": -1,
        },
    }


def _put_ac(turn_on: bool) -> dict[str, Any]:
    access = (os.getenv("AVA_ECOFLOW_ACCESS_KEY") or "").strip()
    secret = (os.getenv("AVA_ECOFLOW_SECRET_KEY") or "").strip()
    if not access or not secret:
        return {"ok": False, "error": "missing_ecoflow_keys"}
    base = (os.getenv("AVA_ECOFLOW_BASE_URL") or DEFAULT_BASE).strip() or DEFAULT_BASE
    url = f"{base.rstrip('/')}/iot-open/sign/device/quota"
    body = _ac_command(turn_on)
    headers = _sign_headers(access, secret, body)
    data = json.dumps(body, separators=(",", ":")).encode("utf-8")
    hdrs = dict(headers)
    hdrs["Content-Type"] = "application/json"
    req = request.Request(url, data=data, headers=hdrs, method="PUT")
    try:
        with request.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            try:
                parsed = json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                parsed = {"_raw": raw[:500]}
            code = str(parsed.get("code") or "")
            ok = code in {"0", "None", ""}
            return {
                "ok": ok,
                "http_status": getattr(resp, "status", 200),
                "code": code,
                "message": parsed.get("message"),
                "action": "on" if turn_on else "off",
            }
    except error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            parsed = {"_raw": raw[:500]}
        return {
            "ok": False,
            "http_status": e.code,
            "error": str(e),
            "message": parsed.get("message"),
            "action": "on" if turn_on else "off",
        }
    except Exception as e:
        return {"ok": False, "error": str(e), "action": "on" if turn_on else "off"}


def evaluate(*, execute: bool = False) -> dict[str, Any]:
    """Apply hysteresis against the newest on-disk Delta quota.

    ``execute=False`` → would-do only (still updates decision fields in state).
    ``execute=True`` → PUT AC when a change is required and safety checks pass.
    """
    now = time.time()
    state = load_state()
    env_en = _env_enabled_override()
    enabled = bool(state.get("enabled", True)) if env_en is None else env_en
    off_at = float(state.get("off_at_w") or OFF_AT_W)
    on_at = float(state.get("on_at_w") or ON_AT_W)
    cooldown_s = int(state.get("cooldown_s") or DEFAULT_COOLDOWN_S)

    quota = read_delta_quota()
    report: dict[str, Any] = {
        "ok": True,
        "enabled": enabled,
        "execute": bool(execute),
        "gate_key": GATE_KEY,
        "rules": {"off_at_w": off_at, "on_at_w": on_at, "dead_band": [on_at, off_at]},
        "cooldown_s": cooldown_s,
        "quota": {
            k: quota.get(k)
            for k in (
                "ok",
                "age_s",
                "fresh",
                "input_w",
                "total_in_w",
                "ac_on",
                "mppt.inWatts",
                "pd.wattsInSum",
                "soc",
            )
        },
        "decision": None,
        "would": None,
        "action": None,
        "skipped": None,
        "put": None,
        "state_path": str(state_path()),
    }

    if not quota.get("ok"):
        report["ok"] = False
        report["skipped"] = quota.get("error") or "quota_unreadable"
        state["last_skip_reason"] = report["skipped"]
        state["last_decision"] = "error"
        state["last_decision_at"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
        save_state(state)
        return report

    input_w = float(quota.get("input_w") or 0.0)
    total_in = float(quota.get("total_in_w") or 0.0)
    ac_on = quota.get("ac_on")
    desired = decide(input_w, off_at=off_at, on_at=on_at)

    state["last_input_w"] = input_w
    state["last_total_in_w"] = total_in
    state["last_ac_enabled"] = 1 if ac_on else (0 if ac_on is False else None)
    state["desired_ac"] = desired
    state["gate_key"] = GATE_KEY
    state["last_decision_at"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")

    report["decision"] = desired
    if desired is None:
        report["would"] = "hold_dead_band"
        state["last_decision"] = "hold_dead_band"
        state["last_skip_reason"] = None
        save_state(state)
        log.info(
            "ac-solar-gate hold dead-band input=%.0fW total_in=%.0fW ac=%s",
            input_w,
            total_in,
            ac_on,
        )
        return report

    want_on = desired == "on"
    report["would"] = f"ac_{desired}"

    if not enabled:
        report["skipped"] = "disabled"
        state["last_decision"] = f"would_{desired}_disabled"
        state["last_skip_reason"] = "disabled"
        save_state(state)
        log.info(
            "ac-solar-gate disabled would=%s input=%.0fW ac=%s",
            desired,
            input_w,
            ac_on,
        )
        return report

    if not quota.get("fresh"):
        report["skipped"] = f"stale_quota_age_s={quota.get('age_s')}"
        state["last_decision"] = f"would_{desired}_stale"
        state["last_skip_reason"] = report["skipped"]
        save_state(state)
        log.info("ac-solar-gate skip stale age=%s would=%s", quota.get("age_s"), desired)
        return report

    if ac_on is None:
        report["skipped"] = "ac_state_unknown"
        state["last_decision"] = f"would_{desired}_unknown_ac"
        state["last_skip_reason"] = report["skipped"]
        save_state(state)
        return report

    if bool(ac_on) == want_on:
        report["would"] = f"already_ac_{desired}"
        report["action"] = "noop_satisfied"
        state["last_decision"] = f"satisfied_{desired}"
        state["last_skip_reason"] = None
        save_state(state)
        log.info(
            "ac-solar-gate satisfied ac=%s input=%.0fW (gate %s)",
            desired,
            input_w,
            GATE_KEY,
        )
        return report

    last_at = state.get("last_action_at")
    if last_at:
        try:
            # ISO or epoch
            if isinstance(last_at, (int, float)):
                last_ts = float(last_at)
            else:
                # accept epoch-as-string or skip parse failures
                last_ts = float(last_at) if str(last_at).replace(".", "", 1).isdigit() else 0.0
                if last_ts <= 0 and isinstance(last_at, str) and "T" in last_at:
                    from datetime import datetime

                    last_ts = datetime.fromisoformat(last_at).timestamp()
        except Exception:
            last_ts = 0.0
        if last_ts and (now - last_ts) < cooldown_s:
            left = int(cooldown_s - (now - last_ts))
            report["skipped"] = f"cooldown_{left}s"
            state["last_decision"] = f"would_{desired}_cooldown"
            state["last_skip_reason"] = report["skipped"]
            save_state(state)
            log.info("ac-solar-gate cooldown %ss left would=%s", left, desired)
            return report

    if not execute:
        report["action"] = f"dry_run_would_ac_{desired}"
        state["last_decision"] = f"dry_run_{desired}"
        state["last_skip_reason"] = None
        save_state(state)
        log.info(
            "ac-solar-gate dry-run would AC %s input=%.0fW ac_now=%s",
            desired.upper(),
            input_w,
            ac_on,
        )
        return report

    # Live PUT — intentional automation; Starlink rides DELTA leftover AC.
    put = _put_ac(want_on)
    report["put"] = {
        k: put.get(k)
        for k in ("ok", "http_status", "code", "message", "error", "action")
    }
    if put.get("ok"):
        report["action"] = f"put_ac_{desired}"
        state["last_action"] = desired
        state["last_action_at"] = now
        state["last_decision"] = f"put_{desired}"
        state["last_skip_reason"] = None
        log.warning(
            "ac-solar-gate PUT AC %s input=%.0fW (Starlink on DELTA AC may drop if OFF)",
            desired.upper(),
            input_w,
        )
    else:
        report["ok"] = False
        report["action"] = f"put_failed_{desired}"
        report["skipped"] = put.get("error") or put.get("message") or "put_failed"
        state["last_decision"] = f"put_failed_{desired}"
        state["last_skip_reason"] = report["skipped"]
        log.error("ac-solar-gate PUT failed: %s", put)
    phrase = phrase_for_action(report.get("action"))
    report["announce"] = phrase
    if phrase:
        _enqueue_announce(phrase)
    save_state(state)
    return report


async def run_after_quota(*, execute: bool = True) -> dict[str, Any]:
    """Called from ecoflow-quota after a fresh live_snapshot write."""
    return evaluate(execute=execute)


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="DELTA 2 AC solar gate (dry-run default).")
    parser.add_argument(
        "--execute",
        action="store_true",
        help="PUT AC when hysteresis requires a change (cron uses this).",
    )
    parser.add_argument(
        "--disable",
        action="store_true",
        help="Write enabled=false to state and exit.",
    )
    parser.add_argument(
        "--enable",
        action="store_true",
        help="Write enabled=true to state and exit.",
    )
    args = parser.parse_args(argv)
    if args.disable or args.enable:
        st = load_state()
        st["enabled"] = bool(args.enable) and not args.disable
        save_state(st)
        phrase = PHRASE_GATE_ARMED if st["enabled"] else PHRASE_GATE_DISABLED
        out = {
            "ok": True,
            "enabled": st["enabled"],
            "path": str(state_path()),
            "announce": phrase,
        }
        print(json.dumps(out, indent=2))
        return 0
    report = evaluate(execute=bool(args.execute))
    print(json.dumps(report, indent=2))
    return 0 if report.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())

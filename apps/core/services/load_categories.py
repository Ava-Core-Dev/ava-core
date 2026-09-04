"""EcoFlow load buckets. Measured watts only. Never the hidden third pack."""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime
from pathlib import Path

from apps.core.services.data_layout import device_role, ecoflow_dir, ensure_data_layout

log = logging.getLogger("ava.loads")

APPLIANCE_AC_W = 1000.0
STARLINK_BAND_LO = 40.0
STARLINK_BAND_HI = 250.0
CAR_W_MIN = 5.0
NIGHT_IN_W = 20.0
PV_FLAT_W = 15.0
EBATT_MIN_W = 20.0
EBATT_MAX_W = 225.0
# Recycled Ninebot pack on the MPPT. Nameplate only — no SOC from EcoFlow.
EBATT_WH = 220.0
USB_KEYS = (
    "pd.usb1Watts",
    "pd.usb2Watts",
    "pd.qcUsb1Watts",
    "pd.typec1Watts",
    "pd.typec2Watts",
)
CAR_KEYS = ("pd.carWatts", "mppt.carOutWatts", "mppt.dcdc12vWatts")
KEEP_LOAD_DAYS = 14


def _num(data: dict, *keys: str):
    for k in keys:
        v = data.get(k)
        if v is not None and v != "":
            try:
                return float(v)
            except (TypeError, ValueError):
                continue
    return None


def watts(raw) -> float:
    if raw is None:
        return 0.0
    n = float(raw)
    if abs(n) >= 10_000:
        n = n / 1000.0
    return round(max(0.0, n), 1)


def pack_power(data: dict | None) -> dict:
    """Split PV, AC, USB, and 12V. AC is never counted as solar."""
    data = data or {}
    pv = watts(_num(data, "mppt.inWatts", "mppt.pv1InWatts", "mppt.pv2InWatts"))
    ac_in = watts(_num(data, "inv.inputWatts", "inv.acInWatts"))
    ac_out = watts(_num(data, "inv.outputWatts", "inv.outWatts"))
    pd_in = watts(_num(data, "pd.wattsInSum", "pd.inputWatts"))
    pd_out = watts(_num(data, "pd.wattsOutSum", "pd.outputWatts"))
    usb = 0.0
    for k in USB_KEYS:
        usb += watts(_num(data, k))
    car = 0.0
    for k in CAR_KEYS:
        car += watts(_num(data, k))
    leftover = max(0.0, pd_out - ac_out - car)
    dc_out = max(usb, leftover)
    ac_charge = max(ac_in, max(0.0, pd_in - pv))
    discharge = max(ac_out, pd_out)
    dc_in = max(0.0, pd_in - pv - ac_in)
    return {
        "pv_w": pv,
        "ac_in_w": ac_in,
        "ac_out_w": ac_out,
        "ac_charge_w": round(ac_charge, 1),
        "discharge_w": round(discharge, 1),
        "usb_w": round(usb, 1),
        "car_w": round(car, 1),
        "dc_out_w": round(dc_out, 1),
        "dc_in_w": round(dc_in, 1),
        "watts_in": pv,
        "watts_out": round(dc_out, 1),
    }


def same_watts(a: float, b: float) -> bool:
    a, b = float(a or 0), float(b or 0)
    if a < 20 or b < 20:
        return False
    slack = max(40.0, 0.12 * max(a, b))
    return abs(a - b) <= slack


def _is_delta(d: dict) -> bool:
    return device_role(str(d.get("sn") or d.get("label") or "")) == "delta"


def _is_river(d: dict) -> bool:
    return device_role(str(d.get("sn") or d.get("label") or "")) == "river"


def _ac_out(d: dict) -> float:
    return float(d.get("ac_out_w") or 0)


def _ac_in(d: dict) -> float:
    return max(float(d.get("ac_in_w") or 0), float(d.get("ac_charge_w") or 0))


def _is_night(sun: dict | None) -> bool:
    sun = sun or {}
    if sun.get("after_sunset") or sun.get("before_sunrise"):
        return True
    if sun.get("ok") or sun.get("sunset") or sun.get("sunrise"):
        return False
    hour = datetime.now().hour
    return hour >= 19 or hour < 6


def solar_in_w(devices: list[dict]) -> float:
    return round(
        sum(float(d.get("pv_w") or 0) for d in devices if d.get("input_kind") != "ebatt"),
        1,
    )


def ebatt_in_w(devices: list[dict]) -> float:
    return round(
        sum(
            float(d.get("ebatt_w") or d.get("pv_w") or 0)
            for d in devices
            if d.get("input_kind") == "ebatt"
        ),
        1,
    )


def apply_ebatt(devices: list[dict], *, sun: dict | None = None) -> None:
    """After sunset, MPPT ≤225 W that Delta is not discharging is the Ninebot, not PV."""
    for d in devices:
        d.pop("ebatt_w", None)
        d["input_kind"] = None
    if not devices:
        return
    if sun is None:
        try:
            from apps.core.services import sun_times

            sun = sun_times.facts()
        except Exception:
            sun = {}
    if not _is_night(sun):
        return
    incoming = sum(float(d.get("pv_w") or 0) for d in devices)
    if incoming < EBATT_MIN_W or incoming > EBATT_MAX_W:
        return
    delta = next((d for d in devices if _is_delta(d)), None)
    delta_out = 0.0
    if delta:
        delta_out = max(
            float(delta.get("discharge_w") or 0),
            float(delta.get("ac_out_w") or 0),
            float(delta.get("out_w") or 0),
        )
    if same_watts(incoming, delta_out):
        return
    for d in devices:
        w = float(d.get("pv_w") or 0)
        if w >= EBATT_MIN_W:
            d["input_kind"] = "ebatt"
            d["ebatt_w"] = round(w, 1)


def apply_roles(devices: list[dict]) -> None:
    for d in devices:
        d["ac_role"] = None
        d["transfer_sure"] = False
        d.pop("transfer_w", None)
        d.pop("appliance_w", None)
        d.pop("starlink_w", None)
        d.pop("emergency_w", None)
    delta = next((d for d in devices if _is_delta(d)), None)
    river = next((d for d in devices if _is_river(d)), None)

    src = dst = None
    transfer = 0.0
    if delta and river:
        d_out, r_out = _ac_out(delta), _ac_out(river)
        d_in, r_in = _ac_in(delta), _ac_in(river)
        # AC only — never discharge_w (USB inflates that).
        if d_out >= 20 and r_in >= 20:
            src, dst = delta, river
            transfer = min(d_out, r_in)
        elif r_out >= 20 and d_in >= 20:
            src, dst = river, delta
            transfer = min(r_out, d_in)
        if src is not None:
            src["ac_role"] = "transfer_out"
            dst["ac_role"] = "transfer_in"
            src["transfer_sure"] = True
            dst["transfer_sure"] = True
            src["transfer_w"] = round(transfer, 1)
            dst["transfer_w"] = round(transfer, 1)

    leftover: list[tuple[dict, float]] = []
    for d in devices:
        aco = _ac_out(d)
        house = max(0.0, aco - transfer) if d is src else aco
        if house < 20:
            continue
        leftover.append((d, house))

    kettle_devs = [(d, w) for d, w in leftover if w >= APPLIANCE_AC_W]
    house_devs = [(d, w) for d, w in leftover if w < APPLIANCE_AC_W]
    for d, w in kettle_devs:
        d["ac_role"] = "appliances"
        d["appliance_w"] = round(w, 1)

    starlink_pick: dict | None = None
    in_band = [(d, w) for d, w in house_devs if STARLINK_BAND_LO <= w <= STARLINK_BAND_HI]
    if len(in_band) == 1:
        starlink_pick = in_band[0][0]
    elif house_devs:
        starlink_pick = max(house_devs, key=lambda x: x[1])[0]

    for d, w in house_devs:
        if d is starlink_pick:
            d["starlink_w"] = round(w, 1)
            if d.get("ac_role") not in ("transfer_out", "transfer_in"):
                d["ac_role"] = "starlink_lights"
        else:
            d["emergency_w"] = round(w, 1)
            if d.get("ac_role") not in ("transfer_out", "transfer_in"):
                d["ac_role"] = "emergency"
    apply_ebatt(devices)


def categories(devices: list[dict]) -> dict:
    transfer = 0.0
    appliances = 0.0
    starlink = 0.0
    emergency = 0.0
    server = 0.0
    drives = 0.0
    for d in devices:
        transfer += float(d.get("transfer_w") or 0) if d.get("ac_role") == "transfer_out" else 0.0
        appliances += float(d.get("appliance_w") or 0)
        starlink += float(d.get("starlink_w") or 0)
        emergency += float(d.get("emergency_w") or 0)
        usb = float(d.get("dc_out_w") or 0)
        car = float(d.get("car_w") or 0)
        if car >= CAR_W_MIN:
            drives += car
        server += max(0.0, usb)
    return {
        "server_mobile_w": round(server, 1),
        "starlink_lights_w": round(starlink, 1),
        "appliances_w": round(appliances, 1),
        "emergency_pack_w": round(emergency, 1),
        "hard_drives_12v_w": round(drives, 1),
        "transfer_w": round(transfer, 1),
    }


def bank_state(devices: list[dict]) -> str:
    bits: list[str] = []
    cats = categories(devices)
    if cats["appliances_w"] >= 20:
        bits.append("appliances")
    src = next((d.get("label") for d in devices if d.get("ac_role") == "transfer_out"), None)
    dst = next((d.get("label") for d in devices if d.get("ac_role") == "transfer_in"), None)
    if src and dst:
        bits.append(f"transfer {src} → {dst}")
    elif cats["transfer_w"] >= 20:
        bits.append("AC transfer")
    if cats["starlink_lights_w"] >= 20:
        bits.append("Starlink + lights")
    if cats["emergency_pack_w"] >= 20:
        bits.append("emergency pack")
    if cats["hard_drives_12v_w"] >= CAR_W_MIN:
        bits.append("hard drives 12V")
    if ebatt_in_w(devices) >= EBATT_MIN_W:
        bits.append("E-Batt input")
    elif solar_in_w(devices) > 20:
        bits.append("PV charging")
    if cats["server_mobile_w"] > 20:
        bits.append("server + mobile")
    return " · ".join(bits) or "idle"


def night_charge_callout(devices: list[dict], *, sun: dict | None = None) -> dict | None:
    """Past sunset: E-Batt on the MPPT, or AC/DC in with true PV ~0. No invented watts."""
    sun = sun or {}
    ebatt = ebatt_in_w(devices)
    if ebatt >= EBATT_MIN_W:
        return {
            "show": True,
            "kind": "ebatt",
            "title": "E-Batt input",
            "detail": "Recycled Ninebot 220 Wh on the MPPT. EcoFlow calls this PV. Not solar. Nameplate only — no SOC.",
            "in_w": round(ebatt, 1),
            "nameplate_wh": EBATT_WH,
            "sunset": sun.get("sunset") or "",
        }
    if not sun.get("after_sunset"):
        return None
    pv = solar_in_w(devices)
    if pv > PV_FLAT_W:
        return None
    ac_in = sum(float(d.get("ac_in_w") or 0) for d in devices)
    dc_in = sum(float(d.get("dc_in_w") or 0) for d in devices)
    charge = max(ac_in, dc_in)
    if charge < NIGHT_IN_W:
        return None
    emergency = any(d.get("ac_role") == "transfer_in" and _is_river(d) for d in devices)
    kind = "emergency_topup" if emergency else "night_charge"
    title = "Emergency pack top-up" if emergency else "Night charge"
    return {
        "show": True,
        "kind": kind,
        "title": title,
        "detail": "Measured charge after sunset. Not solar.",
        "in_w": round(charge, 1),
        "sunset": sun.get("sunset") or "",
    }


def _loads_dir() -> Path:
    return ecoflow_dir() / "loads"


def append_history(cats: dict) -> None:
    if not cats:
        return
    ensure_data_layout()
    root = _loads_dir()
    root.mkdir(parents=True, exist_ok=True)
    day = datetime.now().strftime("%Y-%m-%d")
    path = root / f"{day}.jsonl"
    row = {"at": int(time.time() * 1000), **cats}
    try:
        with path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(row) + "\n")
    except OSError as e:
        log.debug("load history skipped: %s", e)
        return
    cutoff = datetime.now() - __import__("datetime").timedelta(days=KEEP_LOAD_DAYS)
    for old in root.glob("*.jsonl"):
        try:
            if old.stem < cutoff.strftime("%Y-%m-%d"):
                old.unlink()
        except OSError:
            pass


def history_averages(hours: float = 1) -> dict:
    root = _loads_dir()
    if not root.is_dir():
        return {}
    cutoff = time.time() * 1000 - hours * 3600 * 1000
    buckets: dict[str, list[float]] = {}
    for path in sorted(root.glob("*.jsonl"))[-3:]:
        try:
            lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue
        for line in lines:
            if not line.startswith("{"):
                continue
            try:
                row = json.loads(line)
            except Exception:
                continue
            if float(row.get("at") or 0) < cutoff:
                continue
            for k, v in row.items():
                if k == "at":
                    continue
                try:
                    n = float(v)
                except (TypeError, ValueError):
                    continue
                buckets.setdefault(k, []).append(n)
    out = {}
    for k, vals in buckets.items():
        if vals:
            out[k] = round(sum(vals) / len(vals), 1)
    out["samples"] = max((len(v) for v in buckets.values()), default=0)
    return out

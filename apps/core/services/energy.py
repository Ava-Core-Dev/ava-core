"""Stored-energy math for the solar bank and this host.

Capacities below are vendor nameplate, not measured on this box. SOC and watts
are the only live inputs. Never present a nameplate figure as a measurement.

Bank percent must be capacity-weighted. A plain mean of two unequal packs
(1024 Wh and 768 Wh) reports a bank level that does not exist.
"""
from __future__ import annotations

from typing import Any

# Vendor spec, LiFePO4. Labels match solar_weather.SN_LABELS.
PACK_WH: dict[str, float] = {
    "DELTA 2": 1024.0,
    "RIVER 2 Pro": 768.0,
}

# Third-party bench (Outdoor Gear Lab) drew ~600 Wh out of the RIVER 2 Pro.
# Ours has not been bench-tested. Quote as third-party, never as ours.
PACK_TESTED_USABLE_WH: dict[str, float] = {
    "RIVER 2 Pro": 600.0,
}

# HP OmniBook 5 16 internal battery, vendor spec. USB-C PD in at up to 65 W.
HOST_WH = 59.0
HOST_MAX_CHARGE_W = 65.0

BANK_WH = sum(PACK_WH.values())

# Below this much runtime the facts line says LOW BANK outright.
LOW_BANK_HOURS = 3.0


def _num(v: Any) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f else None


def pack_wh(label: str) -> float | None:
    return PACK_WH.get(str(label or "").strip())


def stored_wh(label: str, soc_pct: Any) -> float | None:
    """Wh sitting in one pack at this SOC. None when capacity or SOC is unknown."""
    cap = pack_wh(label)
    soc = _num(soc_pct)
    if cap is None or soc is None:
        return None
    return cap * max(0.0, min(100.0, soc)) / 100.0


def bank(packs: list[dict[str, Any]]) -> dict[str, Any]:
    """Capacity-weighted bank from per-pack SOC. Only packs we have specs for count."""
    known: list[dict[str, Any]] = []
    cap_total = 0.0
    stored_total = 0.0
    unknown: list[str] = []
    for p in packs or []:
        if not isinstance(p, dict):
            continue
        label = str(p.get("label") or "").strip()
        cap = pack_wh(label)
        wh = stored_wh(label, p.get("soc"))
        if cap is None or wh is None:
            if label:
                unknown.append(label)
            continue
        cap_total += cap
        stored_total += wh
        known.append(
            {
                "label": label,
                "soc": _num(p.get("soc")),
                "online": p.get("online"),
                "capacity_wh": round(cap),
                "stored_wh": round(wh),
                "pv_w": _num(p.get("pv_w")),
                "out_w": _num(p.get("out_w") if p.get("out_w") is not None else p.get("ac_out_w")),
            }
        )
    if not known:
        return {"ok": False, "packs": [], "unknown": unknown}
    return {
        "ok": True,
        "packs": known,
        "capacity_wh": round(cap_total),
        "capacity_kwh": round(cap_total / 1000.0, 3),
        "stored_wh": round(stored_total),
        "stored_kwh": round(stored_total / 1000.0, 3),
        "bank_pct": round(stored_total / cap_total * 100.0, 1),
        "unknown": unknown,
        "basis": "vendor nameplate",
    }


def host_stored_wh(battery_pct: Any) -> float | None:
    pct = _num(battery_pct)
    if pct is None:
        return None
    return HOST_WH * max(0.0, min(100.0, pct)) / 100.0


def flow(pv_w: Any, load_w: Any, *, stored_wh_now: Any = None, capacity_wh: Any = None) -> dict[str, Any]:
    """Net watts and a runtime estimate at the current rate.

    load_w is the combined AC out across packs, so the runtime covers everything
    on the packs, this host included. Rates are never summed as energy.
    """
    pv = _num(pv_w)
    load = _num(load_w)
    out: dict[str, Any] = {"pv_w": pv, "load_w": load, "net_w": None, "direction": None}
    if pv is None or load is None:
        return out
    net = pv - load
    out["net_w"] = round(net, 1)
    stored = _num(stored_wh_now)
    cap = _num(capacity_wh)
    if abs(net) < 1.0:
        out["direction"] = "flat"
        return out
    if net < 0:
        out["direction"] = "draining"
        if stored is not None:
            out["hours_to_empty"] = round(stored / abs(net), 1)
        return out
    out["direction"] = "charging"
    if stored is not None and cap is not None and cap > stored:
        out["hours_to_full"] = round((cap - stored) / net, 1)
    return out


def summary(packs: list[dict[str, Any]], *, pv_w: Any, load_w: Any,
            host_battery_pct: Any = None) -> dict[str, Any]:
    """One block for boards and LIVE FACTS."""
    b = bank(packs)
    if not b.get("ok"):
        return {"ok": False, "detail": "no pack capacity"}
    f = flow(
        pv_w,
        load_w,
        stored_wh_now=b["stored_wh"],
        capacity_wh=b["capacity_wh"],
    )
    host_wh = host_stored_wh(host_battery_pct)
    total_cap = b["capacity_wh"] + HOST_WH
    total_stored = (
        round(b["stored_wh"] + host_wh) if host_wh is not None else None
    )
    total_pct = (
        round(total_stored / total_cap * 100.0, 1) if total_stored is not None else None
    )
    return {
        **b,
        "flow": f,
        "host_capacity_wh": round(HOST_WH),
        "host_stored_wh": round(host_wh) if host_wh is not None else None,
        "total_capacity_wh": round(total_cap),
        "total_stored_wh": total_stored,
        # Combined packs + OmniBook. Site/Starlink load stays on EcoFlow bank_pct.
        "total_pct": total_pct,
        "site_bank_pct": b["bank_pct"],
    }


def facts_lines(
    packs: list[dict[str, Any]],
    *,
    pv_w: Any,
    load_w: Any,
    host_battery_pct: Any = None,
) -> list[str]:
    """One bullet per pack, then the combined bank. Empty list when unusable.

    A 3B model misreads a long semicolon run-on: it borrows one pack's SOC for
    the other and repeats the bank percent as a pack percent. One fact per line.
    """
    s = summary(packs, pv_w=pv_w, load_w=load_w, host_battery_pct=host_battery_pct)
    if not s.get("ok"):
        return []
    lines: list[str] = []
    for p in s["packs"]:
        soc = p.get("soc")
        soc_s = f"{soc:g}% SOC" if soc is not None else "SOC unknown"
        bits = [
            soc_s,
            f"{int(round(p['stored_wh']))} Wh stored of {int(p['capacity_wh'])} Wh",
        ]
        if p.get("pv_w") is not None:
            bits.append(f"PV in {int(round(p['pv_w']))} W")
        if p.get("out_w") is not None:
            bits.append(f"out {int(round(p['out_w']))} W")
        if p.get("online") is not None:
            bits.append("online" if p["online"] else "offline")
        lines.append(f"- {p['label']}: " + ", ".join(bits) + ".")

    f = s["flow"]
    combined = [
        f"{s['stored_kwh']:.2f} kWh stored of {s['capacity_kwh']:.2f} kWh",
        f"{s['bank_pct']}% capacity-weighted (nameplate, not measured)",
    ]
    if f.get("pv_w") is not None:
        combined.append(f"PV in {int(round(f['pv_w']))} W")
    if f.get("load_w") is not None:
        combined.append(f"load out {int(round(f['load_w']))} W")
    if f.get("net_w") is not None:
        combined.append(f"net {int(round(f['net_w']))} W {f.get('direction')}")
    if f.get("hours_to_empty") is not None:
        combined.append(f"~{f['hours_to_empty']} h left at this load")
    if f.get("hours_to_full") is not None:
        combined.append(f"~{f['hours_to_full']} h to full")
    line = "- Bank combined (both packs): " + ", ".join(combined) + "."
    hours = f.get("hours_to_empty")
    if hours is not None and hours <= LOW_BANK_HOURS:
        line += f" LOW BANK: about {hours} h left."
    lines.append(line)

    if s.get("host_stored_wh") is not None:
        lines.append(
            f"- This server's own battery: {int(s['host_stored_wh'])} Wh"
            f" of {int(s['host_capacity_wh'])} Wh."
            " Not for Starlink — idle and sub-offline work on this PC only."
        )
    if s.get("total_stored_wh") is not None and s.get("total_pct") is not None:
        lines.append(
            f"- Everything together (packs + this server):"
            f" {s['total_stored_wh'] / 1000.0:.2f} kWh"
            f" of {s['total_capacity_wh'] / 1000.0:.2f} kWh"
            f" ({s['total_pct']}% capacity-weighted)."
            " Starlink and site load stay on the EcoFlow bank."
        )
    return lines

"""Read-only last-sample facts for LIVE FACTS. Never INSERT/UPDATE. Never emit PII.

Prefer the store that is actually growing. Tonight that is EcoFlow/host jsonl
and identities.sqlite. Stale EcoFlow sqlite (last row days old) is not quoted.
"""
from __future__ import annotations

import json
import logging
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from apps.core import config
from apps.core.services import energy

log = logging.getLogger("ava.db_facts")

from apps.core.services.data_layout import SN_LABELS, ecoflow_sn_public, host_history_path

# Keep in sync with data_layout.SN_LABELS. Facts never print serials.
_PACK_LABELS = SN_LABELS

ECO_STALE_S = 15 * 60
HOST_STALE_S = 15 * 60
_TAIL_BYTES = 8192

_KIND_LABELS = (
    ("email", "email"),
    ("discord", "Discord"),
    ("uuid", "Minecraft UUID"),
    ("solana", "Solana pubs"),
)


def open_sqlite_ro(path: Path) -> sqlite3.Connection:
    """Open existing SQLite read-only. Caller must close. No CREATE/PRAGMA writes."""
    uri = path.resolve().as_posix()
    con = sqlite3.connect(f"file:{uri}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    return con


def last_jsonl_obj(path: Path) -> dict[str, Any] | None:
    """Last complete JSON object in a jsonl file. Reads a tail only."""
    try:
        size = path.stat().st_size
    except OSError:
        return None
    if size < 2:
        return None
    try:
        with path.open("rb") as fh:
            fh.seek(max(0, size - _TAIL_BYTES))
            chunk = fh.read()
    except OSError:
        return None
    for raw in reversed(chunk.splitlines()):
        raw = raw.strip().strip(b"\x00")
        if not raw.startswith(b"{"):
            continue
        try:
            row = json.loads(raw.decode("utf-8", "replace"))
        except Exception:
            continue
        if isinstance(row, dict):
            return row
    return None


def _pack_label(sn: str) -> str:
    key = str(sn or "").strip()
    return _PACK_LABELS.get(key) or "pack"


def _pct(v: Any) -> str | None:
    try:
        r = round(float(v), 1)
    except (TypeError, ValueError):
        return None
    if r == int(r):
        return str(int(r))
    return str(r)


def _clock(at: float | int | None) -> str:
    if at is None:
        return "?"
    v = float(at)
    if v > 10_000_000_000:
        v = v / 1000.0
    if v <= 0:
        return "?"
    return datetime.fromtimestamp(v).strftime("%H:%M")


def _age_s(at: float | int | str | None) -> float | None:
    if at is None or at == "":
        return None
    if isinstance(at, (int, float)):
        v = float(at)
        if v > 10_000_000_000:
            v /= 1000.0
        if v <= 0:
            return None
        return time.time() - v
    s = str(at).strip()
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return time.time() - dt.timestamp()


def _at_epoch(row: dict[str, Any]) -> float | None:
    at = row.get("at")
    if isinstance(at, (int, float)) and at > 0:
        v = float(at)
        return v / 1000.0 if v > 10_000_000_000 else v
    return None


def _host_battery_pct() -> float | None:
    """Last host battery reading, for the combined stored-energy total."""
    path = host_history_path()
    row = last_jsonl_obj(path) if path.is_file() else None
    if not row:
        return None
    at = _at_epoch(row)
    age = _age_s(at) if at is not None else None
    if age is None or age > HOST_STALE_S:
        return None
    try:
        return float(row.get("battery_pct"))
    except (TypeError, ValueError):
        return None


def _night_note(*, ebatt: bool = False) -> str:
    if ebatt:
        return " Night: MPPT input is E-Batt (Ninebot 220 Wh nameplate), not solar."
    hour = datetime.now().hour
    if hour < 6 or hour >= 19:
        return " Night: PV ~0 W is expected. Do not invent cloud cover."
    return ""


def _fmt_ecoflow(
    *,
    source: str,
    last_at: float | None,
    bank: float | None,
    pv: float | None,
    load: float | None,
    packs: list[dict[str, Any]],
) -> str:
    from apps.core.services.load_categories import apply_ebatt, ebatt_in_w, solar_in_w

    apply_ebatt(packs)
    solar = solar_in_w(packs)
    ebatt = ebatt_in_w(packs)
    if ebatt >= 20:
        pv = solar
    head = f"EcoFlow (source={source}"
    if last_at is not None:
        head += f", last {_clock(last_at)}"
    head += "):" + _night_note(ebatt=ebatt >= 20)

    detail = energy.facts_lines(
        packs,
        pv_w=pv if ebatt < 20 else solar,
        load_w=load,
        host_battery_pct=_host_battery_pct(),
        ebatt_w=ebatt if ebatt >= 20 else None,
    )
    if detail:
        return "\n".join([head, *detail])

    # No capacity for these packs — percentages only, still one pack per line.
    lines = [head]
    for p in packs:
        lab = p.get("label") or "pack"
        soc_s = _pct(p.get("soc"))
        on = "online" if p.get("online") else "offline"
        lines.append(f"- {lab}: " + (f"{soc_s}% SOC, {on}." if soc_s else f"{on}."))
    bank_s = _pct(bank)
    combined = []
    if bank_s is not None:
        combined.append(f"bank {bank_s}%")
    if ebatt >= 20:
        combined.append(f"E-Batt in {int(round(ebatt))} W")
    elif pv is not None:
        combined.append(f"PV in {int(round(pv))} W")
    if load is not None:
        combined.append(f"load out {int(round(load))} W")
    if combined:
        lines.append("- Bank combined (both packs): " + ", ".join(combined) + ".")
    return "\n".join(lines)


def _weighted_bank(packs: list[dict[str, Any]], socs: list[float]) -> float | None:
    """Capacity-weighted when we know both packs; a plain mean would invent a level."""
    b = energy.bank(packs)
    if b.get("ok") and len(b.get("packs") or []) == len(packs):
        return b["bank_pct"]
    return round(sum(socs) / len(socs), 1) if socs else None


def _ecoflow_from_jsonl() -> tuple[float | None, str | None]:
    hist = config.DATA_DIR / "ecoflow" / "history"
    if not hist.is_dir():
        return None, None
    packs: list[dict[str, Any]] = []
    last_at: float | None = None
    pv = 0.0
    load = 0.0
    socs: list[float] = []
    any_row = False
    try:
        paths = sorted(hist.glob("*.jsonl"))
    except OSError:
        return None, None
    for path in paths:
        if path.name.endswith("-minutes.jsonl"):
            continue
        if not ecoflow_sn_public(path.stem):
            continue
        row = last_jsonl_obj(path)
        if not row:
            continue
        any_row = True
        at = _at_epoch(row)
        if at is not None:
            last_at = at if last_at is None else max(last_at, at)
        soc = row.get("soc")
        try:
            soc_f = float(soc) if soc is not None else None
        except (TypeError, ValueError):
            soc_f = None
        if soc_f is not None:
            socs.append(soc_f)
        try:
            pv += float(row.get("solarW") or 0)
            load += float(row.get("outW") or 0)
        except (TypeError, ValueError):
            pass
        packs.append(
            {
                "label": _pack_label(path.stem),
                "soc": round(soc_f, 1) if soc_f is not None else None,
                "online": bool(row.get("deviceOnline")),
                "pv_w": row.get("solarW"),
                "out_w": row.get("outW"),
                "discharge_w": row.get("outW"),
            }
        )
    if not any_row:
        return None, None
    age = _age_s(last_at)
    if age is None or age > ECO_STALE_S:
        return age, None
    bank = _weighted_bank(packs, socs)
    line = _fmt_ecoflow(
        source="jsonl",
        last_at=last_at,
        bank=bank,
        pv=pv,
        load=load,
        packs=packs,
    )
    return age, line


def _ecoflow_from_quota() -> tuple[float | None, str | None]:
    try:
        from apps.core.crons.since_last_fire.solar_weather import _quota_snapshot

        snap = _quota_snapshot() or {}
    except Exception as e:
        log.debug("quota snapshot skipped: %s", e)
        return None, None
    if not snap:
        return None, None
    src = str(snap.get("source") or "quota")
    updated = snap.get("updated_at")
    age = _age_s(updated)
    if age is None or age > ECO_STALE_S or src.endswith("_stale"):
        return age, None
    packs = []
    for d in snap.get("devices") or []:
        if not isinstance(d, dict):
            continue
        packs.append(
            {
                "label": d.get("label") or "pack",
                "soc": d.get("soc"),
                "online": bool(d.get("online")),
                "pv_w": d.get("pv_w"),
                "ebatt_w": d.get("ebatt_w"),
                "input_kind": d.get("input_kind"),
                "out_w": d.get("ac_out_w") or d.get("out_w"),
                "discharge_w": d.get("discharge_w"),
                "ac_out_w": d.get("ac_out_w"),
            }
        )
    last_at = None
    if updated:
        last_at = time.time() - age if age is not None else None
    line = _fmt_ecoflow(
        source=src,
        last_at=last_at,
        bank=snap.get("battery_pct"),
        pv=snap.get("solar_in_w"),
        load=snap.get("load_w"),
        packs=packs,
    )
    return age, line


def _ecoflow_from_sqlite() -> tuple[float | None, str | None]:
    path = config.DATA_DIR / "ecoflow" / "ecoflow-10s.db"
    if not path.is_file():
        return None, None
    try:
        con = open_sqlite_ro(path)
    except sqlite3.Error as e:
        log.debug("ecoflow sqlite ro skipped: %s", e)
        return None, None
    try:
        rows = con.execute(
            "SELECT ts, sn, online, soc, solar_w, out_w FROM snapshots ORDER BY id DESC LIMIT 8"
        ).fetchall()
    except sqlite3.Error as e:
        log.debug("ecoflow sqlite query skipped: %s", e)
        return None, None
    finally:
        con.close()
    if not rows:
        return None, None
    newest_age = _age_s(rows[0]["ts"])
    if newest_age is None or newest_age > ECO_STALE_S:
        return newest_age, None
    seen: set[str] = set()
    packs: list[dict[str, Any]] = []
    pv = 0.0
    load = 0.0
    socs: list[float] = []
    last_at = time.time() - newest_age
    for row in rows:
        sn = str(row["sn"] or "")
        if not ecoflow_sn_public(sn):
            continue
        if sn in seen:
            continue
        seen.add(sn)
        soc = row["soc"]
        try:
            soc_f = float(soc) if soc is not None else None
        except (TypeError, ValueError):
            soc_f = None
        if soc_f is not None:
            socs.append(soc_f)
        try:
            pv += float(row["solar_w"] or 0)
            load += float(row["out_w"] or 0)
        except (TypeError, ValueError):
            pass
        packs.append(
            {
                "label": _pack_label(sn),
                "soc": round(soc_f, 1) if soc_f is not None else None,
                "online": bool(row["online"]),
                "pv_w": row["solar_w"],
                "out_w": row["out_w"],
                "discharge_w": row["out_w"],
            }
        )
    bank = _weighted_bank(packs, socs)
    line = _fmt_ecoflow(
        source="sqlite",
        last_at=last_at,
        bank=bank,
        pv=pv,
        load=load,
        packs=packs,
    )
    return newest_age, line


def ecoflow_line() -> str:
    """Last EcoFlow sample from jsonl if it is growing; else quota; else sqlite. Else DOWN."""
    for reader in (_ecoflow_from_jsonl, _ecoflow_from_quota, _ecoflow_from_sqlite):
        try:
            _age, line = reader()
        except Exception as e:
            log.debug("ecoflow reader %s: %s", reader.__name__, e)
            continue
        if line:
            return line
    return "EcoFlow: DOWN"


def _fmt_host(row: dict[str, Any], *, last_at: float | None, source: str) -> str:
    bits = []
    if last_at is not None:
        bits.append(f"last {_clock(last_at)}")
    elif source:
        bits.append(source)
    batt = row.get("battery_pct")
    if batt is not None:
        ac = "AC" if row.get("battery_plugged") else "battery"
        bits.append(f"charge {int(round(float(batt)))}% {ac}")
    cpu = row.get("cpu_pct")
    if cpu is not None:
        bits.append(f"CPU {int(round(float(cpu)))}%")
    mem = row.get("mem_pct")
    if mem is not None:
        bits.append(f"RAM {int(round(float(mem)))}%")
    return "Host: " + (", ".join(bits) if bits else "sampled, thin")


def host_line() -> str:
    """Last host jsonl sample if fresh; else a live host_metrics read (no jsonl write)."""
    path = host_history_path()
    row = last_jsonl_obj(path) if path.is_file() else None
    at = _at_epoch(row) if row else None
    age = _age_s(at) if at is not None else None
    if row and age is not None and age <= HOST_STALE_S:
        return _fmt_host(row, last_at=at, source="jsonl")
    try:
        from apps.core.host_metrics import snapshot

        live = snapshot(home=config.AVA_HOME)
    except Exception as e:
        if row and at is not None:
            return _fmt_host(row, last_at=at, source="jsonl") + " (stale)"
        return f"Host: DOWN ({e.__class__.__name__})"
    if live:
        return _fmt_host(live, last_at=None, source="live sample")
    if row and at is not None:
        return _fmt_host(row, last_at=at, source="jsonl") + " (stale)"
    return "Host: DOWN"


def identity_line() -> str:
    """COUNT(*) / kind breakdown only. Never emails, Discord ids, UUIDs, or pubs."""
    path = config.DB_DIR / "identities.sqlite"
    if not path.is_file():
        return "Identities: DOWN"
    try:
        con = open_sqlite_ro(path)
    except sqlite3.Error:
        return "Identities: DOWN"
    try:
        n_id = int(con.execute("SELECT COUNT(*) FROM identities").fetchone()[0])
        bits = [f"{n_id} people"]
        for kind, label in _KIND_LABELS:
            n = int(
                con.execute(
                    "SELECT COUNT(*) FROM identifiers WHERE kind=?", (kind,)
                ).fetchone()[0]
            )
            bits.append(f"{n} {label}")
        return "Identities (counts only): " + ", ".join(bits) + ". No PII in chat."
    except sqlite3.Error:
        return "Identities: DOWN"
    finally:
        con.close()

"""Desk-up / desk-down event log. Live stamps only — never invent hours."""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone

import psutil

from apps.core import config

log = logging.getLogger("ava.uptime")

PATH = config.DATA_DIR / "state" / "uptime-events.jsonl"
MARKER = config.DATA_DIR / "state" / "uptime-marker.json"
KEEP = 400
GAP_S = 180


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _append(kind: str, **extra) -> None:
    PATH.parent.mkdir(parents=True, exist_ok=True)
    row = {"at": _now_iso(), "kind": kind, **extra}
    try:
        with PATH.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(row, default=str) + "\n")
    except OSError as e:
        log.debug("uptime append skipped: %s", e)
        return
    try:
        lines = PATH.read_text(encoding="utf-8", errors="replace").splitlines()
        if len(lines) > KEEP:
            PATH.write_text("\n".join(lines[-KEEP:]) + "\n", encoding="utf-8")
    except OSError:
        pass


def _marker() -> dict:
    if not MARKER.is_file():
        return {}
    try:
        raw = json.loads(MARKER.read_text(encoding="utf-8"))
        return raw if isinstance(raw, dict) else {}
    except Exception:
        return {}


def _write_marker(payload: dict) -> None:
    MARKER.parent.mkdir(parents=True, exist_ok=True)
    MARKER.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def record_origin_start() -> None:
    boot_s = int(time.time() - psutil.boot_time())
    _append("origin_start", boot_uptime_s=boot_s)
    _write_marker(
        {
            "origin_started_at": _now_iso(),
            "origin_started_mono": time.monotonic(),
            "last_tick_at": _now_iso(),
            "last_tick_mono": time.monotonic(),
        }
    )


def record_origin_stop() -> None:
    _append("origin_stop")
    m = _marker()
    m["last_stop_at"] = _now_iso()
    _write_marker(m)


def tick() -> None:
    """Heartbeat: stamp presence; log a gap if the desk was gone long enough."""
    now_m = time.monotonic()
    m = _marker()
    last = float(m.get("last_tick_mono") or 0)
    if last and now_m - last >= GAP_S:
        _append("heartbeat_gap", gap_s=int(now_m - last))
        _append("desk_up", after_gap_s=int(now_m - last))
    m["last_tick_at"] = _now_iso()
    m["last_tick_mono"] = now_m
    if not m.get("origin_started_at"):
        m["origin_started_at"] = _now_iso()
        m["origin_started_mono"] = now_m
        _append("origin_start", inferred=True)
    _write_marker(m)


def recent(limit: int = 24) -> list[dict]:
    if not PATH.is_file():
        return []
    try:
        lines = PATH.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []
    out: list[dict] = []
    for line in lines[-limit:]:
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            row = json.loads(line)
        except Exception:
            continue
        if isinstance(row, dict):
            out.append(row)
    return out


def last_return() -> dict | None:
    for row in reversed(recent(80)):
        if row.get("kind") in {"origin_start", "desk_up"}:
            return row
    return None


def facts(*, process_uptime_s: int | None = None) -> dict:
    m = _marker()
    started = m.get("origin_started_at")
    desk_s = None
    if started:
        try:
            t0 = datetime.fromisoformat(str(started).replace("Z", "+00:00"))
            desk_s = int((datetime.now(timezone.utc) - t0.astimezone(timezone.utc)).total_seconds())
        except Exception:
            desk_s = None
    ret = last_return()
    return {
        "process_uptime_s": process_uptime_s,
        "boot_uptime_s": int(time.time() - psutil.boot_time()),
        "desk_uptime_s": desk_s if desk_s is not None else process_uptime_s,
        "origin_started_at": started,
        "last_return_at": (ret or {}).get("at"),
        "last_return_kind": (ret or {}).get("kind"),
        "recent": recent(12),
    }

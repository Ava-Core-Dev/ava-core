#!/usr/bin/env python3
"""
ava-core.py — Chronological + always-on script runner

Watches:
  /home/ava-core/operations/cronologicals/

  ├── in-order-on-boot/     → run once, in name order, at startup
  ├── on-time/HH:MM/        → run when clock matches (5-min grid)
  ├── since-last-fire/      → run after interval since last fire
  └── always-on/            → long-running servers (pages, APIs)
                              started on discover, kept alive, restarted on exit

Main log: /home/ava-core/database/logs/ava-core.log

EcoFlow status (every 30s) reads:
  ecoflow-live.json  (preferred)
  ecoflow-1min.db    (fallback)
  ecoflow-10s.db     (live raw fallback)
"""

from __future__ import annotations

import json
import logging
import logging.handlers
import os
import signal
import sqlite3
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

# ── paths ──────────────────────────────────────────────────────────────
BASE = Path("/home/ava-core/operations/cronologicals")
BOOT_DIR = BASE / "in-order-on-boot"
ONTIME_DIR = BASE / "on-time"
SINCE_DIR = BASE / "since-last-fire"
ALWAYS_DIR = BASE / "always-on"
STATE_FILE = BASE / ".ava-core-state.json"
SCRIPT_LOG_DIR = BASE / "logs"
SCRIPT_LOG_DIR.mkdir(parents=True, exist_ok=True)

MAIN_LOG_DIR = Path("/home/ava-core/database/logs")
MAIN_LOG_DIR.mkdir(parents=True, exist_ok=True)
MAIN_LOG_FILE = MAIN_LOG_DIR / "ava-core.log"

# EcoFlow (new hierarchical pipeline)
ECO_ROOT = Path(os.environ.get("ECOFLOW_ROOT", "/home/ava-core/database"))
ECO_LIVE_JSON = ECO_ROOT / "ecoflow-live.json"
ECO_1MIN = ECO_ROOT / "ecoflow-1min.db"
ECO_10S = ECO_ROOT / "ecoflow-10s.db"
# legacy fallbacks (old pipeline)
ECO_LEGACY_ENHANCED = ECO_ROOT / "ecoflow-data-enhanced.db"
ECO_LEGACY_LIVE = ECO_ROOT / "ecoflow-data.db"

NAME_MAP = {
    "R331ZAB5SG755642": "security",
    "R621ZA16XH6K1155": "Primary",
    "R331ZAB5SG6S2858": "Backup",
}

# ── logging ────────────────────────────────────────────────────────────
rot_handler = logging.handlers.RotatingFileHandler(
    MAIN_LOG_FILE, maxBytes=5 * 1024 * 1024, backupCount=5
)
fmt = logging.Formatter(
    "%(asctime)s  %(levelname)-7s  %(message)s", datefmt="%Y-%m-%d %H:%M:%S"
)
rot_handler.setFormatter(fmt)
stream_handler = logging.StreamHandler(sys.stdout)
stream_handler.setFormatter(fmt)

logging.basicConfig(level=logging.INFO, handlers=[rot_handler, stream_handler])
log = logging.getLogger("ava-core")

# ── intervals (since-last-fire folder names) ───────────────────────────
INTERVALS = {
    "every-second": 1,
    "every-10-seconds": 10,
    "every-minute": 60,
    "every-5-minutes": 5 * 60,
    "every-10-minutes": 10 * 60,
    "every-15-minutes": 15 * 60,   # ecoflow-15min.py
    "every-30-minutes": 30 * 60,
    "every-hour": 60 * 60,
    "every-3-hours": 3 * 3600,
    "every-4-hours": 4 * 3600,     # ecoflow-4h.py
    "every-5-hours": 5 * 3600,
    "every-8-hours": 8 * 3600,
    "every-12-hours": 12 * 3600,
    "every-24-hours": 24 * 3600,
    "every-3-days": 3 * 24 * 3600, # ecoflow-3d.py
    "every-week": 7 * 24 * 3600,
    "every-month": 30 * 24 * 3600,
}

# ── state ─────────────────────────────────────────────────────────────────
def load_state() -> dict:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text())
        except Exception as e:
            log.warning(f"Could not load state (invalid JSON): {e}. Backing up and starting fresh.")
            try:
                bak = STATE_FILE.with_suffix(".corrupt." + datetime.now().strftime("%Y%m%dT%H%M%S"))
                os.replace(str(STATE_FILE), str(bak))
                log.info(f"Backed up corrupt state to {bak}")
            except Exception:
                pass
    return {
        "boot_done": False,
        "last_fire": {},
        "always_on": {},  # path → {pid, started, name, port, script, restarts: [ts], cooldown_until}
    }


def save_state(state: dict) -> None:
    try:
        tmp = STATE_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(state, indent=2))
        # atomic replace
        os.replace(str(tmp), str(STATE_FILE))
    except Exception as e:
        log.warning(f"Could not save state atomically: {e}")
        try:
            STATE_FILE.write_text(json.dumps(state, indent=2))
        except Exception as e2:
            log.warning(f"Fallback write_state failed: {e2}")


# ── one-shot runners ───────────────────────────────────────────────────
def collect_scripts(folder: Path) -> list:
    if not folder.is_dir():
        return []
    return sorted(
        p
        for p in folder.iterdir()
        if p.is_file() and p.suffix.lower() == ".py" and not p.name.startswith("_")
    )


def run_script(script: Path, state: dict) -> bool:
    if not script.is_file() or script.suffix.lower() != ".py":
        return False
    log_file = SCRIPT_LOG_DIR / f"{script.stem}_{datetime.now():%Y%m%d_%H%M%S}.log"
    log.info(f"RUN  {script}")
    try:
        with open(log_file, "w") as lf:
            proc = subprocess.Popen(
                [sys.executable, str(script)],
                stdout=lf,
                stderr=subprocess.STDOUT,
                cwd=str(script.parent),
                start_new_session=True,
            )
        # record that we started it (time-based); we do not wait for completion
        state["last_fire"][str(script)] = time.time()
        save_state(state)
        log.info(f"  → started pid={proc.pid}  log={log_file.name}")
        return True
    except Exception as e:
        log.error(f"  → failed: {e}")
        return False


# ── boot ───────────────────────────────────────────────────────────────
def run_boot(state: dict) -> None:
    if state.get("boot_done"):
        log.info("BOOT  already completed — skipping")
        return
    log.info("BOOT  starting in-order-on-boot sequence")
    if not BOOT_DIR.is_dir():
        log.warning(f"BOOT  dir missing: {BOOT_DIR}")
        state["boot_done"] = True
        save_state(state)
        return
    folders = sorted(
        [d for d in BOOT_DIR.iterdir() if d.is_dir()],
        key=lambda d: d.name,
    )
    for folder in folders:
        scripts = collect_scripts(folder)
        if scripts:
            log.info(f"BOOT  folder: {folder.name}  ({len(scripts)} script(s))")
        for script in scripts:
            run_script(script, state)
            time.sleep(0.5)
    state["boot_done"] = True
    save_state(state)
    log.info("BOOT  finished")


# ── on-time ───────────────────────────────────────────────────────────
def current_slot() -> str:
    now = datetime.now()
    minute = (now.minute // 5) * 5
    return f"{now.hour:02d}:{minute:02d}"


def run_on_time(state: dict) -> None:
    slot = current_slot()
    folder = ONTIME_DIR / slot
    if not folder.is_dir():
        return
    scripts = collect_scripts(folder)
    if not scripts:
        return
    log.info(f"ON-TIME  slot={slot}  ({len(scripts)} script(s))")
    for script in scripts:
        key = str(script)
        last = state["last_fire"].get(key, 0)
        if last and datetime.fromtimestamp(last).strftime("%H:%M") == slot:
            continue
        run_script(script, state)


# ── since-last-fire ───────────────────────────────────────────────────
def run_since_last(state: dict) -> None:
    now = time.time()
    for name, seconds in INTERVALS.items():
        folder = SINCE_DIR / name
        if not folder.is_dir():
            continue
        for script in collect_scripts(folder):
            key = str(script)
            last = state["last_fire"].get(key, 0)
            if now - last >= seconds:
                log.info(f"SINCE  {name}  elapsed={now - last:.0f}s  → {script.name}")
                run_script(script, state)


# ── always-on supervisor ───────────────────────────────────────────────
def _pid_alive(pid: int, expected_script: str | None = None) -> bool:
    if not pid:
        return False
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    # best-effort: verify cmdline matches expected script to reduce PID reuse false positives (Linux)
    if expected_script:
        try:
            cmdline_path = Path(f"/proc/{pid}/cmdline")
            if cmdline_path.exists():
                content = cmdline_path.read_bytes().split(b"\x00")
                # join parts with space and decode heuristically
                cmd = b" ".join([p for p in content if p]).decode(errors="ignore")
                if expected_script in cmd:
                    return True
                # maybe script name only
                if Path(expected_script).name in cmd:
                    return True
                return False
        except Exception:
            # If we cannot access /proc or parse, fall back to pid alive check
            return True
    return True


ALWAYS_PORTS = {
    "ecoflow-dashboard": 8794,
}


def detect_port(script: Path) -> int | None:
    """Find port from known map, # PORT: comment, or uvicorn/port= line."""
    stem = script.stem.replace(" (1)", "").strip()
    if stem in ALWAYS_PORTS:
        return ALWAYS_PORTS[stem]
    try:
        import re

        text = script.read_text(errors="ignore")
        for line in text.splitlines()[:50]:
            line = line.strip()
            if line.startswith("# PORT:") or line.startswith("#PORT:"):
                return int(line.split(":", 1)[1].strip())
            m = re.search(r"port\s*=\s*(\d{4,5})", line, re.I)
            if m:
                return int(m.group(1))
    except Exception:
        pass
    return None


def start_always(script: Path, state: dict) -> int | None:
    log_file = SCRIPT_LOG_DIR / f"always_{script.stem}.log"
    port = detect_port(script)
    log.info(f"ALWAYS-ON  start  {script.name}")
    try:
        lf = open(log_file, "a")
        lf.write(f"\n--- start {datetime.now().isoformat()} ---\n")
        lf.flush()
        proc = subprocess.Popen(
            [sys.executable, str(script)],
            stdout=lf,
            stderr=subprocess.STDOUT,
            cwd=str(script.parent),
            start_new_session=True,
        )
        key = str(script)
        now = time.time()
        entry = {
            "pid": proc.pid,
            "started": now,
            "name": script.name,
            "port": port,
            "script": str(script),
        }
        existing = state.setdefault("always_on", {}).get(key)
        # track restarts timestamps
        restarts = []
        if existing:
            restarts = existing.get("restarts", [])
        restarts.append(now)
        entry["restarts"] = restarts
        # carry over cooldown if present
        if existing and existing.get("cooldown_until"):
            entry["cooldown_until"] = existing.get("cooldown_until")
        state.setdefault("always_on", {})[key] = entry
        save_state(state)
        log.info(f"  → pid={proc.pid}  log={log_file.name}")
        if port:
            log.info(f"  → page  http://127.0.0.1:{port}/")
            log.info(f"  → page  http://localhost:{port}/")
        return proc.pid
    except Exception as e:
        log.error(f"  → failed: {e}")
        return None


def supervise_always(state: dict) -> None:
    ALWAYS_DIR.mkdir(exist_ok=True)
    scripts = collect_scripts(ALWAYS_DIR)
    known = state.setdefault("always_on", {})

    now = time.time()
    for script in scripts:
        key = str(script)
        info = known.get(key)

        # If in cooldown, skip until cooldown expires
        if info and info.get("cooldown_until") and now < info.get("cooldown_until"):
            # skip restarting while in cooldown
            continue

        if info and _pid_alive(info.get("pid"), expected_script=info.get("script")):
            # process alive — nothing to do
            continue

        # if we reach here, either there is no record or the recorded pid is dead
        if info:
            # the prior process appears dead -> consider restart/backoff
            restarts = [ts for ts in (info.get("restarts") or []) if now - ts <= 60]
            restart_count = len(restarts)
            if restart_count >= 5:
                # put into cooldown for 5 minutes
                info["cooldown_until"] = now + 5 * 60
                state["always_on"][key] = info
                save_state(state)
                log.warning(
                    f"ALWAYS-ON  {script.name} restarted {restart_count} times in 60s — entering cooldown"
                )
                continue
            else:
                log.warning(
                    f"ALWAYS-ON  dead  {script.name}  (was pid={info.get('pid')}) — restarting"
                )

        # start it
        start_always(script, state)

    # prune entries for scripts that were removed from disk
    live_keys = {str(s) for s in scripts}
    for key in list(known.keys()):
        if key not in live_keys:
            log.info(f"ALWAYS-ON  removed  {known[key].get('name')}  (file gone)")
            pid = known[key].get("pid")
            if pid and _pid_alive(pid, expected_script=known[key].get("script")):
                try:
                    os.kill(pid, signal.SIGTERM)
                except Exception:
                    pass
            del known[key]
            save_state(state)


# ── ecoflow status for the ava-core window ─────────────────────────────
def _fmt_dev(name: str, soc, in_w, out_w, net_w=None, trend=None, extra="") -> str:
    net = f"  net={net_w:>7}W" if net_w is not None else ""
    tr = f"  {trend}" if trend else ""
    return (
        f"  {name:10s}  "
        f"soc={soc if soc is not None else '—':>5}  "
        f"in={in_w if in_w is not None else '—':>6}W  "
        f"out={out_w if out_w is not None else '—':>6}W"
        f"{net}{tr}{extra}"
    )


def print_ecoflow_status() -> None:
    """Print latest EcoFlow bank status into the ava-core console/log."""
    lines: list[str] = []

    # 1) Preferred: ecoflow-live.json (written by every aggregator)
    if ECO_LIVE_JSON.exists():
        try:
            data = json.loads(ECO_LIVE_JSON.read_text())
            updated = data.get("updated_at", "?")
            lines.append(f"ECOFLOW  live.json  updated={updated}")
            devices = data.get("devices") or {}
            # stable order
            order = ["Primary", "security", "Backup"]
            names = order + [n for n in devices if n not in order]
            for name in names:
                d = devices.get(name)
                if not d:
                    continue
                lines.append(
                    _fmt_dev(
                        name,
                        d.get("soc"),
                        d.get("in_w"),
                        d.get("out_w"),
                        d.get("net_w"),
                        d.get("trend"),
                        extra=f"  [{d.get('bucket_key', '')}]",
                    )
                )
            totals = data.get("totals") or {}
            if totals:
                lines.append(
                    f"  {'TOTALS':10s}  "
                    f"soc={totals.get('soc_avg', '—'):>5}  "
                    f"in={totals.get('in_w', '—'):>6}W  "
                    f"out={totals.get('out_w', '—'):>6}W  "
                    f"net={totals.get('net_w', '—'):>7}W"
                )
            # brief higher-level snapshot if present
            levels = data.get("levels") or {}
            for lv in ("1h", "24h", "7d", "month"):
                block = levels.get(lv)
                if not block:
                    continue
                bits = []
                for n in order:
                    if n in block and block[n].get("soc_avg") is not None:
                        bits.append(f"{n[0]}={block[n]['soc_avg']:.0f}%")
                if bits:
                    lines.append(f"  [{lv:5s}]  " + "  ".join(bits))
        except Exception as e:
            lines.append(f"ECOFLOW  live.json read error: {e}")

    # 2) Fallback: ecoflow-1min.db (new schema)
    elif ECO_1MIN.exists():
        try:
            conn = sqlite3.connect(str(ECO_1MIN))
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT name, soc_avg, in_w_avg, out_w_avg, net_w_avg, trend,
                       samples, bucket_key
                FROM summary
                WHERE level='1min'
                  AND id IN (
                    SELECT MAX(id) FROM summary WHERE level='1min' GROUP BY name
                  )
                ORDER BY CASE name
                    WHEN 'Primary' THEN 1 WHEN 'security' THEN 2
                    WHEN 'Backup' THEN 3 ELSE 9 END
                """
            ).fetchall()
            conn.close()
            if rows:
                lines.append("ECOFLOW  (1min summary)")
                for r in rows:
                    lines.append(
                        _fmt_dev(
                            r["name"],
                            r["soc_avg"],
                            r["in_w_avg"],
                            r["out_w_avg"],
                            r["net_w_avg"],
                            r["trend"],
                            extra=f"  n={r['samples']}  [{r['bucket_key']}]",
                        )
                    )
        except Exception as e:
            lines.append(f"ECOFLOW  1min read error: {e}")

    # 3) Fallback: ecoflow-10s.db raw
    if ECO_10S.exists():
        try:
            conn = sqlite3.connect(str(ECO_10S))
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT sn, soc, in_w, out_w, online, ts
                FROM snapshots
                WHERE id IN (SELECT MAX(id) FROM snapshots GROUP BY sn)
                """
            ).fetchall()
            conn.close()
            if rows:
                lines.append("ECOFLOW  (live 10s buffer)")
                for r in rows:
                    name = NAME_MAP.get(r["sn"], r["sn"])
                    on = "on" if r["online"] else "off"
                    lines.append(
                        _fmt_dev(
                            name,
                            r["soc"],
                            r["in_w"],
                            r["out_w"],
                            extra=f"  {on}",
                        )
                    )
        except Exception as e:
            lines.append(f"ECOFLOW  10s read error: {e}")

    # 4) Legacy fallbacks (old pipeline still present)
    if not lines and ECO_LEGACY_ENHANCED.exists():
        try:
            conn = sqlite3.connect(str(ECO_LEGACY_ENHANCED))
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT name, soc_avg, in_w_avg, out_w_avg, net_w_avg, trend, samples
                FROM minute_summary
                WHERE id IN (SELECT MAX(id) FROM minute_summary GROUP BY name)
                ORDER BY CASE name
                    WHEN 'Primary' THEN 1 WHEN 'security' THEN 2
                    WHEN 'Backup' THEN 3 ELSE 9 END
                """
            ).fetchall()
            conn.close()
            if rows:
                lines.append("ECOFLOW  (legacy minute enhanced)")
                for r in rows:
                    lines.append(
                        _fmt_dev(
                            r["name"],
                            r["soc_avg"],
                            r["in_w_avg"],
                            r["out_w_avg"],
                            r["net_w_avg"],
                            r["trend"],
                            extra=f"  n={r['samples']}",
                        )
                    )
        except Exception as e:
            lines.append(f"ECOFLOW  legacy enhanced error: {e}")

    if not lines and ECO_LEGACY_LIVE.exists():
        try:
            conn = sqlite3.connect(str(ECO_LEGACY_LIVE))
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT sn, soc, in_w, out_w, online
                FROM snapshots
                WHERE id IN (SELECT MAX(id) FROM snapshots GROUP BY sn)
                """
            ).fetchall()
            conn.close()
            if rows:
                lines.append("ECOFLOW  (legacy live 10s)")
                for r in rows:
                    name = NAME_MAP.get(r["sn"], r["sn"])
                    on = "on" if r["online"] else "off"
                    lines.append(
                        _fmt_dev(name, r["soc"], r["in_w"], r["out_w"], extra=f"  {on}")
                    )
        except Exception as e:
            lines.append(f"ECOFLOW  legacy live error: {e}")

    if not lines:
        log.info("ECOFLOW  no data yet")
        return

    for line in lines:
        log.info(line)


# ── graceful shutdown helper ───────────────────────────────────────────
def _stop(sig, frame):
    log.info("Shutting down (signal received)")
    try:
        state = load_state()
        known = state.get("always_on", {})
        for key, info in list(known.items()):
            pid = info.get("pid")
            script = info.get("script")
            if pid and _pid_alive(pid, expected_script=script):
                try:
                    log.info(f"Terminating always-on {info.get('name')} pid={pid}")
                    os.kill(pid, signal.SIGTERM)
                except Exception:
                    pass
                # wait up to 5s
                for _ in range(5):
                    time.sleep(1)
                    if not _pid_alive(pid, expected_script=script):
                        break
                if _pid_alive(pid, expected_script=script):
                    try:
                        log.info(f"Killing always-on {info.get('name')} pid={pid}")
                        os.kill(pid, signal.SIGKILL)
                    except Exception:
                        pass
        save_state(state)
    except Exception as e:
        log.exception("Error during shutdown cleanup: %s", e)
    sys.exit(0)


# ── main ───────────────────────────────────────────────────────────────
def main() -> None:
    log.info("=" * 60)
    log.info("ava-core started")
    log.info(f"  watching : {BASE}")
    log.info(f"  always-on: {ALWAYS_DIR}")
    log.info(f"  ecoflow  : {ECO_ROOT}")
    log.info(f"  main log : {MAIN_LOG_FILE}")
    log.info("=" * 60)

    state = load_state()
    try:
        run_boot(state)
        supervise_always(state)
    except Exception:
        log.exception("Error during initial boot/supervise")

    signal.signal(signal.SIGINT, _stop)
    signal.signal(signal.SIGTERM, _stop)

    last_slot = ""
    last_eco = 0.0
    log.info("Entering main loop (tick every 2s)")

    while True:
        try:
            slot = current_slot()
            if slot != last_slot:
                run_on_time(state)
                last_slot = slot

            run_since_last(state)
            supervise_always(state)

            now = time.time()
            if now - last_eco >= 30:
                try:
                    print_ecoflow_status()
                except Exception:
                    log.exception("Error printing ecoflow status")
                for info in state.get("always_on", {}).values():
                    port = info.get("port")
                    if port and _pid_alive(info.get("pid"), expected_script=info.get("script")):
                        log.info(f"PAGE  {info.get('name')}  →  http://localhost:{port}/")
                last_eco = now

            time.sleep(2)
        except Exception as e:
            log.exception("Unhandled error in main loop: %s", e)
            time.sleep(5)
            # reload state in case something external modified it
            try:
                state = load_state()
            except Exception:
                state = {"boot_done": True, "last_fire": {}, "always_on": {}}


if __name__ == "__main__":
    main()
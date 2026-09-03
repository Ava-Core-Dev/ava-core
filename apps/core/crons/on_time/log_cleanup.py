"""Delete stale log *files* only. Never rmdir / rmtree.

Policy (7 days):
  • Dated / rotated files (``2026-08-04-1.log.gz``, ``*.log.1``, ``*.log.old``)
    older than 7 days → unlink that file. Age is the ``YYYY-MM-DD`` in the
    filename when present (rsync/copy can refresh mtime); otherwise mtime.
  • Live logs we still write (``latest.log``, ``origin-uvicorn.log``, …) are
    never deleted. If they grow past 2 MiB, copy to
    ``name-YYYY-MM-DD.log`` then truncate the original in place (same inode).
  • Directories, leveldb, and Electron Local Storage are skipped.
"""

from __future__ import annotations

import logging
import re
import time
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger("ava.cron.log_cleanup")

KEEP_DAYS = 7
MAX_LIVE_BYTES = 2 * 1024 * 1024
DATED_NAME = re.compile(
    r"(?:^\d{4}-\d{2}-\d{2}"
    r"|\.log\.\d+$"
    r"|\.log\.gz$"
    r"|\.log\.old$"
    r"|-\d{4}-\d{2}-\d{2}(?:-\d{2})?\.log(?:\.gz)?$)",
    re.I,
)
LIVE_NAMES = {
    "latest.log",
    "debug.log",
    "origin-uvicorn.log",
    "origin-8787.log",
    "ava-core-session.log",
    "ava-core.log",
    "ava-core-restart.log",
    "ava-core-systemd.log",
    "ava-brain.log",
    "ava-desktop.log",
    "ava-voice.log",
    "ava-tunnel.log",
    "tunnel.log",
    "tunnel-v2.log",
    "poller.out",
    "companions.log",
    "console-nohup.log",
    "devnet-sol-boot.log",
    "autostart.log",
    "phpmyadmin.log",
    "ava-phpmyadmin.log",
    "electron.log",
    "minecraft-test.log",
    "minecraft-test-session.log",
    "ava-minecraft-test.log",
    "poller-restart.log",
    "rootmc-ava-poller.log",
    "local-api.log",
    "local-edge-8791.log",
    "auto-push.log",
    "git-pull-live.log",
    "site-update.log",
}


def _roots() -> list[Path]:
    from apps.core import config

    out = [
        Path.home() / "Ava" / "Logs",
        config.LOG_DIR,
        config.DATA_DIR / "logs",
        config.AVA_HOME / "logs",
        Path(config.AVA_HOME / "Data" / "logs"),
        config.MC_TEST_DIR / "logs",
        Path.home() / "Ava" / "Workstations" / "shockbyte" / "logs",
        Path.home() / "Ava" / "Workstations" / "minecraft-plugins" / "server" / "logs",
        Path.home() / "Ava" / "Workstations" / "minecraft-test" / "logs",
        Path.home() / "Ava" / "Workstations" / "minecraft-test-live" / "logs",
        Path.home() / "Ava" / "minecraft-plugins" / "server" / "logs",
        config.AVA_HOME / "workstations" / "shockbyte" / "logs",
        config.AVA_HOME / "workstations" / "minecraft-plugins" / "server" / "logs",
        config.AVA_HOME / "workstations" / "minecraft-test" / "logs",
    ]
    seen: set[Path] = set()
    roots: list[Path] = []
    for p in out:
        try:
            r = p.expanduser().resolve()
        except OSError:
            continue
        if r in seen or not r.is_dir():
            continue
        seen.add(r)
        roots.append(r)
    return roots


def _is_log_file(path: Path) -> bool:
    n = path.name.lower()
    if n.endswith(".log") or n.endswith(".out") or n.endswith(".log.gz"):
        return True
    if ".log." in n:
        return True
    return False


def _skip(path: Path) -> bool:
    parts = {p.lower() for p in path.parts}
    if "leveldb" in parts or ".config" in parts:
        return True
    if "local storage" in str(path).lower():
        return True
    return False


def _unlink(path: Path, deleted: list[str]) -> None:
    try:
        path.unlink()
        deleted.append(str(path))
        log.info("removed log file %s", path)
    except OSError as e:
        log.warning("skip unlink %s: %s", path, e)


def _name_day(name: str) -> datetime | None:
    m = re.match(r"^(\d{4}-\d{2}-\d{2})", name)
    if not m:
        m = re.search(r"-(\d{4}-\d{2}-\d{2})(?:-\d+)?\.log", name, re.I)
    if not m:
        return None
    try:
        return datetime.strptime(m.group(1), "%Y-%m-%d")
    except ValueError:
        return None


def _stale(path: Path, cutoff: float, keep_days: int) -> bool:
    day = _name_day(path.name)
    if day is not None:
        return (datetime.now().date() - day.date()).days >= keep_days
    try:
        return path.stat().st_mtime < cutoff
    except OSError:
        return False


def _rotate_live(path: Path, rotated: list[str]) -> None:
    try:
        size = path.stat().st_size
    except OSError:
        return
    if size <= MAX_LIVE_BYTES:
        return
    day = datetime.now().strftime("%Y-%m-%d")
    dest = path.with_name(f"{path.stem}-{day}{path.suffix}")
    n = 1
    while dest.exists():
        dest = path.with_name(f"{path.stem}-{day}-{n}{path.suffix}")
        n += 1
    try:
        dest.write_bytes(path.read_bytes())
        path.write_bytes(b"")
        rotated.append(f"{path} → {dest.name}")
        log.info("rotated live log %s (%s bytes) → %s", path.name, size, dest.name)
    except OSError as e:
        log.warning("skip rotate %s: %s", path, e)


def cleanup(keep_days: int = KEEP_DAYS) -> dict:
    cutoff = time.time() - keep_days * 86400
    deleted: list[str] = []
    rotated: list[str] = []
    scanned = 0
    for root in _roots():
        for path in root.iterdir():
            if not path.is_file():
                continue
            if _skip(path) or not _is_log_file(path):
                continue
            scanned += 1
            name = path.name
            dated = bool(DATED_NAME.search(name))
            live = name in LIVE_NAMES or name.lower() == "latest.log"
            if live and not dated:
                _rotate_live(path, rotated)
                continue
            if _stale(path, cutoff, keep_days):
                _unlink(path, deleted)
    payload = {
        "ok": True,
        "ts": datetime.now(timezone.utc).isoformat(),
        "keep_days": keep_days,
        "roots": [str(p) for p in _roots()],
        "scanned": scanned,
        "deleted": deleted,
        "rotated": rotated,
    }
    try:
        from apps.core import config

        state = config.DATA_DIR / "state" / "log-cleanup.json"
        state.parent.mkdir(parents=True, exist_ok=True)
        import json

        state.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    except OSError:
        pass
    return payload


async def run() -> None:
    result = cleanup()
    log.info(
        "log cleanup scanned=%s deleted=%s rotated=%s",
        result.get("scanned"),
        len(result.get("deleted") or []),
        len(result.get("rotated") or []),
    )

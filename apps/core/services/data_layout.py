"""One live data tree. Delete a folder here and it stays gone.

Live writes and reads use ``config.DATA_DIR`` only
(``C:\\Users\\rootr\\ava\\data`` on this PC). Old trees on E: and D: are
archives. Do not scan them for charts or LIVE FACTS.

The EcoFlow pack ``R331ZAB5SG755642`` is never fetched, stored, or shown.
"""
from __future__ import annotations

import logging
import sqlite3
from pathlib import Path
from typing import Iterable

from apps.core import config

log = logging.getLogger("ava.data_layout")

# Physical labels. Do not use EcoFlow productName — it is swapped.
SN_LABELS: dict[str, str] = {
    "R331ZAB5SG6S2858": "DELTA 2",
    "R621ZA16XH6K1155": "RIVER 2 Pro",
}

# Never poll, persist, or display. Not the public DELTA 2.
HIDDEN_ECOFLOW_SN: frozenset[str] = frozenset({
    "R331ZAB5SG755642",
})


def norm_sn(sn: str | None) -> str:
    return str(sn or "").strip().upper()


def ecoflow_sn_hidden(sn: str | None) -> bool:
    return norm_sn(sn) in HIDDEN_ECOFLOW_SN


def ecoflow_sn_public(sn: str | None) -> bool:
    key = norm_sn(sn)
    return bool(key) and key in SN_LABELS and key not in HIDDEN_ECOFLOW_SN


def public_serials(raw: Iterable[str] | None) -> list[str]:
    """Keep env order, drop hidden / unlabeled packs."""
    out: list[str] = []
    seen: set[str] = set()
    for item in raw or []:
        key = norm_sn(item)
        if not ecoflow_sn_public(key) or key in seen:
            continue
        seen.add(key)
        out.append(key)
    return out


def label_for_sn(sn: str, listed: str | None = None) -> str:
    key = norm_sn(sn)
    return SN_LABELS.get(key) or listed or key[-6:]


def device_role(sn_or_label: str) -> str:
    """delta | river | other. Prefix alone is not enough — a hidden R331 is not Delta 2."""
    key = norm_sn(sn_or_label)
    lab = (SN_LABELS.get(key) or sn_or_label or "").upper()
    if key in HIDDEN_ECOFLOW_SN:
        return "other"
    if key == "R331ZAB5SG6S2858" or lab == "DELTA 2":
        return "delta"
    if key == "R621ZA16XH6K1155" or "RIVER" in lab:
        return "river"
    return "other"


def ecoflow_dir() -> Path:
    return config.DATA_DIR / "ecoflow"


def system_dir() -> Path:
    return config.DATA_DIR / "system"


def host_dir() -> Path:
    return config.DATA_DIR / "host"


def host_history_path() -> Path:
    return host_dir() / "history.jsonl"


def ensure_data_layout() -> None:
    """Create the live folders. Missing dir → empty dir, not a leftover tree."""
    for d in (
        config.DATA_DIR,
        ecoflow_dir(),
        ecoflow_dir() / "quota",
        ecoflow_dir() / "history",
        ecoflow_dir() / "loads",
        config.DATA_DIR / "feedback",
        system_dir(),
        host_dir(),
        config.DATA_DIR / "state",
        config.DATA_DIR / "weather",
        config.DATA_DIR / "finance",
        config.DATA_DIR / "logs",
        config.DB_DIR,
    ):
        d.mkdir(parents=True, exist_ok=True)
    _purge_live_hidden()


def _unlink_hidden_files(root: Path) -> list[str]:
    removed: list[str] = []
    if not root.is_dir():
        return removed
    for folder in (root / "quota", root / "history", root / "devices"):
        if not folder.is_dir():
            continue
        for path in folder.iterdir():
            name = path.name.upper()
            if any(hidden in name for hidden in HIDDEN_ECOFLOW_SN):
                try:
                    path.unlink()
                    removed.append(str(path))
                except OSError as e:
                    log.warning("hidden pack file not removed %s: %s", path, e)
    return removed


def _purge_sqlite(db: Path) -> int:
    if not db.is_file():
        return 0
    hidden = tuple(HIDDEN_ECOFLOW_SN)
    deleted = 0
    try:
        con = sqlite3.connect(str(db), timeout=5)
        try:
            tables = [
                r[0]
                for r in con.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()
            ]
            for table in tables:
                cols = [r[1] for r in con.execute(f"PRAGMA table_info({table})")]
                if "sn" in cols:
                    qmarks = ",".join("?" for _ in hidden)
                    cur = con.execute(
                        f"DELETE FROM {table} WHERE upper(sn) IN ({qmarks})",
                        hidden,
                    )
                    deleted += cur.rowcount or 0
                for col in cols:
                    if col.lower() in ("raw_json", "json", "payload"):
                        for sn in hidden:
                            cur = con.execute(
                                f"DELETE FROM {table} WHERE CAST({col} AS TEXT) LIKE ?",
                                (f"%{sn}%",),
                            )
                            deleted += cur.rowcount or 0
            con.commit()
        finally:
            con.close()
    except sqlite3.Error as e:
        log.warning("hidden pack sqlite purge skipped %s: %s", db.name, e)
    return deleted


def _purge_live_hidden() -> dict[str, int | list[str]]:
    root = ecoflow_dir()
    files = _unlink_hidden_files(root)
    rows = 0
    for name in ("ecoflow-10s.db", "ecoflow-1min.db", "ecoflow-state.db"):
        rows += _purge_sqlite(root / name)
    return {"files": files, "sqlite_rows": rows}


def purge_hidden_ecoflow(root: Path | None = None) -> dict[str, int | list[str]]:
    """Strip the hidden pack from the live EcoFlow tree only. Leaves D: / E: archives."""
    if root is None:
        ensure_data_layout()
        return _purge_live_hidden()
    files = _unlink_hidden_files(root)
    rows = 0
    for name in ("ecoflow-10s.db", "ecoflow-1min.db", "ecoflow-state.db"):
        rows += _purge_sqlite(root / name)
    return {"files": files, "sqlite_rows": rows}

"""Truncate EcoFlow/host/uptime series written under the bad load labels.

Keeps live quota files and sun-times.json. Does not drop sqlite schema.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

from apps.core import config
from apps.core.services.data_layout import ecoflow_dir, host_history_path


def _wipe_jsonl(path: Path) -> None:
    if path.is_file():
        path.write_text("", encoding="utf-8")
        print("cleared", path)


def _truncate_db(path: Path) -> None:
    if not path.is_file():
        return
    con = sqlite3.connect(str(path))
    try:
        tables = [
            r[0]
            for r in con.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            )
        ]
        for name in tables:
            con.execute(f'DELETE FROM "{name}"')
            print("truncated", path.name, name)
        con.commit()
    finally:
        con.close()


def main() -> None:
    eco = ecoflow_dir()
    hist = eco / "history"
    loads = eco / "loads"
    if hist.is_dir():
        for f in hist.glob("*.jsonl"):
            _wipe_jsonl(f)
    if loads.is_dir():
        for f in loads.glob("*.jsonl"):
            _wipe_jsonl(f)
    _wipe_jsonl(host_history_path())
    state = config.DATA_DIR / "state"
    _wipe_jsonl(state / "uptime-events.jsonl")
    marker = state / "uptime-marker.json"
    if marker.is_file():
        marker.unlink()
        print("removed", marker)
    for db in eco.glob("*.db"):
        _truncate_db(db)
    sun = state / "sun-times.json"
    print("sun-times kept" if sun.is_file() else "sun-times missing")
    quota = eco / "quota"
    print("quota kept", list(quota.glob("*.json")) if quota.is_dir() else [])


if __name__ == "__main__":
    main()

"""Live site facts that reports and overlays must not invent past."""

from __future__ import annotations

import json
from pathlib import Path

from apps.core import config

_PATH = config.DATA_DIR / "state" / "ops-site.json"

_DEFAULT = {
    "pv_mount": "ground",
    "pv_mount_note": "Ground-mounted PV. Not on the roof.",
    "pv_roof": False,
}


def site_ops() -> dict:
    if _PATH.is_file():
        try:
            data = json.loads(_PATH.read_text())
            return {**_DEFAULT, **data}
        except Exception:
            pass
    return dict(_DEFAULT)


def pv_line() -> str:
    s = site_ops()
    return str(s.get("pv_mount_note") or "Ground-mounted PV.")

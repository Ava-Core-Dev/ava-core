"""Bump overlay generation when OBS scenes switch so HUDs replay alerts."""

from __future__ import annotations

import json
import time
from typing import Any

from apps.core import config

GEN_PATH = config.DATA_DIR / "state" / "obs-overlay-gen.json"


def load_gen() -> dict[str, Any]:
    if not GEN_PATH.is_file():
        return {"gen": 0, "scene": "", "reason": ""}
    try:
        return json.loads(GEN_PATH.read_text())
    except Exception:
        return {"gen": 0, "scene": "", "reason": ""}


def bump_overlay_gen(scene: str, reason: str = "scene_switch") -> dict[str, Any]:
    data = {
        "gen": int(time.time() * 1000),
        "scene": scene,
        "reason": reason,
    }
    GEN_PATH.parent.mkdir(parents=True, exist_ok=True)
    GEN_PATH.write_text(json.dumps(data, indent=2))
    return data

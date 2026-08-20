"""Manual + automatic OBS scene hide/show for the daily rotator."""

from __future__ import annotations

import json
import logging
from typing import Any

from apps.core import config

log = logging.getLogger("ava.obs_visibility")

VIS_PATH = config.DATA_DIR / "state" / "obs-scene-visibility.json"
REMOVED_PATH = config.DATA_DIR / "state" / "obs-removed-scenes.json"

QUAKE_GLOBAL = "Quake · Global"
QUAKE_ISLAND = "Quake · Big Island"
MC_SCENE = "RootMC Live"


def load_visibility() -> dict[str, list[str]]:
    if not VIS_PATH.is_file():
        return {"hidden_manual": [], "hidden_auto": []}
    try:
        data = json.loads(VIS_PATH.read_text())
    except Exception:
        return {"hidden_manual": [], "hidden_auto": []}
    return {
        "hidden_manual": list(data.get("hidden_manual") or []),
        "hidden_auto": list(data.get("hidden_auto") or []),
    }


def save_visibility(data: dict[str, list[str]]) -> None:
    VIS_PATH.parent.mkdir(parents=True, exist_ok=True)
    VIS_PATH.write_text(json.dumps(data, indent=2))


def hidden_set() -> set[str]:
    vis = load_visibility()
    return set(vis.get("hidden_manual") or []) | set(vis.get("hidden_auto") or [])


def visible_pool(scenes: list[str]) -> list[str]:
    hidden = hidden_set()
    return [s for s in scenes if s not in hidden]


def set_manual_hidden(scenes: list[str]) -> dict[str, Any]:
    vis = load_visibility()
    vis["hidden_manual"] = sorted(set(scenes))
    save_visibility(vis)
    return vis


async def refresh_auto_hide() -> dict[str, Any]:
    """Compute auto-hidden scenes from live desk state.

    Daily mode keeps a hard 10-topic loop; do not auto-drop RootMC / Storm /
    Quake desks from that capped set — offline thumbs still tell the story.
    """
    from apps.core.services.obs_desk_data import quake_has_global_event, quake_has_island_event

    vis = load_visibility()
    auto: set[str] = set()

    # Legacy split quake scenes (not in the 10-topic daily set) may still exist
    # in other collections — hide when quiet.
    if not await quake_has_global_event():
        auto.add(QUAKE_GLOBAL)
    if not await quake_has_island_event():
        auto.add(QUAKE_ISLAND)

    vis["hidden_auto"] = sorted(auto)
    save_visibility(vis)
    return vis


async def apply_hidden_scenes(obs: Any) -> dict[str, Any]:
    """Remove hidden scenes from OBS; record names for restore."""
    hidden = hidden_set()
    if not hidden:
        return {"ok": True, "removed": []}
    existing = {
        s.get("sceneName")
        for s in (await obs.req("GetSceneList")).get("scenes") or []
    }
    removed: list[str] = []
    for scene in sorted(hidden):
        if scene in existing:
            await obs.try_req("RemoveScene", {"sceneName": scene})
            removed.append(scene)
    if removed:
        REMOVED_PATH.parent.mkdir(parents=True, exist_ok=True)
        REMOVED_PATH.write_text(json.dumps({"removed": removed}, indent=2))
    return {"ok": True, "removed": removed}

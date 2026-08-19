"""Standalone Ava goal records — isolation, ranking, helper ledger.

Catalog lives in git (GitHub-editable). Runtime helpers append to
data/state/goal-helpers.json so public mutation stays off the origin.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .. import config

log = logging.getLogger("ava.goals")

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
CATALOG_PATH = _REPO_ROOT / "packages" / "web" / "avaivy.cloud" / "src" / "goals.json"
HELPERS_PATH = config.DATA_DIR / "state" / "goal-helpers.json"

WEIGHTS = {
    "operational_impact": 0.40,
    "cost_efficiency": 0.20,
    "funding_readiness": 0.15,
    "strategic_fit": 0.15,
    "time_sensitivity": 0.10,
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_catalog() -> dict[str, Any]:
    if not CATALOG_PATH.exists():
        return {"funding_rules": {}, "priority_weights": WEIGHTS, "goals": []}
    return json.loads(CATALOG_PATH.read_text())


def _helpers_store() -> dict[str, list]:
    if not HELPERS_PATH.exists():
        return {}
    try:
        data = json.loads(HELPERS_PATH.read_text())
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def _save_helpers(store: dict[str, list]) -> None:
    HELPERS_PATH.parent.mkdir(parents=True, exist_ok=True)
    HELPERS_PATH.write_text(json.dumps(store, indent=2) + "\n")


def priority_score(factors: dict[str, Any], weights: dict[str, float] | None = None) -> float:
    w = weights or WEIGHTS
    total = 0.0
    for key, weight in w.items():
        try:
            total += float(weight) * float(factors.get(key) or 0)
        except (TypeError, ValueError):
            continue
    return round(total, 2)


def _merge_goal(raw: dict[str, Any], extras: list, weights: dict[str, float]) -> dict[str, Any]:
    helpers = list(raw.get("helpers") or [])
    helpers.extend(extras)
    raised = float(raw.get("amount_raised_usd") or 0)
    for h in extras:
        try:
            raised += float(h.get("amount_usd") or 0)
        except (TypeError, ValueError):
            pass
    factors = dict(raw.get("factors") or {})
    out = dict(raw)
    out["helpers"] = helpers
    out["amount_raised_usd"] = raised
    out["priority_score"] = priority_score(factors, weights)
    return out


def list_goals() -> dict[str, Any]:
    catalog = load_catalog()
    weights = catalog.get("priority_weights") or WEIGHTS
    extra = _helpers_store()
    goals = [
        _merge_goal(g, extra.get(g.get("goal_id") or "", []), weights)
        for g in catalog.get("goals") or []
        if isinstance(g, dict) and g.get("goal_id")
    ]
    goals.sort(key=lambda g: float(g.get("priority_score") or 0), reverse=True)
    return {
        "funding_rules": catalog.get("funding_rules") or {},
        "priority_weights": weights,
        "goals": goals,
    }


def get_goal(goal_id: str) -> dict[str, Any] | None:
    packed = list_goals()
    for g in packed["goals"]:
        if g.get("goal_id") == goal_id:
            return g
    return None


def record_helper(goal_id: str, who: str, amount_usd: float, note: str) -> dict[str, Any] | None:
    """Append a helper row. amount_usd must be an explicit number (0 is allowed)."""
    if get_goal(goal_id) is None:
        return None
    store = _helpers_store()
    row = {
        "who": who,
        "amount_usd": float(amount_usd),
        "note": note,
        "at": _now(),
    }
    store.setdefault(goal_id, []).append(row)
    _save_helpers(store)
    log.info("helper recorded  goal=%s  who=%s  amount=%s", goal_id, who, amount_usd)
    return get_goal(goal_id)

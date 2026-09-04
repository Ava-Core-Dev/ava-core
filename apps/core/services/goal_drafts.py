"""Draft operational goals from desk context; operator approves into goals.json."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from apps.core import config
from apps.core.services.goals import CATALOG_PATH, load_catalog

log = logging.getLogger("ava.goal_drafts")
DRAFTS_PATH = config.DATA_DIR / "state" / "goal-drafts.json"
AVA = config.AVA_HOME
REPORTS = AVA / "Media" / "documents" / "reports"


def load_drafts() -> dict[str, Any]:
    if not DRAFTS_PATH.is_file():
        return {"drafts": [], "updated_at": None}
    try:
        return json.loads(DRAFTS_PATH.read_text())
    except Exception:
        return {"drafts": [], "updated_at": None}


def save_drafts(data: dict[str, Any]) -> None:
    DRAFTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    DRAFTS_PATH.write_text(json.dumps(data, indent=2) + "\n")


def _context_snippet(max_chars: int = 4000) -> str:
    lines: list[str] = []
    catalog = load_catalog()
    for g in (catalog.get("goals") or [])[:5]:
        lines.append(f"Existing goal: {g.get('title')} — {g.get('summary') or g.get('description') or ''}")
    for root in (REPORTS / "inbox", REPORTS / "posts" / "ava"):
        if not root.is_dir():
            continue
        for path in sorted(root.glob("*.md"), key=lambda p: p.stat().st_mtime, reverse=True)[:3]:
            try:
                text = path.read_text(encoding="utf-8", errors="replace")[:800]
            except OSError:
                continue
            lines.append(f"Report {path.name}:\n{text}")
    blob = "\n\n".join(lines)
    return blob[:max_chars]


async def generate_drafts() -> dict[str, Any]:
    """Use local Ollama to propose goals not already in catalog."""
    from apps.core.services import ollama as ollama_svc

    catalog = load_catalog()
    existing_titles = {str(g.get("title") or "").lower() for g in catalog.get("goals") or []}
    prompt = (
        "From this Ava desk context, propose 2-4 NEW operational goals Ava should track. "
        "Return JSON array only: [{\"title\",\"summary\",\"status\":\"proposed\"}]. "
        "Do not duplicate existing goals.\n\n"
        + _context_snippet()
    )
    raw = await ollama_svc.chat(
        [{"role": "user", "content": prompt}],
        model=config.OLLAMA_MODEL,
        timeout=120,
    )
    if not raw:
        return {"drafts": [], "updated_at": datetime.now(timezone.utc).isoformat(), "detail": "ollama_empty"}
    drafts: list[dict] = []
    try:
        start = raw.find("[")
        end = raw.rfind("]") + 1
        if start >= 0 and end > start:
            drafts = json.loads(raw[start:end])
    except Exception as e:
        log.info("goal draft parse: %s", e)
    cleaned = []
    for d in drafts if isinstance(drafts, list) else []:
        title = str(d.get("title") or "").strip()
        if not title or title.lower() in existing_titles:
            continue
        cleaned.append(
            {
                "title": title,
                "summary": str(d.get("summary") or "")[:500],
                "status": "draft",
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        )
    data = {"drafts": cleaned, "updated_at": datetime.now(timezone.utc).isoformat()}
    save_drafts(data)
    return data


def approve_draft(index: int) -> dict[str, Any]:
    """Append approved draft to goals.json catalog."""
    data = load_drafts()
    drafts = list(data.get("drafts") or [])
    if index < 0 or index >= len(drafts):
        return {"ok": False, "detail": "bad_index"}
    draft = drafts.pop(index)
    catalog = load_catalog()
    goals = list(catalog.get("goals") or [])
    slug = draft["title"].lower().replace(" ", "-")[:48]
    goals.append(
        {
            "id": slug,
            "title": draft["title"],
            "summary": draft.get("summary") or "",
            "status": "active",
            "factors": {
                "operational_impact": 0.7,
                "cost_efficiency": 0.5,
                "funding_readiness": 0.4,
                "strategic_fit": 0.8,
                "time_sensitivity": 0.5,
            },
        }
    )
    catalog["goals"] = goals
    CATALOG_PATH.write_text(json.dumps(catalog, indent=2) + "\n")
    data["drafts"] = drafts
    save_drafts(data)
    return {"ok": True, "goal_id": slug}

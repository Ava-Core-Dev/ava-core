"""Site page background rotations — files live under media/images/character/."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .. import config
from . import media_library

CONFIG_NAME = "site-backgrounds.json"
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}

DEFAULT_PAGES: dict[str, dict[str, Any]] = {
    "solar": {
        "label": "Solar / status board",
        "sites": [
            "avaivy.cloud/solar",
            "avaivy.cloud/status",
            "rootrecord.online/ava",
            "rootrecord.online/status",
        ],
        "cycle_seconds": 18,
        "paths": [
            "images/character/ava-solar-ground-pv-night.png",
            "images/character/ava-05-desk-root-server.png",
            "images/character/ava-01-meadow-holograms.png",
            "images/character/ava-hologram-wave.png",
            "images/character/ava-desk-ops.png",
            "images/character/background home.jpg",
        ],
    }
}


def character_dir() -> Path:
    return Path(config.PUBLIC_MEDIA) / "images" / "character"


def config_path() -> Path:
    return character_dir() / CONFIG_NAME


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _empty_doc() -> dict[str, Any]:
    return {"version": 1, "updated_at": None, "pages": dict(DEFAULT_PAGES)}


def load_doc() -> dict[str, Any]:
    path = config_path()
    if not path.is_file():
        return _empty_doc()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return _empty_doc()
    if not isinstance(data, dict):
        return _empty_doc()
    pages = data.get("pages")
    if not isinstance(pages, dict) or not pages:
        data["pages"] = dict(DEFAULT_PAGES)
    return data


def save_doc(doc: dict[str, Any]) -> dict[str, Any]:
    character_dir().mkdir(parents=True, exist_ok=True)
    out = {
        "version": 1,
        "updated_at": _now(),
        "pages": doc.get("pages") if isinstance(doc.get("pages"), dict) else {},
    }
    config_path().write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    return out


def list_character_images(limit: int = 200) -> list[dict[str, str]]:
    root = character_dir()
    if not root.is_dir():
        return []
    items: list[dict[str, str]] = []
    for p in sorted(root.iterdir(), key=lambda x: x.name.lower()):
        if not p.is_file():
            continue
        if p.suffix.lower() not in IMAGE_EXTS:
            continue
        if p.name == CONFIG_NAME:
            continue
        rel = f"images/character/{p.name}"
        if not media_library.is_public_rel(rel):
            continue
        items.append(
            {
                "path": rel,
                "name": p.name,
                "url": f"/api/media/public/file?path={rel}",
            }
        )
        if len(items) >= limit:
            break
    return items


def normalize_paths(paths: list[Any]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for raw in paths:
        rel = str(raw or "").replace("\\", "/").lstrip("/")
        if not rel.startswith("images/character/"):
            # allow bare filenames from the character folder
            if "/" not in rel and rel:
                rel = f"images/character/{rel}"
            else:
                continue
        if not media_library.is_public_rel(rel):
            continue
        full = media_library.resolve_public(rel)
        if full is None:
            continue
        if rel in seen:
            continue
        seen.add(rel)
        out.append(rel)
    return out


def get_page(page_key: str) -> dict[str, Any] | None:
    key = str(page_key or "").strip().lower()
    if not key:
        return None
    doc = load_doc()
    page = doc.get("pages", {}).get(key)
    if not isinstance(page, dict):
        return None
    paths = normalize_paths(list(page.get("paths") or []))
    return {
        "key": key,
        "label": str(page.get("label") or key),
        "sites": [str(s) for s in (page.get("sites") or []) if str(s).strip()],
        "cycle_seconds": max(0, int(page.get("cycle_seconds") or 0)),
        "paths": paths,
        "urls": [f"/api/media/public/file?path={p}" for p in paths],
    }


def upsert_page(
    page_key: str,
    *,
    paths: list[Any] | None = None,
    label: str | None = None,
    sites: list[Any] | None = None,
    cycle_seconds: int | None = None,
) -> dict[str, Any]:
    key = str(page_key or "").strip().lower().replace(" ", "-")
    if not key or "/" in key or ".." in key:
        raise ValueError("invalid page key")
    doc = load_doc()
    pages = doc.setdefault("pages", {})
    cur = pages.get(key) if isinstance(pages.get(key), dict) else {}
    next_page = {
        "label": str(label if label is not None else cur.get("label") or key),
        "sites": [str(s).strip() for s in (sites if sites is not None else cur.get("sites") or []) if str(s).strip()],
        "cycle_seconds": max(
            0,
            int(cycle_seconds if cycle_seconds is not None else cur.get("cycle_seconds") or 0),
        ),
        "paths": normalize_paths(list(paths if paths is not None else cur.get("paths") or [])),
    }
    pages[key] = next_page
    save_doc(doc)
    return get_page(key) or {"key": key, **next_page}


def catalog() -> dict[str, Any]:
    doc = load_doc()
    pages_out = []
    for key in sorted((doc.get("pages") or {}).keys()):
        page = get_page(key)
        if page:
            pages_out.append(page)
    return {
        "ok": True,
        "updated_at": doc.get("updated_at"),
        "config_path": str(config_path()),
        "character_dir": str(character_dir()),
        "pages": pages_out,
        "library": list_character_images(),
    }

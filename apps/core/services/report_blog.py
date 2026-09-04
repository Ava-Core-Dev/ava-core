"""Auto-publish successful full reports to Updates / blog markdown posts.

Source of truth: Media/public/documents/reports/posts/{brand}/
Run scripts/sync-blogs.py to rebuild site blogPosts.ts (Pages deploy).
"""
from __future__ import annotations

import logging
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from apps.core import config

log = logging.getLogger("ava.report_blog")
HST = ZoneInfo("Pacific/Honolulu")

BRAND_LABEL = {
    "ava": "Ava",
    "rootrecord": "Root Record",
    "rootmc": "RootMC",
}


def posts_root() -> Path:
    candidates = (
        config.PUBLIC_MEDIA / "documents" / "reports" / "posts",
        config.MEDIA_DIR / "documents" / "reports" / "posts",
    )
    for p in candidates:
        if p.is_dir():
            return p
    root = candidates[0]
    root.mkdir(parents=True, exist_ok=True)
    return root


def _slugify(report_type: str, day: str, hour: str) -> str:
    return f"{report_type}-status-{day.replace('-', '')}-{hour}"


def _teaser(text: str, limit: int = 160) -> str:
    flat = re.sub(r"\s+", " ", (text or "").strip())
    if len(flat) <= limit:
        return flat
    return flat[: limit - 1].rstrip() + "…"


def _categories(report_type: str) -> str:
    if report_type in {"morning", "midday", "evening"}:
        return "runtime, ops"
    if report_type in {"solar", "power"}:
        return "ops"
    return "runtime"


def publish_report_post(
    *,
    report_type: str,
    text: str,
    engine: str,
    brands: list[str] | None = None,
    audio_rel: str | None = None,
    sync: bool = False,
) -> dict:
    """Write blog markdown for each brand. Does not invent facts."""
    body = (text or "").strip()
    if not body:
        return {"ok": False, "detail": "empty"}

    now = datetime.now(HST)
    day = now.strftime("%Y-%m-%d")
    hour = now.strftime("%H%M")
    slug = _slugify(report_type, day, hour)
    published = now.strftime("%Y-%m-%dT%H:%M:%S") + "-10:00"
    kind = {
        "morning": "Morning",
        "midday": "Midday",
        "evening": "Evening",
    }.get(report_type, report_type.title())
    title = f"{kind} status — {now.strftime('%b')} {now.day}, {now.year}"

    brands = brands or ["ava"]
    written: list[dict] = []
    root = posts_root()

    audio_block = ""
    audio_fm = ""
    if audio_rel:
        audio_fm = f"audio:\n  - {audio_rel}\n"
        audio_block = (
            "\n## After\n\n"
            f"Audio: `{audio_rel}` (served via public media file API when deployed).\n"
        )

    for brand in brands:
        brand = str(brand).strip().lower()
        if brand not in BRAND_LABEL:
            continue
        folder = root / brand
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / f"{slug}.md"
        fm = (
            "---\n"
            f"slug: {slug}\n"
            f"date: {day}\n"
            f"published: {published}\n"
            f'title: "{title}"\n'
            f'teaser: "{_teaser(body).replace(chr(34), chr(39))}"\n'
            f"brand: {BRAND_LABEL[brand]}\n"
            f"categories: {_categories(report_type)}\n"
            f"engine: {engine}\n"
            f"report_type: {report_type}\n"
            f"{audio_fm}"
            "---\n\n"
        )
        sources = (
            "\n## Sources\n\n"
            "- https://origin.avaivy.cloud/data\n"
            "- https://avaivy.cloud/context\n"
            "- https://rootrecord.cloud/llms.txt\n"
        )
        path.write_text(fm + body + "\n" + audio_block + sources, encoding="utf-8")
        written.append({"brand": brand, "path": str(path), "slug": slug})
        log.info("report blog post written brand=%s slug=%s", brand, slug)

    out: dict = {
        "ok": bool(written),
        "slug": slug,
        "posts": written,
        "public_urls": [
            f"https://avaivy.cloud/blog/{slug}" if w["brand"] == "ava" else f"https://rootrecord.online/blog/{slug}"
            for w in written
        ],
        "sync_ran": False,
    }
    if sync and written:
        out["sync_ran"] = bool(run_sync_blogs())
    return out


def run_sync_blogs() -> bool:
    script = config.AVA_HOME / "scripts" / "sync-blogs.py"
    if not script.is_file():
        log.warning("sync-blogs.py missing")
        return False
    try:
        subprocess.run(
            [sys.executable, str(script)],
            cwd=str(config.AVA_HOME),
            check=False,
            timeout=120,
        )
        return True
    except Exception as e:
        log.warning("sync-blogs failed: %s", e)
        return False

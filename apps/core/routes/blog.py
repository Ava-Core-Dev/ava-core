"""Public blog JSON from compiled posts + FastAPI HTML fallback."""
from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import HTMLResponse, JSONResponse

router = APIRouter()

SITES = {
    "rootmc": "https://rootmc.net/blog/",
    "ava": "https://avaivy.cloud/blog",
    "rootrecord": "https://rootrecord.online/blog",
}


@router.get("/api/blog")
async def blog_index():
    """Pointer to public blogs + template pipeline (media is the archive)."""
    return {
        "ok": True,
        "blogs": SITES,
        "timeline": {
            "rootmc": "https://rootmc.net/timeline/",
            "ava": "https://avaivy.cloud/timeline",
            "rootrecord": "https://rootrecord.online/timeline",
        },
        "inbox": "media/documents/reports/inbox/",
        "templates": "media/documents/reports/templates/",
        "audio": "media/audio/reports/ and media/audio/current/",
        "member_context": "media/private/context/ (not public)",
        "compile": "python3 ava-core-v2/scripts/compile-blog-posts.py",
        "media_file": "https://avaivy.cloud/api/media/public/file?path=",
    }


@router.get("/api/blog/health")
async def blog_health():
    return JSONResponse({"ok": True})

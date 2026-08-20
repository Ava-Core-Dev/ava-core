"""Local operator desk — localhost only. No Cursor required."""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

from fastapi import APIRouter, File, Form, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from ..services import ollama as ollama_svc

router = APIRouter()

AVA = Path("/home/ava-core/ava")
CORE = AVA / "ava-core-v2"
POSTS = AVA / "media" / "documents" / "reports" / "posts"
MEDIA = AVA / "media"
OPS_HTML = Path(__file__).resolve().parents[1] / "static" / "ops.html"
SYNC = CORE / "scripts" / "sync-blogs.py"
PUBLISH = CORE / "scripts" / "publish-rootmc.sh"

KINDS = {
    "audio": MEDIA / "audio" / "reports",
    "images": MEDIA / "images" / "uploads",
    "documents": MEDIA / "documents" / "reports" / "inbox",
}


def _local(request: Request) -> bool:
    if request.headers.get("cf-ray") or request.headers.get("cf-connecting-ip"):
        return False
    host = request.client.host if request.client else ""
    return host in {"127.0.0.1", "::1"}


def _deny() -> JSONResponse:
    return JSONResponse(
        {"ok": False, "detail": "Open http://127.0.0.1:8787/ops on the Ava computer."},
        status_code=403,
    )


class BlogIn(BaseModel):
    brand: str
    title: str
    body: str
    teaser: str = ""
    category: str = "ops"
    date: str = ""
    published: str = ""


class RewriteIn(BaseModel):
    text: str = Field(min_length=1, max_length=20000)


def _slug(title: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    return (s[:60] or "post")


@router.get("/ops")
async def ops_page(request: Request):
    if not _local(request):
        return _deny()
    if not OPS_HTML.is_file():
        return JSONResponse({"ok": False, "detail": "ops.html missing"}, status_code=500)
    return FileResponse(OPS_HTML, media_type="text/html")


@router.post("/api/ops/blog")
async def ops_blog(body: BlogIn, request: Request):
    if not _local(request):
        return _deny()
    brand = body.brand.strip().lower()
    if brand not in {"ava", "rootmc", "rootrecord"}:
        return JSONResponse({"ok": False, "detail": "brand must be ava, rootmc, or rootrecord"}, status_code=400)
    from datetime import datetime
    from zoneinfo import ZoneInfo

    date = body.date.strip() or datetime.now(ZoneInfo("Pacific/Honolulu")).strftime("%Y-%m-%d")
    slug = _slug(body.title)
    folder = POSTS / brand
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{slug}.md"
    html = brand == "rootmc"
    lines = [
        "---",
        f"slug: {slug}",
        f"date: {date}",
    ]
    if body.published.strip():
        lines.append(f"published: {body.published.strip()}")
    lines += [
        f"title: {body.title.strip()}",
        f"teaser: {body.teaser.strip() or body.title.strip()}",
        f"brand: {'Ava' if brand == 'ava' else 'RootMC' if brand == 'rootmc' else 'Root Record'}",
        f"categories: {body.category.strip() or 'ops'}",
    ]
    if html:
        lines.append("html: true")
    lines += ["---", "", body.body.strip(), ""]
    path.write_text("\n".join(lines), encoding="utf-8")
    sync = _run_sync()
    return {"ok": True, "file": str(path), "slug": slug, "sync": sync}


@router.post("/api/ops/upload")
async def ops_upload(request: Request, kind: str = Form("audio"), file: UploadFile = File(...)):
    if not _local(request):
        return _deny()
    dest_dir = KINDS.get(kind, KINDS["documents"])
    dest_dir.mkdir(parents=True, exist_ok=True)
    name = Path(file.filename or "upload.bin").name
    dest = dest_dir / name
    dest.write_bytes(await file.read())
    rel = dest.relative_to(MEDIA).as_posix()
    return {
        "ok": True,
        "saved": str(dest),
        "media_path": rel,
        "url": f"https://avaivy.cloud/api/media/public/file?path={rel}",
    }


@router.post("/api/ops/rewrite")
async def ops_rewrite(body: RewriteIn, request: Request):
    if not _local(request):
        return _deny()
    text = ollama_svc.chat_sync(
        [
            {
                "role": "system",
                "content": "Rewrite clearly for a public blog. Do not invent dates, watts, or names. Keep facts. Short sentences.",
            },
            {"role": "user", "content": body.text},
        ],
        model="qwen3:8b",
        timeout=90,
    )
    if not text:
        return {"ok": False, "detail": "Local Ava (Ollama) is not answering. Is it running?"}
    return {"ok": True, "text": text.strip()}


@router.post("/api/ops/sync-blogs")
async def ops_sync(request: Request):
    if not _local(request):
        return _deny()
    return _run_sync()


@router.post("/api/ops/publish-rootmc")
async def ops_publish(request: Request):
    if not _local(request):
        return _deny()
    try:
        r = subprocess.run(
            ["bash", str(PUBLISH)],
            capture_output=True,
            text=True,
            timeout=180,
        )
        return {"ok": r.returncode == 0, "log": (r.stdout + "\n" + r.stderr)[-4000:]}
    except Exception as e:
        return {"ok": False, "detail": str(e)}


def _run_sync() -> dict:
    try:
        r = subprocess.run(
            [sys.executable, str(SYNC)],
            capture_output=True,
            text=True,
            timeout=120,
        )
        return {"ok": r.returncode == 0, "log": (r.stdout + "\n" + r.stderr)[-3000:]}
    except Exception as e:
        return {"ok": False, "detail": str(e)}

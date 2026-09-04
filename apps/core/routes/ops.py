"""Local operator desk — localhost only. No Cursor required."""
from __future__ import annotations

import asyncio
import platform
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import psutil
from fastapi import APIRouter, File, Form, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from .. import config
from ..services import ollama as ollama_svc

router = APIRouter()

AVA = config.AVA_HOME
CORE = Path(__file__).resolve().parents[3]
POSTS = AVA / "Media" / "documents" / "reports" / "posts"
MEDIA = AVA / "Media"
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
    return JSONResponse({"ok": False}, status_code=404)


class BlogIn(BaseModel):
    brand: str
    title: str
    body: str
    teaser: str = ""
    category: str = "ops"
    date: str = ""
    published: str = ""
    audio: list[str] = Field(default_factory=list)
    images: list[str] = Field(default_factory=list)


class RewriteIn(BaseModel):
    text: str = Field(min_length=1, max_length=20000)
    include_live: bool = True


HST = ZoneInfo("Pacific/Honolulu")
THINK_RE = re.compile(r"<think>.*?</think>", re.S | re.I)
WANTS_LIVE = re.compile(
    r"\b(scan|power|metric|ecoflow|solar|battery|watt|cpu|online|status|host)\b",
    re.I,
)


def _clean_ollama(text: str) -> str:
    return THINK_RE.sub("", text or "").strip()


async def _live_facts() -> str:
    now = datetime.now(HST).strftime("%Y-%m-%d %H:%M:%S HST")
    cpu = psutil.cpu_percent(interval=0.15)
    mem = psutil.virtual_memory()
    lines = [
        f"Clock now: {now} (year is {datetime.now(HST).year}, not 1947).",
        f"Ava core: online on {platform.node()}.",
        f"Host CPU {cpu:.0f}%. RAM {mem.percent:.0f}% used.",
    ]
    try:
        from apps.core.crons.since_last_fire.solar_weather import live_snapshot

        solar = await live_snapshot()
        batt = solar.get("battery_pct")
        pv = solar.get("solar_in_w") or solar.get("power_w")
        ebatt = solar.get("ebatt_in_w") or 0
        load = solar.get("load_w")
        src = solar.get("source") or "unknown"
        state = solar.get("state") or ""
        parts = [f"Power source: {src}"]
        if batt is not None:
            parts.append(f"battery {batt}%")
        try:
            ebatt_n = float(ebatt)
        except (TypeError, ValueError):
            ebatt_n = 0.0
        if ebatt_n >= 20:
            parts.append(f"E-Batt in {ebatt_n} W")
        elif pv is not None:
            parts.append(f"solar in {pv} W")
        if load is not None:
            parts.append(f"load {load} W")
        if state:
            parts.append(f"state {state}")
        lines.append("EcoFlow / solar: " + ", ".join(parts) + ".")
        devices = solar.get("devices") or []
        for d in devices[:6]:
            label = d.get("label") or d.get("sn") or "unit"
            soc = d.get("soc")
            online = "online" if d.get("online") else "offline"
            if d.get("input_kind") == "ebatt":
                extra = f", E-Batt {d.get('ebatt_w') or d.get('pv_w')} W"
            else:
                pv_w = d.get("pv_w")
                extra = f", PV {pv_w} W" if pv_w is not None else ""
            soc_s = f"{soc}%" if soc is not None else "n/a"
            lines.append(f"  - {label}: {online}, SOC {soc_s}{extra}")
    except Exception as e:
        lines.append(f"Solar snapshot unavailable: {e}")
    return "\n".join(lines)


def _slug(title: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    return (s[:60] or "post")


@router.get("/ops")
async def ops_page(request: Request):
    if not _local(request):
        return _deny()
    if not OPS_HTML.is_file():
        return JSONResponse({"ok": False, "detail": "ops.html missing"}, status_code=500)
    return FileResponse(
        OPS_HTML,
        media_type="text/html",
        headers={"Cache-Control": "no-store"},
    )


@router.get("/api/ops/ollama")
async def ops_ollama(request: Request):
    if not _local(request):
        return _deny()
    t0 = time.monotonic()
    up, models = await ollama_svc.tags(force=True)
    return {
        "ok": up,
        "working": up,
        "url": "http://127.0.0.1:11434",
        "models": models,
        "rewrite_model": config.OLLAMA_MODEL,
        "ms": int((time.monotonic() - t0) * 1000),
        "hint": "Local Ava is answering." if up else "Ollama is down. Start it, then refresh.",
    }


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
    audio_paths = []
    for raw in body.audio or []:
        rel = str(raw or "").strip().lstrip("/")
        if rel and rel not in audio_paths:
            audio_paths.append(rel)
    if audio_paths:
        lines.append("audio:")
        for rel in audio_paths:
            lines.append(f"  - {rel}")
    lines += ["---", ""]
    body_text = body.body.strip()
    image_paths = []
    for raw in body.images or []:
        rel = str(raw or "").strip().lstrip("/")
        if rel and rel not in image_paths:
            image_paths.append(rel)
    if image_paths:
        extras = []
        for rel in image_paths:
            url = f"https://avaivy.cloud/api/media/public/file?path={rel}"
            name = Path(rel).name
            if html:
                extras.append(f'<p><img src="{url}" alt="{name}" loading="lazy"/></p>')
            else:
                extras.append(f"![{name}]({url})")
        body_text = (body_text + ("\n\n" if body_text else "") + "\n\n".join(extras)).strip()
    lines += [body_text, ""]
    path.write_text("\n".join(lines), encoding="utf-8")
    sync = _run_sync()
    return {"ok": True, "file": str(path), "slug": slug, "sync": sync, "audio": audio_paths, "images": image_paths}


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
    up, models = await ollama_svc.tags(force=True)
    if not up:
        return {
            "ok": False,
            "working": False,
            "detail": "Ollama is not running. Local Ava cannot rewrite until it is up.",
        }
    want_live = body.include_live or bool(WANTS_LIVE.search(body.text or ""))
    facts = await _live_facts() if want_live else ""
    system = (
        "You rewrite operator notes for Ava Ivy, the Root Server on the Big Island of Hawaiʻi.\n"
        "Current calendar year is 2026.\n"
        "A 3- or 4-digit number next to a date (1947, 0730, 19:47) is a CLOCK TIME, never a year. "
        "1947 on Aug 19 means 19:47 HST on 19 Aug 2026.\n"
        "Spellings: avay/ava = Ava. Do not invent watts, percents, or host names.\n"
        "If LIVE FACTS are provided, you MUST include those exact numbers in the rewrite. "
        "That is the scan. Do not say you scanned unless those numbers appear.\n"
        "Write a short public-ready note. Short sentences."
    )
    user = body.text
    if facts:
        user = f"OPERATOR DRAFT:\n{body.text}\n\nLIVE FACTS (use these numbers):\n{facts}"
    t0 = time.monotonic()
    raw = await asyncio.to_thread(
        ollama_svc.chat_sync,
        [{"role": "system", "content": system}, {"role": "user", "content": user}],
        model=config.OLLAMA_MODEL,
        timeout=120,
    )
    ms = int((time.monotonic() - t0) * 1000)
    text = _clean_ollama(raw or "")
    if not text:
        return {
            "ok": False,
            "working": True,
            "model": config.OLLAMA_MODEL,
            "ms": ms,
            "models": models,
            "detail": "Ollama answered empty. Try again.",
        }
    return {
        "ok": True,
        "working": True,
        "text": text,
        "model": config.OLLAMA_MODEL,
        "ms": ms,
        "models": models,
        "facts_included": bool(facts),
        "facts": facts,
    }


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


@router.get("/api/ops/sites-posts")
async def ops_sites_posts(request: Request):
    """Latest posts per site for the desktop Sites tab."""
    if not _local(request):
        return _deny()
    out = []
    for brand in ("ava", "rootrecord", "rootmc"):
        root = POSTS / brand
        latest = None
        if root.is_dir():
            for path in sorted(root.glob("*.md"), key=lambda p: p.stat().st_mtime, reverse=True)[:1]:
                latest = {"slug": path.stem, "mtime": path.stat().st_mtime, "path": str(path)}
        out.append({"brand": brand, "latest": latest})
    from apps.core.services.obs_desk_data import latest_blog_across_sites

    return {"ok": True, "sites": out, "newest": latest_blog_across_sites()}


class FanoutBlogIn(BlogIn):
    brands: list[str] = Field(default_factory=lambda: ["ava", "rootrecord", "rootmc"])


class PythonDropToggleIn(BaseModel):
    name: str
    enabled: bool | None = None
    autostart: bool | None = None
    restart_on_exit: bool | None = None


@router.post("/api/ops/sites-fanout")
async def ops_sites_fanout(body: FanoutBlogIn, request: Request):
    """Save the same post to multiple site trees, then sync."""
    if not _local(request):
        return _deny()
    saved = []
    for brand in body.brands:
        sub = BlogIn(
            brand=brand,
            title=body.title,
            body=body.body,
            teaser=body.teaser,
            category=body.category,
            date=body.date,
            published=body.published,
            audio=list(body.audio or []),
            images=list(body.images or []),
        )
        resp = await ops_blog(sub, request)
        ok = resp.get("ok") if isinstance(resp, dict) else getattr(resp, "status_code", 500) == 200
        saved.append({"brand": brand, "ok": bool(ok)})
    sync = _run_sync()
    return {"ok": True, "saved": saved, "sync": sync}


@router.get("/api/ops/goal-drafts")
async def ops_goal_drafts_get(request: Request):
    if not _local(request):
        return _deny()
    from apps.core.services.goal_drafts import load_drafts

    return {"ok": True, **load_drafts()}


@router.post("/api/ops/goal-drafts/generate")
async def ops_goal_drafts_generate(request: Request):
    if not _local(request):
        return _deny()
    from apps.core.services.goal_drafts import generate_drafts

    return await generate_drafts()


@router.post("/api/ops/goal-drafts/approve")
async def ops_goal_drafts_approve(request: Request, index: int = 0):
    if not _local(request):
        return _deny()
    from apps.core.services.goal_drafts import approve_draft

    return approve_draft(index)


@router.get("/api/ops/python-drop/status")
async def ops_python_drop_status(request: Request):
    if not _local(request):
        return _deny()
    from apps.core.services.python_drop_runner import get_runner

    return get_runner().status()


@router.post("/api/ops/python-drop/rescan")
async def ops_python_drop_rescan(request: Request):
    if not _local(request):
        return _deny()
    from apps.core.services.python_drop_runner import get_runner

    return {"ok": True, **get_runner().rescan()}


@router.post("/api/ops/python-drop/toggle")
async def ops_python_drop_toggle(body: PythonDropToggleIn, request: Request):
    if not _local(request):
        return _deny()
    from apps.core.services.python_drop_runner import get_runner

    return get_runner().update_script(
        body.name,
        enabled=body.enabled,
        autostart=body.autostart,
        restart_on_exit=body.restart_on_exit,
    )


# --- GitHub auto-push (Emergent safety switch) ---

_AUTO_PUSH_TOGGLE = CORE / "scripts" / "github-auto-push-toggle.sh"


@router.get("/api/ops/github-auto-push")
async def ops_github_auto_push_status(request: Request):
    if not _local(request):
        return _deny()
    r = subprocess.run(
        ["bash", str(_AUTO_PUSH_TOGGLE), "status"],
        capture_output=True,
        text=True,
        timeout=20,
    )
    flag = Path.home() / ".local/state/ava/github-auto-push.off"
    active = subprocess.run(
        ["systemctl", "--user", "is-active", "ava-auto-push.timer"],
        capture_output=True,
        text=True,
    ).stdout.strip()
    enabled = not flag.is_file()
    return {
        "ok": r.returncode == 0,
        "enabled": enabled,
        "timer": active,
        "flag_path": str(flag),
        "detail": (r.stdout or r.stderr or "").strip(),
    }


class GithubAutoPushIn(BaseModel):
    enabled: bool | None = None
    action: str = ""  # on | off | toggle


@router.post("/api/ops/github-auto-push")
async def ops_github_auto_push_set(body: GithubAutoPushIn, request: Request):
    if not _local(request):
        return _deny()
    action = (body.action or "").strip().lower()
    if not action:
        if body.enabled is True:
            action = "on"
        elif body.enabled is False:
            action = "off"
        else:
            action = "toggle"
    if action not in {"on", "off", "toggle", "status"}:
        return JSONResponse({"ok": False, "detail": "action must be on|off|toggle"}, status_code=400)
    r = subprocess.run(
        ["bash", str(_AUTO_PUSH_TOGGLE), action],
        capture_output=True,
        text=True,
        timeout=30,
    )
    flag = Path.home() / ".local/state/ava/github-auto-push.off"
    return {
        "ok": r.returncode == 0,
        "enabled": not flag.is_file(),
        "detail": (r.stdout or r.stderr or "").strip(),
    }


# --- Google AdSense OAuth (local) ---


@router.get("/api/ops/adsense/status")
async def ops_adsense_status(request: Request):
    if not _local(request):
        return _deny()
    from apps.core.services import adsense

    st = adsense.status()
    if st.get("client_configured"):
        st["auth_url"] = adsense.auth_url()
    return st


@router.get("/api/ops/adsense/oauth/callback")
async def ops_adsense_oauth_callback(
    request: Request, code: str = "", error: str = "", state: str = ""
):
    """Public HTTPS callback via ava-origin tunnel. Always exchanges with public redirect_uri."""
    from fastapi.responses import HTMLResponse

    from apps.core.services import adsense

    redirect_used = adsense.REDIRECT

    if error:
        return HTMLResponse(
            f"<h1>AdSense OAuth failed</h1><pre>{error}</pre>",
            status_code=400,
        )
    if not code:
        return HTMLResponse("<h1>AdSense OAuth</h1><p>missing code</p>", status_code=400)
    try:
        result = adsense.exchange_code(code, redirect_uri=redirect_used)
        return HTMLResponse(
            "<html><body style='font-family:system-ui;background:#0a0e14;color:#e5e7eb;"
            "padding:2rem'>"
            "<h1>AdSense connected</h1>"
            "<p>Token saved on the Ava desk. Close this tab and open "
            "<a href='/ops' style='color:#22d3ee'>/ops</a> on the desk machine "
            "→ List accounts.</p>"
            f"<pre>{result}</pre></body></html>"
        )
    except Exception as e:
        return HTMLResponse(
            f"<h1>AdSense OAuth exchange failed</h1><pre>{e}</pre>"
            f"<p>redirect_uri used: {redirect_used}</p>"
            "<p>In Google Cloud Console, Authorized redirect URIs must include that exact "
            "public HTTPS URL (never localhost / example.com).</p>",
            status_code=500,
        )



@router.get("/api/ops/adsense/accounts")
async def ops_adsense_accounts(request: Request):
    if not _local(request):
        return _deny()
    from apps.core.services import adsense

    try:
        return adsense.accounts_summary()
    except Exception as e:
        return JSONResponse({"ok": False, "detail": str(e)}, status_code=500)


@router.post("/api/ops/adsense/report")
async def ops_adsense_report(request: Request, kind: str = "manual"):
    """Run AdSense snapshot now (manual / boot / eod). Local ops only."""
    if not _local(request):
        return _deny()
    from apps.core.crons import adsense_report

    k = (kind or "manual").strip().lower()
    if k not in {"manual", "boot", "eod"}:
        k = "manual"
    return await adsense_report.run(k, force=True)


# --- Google AdMob OAuth (local + public callback) ---


@router.get("/api/ops/admob/status")
async def ops_admob_status(request: Request):
    if not _local(request):
        return _deny()
    from apps.core.services import admob

    st = admob.status()
    if st.get("client_configured"):
        st["auth_url"] = admob.auth_url()
    return st


@router.get("/api/ops/admob/oauth/callback")
async def ops_admob_oauth_callback(
    request: Request, code: str = "", error: str = "", state: str = ""
):
    from fastapi.responses import HTMLResponse

    from apps.core.services import admob

    redirect_used = admob.REDIRECT

    if error:
        return HTMLResponse(f"<h1>AdMob OAuth failed</h1><pre>{error}</pre>", status_code=400)
    if not code:
        return HTMLResponse("<h1>AdMob OAuth</h1><p>missing code</p>", status_code=400)
    try:
        result = admob.exchange_code(code, redirect_uri=redirect_used)
        return HTMLResponse(
            "<html><body style='font-family:system-ui;background:#0a0e14;color:#e5e7eb;padding:2rem'>"
            "<h1>AdMob connected</h1>"
            "<p>Token saved on the Ava desk. Open "
            "<a href='/ops' style='color:#22d3ee'>/ops</a> on the desk "
            "→ List AdMob accounts / Run AdMob report.</p>"
            f"<pre>{result}</pre></body></html>"
        )
    except Exception as e:
        return HTMLResponse(
            f"<h1>AdMob OAuth exchange failed</h1><pre>{e}</pre>"
            f"<p>redirect_uri used: {redirect_used}</p>"
            "<p>Authorized redirect URI must be the public HTTPS URL (never localhost).</p>",
            status_code=500,
        )



@router.get("/api/ops/admob/accounts")
async def ops_admob_accounts(request: Request):
    if not _local(request):
        return _deny()
    from apps.core.services import admob

    try:
        return admob.accounts_summary()
    except Exception as e:
        return JSONResponse({"ok": False, "detail": str(e)}, status_code=500)


@router.post("/api/ops/admob/report")
async def ops_admob_report(request: Request, kind: str = "manual"):
    if not _local(request):
        return _deny()
    from apps.core.crons import admob_report

    k = (kind or "manual").strip().lower()
    if k not in {"manual", "boot", "eod"}:
        k = "manual"
    return await admob_report.run(k, force=True)


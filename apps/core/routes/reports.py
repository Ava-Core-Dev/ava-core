"""Public report subscriptions + operator current-report submit."""
from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from ..services import reports, subscribers

router = APIRouter(prefix="/api/reports")


class SubscriberIn(BaseModel):
    surface: str
    id: str
    label: str = ""


class PublishIn(BaseModel):
    kind: str = Field(default="summary")
    text: str
    channel: str | None = None


class ManualIn(BaseModel):
    text: str = Field(min_length=1, max_length=20000)
    kind: str = Field(default="summary")
    post: bool = True


class QueuePublishIn(BaseModel):
    channel: str | None = None


def _allow_mutate(request: Request) -> bool:
    # Cloudflare tunnel injects cf-ray; never accept mutations from the public origin.
    if request.headers.get("cf-ray") or request.headers.get("cf-connecting-ip"):
        return False
    host = request.client.host if request.client else ""
    return host in {"127.0.0.1", "::1"}


@router.get("")
@router.get("/")
async def reports_board():
    """Desktop Reports page: current file, due jobs, generated markdown."""
    return reports.status_board()


@router.get("/day-board")
async def day_board_status():
    from apps.core.services import day_board

    return {"ok": True, "catalog": day_board.catalog(), "remaining": day_board.remaining()}


@router.get("/current")
async def current_report():
    return reports.read_current()


@router.get("/subscribers")
async def list_subscribers():
    rows = subscribers.list_all()
    return {"ok": True, "count": len(rows), "subscribers": rows}


@router.post("/subscribers")
async def add_subscriber(body: SubscriberIn):
    return subscribers.add(body.surface, body.id, label=body.label)


@router.delete("/subscribers/{surface}/{sid}")
async def remove_subscriber(surface: str, sid: str):
    return subscribers.remove(surface, sid)


@router.post("/publish")
async def publish_report(body: PublishIn):
    """Send a public report to the channel + subscribers. Rejects non-public kinds."""
    return await reports.publish(body.kind, body.text, channel=body.channel)


@router.post("/manual")
async def manual_report(body: ManualIn, request: Request):
    """Paste a written daily report. Updates morning-report-current.md. No Grok/Cursor."""
    if not _allow_mutate(request):
        return JSONResponse({"ok": False, "detail": "local_only"}, status_code=403)
    return await reports.submit_manual(body.text, kind=body.kind, post=body.post)


@router.get("/queue")
async def queue_list():
    return reports.list_queue()


@router.post("/queue/{name}/publish")
async def queue_publish(name: str, request: Request, body: QueuePublishIn | None = None):
    if not _allow_mutate(request):
        return JSONResponse({"ok": False, "detail": "local_only"}, status_code=403)
    channel = body.channel if body else None
    return await reports.publish_queued(name, channel=channel)


@router.post("/test")
async def test_report_dm():
    """One-line test to current subscribers only (no #development)."""
    return await reports.publish(
        "summary",
        "Test ping — you are subscribed to Ava's public reports. "
        "This is not a development message.",
        channel=None,
    )


class ReportGenPatchIn(BaseModel):
    """Partial update for data/state/report-generation.json."""

    reports: dict | None = None
    types: dict | None = None  # alias → reports
    week_of_grok: bool | None = None
    context_urls: list[str] | None = None
    fetch_urls: list[str] | None = None
    week_note: str | None = None


class ReportGenRunIn(BaseModel):
    kind: str = Field(default="midday")
    dry_run: bool = True
    allow_tts: bool = False
    publish: bool | None = None
    force_engine: str | None = None
    force_mp3: str | None = None
    offline: bool = False
    play: bool = False


@router.get("/due")
@router.get("/due-board")
async def daily_reports_due_board():
    """HST day due ledger for morning/midday/evening/late."""
    from apps.core.services import daily_report_board

    return daily_report_board.status()


@router.post("/due/catchup")
async def daily_reports_catchup_now(request: Request):
    """Run oldest mandatory due/failed (never late). Local only."""
    if not _allow_mutate(request):
        return JSONResponse({"ok": False, "detail": "local_only"}, status_code=403)
    from apps.core.services import daily_report_board

    daily_report_board.ensure_today()
    daily_report_board.mark_due()
    return await daily_report_board.run_due(play=True, allow_tts=True)


@router.get("/generation")
async def report_generation_status():
    from apps.core.services import report_generation

    return report_generation.status()


@router.patch("/generation")
async def report_generation_patch(body: ReportGenPatchIn, request: Request):
    if not _allow_mutate(request):
        return JSONResponse({"ok": False, "detail": "local_only"}, status_code=403)
    from apps.core.services import report_generation

    patch: dict = {}
    if body.reports is not None:
        patch["reports"] = body.reports
    elif body.types is not None:
        # Map older types schema (auto_blog/brands) → reports (blog/blog_brands).
        mapped = {}
        for kind, row in body.types.items():
            if not isinstance(row, dict):
                continue
            m = dict(row)
            if "auto_blog" in m and "blog" not in m:
                m["blog"] = m.pop("auto_blog")
            if "brands" in m and "blog_brands" not in m:
                m["blog_brands"] = m.pop("brands")
            # Legacy grok → cloud for engine/mp3.
            if "engine" in m:
                from apps.core.services.report_generation import normalize_engine

                m["engine"] = normalize_engine(m["engine"])
            if "mp3" in m:
                from apps.core.services.report_generation import normalize_mp3

                m["mp3"] = normalize_mp3(m["mp3"])
            mapped[kind] = m
        patch["reports"] = mapped
    if body.week_of_grok is not None:
        patch["week_of_grok"] = body.week_of_grok
    if body.context_urls is not None:
        patch["context_urls"] = body.context_urls
    if body.fetch_urls is not None:
        patch["fetch_urls"] = body.fetch_urls
    if body.week_note is not None:
        patch["week_note"] = body.week_note
    return {"ok": True, "config": report_generation.patch(patch)}


@router.post("/generation/run")
async def report_generation_run(body: ReportGenRunIn, request: Request):
    """Dry-run (default) or live generate. TTS off unless allow_tts and toggle/spend allow."""
    if not _allow_mutate(request):
        return JSONResponse({"ok": False, "detail": "local_only"}, status_code=403)
    from apps.core.services import report_generation, voice_events

    out = report_generation.generate(
        body.kind,
        dry_run=bool(body.dry_run),
        force_engine=body.force_engine,
        force_mp3=body.force_mp3,
        allow_tts=bool(body.allow_tts),
        publish=body.publish,
        offline=bool(body.offline),
        update_board=not bool(body.dry_run),
    )
    tts = (out or {}).get("tts") or {}
    if not body.dry_run and (body.play or tts.get("ok")):
        out["play"] = await voice_events.play_report_mp3(
            tts.get("current"),
            tts.get("mp3"),
            name="status",
            kind=str(body.kind or "report"),
        )
    return out


class ReportPlayIn(BaseModel):
    kind: str = Field(default="midday")
    mp3: str | None = None


@router.post("/generation/play-mp3")
async def report_generation_play_mp3(body: ReportPlayIn, request: Request):
    """Queue an existing report MP3 on the desk (REPORT). No TTS spend."""
    if not _allow_mutate(request):
        return JSONResponse({"ok": False, "detail": "local_only"}, status_code=403)
    from apps.core import config
    from apps.core.services import voice_events

    kind = (body.kind or "midday").strip().lower()
    return await voice_events.play_report_mp3(
        body.mp3,
        config.GENERATED_DIR / f"{kind}-report-current.wav",
        config.GENERATED_DIR / f"{kind}-report-current.mp3",
        name="status",
        kind=kind,
    )


class ManualAudioSetIn(BaseModel):
    kind: str = Field(default="morning")
    path: str | None = None
    auto_play: bool | None = None
    label: str | None = None
    clear: bool = False


class ManualAudioPlayIn(BaseModel):
    kind: str = Field(default="morning")
    path: str | None = None


@router.get("/audio-manual")
async def report_audio_manual_status():
    """Operator picks morning/midday/evening MP3s for scheduled play (no TTS)."""
    from apps.core.services import report_audio_manual

    return report_audio_manual.status()


@router.post("/audio-manual")
async def report_audio_manual_set(body: ManualAudioSetIn, request: Request):
    if not _allow_mutate(request):
        return JSONResponse({"ok": False, "detail": "local_only"}, status_code=403)
    from apps.core.services import report_audio_manual

    return report_audio_manual.set_slot(
        body.kind,
        path=body.path,
        auto_play=body.auto_play,
        label=body.label,
        clear=bool(body.clear),
    )


@router.post("/audio-manual/play")
async def report_audio_manual_play(body: ManualAudioPlayIn, request: Request):
    """Play selected (or override) manual report MP3 now. No TTS spend."""
    if not _allow_mutate(request):
        return JSONResponse({"ok": False, "detail": "local_only"}, status_code=403)
    from apps.core.services import report_audio_manual

    return await report_audio_manual.play_now(body.kind, path=body.path)

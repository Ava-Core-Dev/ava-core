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
    week_of_grok: bool | None = None
    context_urls: list[str] | None = None
    fetch_urls: list[str] | None = None


class ReportGenRunIn(BaseModel):
    kind: str = Field(default="midday")
    dry_run: bool = True
    allow_tts: bool = False
    publish: bool | None = None
    force_engine: str | None = None


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
    if body.week_of_grok is not None:
        patch["week_of_grok"] = body.week_of_grok
    if body.context_urls is not None:
        patch["context_urls"] = body.context_urls
    if body.fetch_urls is not None:
        patch["fetch_urls"] = body.fetch_urls
    return {"ok": True, "config": report_generation.patch(patch)}


@router.post("/generation/run")
async def report_generation_run(body: ReportGenRunIn, request: Request):
    """Dry-run (default) or live generate. TTS off unless allow_tts and toggle/spend allow."""
    if not _allow_mutate(request):
        return JSONResponse({"ok": False, "detail": "local_only"}, status_code=403)
    from apps.core.services import report_generation

    return report_generation.generate(
        body.kind,
        dry_run=bool(body.dry_run),
        force_engine=body.force_engine,
        allow_tts=bool(body.allow_tts),
        publish=body.publish,
    )

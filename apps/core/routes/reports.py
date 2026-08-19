"""Public report subscriptions — not the operator/dev feed."""
from __future__ import annotations

from fastapi import APIRouter
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


@router.post("/test")
async def test_report_dm():
    """One-line test to current subscribers only (no #development)."""
    return await reports.publish(
        "summary",
        "Test ping — you are subscribed to Ava's public reports. "
        "This is not a development message.",
        channel=None,
    )

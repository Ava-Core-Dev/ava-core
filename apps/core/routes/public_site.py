"""Visitor pages on the public host: Kīlauea, weather, RootMC."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

router = APIRouter()
_HTML = Path(__file__).resolve().parent.parent / "templates" / "public-site.html"


def _page() -> HTMLResponse:
    text = _HTML.read_text(encoding="utf-8") if _HTML.is_file() else "<p>page missing</p>"
    return HTMLResponse(text, headers={"Cache-Control": "no-store"})


@router.get("/kilauea")
@router.get("/kilauea/")
@router.get("/weather")
@router.get("/weather/")
@router.get("/rootmc")
@router.get("/rootmc/")
async def public_page():
    return _page()

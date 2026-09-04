"""Public visitor feedback. Origin-up stores locally. Origin-dark uses the Worker inbox."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Form, Request
from fastapi.responses import HTMLResponse, JSONResponse

router = APIRouter()
_HTML = Path(__file__).resolve().parent.parent / "templates" / "feedback.html"


@router.get("/feedback")
@router.get("/feedback/")
async def feedback_page():
    text = _HTML.read_text(encoding="utf-8") if _HTML.is_file() else "<p>Feedback page missing.</p>"
    return HTMLResponse(text, headers={"Cache-Control": "no-store"})


def _payload_from(body: dict) -> dict:
    return {
        "type": body.get("type") or body.get("kind") or "general",
        "message": body.get("message") or body.get("content") or "",
        "reply_email": body.get("reply_email") or body.get("email"),
        "name": body.get("name") or body.get("author_name"),
        "surface": body.get("surface") or body.get("app_id") or "web",
        "app_id": body.get("app_id"),
        "include_diagnostics": body.get("include_diagnostics"),
    }


@router.post("/feedback")
@router.post("/api/feedback")
async def feedback_post(request: Request):
    from apps.core.services import feedback_store

    ctype = (request.headers.get("content-type") or "").lower()
    body: dict = {}
    if "application/json" in ctype:
        try:
            raw = await request.json()
            if isinstance(raw, dict):
                body = raw
        except Exception:
            body = {}
    else:
        form = await request.form()
        body = {k: form.get(k) for k in form.keys()}
    try:
        stored = feedback_store.store(_payload_from(body))
    except ValueError as e:
        return JSONResponse({"ok": False, "detail": str(e)}, status_code=400)
    except Exception as e:
        return JSONResponse({"ok": False, "detail": str(e)[:200]}, status_code=500)
    return {"ok": True, **stored}

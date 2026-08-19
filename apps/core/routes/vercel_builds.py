"""Vercel deploy webhook — same ingest as the poller cron."""

from __future__ import annotations

import hashlib
import hmac
import logging

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from .. import config
from ..services import vercel_builds

router = APIRouter()
log = logging.getLogger("ava.vercel_webhook")


def _valid_signature(raw: bytes, header: str, secret: str) -> bool:
    if not secret or not header:
        return False
    digest = hmac.new(secret.encode("utf-8"), raw, hashlib.sha1).hexdigest()
    return hmac.compare_digest(digest, header.strip())


@router.post("/api/webhooks/vercel")
async def vercel_webhook(request: Request):
    raw = await request.body()
    secret = config.vercel_webhook_secret()
    sig = request.headers.get("x-vercel-signature") or request.headers.get("X-Vercel-Signature") or ""
    if secret and not _valid_signature(raw, sig, secret):
        return JSONResponse({"ok": False, "detail": "bad_signature"}, status_code=401)

    try:
        payload = await request.json()
    except Exception:
        return JSONResponse({"ok": False, "detail": "invalid_json"}, status_code=400)

    body = payload if isinstance(payload, dict) else {}
    event = str(body.get("type") or body.get("event") or "")
    dep = body.get("payload") if isinstance(body.get("payload"), dict) else body
    if isinstance(dep.get("deployment"), dict):
        dep = dep["deployment"]

    ready = str(dep.get("readyState") or "").upper()
    if event.endswith("succeeded") or event.endswith(".ready"):
        dep["readyState"] = "READY"
    elif event.endswith("error") or event.endswith("failed") or ready == "ERROR":
        dep["readyState"] = "ERROR"
    elif not ready:
        return {"ok": True, "action": "ignored", "event": event}

    action = await vercel_builds.ingest_deployment(dep)
    vercel_builds.prune_expired()
    return {"ok": True, "action": action, "event": event}

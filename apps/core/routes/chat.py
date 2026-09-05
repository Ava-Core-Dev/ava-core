"""Public Ava chat — every turn goes to local llama3.2 with live facts."""

from __future__ import annotations

import asyncio
import logging
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .. import config
from ..services import guests as guests_svc
from ..services import ollama as ollama_svc
from ..services import persona as persona_svc

router = APIRouter(prefix="/api")
log = logging.getLogger("ava.chat")

FREE_LIVE_PER_IP = guests_svc.FREE_LIVE
LOGGED_IN_LIVE = guests_svc.MEMBER_LIVE
_SURFACES = frozenset({"public", "rootmc", "kilauea"})
LOGIN_URL = "https://rootrecord.cloud/account"
MEMBERSHIP_REPLY = (
    "You've used your three free talks for today. "
    "Sign in at rootrecord.cloud/account to keep going."
)
MEMBER_CAP_REPLY = (
    "You've hit today's signed-in talk cap on this desk. "
    "Come back tomorrow, or use Status and Solar meanwhile."
)


def _db() -> Path:
    path = config.DATA_DIR / "db" / "chat-usage.sqlite"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _day() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _bump(key: str) -> int:
    path = _db()
    con = sqlite3.connect(str(path))
    try:
        con.execute(
            "CREATE TABLE IF NOT EXISTS chat_usage (day TEXT, key TEXT, n INTEGER, PRIMARY KEY (day, key))"
        )
        con.execute(
            "INSERT INTO chat_usage(day, key, n) VALUES (?, ?, 1) "
            "ON CONFLICT(day, key) DO UPDATE SET n = n + 1",
            (_day(), key),
        )
        n = con.execute(
            "SELECT n FROM chat_usage WHERE day=? AND key=?", (_day(), key)
        ).fetchone()[0]
        con.commit()
        return int(n)
    finally:
        con.close()


def _client_ip(request: Request) -> str:
    # Worker sets x-ava-client-ip; CF may rewrite cf-connecting-ip on the tunnel hop.
    ava = (request.headers.get("x-ava-client-ip") or "").strip()
    if ava:
        return ava
    cf = (request.headers.get("cf-connecting-ip") or "").strip()
    if cf:
        return cf
    xff = request.headers.get("x-forwarded-for") or ""
    return (xff.split(",")[0].strip() if xff else request.client.host if request.client else "unknown")


_PORTAL_ME = "https://rootrecord-api-account.rootrecord.workers.dev/api/auth/me"
_token_cache: dict[str, tuple[float, bool]] = {}
_TOKEN_TTL_S = 300.0
_TOKEN_FAIL_TTL_S = 30.0  # brief negative / soft-fail cache


def _portal_token_ok(token: str) -> bool:
    """Validate Root Record portal Bearer against account worker. Cached briefly.

    Runs synchronously — call only from a worker thread (see _has_session).
    Network blips must not flip a signed-in visitor back to the guest wall:
    unknown errors keep the last cached verdict, or accept a long-looking token.
    """
    import time
    from urllib.error import HTTPError
    from urllib.parse import unquote

    tok = unquote((token or "").strip())
    if len(tok) < 16:
        return False
    now = time.monotonic()
    hit = _token_cache.get(tok)
    if hit and now < hit[0]:
        return hit[1]
    ok: bool | None = None
    try:
        import urllib.request

        req = urllib.request.Request(
            _PORTAL_ME,
            headers={
                "Authorization": f"Bearer {tok}",
                "User-Agent": "AvaIvy-origin-chat/1.0",
            },
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=2.5) as resp:
            ok = 200 <= int(resp.status) < 300
    except HTTPError as e:
        # 401/403 = not signed in. Anything else = treat as soft fail.
        if int(getattr(e, "code", 0) or 0) in (401, 403):
            ok = False
        else:
            ok = None
    except Exception:
        ok = None

    if ok is None:
        if hit is not None:
            ok = hit[1]
        else:
            # Soft fail: AuthBar already proved the token in-browser; don't wall.
            ok = len(tok) >= 24
        _token_cache[tok] = (now + _TOKEN_FAIL_TTL_S, ok)
    else:
        _token_cache[tok] = (now + _TOKEN_TTL_S, ok)
    if len(_token_cache) > 500:
        for k in list(_token_cache.keys())[:100]:
            _token_cache.pop(k, None)
    return ok


async def _has_session(request: Request) -> bool:
    """True when the visitor is a signed-in Root Record account for chat caps.

    AuthBar stores the portal token in localStorage and an ava_session cookie.
    ChatWidget sends Authorization: Bearer. Validation hits the account worker
    off the event loop so a slow /me cannot freeze public chat.
    """
    from urllib.parse import unquote

    if (request.headers.get("x-ava-session") or "").strip():
        return True
    auth = (request.headers.get("authorization") or "").strip()
    if auth.lower().startswith("bearer "):
        tok = auth[7:].strip()
        if await asyncio.to_thread(_portal_token_ok, tok):
            return True
    for name in ("ava_session", "rr_web_session"):
        raw = unquote((request.cookies.get(name) or "").strip())
        if not raw:
            continue
        if await asyncio.to_thread(_portal_token_ok, raw):
            return True
        # Legacy rr_web_session (non-portal) still counts as signed in.
        if name == "rr_web_session" and len(raw) >= 8:
            return True
    return False

class ChatRequest(BaseModel):
    message: str
    context: str = ""
    surface: str = "public"
    max_tokens: int = 512
    history: list[dict] = []
    session_id: str = ""


def _web_sid(req: ChatRequest, request: Request) -> tuple[str, bool]:
    import re
    import uuid

    sid = str(req.session_id or request.cookies.get("ava_web_sid") or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_-]{8,64}", sid):
        sid = ""
    created = False
    if not sid:
        sid = uuid.uuid4().hex
        created = True
    return sid, created


def _chat_response(payload: dict, *, sid: str = "", set_sid: bool = False) -> JSONResponse:
    resp = JSONResponse(payload)
    if set_sid and sid:
        resp.set_cookie(
            "ava_web_sid",
            sid,
            max_age=60 * 60 * 24 * 400,
            httponly=True,
            samesite="lax",
            path="/",
        )
    return resp


def _count_generation(ip: str, guest_hash: str, member: bool) -> None:
    try:
        _bump("ip:" + (guest_hash or ip))
        if not guests_svc.is_local(ip):
            guests_svc.bump(ip, member=member)
    except Exception:
        pass


@router.get("/auth/session")
async def api_session(request: Request):
    member = await _has_session(request)
    ip = _client_ip(request)
    remaining = None
    if not guests_svc.is_local(ip):
        info = guests_svc.touch(ip, member=member)
        remaining = info.get("remaining")
    return {
        "loggedIn": member,
        "free": {
            "liveUsesPerIp": FREE_LIVE_PER_IP,
            "genericUnlimited": False,
            "resources": FREE_LIVE_PER_IP,
            "remaining": remaining,
        },
        "login": LOGIN_URL,
    }


@router.post("/chat")
async def api_chat(req: ChatRequest, request: Request):
    raw = (req.message or "").strip()
    if not raw:
        return {
            "reply": "I'm Ava Ivy. Ask about the host, weather, packs, Kīlauea, or RootMC.",
            "brain": "canned",
            "topic": "greet",
        }

    ip = _client_ip(request)
    member = await _has_session(request)
    sid, set_sid = _web_sid(req, request)
    surface = req.surface if req.surface in _SURFACES else "public"
    guest_hash = ""

    if not guests_svc.is_local(ip):
        info = guests_svc.touch(ip, sid=sid, member=member)
        guest_hash = str(info.get("ip_hash") or "")
        if info.get("new_guest"):
            try:
                from apps.core.services import voice_events

                await voice_events.announce("phrase_new_guest", cooldown_s=60)
            except Exception:
                pass
        gate = guests_svc.live_allowed(ip, member=member)
        if not gate.get("allowed"):
            if not info.get("wall_said"):
                try:
                    from apps.core.services import voice_events

                    await voice_events.announce("phrase_guest_limit", cooldown_s=120)
                    guests_svc.mark_wall_said(ip)
                except Exception:
                    pass
            return _chat_response(
                {
                    "reply": MEMBER_CAP_REPLY if member else MEMBERSHIP_REPLY,
                    "brain": "limit",
                    "surface": surface,
                    "login": LOGIN_URL,
                    "remaining": 0,
                    "member": member,
                },
                sid=sid,
                set_sid=set_sid,
            )

    try:
        from apps.core.services import people

        if guest_hash:
            people.observe("guest", guest_hash, text=raw)
        people.observe("web", sid, text=raw)
    except Exception:
        pass

    system, _src = persona_svc.system_prompt(surface=surface)
    if surface == "public":
        system += (
            "\nThis is a 1:1 talk on the public site. They already opened the chat — "
            "every message is for you. They do not need to say Ava. Small talk is useful context. "
            "Treat them as an individual from notes on file. Never invent a fact about them."
        )
        if not member:
            system += "\nThis speaker is an unsigned guest. Do not invent a name. Do not mention their address."
    try:
        from apps.core.services import people

        lock_sid = guest_hash or sid
        lock_surface = "guest" if guest_hash else "web"
        system += "\n\n" + people.lock_addon(lock_surface, lock_sid)
    except Exception:
        pass
    try:
        facts = await persona_svc.live_facts(asked=raw)
        if facts:
            system += "\n\n" + facts
    except Exception:
        facts = ""
    if req.context:
        system += f"\n\nAdditional context:\n{req.context}"

    messages = [{"role": "system", "content": system}]
    if surface == "public":
        messages.extend(persona_svc.PUBLIC_FEWSHOT)
    for turn in (req.history or [])[-10:]:
        role = turn.get("role") if isinstance(turn, dict) else None
        content = str((turn.get("content") if isinstance(turn, dict) else "") or "").strip()[:1500]
        if role in {"user", "assistant"} and content:
            messages.append({"role": role, "content": content})
    if not messages or messages[-1].get("role") != "user" or messages[-1].get("content") != req.message:
        messages.append({"role": "user", "content": req.message})

    reply = await ollama_svc.chat(messages, timeout=45)
    if reply:
        cleaned = persona_svc.scrub_reply(reply)
        if cleaned:
            _count_generation(ip, guest_hash, member)
            return _chat_response(
                {"reply": cleaned, "brain": "ollama", "model": config.OLLAMA_MODEL, "surface": surface},
                sid=sid,
                set_sid=set_sid,
            )

    if config.XAI_API_KEY:
        try:
            from apps.core.services import model_pick, xai

            grok = await asyncio.to_thread(
                xai.try_chat, messages, max_tokens=req.max_tokens
            )
            cleaned = persona_svc.scrub_reply(grok or "")
            if cleaned:
                _count_generation(ip, guest_hash, member)
                return _chat_response(
                    {
                        "reply": cleaned,
                        "brain": "xai",
                        "model": model_pick.pick("xai"),
                        "surface": surface,
                    },
                    sid=sid,
                    set_sid=set_sid,
                )
        except Exception as e:
            log.error("xAI chat failed: %s", e)

    return _chat_response(
        {
            "reply": "I didn't get a clean sentence that time. Ask me again.",
            "brain": "empty",
            "surface": surface,
        },
        sid=sid,
        set_sid=set_sid,
    )


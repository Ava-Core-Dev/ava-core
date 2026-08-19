"""Ingest Vercel deployment logs into media/documents/docs/vercel-builds.

Successful builds are not kept. Failed builds are saved until the same
project+target deploys cleanly, or 5 days, whichever comes first.
Logs stay off the public media catalog.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

from .. import config

log = logging.getLogger("ava.vercel_builds")

API = "https://api.vercel.com"
KEEP_DAYS = 5
MAX_LOG_CHARS = 120_000

_REDACT = re.compile(
    r"(?i)(bearer\s+|token[=:]\s*|sk_(?:live|test)_|xai-|xox[baprs]-|"
    r"VERCEL_TOKEN=|POSTGRES_URL=)(\S+)"
)


def builds_dir() -> Path:
    return config.MEDIA_DIR / "documents" / "docs" / "vercel-builds"


def state_path() -> Path:
    return config.DATA_DIR / "state" / "vercel-builds.json"


def _slug(s: str) -> str:
    t = re.sub(r"[^a-zA-Z0-9._-]+", "-", str(s or "").strip())[:80]
    return t.strip("-") or "project"


def _redact(text: str) -> str:
    return _REDACT.sub(r"\1[redacted]", text)


def _load_state() -> dict:
    p = state_path()
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {"seen": {}}


def _save_state(state: dict) -> None:
    p = state_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(state, indent=2), encoding="utf-8")


def _auth_headers() -> dict[str, str] | None:
    token = config.vercel_token()
    if not token:
        return None
    return {"Authorization": f"Bearer {token}", "Accept": "application/json"}


def _team_qs() -> dict[str, str]:
    team = config.vercel_team_id()
    return {"teamId": team} if team else {}


def _key(name: str, target: str) -> str:
    return f"{_slug(name)}--{_slug(target or 'preview')}"


def prune_expired(*, now: datetime | None = None) -> int:
    root = builds_dir()
    if not root.exists():
        return 0
    now = now or datetime.now(timezone.utc)
    cut = now - timedelta(days=KEEP_DAYS)
    removed = 0
    for meta in root.glob("*.meta.json"):
        try:
            data = json.loads(meta.read_text(encoding="utf-8"))
            created = datetime.fromisoformat(str(data.get("created_at") or ""))
            if created.tzinfo is None:
                created = created.replace(tzinfo=timezone.utc)
        except Exception:
            created = datetime.fromtimestamp(meta.stat().st_mtime, tz=timezone.utc)
        if created > cut:
            continue
        md = root / (meta.name[: -len(".meta.json")] + ".md")
        meta.unlink(missing_ok=True)
        md.unlink(missing_ok=True)
        removed += 1
        log.info("expired Vercel error log %s", md.name)
    return removed


def delete_fixed(project: str, target: str) -> int:
    root = builds_dir()
    if not root.exists():
        return 0
    prefix = _key(project, target) + "--"
    removed = 0
    for meta in root.glob("*.meta.json"):
        stem = meta.name[: -len(".meta.json")]
        if not stem.startswith(prefix):
            continue
        (root / f"{stem}.md").unlink(missing_ok=True)
        meta.unlink(missing_ok=True)
        removed += 1
    if removed:
        log.info("cleared %s fixed Vercel error log(s) for %s", removed, prefix.rstrip("-"))
    return removed


async def _get_json(client: httpx.AsyncClient, path: str, params: dict | None = None) -> dict | list | None:
    headers = _auth_headers()
    if not headers:
        return None
    q = {**_team_qs(), **(params or {})}
    r = await client.get(f"{API}{path}", headers=headers, params=q, timeout=30)
    if r.status_code != 200:
        log.warning("Vercel %s -> %s %s", path, r.status_code, r.text[:200])
        return None
    try:
        return r.json()
    except Exception:
        return None


async def fetch_build_log(client: httpx.AsyncClient, uid: str) -> str:
    data = await _get_json(
        client,
        f"/v3/deployments/{uid}/events",
        {"limit": "1000", "builds": "1", "direction": "forward"},
    )
    lines: list[str] = []
    rows = data if isinstance(data, list) else (data or {}).get("events") or []
    if isinstance(data, dict) and not rows and data.get("text"):
        return _redact(str(data.get("text")))[:MAX_LOG_CHARS]
    for ev in rows:
        if not isinstance(ev, dict):
            continue
        text = ev.get("text") or ev.get("payload", {}).get("text") if isinstance(ev.get("payload"), dict) else ev.get("text")
        if not text:
            info = ev.get("payload") if isinstance(ev.get("payload"), dict) else {}
            text = info.get("message") or info.get("serial") or ""
        if text:
            lines.append(str(text).rstrip())
    return _redact("\n".join(lines))[:MAX_LOG_CHARS]


def _write_error(dep: dict, log_text: str) -> Path:
    root = builds_dir()
    root.mkdir(parents=True, exist_ok=True)
    uid = str(dep.get("uid") or dep.get("id") or "unknown")
    name = str(dep.get("name") or "project")
    target = str(dep.get("target") or "preview")
    stem = f"{_key(name, target)}--{_slug(uid)}"
    created = dep.get("createdAt") or dep.get("created")
    if isinstance(created, (int, float)):
        created_at = datetime.fromtimestamp(created / 1000, tz=timezone.utc).isoformat()
    else:
        created_at = datetime.now(timezone.utc).isoformat()
    url = str(dep.get("url") or "")
    inspector = str(dep.get("inspectorUrl") or (f"https://vercel.com/{name}/{uid}" if name else ""))
    body = (
        f"# Vercel build error — {name} ({target})\n\n"
        f"- deployment: `{uid}`\n"
        f"- created: {created_at}\n"
        f"- url: {url}\n"
        f"- inspector: {inspector}\n"
        f"- keep until: next successful `{name}` `{target}` deploy, or 5 days\n\n"
        f"```\n{log_text or '(no log text returned)'}\n```\n"
    )
    md = root / f"{stem}.md"
    md.write_text(body, encoding="utf-8")
    (root / f"{stem}.meta.json").write_text(
        json.dumps(
            {
                "uid": uid,
                "name": name,
                "target": target,
                "created_at": created_at,
                "url": url,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    return md


async def ingest_deployment(dep: dict, *, client: httpx.AsyncClient | None = None) -> str:
    """Process one Vercel deployment object. Returns action: saved|cleared|skipped|ignored."""
    uid = str(dep.get("uid") or dep.get("id") or "").strip()
    state = str(dep.get("readyState") or dep.get("state") or "").upper()
    name = str(dep.get("name") or "")
    target = str(dep.get("target") or "preview")
    if not uid:
        return "ignored"
    if state in {"READY", "SUCCEEDED"}:
        delete_fixed(name, target)
        return "cleared"
    if state not in {"ERROR", "FAILED"}:
        return "ignored"

    own = client is None
    http = client or httpx.AsyncClient(timeout=30)
    try:
        log_text = await fetch_build_log(http, uid) if _auth_headers() else str(dep.get("errorMessage") or "")
        path = _write_error(dep, log_text)
        log.info("saved Vercel error log %s", path.name)
        return "saved"
    finally:
        if own:
            await http.aclose()


async def sync_recent(*, limit: int = 40) -> dict:
    prune_expired()
    headers = _auth_headers()
    if not headers:
        log.warning("VERCEL_TOKEN missing — cannot pull Vercel build logs")
        return {"ok": False, "detail": "missing_vercel_token", "saved": 0, "cleared": 0}

    state = _load_state()
    seen: dict = state.setdefault("seen", {})
    saved = cleared = skipped = 0

    async with httpx.AsyncClient(timeout=30) as client:
        data = await _get_json(client, "/v6/deployments", {"limit": str(limit)})
        deployments = (data or {}).get("deployments") if isinstance(data, dict) else None
        if not isinstance(deployments, list):
            return {"ok": False, "detail": "list_failed", "saved": 0, "cleared": 0}

        for dep in deployments:
            if not isinstance(dep, dict):
                continue
            uid = str(dep.get("uid") or "")
            state_name = str(dep.get("readyState") or "")
            fingerprint = f"{uid}:{state_name}"
            if seen.get(uid) == fingerprint:
                skipped += 1
                continue
            action = await ingest_deployment(dep, client=client)
            if action == "saved":
                saved += 1
            elif action == "cleared":
                cleared += 1
            if state_name in {"READY", "ERROR", "CANCELED"}:
                seen[uid] = fingerprint

    if len(seen) > 400:
        # keep newest keys
        items = list(seen.items())[-300:]
        state["seen"] = dict(items)
    _save_state(state)
    log.info("vercel builds sync saved=%s cleared=%s skipped=%s", saved, cleared, skipped)
    return {"ok": True, "saved": saved, "cleared": cleared, "skipped": skipped}

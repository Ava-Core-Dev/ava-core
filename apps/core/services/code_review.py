"""Periodic code-review pack. Writes markdown only. Never patches the tree.

Local qwen2.5-coder (if pulled) adds a suggestions section, then unloads.
Drop CURRENT.md into Cursor / Grok / GPT. Self-update stays off.
"""
from __future__ import annotations

import json
import logging
import subprocess
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from apps.core import config

log = logging.getLogger("ava.code_review")
HST = ZoneInfo("Pacific/Honolulu")
CREATE_NO_WINDOW = 0x08000000
REVIEW_DIR = config.DATA_DIR / "review"
CURRENT = REVIEW_DIR / "CURRENT.md"
DROP = REVIEW_DIR / "DROP-INTO-CURSOR.md"

_SKIP_LOG = ("password", "api_key", "token=", "secret", "sk-", "bot")


def _si() -> subprocess.STARTUPINFO | None:
    if os_name() != "nt":
        return None
    info = subprocess.STARTUPINFO()
    info.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    info.wShowWindow = 0
    return info


def os_name() -> str:
    import os

    return os.name


def _run(cmd: list[str], *, timeout: int = 20) -> str:
    kw: dict = {
        "capture_output": True,
        "text": True,
        "timeout": timeout,
        "cwd": str(config.AVA_HOME),
    }
    if os_name() == "nt":
        kw["creationflags"] = CREATE_NO_WINDOW
        kw["startupinfo"] = _si()
    try:
        r = subprocess.run(cmd, **kw)
    except Exception as e:
        return f"(unavailable: {type(e).__name__})"
    out = (r.stdout or "") + (r.stderr or "")
    return out.strip()[:4000]


def _tail_errors(path: Path, *, limit: int = 24) -> list[str]:
    if not path.is_file():
        return []
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return []
    hits = []
    for line in text.splitlines()[-400:]:
        low = line.lower()
        if any(s in low for s in _SKIP_LOG):
            continue
        if "error" in low or "exception" in low or "traceback" in low:
            hits.append(line[:240])
    return hits[-limit:]


def _git_short() -> str:
    return _run(["git", "status", "--short", "-uno"])


def _recent_bugs(*, n: int = 8) -> list[str]:
    root = Path(r"C:\Users\rootr\context\common-bugs")
    if not root.is_dir():
        return []
    files = [p for p in root.rglob("*.md") if p.is_file() and p.name.upper() != "AGENTS.md"]
    files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    out = []
    for p in files[:n]:
        try:
            rel = str(p.relative_to(root))
        except ValueError:
            rel = p.name
        out.append(rel)
    return out


def gather() -> dict:
    """Facts only. No model. No secrets."""
    logs = [
        config.AVA_HOME / "data" / "logs" / "ava-core-session.log",
        config.AVA_HOME / "data" / "logs" / "origin-uvicorn.log",
        Path(config.LOG_DIR) / "ava-core.log",
    ]
    errors: list[str] = []
    for p in logs:
        for line in _tail_errors(p):
            errors.append(f"{p.name}: {line}")
    hourly = config.GENERATED_DIR / "hourly-scripts.txt"
    hourly_txt = ""
    if hourly.is_file():
        try:
            hourly_txt = hourly.read_text(encoding="utf-8", errors="replace")[:1500]
        except OSError:
            hourly_txt = ""
    net = {}
    np = config.DATA_DIR / "state" / "net-gate.json"
    if np.is_file():
        try:
            net = json.loads(np.read_text(encoding="utf-8"))
        except Exception:
            net = {}
    gov = {}
    gp = config.DATA_DIR / "state" / "governance.json"
    if gp.is_file():
        try:
            gov = json.loads(gp.read_text(encoding="utf-8"))
        except Exception:
            gov = {}
    missing_audio: list[str] = []
    needed = config.ASSETS_DIR / "words" / "_needed_record.txt"
    from apps.voice.clips import _find_clip

    for name in (
        "phrase_hourly_solar",
        "phrase_hourly_system",
        "phrase_hourly_weather",
        "phrase_hourly_kilauea",
        "phrase_remaining_tasks",
        "weather_details_as_of",
        "here_are_the_local_solar_and_system_statistics",
    ):
        if not _find_clip(name):
            missing_audio.append(name)
    return {
        "at": datetime.now(HST).isoformat(),
        "git": _git_short() or "(clean or git unavailable)",
        "errors": errors[:40],
        "hourly_scripts": hourly_txt,
        "missing_audio": missing_audio,
        "needed_record": str(needed) if needed.is_file() else "",
        "net_gate": {
            "ava_stopped": (net or {}).get("ava_stopped"),
            "online": (net or {}).get("online"),
            "power": (net or {}).get("power"),
        },
        "governance": {
            "self_update": bool((gov or {}).get("self_update")),
            "community_governance": bool((gov or {}).get("community_governance")),
        },
        "common_bugs_recent": _recent_bugs(),
    }


def _evidence_md(data: dict) -> str:
    err_block = "\n".join(f"- `{x}`" for x in (data.get("errors") or [])[:20]) or "- (none in the last log tail)"
    audio = ", ".join(data.get("missing_audio") or []) or "(whole-phrase files present or not checked)"
    bugs = "\n".join(f"- {x}" for x in (data.get("common_bugs_recent") or [])) or "- (none)"
    git = data.get("git") or ""
    hourly = data.get("hourly_scripts") or "(no hourly-scripts.txt yet)"
    net = data.get("net_gate") or {}
    gov = data.get("governance") or {}
    return (
        f"## Evidence — {data.get('at')}\n\n"
        "### Git (uncommitted, not staged by this job)\n\n"
        f"```\n{git}\n```\n\n"
        "### Recent log errors\n\n"
        f"{err_block}\n\n"
        "### Hourly voice scripts (last build)\n\n"
        f"```\n{hourly}\n```\n\n"
        f"### Whole-phrase clips still missing\n\n{audio}\n\n"
        f"### Net gate\n\n`{json.dumps(net)}`\n\n"
        f"### Governance (must stay: self_update {gov.get('self_update')})\n\n"
        f"### Recent common-bugs notes\n\n{bugs}\n"
    )


_CURSOR_HEADER = """# Ava review pack — evaluate only

Paste this file into Cursor, Grok, or GPT.

Rules for the model that reads this:

- Suggest fixes. Do not apply them. Do not write to the live tree.
- Ava self-update stays **off** until the operator turns it on.
- Do not invent watts, balances, or hardware. If evidence is missing, say so.
- Do not print secrets, tokens, or `.env` values.
- Public copy stays short and plain if you draft visitor text.

Live tree: `C:\\Users\\rootr\\ava`. Origin `127.0.0.1:8787`.

---
"""


def _coder_notes(evidence: str) -> str:
    from apps.core.services import ollama as ollama_svc

    model = config.OLLAMA_CODER_MODEL
    prompt = (
        "You are reviewing AVA-CORE for the operator. "
        "List up to 8 concrete bugs or gaps from the evidence. "
        "For each: one-line title, why it matters, and a Cursor task in one sentence. "
        "No patches. No file rewrites. If evidence is thin, say that.\n\n"
        + evidence[:6000]
    )
    t0 = time.time()
    raw = ollama_svc.chat_sync(
        [
            {"role": "system", "content": "You write operator review notes. No diffs. No apply."},
            {"role": "user", "content": prompt},
        ],
        model=model,
        timeout=180,
        keep_alive=0,
        num_predict=700,
    )
    ms = int((time.time() - t0) * 1000)
    if not raw or not str(raw).strip():
        return f"_Local coder `{model}` did not return a note ({ms} ms). Evidence above is still valid to drop into Cursor._\n"
    return f"_Coder `{model}` ({ms} ms), then unloaded._\n\n{raw.strip()}\n"


def write_pack(*, with_coder: bool = True) -> dict:
    REVIEW_DIR.mkdir(parents=True, exist_ok=True)
    data = gather()
    evidence = _evidence_md(data)
    coder = ""
    if with_coder:
        try:
            coder = _coder_notes(evidence)
        except Exception as e:
            coder = f"_Coder skipped: {type(e).__name__}_\n"
            log.info("code review coder skipped: %s", e)
    body = (
        _CURSOR_HEADER
        + evidence
        + "\n## Local coder suggestions (not applied)\n\n"
        + (coder or "_Coder off for this run._\n")
    )
    stamp = datetime.now(HST).strftime("%Y-%m-%d-%H%M")
    dated = REVIEW_DIR / f"{stamp}.md"
    dated.write_text(body, encoding="utf-8")
    CURRENT.write_text(body, encoding="utf-8")
    DROP.write_text(body, encoding="utf-8")
    log.info("review pack %s bytes=%s", dated.name, dated.stat().st_size)
    return {
        "ok": True,
        "applied": False,
        "path": str(CURRENT),
        "dated": str(dated),
        "drop": str(DROP),
        "coder": bool(coder and "did not return" not in coder and "skipped" not in coder),
    }


async def run(*, with_coder: bool = True) -> dict:
    import asyncio

    return await asyncio.to_thread(write_pack, with_coder=with_coder)

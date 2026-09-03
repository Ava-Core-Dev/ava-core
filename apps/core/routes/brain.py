"""Local Interactive Intelligence Agent — Ollama + tools. Not raw ollama run.

Public UIs must call this FastAPI, never 11434. Unload the coder model after use
by leaving it unused (Ollama LRU); chat default is llama3.2.
"""
from __future__ import annotations

import ast
import json
import sqlite3
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .. import config
from ..services import ollama as ollama_svc
from ..services import persona as persona_svc

router = APIRouter(prefix="/api/brain")

# Identity comes from Media/public/documents/persona/SYSTEM.txt via persona.py


class BrainIn(BaseModel):
    message: str = Field(min_length=1, max_length=8000)
    use_coder: bool = False


def _local(request: Request) -> bool:
    if request.headers.get("cf-ray") or request.headers.get("cf-connecting-ip"):
        return False
    host = request.client.host if request.client else ""
    return host in {"127.0.0.1", "::1"}


def _calc(expr: str) -> str:
    tree = ast.parse(expr, mode="eval")
    for node in ast.walk(tree):
        if not isinstance(node, (ast.Expression, ast.BinOp, ast.UnaryOp, ast.Constant,
                                 ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Pow, ast.Mod,
                                 ast.FloorDiv, ast.USub, ast.UAdd)):
            raise ValueError("unsupported")
    return str(eval(compile(tree, "<calc>", "eval"), {"__builtins__": {}}, {}))


def _search_files(query: str, limit: int = 12) -> list[str]:
    root = config.AVA_HOME
    q = query.lower()
    hits: list[str] = []
    skip = {".venv", "node_modules", "__pycache__", ".git", "credentials"}
    for dirpath, dirs, files in os_walk_limited(root, skip):
        dirs[:] = [d for d in dirs if d not in skip and not d.startswith(".")]
        for name in files:
            if name.lower().endswith((".env", ".token", ".pem")):
                continue
            if "credential" in name.lower():
                continue
            hay = f"{name} {dirpath}".lower()
            if q in hay:
                hits.append(str(Path(dirpath) / name))
            if len(hits) >= limit:
                return hits
    return hits


def os_walk_limited(root: Path, skip: set[str]):
    import os
    depth0 = str(root).count(os.sep)
    for dirpath, dirs, files in os.walk(root):
        if str(dirpath).count(os.sep) - depth0 > 4:
            dirs[:] = []
            continue
        yield dirpath, dirs, files


def _sqlite_tables(db_path: Path) -> dict:
    if not db_path.is_file():
        return {"error": "not_live", "path": str(db_path)}
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        rows = con.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        return {"path": str(db_path), "tables": [r[0] for r in rows]}
    finally:
        con.close()


@router.post("/chat")
async def brain_chat(body: BrainIn, request: Request):
    if not _local(request):
        return JSONResponse({"error": "brain is localhost only during cutover"}, status_code=403)

    msg = body.message.strip()
    tool_notes: list[str] = []
    lower = msg.lower()
    if any(c in msg for c in "+-*/") and any(ch.isdigit() for ch in msg):
        try:
            expr = "".join(ch for ch in msg if ch in "0123456789+-*/().% ")
            if expr.strip():
                tool_notes.append(f"calc={_calc(expr.strip())}")
        except Exception:
            tool_notes.append("calc=unavailable")
    if "sqlite" in lower or ".db" in lower or "ecoflow" in lower:
        for p in (
            config.DATA_DIR / "ecoflow" / "ecoflow-10s.db",
            config.DATA_DIR / "system" / "system.db",
        ):
            tool_notes.append(json.dumps(_sqlite_tables(p)))
    if "find " in lower or "search " in lower or "where is" in lower:
        q = msg.split(" ", 1)[-1][:80]
        tool_notes.append("files=" + json.dumps(_search_files(q)))

    model = config.OLLAMA_CODER_MODEL if body.use_coder else config.OLLAMA_MODEL
    context = ""
    if tool_notes:
        context = "Tool results (live, do not invent beyond these):\n" + "\n".join(tool_notes)
    system, _src = persona_svc.system_prompt(surface="desk")
    reply = await ollama_svc.chat(
        [
            {"role": "system", "content": system},
            {"role": "user", "content": (context + "\n\n" + msg) if context else msg},
        ],
        model=model,
        timeout=90,
    )
    if reply is None:
        return JSONResponse({"ok": False, "detail": "ollama_unavailable", "tools": tool_notes})
    return {"ok": True, "model": model, "reply": reply, "tools": tool_notes}

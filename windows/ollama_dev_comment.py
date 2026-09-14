"""Short llama3.2 comment/summarize via local Ollama. Not always-on.

Uses the model already on disk (llama3.2:latest). keep_alive=0 so weights
unload after the reply. Do not point this at qwen2.5-coder:7b.

  python windows\\ollama_dev_comment.py comment --file path.py
  python windows\\ollama_dev_comment.py summarize
  Get-Content snippet.py | python windows\\ollama_dev_comment.py comment

Skip when RAM is already tight (Task Manager 75%+). This will load ~2 GB
onto the 840M until the request ends.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

OLLAMA = os.environ.get("AVA_OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
MODEL = os.environ.get("AVA_OLLAMA_MODEL", "llama3.2:latest").strip() or "llama3.2:latest"
MAX_CHARS = 6000
NUM_PREDICT = 160

_PROMPTS = {
    "comment": (
        "Write a short code comment for the snippet. "
        "Plain English. No markdown fences. At most 4 lines."
    ),
    "summarize": (
        "Summarize this code in 1-3 sentences. What it does, not a rewrite. "
        "No markdown fences."
    ),
}


def _read_text(path: Path | None) -> str:
    if path is not None:
        raw = path.read_text(encoding="utf-8", errors="replace")
    else:
        raw = sys.stdin.read()
    text = raw.strip()
    if not text:
        raise SystemExit("no input")
    if len(text) > MAX_CHARS:
        text = text[:MAX_CHARS] + "\n…"
    return text


def run(mode: str, text: str) -> str:
    body = {
        "model": MODEL,
        "stream": False,
        "think": False,
        "keep_alive": 0,
        "messages": [
            {"role": "system", "content": _PROMPTS[mode]},
            {"role": "user", "content": text},
        ],
        "options": {"temperature": 0.2, "num_predict": NUM_PREDICT},
    }
    req = urllib.request.Request(
        f"{OLLAMA}/api/chat",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode())
    except urllib.error.URLError as e:
        raise SystemExit(f"ollama unreachable at {OLLAMA}: {e}") from e
    reply = ((data.get("message") or {}).get("content") or "").strip()
    if not reply:
        raise SystemExit("empty reply")
    return reply


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("mode", choices=sorted(_PROMPTS))
    p.add_argument("--file", type=Path, default=None)
    args = p.parse_args()
    print(run(args.mode, _read_text(args.file)))


if __name__ == "__main__":
    main()

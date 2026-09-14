"""AVA boundary for the standalone local Weather processor."""

from __future__ import annotations

from pathlib import Path

_PROCESSOR_FILE = Path.home() / "RootRecord Core Ops" / "Weather" / "weather.py"

if not _PROCESSOR_FILE.is_file():
    raise FileNotFoundError(f"Weather processor is missing: {_PROCESSOR_FILE}")

exec(compile(_PROCESSOR_FILE.read_text(encoding="utf-8"), str(_PROCESSOR_FILE), "exec"), globals())

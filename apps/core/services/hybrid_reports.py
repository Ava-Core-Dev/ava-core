"""AVA boundary for the standalone hybrid report processor."""

from __future__ import annotations

from pathlib import Path

_PROCESSOR_FILE = Path.home() / "RootRecord Core Ops" / "Hybrid Tracking Reports" / "hybrid_reports.py"

if not _PROCESSOR_FILE.is_file():
    raise FileNotFoundError(f"Hybrid report processor is missing: {_PROCESSOR_FILE}")

# Execute the standalone processor in this module namespace so callers and tests
# get one normal Python module while the implementation remains outside AVA.
exec(compile(_PROCESSOR_FILE.read_text(encoding="utf-8"), str(_PROCESSOR_FILE), "exec"), globals())

#!/usr/bin/env python3
"""Write context/usage/last-summary.json for desks / boards."""
import json
import sys
from pathlib import Path

ROOT = Path("/home/ava-core")
sys.path.insert(0, str(ROOT / "operations" / "system-tools"))
import ai_usage  # noqa: E402

ai_usage.ensure_schema()
summary = ai_usage.summary(days=30)
out = ROOT / "context" / "usage" / "last-summary.json"
out.write_text(json.dumps(summary, indent=2), encoding="utf-8")
print(json.dumps({"ok": True, "path": str(out), "totals": summary.get("totals")}, indent=2))

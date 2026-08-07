#!/usr/bin/env python3
import json, urllib.request
from pathlib import Path
from datetime import datetime, timezone
base = "http://127.0.0.1:8765"
bundle = {"at": datetime.now(timezone.utc).isoformat(), "schema": "rootmc-singular-webstat/v1", "endpoints": {}}
for name, path in (("health", "/api/health"), ("stats", "/api/stats")):
    try:
        with urllib.request.urlopen(base + path, timeout=5) as r:
            bundle["endpoints"][name] = json.loads(r.read().decode("utf-8"))
    except Exception as e:
        bundle["endpoints"][name] = {"error": str(e)}
sf = Path("/home/ava-core/ava/workstations/minecraft-test/plugins/RootMC/webstat/stats.json")
if sf.exists():
    try:
        bundle["file_stats"] = json.loads(sf.read_text(encoding="utf-8"))
    except Exception as e:
        bundle["file_stats_error"] = str(e)
for out in (
    Path("/home/ava-core/ava/data/webstat/latest.json"),
    Path("/mnt/e/Ava-Archive/webstat-mirror/latest.json"),
):
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(bundle, indent=2), encoding="utf-8")
print(bundle["at"], "ok")

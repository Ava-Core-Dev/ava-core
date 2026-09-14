"""Re-run identity + accounting + membership import onto the live store.

From C:\\Users\\rootr\\ava:

    .venv\\Scripts\\python.exe windows\\import_accounts.py

Writes gitignored SQLite at data/db/identities.sqlite and a counts-only
summary at data/state/identity-import-summary.json. No PII on stdout.
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def main() -> int:
    os_chdir = ROOT
    import os

    os.chdir(os_chdir)
    from apps.core.services.account_import import run

    summary = asyncio.run(run())
    counts = summary.get("counts") or {}
    out = {
        "ok": summary.get("ok"),
        "store": summary.get("store"),
        "identities": counts.get("identities"),
        "email": counts.get("id_email"),
        "discord": counts.get("id_discord"),
        "uuid": counts.get("id_uuid"),
        "solana": counts.get("id_solana"),
        "username": counts.get("id_username"),
        "uuid_lookup_ok": summary.get("uuid_lookup_ok"),
        "finance": (summary.get("finance") or {}).get("ok"),
        "rootmc_stats_ok": (summary.get("rootmc_membership") or {}).get("ok"),
        "summary_path": summary.get("summary_path"),
        "sources": {
            k: (v.get("ok") if isinstance(v, dict) and "ok" in v else v)
            for k, v in (summary.get("sources") or {}).items()
        },
    }
    print(json.dumps(out, indent=2))
    return 0 if summary.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())

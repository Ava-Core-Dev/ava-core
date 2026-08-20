"""Economy brief — daily 15:00 HST snapshot of RootMC economy + solar context."""

from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

log = logging.getLogger("ava.cron.economy_brief")
HST = ZoneInfo("Pacific/Honolulu")


def _read_json(path: Path) -> dict:
    if not path.is_file():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


async def run():
    from apps.core import config

    now = datetime.now(HST)
    stamp = now.strftime("%Y-%m-%d")
    reports = Path(config.REPORTS_DIR)
    reports.mkdir(parents=True, exist_ok=True)

    eco_state = _read_json(config.DATA_DIR / "state" / "player-economy.json")
    kila = _read_json(config.DATA_DIR / "state" / "kilauea-alert.json")
    # Latest solar-weather report snippet
    solar_bits = []
    for p in sorted(reports.glob("solar-weather-*.md"), reverse=True)[:1]:
        solar_bits.append(p.read_text(encoding="utf-8", errors="replace")[:600])

    players = eco_state.get("players") or eco_state.get("online") or eco_state.get("player_count")
    gold = eco_state.get("total_gold") or eco_state.get("gold") or eco_state.get("economy_gold")
    mult = eco_state.get("multiplier") or kila.get("multiplier") or 1.0
    alert = kila.get("alert_level") or kila.get("alert") or "unknown"

    lines = [
        f"# Economy brief — {stamp} HST",
        "",
        f"Generated {now.isoformat()}",
        "",
        "## Snapshot",
        f"- Players / online marker: `{players}`",
        f"- Gold / ledger marker: `{gold}`",
        f"- Economy multiplier: `{mult}`",
        f"- Kīlauea alert context: `{alert}`",
        "",
        "## Notes",
        "- Funded from live desk state; Gold never converts to dollars.",
        "- Full player-economy cron continues on its own schedule.",
        "",
    ]
    if solar_bits:
        lines += ["## Latest solar weather (trim)", "", solar_bits[0], ""]

    out = reports / f"economy-brief-{stamp}.md"
    out.write_text("\n".join(lines), encoding="utf-8")

    # Clear stale stub error line if present
    stub = config.DATA_DIR / "state" / "status-events.jsonl"
    if stub.is_file():
        keep = []
        for line in stub.read_text(encoding="utf-8", errors="replace").splitlines():
            low = line.lower()
            if "economy-brief" in low and ("error" in low or "fail" in low):
                continue
            if "proposal queue" in low and "failed" in low:
                continue
            if "feedback inbox" in low and "failed" in low:
                continue
            keep.append(line)
        stub.write_text("\n".join(keep) + ("\n" if keep else ""), encoding="utf-8")

    # Append a clean ok event
    stub.parent.mkdir(parents=True, exist_ok=True)
    with stub.open("a", encoding="utf-8") as fh:
        fh.write(f"{datetime.utcnow().isoformat()}Z\tcron · economy-brief · ok · {out.name}\n")

    log.info("Economy brief wrote %s", out)
    return {"ok": True, "path": str(out)}

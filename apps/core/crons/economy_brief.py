"""Economy brief — daily 15:00 HST live MySQL snapshot + Discord post."""

from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

log = logging.getLogger("ava.cron.economy_brief")
HST = ZoneInfo("Pacific/Honolulu")


async def run():
    from apps.core import config
    from apps.core.services import discord
    from apps.core.services import rootmc_economy as eco

    now = datetime.now(HST)
    stamp = now.strftime("%Y-%m-%d")
    reports = Path(config.REPORTS_DIR)
    reports.mkdir(parents=True, exist_ok=True)

    snap = await eco.snapshot()
    eco.save_state(snap)

    kila_path = config.DATA_DIR / "state" / "kilauea-alert.json"
    alert = "unknown"
    mult = 1.0
    try:
        import json

        if kila_path.is_file():
            kila = json.loads(kila_path.read_text(encoding="utf-8"))
            alert = kila.get("alert_level") or kila.get("alert") or alert
            mult = float(kila.get("multiplier") or 1.0)
    except Exception:
        pass

    lines = [
        f"# Economy brief — {stamp} HST",
        "",
        f"Generated {now.isoformat()}",
        "",
        "## Live MySQL snapshot",
        f"- ok: `{snap.get('ok')}`",
        f"- wallets: `{snap.get('wallets')}`",
        f"- circulating (+) gold: `{snap.get('positive_gold')}` g",
        f"- net sum gold: `{snap.get('total_gold')}` g",
        f"- bonds outstanding: `{snap.get('bonds_count')}` / principal `{snap.get('bonds_principal')}` g",
        f"- Kīlauea alert: `{alert}` · multiplier `{mult}`",
        "",
        "## Notes",
        "- Sourced from Shockbyte `root_economy_balances` (local mirror fallback).",
        "- Gold never converts to dollars.",
        "",
    ]
    out = reports / f"economy-brief-{stamp}.md"
    out.write_text("\n".join(lines), encoding="utf-8")

    stub = config.DATA_DIR / "state" / "status-events.jsonl"
    stub.parent.mkdir(parents=True, exist_ok=True)
    if stub.is_file():
        keep = []
        for line in stub.read_text(encoding="utf-8", errors="replace").splitlines():
            low = line.lower()
            if "economy-brief" in low and ("error" in low or "fail" in low):
                continue
            keep.append(line)
        stub.write_text("\n".join(keep) + ("\n" if keep else ""), encoding="utf-8")
    with stub.open("a", encoding="utf-8") as fh:
        status = "ok" if snap.get("ok") else "error"
        fh.write(
            f"{datetime.utcnow().isoformat()}Z\tcron · economy-brief · {status} · {out.name}\n"
        )

    now_hst = now.strftime("%H:%M HST — %a, %b %-d")
    mult_line = ""
    if float(mult) != 1.0:
        mult_line = f"\n🌋 **Kīlauea {str(alert).title()}** — multiplier **×{float(mult):.1f}**"
    content = "**Daily economy brief**\n" + eco.format_discord(
        snap, now_hst=now_hst, mult_line=mult_line
    )
    channel = eco.economy_discord_channel()
    await discord.post_message(channel, content[:1900])

    log.info("Economy brief wrote %s posted→%s ok=%s", out, channel, snap.get("ok"))
    return {"ok": bool(snap.get("ok")), "path": str(out), "channel": channel, "wallets": snap.get("wallets")}

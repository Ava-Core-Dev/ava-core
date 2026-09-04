"""Live RootMC economy snapshot from Shockbyte MySQL (absolute primary).

Never converts Gold to dollars. Numbers are in-game Gold (g) only.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

log = logging.getLogger("ava.economy")


def _fmt_g(n: float | int | None) -> str:
    try:
        v = float(n or 0)
    except (TypeError, ValueError):
        return "0"
    if abs(v) >= 1000:
        return f"{v:,.1f}"
    if abs(v - round(v)) < 1e-6:
        return f"{int(round(v))}"
    return f"{v:.2f}"


async def _mysql_rows(sql: str, args: tuple | list | None = None) -> list[dict]:
    """Shockbyte core first, then local mirror."""
    import aiomysql

    attempts = [
        {
            "host": os.getenv("ROOTMC_CORE_MYSQL_HOST", ""),
            "port": int(os.getenv("ROOTMC_CORE_MYSQL_PORT", "3306") or 3306),
            "user": os.getenv("ROOTMC_CORE_MYSQL_USER", ""),
            "password": os.getenv("ROOTMC_CORE_MYSQL_PASSWORD", ""),
            "db": os.getenv("ROOTMC_CORE_MYSQL_DATABASE", ""),
        },
        {
            "host": os.getenv("ROOTMC_LOCAL_MYSQL_HOST", "127.0.0.1"),
            "port": int(os.getenv("ROOTMC_LOCAL_MYSQL_PORT", "3306") or 3306),
            "user": os.getenv("ROOTMC_LOCAL_MYSQL_USER", "ava"),
            "password": os.getenv("ROOTMC_LOCAL_MYSQL_PASSWORD", ""),
            "db": os.getenv("ROOTMC_LOCAL_MYSQL_DATABASE", "rootmc_core_mirror"),
        },
    ]
    last: Exception | None = None
    for cfg in attempts:
        if not cfg["host"] or not cfg["user"] or not cfg["db"]:
            continue
        try:
            conn = await aiomysql.connect(
                **cfg, autocommit=True, connect_timeout=10, charset="utf8mb4"
            )
            try:
                async with conn.cursor(aiomysql.DictCursor) as cur:
                    await cur.execute(sql, args or ())
                    return list(await cur.fetchall())
            finally:
                conn.close()
        except Exception as e:
            last = e
            log.info("economy MySQL %s/%s: %s", cfg["host"], cfg["db"], e)
    if last:
        log.warning("economy MySQL failed: %s", last)
    return []


async def snapshot() -> dict[str, Any]:
    """Query live economy tables and return a structured snapshot."""
    now = datetime.now(timezone.utc).isoformat()
    out: dict[str, Any] = {
        "ok": False,
        "source": None,
        "updated_at": now,
        "wallets": 0,
        "total_gold": 0.0,
        "positive_gold": 0.0,
        "avg_gold": 0.0,
        "max_gold": 0.0,
        "bonds_count": 0,
        "bonds_principal": 0.0,
        "pools": {},
        "top": [],
        "error": None,
    }

    agg_rows = await _mysql_rows(
        """
        SELECT
          COUNT(*) AS wallets,
          COALESCE(SUM(balance), 0) AS total_gold,
          COALESCE(SUM(CASE WHEN balance > 0 THEN balance ELSE 0 END), 0) AS positive_gold,
          COALESCE(AVG(balance), 0) AS avg_gold,
          COALESCE(MAX(balance), 0) AS max_gold
        FROM root_economy_balances
        """
    )
    if not agg_rows:
        out["error"] = "no MySQL response for root_economy_balances"
        return out

    agg = agg_rows[0]
    out["ok"] = True
    out["source"] = "root_economy_balances"
    out["wallets"] = int(agg.get("wallets") or 0)
    out["total_gold"] = float(agg.get("total_gold") or 0)
    out["positive_gold"] = float(agg.get("positive_gold") or 0)
    out["avg_gold"] = float(agg.get("avg_gold") or 0)
    out["max_gold"] = float(agg.get("max_gold") or 0)

    # Prefer named accounts in the leaderboard; fall back to full top if thin.
    top = await _mysql_rows(
        """
        SELECT minecraft_username AS name, balance
        FROM root_economy_balances
        WHERE balance IS NOT NULL
          AND minecraft_username IS NOT NULL
          AND minecraft_username <> ''
          AND LOWER(minecraft_username) NOT IN ('player', 'unknown', 'null')
        ORDER BY balance DESC
        LIMIT 5
        """
    )
    if len(top) < 3:
        top = await _mysql_rows(
            """
            SELECT minecraft_username AS name, balance
            FROM root_economy_balances
            WHERE balance IS NOT NULL
            ORDER BY balance DESC
            LIMIT 5
            """
        )
    out["top"] = [
        {"name": str(r.get("name") or "?"), "balance": float(r.get("balance") or 0)}
        for r in top
    ]

    bonds = await _mysql_rows(
        """
        SELECT COUNT(*) AS c,
               COALESCE(SUM(CASE WHEN redeemed_at IS NULL THEN principal ELSE 0 END), 0) AS principal
        FROM root_bonds
        """
    )
    if bonds:
        out["bonds_count"] = int(bonds[0].get("c") or 0)
        out["bonds_principal"] = float(bonds[0].get("principal") or 0)

    pools = await _mysql_rows(
        """
        SELECT category, label, amount_g
        FROM root_list_totals
        WHERE scope = 'claims' AND group_key = 'pools'
        ORDER BY category
        """
    )
    out["pools"] = {
        str(r.get("category") or ""): {
            "label": str(r.get("label") or r.get("category") or ""),
            "amount_g": float(r.get("amount_g") or 0),
        }
        for r in pools
        if r.get("category")
    }

    return out


def save_state(snap: dict[str, Any], path: Path | None = None) -> Path:
    from apps.core import config

    dest = path or (config.DATA_DIR / "state" / "player-economy.json")
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(snap, indent=2, default=str) + "\n", encoding="utf-8")
    return dest


def format_discord(snap: dict[str, Any], *, now_hst: str, mult_line: str = "") -> str:
    """Discord markdown for #automations. Gold only — never USD."""
    if not snap.get("ok"):
        return (
            f"**Player economy** — {now_hst}\n"
            f"⚠️ MySQL snapshot failed: `{snap.get('error') or 'unknown'}`"
            f"{mult_line}"
        )

    top_lines = []
    for i, row in enumerate(snap.get("top") or [], 1):
        top_lines.append(f"`{i}.` **{row['name']}** — {_fmt_g(row['balance'])} g")
    top_block = "\n".join(top_lines) if top_lines else "_no wallets_"

    pools = snap.get("pools") or {}
    pool_bits = []
    for key in ("vote_rewards_paid", "playtime_rewards_paid", "grants_paid", "dividends_paid"):
        p = pools.get(key)
        if p:
            pool_bits.append(f"{p['label']}: **{_fmt_g(p['amount_g'])} g**")
    pools_line = " · ".join(pool_bits) if pool_bits else ""

    lines = [
        f"**Player economy (live MySQL)** — {now_hst}",
        f"Wallets: **{snap['wallets']}** · Circulating (+): **{_fmt_g(snap['positive_gold'])} g** · Net sum: **{_fmt_g(snap['total_gold'])} g**",
        f"Avg: **{_fmt_g(snap['avg_gold'])} g** · Top wallet: **{_fmt_g(snap['max_gold'])} g**",
        f"Bonds outstanding: **{snap['bonds_count']}** · Principal: **{_fmt_g(snap['bonds_principal'])} g**",
    ]
    if pools_line:
        lines.append(f"Pools — {pools_line}")
    lines.append("**Top balances**")
    lines.append(top_block)
    if mult_line:
        lines.append(mult_line.lstrip("\n"))
    lines.append("_Gold stays in-game — no USD conversion._")
    return "\n".join(lines)


def economy_discord_channel() -> str:
    """Prefer the real #automations channel for live economy posts."""
    from apps.core import config

    return (
        os.getenv("DISCORD_ECONOMY_STATS_CHANNEL_ID", "").strip()
        or os.getenv("DISCORD_AUTOMATIONS_CHANNEL_ID", "").strip()
        or "1545284463783710720"
        or config.DISCORD_CHANNELS.get("automations", "")
    )

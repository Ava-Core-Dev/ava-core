"""Push Minecraft live data from host MySQL → Cloudflare D1.

Host does the heavy lifting (crons, joins, math). D1 is the edge copy so
workers still have balances / status when the origin is down. Hyperdrive
is the live SQL path for workers that need a real query.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from pathlib import Path

from .. import config
from ..services import d1

log = logging.getLogger("ava.cron.d1_sync")


def _schema_file() -> Path:
    return Path(__file__).resolve().parents[3] / "packages" / "workers" / "sql" / "rootmc-live.sql"


async def _mysql_rows(sql: str) -> list[dict]:
    """Read from Shockbyte core (absolute primary), fall back to local Ava DB."""
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
    last = None
    for cfg in attempts:
        if not cfg["host"] or not cfg["user"] or not cfg["db"]:
            continue
        try:
            conn = await aiomysql.connect(
                **cfg, autocommit=True, connect_timeout=8, charset="utf8mb4"
            )
            try:
                async with conn.cursor(aiomysql.DictCursor) as cur:
                    await cur.execute(sql)
                    return list(await cur.fetchall())
            finally:
                conn.close()
        except Exception as e:
            last = e
            log.info("MySQL %s/%s: %s", cfg["host"], cfg["db"], e)
            continue
    if last:
        log.warning("MySQL read failed: %s", last)
    return []


def _map_balance(row: dict) -> tuple[str, str, float] | None:
    uuid = str(
        row.get("uuid") or row.get("player_uuid") or row.get("player") or ""
    ).strip()
    if not uuid:
        return None
    name = str(
        row.get("name")
        or row.get("username")
        or row.get("display_name")
        or row.get("player_name")
        or ""
    )
    raw = row.get("balance")
    if raw is None:
        raw = row.get("money")
    if raw is None:
        raw = row.get("gold")
    try:
        bal = float(raw or 0)
    except (TypeError, ValueError):
        bal = 0.0
    return uuid, name, bal


async def _ensure_schema(db_id: str) -> None:
    path = _schema_file()
    if not path.is_file():
        return
    text = path.read_text(encoding="utf-8")
    statements = [s.strip() for s in text.split(";") if s.strip()]
    await d1.exec_script(db_id, statements)


async def run() -> None:
    db_id = config.CF_D1_ROOTMC_DB_ID
    if not db_id:
        log.warning("CF_D1_ROOTMC_DB_ID unset — skip D1 sync")
        return

    await _ensure_schema(db_id)
    now = datetime.now(timezone.utc).isoformat()

    # Server status from the Python core's own probe
    from ..routes import minecraft as mc_routes

    status = await mc_routes.minecraft_status()
    test_on = 1 if status.get("test", {}).get("online") else 0
    live_on = 1 if status.get("live", {}).get("online") else 0
    await d1.query(
        db_id,
        """INSERT INTO server_status (id, online, players, max_players, motd, updated_at, detail)
           VALUES (?, ?, NULL, NULL, NULL, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             online=excluded.online, updated_at=excluded.updated_at, detail=excluded.detail""",
        ["test", test_on, now, str(status.get("test", {}))[:500]],
    )
    await d1.query(
        db_id,
        """INSERT INTO server_status (id, online, players, max_players, motd, updated_at, detail)
           VALUES (?, ?, NULL, NULL, NULL, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             online=excluded.online, updated_at=excluded.updated_at, detail=excluded.detail""",
        ["live", live_on, now, str(status.get("live", {}))[:500]],
    )

    balances: list[dict] = []
    for sql in (
        "SELECT * FROM root_economy_balances LIMIT 5000",
        "SELECT * FROM rootstat_player_balances LIMIT 5000",
        "SELECT * FROM player_balances LIMIT 5000",
    ):
        balances = await _mysql_rows(sql)
        if balances:
            log.info("D1 sync reading %d rows via %s", len(balances), sql.split()[3])
            break

    n = 0
    for row in balances:
        mapped = _map_balance(row)
        if not mapped:
            continue
        uuid, name, bal = mapped
        await d1.query(
            db_id,
            """INSERT INTO player_balances (uuid, name, balance, updated_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(uuid) DO UPDATE SET
                 name=excluded.name, balance=excluded.balance, updated_at=excluded.updated_at""",
            [uuid, name, bal, now],
        )
        n += 1

    await d1.query(
        db_id,
        """INSERT INTO sync_meta (name, updated_at, row_count, ok, detail)
           VALUES (?, ?, ?, 1, ?)
           ON CONFLICT(name) DO UPDATE SET
             updated_at=excluded.updated_at, row_count=excluded.row_count,
             ok=1, detail=excluded.detail""",
        ["player_balances", now, n, f"host sync {n} wallets"],
    )
    log.info("D1 sync wrote %d balances + server_status", n)

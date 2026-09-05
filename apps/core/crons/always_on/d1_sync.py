"""Push Minecraft live data from host MySQL → Cloudflare D1.

Host does the heavy lifting (crons, joins, math). D1 is the edge copy so
workers still have balances / status when the origin is down. Hyperdrive
is the live SQL path for workers that need a real query.
"""
from __future__ import annotations

import logging
import os
import json
from datetime import datetime, timezone
from pathlib import Path

from apps.core import config
from apps.core.services import d1

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


def _row_get(row: dict, *names: str):
    """Case-insensitive lookup; Root-Economy uses minecraft_uuid / minecraft_username."""
    lower = {str(k).lower(): v for k, v in row.items()}
    for name in names:
        val = lower.get(name.lower())
        if val is not None and val != "":
            return val
    return None


def _map_balance(row: dict) -> tuple[str, str, float] | None:
    uuid = str(
        _row_get(
            row,
            "minecraft_uuid",
            "uuid",
            "player_uuid",
            "player",
        )
        or ""
    ).strip()
    if not uuid:
        return None
    name = str(
        _row_get(
            row,
            "minecraft_username",
            "username",
            "display_name",
            "player_name",
            "name",
        )
        or ""
    )
    raw = _row_get(row, "balance", "money", "gold")
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
    """Push Minecraft edge cache to D1.

    Not related to local Ava reports. Free-tier rows_written is burned by
    rewriting every wallet row — keep balances rare; status is cheap.
    """
    db_id = config.CF_D1_ROOTMC_DB_ID
    if not db_id:
        log.warning("CF_D1_ROOTMC_DB_ID unset — skip D1 sync")
        return

    # Soft pause until free-tier reset (UTC midnight) when env set, or state flag.
    pause_until = (os.getenv("AVA_D1_SYNC_PAUSE_UNTIL") or "").strip()
    state_path = config.DATA_DIR / "state" / "d1-sync.json"
    st: dict = {}
    if state_path.is_file():
        try:
            st = json.loads(state_path.read_text(encoding="utf-8-sig"))
            if not isinstance(st, dict):
                st = {}
        except Exception:
            st = {}
    if st.get("pause_balances_until_utc"):
        pause_until = pause_until or str(st.get("pause_balances_until_utc"))

    await _ensure_schema(db_id)
    now = datetime.now(timezone.utc).isoformat()

    from apps.core.routes import minecraft as mc_routes

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

    # Near free-tier cap: skip wallet rewrite until UTC day rolls (operator email 2026-09-04).
    skip_balances = False
    if pause_until:
        try:
            until = datetime.fromisoformat(pause_until.replace("Z", "+00:00"))
            if datetime.now(timezone.utc) < until:
                skip_balances = True
        except ValueError:
            pass
    # Default soft pause through the notified reset if no explicit flag yet.
    if not pause_until:
        # Cap warning reset: 2026-09-05 00:00:00 UTC
        soft = datetime(2026, 9, 5, 0, 0, 0, tzinfo=timezone.utc)
        if datetime.now(timezone.utc) < soft:
            skip_balances = True
            st["pause_balances_until_utc"] = soft.isoformat()
            st["pause_reason"] = "free_tier_rows_written_83pct"
            state_path.parent.mkdir(parents=True, exist_ok=True)
            state_path.write_text(json.dumps(st, indent=2) + "\n", encoding="utf-8")

    if skip_balances:
        await d1.query(
            db_id,
            """INSERT INTO sync_meta (name, updated_at, row_count, ok, detail)
               VALUES (?, ?, ?, 1, ?)
               ON CONFLICT(name) DO UPDATE SET
                 updated_at=excluded.updated_at, row_count=excluded.row_count,
                 ok=1, detail=excluded.detail""",
            ["player_balances", now, int(st.get("last_balance_count") or 0), "balances paused — D1 free-tier cap"],
        )
        log.warning("D1 sync: server_status only — wallet rows paused until free-tier reset")
        return

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
    st["last_balance_count"] = n
    st["last_balance_sync_utc"] = now
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(json.dumps(st, indent=2) + "\n", encoding="utf-8")
    log.info("D1 sync wrote %d balances + server_status", n)

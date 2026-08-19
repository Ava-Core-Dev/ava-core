"""
MySQL / MariaDB client for Ava Core.
Provides async connection pool using aiomysql.
Falls back gracefully if DB is unavailable.
"""

from __future__ import annotations

import logging
import os
from typing import Any

log = logging.getLogger("ava.mysql")

_pool = None


async def _get_pool():
    global _pool
    if _pool is not None:
        return _pool
    try:
        import aiomysql
        _pool = await aiomysql.create_pool(
            host=os.getenv("AVA_MYSQL_HOST", "127.0.0.1"),
            port=int(os.getenv("AVA_MYSQL_PORT", "3306").split("#")[0].strip()),
            user=os.getenv("AVA_MYSQL_USER", "ava"),
            password=os.getenv("AVA_MYSQL_PASSWORD", ""),
            db=os.getenv("AVA_MYSQL_DATABASE", "ava_core"),
            autocommit=True,
            minsize=1,
            maxsize=3,
            connect_timeout=5,
        )
        log.info("MySQL pool connected → %s:%s/%s",
                 os.getenv("AVA_MYSQL_HOST"), os.getenv("AVA_MYSQL_PORT"),
                 os.getenv("AVA_MYSQL_DATABASE"))
        return _pool
    except Exception as e:
        log.warning("MySQL pool unavailable: %s", e)
        return None


async def query(sql: str, args: tuple = ()) -> list[dict[str, Any]]:
    """Run a SELECT query, return list of dicts. Returns [] on failure."""
    pool = await _get_pool()
    if not pool:
        return []
    try:
        async with pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(sql, args)
                return await cur.fetchall()
    except Exception as e:
        log.warning("MySQL query failed: %s", e)
        return []


async def execute(sql: str, args: tuple = ()) -> int:
    """Run INSERT/UPDATE/DELETE. Returns affected rows or -1 on failure."""
    pool = await _get_pool()
    if not pool:
        return -1
    try:
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(sql, args)
                return cur.rowcount
    except Exception as e:
        log.warning("MySQL execute failed: %s", e)
        return -1


async def log_cron_run(job_id: str, started_at: int, finished_at: int,
                       ok: bool, detail: str = "", error: str = "") -> None:
    """Write a cron run record to ava_cron.cron_runs (matches old Node.js schema)."""
    try:
        import aiomysql
        pool = await _get_pool()
        if not pool:
            return
        # Use ava_cron database
        async with pool.acquire() as conn:
            await conn.select_db("ava_cron")
            async with conn.cursor() as cur:
                await cur.execute(
                    """INSERT INTO cron_runs
                       (job_id, started_at, finished_at, ok, detail, error)
                       VALUES (%s, %s, %s, %s, %s, %s)""",
                    (job_id, started_at, finished_at, int(ok),
                     detail[:65000] if detail else "",
                     error[:65000] if error else ""),
                )
                await cur.execute(
                    """INSERT INTO cron_watermarks
                       (job_id, last_started_at, last_finished_at, last_ok,
                        last_detail, last_error, run_count, updated_at)
                       VALUES (%s, %s, %s, %s, %s, %s, 1, %s)
                       ON DUPLICATE KEY UPDATE
                         last_started_at=VALUES(last_started_at),
                         last_finished_at=VALUES(last_finished_at),
                         last_ok=VALUES(last_ok),
                         last_detail=VALUES(last_detail),
                         last_error=VALUES(last_error),
                         run_count=run_count+1,
                         updated_at=VALUES(updated_at)""",
                    (job_id, started_at, finished_at, int(ok),
                     detail[:65000] if detail else "",
                     error[:65000] if error else "",
                     finished_at),
                )
    except Exception as e:
        log.warning("log_cron_run failed: %s", e)

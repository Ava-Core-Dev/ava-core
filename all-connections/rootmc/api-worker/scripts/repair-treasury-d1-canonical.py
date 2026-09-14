#!/usr/bin/env python3
"""Deduplicate treasury D1 rows and resync from MySQL (source of truth).

- Drops ledger/sync/snapshots under heartbeat server_id (duplicate key).
- Rebuilds rootmc_treasury_ledger on server_id=rootmc from MySQL.
- Sets treasury_balance from MySQL towny-server vault (not ledger net).
"""
import datetime as dt
import json
import os
import subprocess
import tempfile
from pathlib import Path

import pymysql

TREASURY_SERVER_ID = "rootmc"
HEARTBEAT_SERVER_ID = "15bbc057-4f8b-4761-abdb-7b7e4d9c7512"
TOWNY_SERVER_UUID = "a73f39b0-1b7c-2930-b4a3-ce101812d926"
WRANGLER_DB = "rootmc"
WRANGLER_DIR = Path(__file__).resolve().parents[1]

MYSQL_HOST = os.getenv("ROOTMC_MYSQL_HOST", "mysql.shockbyte.hil2.shockbyte.host")
MYSQL_PORT = int(os.getenv("ROOTMC_MYSQL_PORT", "3306"))
MYSQL_DB = os.getenv("ROOTMC_MYSQL_DB", "75eedc3b19-rootmc")
MYSQL_USER = os.getenv("ROOTMC_MYSQL_USER", "75eedc3b19-rootmc-admin")
MYSQL_PASS = os.getenv("ROOTMC_MYSQL_PASS", "f07ea7816c8b4a71")


def sql_escape(value: str) -> str:
    return value.replace("'", "''")


def d1_exec(sql: str):
    env = dict(os.environ)
    if not env.get("CLOUDFLARE_API_TOKEN", "").strip():
        raise RuntimeError("CLOUDFLARE_API_TOKEN required")
    sql_one_line = " ".join(sql.split())
    cmd = (
        f'npx wrangler d1 execute {WRANGLER_DB} --remote --json '
        f'--command "{sql_one_line.replace(chr(34), chr(92) + chr(34))}"'
    )
    res = subprocess.run(cmd, cwd=WRANGLER_DIR, env=env, check=True, capture_output=True, text=True, shell=True)
    payload = json.loads(res.stdout)
    if not payload or not payload[0].get("success"):
        raise RuntimeError(f"D1 failed: {res.stdout}")
    return payload[0]["results"]


def d1_exec_file(sql: str):
    env = dict(os.environ)
    if not env.get("CLOUDFLARE_API_TOKEN", "").strip():
        raise RuntimeError("CLOUDFLARE_API_TOKEN required")
    with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False, encoding="utf-8") as f:
        f.write(sql)
        sql_path = f.name
    try:
        cmd = f'npx wrangler d1 execute {WRANGLER_DB} --remote --json --file "{sql_path}"'
        res = subprocess.run(cmd, cwd=WRANGLER_DIR, env=env, capture_output=True, text=True, shell=True)
        if res.returncode != 0:
            raise RuntimeError(f"D1 file execute failed: {res.stderr or res.stdout}")
        out = res.stdout.strip()
        json_start = out.find("[")
        if json_start < 0:
            raise RuntimeError(f"D1 file execute non-JSON: {out}")
        payload = json.loads(out[json_start:])
        if not payload or not payload[0].get("success"):
            raise RuntimeError(f"D1 file execute failed: {res.stdout}")
    finally:
        try:
            os.remove(sql_path)
        except OSError:
            pass


def sync_mysql_ledger_to_d1(conn) -> int:
    synced = dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z")
    cur = conn.cursor()
    cur.execute(
        "SELECT id, entry_type, amount, from_uuid, to_uuid, details, created_at "
        "FROM root_treasury_ledger WHERE id > 0 ORDER BY id ASC"
    )
    batch: list[str] = []
    count = 0

    def flush():
        nonlocal count
        if not batch:
            return
        d1_exec_file(";\n".join(batch) + ";")
        count += len(batch)
        batch.clear()

    for mysql_id, entry_type, amount, from_uuid, to_uuid, details, created_at in cur.fetchall():
        mysql_id = int(mysql_id)
        amt = round(float(amount), 2)
        if amt <= 0:
            continue
        created = created_at.isoformat().replace("+00:00", "Z") if hasattr(created_at, "isoformat") else str(created_at)
        from_sql = "NULL" if not from_uuid else f"'{sql_escape(str(from_uuid))}'"
        to_sql = "NULL" if not to_uuid else f"'{sql_escape(str(to_uuid))}'"
        det_sql = "NULL" if not details else f"'{sql_escape(str(details)[:512])}'"
        batch.append(
            "INSERT INTO rootmc_treasury_ledger "
            "(server_id, mysql_id, entry_type, amount, from_uuid, to_uuid, details, created_at, synced_at) "
            f"VALUES ('{sql_escape(TREASURY_SERVER_ID)}', {mysql_id}, '{sql_escape(str(entry_type).upper())}', {amt}, "
            f"{from_sql}, {to_sql}, {det_sql}, '{sql_escape(created)}', '{sql_escape(synced)}') "
            "ON CONFLICT(server_id, mysql_id) DO UPDATE SET "
            "entry_type = excluded.entry_type, amount = excluded.amount, "
            "from_uuid = excluded.from_uuid, to_uuid = excluded.to_uuid, "
            "details = excluded.details, created_at = excluded.created_at, synced_at = excluded.synced_at"
        )
        if len(batch) >= 80:
            flush()
    flush()
    return count


def main():
    for sid in (HEARTBEAT_SERVER_ID,):
        if sid == TREASURY_SERVER_ID:
            continue
        print(f"Removing duplicate D1 treasury data for server_id={sid} ...")
        d1_exec(f"DELETE FROM rootmc_treasury_ledger WHERE server_id = '{sql_escape(sid)}'")
        d1_exec(f"DELETE FROM rootmc_treasury_sync_state WHERE server_id = '{sql_escape(sid)}'")
        d1_exec(f"DELETE FROM rootmc_treasury_balance_snapshots WHERE server_id = '{sql_escape(sid)}'")

    conn = pymysql.connect(
        host=MYSQL_HOST,
        port=MYSQL_PORT,
        user=MYSQL_USER,
        password=MYSQL_PASS,
        database=MYSQL_DB,
        charset="utf8mb4",
    )
    try:
        cur = conn.cursor()
        cur.execute("SELECT balance FROM root_economy_balances WHERE minecraft_uuid = %s LIMIT 1", (TOWNY_SERVER_UUID,))
        vault_row = cur.fetchone()
        vault = round(float(vault_row[0]), 2) if vault_row else 0.0
        cur.execute("SELECT MAX(id) FROM root_treasury_ledger")
        last_id = int(cur.fetchone()[0] or 0)
        cur.execute("SELECT COUNT(*) FROM root_treasury_ledger")
        mysql_rows = int(cur.fetchone()[0])

        print(f"MySQL vault={vault} G, ledger rows={mysql_rows}, last_id={last_id}")
        print("Resyncing MySQL ledger -> D1 (server_id=rootmc) ...")
        synced_count = sync_mysql_ledger_to_d1(conn)
        print(f"Upserted {synced_count} row(s) into D1.")
        cur.execute("SELECT id FROM root_treasury_ledger")
        mysql_ids = {int(r[0]) for r in cur.fetchall()}
    finally:
        conn.close()

    if mysql_ids:
        d1_ledger = d1_exec(
            f"SELECT mysql_id FROM rootmc_treasury_ledger WHERE server_id = '{sql_escape(TREASURY_SERVER_ID)}'"
        )
        orphans = [int(r["mysql_id"]) for r in d1_ledger if int(r["mysql_id"]) not in mysql_ids]
        if orphans:
            print(f"Removing {len(orphans)} orphaned D1 row(s): {orphans[:20]}{'...' if len(orphans) > 20 else ''}")
            for oid in orphans:
                d1_exec(
                    f"DELETE FROM rootmc_treasury_ledger WHERE server_id = '{sql_escape(TREASURY_SERVER_ID)}' "
                    f"AND mysql_id = {oid}"
                )

    conn = pymysql.connect(
        host=MYSQL_HOST,
        port=MYSQL_PORT,
        user=MYSQL_USER,
        password=MYSQL_PASS,
        database=MYSQL_DB,
        charset="utf8mb4",
    )
    try:
        cur = conn.cursor()
        cur.execute("SELECT balance FROM root_economy_balances WHERE minecraft_uuid = %s LIMIT 1", (TOWNY_SERVER_UUID,))
        vault_row = cur.fetchone()
        vault = round(float(vault_row[0]), 2) if vault_row else 0.0
        cur.execute("SELECT MAX(id) FROM root_treasury_ledger")
        last_id = int(cur.fetchone()[0] or 0)
    finally:
        conn.close()

    synced = dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z")
    d1_exec(
        "INSERT INTO rootmc_treasury_sync_state (server_id, last_ledger_mysql_id, updated_at, treasury_balance) "
        f"VALUES ('{sql_escape(TREASURY_SERVER_ID)}', {last_id}, '{sql_escape(synced)}', {vault}) "
        "ON CONFLICT(server_id) DO UPDATE SET "
        "treasury_balance = excluded.treasury_balance, "
        "last_ledger_mysql_id = MAX(rootmc_treasury_sync_state.last_ledger_mysql_id, excluded.last_ledger_mysql_id), "
        "updated_at = excluded.updated_at"
    )

    state = d1_exec(
        f"SELECT treasury_balance, last_ledger_mysql_id FROM rootmc_treasury_sync_state "
        f"WHERE server_id = '{sql_escape(TREASURY_SERVER_ID)}'"
    )
    d1_rows = d1_exec(
        f"SELECT COUNT(*) AS c FROM rootmc_treasury_ledger WHERE server_id = '{sql_escape(TREASURY_SERVER_ID)}'"
    )
    print(f"D1 sync_state: {state}")
    print(f"D1 canonical ledger rows: {d1_rows[0]['c'] if d1_rows else '?'}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Insert one OPENING ledger row so vault balance = sum(ledger) assuming start 0.

Bridges pre-/grant /eco give into the tracked ledger without affecting the current HST month.
"""
import argparse
import datetime as dt
import json
import os
import subprocess
import tempfile

import pymysql

MYSQL_HOST = os.getenv("ROOTMC_MYSQL_HOST", "mysql.shockbyte.hil2.shockbyte.host")
MYSQL_PORT = int(os.getenv("ROOTMC_MYSQL_PORT", "3306"))
MYSQL_DB = os.getenv("ROOTMC_MYSQL_DB", "75eedc3b19-rootmc")
MYSQL_USER = os.getenv("ROOTMC_MYSQL_USER", "75eedc3b19-rootmc-admin")
MYSQL_PASS = os.getenv("ROOTMC_MYSQL_PASS", "f07ea7816c8b4a71")

TOWNY_SERVER_UUID = "a73f39b0-1b7c-2930-b4a3-ce101812d926"
SERVER_ID = "rootmc"
WRANGLER_DB = "rootmc"
WRANGLER_DIR = r"c:\Users\rrdeveloper\Desktop\RootMC Workspace\Web Files\rootmc-api"
OPENING_MYSQL_ID = -9001
OPENING_DETAILS = "legacy:pre-grant-eco-seed"

INFLOW_TYPES = ("OPENING", "TAX", "DEATH", "TOWNY_SINK", "LOAN_PRINCIPAL", "LOAN_INTEREST")
OUTFLOW_TYPES = ("GRANT", "DIVIDEND", "LOAN_DISBURSE", "VOTE")


def sql_escape(value: str) -> str:
    return value.replace("'", "''")


def d1_query(sql: str):
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
        raise RuntimeError(f"D1 query failed: {res.stdout}")
    return payload[0]["results"]


def d1_exec(sql: str):
    sql_one_line = " ".join(sql.split())
    d1_query(sql_one_line)


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


def ledger_net(rows):
    inflow = outflow = 0.0
    for row in rows:
        t = str(row.get("entry_type", "")).upper()
        amt = float(row.get("total") or 0)
        if t in INFLOW_TYPES:
            inflow += amt
        elif t in OUTFLOW_TYPES:
            outflow += amt
    return round(inflow - outflow, 2)


def read_ledger_net_mysql():
    conn = pymysql.connect(
        host=MYSQL_HOST, port=MYSQL_PORT, user=MYSQL_USER, password=MYSQL_PASS,
        database=MYSQL_DB, charset="utf8mb4",
    )
    try:
        cur = conn.cursor()
        cur.execute("SELECT entry_type, COALESCE(SUM(amount),0) FROM root_treasury_ledger GROUP BY entry_type")
        rows = [{"entry_type": r[0], "total": float(r[1])} for r in cur.fetchall()]
        return ledger_net(rows)
    finally:
        conn.close()


def read_vault_balance_d1():
    rows = d1_query(
        f"SELECT treasury_balance FROM rootmc_treasury_sync_state WHERE server_id = '{sql_escape(SERVER_ID)}' LIMIT 1"
    )
    if not rows:
        return None
    bal = rows[0].get("treasury_balance")
    return float(bal) if bal is not None else None


def read_vault_balance_mysql():
    conn = pymysql.connect(
        host=MYSQL_HOST, port=MYSQL_PORT, user=MYSQL_USER, password=MYSQL_PASS,
        database=MYSQL_DB, charset="utf8mb4",
    )
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT balance FROM root_economy_balances WHERE minecraft_uuid = %s LIMIT 1",
            (TOWNY_SERVER_UUID,),
        )
        row = cur.fetchone()
        return float(row[0]) if row else None
    finally:
        conn.close()


def sync_mysql_ledger_to_d1():
    conn = pymysql.connect(
        host=MYSQL_HOST, port=MYSQL_PORT, user=MYSQL_USER, password=MYSQL_PASS,
        database=MYSQL_DB, charset="utf8mb4",
    )
    synced = dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z")
    count = 0
    batch: list[str] = []
    batch_size = 80

    def flush():
        nonlocal count
        if not batch:
            return
        d1_exec_file(";\n".join(batch) + ";")
        count += len(batch)
        batch.clear()

    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT id, entry_type, amount, from_uuid, to_uuid, details, created_at "
            "FROM root_treasury_ledger ORDER BY id ASC"
        )
        for mysql_id, entry_type, amount, from_uuid, to_uuid, details, created_at in cur.fetchall():
            mysql_id = int(mysql_id)
            if mysql_id <= 0:
                continue
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
                f"VALUES ('{sql_escape(SERVER_ID)}', {mysql_id}, '{sql_escape(str(entry_type).upper())}', {amt}, "
                f"{from_sql}, {to_sql}, {det_sql}, '{sql_escape(created)}', '{sql_escape(synced)}') "
                "ON CONFLICT(server_id, mysql_id) DO UPDATE SET "
                "entry_type = excluded.entry_type, amount = excluded.amount, "
                "from_uuid = excluded.from_uuid, to_uuid = excluded.to_uuid, "
                "details = excluded.details, created_at = excluded.created_at, synced_at = excluded.synced_at"
            )
            if len(batch) >= batch_size:
                flush()
        flush()
    finally:
        conn.close()
    print(f"Synced {count} MySQL treasury ledger row(s) into D1.")


def purge_synthetic_d1_backfill():
    """Drop pre-MySQL Towny backfill rows (negative mysql_id) so D1 net matches MySQL + OPENING."""
    d1_exec(
        f"DELETE FROM rootmc_treasury_ledger WHERE server_id = '{sql_escape(SERVER_ID)}' "
        f"AND mysql_id < 0 AND mysql_id != {OPENING_MYSQL_ID}"
    )
    print("Purged synthetic D1 backfill rows (negative mysql_id).")


def upsert_sync_state_balance(balance: float):
    synced = dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z")
    bal = round(float(balance), 2)
    d1_exec(
        "INSERT INTO rootmc_treasury_sync_state (server_id, last_ledger_mysql_id, updated_at, treasury_balance) "
        f"VALUES ('{sql_escape(SERVER_ID)}', "
        f"COALESCE((SELECT MAX(mysql_id) FROM rootmc_treasury_ledger WHERE server_id = '{sql_escape(SERVER_ID)}' AND mysql_id > 0), 0), "
        f"'{sql_escape(synced)}', {bal}) "
        "ON CONFLICT(server_id) DO UPDATE SET "
        "treasury_balance = excluded.treasury_balance, "
        "last_ledger_mysql_id = MAX(rootmc_treasury_sync_state.last_ledger_mysql_id, excluded.last_ledger_mysql_id), "
        "updated_at = excluded.updated_at"
    )
    print(f"Updated treasury_sync_state balance to {bal}.")


def opening_exists():
    rows = d1_query(
        f"SELECT mysql_id FROM rootmc_treasury_ledger WHERE server_id = '{sql_escape(SERVER_ID)}' "
        f"AND entry_type = 'OPENING' LIMIT 1"
    )
    return bool(rows)


def prior_hst_month_opening_iso():
    """One second before current HST month start (UTC 10:00 on 1st)."""
    now = dt.datetime.now(dt.UTC)
    hst = now - dt.timedelta(hours=10)
    start = dt.datetime(hst.year, hst.month, 1, 10, 0, 0, tzinfo=dt.UTC)
    opening = start - dt.timedelta(seconds=1)
    return opening.isoformat().replace("+00:00", "Z")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force", action="store_true", help="Replace existing OPENING row")
    parser.add_argument("--amount", type=float, default=0, help="Override gap amount")
    parser.add_argument("--skip-mysql-sync", action="store_true")
    args = parser.parse_args()

    if not args.skip_mysql_sync:
        sync_mysql_ledger_to_d1()

    purge_synthetic_d1_backfill()

    if opening_exists() and not args.force:
        print("OPENING entry already exists. Use --force to replace.")
        return

    rows = d1_query(
        f"SELECT entry_type, COALESCE(SUM(amount),0) AS total FROM rootmc_treasury_ledger "
        f"WHERE server_id = '{sql_escape(SERVER_ID)}' GROUP BY entry_type"
    )
    net_d1 = ledger_net(rows)
    try:
        net_mysql = read_ledger_net_mysql()
    except Exception as ex:
        print(f"MySQL ledger read failed ({ex}); using D1 only.")
        net_mysql = net_d1
    net = net_mysql
    if net_d1 != net_mysql:
        print(f"D1 ledger net={net_d1}, MySQL ledger net={net_mysql}; using MySQL for gap.")
    vault = read_vault_balance_d1()
    if vault is None:
        vault = read_vault_balance_mysql()
    if vault is None:
        raise RuntimeError("Could not read towny-server vault balance from D1 or MySQL")

    gap = round(args.amount, 2) if args.amount > 0 else round(vault - net, 2)
    if gap <= 0.01:
        print(f"No opening needed (vault={vault}, ledger_net={net}, gap={gap})")
        upsert_sync_state_balance(vault)
        return

    created = prior_hst_month_opening_iso()
    synced = dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z")
    print(f"Vault balance: {vault}")
    print(f"Ledger net (excl. OPENING): {net}")
    print(f"OPENING amount: {gap}")
    print(f"created_at: {created}")

    if args.dry_run:
        print("Dry run — no D1 write.")
        return

    if args.force and opening_exists():
        d1_exec(
            f"DELETE FROM rootmc_treasury_ledger WHERE server_id = '{sql_escape(SERVER_ID)}' "
            f"AND entry_type = 'OPENING'"
        )

    d1_exec(
        "INSERT INTO rootmc_treasury_ledger "
        "(server_id, mysql_id, entry_type, amount, from_uuid, to_uuid, details, created_at, synced_at) "
        f"VALUES ('{sql_escape(SERVER_ID)}', {OPENING_MYSQL_ID}, 'OPENING', {gap}, NULL, "
        f"'{sql_escape(TOWNY_SERVER_UUID)}', '{sql_escape(OPENING_DETAILS)}', "
        f"'{sql_escape(created)}', '{sql_escape(synced)}')"
    )
    upsert_sync_state_balance(vault)
    print("OPENING reconciliation inserted.")


if __name__ == "__main__":
    main()

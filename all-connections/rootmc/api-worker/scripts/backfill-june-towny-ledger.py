#!/usr/bin/env python3
"""One-time Towny founding/claim/bonus ledger backfill from live Towny MySQL tables.

Inserts TOWNY_SINK rows into root_treasury_ledger (MySQL), syncs to D1, and sets
towny-server reserve balance to the ledger net so June HST month intake is tracked.
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

NEW_TOWN_GOLD = 400.0
NEW_NATION_GOLD = 2000.0
CLAIM_BASE = 12.0
CLAIM_MULT = 1.12
BONUS_BASE = 500.0
BONUS_MULT = 1.12
BACKFILL_PREFIX = "backfill:towny:"


def sql_escape(value: str) -> str:
    return value.replace("'", "''")


def claim_price(n: int) -> float:
    return round(CLAIM_BASE * (CLAIM_MULT ** (n - 1)), 2)


def bonus_price(n: int) -> float:
    return round(BONUS_BASE * (BONUS_MULT ** n), 2)


def ms_to_iso(ms: int) -> str:
    return dt.datetime.fromtimestamp(ms / 1000, tz=dt.UTC).strftime("%Y-%m-%dT%H:%M:%S.000Z")


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
    d1_query(" ".join(sql.split()))


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


def build_entries(conn) -> list[tuple[float, str, str, str]]:
    """(amount, from_uuid, created_at_iso, details)"""
    cur = conn.cursor()
    entries: list[tuple[float, str, str, str]] = []

    cur.execute(
        "SELECT t.name, t.registered, t.mayor, tb.claimedAt "
        "FROM TOWNY_TOWNS t "
        "LEFT JOIN TOWNY_TOWNBLOCKS tb ON tb.town = t.uuid "
        "ORDER BY t.registered, tb.claimedAt"
    )
    towns: dict[str, dict] = {}
    for name, registered, mayor, claimed_at in cur.fetchall():
        if name not in towns:
            towns[name] = {"registered": registered, "mayor": mayor, "claims": []}
        if claimed_at:
            towns[name]["claims"].append(claimed_at)

    for name in sorted(towns.keys(), key=lambda n: towns[n]["registered"]):
        meta = towns[name]
        mayor = str(meta["mayor"])
        reg_iso = ms_to_iso(int(meta["registered"]))
        entries.append((NEW_TOWN_GOLD, mayor, reg_iso, f"{BACKFILL_PREFIX}new-town:{name}"))
        for i, ca in enumerate(sorted(meta["claims"]), 1):
            entries.append(
                (claim_price(i), mayor, ms_to_iso(int(ca)), f"{BACKFILL_PREFIX}claim:{name}:{i}")
            )

    cur.execute("SELECT name, registered, capital FROM TOWNY_NATIONS ORDER BY registered")
    for nname, registered, capital in cur.fetchall():
        cur.execute("SELECT mayor FROM TOWNY_TOWNS WHERE uuid = %s LIMIT 1", (capital,))
        row = cur.fetchone()
        if not row:
            continue
        mayor = str(row[0])
        entries.append(
            (NEW_NATION_GOLD, mayor, ms_to_iso(int(registered)), f"{BACKFILL_PREFIX}new-nation:{nname}")
        )

    cur.execute("SELECT name, mayor, purchased, registered FROM TOWNY_TOWNS WHERE purchased > 0")
    for name, mayor, purchased, registered in cur.fetchall():
        mayor = str(mayor)
        base_ms = int(registered) + 300_000
        for i in range(int(purchased)):
            entries.append(
                (
                    bonus_price(i),
                    mayor,
                    ms_to_iso(base_ms + i * 1000),
                    f"{BACKFILL_PREFIX}bonus-block:{name}:{i + 1}",
                )
            )

    return entries


def backfill_exists_mysql(conn) -> bool:
    cur = conn.cursor()
    cur.execute(
        "SELECT COUNT(*) FROM root_treasury_ledger WHERE details LIKE %s LIMIT 1",
        (BACKFILL_PREFIX + "%",),
    )
    return int(cur.fetchone()[0]) > 0


def insert_mysql(conn, entries: list[tuple[float, str, str, str]]) -> list[tuple[int, float, str, str, str, str]]:
    """Returns rows as (mysql_id, amount, from_uuid, to_uuid, details, created_at)."""
    cur = conn.cursor()
    inserted: list[tuple[int, float, str, str, str, str]] = []
    for amount, from_uuid, created_at, details in entries:
        cur.execute(
            "INSERT INTO root_treasury_ledger (entry_type, amount, from_uuid, to_uuid, details, created_at) "
            "VALUES ('TOWNY_SINK', %s, %s, %s, %s, %s)",
            (amount, from_uuid, TOWNY_SERVER_UUID, details, created_at.replace("T", " ").replace("Z", "")),
        )
        mysql_id = int(cur.lastrowid)
        inserted.append((mysql_id, amount, from_uuid, TOWNY_SERVER_UUID, details, created_at))
    conn.commit()
    return inserted


def ledger_net_mysql(conn) -> float:
    cur = conn.cursor()
    cur.execute(
        "SELECT entry_type, COALESCE(SUM(amount),0) FROM root_treasury_ledger GROUP BY entry_type"
    )
    inflow_types = {"OPENING", "TAX", "DEATH", "TOWNY_SINK", "LOAN_PRINCIPAL", "LOAN_INTEREST"}
    outflow_types = {"GRANT", "DIVIDEND", "LOAN_DISBURSE", "VOTE"}
    net = 0.0
    for entry_type, total in cur.fetchall():
        t = str(entry_type).upper()
        amt = float(total)
        if t in inflow_types:
            net += amt
        elif t in outflow_types:
            net -= amt
    return round(net, 2)


def update_mysql_reserve(conn, balance: float):
    cur = conn.cursor()
    cur.execute(
        "UPDATE root_economy_balances SET balance = %s WHERE LOWER(minecraft_uuid) = LOWER(%s)",
        (balance, TOWNY_SERVER_UUID),
    )
    conn.commit()
    print(f"MySQL towny-server balance -> {balance}")


def sync_rows_to_d1(rows: list[tuple[int, float, str, str, str, str]]):
    synced = dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z")
    batch: list[str] = []
    batch_size = 80

    def flush():
        if not batch:
            return
        d1_exec_file(";\n".join(batch) + ";")
        batch.clear()

    for mysql_id, amount, from_uuid, to_uuid, details, created_at in rows:
        from_sql = f"'{sql_escape(from_uuid)}'"
        to_sql = f"'{sql_escape(to_uuid)}'"
        det_sql = f"'{sql_escape(details[:512])}'"
        batch.append(
            "INSERT INTO rootmc_treasury_ledger "
            "(server_id, mysql_id, entry_type, amount, from_uuid, to_uuid, details, created_at, synced_at) "
            f"VALUES ('{sql_escape(SERVER_ID)}', {mysql_id}, 'TOWNY_SINK', {round(amount, 2)}, "
            f"{from_sql}, {to_sql}, {det_sql}, '{sql_escape(created_at)}', '{sql_escape(synced)}') "
            "ON CONFLICT(server_id, mysql_id) DO UPDATE SET "
            "entry_type = excluded.entry_type, amount = excluded.amount, "
            "from_uuid = excluded.from_uuid, to_uuid = excluded.to_uuid, "
            "details = excluded.details, created_at = excluded.created_at, synced_at = excluded.synced_at"
        )
        if len(batch) >= batch_size:
            flush()
    flush()
    print(f"Synced {len(rows)} row(s) to D1.")


def upsert_d1_sync_state(balance: float, last_mysql_id: int):
    synced = dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z")
    bal = round(float(balance), 2)
    d1_exec(
        "INSERT INTO rootmc_treasury_sync_state (server_id, last_ledger_mysql_id, updated_at, treasury_balance) "
        f"VALUES ('{sql_escape(SERVER_ID)}', {last_mysql_id}, '{sql_escape(synced)}', {bal}) "
        "ON CONFLICT(server_id) DO UPDATE SET "
        "treasury_balance = excluded.treasury_balance, "
        "last_ledger_mysql_id = MAX(rootmc_treasury_sync_state.last_ledger_mysql_id, excluded.last_ledger_mysql_id), "
        "updated_at = excluded.updated_at"
    )
    print(f"D1 treasury_sync_state balance -> {bal}, last_ledger_mysql_id >= {last_mysql_id}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force", action="store_true", help="Delete existing backfill rows and re-insert")
    args = parser.parse_args()

    conn = pymysql.connect(
        host=MYSQL_HOST,
        port=MYSQL_PORT,
        user=MYSQL_USER,
        password=MYSQL_PASS,
        database=MYSQL_DB,
        charset="utf8mb4",
    )
    try:
        entries = build_entries(conn)
        total = round(sum(e[0] for e in entries), 2)
        print(f"Planned {len(entries)} TOWNY_SINK rows, total {total} G")

        if backfill_exists_mysql(conn):
            if not args.force:
                print("Backfill rows already exist. Use --force to replace.")
                net = ledger_net_mysql(conn)
                print(f"Current ledger net: {net}")
                return
            if not args.dry_run:
                cur = conn.cursor()
                cur.execute("DELETE FROM root_treasury_ledger WHERE details LIKE %s", (BACKFILL_PREFIX + "%",))
                conn.commit()
                d1_exec(
                    f"DELETE FROM rootmc_treasury_ledger WHERE server_id = '{sql_escape(SERVER_ID)}' "
                    f"AND details LIKE '{sql_escape(BACKFILL_PREFIX)}%'"
                )
                print("Removed prior backfill rows.")

        if args.dry_run:
            for e in entries[:5]:
                print(" ", e)
            print(" ...")
            for e in entries[-3:]:
                print(" ", e)
            print("Dry run — no writes.")
            return

        inserted = insert_mysql(conn, entries)
        net = ledger_net_mysql(conn)
        update_mysql_reserve(conn, net)
        sync_rows_to_d1(inserted)
        last_id = max(r[0] for r in inserted)
        upsert_d1_sync_state(net, last_id)
        print("June Towny ledger backfill complete.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()

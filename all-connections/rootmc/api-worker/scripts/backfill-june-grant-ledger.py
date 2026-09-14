#!/usr/bin/env python3
"""Backfill founding /grant outflows into root_treasury_ledger (ledger only).

Records staff grants that funded first town founding (400 G) and nation founding
(2,000 G for ZuppaFredda / Althaea). Elythin (Montania) is excluded — self-funded.
Does not change player balances or towny-server vault balance.
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
GRANT_LEAD_MS = 120_000  # grant logged shortly before matching Towny founding fee
BACKFILL_PREFIX = "backfill:grant:"

# Elythin self-funded Montania founding — no staff grant.
SKIP_TOWN_GRANT_MAYOR_UUID = "a26b1be5-96c1-4c0c-84f9-73bc7ad214b8"


def sql_escape(value: str) -> str:
    return value.replace("'", "''")


def ms_to_iso(ms: int) -> str:
    return dt.datetime.fromtimestamp(ms / 1000, tz=dt.UTC).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def ms_to_mysql(ms: int) -> str:
    return ms_to_iso(ms).replace("T", " ").replace("Z", "")


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


def mayor_name(conn, mayor_uuid: str) -> str:
    cur = conn.cursor()
    cur.execute(
        "SELECT minecraft_username FROM root_economy_balances WHERE minecraft_uuid = %s LIMIT 1",
        (mayor_uuid,),
    )
    row = cur.fetchone()
    return str(row[0]) if row and row[0] else mayor_uuid[:8]


def build_entries(conn) -> list[tuple[float, str, str, str, str]]:
    """(amount, from_uuid, to_uuid, created_at_iso, details)

    Each grant is stamped just before its matching town/nation founding so they
    share the same HST calendar day on the reserve page.
    """
    cur = conn.cursor()
    entries: list[tuple[float, str, str, str, str]] = []

    cur.execute("SELECT name, mayor, registered FROM TOWNY_TOWNS ORDER BY registered")
    for town, mayor, registered in cur.fetchall():
        mayor = str(mayor)
        if mayor.lower() == SKIP_TOWN_GRANT_MAYOR_UUID.lower():
            print(f"  skip town grant: {town} (Elythin / self-funded)")
            continue
        when = int(registered) - GRANT_LEAD_MS
        uname = mayor_name(conn, mayor)
        details = f"{BACKFILL_PREFIX}town:{town};player={uname};founding=400"
        entries.append((NEW_TOWN_GOLD, TOWNY_SERVER_UUID, mayor, ms_to_iso(when), details))

    cur.execute("SELECT name, capital, registered FROM TOWNY_NATIONS ORDER BY registered")
    for nation, capital, registered in cur.fetchall():
        cur.execute("SELECT mayor FROM TOWNY_TOWNS WHERE uuid = %s LIMIT 1", (capital,))
        row = cur.fetchone()
        if not row:
            continue
        mayor = str(row[0])
        when = int(registered) - GRANT_LEAD_MS
        uname = mayor_name(conn, mayor)
        details = f"{BACKFILL_PREFIX}nation:{nation};player={uname};founding=2000"
        entries.append((NEW_NATION_GOLD, TOWNY_SERVER_UUID, mayor, ms_to_iso(when), details))

    entries.sort(key=lambda e: e[3])
    return entries


def backfill_exists_mysql(conn) -> bool:
    cur = conn.cursor()
    cur.execute(
        "SELECT COUNT(*) FROM root_treasury_ledger WHERE details LIKE %s LIMIT 1",
        (BACKFILL_PREFIX + "%",),
    )
    return int(cur.fetchone()[0]) > 0


def insert_mysql(conn, entries: list[tuple[float, str, str, str, str]]) -> list[tuple[int, float, str, str, str, str]]:
    cur = conn.cursor()
    inserted: list[tuple[int, float, str, str, str, str]] = []
    for amount, from_uuid, to_uuid, created_at, details in entries:
        cur.execute(
            "INSERT INTO root_treasury_ledger (entry_type, amount, from_uuid, to_uuid, details, created_at) "
            "VALUES ('GRANT', %s, %s, %s, %s, %s)",
            (amount, from_uuid, to_uuid, details, created_at.replace("T", " ").replace("Z", "")),
        )
        mysql_id = int(cur.lastrowid)
        inserted.append((mysql_id, amount, from_uuid, to_uuid, details, created_at))
    conn.commit()
    return inserted


def sync_rows_to_d1(rows: list[tuple[int, float, str, str, str, str]]):
    synced = dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z")
    batch: list[str] = []

    def flush():
        if not batch:
            return
        d1_exec_file(";\n".join(batch) + ";")
        batch.clear()

    for mysql_id, amount, from_uuid, to_uuid, details, created_at in rows:
        batch.append(
            "INSERT INTO rootmc_treasury_ledger "
            "(server_id, mysql_id, entry_type, amount, from_uuid, to_uuid, details, created_at, synced_at) "
            f"VALUES ('{sql_escape(SERVER_ID)}', {mysql_id}, 'GRANT', {round(amount, 2)}, "
            f"'{sql_escape(from_uuid)}', '{sql_escape(to_uuid)}', '{sql_escape(details[:512])}', "
            f"'{sql_escape(created_at)}', '{sql_escape(synced)}') "
            "ON CONFLICT(server_id, mysql_id) DO UPDATE SET "
            "entry_type = excluded.entry_type, amount = excluded.amount, "
            "from_uuid = excluded.from_uuid, to_uuid = excluded.to_uuid, "
            "details = excluded.details, created_at = excluded.created_at, synced_at = excluded.synced_at"
        )
        if len(batch) >= 80:
            flush()
    flush()
    print(f"Synced {len(rows)} row(s) to D1.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force", action="store_true")
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
        print("Building grant entries from Towny founding data...")
        entries = build_entries(conn)
        total = round(sum(e[0] for e in entries), 2)
        print(f"Planned {len(entries)} GRANT rows, total outflow {total} G")

        if backfill_exists_mysql(conn):
            if not args.force:
                print("Grant backfill rows already exist. Use --force to replace.")
                return
            if not args.dry_run:
                cur = conn.cursor()
                cur.execute("DELETE FROM root_treasury_ledger WHERE details LIKE %s", (BACKFILL_PREFIX + "%",))
                conn.commit()
                d1_exec(
                    f"DELETE FROM rootmc_treasury_ledger WHERE server_id = '{sql_escape(SERVER_ID)}' "
                    f"AND details LIKE '{sql_escape(BACKFILL_PREFIX)}%'"
                )
                print("Removed prior grant backfill rows.")

        if args.dry_run:
            for e in entries:
                print(f"  {e[0]:>7.0f} G -> {e[4]} @ {e[3]}")
            print("Dry run — no writes.")
            return

        inserted = insert_mysql(conn, entries)
        sync_rows_to_d1(inserted)
        print("June grant ledger backfill complete (ledger only — vault & player balances unchanged).")
    finally:
        conn.close()


if __name__ == "__main__":
    main()

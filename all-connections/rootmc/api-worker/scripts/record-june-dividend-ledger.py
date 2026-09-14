#!/usr/bin/env python3
"""Record June 2026 activity dividend payouts in the treasury ledger (ledger only).

Inserts DIVIDEND outflows at HST 2026-07-01 00:00 without crediting player wallets
or debiting the live towny-server vault balance.
"""
import argparse
import datetime as dt
import json
import os
import subprocess
import tempfile
import uuid

import pymysql

MYSQL_HOST = os.getenv("ROOTMC_MYSQL_HOST", "mysql.shockbyte.hil2.shockbyte.host")
MYSQL_PORT = int(os.getenv("ROOTMC_MYSQL_PORT", "3306"))
MYSQL_DB = os.getenv("ROOTMC_MYSQL_DB", "75eedc3b19-rootmc")
MYSQL_USER = os.getenv("ROOTMC_MYSQL_USER", "75eedc3b19-rootmc-admin")
MYSQL_PASS = os.getenv("ROOTMC_MYSQL_PASS", "f07ea7816c8b4a71")

TOWNY_SERVER_UUID = "a73f39b0-1b7c-2930-b4a3-ce101812d926"
TREASURY_SERVER_ID = "rootmc"
FEATURED_SERVER_ID = "15bbc057-4f8b-4761-abdb-7b7e4d9c7512"
WRANGLER_DB = "rootmc"
WRANGLER_DIR = r"c:\Users\rrdeveloper\Desktop\RootMC Workspace\Web Files\rootmc-api"

MONTH_KEY = "2026-06"
# HST 2026-07-01 00:00:00
PAYOUT_AT_ISO = "2026-07-01T10:00:00.000Z"
PAYOUT_STAGGER_MS = 60_000
AMOUNT_EACH = 524.36
PLAYERS = ("ZuppaFredda", "Alexrs94")


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
    finally:
        try:
            os.remove(sql_path)
        except OSError:
            pass


def lookup_player(conn, username: str) -> tuple[str, str]:
    cur = conn.cursor()
    cur.execute(
        "SELECT minecraft_uuid, minecraft_username FROM root_economy_balances "
        "WHERE LOWER(minecraft_username) = LOWER(%s) LIMIT 1",
        (username,),
    )
    row = cur.fetchone()
    if not row:
        raise RuntimeError(f"Player not found in root_economy_balances: {username}")
    return str(row[0]), str(row[1] or username)


def payout_iso(index: int) -> str:
    base = dt.datetime.fromisoformat(PAYOUT_AT_ISO.replace("Z", "+00:00"))
    when = base + dt.timedelta(milliseconds=index * PAYOUT_STAGGER_MS)
    return when.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def existing_dividend_rows(conn) -> int:
    cur = conn.cursor()
    cur.execute(
        "SELECT COUNT(*) FROM root_treasury_ledger "
        "WHERE entry_type = 'DIVIDEND' AND details = %s",
        (f"month={MONTH_KEY}",),
    )
    return int(cur.fetchone()[0])


def insert_ledger(conn, players: list[tuple[str, str, str]]) -> list[tuple[int, float, str, str, str, str]]:
    details = f"month={MONTH_KEY}"
    cur = conn.cursor()
    inserted: list[tuple[int, float, str, str, str, str]] = []
    for index, (player_uuid, player_name, created_at) in enumerate(players):
        cur.execute(
            "INSERT INTO root_treasury_ledger (entry_type, amount, from_uuid, to_uuid, details, created_at) "
            "VALUES ('DIVIDEND', %s, %s, %s, %s, %s)",
            (
                AMOUNT_EACH,
                TOWNY_SERVER_UUID,
                player_uuid,
                details,
                created_at.replace("T", " ").replace("Z", ""),
            ),
        )
        mysql_id = int(cur.lastrowid)
        inserted.append((mysql_id, AMOUNT_EACH, TOWNY_SERVER_UUID, player_uuid, details, created_at))
        print(f"  DIVIDEND {AMOUNT_EACH} G -> {player_name} @ {created_at}")
    conn.commit()
    return inserted


def sync_ledger_to_d1(rows: list[tuple[int, float, str, str, str, str]]):
    synced = dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z")
    batch: list[str] = []
    for mysql_id, amount, from_uuid, to_uuid, details, created_at in rows:
        batch.append(
            "INSERT INTO rootmc_treasury_ledger "
            "(server_id, mysql_id, entry_type, amount, from_uuid, to_uuid, details, created_at, synced_at) "
            f"VALUES ('{sql_escape(TREASURY_SERVER_ID)}', {mysql_id}, 'DIVIDEND', {round(amount, 2)}, "
            f"'{sql_escape(from_uuid)}', '{sql_escape(to_uuid)}', '{sql_escape(details)}', "
            f"'{sql_escape(created_at)}', '{sql_escape(synced)}') "
            "ON CONFLICT(server_id, mysql_id) DO UPDATE SET "
            "entry_type = excluded.entry_type, amount = excluded.amount, "
            "from_uuid = excluded.from_uuid, to_uuid = excluded.to_uuid, "
            "details = excluded.details, created_at = excluded.created_at, synced_at = excluded.synced_at"
        )
    d1_exec_file(";\n".join(batch) + ";")
    print(f"Synced {len(rows)} DIVIDEND row(s) to D1 ledger.")


def upsert_dividend_metadata(players: list[tuple[str, str, str]]):
    pool = round(AMOUNT_EACH * len(players), 2)
    ts = PAYOUT_AT_ISO
    applied = PAYOUT_AT_ISO
    sid = sql_escape(FEATURED_SERVER_ID)
    mk = sql_escape(MONTH_KEY)

    d1_exec(
        f"DELETE FROM rootmc_treasury_dividend_payouts WHERE server_id = '{sid}' AND month_key = '{mk}'"
    )
    d1_exec(
        f"DELETE FROM rootmc_treasury_dividend_runs WHERE server_id = '{sid}' AND month_key = '{mk}'"
    )

    payout_sql: list[str] = []
    total_seconds = 0
    for player_uuid, player_name, created_at in players:
        payout_id = str(uuid.uuid4())
        payout_sql.append(
            "INSERT INTO rootmc_treasury_dividend_payouts "
            "(id, server_id, month_key, minecraft_uuid, minecraft_username, amount, status, created_at, applied_at) "
            f"VALUES ('{sql_escape(payout_id)}', '{sid}', '{mk}', '{sql_escape(player_uuid)}', "
            f"'{sql_escape(player_name)}', {AMOUNT_EACH}, 'applied', '{sql_escape(created_at)}', "
            f"'{sql_escape(applied)}')"
        )
        total_seconds += 72_000  # placeholder; not used on reserve page

    run_sql = (
        "INSERT INTO rootmc_treasury_dividend_runs "
        "(server_id, month_key, pool_amount, eligible_players, total_eligible_seconds, status, created_at) "
        f"VALUES ('{sid}', '{mk}', {pool}, {len(players)}, {total_seconds}, 'applied', '{sql_escape(ts)}')"
    )
    d1_exec_file(";\n".join(payout_sql + [run_sql]) + ";")
    print(f"D1 dividend run recorded for {MONTH_KEY}: pool {pool} G, {len(players)} players.")


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
        existing = existing_dividend_rows(conn)
        if existing and not args.force:
            print(f"DIVIDEND rows for month={MONTH_KEY} already exist ({existing}). Use --force to replace.")
            return

        resolved: list[tuple[str, str, str]] = []
        for index, name in enumerate(PLAYERS):
            player_uuid, player_name = lookup_player(conn, name)
            resolved.append((player_uuid, player_name, payout_iso(index)))

        total = round(AMOUNT_EACH * len(resolved), 2)
        print(f"Planned {len(resolved)} DIVIDEND rows, total outflow {total} G @ HST 2026-07-01 00:00")

        if args.dry_run:
            for row in resolved:
                print(f"  {AMOUNT_EACH} G -> {row[1]} ({row[0]}) @ {row[2]}")
            print("Dry run — no writes.")
            return

        if existing and args.force:
            cur = conn.cursor()
            cur.execute(
                "DELETE FROM root_treasury_ledger WHERE entry_type = 'DIVIDEND' AND details = %s",
                (f"month={MONTH_KEY}",),
            )
            conn.commit()
            d1_exec(
                f"DELETE FROM rootmc_treasury_ledger WHERE server_id = '{sql_escape(TREASURY_SERVER_ID)}' "
                f"AND entry_type = 'DIVIDEND' AND details = 'month={MONTH_KEY}'"
            )
            print("Removed prior DIVIDEND rows for this month.")

        inserted = insert_ledger(conn, resolved)
        sync_ledger_to_d1(inserted)
        upsert_dividend_metadata(resolved)
        print("June activity dividend ledger recorded (ledger only — no player vault credits).")
    finally:
        conn.close()


if __name__ == "__main__":
    main()

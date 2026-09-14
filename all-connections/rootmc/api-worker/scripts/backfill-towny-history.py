#!/usr/bin/env python3
import datetime as dt
import json
import os
import subprocess
import tempfile
import zlib

import pymysql


MYSQL_HOST = os.getenv("ROOTMC_MYSQL_HOST", "mysql.shockbyte.hil2.shockbyte.host")
MYSQL_PORT = int(os.getenv("ROOTMC_MYSQL_PORT", "3306"))
MYSQL_DB = os.getenv("ROOTMC_MYSQL_DB", "75eedc3b19-rootmc")
MYSQL_USER = os.getenv("ROOTMC_MYSQL_USER", "75eedc3b19-rootmc-admin")
MYSQL_PASS = os.getenv("ROOTMC_MYSQL_PASS", "f07ea7816c8b4a71")

SERVER_ID = os.getenv(
    "ROOTMC_SERVER_ID",
    "15bbc057-4f8b-4761-abdb-7b7e4d9c7512",
)
WRANGLER_DB = "rootmc"
WRANGLER_DIR = r"c:\Users\rrdeveloper\Desktop\RootMC Workspace\Web Files\rootmc-api"
TOWN_COST = float(os.getenv("ROOTMC_TOWNY_NEW_TOWN_COST", "400"))
NATION_COST = float(os.getenv("ROOTMC_TOWNY_NEW_NATION_COST", "2000"))


def sql_escape(value: str) -> str:
    return value.replace("'", "''")


def iso_from_millis(millis: int) -> str:
    return dt.datetime.fromtimestamp(millis / 1000.0, tz=dt.UTC).isoformat().replace("+00:00", "Z")


def d1_query(sql: str):
    env = dict(os.environ)
    token = env.get("CLOUDFLARE_API_TOKEN", "").strip()
    if not token:
        raise RuntimeError("CLOUDFLARE_API_TOKEN is required in environment.")
    sql_one_line = " ".join(sql.split())
    cmd = (
        f'npx wrangler d1 execute {WRANGLER_DB} --remote --json '
        f'--command "{sql_one_line.replace(chr(34), chr(92) + chr(34))}"'
    )
    res = subprocess.run(
        cmd,
        cwd=WRANGLER_DIR,
        env=env,
        check=True,
        capture_output=True,
        text=True,
        shell=True,
    )
    payload = json.loads(res.stdout)
    if not payload or not payload[0].get("success"):
        raise RuntimeError(f"D1 query failed: {res.stdout}")
    return payload[0]["results"]

def d1_exec_file(sql: str):
    env = dict(os.environ)
    token = env.get("CLOUDFLARE_API_TOKEN", "").strip()
    if not token:
        raise RuntimeError("CLOUDFLARE_API_TOKEN is required in environment.")
    with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False, encoding="utf-8") as f:
        f.write(sql)
        sql_path = f.name
    try:
        cmd = f'npx wrangler d1 execute {WRANGLER_DB} --remote --json --file "{sql_path}"'
        res = subprocess.run(
            cmd,
            cwd=WRANGLER_DIR,
            env=env,
            capture_output=True,
            text=True,
            shell=True,
        )
        if res.returncode != 0:
            raise RuntimeError(f"D1 file execute failed rc={res.returncode}\nstdout={res.stdout}\nstderr={res.stderr}")
        out = res.stdout.strip()
        if not out:
            raise RuntimeError(f"D1 file execute returned empty stdout.\nstderr={res.stderr}")
        json_start = out.find("[")
        if json_start < 0:
            raise RuntimeError(f"D1 file execute returned non-JSON output.\nstdout={res.stdout}\nstderr={res.stderr}")
        payload = json.loads(out[json_start:])
        if not payload or not payload[0].get("success"):
            raise RuntimeError(f"D1 file execute failed: {res.stdout}")
    finally:
        try:
            os.remove(sql_path)
        except OSError:
            pass


def synthetic_mysql_id(kind: str, name: str, registered_ms: int) -> int:
    raw = f"backfill:{kind}:{name}:{registered_ms}".encode("utf-8")
    # keep IDs negative to avoid colliding with live MySQL sync ids
    return -(1_000_000_000 + (zlib.crc32(raw) % 900_000_000))


def load_mysql_events():
    conn = pymysql.connect(
        host=MYSQL_HOST,
        port=MYSQL_PORT,
        user=MYSQL_USER,
        password=MYSQL_PASS,
        database=MYSQL_DB,
        charset="utf8mb4",
        autocommit=True,
    )
    cur = conn.cursor(pymysql.cursors.DictCursor)

    cur.execute(
        """
        SELECT name, founder, registered
        FROM TOWNY_TOWNS
        WHERE registered IS NOT NULL
        ORDER BY registered ASC
        """
    )
    towns = cur.fetchall()

    cur.execute(
        """
        SELECT n.name, n.registered, t.name AS capital_town
        FROM TOWNY_NATIONS n
        LEFT JOIN TOWNY_TOWNS t ON t.uuid = n.capital
        WHERE n.registered IS NOT NULL
        ORDER BY n.registered ASC
        """
    )
    nations = cur.fetchall()

    cur.close()
    conn.close()
    return towns, nations


def main():
    towns, nations = load_mysql_events()

    existing = d1_query(
        """
        SELECT created_at, details
        FROM rootmc_treasury_ledger
        WHERE server_id IN ('rootmc', '{SERVER_ID}')
          AND entry_type='TOWNY_SINK'
          AND (
            details LIKE 'towny:new-town%%' OR
            details LIKE 'towny:new-nation%%' OR
            details LIKE 'backfill:towny:new-town%%' OR
            details LIKE 'backfill:towny:new-nation%%'
          )
        """
    )

    existing_signatures = set()
    for row in existing:
        details = (row.get("details") or "").lower()
        created_at = row.get("created_at") or ""
        if "new-town" in details:
            existing_signatures.add(("town", created_at))
        elif "new-nation" in details:
            existing_signatures.add(("nation", created_at))

    statements = []
    used_ids = set()
    insert_count = 0

    for town in towns:
        registered = int(town["registered"])
        created_at = iso_from_millis(registered)
        sig = ("town", created_at)
        if sig in existing_signatures:
            continue

        town_name = str(town.get("name") or "").strip()
        founder = str(town.get("founder") or "").strip()
        details = f"backfill:towny:new-town|town={town_name}|founder={founder}|registered_ms={registered}"
        mysql_id = synthetic_mysql_id("town", town_name, registered)
        while mysql_id in used_ids:
            mysql_id -= 1
        used_ids.add(mysql_id)

        statements.append(
            "INSERT INTO rootmc_treasury_ledger "
            "(server_id, mysql_id, entry_type, amount, from_uuid, to_uuid, details, created_at, synced_at) "
            f"VALUES ('{SERVER_ID}', {mysql_id}, 'TOWNY_SINK', {TOWN_COST}, NULL, NULL, "
            f"'{sql_escape(details)}', '{created_at}', datetime('now')) "
            f"ON CONFLICT(server_id, mysql_id) DO NOTHING;"
        )
        existing_signatures.add(sig)
        insert_count += 1

    for nation in nations:
        registered = int(nation["registered"])
        created_at = iso_from_millis(registered)
        sig = ("nation", created_at)
        if sig in existing_signatures:
            continue

        nation_name = str(nation.get("name") or "").strip()
        capital_town = str(nation.get("capital_town") or "").strip()
        details = f"backfill:towny:new-nation|nation={nation_name}|capital={capital_town}|registered_ms={registered}"
        mysql_id = synthetic_mysql_id("nation", nation_name, registered)
        while mysql_id in used_ids:
            mysql_id -= 1
        used_ids.add(mysql_id)

        statements.append(
            "INSERT INTO rootmc_treasury_ledger "
            "(server_id, mysql_id, entry_type, amount, from_uuid, to_uuid, details, created_at, synced_at) "
            f"VALUES ('{SERVER_ID}', {mysql_id}, 'TOWNY_SINK', {NATION_COST}, NULL, NULL, "
            f"'{sql_escape(details)}', '{created_at}', datetime('now')) "
            f"ON CONFLICT(server_id, mysql_id) DO NOTHING;"
        )
        existing_signatures.add(sig)
        insert_count += 1

    if not statements:
        print("No missing town/nation founding events to backfill.")
        return

    sql = "\n".join(statements)
    d1_exec_file(sql)
    print(f"Backfill complete. Inserted {insert_count} rows.")


if __name__ == "__main__":
    main()

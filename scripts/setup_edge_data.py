#!/usr/bin/env python3
"""Create D1 `rootmc-live` + Hyperdrive `rootmc-core-mysql` on the new CF account.

Uses the same X-Auth-Email / X-Auth-Key path as the heartbeat writer.
Prints IDs to append to .env and wrangler.rootmc-api.toml.
Idempotent: reuses an existing database/config with the same name.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env", override=False)

ACCOUNT = os.getenv("CF_ACCOUNT_ID") or os.getenv("CLOUDFLARE_ACCOUNT_ID")
EMAIL = os.getenv("CLOUDFLARE_EMAIL") or os.getenv("CF_EMAIL")
KEY = os.getenv("CLOUDFLARE_API_KEY") or os.getenv("CF_GLOBAL_API_KEY")
TOKEN = os.getenv("CF_API_TOKEN") or os.getenv("CLOUDFLARE_API_TOKEN") or ""
if TOKEN.startswith("cfk_"):
    TOKEN = ""

MYSQL_HOST = os.getenv("ROOTMC_CORE_MYSQL_HOST", "")
MYSQL_PORT = int(os.getenv("ROOTMC_CORE_MYSQL_PORT", "3306") or 3306)
MYSQL_DB = os.getenv("ROOTMC_CORE_MYSQL_DATABASE", "")
MYSQL_USER = os.getenv("ROOTMC_CORE_MYSQL_USER", "")
MYSQL_PASS = os.getenv("ROOTMC_CORE_MYSQL_PASSWORD", "")

SCHEMA = ROOT / "packages" / "workers" / "sql" / "rootmc-live.sql"


def headers() -> dict:
    h = {"Content-Type": "application/json"}
    if TOKEN:
        h["Authorization"] = f"Bearer {TOKEN}"
    else:
        h["X-Auth-Email"] = EMAIL or ""
        h["X-Auth-Key"] = KEY or ""
    return h


def api(path: str) -> str:
    return f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}{path}"


def main() -> int:
    if not ACCOUNT or not (TOKEN or (EMAIL and KEY)):
        print("missing CF credentials", file=sys.stderr)
        return 1

    with httpx.Client(timeout=60, headers=headers()) as c:
        # ── D1 ──────────────────────────────────────────────────────────────
        listed = c.get(api("/d1/database")).json()
        if not listed.get("success"):
            print("D1 list failed:", listed, file=sys.stderr)
            return 1
        d1_id = None
        for row in listed.get("result") or []:
            if row.get("name") == "rootmc-live":
                d1_id = row["uuid"]
                print("D1 exists:", d1_id)
                break
        if not d1_id:
            created = c.post(api("/d1/database"), json={"name": "rootmc-live"}).json()
            if not created.get("success"):
                print("D1 create failed:", created, file=sys.stderr)
                return 1
            d1_id = created["result"]["uuid"]
            print("D1 created:", d1_id)

        sql = SCHEMA.read_text(encoding="utf-8")
        q = c.post(
            api(f"/d1/database/{d1_id}/query"),
            json={"sql": sql},
        ).json()
        if q.get("success"):
            print("D1 schema applied")
        else:
            # Some API versions want one statement at a time
            ok = True
            for stmt in sql.split(";"):
                stmt = stmt.strip()
                if not stmt:
                    continue
                one = c.post(
                    api(f"/d1/database/{d1_id}/query"), json={"sql": stmt}
                ).json()
                if not one.get("success"):
                    ok = False
                    print("schema stmt failed:", one.get("errors"))
            if ok:
                print("D1 schema applied (split)")

        # ── Hyperdrive ──────────────────────────────────────────────────────
        hd_id = None
        hd_list = c.get(api("/hyperdrive/configs")).json()
        if hd_list.get("success"):
            for row in hd_list.get("result") or []:
                if row.get("name") == "rootmc-core-mysql":
                    hd_id = row.get("id")
                    print("Hyperdrive exists:", hd_id)
                    break
        else:
            print("Hyperdrive list:", hd_list.get("errors"))

        if not hd_id:
            if not (MYSQL_HOST and MYSQL_USER and MYSQL_DB and MYSQL_PASS):
                print("skip Hyperdrive create — ROOTMC_CORE_MYSQL_* incomplete")
            else:
                body = {
                    "name": "rootmc-core-mysql",
                    "origin": {
                        "scheme": "mysql",
                        "host": MYSQL_HOST,
                        "port": MYSQL_PORT,
                        "database": MYSQL_DB,
                        "user": MYSQL_USER,
                        "password": MYSQL_PASS,
                    },
                    "caching": {"disabled": False},
                }
                created = c.post(api("/hyperdrive/configs"), json=body).json()
                if created.get("success"):
                    hd_id = created["result"]["id"]
                    print("Hyperdrive created:", hd_id)
                else:
                    print("Hyperdrive create failed:", json.dumps(created, indent=2))

    env_path = ROOT / ".env"
    text = env_path.read_text(encoding="utf-8") if env_path.exists() else ""

    def upsert(src: str, key: str, val: str) -> str:
        if not val:
            return src
        line = f"{key}={val}"
        if f"{key}=" in src:
            lines = []
            for ln in src.splitlines():
                if ln.startswith(f"{key}="):
                    lines.append(line)
                else:
                    lines.append(ln)
            return "\n".join(lines) + ("\n" if src.endswith("\n") else "")
        return src.rstrip() + f"\n{line}\n"

    if d1_id:
        text = upsert(text, "CF_D1_ROOTMC_DB_ID", d1_id)
    if hd_id:
        text = upsert(text, "CF_HYPERDRIVE_ROOTMC_ID", hd_id)
    env_path.write_text(text, encoding="utf-8")
    print("wrote IDs into .env")
    print("D1_ROOTMC_LIVE", d1_id)
    print("HYPERDRIVE_ROOTMC", hd_id)

    toml_path = ROOT / "packages" / "workers" / "wrangler.rootmc-api.toml"
    if toml_path.exists() and d1_id:
        toml = toml_path.read_text(encoding="utf-8")
        if "ROOTMC_LIVE_DB" not in toml:
            extra = (
                "\n[[d1_databases]]\n"
                'binding = "ROOTMC_LIVE_DB"\n'
                'database_name = "rootmc-live"\n'
                f'database_id = "{d1_id}"\n'
            )
            if hd_id:
                extra += (
                    "\n[[hyperdrive]]\n"
                    'binding = "LIVE_DB"\n'
                    f'id = "{hd_id}"\n'
                )
            toml_path.write_text(toml.rstrip() + extra + "\n", encoding="utf-8")
            print("patched wrangler.rootmc-api.toml")
        else:
            # refresh ids in place
            import re
            toml = re.sub(
                r'(database_name = "rootmc-live"\s*\ndatabase_id = ")[^"]+',
                rf"\g<1>{d1_id}",
                toml,
            )
            if hd_id:
                toml = re.sub(
                    r'(binding = "LIVE_DB"\s*\nid = ")[^"]+',
                    rf"\g<1>{hd_id}",
                    toml,
                )
            toml_path.write_text(toml, encoding="utf-8")
            print("refreshed wrangler.rootmc-api.toml ids")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

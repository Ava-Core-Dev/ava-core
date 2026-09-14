#!/usr/bin/env python3
"""Remove misleading vault balance snapshots from D1 (charts now use ledger)."""
import os
import subprocess

SERVER_ID = "rootmc"
WRANGLER_DB = "rootmc"
WRANGLER_DIR = r"c:\Users\rrdeveloper\Desktop\RootMC Workspace\Web Files\rootmc-api"


def main():
    env = dict(os.environ)
    if not env.get("CLOUDFLARE_API_TOKEN", "").strip():
        raise RuntimeError("CLOUDFLARE_API_TOKEN required")
    sql = f"DELETE FROM rootmc_treasury_balance_snapshots WHERE server_id = '{SERVER_ID}'"
    cmd = (
        f'npx wrangler d1 execute {WRANGLER_DB} --remote --json '
        f'--command "{sql}"'
    )
    res = subprocess.run(cmd, cwd=WRANGLER_DIR, env=env, check=True, capture_output=True, text=True, shell=True)
    print(res.stdout)
    print("Purged vault balance snapshots from D1.")


if __name__ == "__main__":
    main()

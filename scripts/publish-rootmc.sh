#!/usr/bin/env bash
# Put the RootMC website (blog + wiki HTML) on the internet.
# No Cursor. Run on the Ava machine.
set -euo pipefail
ROOT="/home/ava-core/ava/workstations/rootmc-web/rootmc-web"
CREDS="/home/ava-core/ava/credentials.env"
TOKEN=$(python3 -c "import re; t=open('$CREDS').read(); print(re.search(r'^CLOUDFLARE_API_TOKEN=(.+)$', t, re.M).group(1).strip())")
ACCT=$(python3 -c "import re; t=open('$CREDS').read(); print(re.search(r'^ROOTMC_CLOUDFLARE_ACCOUNT_ID=(.+)$', t, re.M).group(1).strip())")
unset CLOUDFLARE_API_KEY CLOUDFLARE_EMAIL CF_API_KEY CF_API_EMAIL || true
export CLOUDFLARE_API_TOKEN="$TOKEN"
export CLOUDFLARE_ACCOUNT_ID="$ACCT"
cd "$ROOT"
node scripts/build.mjs
npx wrangler pages deploy build --project-name rootmc-web --branch main
echo "RootMC published. If rootmc.net looks old, wait a few minutes or open the pages.dev URL wrangler printed."

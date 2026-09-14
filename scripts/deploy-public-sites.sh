#!/usr/bin/env bash
# Deploy public frontends: avaivy.cloud, rootrecord.online, alexrs94.site, rootrecord.info→redirect.
set -euo pipefail

ROOT="/home/ava-core/ava/ava-core-v2"
RR_STATIC="/home/ava-core/ava/workstations/projects/rootrecord-info-site/public"

# Gmail / Ava CF account (avaivy.cloud, rootrecord.online, rootmc.net zones)
AVA_EMAIL="${CLOUDFLARE_EMAIL:-alexanderstorey94@gmail.com}"
AVA_KEY="${CLOUDFLARE_API_KEY:-$(rg -N '^CLOUDFLARE_API_KEY=' "$ROOT/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")}"
AVA_ACCT="${CLOUDFLARE_ACCOUNT_ID:-d2daf26398a805b29e12ddba2b2228cf}"

# Root Record legacy CF account (rootrecord.info redirect-only)
RR_EMAIL="${ROOTRECORD_CF_EMAIL:-$(rg -N '^CLOUDFLARE_EMAIL=' /home/ava-core/ava/credentials.env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")}"
RR_KEY="${ROOTRECORD_CF_KEY:-$(rg -N '^CLOUDFLARE_GLOBAL_API_KEY=' /home/ava-core/ava/credentials.env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")}"
RR_ACCT="${ROOTRECORD_CF_ACCOUNT_ID:-$(rg -N '^CLOUDFLARE_ACCOUNT_ID=' /home/ava-core/ava/credentials.env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")}"

deploy_next() {
  local app="$1" project="$2"
  export CLOUDFLARE_EMAIL="$AVA_EMAIL" CLOUDFLARE_API_KEY="$AVA_KEY" CLOUDFLARE_ACCOUNT_ID="$AVA_ACCT"
  unset CLOUDFLARE_API_TOKEN || true
  bash "$ROOT/scripts/deploy-next-to-pages.sh" "$app" "$project"
  # Verify static assembly (deploy script can upload 0 files if build cache is stale)
  local out_base="${AVA_PAGES_OUT_BASE:-/tmp}"
  local out="$out_base/$(basename "$app")-pages-out"
  if [[ ! -d "$out" ]] || [[ $(find "$out" -name 'index.html' 2>/dev/null | wc -l) -lt 3 ]]; then
    echo "WARN: Pages out looks empty for $project — rebuilding assembly" >&2
    (cd "$app" && npm run build)
    python3 - "$app" "$out" <<'PY'
import shutil, sys
from pathlib import Path
app, out = Path(sys.argv[1]), Path(sys.argv[2])
src = app / ".next" / "server" / "app"
out.mkdir(parents=True, exist_ok=True)
def place(html, dest_root):
    rel = html.relative_to(src)
    stem = rel.stem if rel.name != "index.html" else ""
    dest = dest_root / rel.parent / stem if stem else dest_root / rel.parent
    dest.mkdir(parents=True, exist_ok=True)
    shutil.copy2(html, dest / "index.html")
for html in src.rglob("*.html"):
    place(html, out)
static = app / ".next" / "static"
if static.is_dir():
    (out / "_next/static").mkdir(parents=True, exist_ok=True)
    shutil.copytree(static, out / "_next/static", dirs_exist_ok=True)
print("re-assembled", out, "html dirs", len(list(out.rglob("index.html"))))
PY
    export CLOUDFLARE_EMAIL="$AVA_EMAIL" CLOUDFLARE_API_KEY="$AVA_KEY" CLOUDFLARE_ACCOUNT_ID="$AVA_ACCT"
    npx wrangler pages deploy "$out" --project-name "$project" --branch main --commit-dirty=true
  fi
}

deploy_rr_online() {
  cp "$RR_STATIC/_redirects.online" "$RR_STATIC/_redirects"
  export CLOUDFLARE_EMAIL="$AVA_EMAIL" CLOUDFLARE_API_KEY="$AVA_KEY" CLOUDFLARE_ACCOUNT_ID="$AVA_ACCT"
  unset CLOUDFLARE_API_TOKEN || true
  npx wrangler pages deploy "$RR_STATIC" --project-name rootrecord-online --branch main --commit-dirty=true
}

deploy_rr_info_redirect() {
  cp "$RR_STATIC/_redirects.info" "$RR_STATIC/_redirects"
  export CLOUDFLARE_EMAIL="$RR_EMAIL" CLOUDFLARE_API_KEY="$RR_KEY" CLOUDFLARE_ACCOUNT_ID="$RR_ACCT"
  unset CLOUDFLARE_API_TOKEN || true
  npx wrangler pages deploy "$RR_STATIC" --project-name rootrecord-website --branch main --commit-dirty=true
}

deploy_workers() {
  export CLOUDFLARE_EMAIL="$AVA_EMAIL" CLOUDFLARE_API_KEY="$AVA_KEY" CLOUDFLARE_ACCOUNT_ID="$AVA_ACCT"
  cd "$ROOT/packages/workers"
  npx wrangler deploy -c wrangler.ava-api.toml
  npx wrangler deploy -c wrangler.rootrecord-api.toml
}

echo "=== avaivy.cloud ==="
deploy_next "$ROOT/packages/web/avaivy.cloud" "avaivy-cloud"

echo "=== alexrs94.site (personal) ==="
deploy_next "$ROOT/packages/web/alexrs94.site" "alexrs94-site"

echo "=== rootrecord.online (canonical) ==="
deploy_rr_online

echo "=== rootrecord.info → rootrecord.online redirect ==="
deploy_rr_info_redirect

# Restore canonical redirects file for git
cp "$RR_STATIC/_redirects.online" "$RR_STATIC/_redirects"

echo "=== Workers (ava-api + rootrecord-api) ==="
deploy_workers

echo "Done. Canonical: avaivy.cloud · rootrecord.online · rootmc.net"

#!/usr/bin/env bash
# Build a Next.js app and deploy pre-rendered HTML + assets to Cloudflare Pages.
set -euo pipefail

APP_DIR="${1:?app dir}"
PROJECT="${2:?pages project name}"
EMAIL="${CLOUDFLARE_EMAIL:-alexanderstorey94@gmail.com}"
KEY="${CLOUDFLARE_API_KEY:?set CLOUDFLARE_API_KEY}"
ACCT="${CLOUDFLARE_ACCOUNT_ID:-d2daf26398a805b29e12ddba2b2228cf}"

cd "$APP_DIR"
npm run build
OUT_ROOT="${AVA_PAGES_OUT_BASE:-/tmp}"
OUT="$OUT_ROOT/$(basename "$APP_DIR")-pages-out"
rm -rf "$OUT"
mkdir -p "$OUT/_next"
cp -a .next/static "$OUT/_next/static"

python3 - "$APP_DIR" <<'PY'
import shutil, sys
from pathlib import Path

app = Path(sys.argv[1])
src = app / ".next" / "server" / "app"
out = app / ".pages-out"

def place(html: Path) -> None:
    rel = html.relative_to(src)
    dest = out / rel
    if rel.name.endswith(".html"):
        if rel.name == "index.html":
            dest = out / rel.parent
        else:
            stem = rel.name[: -len(".html")]
            dest = out / rel.parent / stem
    dest.mkdir(parents=True, exist_ok=True)
    target = dest / ("index.html" if dest.is_dir() else dest.name)
    if dest.is_dir():
        target = dest / "index.html"
    shutil.copy2(html, target)

for html in src.rglob("*.html"):
    place(html)
print("assembled", out)
PY

export CLOUDFLARE_EMAIL="$EMAIL"
export CLOUDFLARE_API_KEY="$KEY"
export CLOUDFLARE_ACCOUNT_ID="$ACCT"
npx wrangler pages deploy "$OUT" --project-name "$PROJECT" --branch main --commit-dirty=true
echo "Deployed $PROJECT from $APP_DIR"

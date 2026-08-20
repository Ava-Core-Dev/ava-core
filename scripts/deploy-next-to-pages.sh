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
rm -rf "$OUT" "$APP_DIR/.pages-out"

python3 - "$APP_DIR" "$OUT" <<'PY'
import shutil, sys
from pathlib import Path

app = Path(sys.argv[1])
out = Path(sys.argv[2])
src = app / ".next" / "server" / "app"
local = app / ".pages-out"
out.mkdir(parents=True, exist_ok=True)
local.mkdir(parents=True, exist_ok=True)

def place(html: Path, dest_root: Path) -> None:
    rel = html.relative_to(src)
    if rel.name == "index.html":
        dest = dest_root / rel.parent
    else:
        stem = rel.name[: -len(".html")]
        dest = dest_root / rel.parent / stem
    dest.mkdir(parents=True, exist_ok=True)
    shutil.copy2(html, dest / "index.html")

for html in src.rglob("*.html"):
    place(html, out)
    place(html, local)

static = app / ".next" / "static"
if static.is_dir():
    (out / "_next").mkdir(parents=True, exist_ok=True)
    shutil.copytree(static, out / "_next" / "static", dirs_exist_ok=True)
print("assembled", out)
PY

export CLOUDFLARE_EMAIL="$EMAIL"
export CLOUDFLARE_API_KEY="$KEY"
export CLOUDFLARE_ACCOUNT_ID="$ACCT"
unset CLOUDFLARE_API_TOKEN || true
npx wrangler pages deploy "$OUT" --project-name "$PROJECT" --branch main --commit-dirty=true
echo "Deployed $PROJECT from $APP_DIR"

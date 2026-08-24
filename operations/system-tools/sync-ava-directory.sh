#!/usr/bin/env bash
set -euo pipefail

SOURCE="/home/ava-core"
DEST="/home/ava-core/Ava-Directory"

cd "$DEST"

echo "=== AVA DIRECTORY SYNC ==="
date

# ------------------------------------------------------------
# Export the public directory.
#
# IMPORTANT:
# This is intentionally an allow-by-exclusion model.
# Anything newly created under /home/ava-core could otherwise
# become public. Sensitive classes are therefore excluded here
# AND by .gitignore.
# ------------------------------------------------------------

rsync -a --delete \
    --exclude='.git/' \
    --exclude='.git' \
    --exclude='.cursor/' \
    --exclude='.codex/' \
    --exclude='.agents/' \
    --exclude='.claude/' \
    --exclude='.copilot/' \
    --exclude='.gemini/' \
    --exclude='.aider/' \
    --exclude='.windsurf/' \
    --exclude='.ai/' \
    --exclude='.ai-*/' \
    --exclude='.cargo/' \
    --exclude='**/.cursor/' \
    --exclude='**/.codex/' \
    --exclude='**/.agents/' \
    --exclude='**/.claude/' \
    --exclude='**/.copilot/' \
    --exclude='**/.gemini/' \
    --exclude='**/.aider/' \
    --exclude='**/.windsurf/' \
    --exclude='**/.ai/' \
    --exclude='**/.cargo/' \
    --exclude='node_modules/' \
    --exclude='**/node_modules/' \
    --exclude='__pycache__/' \
    --exclude='**/__pycache__/' \
    --exclude='.venv/' \
    --exclude='venv/' \
    --exclude='.cache/' \
    --exclude='**/.cache/' \
    --exclude='.npm/' \
    --exclude='.ssh/' \
    --exclude='**/.ssh/' \
    --exclude='.cloudflared/' \
    --exclude='**/.cloudflared/' \
    --exclude='.env' \
    --exclude='.env.*' \
    --exclude='*.env' \
    --exclude='*.pem' \
    --exclude='*.key' \
    --exclude='*.p12' \
    --exclude='*.pfx' \
    --exclude='*.secret' \
    --exclude='secrets/' \
    --exclude='credentials/' \
    --exclude='wallets/' \
    --exclude='tokens/' \
    --exclude='*.db' \
    --exclude='*.sqlite' \
    --exclude='*.sqlite3' \
    --exclude='*.db-shm' \
    --exclude='*.db-wal' \
    --exclude='*.log' \
    --exclude='logs/' \
    --exclude='runtime/' \
    --exclude='tmp/' \
    --exclude='temp/' \
    --exclude='dist/' \
    --exclude='build/' \
    --exclude='*.backup*' \
    --exclude='*.bak' \
    --exclude='*.orig' \
    --exclude='*.old' \
    --exclude='.DS_Store' \
    "$SOURCE/" "$DEST/"

# Never export the sync script itself.
rm -f "$DEST/operations/system-tools/sync-ava-directory.sh" 2>/dev/null || true

# Never export the repository's own Git metadata.
rm -rf "$DEST/.git" 2>/dev/null || true

# Recreate git metadata after rsync.
cd "$DEST"
git init -q
git branch -M main

# Make absolutely sure secret patterns are ignored.
git add -A

# ------------------------------------------------------------
# SECURITY CHECK
# ------------------------------------------------------------

if git diff --cached --name-only | grep -E \
    '(^|/)(\.env|\.env\.|\.cursor|\.codex|\.agents|\.ssh|\.cloudflared|secrets|credentials|wallets)(/|$)|(\.pem|\.key|\.p12|\.pfx)$' \
    >/tmp/ava-directory-security-failure 2>&1; then

    echo
    echo "!!! SECURITY CHECK FAILED !!!"
    cat /tmp/ava-directory-security-failure
    git reset -q
    exit 1
fi

rm -f /tmp/ava-directory-security-failure

# ------------------------------------------------------------
# COMMIT / PUSH
# ------------------------------------------------------------

if ! git diff --cached --quiet; then
    git commit -m "Automated AVA Directory update $(date '+%Y-%m-%d %H:%M:%S')"
fi

git push origin main

echo
echo "=== SYNC COMPLETE ==="
date

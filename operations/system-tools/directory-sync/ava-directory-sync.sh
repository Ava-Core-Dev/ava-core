#!/usr/bin/env bash
set -euo pipefail

SOURCE="/home/ava-core"
EXPORT="/home/ava-core/Ava-Directory"
LOG="/home/ava-core/context/ava-directory-sync.log"

mkdir -p "$(dirname "$LOG")"

exec >>"$LOG" 2>&1

echo
echo "============================================================"
echo "AVA DIRECTORY SYNC"
echo "$(date -Is)"
echo "============================================================"

cd "$SOURCE"

# ------------------------------------------------------------
# PRIVATE / GENERATED EXCLUSIONS
# ------------------------------------------------------------

EXCLUDES=(
    ".git"
    ".git/"
    "Ava-Directory"
    "Ava-Directory/"
    ".cursor"
    ".cursor/"
    ".codex"
    ".codex/"
    ".agents"
    ".agents/"
    ".claude"
    ".claude/"
    ".copilot"
    ".copilot/"
    ".gemini"
    ".gemini/"
    ".aider"
    ".aider/"
    ".windsurf"
    ".windsurf/"
    ".ai"
    ".ai/"
    ".cargo"
    ".cargo/"
    ".ssh"
    ".ssh/"
    ".cloudflared"
    ".cloudflared/"
    ".gnupg"
    ".gnupg/"
    ".pki"
    ".pki/"
    ".ollama"
    ".ollama/"
    ".npm"
    ".npm/"
    ".cache"
    ".cache/"
    ".local"
    ".local/"
    ".gradle"
    ".gradle/"
    ".rustup"
    ".rustup/"
    "Credentials"
    "Credentials/"
    "Database"
    "Database/"
    "credentials"
    "credentials/"
    "secrets"
    "secrets/"
    "wallets"
    "wallets/"
    "tokens"
    "tokens/"
    ".env"
    ".env.*"
    "*.env"
    "*.pem"
    "*.key"
    "*.p12"
    "*.pfx"
    "*.secret"
    "*.db"
    "*.sqlite"
    "*.sqlite3"
    "*.db-shm"
    "*.db-wal"
    "*.log"
    "logs/"
    "runtime/"
    "tmp/"
    "temp/"
    "node_modules/"
    "__pycache__/"
    ".venv/"
    "venv/"
    "dist/"
    "build/"
)

RSYNC_ARGS=()

for item in "${EXCLUDES[@]}"; do
    RSYNC_ARGS+=(--exclude="$item")
done

# ------------------------------------------------------------
# REBUILD PUBLIC EXPORT
# ------------------------------------------------------------

echo "Rebuilding sanitized public export..."

find "$EXPORT" \
    -mindepth 1 \
    -maxdepth 1 \
    ! -name ".git" \
    -exec rm -rf {} +

rsync -a "${RSYNC_ARGS[@]}" \
    "$SOURCE/" \
    "$EXPORT/"

# Repository must never appear inside itself.
rm -rf "$EXPORT/Ava-Directory"

# ------------------------------------------------------------
# PUBLIC REPOSITORY IGNORE RULES
# ------------------------------------------------------------

cat > "$EXPORT/.gitignore" <<'EOF'
.env
.env.*
*.env

*.pem
*.key
*.p12
*.pfx
*.secret

Credentials/
credentials/
secrets/
wallets/
tokens/

Database/
database/

.cursor/
.codex/
.agents/
.claude/
.copilot/
.gemini/
.aider/
.windsurf/
.ai/
.cargo/

node_modules/
__pycache__/
.venv/
venv/
.cache/
.npm/
.yarn/

.ssh/
.cloudflared/

*.db
*.sqlite
*.sqlite3
*.db-shm
*.db-wal

*.log
logs/
runtime/
tmp/
temp/

dist/
build/

*.backup*
*.bak
*.orig
*.old
EOF

# ------------------------------------------------------------
# DIRECTORY INDEX GENERATOR
# ------------------------------------------------------------

echo "Generating DIRECTORY.txt files..."

python3 <<'PY'
import os

ROOT = "/home/ava-core/Ava-Directory"

PRIVATE_DIRS = {
    ".git",
    ".cursor",
    ".codex",
    ".agents",
    ".claude",
    ".copilot",
    ".gemini",
    ".aider",
    ".windsurf",
    ".ai",
    ".cargo",
    ".ssh",
    ".cloudflared",
    "Credentials",
    "Database",
    "credentials",
    "secrets",
    "wallets",
    "tokens",
    "node_modules",
    "__pycache__",
    ".venv",
    "venv",
    ".cache",
    ".npm",
    "dist",
    "build",
    "runtime",
    "tmp",
    "temp",
}

PRIVATE_FILES = {
    ".env",
}

PRIVATE_SUFFIXES = (
    ".pem",
    ".key",
    ".p12",
    ".pfx",
    ".secret",
    ".db",
    ".sqlite",
    ".sqlite3",
    ".db-shm",
    ".db-wal",
    ".log",
)

def hidden_or_private(name):
    if name in PRIVATE_FILES:
        return True
    if name.startswith(".env."):
        return True
    if name.endswith(PRIVATE_SUFFIXES):
        return True
    return False

for current, dirs, files in os.walk(ROOT):
    rel = os.path.relpath(current, ROOT)

    # Never descend into private material.
    dirs[:] = sorted(
        d for d in dirs
        if d not in PRIVATE_DIRS
        and not hidden_or_private(d)
    )

    visible_dirs = sorted(
        d for d in dirs
        if d not in PRIVATE_DIRS
        and not hidden_or_private(d)
    )

    visible_files = sorted(
        f for f in files
        if f != "DIRECTORY.txt"
        and not hidden_or_private(f)
    )

    path = os.path.join(current, "DIRECTORY.txt")

    lines = [
        "AVA DIRECTORY INDEX",
        "===================",
        "",
        f"Path: /{'' if rel == '.' else rel}",
        "",
        "Directories:",
    ]

    if visible_dirs:
        lines.extend(f"  [DIR]  {d}/" for d in visible_dirs)
    else:
        lines.append("  (none)")

    lines.extend([
        "",
        "Files:",
    ])

    if visible_files:
        lines.extend(f"  [FILE] {f}" for f in visible_files)
    else:
        lines.append("  (none)")

    lines.extend([
        "",
        f"Directory count: {len(visible_dirs)}",
        f"File count:      {len(visible_files)}",
        "",
    ])

    content = "\n".join(lines)

    with open(path, "w", encoding="utf-8") as fh:
        fh.write(content)

print("DIRECTORY.txt generation complete.")
PY

# ------------------------------------------------------------
# FINAL SECURITY SWEEP
# ------------------------------------------------------------

echo "Running final security sweep..."

BAD="$(
    find "$EXPORT" \
        -not -path "$EXPORT/.git/*" \
        \( \
            -name '.env' -o \
            -name '.env.*' -o \
            -name '*.env' -o \
            -name '*.pem' -o \
            -name '*.key' -o \
            -name '*.p12' -o \
            -name '*.pfx' -o \
            -name '*.secret' -o \
            -name '*.db' -o \
            -name '*.sqlite' -o \
            -name '*.sqlite3' -o \
            -name '*.db-shm' -o \
            -name '*.db-wal' -o \
            -name '.cursor' -o \
            -name '.codex' -o \
            -name '.agents' -o \
            -name '.claude' -o \
            -name '.copilot' -o \
            -name '.gemini' -o \
            -name '.aider' -o \
            -name '.windsurf' -o \
            -name 'Credentials' -o \
            -name 'Database' -o \
            -name 'credentials' -o \
            -name 'secrets' -o \
            -name 'wallets' -o \
            -name 'tokens' \
        \) -print
)"

if [[ -n "$BAD" ]]; then
    echo "!!! SECURITY FAILURE !!!"
    echo "$BAD"
    exit 1
fi

echo "SECURITY CHECK PASSED"

# ------------------------------------------------------------
# GIT
# ------------------------------------------------------------

cd "$EXPORT"

git add -A

if git diff --cached --quiet; then
    echo "No public changes detected."
else
    git commit -m "Automated AVA Directory update"
    git push origin main
    echo "Public repository updated."
fi

echo
echo "=== SYNC COMPLETE ==="
echo "Files:       $(find . -type f -not -path './.git/*' | wc -l)"
echo "Directories: $(find . -type d -not -path './.git*' | wc -l)"
echo "Indexes:     $(find . -name DIRECTORY.txt -not -path './.git/*' | wc -l)"
echo

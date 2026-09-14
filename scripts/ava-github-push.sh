#!/usr/bin/env bash
# Ava multi-repo GitHub push wrapper (canonical entry for systemd / hooks).
# See scripts/ava-github-push.mjs for repos, branches, and safety rules.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"
exec node "$REPO/scripts/ava-github-push.mjs" "$@"

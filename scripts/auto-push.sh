#!/usr/bin/env bash
# If Ava-owned trees have real changes, commit and push to Ava-Core-Dev.
# Safe: never stages .env / keys; never force-pushes main/master.
# Quiet when there is nothing to do (suitable for a 15-minute timer).
#
# Covers (via scripts/ava-github-push.mjs):
#   ava-core (+ branch `dev`), ava-core-private (+ `dev`),
#   all-connections (+ `dev`), web-files (+ `dev`)
# Plugins sync into ava-core-private under workstations/minecraft-plugins/plugins.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
LOCK="${XDG_RUNTIME_DIR:-/tmp}/ava-auto-push.lock"
LOG_DIR="${AVA_AUTO_PUSH_LOG_DIR:-$REPO/data/logs}"
LOG="$LOG_DIR/auto-push.log"
mkdir -p "$LOG_DIR"

log() { printf '%s %s\n' "$(date -Iseconds)" "$*" | tee -a "$LOG"; }

exec 9>"$LOCK"
if ! flock -n 9; then
  exit 0
fi

FLAG="${XDG_STATE_HOME:-$HOME/.local/state}/ava/github-auto-push.off"
if [ -f "$FLAG" ]; then
  # Quiet exit when operator (or /ops) disabled auto-push for Emergent / manual work.
  exit 0
fi

cd "$REPO"

if [ ! -d .git ]; then
  log "skip: not a git repo ($REPO)"
  exit 0
fi
if [ -d .git/rebase-merge ] || [ -d .git/rebase-apply ] || [ -f .git/MERGE_HEAD ]; then
  log "skip: rebase/merge in progress"
  exit 0
fi

if command -v node >/dev/null 2>&1; then
  if node "$REPO/scripts/ava-github-push.mjs" >>"$LOG" 2>&1; then
    log "canonical multi-repo push ok"
  else
    log "canonical multi-repo push skipped/failed — see $LOG"
    exit 1
  fi
else
  log "skip: node not found"
fi

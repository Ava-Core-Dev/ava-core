#!/usr/bin/env bash
# If Ava-owned trees have real changes, commit and push to Ava-Core-Dev.
# Safe: never stages .env / keys; never force-pushes main/master.
# Quiet when there is nothing to do (suitable for a 2-minute timer).
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

if [ -z "$(git config user.name)" ]; then
  log "skip: git user.name unset"
  exit 0
fi

# Fast path for this checkout (ava-core) — keep timer snappy when only core is dirty.
git add -A
UNSTAGE=()
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    .env|.env.*|*/.env|*/.env.*|*.pem|*.p12|id_rsa|id_rsa.*|*credentials*.json|*.token|credentials.env|credentials.env.*)
      UNSTAGE+=("$f")
      ;;
  esac
done < <(git diff --cached --name-only)

if [ ${#UNSTAGE[@]} -gt 0 ]; then
  git restore --staged -- "${UNSTAGE[@]}" 2>/dev/null || git reset -q HEAD -- "${UNSTAGE[@]}"
  log "unstaged secrets: ${UNSTAGE[*]}"
fi

DIRTY=0
git diff --cached --quiet || DIRTY=1

AHEAD=0
if git rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
  AHEAD="$(git rev-list --count '@{u}..HEAD' 2>/dev/null || echo 0)"
else
  AHEAD=1
fi

if [ "$DIRTY" -eq 1 ]; then
  STAT="$(git diff --cached --stat | tail -n 1 | tr -s ' ')"
  git commit -m "$(cat <<EOF
auto: sync $(date '+%Y-%m-%d %H:%M %Z')

${STAT}

Pushed by scripts/auto-push.sh (timer / session hook).
EOF
)" >/dev/null
  log "commit $(git rev-parse --short HEAD) $STAT"
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$DIRTY" -eq 1 ] || [ "${AHEAD:-0}" -ne 0 ]; then
  if git rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
    if git push origin "HEAD:$BRANCH" >>"$LOG" 2>&1; then
      log "pushed $BRANCH $(git rev-parse --short HEAD)"
    else
      log "push failed (will retry next tick) — see $LOG"
      exit 1
    fi
  else
    if git push -u origin "HEAD:$BRANCH" >>"$LOG" 2>&1; then
      log "pushed $BRANCH (set upstream) $(git rev-parse --short HEAD)"
    else
      log "push failed (will retry next tick)"
      exit 1
    fi
  fi
  # Rolling DEV pointer (same tip). Never force-pushes main/master.
  if git push origin "HEAD:dev" >>"$LOG" 2>&1; then
    log "pushed dev $(git rev-parse --short HEAD)"
  else
    log "dev push skipped/failed (non-fatal) — see $LOG"
  fi
fi

# Sibling Ava repos + private handoff (plugins, web-files, all-connections).
# Skip re-doing ava-core here — already handled above.
if command -v node >/dev/null 2>&1; then
  if AVA_GITHUB_PUSH_ONLY=ava-core-private,all-connections,web-files \
    node "$REPO/scripts/ava-github-push.mjs" >>"$LOG" 2>&1; then
    log "multi-repo push ok"
  else
    log "multi-repo push had errors (non-fatal for core) — see $LOG"
  fi
else
  log "skip multi-repo: node not found"
fi

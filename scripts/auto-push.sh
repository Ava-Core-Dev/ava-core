#!/usr/bin/env bash
# If the git tree has real changes, commit them and push to GitHub.
# Safe: never stages .env / keys; respects .gitignore; one run at a time.
# Quiet when there is nothing to do (suitable for a 2-minute timer).
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
LOCK="${XDG_RUNTIME_DIR:-/tmp}/ava-auto-push.lock"
LOG_DIR="${AVA_AUTO_PUSH_LOG_DIR:-$REPO/data/logs}"
LOG="$LOG_DIR/auto-push.log"
mkdir -p "$LOG_DIR"

log() { printf '%s %s\n' "$(date -Iseconds)" "$*" | tee -a "$LOG"; }

# Only one push at a time (timer + Cursor hook can overlap).
exec 9>"$LOCK"
if ! flock -n 9; then
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

# Identity (local repo already has Ava-Core-Dev; don't touch global git config)
if [ -z "$(git config user.name)" ]; then
  log "skip: git user.name unset"
  exit 0
fi

# Stage everything gitignore allows
git add -A

# Never let secrets ride along even if gitignore is wrong
UNSTAGE=()
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    .env|.env.*|*/.env|*/.env.*|*.pem|*.p12|id_rsa|id_rsa.*|*credentials*.json|*.token)
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
  AHEAD=1  # no upstream yet — we'll push -u
fi

if [ "$DIRTY" -eq 0 ] && [ "${AHEAD:-0}" -eq 0 ]; then
  exit 0
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

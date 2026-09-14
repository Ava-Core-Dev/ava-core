#!/usr/bin/env bash
# Pull GitHub updates into the live ava-core-v2 tree (what Vercel/CF Git hooks deploy from).
# Shares the auto-push lock so push and pull never race.
#
# Usage:
#   git-pull-live.sh status   # local ahead/behind without network
#   git-pull-live.sh check   # fetch; optionally auto-pull if AVA_GIT_AUTO_PULL=1 and clean
#   git-pull-live.sh pull    # fetch + ff-only pull (manual button)
set -euo pipefail

MODE="${1:-pull}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LOCK="${XDG_RUNTIME_DIR:-/tmp}/ava-auto-push.lock"
LOG_DIR="${AVA_AUTO_PUSH_LOG_DIR:-$REPO/data/logs}"
LOG="$LOG_DIR/git-pull-live.log"
mkdir -p "$LOG_DIR"

log() { printf '%s %s\n' "$(date -Iseconds)" "$*" | tee -a "$LOG"; }
emit_json() {
  # One machine-readable line for Electron IPC parsers.
  printf 'AVA_GIT_JSON:%s\n' "$1"
}

# Wait up to 90s for the push lock (manual pull should not silently no-op).
exec 9>"$LOCK"
WAITED=0
while ! flock -n 9; do
  if [ "$WAITED" -ge 90 ]; then
    log "busy: auto-push lock held"
    emit_json '{"ok":false,"action":"'"$MODE"'","detail":"busy_lock","behind":0,"ahead":0,"dirty":false,"pulled":false}'
    exit 2
  fi
  sleep 1
  WAITED=$((WAITED + 1))
done

cd "$REPO"

if [ ! -d .git ]; then
  log "not a git repo: $REPO"
  emit_json '{"ok":false,"action":"'"$MODE"'","detail":"not_a_repo","behind":0,"ahead":0,"dirty":false,"pulled":false}'
  exit 1
fi

if [ -d .git/rebase-merge ] || [ -d .git/rebase-apply ] || [ -f .git/MERGE_HEAD ]; then
  log "rebase/merge in progress"
  emit_json '{"ok":false,"action":"'"$MODE"'","detail":"rebase_or_merge","behind":0,"ahead":0,"dirty":true,"pulled":false}'
  exit 1
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo master)"
UPSTREAM="$(git rev-parse --abbrev-ref '@{u}' 2>/dev/null || echo "origin/${BRANCH}")"
REMOTE="${UPSTREAM%%/*}"
REMOTE_BRANCH="${UPSTREAM#*/}"
if [ "$REMOTE" = "$UPSTREAM" ]; then
  REMOTE="origin"
  REMOTE_BRANCH="$BRANCH"
fi

DIRTY=0
git diff --quiet && git diff --cached --quiet || DIRTY=1

count_range() {
  git rev-list --count "$1" 2>/dev/null || echo 0
}

AHEAD=0
BEHIND=0
if git rev-parse --verify "$UPSTREAM" >/dev/null 2>&1; then
  AHEAD="$(count_range "${UPSTREAM}..HEAD")"
  BEHIND="$(count_range "HEAD..${UPSTREAM}")"
fi

do_fetch() {
  log "fetch ${REMOTE}"
  git fetch --prune "$REMOTE" 2>&1 | tee -a "$LOG" || true
  if git rev-parse --verify "$UPSTREAM" >/dev/null 2>&1; then
    AHEAD="$(count_range "${UPSTREAM}..HEAD")"
    BEHIND="$(count_range "HEAD..${UPSTREAM}")"
  fi
}

CHANGED_CORE=0
CHANGED_DESKTOP=0
CHANGED_WEB=0
PULLED=0
DETAIL="ok"
OK=1

do_pull() {
  if [ "$DIRTY" -eq 1 ]; then
    DETAIL="dirty_tree"
    OK=0
    log "refuse pull: working tree dirty (commit/push first or stash)"
    return 1
  fi
  if [ "${BEHIND:-0}" -eq 0 ]; then
    DETAIL="already_up_to_date"
    log "already up to date with ${UPSTREAM}"
    return 0
  fi
  BEFORE="$(git rev-parse HEAD)"
  log "ff-only pull ${UPSTREAM} (${BEHIND} behind)"
  if ! git pull --ff-only "$REMOTE" "$REMOTE_BRANCH" 2>&1 | tee -a "$LOG"; then
    DETAIL="pull_failed"
    OK=0
    log "ff-only pull failed"
    return 1
  fi
  PULLED=1
  AFTER="$(git rev-parse HEAD)"
  FILES="$(git diff --name-only "$BEFORE..$AFTER" 2>/dev/null || true)"
  echo "$FILES" | grep -q '^apps/core/' && CHANGED_CORE=1 || true
  echo "$FILES" | grep -q '^apps/desktop/' && CHANGED_DESKTOP=1 || true
  echo "$FILES" | grep -q '^packages/web/' && CHANGED_WEB=1 || true
  AHEAD="$(count_range "${UPSTREAM}..HEAD")"
  BEHIND="$(count_range "HEAD..${UPSTREAM}")"
  DETAIL="pulled"
  log "pulled to $AFTER (core=$CHANGED_CORE desktop=$CHANGED_DESKTOP web=$CHANGED_WEB)"
  if [ -n "$FILES" ]; then
    echo "$FILES" | head -40 | while read -r f; do [ -n "$f" ] && echo "  · $f"; done
  fi
  return 0
}

case "$MODE" in
  status)
    DETAIL="status"
    ;;
  check)
    do_fetch
    if [ "${AVA_GIT_AUTO_PULL:-0}" = "1" ] && [ "$DIRTY" -eq 0 ] && [ "${BEHIND:-0}" -gt 0 ]; then
      do_pull || true
    else
      if [ "${BEHIND:-0}" -gt 0 ]; then
        DETAIL="behind"
      else
        DETAIL="up_to_date"
      fi
    fi
    ;;
  pull)
    do_fetch
    do_pull || true
    ;;
  *)
    log "unknown mode: $MODE"
    emit_json '{"ok":false,"action":"'"$MODE"'","detail":"bad_mode","behind":0,"ahead":0,"dirty":false,"pulled":false}'
    exit 1
    ;;
esac

DIRTY_JSON=false
[ "$DIRTY" -eq 1 ] && DIRTY_JSON=true
OK_JSON=true
[ "$OK" -eq 0 ] && OK_JSON=false
PULLED_JSON=false
[ "$PULLED" -eq 1 ] && PULLED_JSON=true

emit_json "$(cat <<EOF
{"ok":${OK_JSON},"action":"${MODE}","detail":"${DETAIL}","branch":"${BRANCH}","upstream":"${UPSTREAM}","ahead":${AHEAD:-0},"behind":${BEHIND:-0},"dirty":${DIRTY_JSON},"pulled":${PULLED_JSON},"changed_core":$([ "$CHANGED_CORE" -eq 1 ] && echo true || echo false),"changed_desktop":$([ "$CHANGED_DESKTOP" -eq 1 ] && echo true || echo false),"changed_web":$([ "$CHANGED_WEB" -eq 1 ] && echo true || echo false),"repo":"${REPO}"}
EOF
)"

[ "$OK" -eq 1 ]

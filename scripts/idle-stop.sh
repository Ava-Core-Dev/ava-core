#!/usr/bin/env bash
# Return the local desk to a true idle state by stopping the Ava stack and local LLM runtime.
set -u

DRY_RUN="${IDLE_STOP_DRY_RUN:-0}"

LOG_DIR="${HOME}/Ava-Core/data/logs"
mkdir -p "$LOG_DIR"

log() {
  printf '%s %s\n' "$(date -Iseconds)" "$*" | tee -a "$LOG_DIR/idle-stop.log"
}

# Keep the shutdown narrow and deterministic: stop the local desk stack and any
# port-backed helper services that are part of the same runtime footprint.
patterns=(
  'uvicorn.*apps\.core\.main:app'
  'python.*apps\.core\.main'
  'python.*apps\.voice\.director'
  'ollama serve'
  'ffplay.*AVA_MUSIC_BED'
  'mpg123.*AVA_MUSIC_BED'
  'play_music_bed'
  'obs-studio'
  'poller.*\.mjs'
  'local-edge.*server\.mjs'
  'node.*server\.mjs'
  'cloudflared'
)

pids=()
for pattern in "${patterns[@]}"; do
  while read -r pid; do
    [ -n "$pid" ] || continue
    pids+=("$pid")
  done < <(ps -eo pid=,args= 2>/dev/null | grep -E "$pattern" | grep -v grep | awk '{print $1}' | sort -u)
done

# Also terminate any helper service that keeps a known desk port open.
for port in 8787 8791 11434; do
  if command -v lsof >/dev/null 2>&1; then
    while read -r pid; do
      [ -n "$pid" ] || continue
      pids+=("$pid")
    done < <(lsof -ti "tcp:$port" 2>/dev/null || true)
  fi
done

if [ "${#pids[@]}" -eq 0 ]; then
  log "idle-stop: no monitored desk processes found; system is already idle"
  exit 0
fi

# Stop gracefully first, then force kill any leftovers.
for pid in $(printf '%s\n' "${pids[@]}" | sort -u); do
  if [ "$DRY_RUN" = "1" ]; then
    log "idle-stop: would stop PID $pid"
    continue
  fi
  if kill -TERM "$pid" 2>/dev/null; then
    log "idle-stop: sent TERM to PID $pid"
  fi
done

if [ "$DRY_RUN" != "1" ]; then
  sleep 3
fi
for pid in $(printf '%s\n' "${pids[@]}" | sort -u); do
  [ "$DRY_RUN" = "1" ] && continue
  if kill -0 "$pid" 2>/dev/null; then
    kill -KILL "$pid" 2>/dev/null || true
    log "idle-stop: force-killed PID $pid"
  fi
done

for pattern in "${patterns[@]}"; do
  [ "$DRY_RUN" = "1" ] && continue
  pkill -f "$pattern" 2>/dev/null || true
done

log "idle-stop: desk returned to idle state"

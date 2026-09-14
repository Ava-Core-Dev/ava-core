#!/usr/bin/env bash
# Keep Ava Core + Ollama up for public pages and rewrites.
set -euo pipefail

HEALTH_URL="${AVA_HEALTH_URL:-http://127.0.0.1:8787/health}"
CORE_SERVICE="${AVA_CORE_SERVICE:-ava-core.service}"
CHECK_OLLAMA="${AVA_CHECK_OLLAMA:-1}"
OLLAMA_URL="${AVA_OLLAMA_URL:-http://127.0.0.1:11434/api/tags}"

log() {
  printf '%s %s\n' "$(date -Iseconds)" "$*"
}

health_ok=0
if curl -fsS --max-time 4 "$HEALTH_URL" >/dev/null 2>&1; then
  health_ok=1
fi

if [ "$health_ok" -ne 1 ]; then
  log "health check failed, restarting $CORE_SERVICE"
  sudo systemctl restart "$CORE_SERVICE"
  sleep 2
  if curl -fsS --max-time 6 "$HEALTH_URL" >/dev/null 2>&1; then
    log "ava core recovered"
  else
    log "ava core still unhealthy after restart"
    exit 1
  fi
fi

if [ "$CHECK_OLLAMA" = "1" ]; then
  if ! curl -fsS --max-time 4 "$OLLAMA_URL" >/dev/null 2>&1; then
    log "ollama not responding, attempting local start"
    if command -v systemctl >/dev/null 2>&1; then
      sudo systemctl restart ollama.service >/dev/null 2>&1 || true
    fi
    if command -v ollama >/dev/null 2>&1; then
      nohup ollama serve >/dev/null 2>&1 &
      disown || true
    fi
  fi
fi

log "runtime check ok"


#!/usr/bin/env bash
# Ava launcher — manual / dev start (no systemd).
# Starts core + voice director in the foreground with live logs.
# Use systemd units for production autostart.
set -euo pipefail

AVA_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$AVA_ROOT"
VENV="$AVA_ROOT/.venv"
LOG_DIR="$AVA_ROOT/data/logs"

if [ ! -f "$VENV/bin/uvicorn" ]; then
  echo "ERROR: venv not found. Run scripts/install.sh first."
  exit 1
fi

if [ ! -f "$AVA_ROOT/.env" ]; then
  echo "ERROR: .env not found. Copy .env.example and fill in tokens."
  exit 1
fi

mkdir -p "$LOG_DIR"

export OLLAMA_HOST="${OLLAMA_HOST:-127.0.0.1:11434}"
export OLLAMA_MODELS="${OLLAMA_MODELS:-$HOME/.ollama/models}"

echo "=== Ava Launcher ==="
echo "Root: $AVA_ROOT"
echo "Logs: $LOG_DIR"
echo ""

# ── Ensure local LLM runtime is available ─────────────────────────────────────
if ! pgrep -f "ollama serve" >/dev/null 2>&1; then
  echo "Starting Ollama local server..."
  nohup ollama serve >> "$LOG_DIR/ollama.log" 2>&1 &
  for _ in $(seq 1 30); do
    if curl -fsS "http://$OLLAMA_HOST/api/tags" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
fi

# ── Kill any leftover processes on port 8787 ──────────────────────────────────
if lsof -ti:8787 &>/dev/null; then
  echo "Stopping existing process on :8787..."
  kill $(lsof -ti:8787) 2>/dev/null || true
  sleep 1
fi

# Ava Core owns the in-process Stream Director and voice lifecycle.
# Starting a second external director would create competing music supervisors.
# ── Start core (foreground — logs to stdout + file) ───────────────────────────
echo "Starting Ava Core on :8787..."
echo ""
"$VENV/bin/uvicorn" apps.core.main:app \
  --host 0.0.0.0 \
  --port 8787 \
  --log-level info \
  --no-access-log \
  2>&1 | tee -a "$LOG_DIR/ava-core.log"


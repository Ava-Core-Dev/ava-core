#!/usr/bin/env bash
# Ava launcher — manual / dev start (no systemd).
# Starts core + voice director in the foreground with live logs.
# Use systemd units for production autostart.
set -euo pipefail

AVA_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
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

echo "=== Ava Launcher ==="
echo "Root: $AVA_ROOT"
echo "Logs: $LOG_DIR"
echo ""

# ── Kill any leftover processes on port 8787 ──────────────────────────────────
if lsof -ti:8787 &>/dev/null; then
  echo "Stopping existing process on :8787..."
  kill $(lsof -ti:8787) 2>/dev/null || true
  sleep 1
fi

# ── Start voice director (background) ────────────────────────────────────────
echo "Starting voice director..."
"$VENV/bin/python" -m apps.voice.director \
  >> "$LOG_DIR/ava-voice.log" 2>&1 &
VOICE_PID=$!
echo "  Voice PID: $VOICE_PID"

# ── Start core (foreground — logs to stdout + file) ───────────────────────────
echo "Starting Ava Core on :8787..."
echo ""
"$VENV/bin/uvicorn" apps.core.main:app \
  --host 0.0.0.0 \
  --port 8787 \
  --log-level info \
  --no-access-log \
  2>&1 | tee -a "$LOG_DIR/ava-core.log"

# Cleanup voice on exit
kill $VOICE_PID 2>/dev/null || true

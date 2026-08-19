#!/usr/bin/env bash
# Start Ava Core + Voice pipeline (dev / manual mode).
# For production use systemd units instead.
set -euo pipefail

AVA_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENV="$AVA_ROOT/.venv"
LOG_DIR="$AVA_ROOT/data/logs"
mkdir -p "$LOG_DIR"

echo "Starting Ava Core..."
"$VENV/bin/uvicorn" apps.core.main:app \
  --host 0.0.0.0 \
  --port 8787 \
  --log-level info \
  --no-access-log \
  2>&1 | tee "$LOG_DIR/ava-core.log" &
CORE_PID=$!

echo "Starting Ava Voice Director..."
"$VENV/bin/python" -m apps.voice.director \
  2>&1 | tee "$LOG_DIR/ava-voice.log" &
VOICE_PID=$!

echo "Ava Core PID=$CORE_PID  Voice PID=$VOICE_PID"
echo "Logs: $LOG_DIR"
echo "Press Ctrl+C to stop."

trap "kill $CORE_PID $VOICE_PID 2>/dev/null" EXIT
wait

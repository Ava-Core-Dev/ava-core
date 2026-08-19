#!/usr/bin/env bash
# Ava install — one-shot setup + systemd autostart.
# Run as ava-core user (sudo will be invoked for systemd steps).
set -euo pipefail

AVA_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENV="$AVA_ROOT/.venv"
SYSTEMD_SYS_DIR="/etc/systemd/system"

echo "=== Ava Install ==="
echo "Root: $AVA_ROOT"
echo ""

# ── Python venv ───────────────────────────────────────────────────────────────
if [ ! -d "$VENV" ]; then
  echo "Creating Python venv..."
  python3 -m venv "$VENV"
fi

echo "Upgrading pip + installing dependencies..."
"$VENV/bin/pip" install -q --upgrade pip setuptools wheel
"$VENV/bin/pip" install -q -r "$AVA_ROOT/requirements.txt" 2>/dev/null || \
  "$VENV/bin/pip" install -q \
    fastapi uvicorn[standard] httpx apscheduler psutil \
    websockets obs-websocket-py python-dotenv

# ── .env ──────────────────────────────────────────────────────────────────────
if [ ! -f "$AVA_ROOT/.env" ]; then
  cp "$AVA_ROOT/.env.example" "$AVA_ROOT/.env"
  echo "Created .env from example — fill in your tokens before starting!"
else
  echo ".env already present — skipping."
fi

# ── Data directories ──────────────────────────────────────────────────────────
echo "Creating data directories..."
mkdir -p "$AVA_ROOT/data"/{generated,reports,logs,db,state}

# ── Voice assets ──────────────────────────────────────────────────────────────
echo "Ensuring voice assets are in place..."
bash "$AVA_ROOT/scripts/migrate.sh" 2>/dev/null || true

# ── Systemd units ─────────────────────────────────────────────────────────────
if ! command -v systemctl &>/dev/null; then
  echo "systemctl not found — skipping service install."
else
  echo "Installing systemd units..."
  for unit in ava-core ava-tunnel ava-voice; do
    sudo cp "$AVA_ROOT/systemd/$unit.service" "$SYSTEMD_SYS_DIR/"
    echo "  Installed /etc/systemd/system/$unit.service"
  done

  sudo systemctl daemon-reload
  echo ""

  # Enable all three for autostart
  echo "Enabling services for autostart on boot..."
  sudo systemctl enable ava-core.service ava-tunnel.service ava-voice.service
  echo "  Enabled: ava-core  ava-tunnel  ava-voice"
  echo ""

  # Ask before starting now
  echo "Start services now? [Y/n]"
  read -r START_NOW
  START_NOW="${START_NOW:-Y}"
  if [[ "$START_NOW" =~ ^[Yy]$ ]]; then
    echo "Starting ava-tunnel..."
    sudo systemctl start ava-tunnel.service
    sleep 2

    echo "Starting ava-core..."
    sudo systemctl start ava-core.service
    sleep 3

    echo "Starting ava-voice..."
    sudo systemctl start ava-voice.service
    sleep 1

    echo ""
    echo "Status:"
    sudo systemctl status ava-core.service   --no-pager -l | head -8
    sudo systemctl status ava-voice.service  --no-pager -l | head -5
    sudo systemctl status ava-tunnel.service --no-pager -l | head -5
  else
    echo "Skipped. Start manually with:"
    echo "  sudo systemctl start ava-tunnel ava-core ava-voice"
  fi
fi

echo ""
echo "=== Install complete ==="
echo "Logs:   $AVA_ROOT/data/logs/"
echo "API:    http://localhost:8787/api/status"
echo "Dev:    bash scripts/launch.sh"

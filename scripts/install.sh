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
    websockets obs-websocket-py python-dotenv aiomysql

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
  # ── System deps (PHP + phpMyAdmin) ────────────────────────────────────────
  if ! command -v php &>/dev/null; then
    echo "Installing PHP + phpMyAdmin..."
    DEBIAN_FRONTEND=noninteractive sudo apt-get install -y --no-install-recommends \
      php php-mbstring php-zip php-gd php-json php-curl phpmyadmin 2>&1 | \
      grep -E "^(Setting up|E:|W:)" || true
  else
    echo "PHP already installed."
    if [ ! -d /usr/share/phpmyadmin ]; then
      echo "Installing phpMyAdmin..."
      DEBIAN_FRONTEND=noninteractive sudo apt-get install -y --no-install-recommends \
        phpmyadmin php-mbstring 2>&1 | grep -E "^(Setting up|E:|W:)" || true
    else
      echo "phpMyAdmin already installed."
    fi
  fi

  echo "Installing systemd units..."
  for unit in ava-core ava-tunnel ava-voice ava-minecraft-test ava-phpmyadmin; do
    if [ -f "$AVA_ROOT/systemd/$unit.service" ]; then
      sudo cp "$AVA_ROOT/systemd/$unit.service" "$SYSTEMD_SYS_DIR/"
      echo "  Installed /etc/systemd/system/$unit.service"
    fi
  done

  sudo systemctl daemon-reload
  echo ""

  # Enable for autostart — tunnel stays system-managed; core/voice are GUI-managed
  echo "Enabling services for autostart on boot..."
  sudo systemctl enable ava-tunnel.service ava-phpmyadmin.service
  # Core + voice follow the Electron GUI (start on open, stop on close) — do not enable at boot
  sudo systemctl disable ava-core.service ava-voice.service 2>/dev/null || true
  sudo systemctl stop ava-core.service ava-voice.service 2>/dev/null || true
  sudo systemctl enable ava-minecraft-test.service 2>/dev/null && true
  echo "  Enabled: ava-tunnel  ava-phpmyadmin  (ava-core/voice = GUI lifecycle)"
  echo ""

  # Ask before starting now
  echo "Start services now? [Y/n]"
  read -r START_NOW
  START_NOW="${START_NOW:-Y}"
  if [[ "$START_NOW" =~ ^[Yy]$ ]]; then
    echo "Starting ava-tunnel..."
    sudo systemctl start ava-tunnel.service
    sleep 2

    echo "Starting ava-phpmyadmin..."
    sudo systemctl start ava-phpmyadmin.service 2>/dev/null || true

    echo "Starting ava-minecraft-test..."
    sudo systemctl start ava-minecraft-test.service 2>/dev/null || true

    echo ""
    echo "Note: ava-core + ava-voice start when you open the Ava Ivy GUI."
    echo "Status:"
    sudo systemctl status ava-tunnel.service      --no-pager -l | head -5
    sudo systemctl status ava-phpmyadmin.service  --no-pager -l | head -5
    sudo systemctl status ava-minecraft-test.service --no-pager -l | head -5
  else
    echo "Skipped. Start manually with:"
    echo "  sudo systemctl start ava-tunnel ava-core ava-voice ava-phpmyadmin ava-minecraft-test"
  fi
fi

echo ""
echo "=== Install complete ==="
echo "Logs:   $AVA_ROOT/data/logs/"
echo "API:    http://localhost:8787/api/status"
echo "Dev:    bash scripts/launch.sh"
echo "DB UI:  http://localhost:8890/ (phpMyAdmin — log in as 'ava')"

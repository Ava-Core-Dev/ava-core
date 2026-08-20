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
  for unit in ava-core ava-tunnel ava-voice ava-minecraft-test ava-phpmyadmin ava-runtime-watchdog; do
    if [ -f "$AVA_ROOT/systemd/$unit.service" ]; then
      sudo cp "$AVA_ROOT/systemd/$unit.service" "$SYSTEMD_SYS_DIR/"
      echo "  Installed /etc/systemd/system/$unit.service"
    fi
  done
  if [ -f "$AVA_ROOT/systemd/ava-runtime-watchdog.timer" ]; then
    sudo cp "$AVA_ROOT/systemd/ava-runtime-watchdog.timer" "$SYSTEMD_SYS_DIR/"
    echo "  Installed /etc/systemd/system/ava-runtime-watchdog.timer"
  fi

  sudo systemctl daemon-reload
  echo ""

  # Enable for autostart
  echo "Enabling services for autostart on boot..."
  sudo systemctl enable ava-core.service ava-tunnel.service ava-phpmyadmin.service
  sudo systemctl enable ava-runtime-watchdog.timer 2>/dev/null || true
  # Voice can stay desktop-managed.
  sudo systemctl disable ava-voice.service 2>/dev/null || true
  sudo chmod +x "$AVA_ROOT/scripts/ensure-ava-runtime.sh" 2>/dev/null || true
  sudo systemctl enable ava-minecraft-test.service 2>/dev/null && true
  echo "  Enabled: ava-core  ava-tunnel  ava-phpmyadmin  ava-runtime-watchdog.timer"
  echo ""

  # Ask before starting now
  echo "Start services now? [Y/n]"
  read -r START_NOW
  START_NOW="${START_NOW:-Y}"
  if [[ "$START_NOW" =~ ^[Yy]$ ]]; then
    echo "Starting ava-core + ava-tunnel..."
    sudo systemctl start ava-core.service
    sudo systemctl start ava-tunnel.service
    sleep 2

    echo "Starting ava-phpmyadmin..."
    sudo systemctl start ava-phpmyadmin.service 2>/dev/null || true

    echo "Starting ava-minecraft-test..."
    sudo systemctl start ava-minecraft-test.service 2>/dev/null || true

    echo ""
    echo "Ava Core is now a background service and auto-heals every minute."
    echo "Status:"
    sudo systemctl status ava-core.service        --no-pager -l | head -5
    sudo systemctl status ava-tunnel.service      --no-pager -l | head -5
    sudo systemctl status ava-phpmyadmin.service  --no-pager -l | head -5
    sudo systemctl status ava-runtime-watchdog.timer --no-pager -l | head -5
    sudo systemctl status ava-minecraft-test.service --no-pager -l | head -5
  else
    echo "Skipped. Start manually with:"
    echo "  sudo systemctl start ava-core ava-tunnel ava-phpmyadmin ava-runtime-watchdog.timer ava-minecraft-test"
  fi
fi

# ── Auto-push to GitHub (user timer, no sudo) ────────────────────────────────
USER_SD="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
mkdir -p "$USER_SD"
# Rewrite unit paths to this checkout so a moved tree still works
sed "s|/home/ava-core/ava/ava-core-v2|$AVA_ROOT|g" \
  "$AVA_ROOT/systemd/ava-auto-push.service" > "$USER_SD/ava-auto-push.service"
cp "$AVA_ROOT/systemd/ava-auto-push.timer" "$USER_SD/ava-auto-push.timer"
chmod +x "$AVA_ROOT/scripts/auto-push.sh" "$AVA_ROOT/.cursor/hooks/auto-push.sh" 2>/dev/null || true
systemctl --user daemon-reload
systemctl --user enable --now ava-auto-push.timer
echo "  Git auto-push: every 2 min → origin (systemctl --user status ava-auto-push.timer)"

echo ""
echo "=== Install complete ==="
echo "Logs:   $AVA_ROOT/data/logs/"
echo "API:    http://localhost:8787/api/status"
echo "Dev:    bash scripts/launch.sh"
echo "DB UI:  http://localhost:8890/ (phpMyAdmin — log in as 'ava')"

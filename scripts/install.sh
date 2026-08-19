#!/usr/bin/env bash
# One-shot setup: creates venv, installs deps, installs systemd units.
set -euo pipefail

AVA_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENV="$AVA_ROOT/.venv"
SYSTEMD_USER_DIR="$HOME/.config/systemd/user"
SYSTEMD_SYS_DIR="/etc/systemd/system"

echo "=== Ava Install ==="
echo "Root: $AVA_ROOT"

# Python venv
if [ ! -d "$VENV" ]; then
  echo "Creating venv..."
  python3 -m venv "$VENV"
fi

echo "Installing Python deps..."
"$VENV/bin/pip" install -q --upgrade pip
"$VENV/bin/pip" install -q -e "$AVA_ROOT[dev]"

# Create .env if missing
if [ ! -f "$AVA_ROOT/.env" ]; then
  cp "$AVA_ROOT/.env.example" "$AVA_ROOT/.env"
  echo "Created .env from example — fill in your tokens!"
fi

# Create data dirs
mkdir -p "$AVA_ROOT/data"/{generated,reports,logs,db}

# Install systemd units (system-wide, requires sudo)
if command -v systemctl &>/dev/null; then
  echo "Installing systemd units..."
  for unit in ava-core ava-tunnel ava-voice; do
    sudo cp "$AVA_ROOT/systemd/$unit.service" "$SYSTEMD_SYS_DIR/"
    echo "  Installed $unit.service"
  done
  sudo systemctl daemon-reload
  echo "Run 'sudo systemctl enable --now ava-core ava-tunnel ava-voice' to start on boot."
fi

echo ""
echo "=== Done ==="
echo "Next: edit .env, then run ./scripts/start.sh"

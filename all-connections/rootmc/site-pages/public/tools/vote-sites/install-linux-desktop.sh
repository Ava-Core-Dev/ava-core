#!/usr/bin/env bash
# Copy the Linux vote opener to your Desktop and trust the launcher.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DESK="${XDG_DESKTOP_DIR:-$HOME/Desktop}"
mkdir -p "$DESK"
install -m 0755 "$HERE/open-vote-sites.sh" "$DESK/open-vote-sites.sh"
cat > "$DESK/RootMC-Vote.desktop" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=RootMC Vote
Comment=Open all 8 listing vote sites in one window
Exec=$DESK/open-vote-sites.sh
Icon=applications-internet
Terminal=false
Categories=Network;Game;
StartupNotify=true
EOF
chmod +x "$DESK/RootMC-Vote.desktop"
if command -v gio >/dev/null 2>&1; then
  gio set "$DESK/RootMC-Vote.desktop" metadata::trusted true 2>/dev/null || true
fi
echo "Installed to $DESK — double-click RootMC Vote (or open-vote-sites.sh)."

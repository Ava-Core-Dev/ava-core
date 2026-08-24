#!/usr/bin/env bash
set -euo pipefail
BASE="/home/ava-core/operations/system-tools/desk/ava_core_visual_cli"
APP="$BASE/ava_core_visual_cli.py"
DESKTOP="/home/ava-core/Desktop"

mkdir -p "$BASE" "$DESKTOP"

# Remove the old shortcut set created for the mistaken generic-terminal implementation.
find "$DESKTOP" -maxdepth 1 -type f \( \
  -iname '*ava*core*start*.desktop' -o \
  -iname '*ava*core*stop*.desktop' -o \
  -iname '*ava*core*restart*.desktop' -o \
  -iname '*ava*core*terminal*.desktop' -o \
  -iname '*ava*core*live*log*.desktop' \
\) -delete

chmod +x "$APP"

cat > "$DESKTOP/AVA Core.desktop" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=AVA Core
Comment=AVA Core Operations Console
Exec=/usr/bin/python3 $APP
Icon=utilities-terminal
Terminal=false
Categories=System;Utility;
StartupNotify=true
EOF

chmod +x "$DESKTOP/AVA Core.desktop"
gio set "$DESKTOP/AVA Core.desktop" metadata::trusted true 2>/dev/null || true
echo "Installed: $DESKTOP/AVA Core.desktop"
echo "AVA Core Visual CLI ready."

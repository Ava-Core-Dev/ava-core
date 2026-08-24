#!/usr/bin/env bash
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPS="/home/ava-core/operations"
ALWAYS="$OPS/cronologicals/always-on"
APP="/home/ava-core/operations/system-tools/ava-core-visual-cli"
DESKTOP="/home/ava-core/Desktop"
mkdir -p "$ALWAYS" "$APP" "$DESKTOP" /home/ava-core/Database/logs

cp "$SRC_DIR/ava_core_audio_player.py" "$ALWAYS/ava_core_audio_player.py"
chmod +x "$ALWAYS/ava_core_audio_player.py"

cp "$SRC_DIR/ava_core_visual_cli.py" "$APP/ava_core_visual_cli.py"
chmod +x "$APP/ava_core_visual_cli.py"

cat > "$DESKTOP/AVA Core Visual CLI.desktop" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=AVA Core Visual CLI
Comment=AVA Core Operations and Audio Console
Exec=/usr/bin/python3 $APP/ava_core_visual_cli.py
Icon=utilities-terminal
Terminal=false
Categories=System;Utility;
EOF
chmod +x "$DESKTOP/AVA Core Visual CLI.desktop"

if ! command -v ffplay >/dev/null 2>&1 && ! command -v mpg123 >/dev/null 2>&1 && ! command -v cvlc >/dev/null 2>&1 && ! command -v vlc >/dev/null 2>&1; then
  echo "WARNING: No supported MP3 player found."
  echo "Install one, for example: sudo apt install ffmpeg"
else
  echo "Audio backend found."
fi

echo "Restarting Ava-Core so the new always-on audio player is picked up..."
sudo systemctl restart ava-core.service

echo
echo "Installed:"
echo "  $APP/ava_core_visual_cli.py"
echo "  $ALWAYS/ava_core_audio_player.py"
echo "  $DESKTOP/AVA Core Visual CLI.desktop"
echo
echo "Audio behavior:"
echo "  *.mp3            = enabled"
echo "  *.mp3.disabled   = disabled"
echo "  Scan root: /home/ava-core/operations/cronologicals"
echo "  Skips: always-on and __pycache__"

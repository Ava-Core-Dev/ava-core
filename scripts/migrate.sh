#!/usr/bin/env bash
# After a fresh checkout: point this tree at the canonical media library
# /home/ava-core/ava/media  (do not copy binaries into git).
set -euo pipefail

NEW="$(cd "$(dirname "$0")/.." && pwd)"
MEDIA="${AVA_MEDIA_DIR:-/home/ava-core/ava/media}"

echo "=== Ava migrate (media is $MEDIA) ==="

if [ ! -d "$MEDIA/audio" ]; then
  echo "Canonical media library missing at $MEDIA"
  echo "Run: $NEW/scripts/consolidate_media.sh"
  exit 1
fi

# App paths are pointers, never a second copy
ln -sfn "$MEDIA" "$NEW/apps/media"
ln -sfn "$MEDIA/audio" "$NEW/apps/voice/assets"
echo "  apps/media        -> $MEDIA"
echo "  apps/voice/assets -> $MEDIA/audio"

# Thumbnail used by the MP4 converter lives in images/thumbnails
if [ -f "$MEDIA/images/thumbnails/DEFAULT.jpg" ]; then
  echo "  thumbnail: $MEDIA/images/thumbnails/DEFAULT.jpg"
fi

echo "=== done ==="
echo "Next: cd '$NEW' && ./scripts/install.sh"

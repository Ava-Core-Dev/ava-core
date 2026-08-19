#!/usr/bin/env bash
# Migrate assets from the old /home/ava-core/ava tree into this new build.
# Run once after install.sh. Does NOT copy Node.js core (replaced) or .venv.
set -euo pipefail

OLD="/home/ava-core/ava"
NEW="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== Ava Migration ==="
echo "From: $OLD"
echo "To:   $NEW"
echo ""

# ── Voice assets ──────────────────────────────────────────────────────────────
echo "Migrating voice assets..."
ASSETS="$NEW/apps/voice/assets"
mkdir -p "$ASSETS/numbers" "$ASSETS/words" "$ASSETS/time_clips" "$ASSETS/sounds"

# Primary source: Ara zip files on Desktop (includes all new clips)
DESKTOP="/home/ava-core/Desktop"
if [ -f "$DESKTOP/ara_voice_bits.zip" ]; then
  echo "  Extracting ara_voice_bits.zip..."
  tmpdir=$(mktemp -d)
  unzip -q "$DESKTOP/ara_voice_bits.zip" -d "$tmpdir"
  cp -n "$tmpdir/data/voice/words/"*.mp3    "$ASSETS/words/"    2>/dev/null && echo "    words/ from zip"
  cp -n "$tmpdir/data/voice/numbers/"*.mp3  "$ASSETS/numbers/"  2>/dev/null && echo "    numbers/ from zip"
  rm -rf "$tmpdir"
fi
if [ -f "$DESKTOP/ara_numbers_extra.zip" ]; then
  echo "  Extracting ara_numbers_extra.zip..."
  tmpdir=$(mktemp -d)
  unzip -q "$DESKTOP/ara_numbers_extra.zip" -d "$tmpdir"
  cp -n "$tmpdir/data/voice/numbers/"*.mp3  "$ASSETS/numbers/"  2>/dev/null && echo "    extra numbers/ from zip"
  rm -rf "$tmpdir"
fi

# Fallback: old voice tree (fills any remaining gaps)
if [ -d "$OLD/voice/numbers" ]; then
  cp -rn "$OLD/voice/numbers/." "$ASSETS/numbers/" && echo "  numbers/ from old tree"
fi
if [ -d "$OLD/voice/words" ]; then
  cp -rn "$OLD/voice/words/." "$ASSETS/words/" && echo "  words/ from old tree"
fi
if [ -d "$OLD/voice/time_clips" ]; then
  cp -rn "$OLD/voice/time_clips/." "$ASSETS/time_clips/" && echo "  time_clips/ copied"
fi
if [ -d "$OLD/python version/ava-core/voice/time_clips" ]; then
  cp -rn "$OLD/python version/ava-core/voice/time_clips/." "$ASSETS/time_clips/" && echo "  time_clips (python ver) copied"
fi
if [ -f "$OLD/python version/ava-core/sounds/futuristic_bell.mp3" ]; then
  cp "$OLD/python version/ava-core/sounds/futuristic_bell.mp3" "$ASSETS/sounds/" && echo "  futuristic_bell.mp3 copied"
fi
if [ -f "$OLD/python version/ava-core/thumbnail.jpg" ]; then
  cp "$OLD/python version/ava-core/thumbnail.jpg" "$ASSETS/" && echo "  thumbnail.jpg copied"
fi

# ── Generated audio (current outputs) ─────────────────────────────────────────
echo "Migrating generated audio..."
if [ -d "$OLD/voice/generated" ]; then
  cp -rn "$OLD/voice/generated/." "$NEW/data/generated/" && echo "  generated/ copied"
fi

# ── Reports ───────────────────────────────────────────────────────────────────
echo "Migrating reports..."
if [ -d "$OLD/reports" ]; then
  cp -rn "$OLD/reports/." "$NEW/data/reports/" && echo "  reports/ copied"
fi

# ── Cron watermarks + data ────────────────────────────────────────────────────
echo "Migrating cron state..."
if [ -d "$OLD/core/data" ]; then
  mkdir -p "$NEW/data/state"
  cp -rn "$OLD/core/data/." "$NEW/data/state/" && echo "  core/data/ copied to data/state/"
fi

# ── Electron desktop ──────────────────────────────────────────────────────────
echo "Desktop: symlinking..."
if [ -d "$OLD/desktop" ] && [ ! -e "$NEW/apps/desktop" ]; then
  ln -sf "$OLD/desktop" "$NEW/apps/desktop" && echo "  apps/desktop → $OLD/desktop"
fi

# ── CF Worker source (existing workstations) ──────────────────────────────────
echo ""
echo "CF Workers already scaffolded. To sync existing sources, run manually:"
echo "  rsync -a '$OLD/workstations/rootmc/Web Files/rootrecord-api-account/src/' '$NEW/packages/workers/src/rootmc-api/account-src/'"

echo ""
echo "=== Migration complete ==="
echo "Next: cd '$NEW' && ./scripts/install.sh"

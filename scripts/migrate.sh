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

# Primary: assets already live in the repo checkout (extracted from Ara zips at build time)
# They are gitignored (binary/large) but present on disk in any fresh clone that ran
# scripts/migrate.sh previously, or in the canonical SSD build at ava-core-v2.
CANONICAL="/run/media/ava-core/6B6C97406BF24558/ava-core-v2/apps/voice/assets"
if [ -d "$CANONICAL/words" ] && [ "$CANONICAL" != "$ASSETS" ]; then
  cp -rn "$CANONICAL/words/."      "$ASSETS/words/"      2>/dev/null && echo "  words/ from canonical build"
  cp -rn "$CANONICAL/numbers/."    "$ASSETS/numbers/"    2>/dev/null && echo "  numbers/ from canonical build"
  cp -rn "$CANONICAL/time_clips/." "$ASSETS/time_clips/" 2>/dev/null && echo "  time_clips/ from canonical build"
  cp -rn "$CANONICAL/sounds/."     "$ASSETS/sounds/"     2>/dev/null && echo "  sounds/ from canonical build"
fi

# Gap-filler: old ava voice tree (anything not already present)
if [ -d "$OLD/voice/numbers" ]; then
  cp -rn "$OLD/voice/numbers/."  "$ASSETS/numbers/"  2>/dev/null && echo "  numbers/ gap-fill from old tree"
fi
if [ -d "$OLD/voice/words" ]; then
  cp -rn "$OLD/voice/words/."    "$ASSETS/words/"    2>/dev/null && echo "  words/ gap-fill from old tree"
fi
if [ -d "$OLD/voice/time_clips" ]; then
  cp -rn "$OLD/voice/time_clips/." "$ASSETS/time_clips/" 2>/dev/null && echo "  time_clips/ gap-fill from old tree"
fi
if [ -d "$OLD/python version/ava-core/voice/time_clips" ]; then
  cp -rn "$OLD/python version/ava-core/voice/time_clips/." "$ASSETS/time_clips/" 2>/dev/null && echo "  time_clips (python ver) gap-fill"
fi
if [ -f "$OLD/python version/ava-core/sounds/futuristic_bell.mp3" ]; then
  cp -n "$OLD/python version/ava-core/sounds/futuristic_bell.mp3" "$ASSETS/sounds/" 2>/dev/null && echo "  futuristic_bell.mp3 copied"
fi
if [ -f "$OLD/python version/ava-core/thumbnail.jpg" ]; then
  cp -n "$OLD/python version/ava-core/thumbnail.jpg" "$ASSETS/" 2>/dev/null && echo "  thumbnail.jpg copied"
fi

echo "  Voice totals: words=$(ls "$ASSETS/words/" 2>/dev/null | wc -l)  numbers=$(ls "$ASSETS/numbers/" 2>/dev/null | wc -l)  time=$(ls "$ASSETS/time_clips/" 2>/dev/null | wc -l)"

# ── Staged media library (portraits, thumbs, clips) ───────────────────────────
echo "Ensuring apps/media library..."
MEDIA="$NEW/apps/media"
CANON_MEDIA="/run/media/ava-core/6B6C97406BF24558/ava-core-v2/apps/media"
if [ -d "$CANON_MEDIA/thumbnails" ] && [ "$CANON_MEDIA" != "$MEDIA" ]; then
  mkdir -p "$MEDIA"
  cp -rn "$CANON_MEDIA/." "$MEDIA/" 2>/dev/null && echo "  apps/media/ from canonical SSD build"
fi
# Keep voice thumbnail in sync with DEFAULT broadcast thumb
if [ -f "$MEDIA/thumbnails/DEFAULT.jpg" ]; then
  cp -f "$MEDIA/thumbnails/DEFAULT.jpg" "$ASSETS/thumbnail.jpg"
  echo "  voice thumbnail ← apps/media/thumbnails/DEFAULT.jpg"
elif [ -f "$MEDIA/thumbnails/thumb-daily-broadcast.jpg" ]; then
  cp -f "$MEDIA/thumbnails/thumb-daily-broadcast.jpg" "$ASSETS/thumbnail.jpg"
fi
echo "  Media files: $(find "$MEDIA" -type f 2>/dev/null | wc -l)"

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

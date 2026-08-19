#!/usr/bin/env bash
# Import Ava's built tools/projects into /home/ava-core/ava/workstations
# Source trees only — no node_modules, gradle build, paper worlds, or MySQL datadir.
set -euo pipefail

DEST="${1:-/home/ava-core/ava/workstations}"
OLD="/home/ava-core/ava-old-20260819"
RSYNC=(rsync -a --info=stats0,flist0
  --exclude node_modules
  --exclude .gradle
  --exclude build
  --exclude .git
  --exclude world
  --exclude world_nether
  --exclude world_the_end
  --exclude '*.log'
  --exclude files.log
)

copy() {
  local src="$1" dest="$2"
  if [ ! -e "$src" ]; then
    echo "  skip missing $src"
    return 0
  fi
  mkdir -p "$dest"
  echo "  $src"
  echo "    -> $dest"
  "${RSYNC[@]}" "$src" "$dest"
}

echo "=== Import workstations -> $DEST ==="
mkdir -p "$DEST"/{android,minecraft-plugins,cloudflare,rootmc-web,obs,android/builds}

copy "$OLD/workstations/rootmc/Plugin Building/Minecraft/" \
     "$DEST/minecraft-plugins/"

copy "$OLD/workstations/rootmc/Mobile App Files/kilauea-alerts-android/" \
     "$DEST/android/kilauea-alerts/"

copy "$OLD/workstations/rootmc/Mobile App Files/rootmc-android/" \
     "$DEST/android/rootmc/"

# Keep a couple of release APKs, not the whole 300M build tree
mkdir -p "$DEST/android/builds"
find "$OLD/workstations/rootmc/Mobile App Files/builds" -name '*.apk' -type f 2>/dev/null \
  | head -20 | while read -r apk; do
    cp -n "$apk" "$DEST/android/builds/" 2>/dev/null || true
  done

copy "$OLD/workstations/cloudflare/" "$DEST/cloudflare/"
copy "$OLD/workstations/rootmc/Web Files/" "$DEST/rootmc-web/"
copy "$OLD/workstations/rootmc/scripts/" "$DEST/rootmc-scripts/"
copy "$OLD/workstations/rootrecord/solana-rootrecord-site/" "$DEST/solana-rootrecord-site/"
copy "$OLD/obs scripts/" "$DEST/obs/"
copy "$OLD/workstations/rootmc/docs/" "$DEST/rootmc-docs/"

# Live Paper server stays where it runs until the world is moved; pointer only
if [ -d "$OLD/workstations/minecraft-test" ] && [ ! -L "$DEST/minecraft-test-live" ]; then
  ln -sfn "$OLD/workstations/minecraft-test" "$DEST/minecraft-test-live"
fi

echo ""
echo "=== sizes ==="
du -sh "$DEST" "$DEST"/* 2>/dev/null | sort -h
echo "Done."

#!/usr/bin/env bash
# install-ecoflow-cron.sh — wire EcoFlow hierarchy into cronologicals
#
# Run on the ava-core host as the user that owns /home/ava-core
#   bash install-ecoflow-cron.sh
#
# What it does:
#   1. Ensures interval folders exist (incl. quarter / year / 15min / 4h / 3d)
#   2. Symlinks ecoflow_lib.py into every folder that has an ecoflow-*.py
#   3. Moves ecoflow-catchup.py → in-order-on-boot/00:01/ (+ lib symlink)
#   4. Removes stray ava-core.py / catchup / lib from since-last-fire ROOT
#      (keeps a single lib source; does not delete the real ava-core process)
#   5. Prints a placement summary

set -euo pipefail

CRON_ROOT="${CRON_ROOT:-/home/ava-core/operations/cronologicals}"
SINCE="$CRON_ROOT/since-last-fire"
BOOT="$CRON_ROOT/in-order-on-boot/00:01"

# Prefer lib already sitting in since-last-fire; else same dir as this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SINCE/ecoflow_lib.py" ]]; then
  LIB_SRC="$SINCE/ecoflow_lib.py"
elif [[ -f "$SCRIPT_DIR/ecoflow_lib.py" ]]; then
  LIB_SRC="$SCRIPT_DIR/ecoflow_lib.py"
  mkdir -p "$SINCE"
  cp -n "$LIB_SRC" "$SINCE/ecoflow_lib.py"
  LIB_SRC="$SINCE/ecoflow_lib.py"
else
  echo "ERROR: ecoflow_lib.py not found in $SINCE or $SCRIPT_DIR" >&2
  exit 1
fi

echo "=== EcoFlow cron install ==="
echo "  CRON_ROOT = $CRON_ROOT"
echo "  LIB_SRC   = $LIB_SRC"
echo

# ── 1. folders ─────────────────────────────────────────────────────────
INTERVAL_DIRS=(
  every-10-seconds
  every-minute
  every-15-minutes
  every-hour
  every-4-hours
  every-8-hours
  every-12-hours
  every-24-hours
  every-3-days
  every-week
  every-month
  every-quarter
  every-year
)

for d in "${INTERVAL_DIRS[@]}"; do
  mkdir -p "$SINCE/$d"
done
mkdir -p "$BOOT"
echo "[ok] interval + boot folders ensured"

# ── 2. expected script → folder map ────────────────────────────────────
# (script may already be present; we only ensure lib next to it)
declare -A PLACE=(
  [ecoflow-10s.py]=every-10-seconds
  [ecoflow-1min.py]=every-minute
  [ecoflow-15min.py]=every-15-minutes
  [ecoflow-1h.py]=every-hour
  [ecoflow-4h.py]=every-4-hours
  [ecoflow-8h.py]=every-8-hours
  [ecoflow-12h.py]=every-12-hours
  [ecoflow-24h.py]=every-24-hours
  [ecoflow-3d.py]=every-3-days
  [ecoflow-7d.py]=every-week
  [ecoflow-month.py]=every-month
  [ecoflow-quarter.py]=every-quarter
  [ecoflow-year.py]=every-year
)

# If scripts still live next to this installer, copy them into place
for script in "${!PLACE[@]}"; do
  dest_dir="$SINCE/${PLACE[$script]}"
  if [[ ! -f "$dest_dir/$script" && -f "$SCRIPT_DIR/$script" ]]; then
    cp "$SCRIPT_DIR/$script" "$dest_dir/$script"
    echo "[cp] $script → $dest_dir/"
  fi
done

# catchup → boot
if [[ -f "$SCRIPT_DIR/ecoflow-catchup.py" && ! -f "$BOOT/ecoflow-catchup.py" ]]; then
  cp "$SCRIPT_DIR/ecoflow-catchup.py" "$BOOT/ecoflow-catchup.py"
  echo "[cp] ecoflow-catchup.py → $BOOT/"
fi
if [[ -f "$SINCE/ecoflow-catchup.py" && ! -f "$BOOT/ecoflow-catchup.py" ]]; then
  mv "$SINCE/ecoflow-catchup.py" "$BOOT/ecoflow-catchup.py"
  echo "[mv] ecoflow-catchup.py → $BOOT/"
elif [[ -f "$SINCE/ecoflow-catchup.py" && -f "$BOOT/ecoflow-catchup.py" ]]; then
  rm -f "$SINCE/ecoflow-catchup.py"
  echo "[rm] duplicate catchup from since-last-fire root"
fi

# ── 3. symlink lib into every folder that has ecoflow-*.py ─────────────
link_lib() {
  local dir="$1"
  local target="$dir/ecoflow_lib.py"
  # relative symlink when possible
  local rel
  rel="$(realpath --relative-to="$dir" "$LIB_SRC" 2>/dev/null || echo "$LIB_SRC")"
  if [[ -L "$target" || -f "$target" ]]; then
    # refresh if not pointing at same file
    if [[ "$(realpath -m "$target" 2>/dev/null || true)" != "$(realpath -m "$LIB_SRC")" ]]; then
      rm -f "$target"
      ln -s "$rel" "$target"
      echo "[ln] refresh $target → $rel"
    fi
  else
    ln -s "$rel" "$target"
    echo "[ln] $target → $rel"
  fi
}

# all interval dirs that contain an ecoflow script
while IFS= read -r -d '' py; do
  link_lib "$(dirname "$py")"
done < <(find "$SINCE" -mindepth 2 -maxdepth 2 -type f -name 'ecoflow-*.py' -print0 2>/dev/null)

# boot catchup
if [[ -f "$BOOT/ecoflow-catchup.py" ]]; then
  link_lib "$BOOT"
fi

echo "[ok] ecoflow_lib.py linked beside every ecoflow script"

# ── 4. clean strays from since-last-fire ROOT ──────────────────────────
# ava-core.py does not belong here (runner only scans INTERVAL subfolders,
# but a copy confuses operators)
if [[ -f "$SINCE/ava-core.py" ]]; then
  mkdir -p "$SINCE/_misc"
  mv "$SINCE/ava-core.py" "$SINCE/_misc/ava-core.py.not-for-cron"
  echo "[mv] since-last-fire/ava-core.py → _misc/ (not scheduled)"
fi

# README can stay; leave ecoflow_lib.py in root as the canonical source

# ── 5. summary ─────────────────────────────────────────────────────────
echo
echo "=== placement summary ==="
printf "%-22s  %s\n" "FOLDER" "SCRIPTS"
printf "%-22s  %s\n" "------" "-------"
for d in "${INTERVAL_DIRS[@]}"; do
  dir="$SINCE/$d"
  scripts=$(find "$dir" -maxdepth 1 -type f -name 'ecoflow-*.py' -printf '%f ' 2>/dev/null || true)
  lib="no-lib"
  if [[ -e "$dir/ecoflow_lib.py" ]]; then lib="lib=ok"; fi
  if [[ -z "${scripts// }" ]]; then
    printf "%-22s  (empty)  %s\n" "$d" "$lib"
  else
    printf "%-22s  %s %s\n" "$d" "$scripts" "$lib"
  fi
done
echo
echo "BOOT $BOOT:"
ls -la "$BOOT" 2>/dev/null || echo "  (missing)"
echo
echo "Done."
echo
echo "NOTE: If ava-core INTERVALS lacks every-quarter / every-year, add:"
echo '  "every-quarter": 90 * 24 * 3600,'
echo '  "every-year":   365 * 24 * 3600,'
echo "Or rely on ecoflow-catchup.py on boot to roll those up."
echo
echo "Restart ava-core (or wait for next tick) after this install."

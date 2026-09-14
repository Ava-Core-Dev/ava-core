#!/usr/bin/env bash
# Snapshot OBS layouts, profiles, websocket, and Ava stream scripts
# out of the snap tree so a snap refresh/reinstall does not wipe the desk.
set -euo pipefail

STAMP="$(date +%Y-%m-%dT%H-%M-%S)"
SNAP_COMMON="${HOME}/snap/obs-studio/common/.config/obs-studio"
NATIVE="${HOME}/.config/obs-studio"
MEDIA_ROOT="${HOME}/ava/media/stream/obs-backup"
SSD_ROOT="${HOME}/ava/ava-core-v2/data/obs-backup"
KEEP="${OBS_BACKUP_KEEP:-14}"

log() { printf '%s %s\n' "$(date -Iseconds)" "$*"; }

pick_src() {
  if [[ -d "${SNAP_COMMON}/basic" ]]; then
    echo "${SNAP_COMMON}"
  elif [[ -d "${NATIVE}/basic" ]]; then
    echo "${NATIVE}"
  else
    echo ""
  fi
}

snapshot_into() {
  local dest="$1"
  local src="$2"
  local snap="${dest}/snapshots/${STAMP}"
  mkdir -p "${snap}/obs-studio" "${snap}/scripts" "${snap}/overlays" "${snap}/obs-cams" "${dest}/latest"

  rsync -a --delete \
    --exclude 'logs/' \
    --exclude 'profiler_data/' \
    --exclude 'updates/' \
    --exclude 'plugin_config/obs-browser/' \
    --exclude 'plugin_config/obs-browser/**' \
    "${src}/" "${snap}/obs-studio/"

  local ws="${HOME}/ava/workstations/obs"
  if [[ -d "${ws}" ]]; then
    rsync -a --delete "${ws}/" "${snap}/scripts/workstations-obs/"
  fi
  local overlays="${HOME}/ava/media/stream/overlays"
  if [[ -d "${overlays}" ]]; then
    rsync -a --delete --exclude '__pycache__/' "${overlays}/" "${snap}/overlays/"
  fi
  local cams="${HOME}/ava/media/stream/obs-cams"
  if [[ -d "${cams}" ]]; then
    rsync -a --delete "${cams}/" "${snap}/obs-cams/"
  fi
  local repo="${HOME}/ava/ava-core-v2"
  mkdir -p "${snap}/scripts/ava-core"
  for f in \
    "${repo}/scripts/setup_obs_daily_broadcast.py" \
    "${repo}/scripts/backup-obs.sh" \
    "${repo}/scripts/restore-obs.sh" \
    "${repo}/apps/core/services/obs_studio.py" \
    "${repo}/apps/core/routes/obs.py"
  do
    [[ -f "${f}" ]] && cp -a "${f}" "${snap}/scripts/ava-core/"
  done

    {
      echo "stamp=${STAMP}"
      echo "source=${src}"
      echo "host=$(hostname)"
      echo "obs_bin=$(command -v obs-studio || true)"
      echo "obs_snap=$(readlink -f /snap/obs-studio/current 2>/dev/null || true)"
      echo "scenes=$(find "${snap}/obs-studio/basic/scenes" -maxdepth 1 -name '*.json' | wc -l)"
      echo "profiles=$(find "${snap}/obs-studio/basic/profiles" -mindepth 1 -maxdepth 1 -type d | wc -l)"
    } > "${snap}/MANIFEST.txt"
    find "${snap}/obs-studio/basic/scenes" -maxdepth 1 -name '*.json' -printf '%f\n' 2>/dev/null \
      | sort >> "${snap}/MANIFEST.txt"

    rsync -a --delete "${snap}/" "${dest}/latest/"
    ln -sfn "snapshots/${STAMP}" "${dest}/current"

    local -a snaps=()
    local -a old=()
    if [[ -d "${dest}/snapshots" ]]; then
      mapfile -t snaps < <(ls -1 "${dest}/snapshots" | sort)
      if ((${#snaps[@]} > KEEP)); then
        old=("${snaps[@]:0:$((${#snaps[@]} - KEEP))}")
        local d
        for d in "${old[@]}"; do
          rm -rf "${dest}/snapshots/${d}"
        done
      fi
    fi
  }

SRC="$(pick_src)"
if [[ -z "${SRC}" ]]; then
  log "no OBS config tree found — nothing to back up"
  exit 0
fi

log "backing up ${SRC}"
snapshot_into "${MEDIA_ROOT}" "${SRC}"
snapshot_into "${SSD_ROOT}" "${SRC}"
log "latest → ${MEDIA_ROOT}/latest and ${SSD_ROOT}/latest"
log "snapshot ${STAMP}"
exit 0

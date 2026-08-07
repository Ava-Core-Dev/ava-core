#!/usr/bin/env bash
# Start Ava Ivy headless (SSH / Ubuntu OptiPlex).
# Usage:
#   ./scripts/start-ava.sh
#   AVA_HANDOFF=/srv/rootmc/Server\ Handoffs/Ava\ Ivy ./scripts/start-ava.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AVA_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
WORKSPACE_ROOT="$(cd "${AVA_ROOT}/../.." && pwd)"

export AVA_NO_STATUS_WINDOW="${AVA_NO_STATUS_WINDOW:-1}"
export AVA_HEADLESS="${AVA_HEADLESS:-1}"
export AVA_RICH_PRESENCE="${AVA_RICH_PRESENCE:-0}"
# Prefer OptiPlex SSD home; E/mnt/e only if SSD tree missing.
if [[ -z "${AVA_HANDOFF:-}" ]]; then
  if [[ -d /home/ava-core/ava/core ]]; then
    export AVA_HANDOFF="/home/ava-core/ava"
  elif [[ -d /mnt/e/.Ava_Ivy ]]; then
    export AVA_HANDOFF="/mnt/e/.Ava_Ivy"
  elif [[ -d "E:/.Ava_Ivy" ]]; then
    export AVA_HANDOFF="E:/.Ava_Ivy"
  else
    export AVA_HANDOFF="${WORKSPACE_ROOT}/Server Handoffs/Ava Ivy"
  fi
fi
export AVA_WORKSPACE="${AVA_WORKSPACE:-${WORKSPACE_ROOT}}"
if [[ -f "${WORKSPACE_ROOT}/.env" ]]; then
  export ROOTMC_ENV_FILE="${ROOTMC_ENV_FILE:-${WORKSPACE_ROOT}/.env}"
fi

mkdir -p "${AVA_HANDOFF}/data"

# Clear sticky power-off so systemd/ssh start actually runs
if [[ -f "${AVA_HANDOFF}/data/power-off.json" ]]; then
  rm -f "${AVA_HANDOFF}/data/power-off.json"
  echo "cleared power-off.json"
fi

cd "${AVA_ROOT}"
if [[ ! -d node_modules ]]; then
  echo "npm install (first boot)…"
  npm install
fi

echo "Ava → ${AVA_ROOT}"
echo "handoff → ${AVA_HANDOFF}"
echo "status → http://127.0.0.1:${AVA_PORT:-8787}/  (ssh -L 8787:127.0.0.1:8787)"
exec npm start

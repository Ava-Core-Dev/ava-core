#!/usr/bin/env bash
# Ava Ivy desktop launcher — opens the Electron client.
# Ava Core + Voice start/stop with the GUI (see lib/avaLifecycle.mjs).
# Systemd units ava-core / ava-voice should be disabled so they don't fight the GUI.
set -euo pipefail

export PATH="${HOME}/.local/bin:/usr/local/bin:${PATH}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AVA_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
AVA_HOME="${AVA_ROOT}"
AVA_DESKTOP="${AVA_ROOT}/apps/desktop"
LOG_DIR="${AVA_ROOT}/data/logs"
SSD_LOG="${HOME}/ava/logs"
mkdir -p "${LOG_DIR}" "${AVA_ROOT}/data" "${SSD_LOG}" || true
# Prefer repo logs; if the USB path is missing, still log on the SSD.
if ! touch "${LOG_DIR}/ava-desktop.log" 2>/dev/null; then
  LOG_DIR="${SSD_LOG}"
fi
exec >>"${LOG_DIR}/ava-desktop.log" 2>&1
echo "---- $(date -Iseconds) start-ava-desktop root=${AVA_ROOT} ----"

# Same companions as login — safe to call twice.
if [[ -x "${AVA_ROOT}/scripts/start-ava-companions.sh" ]]; then
  bash "${AVA_ROOT}/scripts/start-ava-companions.sh" || true
fi

export AVA_HOME
export AVA_HANDOFF="${AVA_ROOT}"
export ROOTMC_ENV_FILE="${AVA_ROOT}/.env"
export AVA_ENV_FILE="${AVA_ROOT}/.env"
export AVA_DESKTOP_UI=1
export AVA_RICH_PRESENCE="${AVA_RICH_PRESENCE:-1}"
export AVA_PORT="${AVA_PORT:-8787}"

if [[ -z "${DISPLAY:-}" && -z "${WAYLAND_DISPLAY:-}" ]]; then
  export DISPLAY="${DISPLAY:-:0}"
fi

# Clear stale power-off flag
if [[ -f "${AVA_ROOT}/data/power-off.json" ]]; then
  rm -f "${AVA_ROOT}/data/power-off.json"
  echo "cleared power-off.json"
fi

# PulseAudio / PipeWire for voice clips from Electron-spawned children
UID_NUM="$(id -u)"
export PULSE_SERVER="${PULSE_SERVER:-unix:/run/user/${UID_NUM}/pulse/native}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/${UID_NUM}}"

cd "${AVA_DESKTOP}"

if [[ ! -d node_modules/electron ]]; then
  echo "Installing Electron desktop deps…"
  npm install --prefer-offline 2>&1 || npm install
fi

ELECTRON_BIN="${AVA_DESKTOP}/node_modules/.bin/electron"
ELECTRON_DIST="${AVA_DESKTOP}/node_modules/electron/dist/electron"

if [[ ! -x "${ELECTRON_BIN}" && ! -x "${ELECTRON_DIST}" ]]; then
  echo "ERROR: electron binary missing — run: cd ${AVA_DESKTOP} && npm install" >&2
  exit 1
fi

unset ELECTRON_RUN_AS_NODE || true
export ELECTRON_DISABLE_SANDBOX="${ELECTRON_DISABLE_SANDBOX:-1}"

echo "Starting Ava Ivy desktop client (core+voice managed by GUI)"
if [[ -x "${ELECTRON_DIST}" ]]; then
  exec "${ELECTRON_DIST}" --no-sandbox .
fi
exec "${ELECTRON_BIN}" --no-sandbox .

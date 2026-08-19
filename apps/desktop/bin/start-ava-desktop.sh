#!/usr/bin/env bash
# Ava Ivy desktop launcher — opens the Electron client.
# Systemd (ava-core + ava-voice) handles the Python brain; this just
# waits for :8787 to be ready and then opens the GUI.
set -euo pipefail

export PATH="${HOME}/.local/bin:/usr/local/bin:${PATH}"

AVA_ROOT="/run/media/ava-core/6B6C97406BF24558/ava-core-v2"
AVA_HOME="${AVA_ROOT}"
AVA_DESKTOP="${AVA_ROOT}/apps/desktop"
LOG_DIR="${AVA_ROOT}/data/logs"
mkdir -p "${LOG_DIR}" "${AVA_ROOT}/data"
exec >>"${LOG_DIR}/ava-desktop.log" 2>&1
echo "---- $(date -Iseconds) start-ava-desktop ----"

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

# ── Clear stale power-off flag ─────────────────────────────────────────────────
if [[ -f "${AVA_ROOT}/data/power-off.json" ]]; then
  rm -f "${AVA_ROOT}/data/power-off.json"
  echo "cleared power-off.json"
fi

# ── Wait for Python core on :8787 (systemd started it) ───────────────────────
wait_http() {
  local i
  for i in $(seq 1 60); do
    if curl -fsS "http://127.0.0.1:${AVA_PORT}/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

if wait_http; then
  echo "Ava Core ready → http://127.0.0.1:${AVA_PORT}/"
else
  echo "Ava Core not responding on :${AVA_PORT} — opening desktop anyway" >&2
fi

# ── Start Electron ────────────────────────────────────────────────────────────
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

echo "Starting Ava Ivy desktop client"
if [[ -x "${ELECTRON_DIST}" ]]; then
  exec "${ELECTRON_DIST}" --no-sandbox .
fi
exec "${ELECTRON_BIN}" --no-sandbox .

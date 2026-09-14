#!/usr/bin/env bash
# Companion processes that should be up whenever Ava is online.
# Origin (:8787) + Electron GUI are owned by start-ava-desktop.sh.
# Do not start systemd ava-core.service here — that fights the GUI watchdog.
set -u
export PATH="${HOME}/.local/bin:/usr/local/bin:${PATH}"
export DISPLAY="${DISPLAY:-:0}"
LOG="${HOME}/ava/logs/companions.log"
mkdir -p "${HOME}/ava/logs"
exec >>"${LOG}" 2>&1
echo "---- $(date -Iseconds) start-ava-companions ----"

# Discord + Slack conversation poller. Origin already long-polls Telegram
# for /subscribe — leave Telegram to origin so getUpdates does not conflict.
POLLER_ROOT="${HOME}/ava/workstations/rootmc-web/rootmc-ava"
if [[ -x "${POLLER_ROOT}/scripts/start-poller.sh" ]] && [[ -d "${POLLER_ROOT}/node_modules" ]]; then
  if ! ps -eo args= | grep -q '[n]ode src/poller.mjs'; then
    echo "starting discord/slack poller"
    (
      cd "${POLLER_ROOT}"
      nohup ./scripts/start-poller-discord-slack.sh >>"${HOME}/ava/logs/poller.out" 2>&1 &
    )
  else
    echo "poller already running"
  fi
else
  echo "poller skipped (missing ${POLLER_ROOT})"
fi

# Weather GIF collector — only if the working directory still exists
WG_DIR="/home/ava-core/Desktop/ava-weather-gif-collector-hawaii-pacific-v7./ava-weather-gif-collector"
if [[ -d "${WG_DIR}" ]] && [[ -f "${WG_DIR}/weathergifs.py" ]]; then
  systemctl --user enable --now ava-weather-gifs.service || true
else
  echo "weather GIFs collector missing on disk — leaving unit stopped"
  systemctl --user disable --now ava-weather-gifs.service >/dev/null 2>&1 || true
fi

# OBS for Stream Director websocket :4455 — show the main window (not tray-only).
# Do not auto-start the live stream.
if command -v obs-studio >/dev/null 2>&1; then
  if ! pgrep -x obs >/dev/null 2>&1 && ! pgrep -f 'obs-studio' >/dev/null 2>&1; then
    echo "starting OBS (main window)"
    nohup obs-studio --disable-missing-files-check >/dev/null 2>&1 &
  else
    echo "OBS already running"
  fi
fi

# Snap-proof copy of layouts / profiles / overlays (non-blocking).
if [[ -x "${HOME}/ava/ava-core-v2/scripts/backup-obs.sh" ]]; then
  nohup "${HOME}/ava/ava-core-v2/scripts/backup-obs.sh" >/dev/null 2>&1 &
fi

# Local-edge gateway :8791 if the Node tree is installed
GW="${HOME}/ava/workstations/rootmc-scripts/local-edge/gateway"
if [[ -f "${GW}/server.mjs" ]] && [[ -d "${GW}/node_modules" ]]; then
  if ! ss -ltn 2>/dev/null | grep -q ':8791 '; then
    echo "starting local-edge gateway :8791"
    (
      cd "${GW}"
      nohup node server.mjs >>"${HOME}/ava/logs/local-edge-8791.log" 2>&1 &
    )
  fi
fi

echo "companions done"

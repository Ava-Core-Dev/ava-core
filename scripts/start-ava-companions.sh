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

# Weather GIF collector (desktop NOAA/NWS leftover board)
if systemctl --user cat ava-weather-gifs.service >/dev/null 2>&1; then
  systemctl --user enable --now ava-weather-gifs.service || true
fi

# Discord + Slack conversation poller. Origin already long-polls Telegram
# for /subscribe — leave Telegram to origin so getUpdates does not conflict.
POLLER_ROOT="${HOME}/ava/workstations/rootmc-web/rootmc-ava"
if [[ -x "${POLLER_ROOT}/scripts/start-poller.sh" ]] && [[ -d "${POLLER_ROOT}/node_modules" ]]; then
  if ! pgrep -f 'rootmc-ava/src/poller.mjs' >/dev/null 2>&1; then
    echo "starting discord/slack poller"
    (
      cd "${POLLER_ROOT}"
      export AVA_TELEGRAM_ENABLED=0
      nohup ./scripts/start-poller.sh >>"${HOME}/ava/logs/poller.out" 2>&1 &
    )
  else
    echo "poller already running"
  fi
else
  echo "poller skipped (missing ${POLLER_ROOT})"
fi

# OBS for Stream Director websocket :4455 — do not auto-start the live stream.
if command -v obs-studio >/dev/null 2>&1; then
  if ! pgrep -x obs >/dev/null 2>&1 && ! pgrep -f 'obs-studio' >/dev/null 2>&1; then
    echo "starting OBS (tray)"
    nohup obs-studio --minimize-to-tray --disable-missing-files-check >/dev/null 2>&1 &
  else
    echo "OBS already running"
  fi
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

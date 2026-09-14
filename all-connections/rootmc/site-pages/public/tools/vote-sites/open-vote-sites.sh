#!/usr/bin/env bash
# Open all RootMC listing vote pages (same URLs as root-rewards.yml / /vote).
# Prefer one new Chromium-family window with every URL as a tab.
set -euo pipefail

URLS=(
  "https://minecraft-mp.com/server/359724/vote/"
  "https://minecraftservers.org/vote/689134"
  "https://minecraft-server-list.com/server/521165/vote/"
  "https://minecraft.buzz/vote/21857"
  "https://topminecraftservers.org/vote/43816"
  "https://www.minerank.com/rootmc-top-tier-economy-server/vote"
  "https://minecraftlist.org/vote/34144"
  "https://www.planetminecraft.com/server/rootmc/vote/"
)

try_chromium() {
  local bin="$1"
  command -v "$bin" >/dev/null 2>&1 || return 1
  nohup "$bin" --new-window "${URLS[@]}" >/dev/null 2>&1 &
  exit 0
}

try_chromium google-chrome \
  || try_chromium google-chrome-stable \
  || try_chromium chromium \
  || try_chromium chromium-browser \
  || try_chromium microsoft-edge \
  || try_chromium microsoft-edge-stable \
  || try_chromium brave-browser \
  || try_chromium vivaldi \
  || true

if command -v firefox >/dev/null 2>&1; then
  firefox --new-window "${URLS[0]}" >/dev/null 2>&1 &
  sleep 0.5
  for u in "${URLS[@]:1}"; do
    firefox --new-tab "$u" >/dev/null 2>&1 &
  done
  exit 0
fi

if command -v xdg-open >/dev/null 2>&1; then
  for u in "${URLS[@]}"; do
    xdg-open "$u" >/dev/null 2>&1 || true
    sleep 0.2
  done
  exit 0
fi

echo "No browser found. Install Chrome, Chromium, Edge, Brave, Firefox, or xdg-utils." >&2
exit 1

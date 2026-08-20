#!/usr/bin/env bash
# Toggle Ava's every-2-minute GitHub auto-push (systemd user timer).
# Usage:
#   bash scripts/github-auto-push-toggle.sh status
#   bash scripts/github-auto-push-toggle.sh off
#   bash scripts/github-auto-push-toggle.sh on
#   bash scripts/github-auto-push-toggle.sh toggle
set -euo pipefail

FLAG="${XDG_STATE_HOME:-$HOME/.local/state}/ava/github-auto-push.off"
TIMER="ava-auto-push.timer"
mkdir -p "$(dirname "$FLAG")"

is_timer_active() {
  systemctl --user is-active --quiet "$TIMER" 2>/dev/null
}

is_flag_off() {
  [[ -f "$FLAG" ]]
}

status() {
  local timer_state flag_state desired
  if is_timer_active; then timer_state="active"; else timer_state="inactive"; fi
  if is_flag_off; then flag_state="OFF (flag present)"; else flag_state="ON (no flag)"; fi
  if is_flag_off; then desired="disabled"; else desired="enabled"; fi
  printf 'github_auto_push:\n'
  printf '  desired: %s\n' "$desired"
  printf '  flag: %s\n' "$flag_state"
  printf '  timer: %s\n' "$timer_state"
  printf '  flag_path: %s\n' "$FLAG"
  printf '  ops_ui: http://127.0.0.1:8787/ops\n'
}

turn_off() {
  date -Iseconds >"$FLAG"
  systemctl --user stop "$TIMER" 2>/dev/null || true
  systemctl --user disable "$TIMER" 2>/dev/null || true
  status
}

turn_on() {
  rm -f "$FLAG"
  systemctl --user enable --now "$TIMER"
  status
}

cmd="${1:-status}"
case "$cmd" in
  status) status ;;
  off|disable|stop) turn_off ;;
  on|enable|start) turn_on ;;
  toggle)
    if is_flag_off || ! is_timer_active; then turn_on; else turn_off; fi
    ;;
  *)
    echo "usage: $0 {status|on|off|toggle}" >&2
    exit 2
    ;;
esac

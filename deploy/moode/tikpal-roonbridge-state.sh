#!/usr/bin/env bash
set -euo pipefail

action="${1:-ready}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
multiroom_helper="$script_dir/tikpal-multiroom-state.sh"
if [[ -x "$multiroom_helper" ]]; then
  exec "$multiroom_helper" roon "$action"
fi

service="${TIKPAL_ROONBRIDGE_SERVICE:-roonbridge.service}"
label="${TIKPAL_ROONBRIDGE_LABEL:-Roon Bridge}"

run_systemctl() {
  if [[ "$(id -u)" == "0" ]]; then
    systemctl "$@" "$service"
  else
    sudo -n systemctl "$@" "$service"
  fi
}

service_active() {
  systemctl is-active --quiet "$service" >/dev/null 2>&1
}

service_enabled() {
  systemctl is-enabled --quiet "$service" >/dev/null 2>&1
}

installed() {
  systemctl cat "$service" >/dev/null 2>&1 \
    || [[ -d /opt/RoonBridge ]] \
    || [[ -d /var/roon/RoonBridge ]]
}

active_alsa_owner() {
  command -v fuser >/dev/null 2>&1 || return 1
  local pids pid process
  pids="$(fuser /dev/snd/pcm*p /dev/snd/pcm*c 2>/dev/null || true)"
  [[ -n "${pids//[[:space:]]/}" ]] || return 1
  for pid in $pids; do
    process="$(ps -p "$pid" -o comm= -o args= 2>/dev/null || true)"
    if grep -Eiq 'RoonBridge|RAATServer' <<<"$process"; then
      return 0
    fi
  done
  return 1
}

case "$action" in
  ready)
    installed
    ;;
  active)
    active_alsa_owner
    ;;
  label)
    printf '%s\n' "$label"
    ;;
  enable)
    run_systemctl enable --now >/dev/null
    ;;
  disable)
    run_systemctl disable --now >/dev/null
    ;;
  *)
    printf 'usage: %s {ready|active|label|enable|disable}\n' "$0" >&2
    exit 64
    ;;
esac

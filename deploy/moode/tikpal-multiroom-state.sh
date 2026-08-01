#!/usr/bin/env bash
set -euo pipefail

ecosystem="${1:-}"
action="${2:-ready}"

case "$ecosystem" in
  roon|lyrion|tikpal|music_assistant) ;;
  *)
    printf 'usage: %s {roon|lyrion|tikpal|music_assistant} {ready|active|label|enable|disable}\n' "$0" >&2
    exit 64
    ;;
esac

service_for() {
  case "$ecosystem" in
    roon) printf '%s\n' "${TIKPAL_MULTIROOM_ROON_SERVICE:-${TIKPAL_ROONBRIDGE_SERVICE:-roonbridge.service}}" ;;
    lyrion) printf '%s\n' "${TIKPAL_MULTIROOM_LYRION_SERVICE:-squeezelite.service}" ;;
    tikpal) printf '%s\n' "${TIKPAL_MULTIROOM_TIKPAL_SERVICE:-tikpal-multiroom.service}" ;;
    music_assistant) printf '%s\n' "" ;;
  esac
}

label_for() {
  case "$ecosystem" in
    roon) printf '%s\n' "${TIKPAL_MULTIROOM_ROON_LABEL:-${TIKPAL_ROONBRIDGE_LABEL:-Roon Bridge}}" ;;
    lyrion) printf '%s\n' "${TIKPAL_MULTIROOM_LYRION_LABEL:-Lyrion}" ;;
    tikpal) printf '%s\n' "${TIKPAL_MULTIROOM_TIKPAL_LABEL:-Tikpal Multi-room}" ;;
    music_assistant) printf '%s\n' "Music Assistant" ;;
  esac
}

process_pattern_for() {
  case "$ecosystem" in
    roon) printf '%s\n' 'RoonBridge|RAATServer' ;;
    lyrion) printf '%s\n' 'squeezelite' ;;
    tikpal) printf '%s\n' 'tikpal-multiroom|snapclient|snapserver' ;;
    music_assistant) printf '%s\n' 'MusicAssistant|music-assistant' ;;
  esac
}

service="$(service_for)"
label="$(label_for)"
process_pattern="$(process_pattern_for)"

run_systemctl() {
  [[ -n "$service" ]] || return 1
  if [[ "$(id -u)" == "0" ]]; then
    systemctl "$@" "$service"
  else
    sudo -n systemctl "$@" "$service"
  fi
}

service_active() {
  [[ -n "$service" ]] || return 1
  systemctl is-active --quiet "$service" >/dev/null 2>&1
}

service_enabled() {
  [[ -n "$service" ]] || return 1
  systemctl is-enabled --quiet "$service" >/dev/null 2>&1
}

installed() {
  [[ "$ecosystem" != "music_assistant" ]] || return 1
  if [[ -n "$service" ]] && systemctl cat "$service" >/dev/null 2>&1; then
    return 0
  fi
  case "$ecosystem" in
    roon)
      [[ -d /opt/RoonBridge || -d /var/roon/RoonBridge ]]
      ;;
    lyrion)
      command -v squeezelite >/dev/null 2>&1
      ;;
    tikpal)
      command -v tikpal-multiroom >/dev/null 2>&1 \
        || command -v snapclient >/dev/null 2>&1 \
        || command -v snapserver >/dev/null 2>&1
      ;;
  esac
}

active_alsa_owner() {
  [[ "$ecosystem" != "music_assistant" ]] || return 1
  command -v fuser >/dev/null 2>&1 || return 1
  local pids pid process
  pids="$(fuser /dev/snd/pcm*p /dev/snd/pcm*c 2>/dev/null || true)"
  [[ -n "${pids//[[:space:]]/}" ]] || return 1
  for pid in $pids; do
    process="$(ps -p "$pid" -o comm= -o args= 2>/dev/null || true)"
    if grep -Eiq "$process_pattern" <<<"$process"; then
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
    [[ "$ecosystem" != "music_assistant" ]] || {
      printf 'Music Assistant is coming soon\n' >&2
      exit 69
    }
    run_systemctl enable --now >/dev/null
    ;;
  disable)
    [[ "$ecosystem" != "music_assistant" ]] || {
      printf 'Music Assistant is coming soon\n' >&2
      exit 69
    }
    run_systemctl disable --now >/dev/null
    ;;
  *)
    printf 'usage: %s {roon|lyrion|tikpal|music_assistant} {ready|active|label|enable|disable}\n' "$0" >&2
    exit 64
    ;;
esac

#!/usr/bin/env bash
set -euo pipefail

action="${1:-}"
remote_service="${TIKPAL_AIRPLAY_REMOTE_SERVICE:-org.gnome.ShairportSync}"
remote_path="${TIKPAL_AIRPLAY_REMOTE_PATH:-/org/gnome/ShairportSync}"
remote_interface="${TIKPAL_AIRPLAY_REMOTE_INTERFACE:-org.gnome.ShairportSync.RemoteControl}"
busctl_bin="${TIKPAL_BUSCTL_BIN:-busctl}"

if ! command -v "$busctl_bin" >/dev/null 2>&1; then
  printf 'busctl is required for AirPlay transport control\n' >&2
  exit 1
fi

remote_available() {
  "$busctl_bin" --timeout=3s get-property "$remote_service" "$remote_path" "$remote_interface" Available 2>/dev/null \
    | grep -q '^b true$'
}

case "$action" in
  available)
    remote_available
    exit $?
    ;;
  play-pause|play_pause)
    method="PlayPause"
    ;;
  play)
    method="Play"
    ;;
  pause)
    method="Pause"
    ;;
  next)
    method="Next"
    ;;
  previous|prev)
    method="Previous"
    ;;
  *)
    printf 'Usage: %s <available|play-pause|play|pause|next|previous>\n' "$0" >&2
    exit 2
    ;;
esac

if ! remote_available; then
  printf 'AirPlay remote control is unavailable from this sender\n' >&2
  exit 3
fi

"$busctl_bin" --timeout=3s call "$remote_service" "$remote_path" "$remote_interface" "$method" >/dev/null

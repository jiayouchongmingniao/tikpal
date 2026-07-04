#!/usr/bin/env bash
set -euo pipefail

action="${1:-}"
busctl_bin="${TIKPAL_BUSCTL_BIN:-busctl}"
bluez_service="${TIKPAL_BLUETOOTH_DBUS_SERVICE:-org.bluez}"
player_interface="${TIKPAL_BLUETOOTH_PLAYER_INTERFACE:-org.bluez.MediaPlayer1}"

if ! command -v "$busctl_bin" >/dev/null 2>&1; then
  printf 'busctl is required for Bluetooth transport control\n' >&2
  exit 1
fi

find_player_path() {
  "$busctl_bin" --system tree "$bluez_service" 2>/dev/null \
    | sed -n 's#.*\(/org/bluez/hci[0-9][0-9]*/dev_[^[:space:]]*/player[0-9][0-9]*\).*#\1#p' \
    | head -n 1
}

player_path="$(find_player_path)"

remote_available() {
  [ -n "$player_path" ]
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
  printf 'Bluetooth AVRCP player is unavailable from this sender\n' >&2
  exit 3
fi

"$busctl_bin" --system --timeout=3s call "$bluez_service" "$player_path" "$player_interface" "$method" >/dev/null

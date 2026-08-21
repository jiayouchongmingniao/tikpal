#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/tikpal-moodeutl.sh"
SQLDB="${TIKPAL_MOODE_SQLITE_DB:-/var/local/www/db/moode-sqlite3.db}"
device_name="${TIKPAL_BLUETOOTH_DEVICE_NAME:-Tikpal-Speaker-Bluetooth}"

run_as_root() {
  if command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    "$@"
  fi
}

ensure_loopback_output() {
  TIKPAL_ALSA_LOG_PREFIX="${TIKPAL_ALSA_LOG_PREFIX:-tikpal-bluetooth}"
  # shellcheck disable=SC1091
  . "$SCRIPT_DIR/tikpal-alsa-loopback.sh"
  tikpal_enable_alsa_loopback_output
}

ensure_loopback_output

if [ -n "$device_name" ] && [ -f "$SQLDB" ] && command -v sqlite3 >/dev/null 2>&1; then
  escaped_name="$(printf "%s" "$device_name" | sed "s/'/''/g")"
  sqlite3 "$SQLDB" "UPDATE cfg_system SET value='${escaped_name}' WHERE param='btname'" >/dev/null 2>&1 || true
fi

if [ -n "$device_name" ] && command -v hostnamectl >/dev/null 2>&1; then
  run_as_root hostnamectl set-hostname "$device_name" --pretty >/dev/null 2>&1 || true
fi

tikpal_moodeutl -Ro --bluetooth on

# Keep the BlueZ agent alive so bluetoothctl and phone-side pairing both see
# a usable default controller after Tikpal opens the Bluetooth intake path.
run_as_root systemctl start bluetooth.service >/dev/null 2>&1 || true
run_as_root systemctl start bt-agent.service >/dev/null 2>&1 || true
run_as_root systemctl start bluealsa.service >/dev/null 2>&1 || true

controller_addr="$(timeout 5s sh -lc "printf '%s\n' 'list' 'quit' | bluetoothctl 2>/dev/null | sed -n 's/^Controller[[:space:]]\\([0-9A-F:][0-9A-F:]*\\).*/\\1/p' | head -n 1" || true)"

# Re-arm the local controller every time Tikpal opens Bluetooth intake so the
# phone can still discover and pair with the Pi even if the adapter drifted.
{
  if [ -n "$controller_addr" ]; then
    printf 'select %s\n' "$controller_addr"
  fi
  printf '%s\n' \
    "system-alias $device_name" \
    'power on' \
    'discoverable on' \
    'pairable on' \
    'show' \
    'quit'
} | bluetoothctl >/dev/null 2>&1 || true

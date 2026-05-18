#!/bin/sh
set -eu

run_as_root() {
  if command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    "$@"
  fi
}

ensure_loopback_output() {
  if [ -f /etc/alsa/conf.d/_sndaloop.conf ]; then
    run_as_root sed -i '0,/_audioout__ {/s//_audioout {/' /etc/alsa/conf.d/_sndaloop.conf || true
    run_as_root modprobe snd-aloop >/dev/null 2>&1 || true
  fi
}

ensure_loopback_output

moodeutl -Ro --bluetooth on

# Keep the BlueZ agent alive so bluetoothctl and phone-side pairing both see
# a usable default controller after Tikpal opens the Bluetooth intake path.
run_as_root systemctl start bt-agent.service >/dev/null 2>&1 || true

controller_addr="$(timeout 5s sh -lc "printf '%s\n' 'list' 'quit' | bluetoothctl 2>/dev/null | sed -n 's/^Controller[[:space:]]\\([0-9A-F:][0-9A-F:]*\\).*/\\1/p' | head -n 1" || true)"

# Re-arm the local controller every time Tikpal opens Bluetooth intake so the
# phone can still discover and pair with the Pi even if the adapter drifted.
{
  if [ -n "$controller_addr" ]; then
    printf 'select %s\n' "$controller_addr"
  fi
  printf '%s\n' \
    'power on' \
    'discoverable on' \
    'pairable on' \
    'show' \
    'quit'
} | bluetoothctl >/dev/null 2>&1 || true

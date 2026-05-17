#!/bin/sh
set -eu

moodeutl -Ro --bluetooth on

# Re-arm the local controller every time Tikpal opens Bluetooth intake so the
# phone can still discover and pair with the Pi even if the adapter drifted.
printf '%s\n' \
  'power on' \
  'discoverable on' \
  'pairable on' \
  'show' \
  'quit' | bluetoothctl >/dev/null 2>&1 || true

#!/bin/sh
set -eu

timeout_seconds="${TIKPAL_BLUETOOTH_LABEL_TIMEOUT_SECONDS:-2}"

if command -v timeout >/dev/null 2>&1; then
  show_output="$(printf '%s\n' 'show' 'quit' | timeout "${timeout_seconds}s" bluetoothctl 2>/dev/null || true)"
else
  show_output="$(printf '%s\n' 'show' 'quit' | bluetoothctl 2>/dev/null || true)"
fi

label="$(printf '%s\n' "$show_output" | sed -n 's/^[[:space:]]*Alias:[[:space:]]*//p' | head -n 1)"
if [ -z "$label" ]; then
  label="$(printf '%s\n' "$show_output" | sed -n 's/^[[:space:]]*Name:[[:space:]]*//p' | head -n 1)"
fi

if [ -n "$label" ]; then
  printf '%s\n' "$label"
fi

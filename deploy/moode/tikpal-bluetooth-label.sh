#!/bin/sh
set -eu

show_output="$(printf '%s\n' 'show' 'quit' | bluetoothctl 2>/dev/null || true)"

label="$(printf '%s\n' "$show_output" | sed -n 's/^[[:space:]]*Alias:[[:space:]]*//p' | head -n 1)"
if [ -z "$label" ]; then
  label="$(printf '%s\n' "$show_output" | sed -n 's/^[[:space:]]*Name:[[:space:]]*//p' | head -n 1)"
fi

if [ -n "$label" ]; then
  printf '%s\n' "$label"
fi

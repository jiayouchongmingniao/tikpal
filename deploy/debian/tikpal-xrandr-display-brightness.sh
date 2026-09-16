#!/usr/bin/env bash
set -euo pipefail

XRANDR_BIN="${TIKPAL_XRANDR_BIN:-xrandr}"

resolve_output() {
  if [[ -n "${TIKPAL_DISPLAY_BRIGHTNESS_OUTPUT:-}" ]]; then
    printf '%s\n' "$TIKPAL_DISPLAY_BRIGHTNESS_OUTPUT"
    return
  fi
  "$XRANDR_BIN" --query | awk '$2 == "connected" { print $1; exit }'
}

read_percent() {
  local output="$1"
  local percent
  percent="$("$XRANDR_BIN" --verbose --current | awk -v output="$output" '
    $1 == output && $2 == "connected" { in_output = 1; next }
    in_output && /^[^[:space:]]/ { exit }
    in_output && $1 == "brightness:" { print $2; exit }
  ')"
  if [[ ! "$percent" =~ ^[0-9]{1,3}$ ]] || (( percent > 100 )); then
    echo "xrandr output $output has no supported brightness property" >&2
    return 1
  fi
  printf '%s\n' "$percent"
}

status() {
  local output percent
  output="$(resolve_output)"
  [[ -n "$output" ]] || { echo "No connected XRandR output found" >&2; return 1; }
  percent="$(read_percent "$output")"
  printf '{"available":true,"controllable":true,"brightnessPercent":%s,"minBrightnessPercent":0,"maxBrightnessPercent":100,"transport":"xrandr"}\n' "$percent"
}

set_percent() {
  local requested="$1"
  if [[ ! "$requested" =~ ^[0-9]{1,3}$ ]] || (( requested > 100 )); then
    echo "Brightness must be an integer from 0 to 100" >&2
    return 64
  fi
  local output actual
  output="$(resolve_output)"
  [[ -n "$output" ]] || { echo "No connected XRandR output found" >&2; return 1; }
  "$XRANDR_BIN" --output "$output" --set brightness "$requested"
  actual="$(read_percent "$output")"
  [[ "$actual" == "$requested" ]] || { echo "xrandr brightness readback did not match" >&2; return 1; }
}

case "${1:-}" in
  status) status ;;
  set) [[ $# == 2 ]] || { echo "Usage: $0 set <0-100>" >&2; exit 64; }; set_percent "$2" ;;
  *) echo "Usage: $0 {status|set <0-100>}" >&2; exit 64 ;;
esac

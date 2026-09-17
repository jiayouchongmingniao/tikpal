#!/usr/bin/env bash
set -euo pipefail

: "${TIKPAL_TOUCH_DISABLE_MOUSE_EMULATION:=0}"

is_enabled() {
  case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on|enabled) return 0 ;;
    *) return 1 ;;
  esac
}

is_enabled "$TIKPAL_TOUCH_DISABLE_MOUSE_EMULATION" || exit 0
command -v xinput >/dev/null 2>&1 || exit 0

shopt -s nullglob
mouse_nodes=()
for link in /dev/input/by-id/usb-wch.cn_TouchScreen_*-if*-event-mouse; do
  node="$(readlink -f -- "$link" 2>/dev/null || true)"
  [[ "$node" == /dev/input/event* ]] && mouse_nodes+=("$node")
done
shopt -u nullglob

((${#mouse_nodes[@]})) || exit 0

while IFS= read -r device_id; do
  [[ -n "$device_id" ]] || continue
  device_node="$(xinput list-props "$device_id" 2>/dev/null | sed -n 's/.*Device Node.*:[[:space:]]*"\(.*\)"/\1/p')"
  for mouse_node in "${mouse_nodes[@]}"; do
    [[ "$device_node" == "$mouse_node" ]] || continue
    xinput disable "$device_id" >/dev/null 2>&1 || true
    printf '[tikpal-touch] disabled mouse-emulation input %s (%s)\n' "$device_id" "$device_node" >&2
  done
done < <(xinput list --short 2>/dev/null | sed -n 's/.*wch\.cn TouchScreen.*id=\([0-9][0-9]*\).*/\1/p')

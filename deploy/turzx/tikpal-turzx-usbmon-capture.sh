#!/usr/bin/env bash
set -euo pipefail

: "${TIKPAL_TURZX_USB_ID:=1a86:ad11}"
: "${TIKPAL_TURZX_BRIGHTNESS_HELPER:=/usr/local/sbin/tikpal-turzx-brightness}"
: "${TIKPAL_TURZX_USBMON_SECONDS:=4}"
: "${TIKPAL_TURZX_USBMON_RESTORE_PERCENT:=45}"
: "${TIKPAL_TURZX_USBMON_DIR:=/tmp}"

usage() {
  cat <<USAGE
Usage: tikpal-turzx-usbmon-capture.sh <1-100> [--no-restore]

Capture usbmon traffic while the existing TURZX brightness helper sends a value.
This tool does not write raw USB payloads itself.
USAGE
}

fail() {
  printf 'tikpal-turzx-usbmon-capture: %s\n' "$*" >&2
  exit 1
}

clamp_percent() {
  local raw="$1"
  [[ "$raw" =~ ^[0-9]+$ ]] || return 1
  if (( raw < 1 )); then
    printf '1\n'
  elif (( raw > 100 )); then
    printf '100\n'
  else
    printf '%s\n' "$raw"
  fi
}

usb_bus_device() {
  local line bus dev
  command -v lsusb >/dev/null 2>&1 || fail "lsusb is required"
  line="$(lsusb -d "$TIKPAL_TURZX_USB_ID" | head -n 1)"
  [[ -n "$line" ]] || fail "TURZX USB display $TIKPAL_TURZX_USB_ID not found"
  bus="$(awk '{print $2}' <<<"$line")"
  dev="$(awk '{print $4}' <<<"$line" | tr -d ':')"
  [[ -n "$bus" && -n "$dev" ]] || fail "cannot parse lsusb line: $line"
  printf '%d %03d\n' "$((10#$bus))" "$((10#$dev))"
}

percent="${1:-}"
[[ -n "$percent" ]] || {
  usage >&2
  exit 2
}
percent="$(clamp_percent "$percent")" || {
  printf 'brightness must be an integer from 1 to 100\n' >&2
  exit 2
}
restore=1
if [[ "${2:-}" == "--no-restore" ]]; then
  restore=0
fi

[[ "$(id -u)" -eq 0 ]] || fail "run as root"
[[ -x "$TIKPAL_TURZX_BRIGHTNESS_HELPER" ]] || fail "$TIKPAL_TURZX_BRIGHTNESS_HELPER is not executable"

read -r bus dev < <(usb_bus_device)
usbmon="/sys/kernel/debug/usb/usbmon/${bus}u"
[[ -r "$usbmon" ]] || fail "$usbmon is not readable; mount debugfs and enable CONFIG_USB_MON"

mkdir -p "$TIKPAL_TURZX_USBMON_DIR"
log="$TIKPAL_TURZX_USBMON_DIR/tikpal-turzx-usbmon-brightness-$(date -u +%Y%m%dT%H%M%SZ).log"

( timeout "$TIKPAL_TURZX_USBMON_SECONDS" cat "$usbmon" > "$log" ) &
monitor_pid=$!
sleep 0.5
"$TIKPAL_TURZX_BRIGHTNESS_HELPER" set "$percent" >/tmp/tikpal-turzx-usbmon-set.out 2>/tmp/tikpal-turzx-usbmon-set.err || true
sleep 0.4
if (( restore )); then
  "$TIKPAL_TURZX_BRIGHTNESS_HELPER" set "$TIKPAL_TURZX_USBMON_RESTORE_PERCENT" >/tmp/tikpal-turzx-usbmon-restore.out 2>/tmp/tikpal-turzx-usbmon-restore.err || true
fi
wait "$monitor_pid" || true

printf 'log=%s\n' "$log"
printf 'target=bus:%d device:%s\n' "$bus" "$dev"
printf 'set_output='
cat /tmp/tikpal-turzx-usbmon-set.out 2>/dev/null || true
cat /tmp/tikpal-turzx-usbmon-set.err 2>/dev/null || true
if (( restore )); then
  printf 'restore_output='
  cat /tmp/tikpal-turzx-usbmon-restore.out 2>/dev/null || true
  cat /tmp/tikpal-turzx-usbmon-restore.err 2>/dev/null || true
fi
printf 'matched_lines:\n'
grep -aiE "Bo:${bus}:${dev}:1|Ci:${bus}:${dev}:0|Co:${bus}:${dev}:0" "$log" |
  grep -aiE "af ?20|s c1 04|C Ci:${bus}:${dev}:0|S Bo:${bus}:${dev}:1" |
  head -160 || true

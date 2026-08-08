#!/usr/bin/env bash
set -euo pipefail

: "${TIKPAL_TURZX_PM_FIFO_IN:=/tmp/TURZXPmMessagesPort_in}"
: "${TIKPAL_TURZX_PM_FIFO_OUT:=/tmp/TURZXPmMessagesPort_out}"
: "${TIKPAL_TURZX_BRIGHTNESS_STATE:=/var/lib/tikpal/turzx-brightness.json}"
: "${TIKPAL_TURZX_DEFAULT_BRIGHTNESS:=45}"
: "${TIKPAL_TURZX_SERVICE:=display_turzx.service}"
: "${TIKPAL_TURZX_USB_ID:=1a86:ad11}"
: "${TIKPAL_TURZX_HIDRAW_PATH:=/dev/hidraw1}"
: "${TIKPAL_TURZX_FIFO_TIMEOUT_SECONDS:=2}"
: "${TIKPAL_TURZX_X_DISPLAY:=:0}"
: "${TIKPAL_TURZX_XAUTHORITY:=/home/moode/.Xauthority}"
: "${TIKPAL_TURZX_SOFT_BRIGHTNESS_MIN:=0.35}"
: "${TIKPAL_TURZX_HARDWARE_BRIGHTNESS_ENABLED:=0}"

usage() {
  cat <<USAGE
Usage: tikpal-turzx-brightness {get|set <1-100>|status}
USAGE
}

clamp_percent() {
  local raw="$1"
  [[ "$raw" =~ ^[0-9]+$ ]] || return 1
  if (( raw < 0 )); then
    printf '0\n'
  elif (( raw > 100 )); then
    printf '100\n'
  else
    printf '%s\n' "$raw"
  fi
}

default_percent() {
  clamp_percent "$TIKPAL_TURZX_DEFAULT_BRIGHTNESS" 2>/dev/null || printf '45\n'
}

state_dir() {
  dirname "$TIKPAL_TURZX_BRIGHTNESS_STATE"
}

read_state_percent() {
  local raw
  if [[ -f "$TIKPAL_TURZX_BRIGHTNESS_STATE" ]]; then
    raw="$(sed -n 's/.*"brightnessPercent"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$TIKPAL_TURZX_BRIGHTNESS_STATE" | tail -n 1)"
    if [[ -n "$raw" ]]; then
      clamp_percent "$raw" 2>/dev/null && return 0
    fi
  fi
  default_percent
}

read_state_number_field() {
  local field="$1"
  local raw
  if [[ -f "$TIKPAL_TURZX_BRIGHTNESS_STATE" ]]; then
    raw="$(sed -n "s/.*\"$field\"[[:space:]]*:[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p" "$TIKPAL_TURZX_BRIGHTNESS_STATE" | tail -n 1)"
    [[ -n "$raw" ]] && printf '%s\n' "$raw"
  fi
}

read_state_bool_field() {
  local field="$1"
  [[ -f "$TIKPAL_TURZX_BRIGHTNESS_STATE" ]] || return 1
  grep -q "\"$field\"[[:space:]]*:[[:space:]]*true" "$TIKPAL_TURZX_BRIGHTNESS_STATE"
}

service_active() {
  systemctl is-active --quiet "$TIKPAL_TURZX_SERVICE" 2>/dev/null
}

usb_connected() {
  if command -v lsusb >/dev/null 2>&1; then
    lsusb -d "$TIKPAL_TURZX_USB_ID" >/dev/null 2>&1
  else
    [[ -e /sys/bus/usb/devices ]]
  fi
}

fifo_ready() {
  [[ -p "$TIKPAL_TURZX_PM_FIFO_IN" && -p "$TIKPAL_TURZX_PM_FIFO_OUT" && -w "$TIKPAL_TURZX_PM_FIFO_IN" ]]
}

hidraw_ready() {
  [[ -c "$TIKPAL_TURZX_HIDRAW_PATH" && -w "$TIKPAL_TURZX_HIDRAW_PATH" ]]
}

available() {
  service_active && usb_connected && hidraw_ready
}

hardware_brightness_enabled() {
  case "${TIKPAL_TURZX_HARDWARE_BRIGHTNESS_ENABLED,,}" in
    1|true|yes|on)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

primary_output() {
  command -v xrandr >/dev/null 2>&1 || return 0
  DISPLAY="$TIKPAL_TURZX_X_DISPLAY" XAUTHORITY="$TIKPAL_TURZX_XAUTHORITY" \
    xrandr --query 2>/dev/null | awk '/ connected primary/{print $1; exit}'
}

primary_is_turzx() {
  local output
  output="$(primary_output)"
  [[ "$output" =~ ^(DVI-I|DVI-D)-[0-9]+-[0-9]+$ ]]
}

json_string() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

json_bool() {
  if "$@"; then
    printf 'true'
  else
    printf 'false'
  fi
}

write_state() {
  local percent="$1"
  local hardware_percent="${2:-null}"
  local software_percent="${3:-null}"
  local soft_active="${4:-false}"
  mkdir -p "$(state_dir)"
  chmod 0755 "$(state_dir)" 2>/dev/null || true
  printf '{"brightnessPercent":%s,"hardwareBrightnessPercent":%s,"softwareBrightnessPercent":%s,"softBrightnessActive":%s,"updatedAt":"%s"}\n' \
    "$percent" "$hardware_percent" "$software_percent" "$soft_active" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$TIKPAL_TURZX_BRIGHTNESS_STATE"
  chmod 0644 "$TIKPAL_TURZX_BRIGHTNESS_STATE" 2>/dev/null || true
}

send_hid_brightness() {
  local percent="$1"
  local value
  hidraw_ready || {
    printf 'TURZX HID device is not ready: %s\n' "$TIKPAL_TURZX_HIDRAW_PATH" >&2
    return 1
  }
  printf -v value '%02x' "$percent"
  printf '%b' "\\x00\\xaa\\x55\\x30\\x$value" > "$TIKPAL_TURZX_HIDRAW_PATH"
}

send_brightness_fifo() {
  local percent="$1"
  local ack_file
  fifo_ready || {
    printf 'TURZX brightness FIFO is not ready\n' >&2
    return 1
  }
  ack_file="$(mktemp)"
  rm -f "$ack_file"
  if ! timeout "$TIKPAL_TURZX_FIFO_TIMEOUT_SECONDS" bash -c '
      fifo_in="$1"
      fifo_out="$2"
      value="$3"
      ack_file="$4"
      ( IFS= read -r -n 1 ack < "$fifo_out"; printf "%s" "$ack" > "$ack_file" ) &
      reader_pid=$!
      printf "B%s\n" "$value" > "$fifo_in"
      wait "$reader_pid"
    ' bash "$TIKPAL_TURZX_PM_FIFO_IN" "$TIKPAL_TURZX_PM_FIFO_OUT" "$percent" "$ack_file"; then
    rm -f "$ack_file"
    printf 'TURZX brightness command timed out\n' >&2
    return 1
  fi
  if [[ "$(cat "$ack_file" 2>/dev/null || true)" != "A" ]]; then
    rm -f "$ack_file"
    printf 'TURZX brightness command was rejected\n' >&2
    return 1
  fi
  rm -f "$ack_file"
}

read_hardware_percent() {
  local reply_file reply raw
  fifo_ready || return 1
  reply_file="$(mktemp)"
  rm -f "$reply_file"
  if ! timeout "$TIKPAL_TURZX_FIFO_TIMEOUT_SECONDS" bash -c '
      fifo_in="$1"
      fifo_out="$2"
      reply_file="$3"
      ( IFS= read -r reply < "$fifo_out"; printf "%s" "$reply" > "$reply_file" ) &
      reader_pid=$!
      printf "G\n" > "$fifo_in"
      wait "$reader_pid"
    ' bash "$TIKPAL_TURZX_PM_FIFO_IN" "$TIKPAL_TURZX_PM_FIFO_OUT" "$reply_file"; then
    rm -f "$reply_file"
    return 1
  fi
  reply="$(cat "$reply_file" 2>/dev/null || true)"
  rm -f "$reply_file"
  raw="${reply#V}"
  [[ "$reply" == V* ]] || return 1
  clamp_percent "$raw" 2>/dev/null
}

soft_brightness_factor() {
  local percent="$1"
  awk -v percent="$percent" -v min="$TIKPAL_TURZX_SOFT_BRIGHTNESS_MIN" 'BEGIN {
    if (min < 0.1) min = 0.1;
    if (min > 1) min = 1;
    factor = min + ((percent / 100) * (1 - min));
    if (factor < min) factor = min;
    if (factor > 1) factor = 1;
    printf "%.3f\n", factor;
  }'
}

set_soft_brightness() {
  local percent="$1"
  local output factor
  output="$(primary_output)"
  [[ -n "$output" ]] || return 1
  factor="$(soft_brightness_factor "$percent")"
  DISPLAY="$TIKPAL_TURZX_X_DISPLAY" XAUTHORITY="$TIKPAL_TURZX_XAUTHORITY" \
    xrandr --output "$output" --brightness "$factor" >/dev/null 2>&1
}

reset_soft_brightness() {
  local output
  output="$(primary_output)"
  [[ -n "$output" ]] || return 0
  DISPLAY="$TIKPAL_TURZX_X_DISPLAY" XAUTHORITY="$TIKPAL_TURZX_XAUTHORITY" \
    xrandr --output "$output" --brightness 1 >/dev/null 2>&1 || true
}

status_json() {
  local percent="$1"
  local primary hardware_percent software_percent soft_active
  primary="$(primary_output)"
  # HID brightness is write-only on this interface. Do not query the legacy
  # FIFO readback here: some panels always report 100 even after HID updates.
  hardware_percent="$(read_state_number_field hardwareBrightnessPercent || true)"
  software_percent="$(read_state_number_field softwareBrightnessPercent || true)"
  if [[ -z "$hardware_percent" ]]; then
    hardware_percent="null"
  fi
  if [[ -z "$software_percent" ]]; then
    software_percent="null"
  fi
  if read_state_bool_field softBrightnessActive; then
    soft_active="true"
  else
    soft_active="false"
  fi
  printf '{"available":%s,"brightnessPercent":%s,"hardwareBrightnessPercent":%s,"softwareBrightnessPercent":%s,"softBrightnessActive":%s,"serviceActive":%s,"deviceConnected":%s,"fifoReady":%s,"hidrawReady":%s,"hidrawPath":"%s","primaryOutput":"%s","primaryIsTurzx":%s,"transport":"turzx-hid"}\n' \
    "$(json_bool available)" \
    "$percent" \
    "$hardware_percent" \
    "$software_percent" \
    "$soft_active" \
    "$(json_bool service_active)" \
    "$(json_bool usb_connected)" \
    "$(json_bool fifo_ready)" \
    "$(json_bool hidraw_ready)" \
    "$(json_string "$TIKPAL_TURZX_HIDRAW_PATH")" \
    "$(json_string "$primary")" \
    "$(json_bool primary_is_turzx)"
}

case "${1:-}" in
  get)
    read_state_percent
    ;;
  set)
    [[ -n "${2:-}" ]] || {
      usage >&2
      exit 2
    }
    percent="$(clamp_percent "$2")" || {
      printf 'brightness must be an integer from 0 to 100\n' >&2
      exit 2
    }
    send_hid_brightness "$percent"
    hardware_percent="$percent"
    reset_soft_brightness
    write_state "$percent" "$hardware_percent" null false
    printf '%s\n' "$percent"
    ;;
  status)
    status_json "$(read_state_percent)"
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

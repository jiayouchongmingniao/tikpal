#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="${TIKPAL_KIOSK_ENV_FILE:-$APP_DIR/.env.kiosk}"

should_source_env_file() {
  local value
  value="$(printf '%s' "${TIKPAL_KIOSK_SKIP_ENV_SOURCE:-0}" | tr '[:upper:]' '[:lower:]')"
  case "$value" in
    1|true|yes|on)
      return 1
      ;;
    *)
      return 0
      ;;
  esac
}

if should_source_env_file && [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

: "${TIKPAL_KIOSK_DISPLAY:=:0}"
: "${TIKPAL_KIOSK_DISPLAY_MODE:=auto}"
: "${TIKPAL_KIOSK_ACTIVE_DISPLAY_MODE:=$TIKPAL_KIOSK_DISPLAY_MODE}"
: "${TIKPAL_KIOSK_XRANDR_OUTPUT:=HDMI-1}"
: "${TIKPAL_KIOSK_XRANDR_MODE:=2560x720}"
: "${TIKPAL_KIOSK_WINDOW_POSITION:=0,0}"
: "${TIKPAL_KIOSK_X_COMMAND_TIMEOUT_SECONDS:=5}"
: "${TIKPAL_PHYSICAL_DISPLAY_RESET_MODE:=1280x720}"
: "${TIKPAL_PHYSICAL_DISPLAY_SAFE_BRIGHTNESS:=45}"
: "${TIKPAL_PHYSICAL_DISPLAY_SAFE_CONTRAST:=50}"
: "${TIKPAL_PHYSICAL_DISPLAY_INPUT_SOURCE:=}"
: "${TIKPAL_PHYSICAL_DISPLAY_DRM_CONNECTOR:=/sys/class/drm/card0-HDMI-A-1}"
: "${TIKPAL_PHYSICAL_DISPLAY_WAIT_READY_TIMEOUT_SECONDS:=45}"
: "${TIKPAL_PHYSICAL_DISPLAY_WAIT_READY_SETTLE_SECONDS:=2}"
: "${TIKPAL_PHYSICAL_DISPLAY_DELAYED_KICK_SECONDS:=8 25}"
: "${TIKPAL_PHYSICAL_DISPLAY_DDCUTIL_BIN:=${TIKPAL_KIOSK_DDCUTIL_BIN:-${TIKPAL_REAL_DDCUTIL_BIN:-ddcutil}}}"
: "${TIKPAL_PHYSICAL_DISPLAY_DDC_TIMEOUT_SECONDS:=5}"
: "${TIKPAL_PHYSICAL_DISPLAY_DISABLE_POWER_KEYS:=1}"
: "${TIKPAL_PHYSICAL_DISPLAY_PCI_POWER_DEVICES:=}"
: "${TIKPAL_PHYSICAL_DISPLAY_PCIE_ASPM_POLICY:=}"
: "${TIKPAL_PHYSICAL_DISPLAY_DRM_POLL:=}"
: "${TIKPAL_PHYSICAL_DISPLAY_NOUVEAU_PCI_ID:=}"
: "${TIKPAL_PHYSICAL_DISPLAY_NOUVEAU_REBIND_SETTLE_SECONDS:=3}"

MODE="${1:-soft-kick}"
DISPLAY_NUMBER="${TIKPAL_KIOSK_DISPLAY#:}"
XAUTHORITY="${XAUTHORITY:-/home/${TIKPAL_KIOSK_SERVICE_USER:-moode}/.Xauthority}"
POSITION_X="${TIKPAL_KIOSK_WINDOW_POSITION%%,*}"
POSITION_Y="${TIKPAL_KIOSK_WINDOW_POSITION#*,}"
[[ "$POSITION_Y" != "$TIKPAL_KIOSK_WINDOW_POSITION" ]] || POSITION_Y="0"
XRANDR_TMP="${TMPDIR:-/tmp}/tikpal-physical-display-xrandr.$$.tmp"
COMMAND_TMP="${TMPDIR:-/tmp}/tikpal-physical-display-command.$$.tmp"
KEYMAP_TMP="${TMPDIR:-/tmp}/tikpal-physical-display-keymap.$$.xkb"

export DISPLAY="$TIKPAL_KIOSK_DISPLAY"
export XAUTHORITY

log() {
  printf '[tikpal-physical-display] %s\n' "$*"
}

cleanup() {
  rm -f "$XRANDR_TMP" "$COMMAND_TMP" "$KEYMAP_TMP" "$KEYMAP_TMP.bak"
}
trap cleanup EXIT

is_enabled() {
  local value
  value="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "$value" in
    1|true|yes|on|enabled)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

run_with_timeout() {
  local seconds="$1"
  shift
  if command -v timeout >/dev/null 2>&1; then
    timeout -k 1s "${seconds}s" "$@"
    return
  fi
  "$@"
}

run_optional() {
  if run_with_timeout "$TIKPAL_KIOSK_X_COMMAND_TIMEOUT_SECONDS" "$@" >"$COMMAND_TMP" 2>&1; then
    return 0
  fi
  log "optional command failed: $* ($(tr '\n' ' ' <"$COMMAND_TMP"))"
  return 0
}

run_optional_ddc() {
  command -v "$TIKPAL_PHYSICAL_DISPLAY_DDCUTIL_BIN" >/dev/null 2>&1 || return 0
  if run_with_timeout "$TIKPAL_PHYSICAL_DISPLAY_DDC_TIMEOUT_SECONDS" \
    "$TIKPAL_PHYSICAL_DISPLAY_DDCUTIL_BIN" "$@" >"$COMMAND_TMP" 2>&1; then
    return 0
  fi
  log "optional ddcutil command failed: $* ($(tr '\n' ' ' <"$COMMAND_TMP"))"
  return 0
}

pci_power_devices() {
  if [[ -n "$TIKPAL_PHYSICAL_DISPLAY_PCI_POWER_DEVICES" ]]; then
    printf '%s\n' $TIKPAL_PHYSICAL_DISPLAY_PCI_POWER_DEVICES
    return
  fi
  if [[ -n "$TIKPAL_PHYSICAL_DISPLAY_NOUVEAU_PCI_ID" ]]; then
    printf '%s\n' "$TIKPAL_PHYSICAL_DISPLAY_NOUVEAU_PCI_ID"
  fi
}

pci_stabilize() {
  local device control_path policy_path policy
  while IFS= read -r device; do
    [[ -n "$device" ]] || continue
    control_path="/sys/bus/pci/devices/$device/power/control"
    if [[ -w "$control_path" ]]; then
      printf 'on' > "$control_path"
      log "PCI $device power/control=on"
    fi
  done < <(pci_power_devices)

  policy="$(printf '%s' "$TIKPAL_PHYSICAL_DISPLAY_PCIE_ASPM_POLICY" | tr '[:upper:]' '[:lower:]')"
  case "$policy" in
    ""|auto|default|preserve|none)
      drm_poll_stabilize
      return 0
      ;;
  esac
  policy_path="/sys/module/pcie_aspm/parameters/policy"
  if [[ -w "$policy_path" ]]; then
    if printf '%s' "$TIKPAL_PHYSICAL_DISPLAY_PCIE_ASPM_POLICY" > "$policy_path" 2>"$COMMAND_TMP"; then
      log "PCIe ASPM policy=$TIKPAL_PHYSICAL_DISPLAY_PCIE_ASPM_POLICY"
    else
      log "optional PCIe ASPM policy failed: $(tr '\n' ' ' <"$COMMAND_TMP")"
    fi
  fi

  drm_poll_stabilize
}

drm_poll_stabilize() {
  local poll_path poll_value
  poll_value="$(printf '%s' "$TIKPAL_PHYSICAL_DISPLAY_DRM_POLL" | tr '[:lower:]' '[:upper:]')"
  case "$poll_value" in
    ""|AUTO|DEFAULT|PRESERVE|NONE)
      return 0
      ;;
    0|FALSE|NO|OFF|N)
      poll_value="N"
      ;;
    1|TRUE|YES|ON|Y)
      poll_value="Y"
      ;;
  esac
  poll_path="/sys/module/drm_kms_helper/parameters/poll"
  if [[ -w "$poll_path" ]]; then
    printf '%s' "$poll_value" > "$poll_path"
    log "DRM connector poll=$poll_value"
  fi
}

nouveau_rebind() {
  local pci_id driver_path error_tmp
  pci_id="$TIKPAL_PHYSICAL_DISPLAY_NOUVEAU_PCI_ID"
  [[ -n "$pci_id" ]] || {
    log "ERROR: TIKPAL_PHYSICAL_DISPLAY_NOUVEAU_PCI_ID is not set"
    return 2
  }
  [[ "$(id -u)" -eq 0 ]] || {
    log "ERROR: nouveau rebind requires root"
    return 2
  }

  pci_stabilize
  driver_path="/sys/bus/pci/drivers/nouveau"
  [[ -d "$driver_path" ]] || {
    log "ERROR: nouveau driver path is missing"
    return 1
  }

  if [[ -L "$driver_path/$pci_id" ]]; then
    log "unbinding nouveau PCI $pci_id"
    printf '%s' "$pci_id" > "$driver_path/unbind"
    sleep "$TIKPAL_PHYSICAL_DISPLAY_NOUVEAU_REBIND_SETTLE_SECONDS"
  else
    log "nouveau PCI $pci_id was not bound before rebind"
  fi

  modprobe nouveau 2>/dev/null || true
  log "binding nouveau PCI $pci_id"
  error_tmp="${TMPDIR:-/tmp}/tikpal-nouveau-bind.$$.err"
  if ! printf '%s' "$pci_id" > "$driver_path/bind" 2>"$error_tmp"; then
    log "nouveau bind failed: $(tr '\n' ' ' <"$error_tmp" 2>/dev/null || true)"
    printf 1 > /sys/bus/pci/rescan 2>/dev/null || true
    sleep 2
    printf '%s' "$pci_id" > "$driver_path/bind"
  fi
  rm -f "$error_tmp"
  udevadm settle 2>/dev/null || true
  sleep "$TIKPAL_PHYSICAL_DISPLAY_NOUVEAU_REBIND_SETTLE_SECONDS"
  pci_stabilize
}

drm_connector_base() {
  printf '%s' "${TIKPAL_PHYSICAL_DISPLAY_DRM_CONNECTOR%/status}"
}

drm_status_path() {
  printf '%s/status' "$(drm_connector_base)"
}

drm_edid_path() {
  printf '%s/edid' "$(drm_connector_base)"
}

physical_display_enabled() {
  local display_mode
  display_mode="$(printf '%s' "$TIKPAL_KIOSK_ACTIVE_DISPLAY_MODE" | tr '[:upper:]' '[:lower:]')"
  case "$display_mode" in
    virtual|xvfb|headless)
      return 1
      ;;
  esac
  [[ "$TIKPAL_KIOSK_XRANDR_MODE" != "none" ]]
}

drm_connector_ready() {
  local status_path edid_path edid_size
  status_path="$(drm_status_path)"
  edid_path="$(drm_edid_path)"
  [[ -r "$status_path" ]] || return 1
  grep -qx "connected" "$status_path" || return 1
  [[ -r "$edid_path" ]] || return 1
  edid_size="$(wc -c < "$edid_path" 2>/dev/null || printf '0')"
  [[ "$edid_size" =~ ^[0-9]+$ ]] || edid_size=0
  [[ "$edid_size" -ge 128 ]]
}

wait_for_drm_connector() {
  physical_display_enabled || {
    log "physical display wait skipped for display mode $TIKPAL_KIOSK_ACTIVE_DISPLAY_MODE"
    return 0
  }

  safe_ddc_values

  local deadline status_path edid_path edid_size
  deadline=$((SECONDS + TIKPAL_PHYSICAL_DISPLAY_WAIT_READY_TIMEOUT_SECONDS))
  status_path="$(drm_status_path)"
  edid_path="$(drm_edid_path)"
  while (( SECONDS <= deadline )); do
    if drm_connector_ready; then
      edid_size="$(wc -c < "$edid_path" 2>/dev/null || printf '0')"
      log "DRM connector ready: $status_path connected, EDID ${edid_size} bytes"
      sleep "$TIKPAL_PHYSICAL_DISPLAY_WAIT_READY_SETTLE_SECONDS"
      safe_ddc_values
      return 0
    fi
    sleep 1
  done

  edid_size=0
  [[ -r "$edid_path" ]] && edid_size="$(wc -c < "$edid_path" 2>/dev/null || printf '0')"
  log "DRM connector not ready: $status_path=$(cat "$status_path" 2>/dev/null || printf 'missing'), EDID ${edid_size} bytes"
  return 1
}

wait_for_x() {
  local attempt
  for attempt in {1..40}; do
    if [[ -S "/tmp/.X11-unix/X$DISPLAY_NUMBER" ]]; then
      if command -v xset >/dev/null 2>&1 && run_with_timeout "$TIKPAL_KIOSK_X_COMMAND_TIMEOUT_SECONDS" xset q >/dev/null 2>&1; then
        return 0
      fi
      if command -v xrandr >/dev/null 2>&1 && run_with_timeout "$TIKPAL_KIOSK_X_COMMAND_TIMEOUT_SECONDS" xrandr --query >/dev/null 2>&1; then
        return 0
      fi
    fi
    sleep 0.5
  done
  return 1
}

query_xrandr() {
  command -v xrandr >/dev/null 2>&1 || return 1
  run_with_timeout "$TIKPAL_KIOSK_X_COMMAND_TIMEOUT_SECONDS" xrandr --query >"$XRANDR_TMP" 2>&1
}

output_line() {
  grep -E "^${TIKPAL_KIOSK_XRANDR_OUTPUT}[[:space:]]+connected" "$XRANDR_TMP" | head -n 1 || true
}

safe_ddc_values() {
  run_optional_ddc --brief setvcp D6 01
  run_optional_ddc --brief setvcp 10 "$TIKPAL_PHYSICAL_DISPLAY_SAFE_BRIGHTNESS"
  run_optional_ddc --brief setvcp 12 "$TIKPAL_PHYSICAL_DISPLAY_SAFE_CONTRAST"

  local input_source
  input_source="$(printf '%s' "$TIKPAL_PHYSICAL_DISPLAY_INPUT_SOURCE" | tr '[:upper:]' '[:lower:]')"
  case "$input_source" in
    ""|auto|current|preserve|none)
      return 0
      ;;
  esac
  run_optional_ddc --brief setvcp 60 "$TIKPAL_PHYSICAL_DISPLAY_INPUT_SOURCE"
}

disable_display_power_keys() {
  is_enabled "$TIKPAL_PHYSICAL_DISPLAY_DISABLE_POWER_KEYS" || return 0
  command -v xkbcomp >/dev/null 2>&1 || return 0
  command -v sed >/dev/null 2>&1 || return 0

  if ! run_with_timeout "$TIKPAL_KIOSK_X_COMMAND_TIMEOUT_SECONDS" xkbcomp "$DISPLAY" "$KEYMAP_TMP" >"$COMMAND_TMP" 2>&1; then
    log "optional keymap read failed: $(tr '\n' ' ' <"$COMMAND_TMP")"
    return 0
  fi

  if ! grep -Eq 'XF86(PowerOff|Sleep|Suspend|Standby|Display|ScreenSaver)' "$KEYMAP_TMP"; then
    return 0
  fi

  sed -E -i.bak 's/XF86(PowerOff|Sleep|Suspend|Standby|Display|ScreenSaver)/NoSymbol/g' "$KEYMAP_TMP"
  run_optional xkbcomp "$KEYMAP_TMP" "$DISPLAY"
}

apply_x_safety() {
  command -v xset >/dev/null 2>&1 || return 0
  run_optional xset s off
  run_optional xset s noblank
  run_optional xset -dpms
  run_optional xset dpms force on
}

apply_xrandr_properties() {
  run_optional xrandr --output "$TIKPAL_KIOSK_XRANDR_OUTPUT" --set "dithering depth" "8 bpc"
  run_optional xrandr --output "$TIKPAL_KIOSK_XRANDR_OUTPUT" --set "dithering mode" "off"
  run_optional xrandr --output "$TIKPAL_KIOSK_XRANDR_OUTPUT" --set "scaling mode" "Full"
}

turn_output_off() {
  run_optional xrandr --output "$TIKPAL_KIOSK_XRANDR_OUTPUT" --off
}

apply_mode() {
  local mode="$1"
  run_optional xrandr \
    --output "$TIKPAL_KIOSK_XRANDR_OUTPUT" \
    --mode "$mode" \
    --pos "${POSITION_X}x${POSITION_Y}" \
    --primary
}

raise_chromium() {
  command -v xdotool >/dev/null 2>&1 || return 0
  local window
  while IFS= read -r window; do
    [[ -n "$window" ]] || continue
    xdotool windowraise "$window" windowactivate "$window" >/dev/null 2>&1 || true
  done < <(xdotool search --onlyvisible --class Chromium-browser 2>/dev/null || true)
}

check_display() {
  physical_display_enabled || {
    log "physical display prepare skipped for display mode $TIKPAL_KIOSK_ACTIVE_DISPLAY_MODE"
    return 0
  }
  wait_for_x || {
    log "X display $TIKPAL_KIOSK_DISPLAY is not ready"
    return 1
  }
  query_xrandr || {
    log "xrandr query failed: $(tr '\n' ' ' <"$XRANDR_TMP" 2>/dev/null || true)"
    return 1
  }
  local line desired
  line="$(output_line)"
  desired="${TIKPAL_KIOSK_XRANDR_MODE}+${POSITION_X}+${POSITION_Y}"
  if [[ -z "$line" ]]; then
    log "output $TIKPAL_KIOSK_XRANDR_OUTPUT is not connected"
    return 1
  fi
  if [[ "$line" != *" primary ${desired}"* ]]; then
    log "output $TIKPAL_KIOSK_XRANDR_OUTPUT is not primary at $desired: $line"
    return 1
  fi
  log "$TIKPAL_KIOSK_XRANDR_OUTPUT primary at $desired"
  return 0
}

soft_kick() {
  physical_display_enabled || {
    log "physical display prepare skipped for display mode $TIKPAL_KIOSK_ACTIVE_DISPLAY_MODE"
    return 0
  }
  wait_for_x || {
    log "X display $TIKPAL_KIOSK_DISPLAY is not ready"
    return 1
  }
  query_xrandr || {
    log "xrandr query failed: $(tr '\n' ' ' <"$XRANDR_TMP" 2>/dev/null || true)"
    return 1
  }
  if [[ -z "$(output_line)" ]]; then
    log "output $TIKPAL_KIOSK_XRANDR_OUTPUT is not connected"
    return 1
  fi

  apply_x_safety
  safe_ddc_values
  pci_stabilize
  disable_display_power_keys
  turn_output_off
  sleep 0.5
  if [[ -n "$TIKPAL_PHYSICAL_DISPLAY_RESET_MODE" && "$TIKPAL_PHYSICAL_DISPLAY_RESET_MODE" != "none" ]]; then
    apply_mode "$TIKPAL_PHYSICAL_DISPLAY_RESET_MODE"
    sleep 0.8
  fi
  apply_mode "$TIKPAL_KIOSK_XRANDR_MODE"
  apply_xrandr_properties
  safe_ddc_values
  raise_chromium
  local display_status=0
  check_display || display_status=$?
  # Some narrow HDMI panels report standby again just after X/Chromium mode
  # changes. A final delayed DDC pass keeps the visible state without rebooting.
  sleep 1
  safe_ddc_values
  return "$display_status"
}

delayed_soft_kick() {
  local delay wait previous=0
  for delay in $TIKPAL_PHYSICAL_DISPLAY_DELAYED_KICK_SECONDS; do
    [[ "$delay" =~ ^[0-9]+$ ]] || {
      log "skipping invalid delayed soft-kick delay '$delay'"
      continue
    }
    wait=$((delay - previous))
    if (( wait > 0 )); then
      sleep "$wait"
    fi
    previous="$delay"
    log "running delayed soft-kick at ${delay}s"
    soft_kick || log "delayed soft-kick at ${delay}s failed"
  done
}

case "$MODE" in
  --check|check)
    log "display: $TIKPAL_KIOSK_DISPLAY"
    log "output: $TIKPAL_KIOSK_XRANDR_OUTPUT"
    log "mode: $TIKPAL_KIOSK_XRANDR_MODE"
    log "reset mode: $TIKPAL_PHYSICAL_DISPLAY_RESET_MODE"
    log "safe brightness: $TIKPAL_PHYSICAL_DISPLAY_SAFE_BRIGHTNESS"
    log "safe contrast: $TIKPAL_PHYSICAL_DISPLAY_SAFE_CONTRAST"
    log "input source policy: ${TIKPAL_PHYSICAL_DISPLAY_INPUT_SOURCE:-preserve-current}"
    log "DRM connector: $(drm_connector_base)"
    log "PCI power devices: ${TIKPAL_PHYSICAL_DISPLAY_PCI_POWER_DEVICES:-none}"
    log "PCIe ASPM policy: ${TIKPAL_PHYSICAL_DISPLAY_PCIE_ASPM_POLICY:-preserve-current}"
    log "DRM connector poll: ${TIKPAL_PHYSICAL_DISPLAY_DRM_POLL:-preserve-current}"
    log "nouveau PCI id: ${TIKPAL_PHYSICAL_DISPLAY_NOUVEAU_PCI_ID:-none}"
    log "wait-ready timeout: ${TIKPAL_PHYSICAL_DISPLAY_WAIT_READY_TIMEOUT_SECONDS}s"
    log "delayed soft-kick seconds: $TIKPAL_PHYSICAL_DISPLAY_DELAYED_KICK_SECONDS"
    check_display
    ;;
  wait-ready)
    wait_for_drm_connector
    ;;
  pci-stabilize)
    pci_stabilize
    ;;
  nouveau-rebind)
    nouveau_rebind
    ;;
  delayed-soft-kick)
    delayed_soft_kick
    ;;
  soft-kick|prepare|"")
    soft_kick
    ;;
  *)
    log "ERROR: usage: $0 [--check|wait-ready|pci-stabilize|nouveau-rebind|soft-kick|delayed-soft-kick]"
    exit 2
    ;;
esac

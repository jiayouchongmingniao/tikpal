#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="${TIKPAL_KIOSK_ENV_FILE:-$APP_DIR/.env.kiosk}"
DEFAULT_FIELD_ENV="/home/${TIKPAL_KIOSK_SERVICE_USER:-moode}/code/tikpal/.env.kiosk"

if [[ -z "${TIKPAL_KIOSK_ENV_FILE:-}" && ! -f "$ENV_FILE" && -f "$DEFAULT_FIELD_ENV" ]]; then
  ENV_FILE="$DEFAULT_FIELD_ENV"
fi

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
: "${TIKPAL_KIOSK_XRANDR_OUTPUT:=auto}"
: "${TIKPAL_KIOSK_XRANDR_MODE:=2560x720}"
: "${TIKPAL_KIOSK_XRANDR_RATE:=}"
: "${TIKPAL_KIOSK_XRANDR_USB_RATE:=29.95}"
: "${TIKPAL_KIOSK_XRANDR_USB_OUTPUT_PATTERN:=^(DVI-I|DVI-D)-[0-9]+-[0-9]+$}"
: "${TIKPAL_KIOSK_XRANDR_CLONE_OUTPUTS:=}"
: "${TIKPAL_KIOSK_XRANDR_PRIMARY_PREFERRED_OUTPUTS:=HDMI-1 HDMI-A-1}"
: "${TIKPAL_KIOSK_XRANDR_FALLBACK_TO_CONNECTED:=1}"
: "${TIKPAL_KIOSK_WINDOW_POSITION:=0,0}"
: "${TIKPAL_KIOSK_X_COMMAND_TIMEOUT_SECONDS:=5}"
: "${TIKPAL_DISPLAY_MIRROR_ENABLED:=0}"
: "${TIKPAL_DISPLAY_MIRROR_OUTPUT:=}"
: "${TIKPAL_DISPLAY_PRIMARY_OUTPUT:=}"
: "${TIKPAL_DISPLAY_MODE:=}"
: "${TIKPAL_PHYSICAL_DISPLAY_RESET_MODE:=1280x720}"
: "${TIKPAL_PHYSICAL_DISPLAY_SAFE_BRIGHTNESS:=45}"
: "${TIKPAL_PHYSICAL_DISPLAY_SAFE_CONTRAST:=50}"
: "${TIKPAL_PHYSICAL_DISPLAY_INPUT_SOURCE:=}"
: "${TIKPAL_PHYSICAL_DISPLAY_DRM_CONNECTOR:=auto}"
: "${TIKPAL_PHYSICAL_DISPLAY_DRM_CONNECTORS:=$TIKPAL_PHYSICAL_DISPLAY_DRM_CONNECTOR}"
: "${TIKPAL_PHYSICAL_DISPLAY_DRM_PREFERRED_CONNECTORS:=card0-HDMI-A-1 card0-HDMI-A-2}"
: "${TIKPAL_PHYSICAL_DISPLAY_DRM_FALLBACK_TO_CONNECTED:=1}"
: "${TIKPAL_PHYSICAL_DISPLAY_ALLOW_NO_EDID:=0}"
: "${TIKPAL_PHYSICAL_DISPLAY_NO_EDID_CONNECTOR_PATTERN:=card[0-9]+-DVI-I-[0-9]+}"
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
: "${TIKPAL_TURZX_USB_RECOVERY_ENABLED:=0}"
: "${TIKPAL_TURZX_USB_RECOVERY_AFTER_SECONDS:=8}"
: "${TIKPAL_TURZX_USB_RECOVERY_PCI_DEVICE:=}"
: "${TIKPAL_TURZX_USB_RECOVERY_REQUIRE_ERROR:=1}"
: "${TIKPAL_TURZX_USB_RECOVERY_SETTLE_SECONDS:=8}"
: "${TIKPAL_TURZX_USB_RECOVERY_MIN_INTERVAL_SECONDS:=300}"
: "${TIKPAL_TURZX_USB_RECOVERY_STATE_FILE:=/run/tikpal-turzx-usb-recovery.last}"
: "${TIKPAL_TURZX_USB_RECOVERY_ERROR_PATTERN:=device descriptor read|unable to enumerate USB device|error -71|error -110}"
: "${TIKPAL_TURZX_USB_RECOVERY_LOG_LINES:=80}"
: "${TIKPAL_TURZX_USB_RECOVERY_SERVICE:=display_turzx.service}"

MODE="${1:-soft-kick}"
DISPLAY_NUMBER="${TIKPAL_KIOSK_DISPLAY#:}"
XAUTHORITY="${XAUTHORITY:-/home/${TIKPAL_KIOSK_SERVICE_USER:-moode}/.Xauthority}"
POSITION_X="${TIKPAL_KIOSK_WINDOW_POSITION%%,*}"
POSITION_Y="${TIKPAL_KIOSK_WINDOW_POSITION#*,}"
[[ "$POSITION_Y" != "$TIKPAL_KIOSK_WINDOW_POSITION" ]] || POSITION_Y="0"
XRANDR_TMP="${TMPDIR:-/tmp}/tikpal-physical-display-xrandr.$$.tmp"
COMMAND_TMP="${TMPDIR:-/tmp}/tikpal-physical-display-command.$$.tmp"
KEYMAP_TMP="${TMPDIR:-/tmp}/tikpal-physical-display-keymap.$$.xkb"
RESOLVED_XRANDR_CLONE_OUTPUTS=""
TURZX_USB_RECOVERY_ATTEMPTED=0

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

apply_display_mirror_aliases() {
  if [[ -n "$TIKPAL_DISPLAY_PRIMARY_OUTPUT" ]]; then
    TIKPAL_KIOSK_XRANDR_OUTPUT="$TIKPAL_DISPLAY_PRIMARY_OUTPUT"
  fi
  if [[ -n "$TIKPAL_DISPLAY_MODE" ]]; then
    TIKPAL_KIOSK_XRANDR_MODE="$TIKPAL_DISPLAY_MODE"
  fi
  if is_enabled "$TIKPAL_DISPLAY_MIRROR_ENABLED" && [[ -n "$TIKPAL_DISPLAY_MIRROR_OUTPUT" ]]; then
    TIKPAL_KIOSK_XRANDR_CLONE_OUTPUTS="${TIKPAL_KIOSK_XRANDR_CLONE_OUTPUTS:-$TIKPAL_DISPLAY_MIRROR_OUTPUT}"
  fi
}

apply_display_mirror_aliases

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

is_auto_token() {
  local value
  value="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')"
  case "$value" in
    auto|connected|any|first|primary)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

normalize_drm_connector_base() {
  local token="$1"
  token="${token%/status}"
  if [[ "$token" == /sys/class/drm/* ]]; then
    printf '%s\n' "$token"
    return 0
  fi
  printf '/sys/class/drm/%s\n' "$token"
}

drm_connector_bases() {
  local token preferred base status_path
  if is_auto_token "$TIKPAL_PHYSICAL_DISPLAY_DRM_CONNECTORS"; then
    for preferred in $TIKPAL_PHYSICAL_DISPLAY_DRM_PREFERRED_CONNECTORS; do
      base="$(normalize_drm_connector_base "$preferred")"
      [[ -f "$base/status" ]] || continue
      printf '%s\n' "$base"
    done
    for status_path in /sys/class/drm/card*-*/status; do
      [[ -f "$status_path" ]] || continue
      base="${status_path%/status}"
      case " $TIKPAL_PHYSICAL_DISPLAY_DRM_PREFERRED_CONNECTORS " in
        *" ${base##*/} "*) continue ;;
      esac
      printf '%s\n' "$base"
    done
    return 0
  fi

  for token in $TIKPAL_PHYSICAL_DISPLAY_DRM_CONNECTORS; do
    [[ -n "$token" ]] || continue
    normalize_drm_connector_base "$token"
  done
  is_enabled "$TIKPAL_PHYSICAL_DISPLAY_DRM_FALLBACK_TO_CONNECTED" || return 0
  for status_path in /sys/class/drm/card*-*/status; do
    [[ -f "$status_path" ]] || continue
    base="${status_path%/status}"
    case " $TIKPAL_PHYSICAL_DISPLAY_DRM_CONNECTORS " in
      *" ${base##*/} "*|*" $base "*) continue ;;
    esac
    printf '%s\n' "$base"
  done
}

drm_connector_ready() {
  local base="$1"
  local status_path edid_path edid_size connector_name
  status_path="$base/status"
  edid_path="$base/edid"
  [[ -r "$status_path" ]] || return 1
  grep -qx "connected" "$status_path" || return 1
  [[ -r "$edid_path" ]] || return 1
  edid_size="$(wc -c < "$edid_path" 2>/dev/null || printf '0')"
  [[ "$edid_size" =~ ^[0-9]+$ ]] || edid_size=0
  if [[ "$edid_size" -ge 128 ]]; then
    return 0
  fi
  connector_name="${base##*/}"
  if is_enabled "$TIKPAL_PHYSICAL_DISPLAY_ALLOW_NO_EDID" && [[ "$connector_name" =~ $TIKPAL_PHYSICAL_DISPLAY_NO_EDID_CONNECTOR_PATTERN ]]; then
    log "DRM connector ready without EDID: $base connected, EDID ${edid_size} bytes"
    return 0
  fi
  return 1
}

recent_usb_error_bus() {
  command -v dmesg >/dev/null 2>&1 || return 1
  dmesg 2>/dev/null |
    tail -n "$TIKPAL_TURZX_USB_RECOVERY_LOG_LINES" |
    grep -E "$TIKPAL_TURZX_USB_RECOVERY_ERROR_PATTERN" |
    sed -nE 's/.*usb ([0-9]+)-[0-9.:-]+.*/\1/p' |
    tail -n 1
}

pci_device_for_usb_bus() {
  local bus="$1"
  local path base
  [[ -n "$bus" ]] || return 1
  path="$(readlink -f "/sys/bus/usb/devices/usb$bus" 2>/dev/null || true)"
  [[ -n "$path" ]] || return 1
  while [[ "$path" != "/" && -n "$path" ]]; do
    base="${path##*/}"
    if [[ "$base" =~ ^[0-9a-fA-F]{4}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}\.[0-7]$ ]]; then
      printf '%s\n' "$base"
      return 0
    fi
    path="${path%/*}"
  done
  return 1
}

log_usb_display_diagnostics() {
  command -v dmesg >/dev/null 2>&1 || return 0
  if dmesg 2>/dev/null |
    tail -n "$TIKPAL_TURZX_USB_RECOVERY_LOG_LINES" |
    grep -E "$TIKPAL_TURZX_USB_RECOVERY_ERROR_PATTERN" >"$COMMAND_TMP"; then
    log "recent USB display enumeration errors: $(tail -n 4 "$COMMAND_TMP" | tr '\n' ' ')"
  fi
}

maybe_recover_turzx_usb() {
  is_enabled "$TIKPAL_TURZX_USB_RECOVERY_ENABLED" || return 0
  (( TURZX_USB_RECOVERY_ATTEMPTED == 0 )) || return 0
  [[ "$(id -u)" -eq 0 ]] || {
    log "TURZX USB recovery skipped: root is required"
    return 0
  }

  local bus pci_device driver_path driver_name recovery_reason
  local now last interval
  bus="$(recent_usb_error_bus || true)"
  if [[ -z "$bus" ]]; then
    if is_enabled "$TIKPAL_TURZX_USB_RECOVERY_REQUIRE_ERROR" || [[ -z "$TIKPAL_TURZX_USB_RECOVERY_PCI_DEVICE" || "$TIKPAL_TURZX_USB_RECOVERY_PCI_DEVICE" == "auto" ]]; then
      TURZX_USB_RECOVERY_ATTEMPTED=1
      log "TURZX USB recovery skipped: no recent USB enumeration error matched"
      return 0
    fi
    log "TURZX USB recovery: no recent USB error matched; using configured controller $TIKPAL_TURZX_USB_RECOVERY_PCI_DEVICE"
  fi

  pci_device="$TIKPAL_TURZX_USB_RECOVERY_PCI_DEVICE"
  if [[ -z "$pci_device" || "$pci_device" == "auto" ]]; then
    pci_device="$(pci_device_for_usb_bus "$bus" || true)"
  fi
  if [[ -z "$pci_device" ]]; then
    log "TURZX USB recovery skipped: could not resolve USB controller for bus $bus"
    return 0
  fi

  driver_path="$(readlink -f "/sys/bus/pci/devices/$pci_device/driver" 2>/dev/null || true)"
  if [[ -z "$driver_path" || ! -w "$driver_path/unbind" || ! -w "$driver_path/bind" ]]; then
    log "TURZX USB recovery skipped: PCI driver controls are unavailable for $pci_device"
    return 0
  fi
  driver_name="${driver_path##*/}"

  TURZX_USB_RECOVERY_ATTEMPTED=1
  interval="$TIKPAL_TURZX_USB_RECOVERY_MIN_INTERVAL_SECONDS"
  if [[ "$interval" =~ ^[0-9]+$ && "$interval" -gt 0 && -r "$TIKPAL_TURZX_USB_RECOVERY_STATE_FILE" ]]; then
    now="$(date +%s)"
    last="$(cat "$TIKPAL_TURZX_USB_RECOVERY_STATE_FILE" 2>/dev/null || printf '0')"
    if [[ "$last" =~ ^[0-9]+$ ]] && (( now - last < interval )); then
      log "TURZX USB recovery skipped: last controller rebind was $((now - last))s ago"
      return 0
    fi
  fi

  recovery_reason="configured recovery"
  [[ -n "$bus" ]] && recovery_reason="USB bus $bus enumeration error"
  log "TURZX USB recovery: rebind $driver_name controller $pci_device after $recovery_reason"
  mkdir -p "$(dirname "$TIKPAL_TURZX_USB_RECOVERY_STATE_FILE")" 2>/dev/null || true
  date +%s > "$TIKPAL_TURZX_USB_RECOVERY_STATE_FILE" 2>/dev/null || true
  printf '%s' "$pci_device" > "$driver_path/unbind"
  sleep 3
  printf '%s' "$pci_device" > "$driver_path/bind"
  udevadm settle 2>/dev/null || true
  if [[ -n "$TIKPAL_TURZX_USB_RECOVERY_SERVICE" ]] && command -v systemctl >/dev/null 2>&1; then
    systemctl try-restart "$TIKPAL_TURZX_USB_RECOVERY_SERVICE" >/dev/null 2>&1 || true
  fi
  sleep "$TIKPAL_TURZX_USB_RECOVERY_SETTLE_SECONDS"
}

wait_for_drm_connector() {
  physical_display_enabled || {
    log "physical display wait skipped for display mode $TIKPAL_KIOSK_ACTIVE_DISPLAY_MODE"
    return 0
  }

  safe_ddc_values

  local base deadline edid_path edid_size resolved="" recovery_at
  deadline=$((SECONDS + TIKPAL_PHYSICAL_DISPLAY_WAIT_READY_TIMEOUT_SECONDS))
  recovery_at=$((SECONDS + TIKPAL_TURZX_USB_RECOVERY_AFTER_SECONDS))
  while (( SECONDS <= deadline )); do
    while IFS= read -r base; do
      [[ -n "$base" ]] || continue
      if drm_connector_ready "$base"; then
        edid_path="$base/edid"
        edid_size="$(wc -c < "$edid_path" 2>/dev/null || printf '0')"
        log "DRM connector ready: $base connected, EDID ${edid_size} bytes"
        sleep "$TIKPAL_PHYSICAL_DISPLAY_WAIT_READY_SETTLE_SECONDS"
        safe_ddc_values
        return 0
      fi
    done < <(drm_connector_bases)
    if (( SECONDS >= recovery_at )); then
      maybe_recover_turzx_usb
    fi
    sleep 1
  done

  while IFS= read -r base; do
    [[ -n "$base" ]] || continue
    edid_path="$base/edid"
    edid_size=0
    [[ -r "$edid_path" ]] && edid_size="$(wc -c < "$edid_path" 2>/dev/null || printf '0')"
    resolved="${resolved}${resolved:+; }$base/status=$(cat "$base/status" 2>/dev/null || printf 'missing'), EDID ${edid_size} bytes"
  done < <(drm_connector_bases)
  log "DRM connector not ready: ${resolved:-no connector candidates}"
  log_usb_display_diagnostics
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

xrandr_output_connected() {
  local output="$1"
  [[ -s "$XRANDR_TMP" ]] || return 1
  awk -v want="$output" '$1 == want && $2 == "connected" { found = 1 } END { exit found ? 0 : 1 }' "$XRANDR_TMP"
}

choose_auto_xrandr_output() {
  local output preferred first=""
  [[ -s "$XRANDR_TMP" ]] || return 1
  for preferred in $TIKPAL_KIOSK_XRANDR_PRIMARY_PREFERRED_OUTPUTS; do
    if xrandr_output_connected "$preferred"; then
      printf '%s\n' "$preferred"
      return 0
    fi
  done
  while read -r output _; do
    [[ -n "$output" ]] || continue
    first="${first:-$output}"
  done < <(awk '$2 == "connected" { print $1 }' "$XRANDR_TMP")
  [[ -n "$first" ]] || return 1
  printf '%s\n' "$first"
}

resolve_primary_output() {
  local resolved
  if is_auto_token "$TIKPAL_KIOSK_XRANDR_OUTPUT"; then
    resolved="$(choose_auto_xrandr_output || true)"
    [[ -n "$resolved" ]] || return 1
    TIKPAL_KIOSK_XRANDR_OUTPUT="$resolved"
    log "resolved primary output: $TIKPAL_KIOSK_XRANDR_OUTPUT"
    return 0
  fi
  if ! xrandr_output_connected "$TIKPAL_KIOSK_XRANDR_OUTPUT"; then
    if is_enabled "$TIKPAL_KIOSK_XRANDR_FALLBACK_TO_CONNECTED"; then
      resolved="$(choose_auto_xrandr_output || true)"
      if [[ -n "$resolved" ]]; then
        log "configured primary output $TIKPAL_KIOSK_XRANDR_OUTPUT is not connected; using $resolved"
        TIKPAL_KIOSK_XRANDR_OUTPUT="$resolved"
        return 0
      fi
    fi
    return 1
  fi
}

xrandr_output_line() {
  local output="$1"
  awk -v want="$output" '$1 == want && $2 == "connected" { print; exit }' "$XRANDR_TMP"
}

output_line() {
  xrandr_output_line "$TIKPAL_KIOSK_XRANDR_OUTPUT"
}

add_resolved_clone_output() {
  local output="$1"
  [[ -n "$output" && "$output" != "$TIKPAL_KIOSK_XRANDR_OUTPUT" ]] || return 0
  case " $RESOLVED_XRANDR_CLONE_OUTPUTS " in
    *" $output "*) return 0 ;;
  esac
  RESOLVED_XRANDR_CLONE_OUTPUTS="${RESOLVED_XRANDR_CLONE_OUTPUTS:+$RESOLVED_XRANDR_CLONE_OUTPUTS }$output"
}

resolve_clone_outputs() {
  local output token
  RESOLVED_XRANDR_CLONE_OUTPUTS=""
  [[ -n "$TIKPAL_KIOSK_XRANDR_CLONE_OUTPUTS" ]] || return 0
  [[ -s "$XRANDR_TMP" ]] || return 0
  for token in $TIKPAL_KIOSK_XRANDR_CLONE_OUTPUTS; do
    case "$(printf '%s' "$token" | tr '[:upper:]' '[:lower:]')" in
      auto|connected|evdi)
        while read -r output _; do
          add_resolved_clone_output "$output"
        done < <(grep -E '^[^[:space:]]+[[:space:]]+connected' "$XRANDR_TMP" || true)
        ;;
      *)
        if [[ -n "$(xrandr_output_line "$token")" ]]; then
          add_resolved_clone_output "$token"
        else
          log "clone output $token is not connected; keeping primary output only"
        fi
        ;;
    esac
  done
  if [[ -n "$RESOLVED_XRANDR_CLONE_OUTPUTS" ]]; then
    log "resolved clone outputs: $RESOLVED_XRANDR_CLONE_OUTPUTS"
  elif [[ -n "$TIKPAL_KIOSK_XRANDR_CLONE_OUTPUTS" ]]; then
    log "no connected clone outputs resolved; keeping HDMI primary"
  fi
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
  run_optional xset dpms force on
  # On this Gentoo/Xorg path, `dpms force on` also re-enables DPMS timers.
  # Keep `-dpms` last so soft-kick wakes the panel without restoring 10m sleep.
  run_optional xset -dpms
}

apply_xrandr_properties() {
  run_optional xrandr --output "$TIKPAL_KIOSK_XRANDR_OUTPUT" --set "dithering depth" "8 bpc"
  run_optional xrandr --output "$TIKPAL_KIOSK_XRANDR_OUTPUT" --set "dithering mode" "off"
  run_optional xrandr --output "$TIKPAL_KIOSK_XRANDR_OUTPUT" --set "scaling mode" "Full"
}

xrandr_rate_for_output() {
  local output="$1"
  if [[ -n "$TIKPAL_KIOSK_XRANDR_RATE" && "$TIKPAL_KIOSK_XRANDR_RATE" != "auto" ]]; then
    printf '%s\n' "$TIKPAL_KIOSK_XRANDR_RATE"
    return 0
  fi
  if [[ -n "$TIKPAL_KIOSK_XRANDR_USB_RATE" && "$TIKPAL_KIOSK_XRANDR_USB_RATE" != "auto" && "$TIKPAL_KIOSK_XRANDR_USB_RATE" != "none" ]]; then
    if [[ "$output" =~ $TIKPAL_KIOSK_XRANDR_USB_OUTPUT_PATTERN ]]; then
      printf '%s\n' "$TIKPAL_KIOSK_XRANDR_USB_RATE"
      return 0
    fi
  fi
  return 1
}

turn_output_off() {
  local clone_output
  for clone_output in $RESOLVED_XRANDR_CLONE_OUTPUTS; do
    run_optional xrandr --output "$clone_output" --off
  done
  run_optional xrandr --output "$TIKPAL_KIOSK_XRANDR_OUTPUT" --off
}

apply_mode() {
  local mode="$1"
  local clone_output output_rate
  local -a xrandr_args
  xrandr_args=(
    --output "$TIKPAL_KIOSK_XRANDR_OUTPUT"
    --mode "$mode"
  )
  if [[ "$mode" == "$TIKPAL_KIOSK_XRANDR_MODE" ]] && output_rate="$(xrandr_rate_for_output "$TIKPAL_KIOSK_XRANDR_OUTPUT" || true)" && [[ -n "$output_rate" ]]; then
    xrandr_args+=(--rate "$output_rate")
  fi
  xrandr_args+=(
    --pos "${POSITION_X}x${POSITION_Y}"
    --primary
  )
  if [[ "$mode" == "$TIKPAL_KIOSK_XRANDR_MODE" ]]; then
    for clone_output in $RESOLVED_XRANDR_CLONE_OUTPUTS; do
      xrandr_args+=(--output "$clone_output" --mode "$mode")
      if output_rate="$(xrandr_rate_for_output "$clone_output" || true)" && [[ -n "$output_rate" ]]; then
        xrandr_args+=(--rate "$output_rate")
      fi
      xrandr_args+=(--same-as "$TIKPAL_KIOSK_XRANDR_OUTPUT")
    done
  fi
  run_optional xrandr "${xrandr_args[@]}"
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
  resolve_primary_output || {
    log "no connected primary output found"
    return 1
  }
  resolve_clone_outputs
  local clone_line clone_output line desired
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
  for clone_output in $RESOLVED_XRANDR_CLONE_OUTPUTS; do
    clone_line="$(xrandr_output_line "$clone_output")"
    if [[ -z "$clone_line" ]]; then
      log "clone output $clone_output is not connected"
      return 1
    fi
    if [[ "$clone_line" != *" ${desired}"* ]]; then
      log "clone output $clone_output is not mirrored at $desired: $clone_line"
      return 1
    fi
    log "$clone_output mirrored at $desired"
  done
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
  resolve_primary_output || {
    log "no connected primary output found"
    return 1
  }
  resolve_clone_outputs
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
    log "clone outputs: ${TIKPAL_KIOSK_XRANDR_CLONE_OUTPUTS:-none}"
    log "mode: $TIKPAL_KIOSK_XRANDR_MODE"
    log "rate: ${TIKPAL_KIOSK_XRANDR_RATE:-auto}"
    log "USB output rate: ${TIKPAL_KIOSK_XRANDR_USB_RATE:-auto}"
    log "USB output pattern: $TIKPAL_KIOSK_XRANDR_USB_OUTPUT_PATTERN"
    log "reset mode: $TIKPAL_PHYSICAL_DISPLAY_RESET_MODE"
    log "safe brightness: $TIKPAL_PHYSICAL_DISPLAY_SAFE_BRIGHTNESS"
    log "safe contrast: $TIKPAL_PHYSICAL_DISPLAY_SAFE_CONTRAST"
    log "input source policy: ${TIKPAL_PHYSICAL_DISPLAY_INPUT_SOURCE:-preserve-current}"
    log "DRM connectors: $TIKPAL_PHYSICAL_DISPLAY_DRM_CONNECTORS"
    log "DRM preferred connectors: $TIKPAL_PHYSICAL_DISPLAY_DRM_PREFERRED_CONNECTORS"
    log "DRM fallback to connected: $TIKPAL_PHYSICAL_DISPLAY_DRM_FALLBACK_TO_CONNECTED"
    log "DRM allow no EDID: $TIKPAL_PHYSICAL_DISPLAY_ALLOW_NO_EDID"
    log "PCI power devices: ${TIKPAL_PHYSICAL_DISPLAY_PCI_POWER_DEVICES:-none}"
    log "PCIe ASPM policy: ${TIKPAL_PHYSICAL_DISPLAY_PCIE_ASPM_POLICY:-preserve-current}"
    log "DRM connector poll: ${TIKPAL_PHYSICAL_DISPLAY_DRM_POLL:-preserve-current}"
    log "nouveau PCI id: ${TIKPAL_PHYSICAL_DISPLAY_NOUVEAU_PCI_ID:-none}"
    log "TURZX USB recovery: $TIKPAL_TURZX_USB_RECOVERY_ENABLED"
    log "TURZX USB recovery PCI device: ${TIKPAL_TURZX_USB_RECOVERY_PCI_DEVICE:-auto}"
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

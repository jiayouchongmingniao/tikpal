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
: "${TIKPAL_KIOSK_LOCAL_SCREEN:=auto}"
: "${TIKPAL_KIOSK_AUTO_DDC_DETECT:=1}"
: "${TIKPAL_KIOSK_DDCUTIL_BIN:=ddcutil}"
: "${TIKPAL_KIOSK_DDCUTIL_TIMEOUT_SECONDS:=6}"
: "${TIKPAL_KIOSK_WINDOW:=2560x720}"
: "${TIKPAL_KIOSK_VIRTUAL_DEPTH:=24}"
: "${TIKPAL_KIOSK_XVFB_BIN:=Xvfb}"

MODE="launch"
if [[ "${1:-}" == "--check" ]]; then
  MODE="check"
fi

log() {
  printf '[tikpal-kiosk-display] %s\n' "$*"
}

fail() {
  log "ERROR: $*"
  exit 1
}

is_enabled() {
  local value
  value="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "$value" in
    1|true|yes|on|enabled|physical|screen)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

is_disabled() {
  local value
  value="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "$value" in
    0|false|no|off|disabled|virtual|xvfb|headless)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

normalize_window_geometry() {
  local value
  value="$(printf '%s' "$1" | tr -d '[:space:]')"

  if [[ "$value" =~ ^([0-9]+)[xX,]([0-9]+)$ ]]; then
    printf '%sx%sx%s\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "$TIKPAL_KIOSK_VIRTUAL_DEPTH"
    return
  fi

  fail "Invalid TIKPAL_KIOSK_WINDOW '$1'; expected WIDTHxHEIGHT or WIDTH,HEIGHT"
}

has_connected_drm_display() {
  local status
  for status in /sys/class/drm/*/status; do
    [[ -f "$status" ]] || continue
    if grep -qx "connected" "$status"; then
      return 0
    fi
  done
  return 1
}

has_ddc_display() {
  is_enabled "$TIKPAL_KIOSK_AUTO_DDC_DETECT" || return 1
  command -v "$TIKPAL_KIOSK_DDCUTIL_BIN" >/dev/null 2>&1 || return 1

  local output
  output="$(timeout "$TIKPAL_KIOSK_DDCUTIL_TIMEOUT_SECONDS"s "$TIKPAL_KIOSK_DDCUTIL_BIN" detect --brief 2>/dev/null || true)"
  printf '%s\n' "$output" | grep -Eq '^Display[[:space:]]+[0-9]+'
}

select_display_mode() {
  local mode
  mode="$(printf '%s' "$TIKPAL_KIOSK_DISPLAY_MODE" | tr '[:upper:]' '[:lower:]')"
  case "$mode" in
    physical|screen)
      printf 'physical:configured\n'
      ;;
    virtual|xvfb)
      printf 'virtual:configured\n'
      ;;
    auto)
      if is_enabled "$TIKPAL_KIOSK_LOCAL_SCREEN"; then
        printf 'physical:local-screen-config\n'
      elif is_disabled "$TIKPAL_KIOSK_LOCAL_SCREEN"; then
        printf 'virtual:local-screen-config\n'
      elif has_connected_drm_display; then
        printf 'physical:drm-connected\n'
      elif has_ddc_display; then
        printf 'physical:ddc-detected\n'
      else
        printf 'virtual:no-display-detected\n'
      fi
      ;;
    *)
      fail "Invalid TIKPAL_KIOSK_DISPLAY_MODE '$TIKPAL_KIOSK_DISPLAY_MODE'; expected auto, physical, or virtual"
      ;;
  esac
}

wait_for_display() {
  local attempt
  for attempt in {1..60}; do
    if command -v xdpyinfo >/dev/null 2>&1; then
      xdpyinfo -display "$TIKPAL_KIOSK_DISPLAY" >/dev/null 2>&1 && return 0
    elif command -v xset >/dev/null 2>&1; then
      DISPLAY="$TIKPAL_KIOSK_DISPLAY" xset q >/dev/null 2>&1 && return 0
    else
      sleep 2
      return 0
    fi
    sleep 0.5
  done
  return 1
}

DISPLAY_SELECTION="$(select_display_mode)"
ACTIVE_DISPLAY_MODE="${DISPLAY_SELECTION%%:*}"
ACTIVE_DISPLAY_REASON="${DISPLAY_SELECTION#*:}"
VIRTUAL_GEOMETRY="$(normalize_window_geometry "$TIKPAL_KIOSK_WINDOW")"

if [[ "$MODE" == "check" ]]; then
  log "app dir: $APP_DIR"
  log "env file: $ENV_FILE"
  log "requested display mode: $TIKPAL_KIOSK_DISPLAY_MODE"
  log "active display mode: $ACTIVE_DISPLAY_MODE"
  log "active display reason: $ACTIVE_DISPLAY_REASON"
  log "local screen: $TIKPAL_KIOSK_LOCAL_SCREEN"
  log "display: $TIKPAL_KIOSK_DISPLAY"
  log "virtual geometry: $VIRTUAL_GEOMETRY"
  if [[ "$ACTIVE_DISPLAY_MODE" == "physical" && ! -x /usr/bin/startx ]]; then
    log "WARN: /usr/bin/startx is missing"
  fi
  if [[ "$ACTIVE_DISPLAY_MODE" == "virtual" ]] && ! command -v "$TIKPAL_KIOSK_XVFB_BIN" >/dev/null 2>&1; then
    log "WARN: $TIKPAL_KIOSK_XVFB_BIN is missing"
  fi
  log "check passed"
  exit 0
fi

export TIKPAL_KIOSK_ACTIVE_DISPLAY_MODE="$ACTIVE_DISPLAY_MODE"

if [[ "$ACTIVE_DISPLAY_MODE" == "physical" ]]; then
  log "starting physical X session on $TIKPAL_KIOSK_DISPLAY"
  exec /usr/bin/startx "$SCRIPT_DIR/start-tikpal-kiosk-session.sh" -- "$TIKPAL_KIOSK_DISPLAY" -br -nocursor
fi

command -v "$TIKPAL_KIOSK_XVFB_BIN" >/dev/null 2>&1 || fail "$TIKPAL_KIOSK_XVFB_BIN is required for virtual kiosk display"

log "starting virtual X session on $TIKPAL_KIOSK_DISPLAY ($VIRTUAL_GEOMETRY)"
"$TIKPAL_KIOSK_XVFB_BIN" "$TIKPAL_KIOSK_DISPLAY" -screen 0 "$VIRTUAL_GEOMETRY" -nolisten tcp &
XVFB_PID=$!

cleanup() {
  if kill -0 "$XVFB_PID" >/dev/null 2>&1; then
    kill "$XVFB_PID" >/dev/null 2>&1 || true
    wait "$XVFB_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

wait_for_display || fail "Timed out waiting for $TIKPAL_KIOSK_DISPLAY"

export TIKPAL_KIOSK_XRANDR_MODE=none
"$SCRIPT_DIR/start-tikpal-kiosk-session.sh" &
KIOSK_PID=$!
wait "$KIOSK_PID"

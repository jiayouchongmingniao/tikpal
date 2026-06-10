#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="${TIKPAL_KIOSK_ENV_FILE:-$APP_DIR/.env.kiosk}"
VIEWER_ENV_FILE="${TIKPAL_KIOSK_VIEWER_ENV_FILE:-$APP_DIR/.env.kiosk.viewer}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

if [[ -f "$VIEWER_ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$VIEWER_ENV_FILE"
  set +a
fi

: "${TIKPAL_KIOSK_DISPLAY:=:0}"
: "${TIKPAL_KIOSK_VIEWER:=none}"
: "${TIKPAL_KIOSK_NOVNC_ADDRESS:=0.0.0.0}"
: "${TIKPAL_KIOSK_NOVNC_PORT:=6080}"
: "${TIKPAL_KIOSK_VNC_ADDRESS:=127.0.0.1}"
: "${TIKPAL_KIOSK_VNC_PORT:=5900}"
: "${TIKPAL_KIOSK_NOVNC_WEB_ROOT:=}"

MODE="launch"
if [[ "${1:-}" == "--check" ]]; then
  MODE="check"
fi

log() {
  printf '[tikpal-kiosk-viewer] %s\n' "$*"
}

fail() {
  log "ERROR: $*"
  exit 1
}

wait_for_display() {
  local attempt
  for attempt in {1..120}; do
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

find_novnc_web_root() {
  local candidate
  for candidate in \
    "$TIKPAL_KIOSK_NOVNC_WEB_ROOT" \
    /usr/share/novnc \
    /usr/share/novnc/html \
    /usr/share/webapps/novnc; do
    [[ -n "$candidate" ]] || continue
    if [[ -f "$candidate/vnc.html" || -f "$candidate/index.html" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

NORMALIZED_VIEWER="$(printf '%s' "$TIKPAL_KIOSK_VIEWER" | tr '[:upper:]' '[:lower:]')"
case "$NORMALIZED_VIEWER" in
  none|off|0|false|disabled)
    log "viewer disabled"
    exit 0
    ;;
  novnc)
    ;;
  *)
    fail "Invalid TIKPAL_KIOSK_VIEWER '$TIKPAL_KIOSK_VIEWER'; expected none or novnc"
    ;;
esac

NOVNC_WEB_ROOT="$(find_novnc_web_root || true)"

if [[ "$MODE" == "check" ]]; then
  log "app dir: $APP_DIR"
  log "env file: $ENV_FILE"
  log "viewer env file: $VIEWER_ENV_FILE"
  log "viewer: $TIKPAL_KIOSK_VIEWER"
  log "display: $TIKPAL_KIOSK_DISPLAY"
  log "vnc: ${TIKPAL_KIOSK_VNC_ADDRESS}:${TIKPAL_KIOSK_VNC_PORT}"
  log "novnc: ${TIKPAL_KIOSK_NOVNC_ADDRESS}:${TIKPAL_KIOSK_NOVNC_PORT}"
  log "novnc web root: ${NOVNC_WEB_ROOT:-missing}"
  command -v x11vnc >/dev/null 2>&1 || log "WARN: x11vnc is missing"
  command -v websockify >/dev/null 2>&1 || log "WARN: websockify is missing"
  [[ -n "$NOVNC_WEB_ROOT" ]] || log "WARN: noVNC web root is missing"
  log "check passed"
  exit 0
fi

command -v x11vnc >/dev/null 2>&1 || fail "x11vnc is required for TIKPAL_KIOSK_VIEWER=novnc"
command -v websockify >/dev/null 2>&1 || fail "websockify is required for TIKPAL_KIOSK_VIEWER=novnc"
[[ -n "$NOVNC_WEB_ROOT" ]] || fail "noVNC web root is missing; set TIKPAL_KIOSK_NOVNC_WEB_ROOT"

wait_for_display || fail "Timed out waiting for $TIKPAL_KIOSK_DISPLAY"

x11vnc \
  -display "$TIKPAL_KIOSK_DISPLAY" \
  -listen "$TIKPAL_KIOSK_VNC_ADDRESS" \
  -rfbport "$TIKPAL_KIOSK_VNC_PORT" \
  -forever \
  -shared \
  -nopw \
  -quiet &
X11VNC_PID=$!

cleanup() {
  if kill -0 "$X11VNC_PID" >/dev/null 2>&1; then
    kill "$X11VNC_PID" >/dev/null 2>&1 || true
    wait "$X11VNC_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

log "serving noVNC on http://${TIKPAL_KIOSK_NOVNC_ADDRESS}:${TIKPAL_KIOSK_NOVNC_PORT}/"
websockify \
  --web "$NOVNC_WEB_ROOT" \
  "${TIKPAL_KIOSK_NOVNC_ADDRESS}:${TIKPAL_KIOSK_NOVNC_PORT}" \
  "${TIKPAL_KIOSK_VNC_ADDRESS}:${TIKPAL_KIOSK_VNC_PORT}" &
WEBSOCKIFY_PID=$!
wait "$WEBSOCKIFY_PID"

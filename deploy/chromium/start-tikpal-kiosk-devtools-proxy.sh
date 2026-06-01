#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="${TIKPAL_KIOSK_ENV_FILE:-$APP_DIR/.env.kiosk}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

: "${TIKPAL_KIOSK_REMOTE_DEBUG:=0}"
: "${TIKPAL_KIOSK_REMOTE_DEBUG_ADDRESS:=127.0.0.1}"
: "${TIKPAL_KIOSK_REMOTE_DEBUG_PORT:=9222}"
: "${TIKPAL_KIOSK_REMOTE_DEBUG_CHROMIUM_ADDRESS:=127.0.0.1}"
: "${TIKPAL_KIOSK_REMOTE_DEBUG_CHROMIUM_PORT:=$TIKPAL_KIOSK_REMOTE_DEBUG_PORT}"

MODE="launch"
if [[ "${1:-}" == "--check" ]]; then
  MODE="check"
fi

log() {
  printf '[tikpal-kiosk-devtools] %s\n' "$*"
}

fail() {
  log "ERROR: $*"
  exit 1
}

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

wait_for_devtools() {
  local attempt
  for attempt in {1..120}; do
    if curl -fsS "http://${TIKPAL_KIOSK_REMOTE_DEBUG_CHROMIUM_ADDRESS}:${TIKPAL_KIOSK_REMOTE_DEBUG_CHROMIUM_PORT}/json/version" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

if ! is_enabled "$TIKPAL_KIOSK_REMOTE_DEBUG"; then
  log "remote debug disabled"
  exit 0
fi

if [[ "$MODE" == "check" ]]; then
  log "app dir: $APP_DIR"
  log "env file: $ENV_FILE"
  log "public endpoint: ${TIKPAL_KIOSK_REMOTE_DEBUG_ADDRESS}:${TIKPAL_KIOSK_REMOTE_DEBUG_PORT}"
  log "chromium endpoint: ${TIKPAL_KIOSK_REMOTE_DEBUG_CHROMIUM_ADDRESS}:${TIKPAL_KIOSK_REMOTE_DEBUG_CHROMIUM_PORT}"
  command -v socat >/dev/null 2>&1 || log "WARN: socat is missing"
  command -v curl >/dev/null 2>&1 || log "WARN: curl is missing"
  log "check passed"
  exit 0
fi

command -v socat >/dev/null 2>&1 || fail "socat is required for LAN DevTools proxy"
command -v curl >/dev/null 2>&1 || fail "curl is required for LAN DevTools proxy readiness"
wait_for_devtools || fail "Timed out waiting for Chromium DevTools endpoint"

log "proxying ${TIKPAL_KIOSK_REMOTE_DEBUG_ADDRESS}:${TIKPAL_KIOSK_REMOTE_DEBUG_PORT} -> ${TIKPAL_KIOSK_REMOTE_DEBUG_CHROMIUM_ADDRESS}:${TIKPAL_KIOSK_REMOTE_DEBUG_CHROMIUM_PORT}"
exec socat \
  "TCP-LISTEN:${TIKPAL_KIOSK_REMOTE_DEBUG_PORT},bind=${TIKPAL_KIOSK_REMOTE_DEBUG_ADDRESS},fork,reuseaddr" \
  "TCP:${TIKPAL_KIOSK_REMOTE_DEBUG_CHROMIUM_ADDRESS}:${TIKPAL_KIOSK_REMOTE_DEBUG_CHROMIUM_PORT}"

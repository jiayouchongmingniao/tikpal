#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
VIEWER_ENV_FILE="${TIKPAL_KIOSK_VIEWER_ENV_FILE:-$APP_DIR/.env.kiosk.viewer}"
NOVNC_ADDRESS="${TIKPAL_KIOSK_NOVNC_ADDRESS:-0.0.0.0}"
NOVNC_PORT="${TIKPAL_KIOSK_NOVNC_PORT:-6080}"
SERVICE_NAME="${TIKPAL_KIOSK_VIEWER_SERVICE:-tikpal-kiosk-viewer.service}"

usage() {
  cat <<USAGE
Usage: $(basename "$0") <start|stop|status|--check>

Commands:
  start    Enable noVNC for this recording session and restart the viewer service.
  stop     Disable noVNC and stop the viewer service.
  status   Show the current viewer switch, service state, and listening ports.
  --check  Validate script paths without changing service state.
USAGE
}

log() {
  printf '[tikpal-kiosk-viewerctl] %s\n' "$*"
}

fail() {
  log "ERROR: $*"
  exit 1
}

run_systemctl() {
  if ! command -v systemctl >/dev/null 2>&1; then
    fail "systemctl is required on the Pi"
  fi

  if [[ "$(id -u)" -eq 0 ]]; then
    systemctl "$@"
    return
  fi

  if command -v sudo >/dev/null 2>&1; then
    sudo systemctl "$@"
    return
  fi

  fail "run as root or install sudo to control $SERVICE_NAME"
}

write_viewer_env() {
  local viewer="$1"
  local tmp
  mkdir -p "$(dirname "$VIEWER_ENV_FILE")"
  tmp="$(mktemp "${VIEWER_ENV_FILE}.tmp.XXXXXX")"
  cat > "$tmp" <<EOF
# Managed by deploy/chromium/tikpal-kiosk-viewerctl.sh.
# This file intentionally overrides only the temporary noVNC viewer.
TIKPAL_KIOSK_VIEWER=$viewer
TIKPAL_KIOSK_NOVNC_ADDRESS=$NOVNC_ADDRESS
TIKPAL_KIOSK_NOVNC_PORT=$NOVNC_PORT
EOF
  chmod 0644 "$tmp"
  mv "$tmp" "$VIEWER_ENV_FILE"
}

show_status() {
  log "app dir: $APP_DIR"
  log "viewer env file: $VIEWER_ENV_FILE"
  if [[ -f "$VIEWER_ENV_FILE" ]]; then
    grep -E '^(TIKPAL_KIOSK_VIEWER|TIKPAL_KIOSK_NOVNC_ADDRESS|TIKPAL_KIOSK_NOVNC_PORT)=' "$VIEWER_ENV_FILE" || true
  else
    log "viewer env file missing; wrapper default is viewer disabled"
  fi

  if command -v systemctl >/dev/null 2>&1; then
    systemctl is-active "$SERVICE_NAME" 2>/dev/null || true
  fi

  if command -v ss >/dev/null 2>&1; then
    ss -ltnp 2>/dev/null | grep -E ":(5900|${NOVNC_PORT})\\b" || true
  fi
}

COMMAND="${1:-}"

case "$COMMAND" in
  start)
    write_viewer_env "novnc"
    run_systemctl restart "$SERVICE_NAME"
    log "noVNC enabled for recording: http://${NOVNC_ADDRESS}:${NOVNC_PORT}/"
    ;;
  stop)
    write_viewer_env "none"
    run_systemctl stop "$SERVICE_NAME"
    run_systemctl reset-failed "$SERVICE_NAME" >/dev/null 2>&1 || true
    log "noVNC disabled; $SERVICE_NAME stopped"
    ;;
  status)
    show_status
    ;;
  --check)
    log "app dir: $APP_DIR"
    log "viewer env file: $VIEWER_ENV_FILE"
    log "novnc endpoint: ${NOVNC_ADDRESS}:${NOVNC_PORT}"
    log "service: $SERVICE_NAME"
    log "check passed"
    ;;
  -h|--help|"")
    usage
    ;;
  *)
    usage >&2
    exit 1
    ;;
esac

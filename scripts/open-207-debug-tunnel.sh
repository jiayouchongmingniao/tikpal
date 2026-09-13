#!/usr/bin/env bash
set -euo pipefail

# Open an authenticated desktop-development path to a device-local Tikpal
# kiosk. This intentionally exposes no new LAN listener on the device.

TARGET_HOST="${TIKPAL_DEBUG_HOST:-192.168.10.207}"
TARGET_USER="${TIKPAL_DEBUG_USER:-root}"
TARGET_KIOSK_PORT="${TIKPAL_DEBUG_KIOSK_PORT:-4173}"
TARGET_CDP_PORT="${TIKPAL_DEBUG_CDP_PORT:-9222}"
LOCAL_KIOSK_PORT="${TIKPAL_DEBUG_LOCAL_KIOSK_PORT:-4173}"
LOCAL_CDP_PORT="${TIKPAL_DEBUG_LOCAL_CDP_PORT:-9222}"
TARGET="${TARGET_USER}@${TARGET_HOST}"
SOCKET_ROOT="${TMPDIR:-/tmp}"
SAFE_HOST="$(printf '%s' "$TARGET_HOST" | tr -c '[:alnum:].-' '_')"
CONTROL_PATH="${TIKPAL_DEBUG_CONTROL_PATH:-${SOCKET_ROOT%/}/tikpal-${SAFE_HOST}-debug.sock}"
ACTION="${1:-start}"

usage() {
  cat <<'EOF'
Usage: scripts/open-207-debug-tunnel.sh [start|status|stop]

Environment overrides:
  TIKPAL_DEBUG_HOST             Device address (default: 192.168.10.207)
  TIKPAL_DEBUG_USER             SSH user (default: root)
  TIKPAL_DEBUG_LOCAL_KIOSK_PORT Local forwarded kiosk port (default: 4173)
  TIKPAL_DEBUG_LOCAL_CDP_PORT   Local forwarded DevTools port (default: 9222)
  TIKPAL_DEBUG_OPEN_BROWSER     Set to 0 to avoid opening the browser
EOF
}

is_running() {
  ssh -o BatchMode=yes -S "$CONTROL_PATH" -O check "$TARGET" >/dev/null 2>&1
}

start_tunnel() {
  if is_running; then
    printf 'Tikpal debug tunnel is already active: http://127.0.0.1:%s\n' "$LOCAL_KIOSK_PORT"
  else
    rm -f "$CONTROL_PATH"
    ssh \
      -fMN \
      -o BatchMode=yes \
      -o ExitOnForwardFailure=yes \
      -o ServerAliveInterval=30 \
      -o ServerAliveCountMax=3 \
      -o ControlMaster=yes \
      -S "$CONTROL_PATH" \
      -L "${LOCAL_KIOSK_PORT}:127.0.0.1:${TARGET_KIOSK_PORT}" \
      -L "${LOCAL_CDP_PORT}:127.0.0.1:${TARGET_CDP_PORT}" \
      "$TARGET"
    printf 'Tikpal debug tunnel is ready: http://127.0.0.1:%s\n' "$LOCAL_KIOSK_PORT"
    printf 'Chromium DevTools is available on: http://127.0.0.1:%s\n' "$LOCAL_CDP_PORT"
  fi

  if [[ "${TIKPAL_DEBUG_OPEN_BROWSER:-1}" != "0" ]] && command -v open >/dev/null 2>&1; then
    open "http://127.0.0.1:${LOCAL_KIOSK_PORT}"
  fi
}

case "$ACTION" in
  start)
    start_tunnel
    ;;
  status)
    if is_running; then
      printf 'Tikpal debug tunnel is active: http://127.0.0.1:%s\n' "$LOCAL_KIOSK_PORT"
    else
      printf 'Tikpal debug tunnel is not active\n' >&2
      exit 1
    fi
    ;;
  stop)
    if is_running; then
      ssh -o BatchMode=yes -S "$CONTROL_PATH" -O exit "$TARGET"
      rm -f "$CONTROL_PATH"
      printf 'Tikpal debug tunnel stopped\n'
    else
      rm -f "$CONTROL_PATH"
      printf 'Tikpal debug tunnel is not active\n'
    fi
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

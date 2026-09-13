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
# Every resident Explore provider has its own loopback-only CDP port. Keep
# them on the desktop loopback too, so the active provider can be inspected
# without recreating the tunnel for a provider switch.
EXPLORE_CDP_PORTS="${TIKPAL_DEBUG_EXPLORE_CDP_PORTS:-9234,9235,9236,9237,9238,9239,9240,9241,9242,9243}"
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
  TIKPAL_DEBUG_EXPLORE_CDP_PORTS Comma-separated Explore CDP ports
                                 (default: 9234,9235,9236,9237,9238,9239,9240,9241,9242,9243)
  TIKPAL_DEBUG_OPEN_BROWSER     Set to 0 to avoid opening the browser
EOF
}

is_running() {
  ssh -o BatchMode=yes -S "$CONTROL_PATH" -O check "$TARGET" >/dev/null 2>&1
}

explore_forward_args=()
explore_forward_specs=()
IFS=',' read -r -a explore_ports <<< "$EXPLORE_CDP_PORTS"
for explore_port in "${explore_ports[@]}"; do
  [[ "$explore_port" =~ ^[1-9][0-9]{0,4}$ ]] && (( explore_port <= 65535 )) || {
    printf 'Invalid Explore CDP port: %s\n' "$explore_port" >&2
    exit 2
  }
  explore_forward_specs+=( "${explore_port}:127.0.0.1:${explore_port}" )
  explore_forward_args+=( -L "${explore_port}:127.0.0.1:${explore_port}" )
done

ensure_explore_forwards() {
  local forward
  for forward in "${explore_forward_specs[@]}"; do
    ssh -o BatchMode=yes -S "$CONTROL_PATH" -O forward -L "$forward" "$TARGET"
  done
}

start_tunnel() {
  if is_running; then
    ensure_explore_forwards
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
      "${explore_forward_args[@]}" \
      "$TARGET"
    printf 'Tikpal debug tunnel is ready: http://127.0.0.1:%s\n' "$LOCAL_KIOSK_PORT"
    printf 'Chromium DevTools is available on: http://127.0.0.1:%s\n' "$LOCAL_CDP_PORT"
  fi

  printf 'Explore CDP is available on local ports: %s\n' "$EXPLORE_CDP_PORTS"

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

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
: "${TIKPAL_KIOSK_X_COMMAND_TIMEOUT_SECONDS:=5}"
export DISPLAY="$TIKPAL_KIOSK_DISPLAY"

run_x_command() {
  if command -v timeout >/dev/null 2>&1; then
    timeout -k 1s "${TIKPAL_KIOSK_X_COMMAND_TIMEOUT_SECONDS}s" "$@"
    return
  fi
  "$@"
}

if command -v xset >/dev/null 2>&1; then
  run_x_command xset -dpms || true
  run_x_command xset s off || true
  run_x_command xset s noblank || true
fi

exec "$SCRIPT_DIR/launch-tikpal-kiosk.sh"

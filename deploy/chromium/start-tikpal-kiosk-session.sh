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

: "${TIKPAL_KIOSK_DISPLAY:=:0}"
export DISPLAY="$TIKPAL_KIOSK_DISPLAY"

if command -v xset >/dev/null 2>&1; then
  xset -dpms || true
  xset s off || true
  xset s noblank || true
fi

exec "$SCRIPT_DIR/launch-tikpal-kiosk.sh"

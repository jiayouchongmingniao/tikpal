#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="${TIKPAL_KIOSK_ENV_FILE:-$APP_DIR/.env.kiosk}"

if [[ "${TIKPAL_KIOSK_SKIP_ENV_SOURCE:-0}" != "1" && -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

: "${TIKPAL_GUARD_OTA_UPDATER:=$SCRIPT_DIR/tikpal-guard-ota.mjs}"
if [[ "${1:-}" == "--bootstrap" ]]; then
  exec "$TIKPAL_GUARD_OTA_UPDATER" bootstrap
fi
if [[ "${1:-}" == "--activate-only" ]]; then
  exec "$SCRIPT_DIR/tikpal-web-mode.sh" guard-ota-activate
fi
"$TIKPAL_GUARD_OTA_UPDATER" check
"$SCRIPT_DIR/tikpal-web-mode.sh" guard-ota-activate

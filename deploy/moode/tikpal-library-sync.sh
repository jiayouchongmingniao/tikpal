#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_SYNC_HELPER="${TIKPAL_LOCAL_LIBRARY_SYNC_HELPER:-$SCRIPT_DIR/tikpal-local-library-sync.sh}"
USB_SYNC_HELPER="${TIKPAL_USB_LIBRARY_SYNC_HELPER:-$SCRIPT_DIR/tikpal-usb-library-sync.sh}"
MODE="${1:-apply}"

run_helper() {
  local helper="$1"
  local mode="$2"
  if [ ! -x "$helper" ]; then
    printf 'tikpal-library-sync: %s is not executable; skipping\n' "$helper" >&2
    return
  fi
  "$helper" "$mode"
}

case "$MODE" in
  apply|sync)
    run_helper "$LOCAL_SYNC_HELPER" apply
    run_helper "$USB_SYNC_HELPER" apply
    ;;
  check)
    run_helper "$LOCAL_SYNC_HELPER" check
    run_helper "$USB_SYNC_HELPER" check
    ;;
  *)
    printf 'Usage: %s [apply|sync|check]\n' "$0" >&2
    exit 2
    ;;
esac

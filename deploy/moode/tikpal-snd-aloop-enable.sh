#!/usr/bin/env bash
set -euo pipefail

# Keep moOde's ALSA loopback override usable after reboot.
# Run with sudo on the Pi before enabling Hi-Fi spectrum capture through Loopback.

MODULES_LOAD_PATH="${MODULES_LOAD_PATH:-/etc/modules-load.d/tikpal-snd-aloop.conf}"
ALSALOOP_CONF="${ALSALOOP_CONF:-/etc/tikpal/alsa-loopback.conf}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

TIKPAL_ALSA_LOG_PREFIX="${TIKPAL_ALSA_LOG_PREFIX:-tikpal-snd-aloop}"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/tikpal-alsa-loopback.sh"

log() {
  printf '[tikpal-snd-aloop] %s\n' "$*"
}

warn() {
  printf '[tikpal-snd-aloop] WARN: %s\n' "$*" >&2
}

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Please run with sudo so snd_aloop can be loaded and persisted." >&2
  exit 1
fi

tikpal_enable_alsa_loopback_output "$ALSALOOP_CONF"
printf 'snd_aloop\n' >"$MODULES_LOAD_PATH"
chmod 0644 "$MODULES_LOAD_PATH"

if ! aplay -l 2>/dev/null | grep -q 'Loopback'; then
  warn "snd_aloop was loaded but aplay did not list Loopback yet"
  exit 1
fi

log "snd_aloop is loaded and will be loaded at boot"

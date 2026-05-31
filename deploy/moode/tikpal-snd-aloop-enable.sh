#!/usr/bin/env bash
set -euo pipefail

# Keep moOde's ALSA loopback override usable after reboot.
# Run with sudo on the Pi before enabling Hi-Fi spectrum capture through Loopback.

MODULES_LOAD_PATH="${MODULES_LOAD_PATH:-/etc/modules-load.d/tikpal-snd-aloop.conf}"
ALSALOOP_CONF="${ALSALOOP_CONF:-/etc/alsa/conf.d/_sndaloop.conf}"

log() {
  printf '[tikpal-snd-aloop] %s\n' "$*"
}

warn() {
  printf '[tikpal-snd-aloop] WARN: %s\n' "$*" >&2
}

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Please run with sudo so snd-aloop can be loaded and persisted." >&2
  exit 1
fi

if [[ -f "$ALSALOOP_CONF" ]]; then
  sed -i '0,/_audioout__ {/s//_audioout {/' "$ALSALOOP_CONF" || true
  log "ensured $ALSALOOP_CONF overrides _audioout"
else
  warn "$ALSALOOP_CONF is not present; loading snd-aloop is still safe"
fi

modprobe snd-aloop
printf 'snd-aloop\n' >"$MODULES_LOAD_PATH"
chmod 0644 "$MODULES_LOAD_PATH"

if ! aplay -l 2>/dev/null | grep -q 'Loopback'; then
  warn "snd-aloop was loaded but aplay did not list Loopback yet; reboot may be required"
fi

log "snd-aloop is loaded and will be loaded at boot"

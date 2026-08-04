#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

: "${TIKPAL_TURZX_SOURCE_DIR:=$APP_DIR/deploy/vendor/evdi-display-linux-turzx2}"
: "${TIKPAL_TURZX_INSTALL_PACKAGES:=1}"
: "${TIKPAL_TURZX_ENABLE_SERVICE:=1}"
: "${TIKPAL_TURZX_SERVICE:=display_turzx.service}"

if [[ "${1:-}" == "--source" && -n "${2:-}" ]]; then
  TIKPAL_TURZX_SOURCE_DIR="$2"
  shift 2
fi

log() {
  printf '[tikpal-turzx] %s\n' "$*"
}

fail() {
  log "ERROR: $*" >&2
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

require_root() {
  [[ "$(id -u)" -eq 0 ]] || fail "run as root"
}

source_dir() {
  if [[ -d "$TIKPAL_TURZX_SOURCE_DIR" ]]; then
    printf '%s\n' "$TIKPAL_TURZX_SOURCE_DIR"
    return 0
  fi
  if [[ -d /root/evdi-display-linux-turzx2 ]]; then
    printf '%s\n' /root/evdi-display-linux-turzx2
    return 0
  fi
  return 1
}

install_gentoo_packages() {
  command -v emerge >/dev/null 2>&1 || return 0
  is_enabled "$TIKPAL_TURZX_INSTALL_PACKAGES" || return 0
  log "installing Gentoo TURZX/EVDI prerequisites"
  emerge --ask=n \
    x11-drivers/evdi \
    dev-libs/libusb \
    media-libs/libjpeg-turbo \
    sys-devel/gcc \
    sys-devel/make
}

check_libevdi() {
  if ldconfig -p 2>/dev/null | grep -q 'libevdi\.so\.1'; then
    return 0
  fi
  find /usr/lib /usr/lib64 /lib /lib64 -name libevdi.so.1 -print -quit 2>/dev/null | grep -q .
}

check_source_tree() {
  local src="$1"
  [[ -f "$src/Makefile" ]] || fail "missing Makefile in $src"
  [[ -f "$src/display_turzx-installer.sh" ]] || fail "missing display_turzx-installer.sh in $src"
  [[ -f "$src/display_main.c" ]] || fail "missing TURZX source files in $src"
}

install_driver() {
  local src="$1"
  log "using source tree: $src"
  check_source_tree "$src"
  install_gentoo_packages
  check_libevdi || fail "missing libevdi.so.1; install x11-drivers/evdi first"
  make -C "$src" install
}

enable_service() {
  is_enabled "$TIKPAL_TURZX_ENABLE_SERVICE" || return 0
  systemctl daemon-reload
  systemctl enable --now "$TIKPAL_TURZX_SERVICE" >/dev/null 2>&1 || systemctl start "$TIKPAL_TURZX_SERVICE"
  systemctl is-active "$TIKPAL_TURZX_SERVICE"
}

case "${1:-install}" in
  install)
    require_root
    src="$(source_dir)" || fail "TURZX source tree not found. Put it at $TIKPAL_TURZX_SOURCE_DIR or pass --source /path/to/evdi-display-linux-turzx2."
    install_driver "$src"
    enable_service
    ;;
  check)
    src="$(source_dir || true)"
    log "source: ${src:-missing}"
    log "service: $(systemctl is-active "$TIKPAL_TURZX_SERVICE" 2>/dev/null || true)"
    if check_libevdi; then
      log "libevdi.so.1: present"
    else
      log "libevdi.so.1: missing"
    fi
    ;;
  *)
    fail "usage: $0 [--source /path/to/evdi-display-linux-turzx2] [install|check]"
    ;;
esac

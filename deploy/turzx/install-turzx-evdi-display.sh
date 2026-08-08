#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

: "${TIKPAL_TURZX_SOURCE_DIR:=$APP_DIR/deploy/vendor/evdi-display-linux-turzx2}"
: "${TIKPAL_TURZX_INSTALL_PACKAGES:=1}"
: "${TIKPAL_TURZX_ENABLE_SERVICE:=1}"
: "${TIKPAL_TURZX_SERVICE:=display_turzx.service}"
: "${TIKPAL_TURZX_APPLY_PATCHES:=1}"
: "${TIKPAL_TURZX_INSTALL_HELPER:=1}"

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

apply_tikpal_patches() {
  local src="$1"
  local patch_dir="$SCRIPT_DIR/patches"
  local patch_file
  is_enabled "$TIKPAL_TURZX_APPLY_PATCHES" || return 0
  [[ -d "$patch_dir" ]] || return 0
  compgen -G "$patch_dir/*.patch" >/dev/null || return 0

  for patch_file in "$patch_dir"/*.patch; do
    if patch -d "$src" --dry-run -p1 < "$patch_file" >/dev/null 2>&1; then
      log "applying $(basename "$patch_file")"
      patch -d "$src" -p1 < "$patch_file"
    elif patch -d "$src" --reverse --dry-run -p1 < "$patch_file" >/dev/null 2>&1; then
      log "$(basename "$patch_file") already applied"
    elif patch_markers_present "$src" "$(basename "$patch_file")"; then
      log "$(basename "$patch_file") already present"
    else
      fail "cannot apply $(basename "$patch_file") to $src"
    fi
  done
}

patch_markers_present() {
  local src="$1"
  local patch_name="$2"

  case "$patch_name" in
    0001-add-backlight-control.patch)
      grep -q "display_get_backlight_value" "$src/display_evdi.c" &&
        grep -q "display_pm_parse_backlight_value" "$src/display_manager.c"
      ;;
    0002-add-backlight-readback.patch)
      grep -q "display_read_backlight_value" "$src/display_evdi.c" &&
        grep -q "case 'G'" "$src/display_manager.c"
      ;;
    *)
      return 1
      ;;
  esac
}

install_brightness_helper() {
  local helper="$SCRIPT_DIR/tikpal-turzx-brightness.sh"
  local probe="$SCRIPT_DIR/tikpal-turzx-hid-probe.py"
  local usb_probe="$SCRIPT_DIR/tikpal-turzx-usb-probe.py"
  local usbmon="$SCRIPT_DIR/tikpal-turzx-usbmon-capture.sh"
  local target="/usr/local/sbin/tikpal-turzx-brightness"
  local probe_target="/usr/local/sbin/tikpal-turzx-hid-probe"
  local usb_probe_target="/usr/local/sbin/tikpal-turzx-usb-probe"
  local usbmon_target="/usr/local/sbin/tikpal-turzx-usbmon-capture"
  is_enabled "$TIKPAL_TURZX_INSTALL_HELPER" || return 0
  [[ -f "$helper" ]] || {
    log "WARN: $helper not found; skipping brightness helper install" >&2
    return 0
  }
  install -o root -g root -m 0755 "$helper" "$target"
  log "installed $target"
  if [[ -f "$probe" ]]; then
    install -o root -g root -m 0755 "$probe" "$probe_target"
    log "installed $probe_target"
  fi
  if [[ -f "$usb_probe" ]]; then
    install -o root -g root -m 0755 "$usb_probe" "$usb_probe_target"
    log "installed $usb_probe_target"
  fi
  if [[ -f "$usbmon" ]]; then
    install -o root -g root -m 0755 "$usbmon" "$usbmon_target"
    log "installed $usbmon_target"
  fi
}

install_driver() {
  local src="$1"
  log "using source tree: $src"
  check_source_tree "$src"
  install_gentoo_packages
  check_libevdi || fail "missing libevdi.so.1; install x11-drivers/evdi first"
  apply_tikpal_patches "$src"
  install_brightness_helper
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

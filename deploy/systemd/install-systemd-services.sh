#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
SERVICE_USER="${SUDO_USER:-moode}"
INSTALL_KIOSK=0
RESTART_SERVICES=0
KIOSK_PACKAGES=(
  xvfb
  x11vnc
  novnc
  websockify
  socat
  onboard
  wmctrl
  xdotool
  fcitx5
  fcitx5-chinese-addons
  fcitx5-frontend-gtk3
)

usage() {
  cat <<USAGE
Usage: sudo deploy/systemd/install-systemd-services.sh [options]

Options:
  --app-dir PATH       App directory on the Pi (default: current repo root)
  --user NAME          Service user (default: current user)
  --enable-kiosk       Install and enable tikpal-kiosk.service and watchdog timer
  --restart            Restart installed services after daemon-reload
  -h, --help           Show this help
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-dir)
      APP_DIR="$2"
      shift 2
      ;;
    --user)
      SERVICE_USER="$2"
      shift 2
      ;;
    --enable-kiosk)
      INSTALL_KIOSK=1
      shift
      ;;
    --restart)
      RESTART_SERVICES=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Please run with sudo so systemd units and Chromium policies can be installed." >&2
  exit 1
fi

APP_DIR="$(cd "$APP_DIR" && pwd)"

install_unit() {
  local template="$1"
  local target="/etc/systemd/system/$(basename "$template")"
  sed \
    -e "s|@APP_DIR@|$APP_DIR|g" \
    -e "s|@SERVICE_USER@|$SERVICE_USER|g" \
    "$template" > "$target"
  chmod 0644 "$target"
  echo "installed $target"
}

install_kiosk_packages() {
  local missing_packages=()
  local package
  command -v apt-get >/dev/null 2>&1 || {
    echo "WARN: apt-get not found; skipping kiosk package install" >&2
    return
  }
  for package in "${KIOSK_PACKAGES[@]}"; do
    if ! dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q "install ok installed"; then
      missing_packages+=("$package")
    fi
  done
  if [[ "${#missing_packages[@]}" -eq 0 ]]; then
    echo "kiosk packages already installed"
    return
  fi
  DEBIAN_FRONTEND=noninteractive apt-get update -y
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${missing_packages[@]}"
}

install_onboard_scripts() {
  local source_dir="$APP_DIR/deploy/chromium/onboard-scripts"
  local target_dir="/usr/share/onboard/scripts"
  [[ -d "$source_dir" ]] || return 0
  [[ -d "$target_dir" ]] || {
    echo "WARN: $target_dir not found; skipping Tikpal Onboard scripts" >&2
    return 0
  }
  install -m 0644 "$source_dir"/tikpalImeToggle.py "$target_dir/tikpalImeToggle.py"
  echo "installed $target_dir/tikpalImeToggle.py"
}

install_onboard_themes() {
  local source_dir="$APP_DIR/deploy/chromium/onboard-themes"
  local target_dir="/usr/share/onboard/themes"
  [[ -d "$source_dir" ]] || return 0
  [[ -d "$target_dir" ]] || {
    echo "WARN: $target_dir not found; skipping Tikpal Onboard themes" >&2
    return 0
  }
  install -m 0644 "$source_dir"/Tikpal-Classic.colors "$target_dir/Tikpal-Classic.colors"
  echo "installed $target_dir/Tikpal-Classic.colors"
}

if [[ ! -f "$APP_DIR/server/index.mjs" || ! -f "$APP_DIR/server/web.mjs" ]]; then
  echo "Missing Tikpal server files under $APP_DIR" >&2
  exit 1
fi

if [[ ! -d "$APP_DIR/dist" ]]; then
  echo "Missing $APP_DIR/dist. Run npm ci && npm run build before installing services." >&2
  exit 1
fi

if [[ "${TIKPAL_INSTALL_LOCALE_FIX:-1}" != "0" && -x "$APP_DIR/deploy/moode/tikpal-locale-enable.sh" ]]; then
  "$APP_DIR/deploy/moode/tikpal-locale-enable.sh"
fi

install_unit "$SCRIPT_DIR/tikpal-api.service"
install_unit "$SCRIPT_DIR/tikpal-web.service"
install_unit "$SCRIPT_DIR/tikpal-audio-adapt.service"

if [[ "$INSTALL_KIOSK" -eq 1 ]]; then
  if [[ "${TIKPAL_INSTALL_KIOSK_PACKAGES:-1}" != "0" ]]; then
    install_kiosk_packages
  fi
  install_onboard_scripts
  install_onboard_themes
  install_unit "$SCRIPT_DIR/tikpal-kiosk.service"
  install_unit "$SCRIPT_DIR/tikpal-kiosk-viewer.service"
  install_unit "$SCRIPT_DIR/tikpal-kiosk-devtools.service"
  install_unit "$SCRIPT_DIR/tikpal-kiosk-watchdog.service"
  install_unit "$SCRIPT_DIR/tikpal-kiosk-watchdog.timer"
  if [[ ! -f "$APP_DIR/.env.kiosk" ]]; then
    cp "$APP_DIR/deploy/chromium/env.kiosk.example" "$APP_DIR/.env.kiosk"
    chown "$SERVICE_USER":"$SERVICE_USER" "$APP_DIR/.env.kiosk" || true
    echo "created $APP_DIR/.env.kiosk from example"
  fi
  web_mode_audio_device="$(sed -n 's/^TIKPAL_WEB_MODE_ALSA_OUTPUT_DEVICE=//p' "$APP_DIR/.env.kiosk" | tail -n 1)"
  web_mode_audio_device="${web_mode_audio_device%\"}"
  web_mode_audio_device="${web_mode_audio_device#\"}"
  if [[ -n "$web_mode_audio_device" && -x "$APP_DIR/deploy/moode/tikpal-web-mode-crossfade.sh" ]]; then
    if ! TIKPAL_WEB_MODE_ALSA_OUTPUT_DEVICE="$web_mode_audio_device" \
      "$APP_DIR/deploy/moode/tikpal-web-mode-crossfade.sh" install; then
      echo "WARN: Explore audio crossfade install failed; continuing with direct provider audio" >&2
    fi
  fi
fi

for policy_dir in /etc/chromium/policies/managed /etc/chromium-browser/policies/managed; do
  mkdir -p "$policy_dir"
  rm -f "$policy_dir/tikpal-kiosk-managed.json"
  cp "$APP_DIR/deploy/chromium/managed-policies.json" "$policy_dir/tikpal-kiosk.json"
  chmod 0644 "$policy_dir/tikpal-kiosk.json"
  echo "installed $policy_dir/tikpal-kiosk.json"
done

systemctl daemon-reload
systemctl enable tikpal-audio-adapt.service tikpal-api.service tikpal-web.service

if [[ "$INSTALL_KIOSK" -eq 1 ]]; then
  loginctl enable-linger "$SERVICE_USER"
  systemctl enable tikpal-kiosk.service tikpal-kiosk-viewer.service tikpal-kiosk-devtools.service tikpal-kiosk-watchdog.timer
  if systemctl is-active --quiet kiosk.service; then
    echo "WARN: legacy kiosk.service is active. Inspect it before enabling Tikpal as the only screen owner." >&2
  fi
fi

if [[ "$RESTART_SERVICES" -eq 1 ]]; then
  systemctl restart tikpal-audio-adapt.service
  systemctl restart tikpal-api.service
  systemctl restart tikpal-web.service
  if [[ "$INSTALL_KIOSK" -eq 1 ]]; then
    systemctl restart tikpal-kiosk.service
    systemctl restart tikpal-kiosk-viewer.service
    systemctl restart tikpal-kiosk-devtools.service
    systemctl restart tikpal-kiosk-watchdog.timer
  fi
fi

echo "Tikpal services installed."
echo "Verify with:"
echo "  systemctl status tikpal-audio-adapt.service"
echo "  $APP_DIR/deploy/moode/tikpal-audio-adapt.sh check"
echo "  systemctl is-active tikpal-api.service tikpal-web.service"
echo "  curl -fsS http://127.0.0.1:8787/api/v1/health"
echo "  curl -fsSI http://127.0.0.1:4173/"
echo "  curl -fsSI http://127.0.0.1:4174/"
if [[ "$INSTALL_KIOSK" -eq 1 ]]; then
  echo "  $APP_DIR/deploy/chromium/launch-tikpal-kiosk.sh --check"
  echo "  systemctl status tikpal-kiosk.service"
  echo "  systemctl status tikpal-kiosk-viewer.service"
  echo "  systemctl status tikpal-kiosk-devtools.service"
  echo "  systemctl status tikpal-kiosk-watchdog.timer"
  echo "  $APP_DIR/deploy/chromium/tikpal-kiosk-healthcheck.sh --check"
fi

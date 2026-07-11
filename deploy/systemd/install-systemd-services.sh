#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
SERVICE_USER="${SUDO_USER:-moode}"
INSTALL_KIOSK=0
RESTART_SERVICES=0

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

if [[ ! -f "$APP_DIR/server/index.mjs" || ! -f "$APP_DIR/server/web.mjs" ]]; then
  echo "Missing Tikpal server files under $APP_DIR" >&2
  exit 1
fi

if [[ ! -d "$APP_DIR/dist" ]]; then
  echo "Missing $APP_DIR/dist. Run npm ci && npm run build before installing services." >&2
  exit 1
fi

install_unit "$SCRIPT_DIR/tikpal-api.service"
install_unit "$SCRIPT_DIR/tikpal-web.service"

if [[ "$INSTALL_KIOSK" -eq 1 ]]; then
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
fi

for policy_dir in /etc/chromium/policies/managed /etc/chromium-browser/policies/managed; do
  mkdir -p "$policy_dir"
  rm -f "$policy_dir/tikpal-kiosk-managed.json"
  cp "$APP_DIR/deploy/chromium/managed-policies.json" "$policy_dir/tikpal-kiosk.json"
  chmod 0644 "$policy_dir/tikpal-kiosk.json"
  echo "installed $policy_dir/tikpal-kiosk.json"
done

systemctl daemon-reload
systemctl enable tikpal-api.service tikpal-web.service

if [[ "$INSTALL_KIOSK" -eq 1 ]]; then
  systemctl enable tikpal-kiosk.service tikpal-kiosk-viewer.service tikpal-kiosk-devtools.service tikpal-kiosk-watchdog.timer
  if systemctl is-active --quiet kiosk.service; then
    echo "WARN: legacy kiosk.service is active. Inspect it before enabling Tikpal as the only screen owner." >&2
  fi
fi

if [[ "$RESTART_SERVICES" -eq 1 ]]; then
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

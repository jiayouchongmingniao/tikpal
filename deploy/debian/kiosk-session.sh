#!/usr/bin/env bash
# A standalone GDM X11 session; Tikpal manages its own windows, as on Gentoo.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export XDG_SESSION_TYPE=x11
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"
systemctl --user import-environment DISPLAY XAUTHORITY XDG_SESSION_TYPE
cleanup() {
  systemctl --user stop tikpal-debian.target || true
}
trap cleanup EXIT
bash "$SCRIPT_DIR/start-session.sh"
# Keep the graphical login alive while systemd supervises the browser.
while systemctl --user is-active --quiet tikpal-debian.target; do sleep 5; done

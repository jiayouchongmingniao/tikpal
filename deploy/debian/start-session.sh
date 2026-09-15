#!/usr/bin/env bash
# Invoked by the kiosk session, using its current X credentials and geometry.
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
[[ -n "${DISPLAY:-}" && -n "${XAUTHORITY:-}" ]] || { echo 'An authenticated X11 session is required' >&2; exit 1; }
[[ "${XDG_SESSION_TYPE:-x11}" == x11 ]] || { echo 'Wayland is not supported by this deployment' >&2; exit 1; }
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
mkdir -p "$HOME/.config/tikpal" "$XDG_RUNTIME_DIR/tikpal" "$APP_DIR/.tikpal"
exec 9>"$XDG_RUNTIME_DIR/tikpal/session-start.lock"
flock -n 9 || exit 0
read -r width height < <(xdotool getdisplaygeometry)
[[ "$width" =~ ^[0-9]+$ && "$height" =~ ^[0-9]+$ && "$width" -ge 1280 ]] || exit 1
[[ "$(xrandr --listactivemonitors | head -1)" == 'Monitors: 1' ]] || { echo 'One active monitor is required' >&2; exit 1; }
systemctl --user stop tikpal-debian.target
# No service from the old session remains before publishing the new generation.
generation="$(cat /proc/sys/kernel/random/uuid)"
printf '%s\n' "$generation" > "$APP_DIR/.tikpal/kiosk-x-session-generation"
printf '{"activeProvider":null,"panelMode":"expanded"}\n' > "$APP_DIR/.tikpal/web-mode-state.json"
umask 077
{
  printf 'DISPLAY=%q\nXAUTHORITY=%q\nTIKPAL_KIOSK_DISPLAY=%q\n' "$DISPLAY" "$XAUTHORITY" "$DISPLAY"
  printf 'TIKPAL_KIOSK_WINDOW=%sx%s\n' "$width" "$height"
  printf 'TIKPAL_WEB_MODE_LEFT_WINDOW=%sx%s\n' "$((width - 640))" "$height"
  printf 'TIKPAL_WEB_MODE_PANEL_WINDOW=640x%s\nTIKPAL_WEB_MODE_PANEL_POSITION=%s,0\n' "$height" "$((width - 640))"
  printf 'TIKPAL_WEB_MODE_ENTRY_STAGE_WINDOW=%sx%s\nTIKPAL_WEB_MODE_STAGE_POSITION=%s,0\n' "$width" "$height" "$width"
} > "$HOME/.config/tikpal/session.env.tmp"
mv "$HOME/.config/tikpal/session.env.tmp" "$HOME/.config/tikpal/session.env"
systemctl --user start tikpal-debian.target

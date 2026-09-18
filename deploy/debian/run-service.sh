#!/usr/bin/env bash
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$APP_DIR"
set -a
source "$APP_DIR/.env.kiosk"
if [[ -r "$APP_DIR/.tikpal/web-mode.env" ]]; then
  source "$APP_DIR/.tikpal/web-mode.env"
fi
source "$HOME/.config/tikpal/session.env"
set +a
export PATH="/opt/tikpal/node-v24.21.0-linux-arm64/bin:$PATH"
case "${1:-}" in
  api) exec node server/index.mjs ;;
  web) exec node server/web.mjs ;;
  mpd) exec /usr/bin/mpd --no-daemon "$HOME/.config/tikpal/mpd.conf" ;;
  cdp) exec node deploy/chromium/tikpal-web-mode-cdp-manager.mjs ;;
  helper)
    exec /usr/local/libexec/tikpal-x11-helper daemon --display "$DISPLAY" \
      --socket "$TIKPAL_WEB_MODE_X11_HELPER_SOCKET" \
      --generation-file "$TIKPAL_WEB_MODE_X11_HELPER_GENERATION_PATH" --phase 0 ;;
  kiosk)
    "$APP_DIR/deploy/debian/disable-touch-mouse-emulation.sh" || true
    for attempt in {1..60}; do
      if curl -fsS --max-time 1 http://127.0.0.1:4173/ >/dev/null; then
        # The session launcher publishes the X-session generation before
        # Chromium starts. Explore rejects opens without that generation.
        exec bash deploy/chromium/start-tikpal-kiosk-session.sh
      fi
      sleep 1
    done
    echo 'Tikpal web UI did not become ready' >&2
    exit 1 ;;
  *) echo 'Expected api, web, mpd, cdp, helper or kiosk' >&2; exit 64 ;;
esac

#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/tikpal-moodeutl.sh"

if ! systemctl is-active --quiet upmpdcli.service 2>/dev/null; then
  exit 0
fi

if systemctl stop upmpdcli.service >/dev/null 2>&1; then
  exit 0
fi

if command -v sudo >/dev/null 2>&1 && sudo -n systemctl stop upmpdcli.service >/dev/null 2>&1; then
  exit 0
fi

tikpal_moodeutl -Ro --upnp off >/dev/null 2>&1 || true

! systemctl is-active --quiet upmpdcli.service 2>/dev/null

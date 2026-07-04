#!/usr/bin/env bash
set -euo pipefail

ZEROCONF_PORT="${TIKPAL_SPOTIFY_ZEROCONF_PORT:-9000}"

[[ "$ZEROCONF_PORT" =~ ^[0-9]+$ ]] || exit 1
curl -fsS --max-time 2 "http://127.0.0.1:${ZEROCONF_PORT}/?action=getInfo" >/dev/null

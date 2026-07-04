#!/usr/bin/env bash
set -euo pipefail

SQLDB="${TIKPAL_MOODE_SQLITE_DB:-/var/local/www/db/moode-sqlite3.db}"
ZEROCONF_PORT="${TIKPAL_SPOTIFY_ZEROCONF_PORT:-9000}"

if [[ "$ZEROCONF_PORT" =~ ^[0-9]+$ ]]; then
  label="$(curl -fsS --max-time 2 "http://127.0.0.1:${ZEROCONF_PORT}/?action=getInfo" 2>/dev/null | jq -r '.remoteName // empty' 2>/dev/null || true)"
  if [[ -n "$label" && "$label" != "null" ]]; then
    printf '%s\n' "$label"
    exit 0
  fi
fi

if command -v sqlite3 >/dev/null 2>&1 && [[ -f "$SQLDB" ]]; then
  sqlite3 "$SQLDB" "SELECT value FROM cfg_system WHERE param='spotifyname'" 2>/dev/null || true
fi

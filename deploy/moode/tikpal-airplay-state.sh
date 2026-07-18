#!/bin/sh
set -eu

mode="${1:-ready}"
db_path="${TIKPAL_MOODE_SQLITE_DB:-/var/local/www/db/moode-sqlite3.db}"

case "$mode" in
  ready)
    param="airplaysvc"
    ;;
  active|connected)
    param="aplactive"
    ;;
  receiver)
    if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet shairport-sync.service; then
      exit 0
    fi
    if command -v ss >/dev/null 2>&1 && ss -ltn | awk '$4 ~ /:(5000|7000)$/ { found = 1 } END { exit found ? 0 : 1 }'; then
      exit 0
    fi
    exit 1
    ;;
  *)
    printf 'usage: %s ready|active|receiver\n' "$0" >&2
    exit 2
    ;;
esac

value="$(sqlite3 "$db_path" "SELECT value FROM cfg_system WHERE param='${param}';" 2>/dev/null | head -n 1)"
[ "$value" = "1" ]

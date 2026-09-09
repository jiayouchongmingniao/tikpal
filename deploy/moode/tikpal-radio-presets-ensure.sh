#!/usr/bin/env bash
set -euo pipefail

mode="${1:-ensure}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
app_dir="${TIKPAL_APP_DIR:-$(cd "$script_dir/../.." && pwd)}"
sync_helper="$app_dir/deploy/moode/tikpal-radio-presets-sync.sh"

usage() {
  echo "usage: $0 [ensure|check]" >&2
}

trim_env_value() {
  local value="$1"
  value="$(printf '%s' "$value" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  if [[ "${#value}" -ge 2 ]]; then
    local first="${value:0:1}"
    local last="${value: -1}"
    if [[ ("$first" == '"' && "$last" == '"') || ("$first" == "'" && "$last" == "'") ]]; then
      value="${value:1:${#value}-2}"
    fi
  fi
  printf '%s' "$value"
}

read_env_value() {
  local env_file="$1"
  local key="$2"
  local raw
  [[ -f "$env_file" ]] || return 0
  raw="$(sed -n -E "s/^[[:space:]]*${key}[[:space:]]*=(.*)$/\\1/p" "$env_file" | tail -n 1)"
  [[ -n "$raw" ]] || return 0
  trim_env_value "$raw"
}

resolve_radio_database() {
  local candidate=""
  local env_file
  if [[ -n "${TIKPAL_RADIO_SQLITE_DB:-}" ]]; then
    printf '%s' "$TIKPAL_RADIO_SQLITE_DB"
    return 0
  fi

  for env_file in "$app_dir/.env" "$app_dir/.env.kiosk"; do
    candidate="$(read_env_value "$env_file" "TIKPAL_RADIO_SQLITE_DB")"
    [[ -n "$candidate" ]] && printf '%s\n' "$candidate"
  done | tail -n 1
}

database="$(resolve_radio_database)"
database="${database:-${TIKPAL_MOODE_SQLITE_DB:-/var/local/www/db/moode-sqlite3.db}}"

[[ -x "$sync_helper" ]] || {
  echo "WARN: $sync_helper not found; skipping Tikpal Radio preset sync" >&2
  exit 0
}

if [[ ! -f "$database" ]]; then
  echo "WARN: Tikpal Radio preset sync skipped; SQLite database is unavailable: $database" >&2
  exit 0
fi

run_check() {
  TIKPAL_RADIO_SQLITE_DB="$database" "$sync_helper" check
}

case "$mode" in
  check)
    run_check
    ;;
  ensure)
    if run_check; then
      echo "Tikpal Radio preset catalog is already current: $database"
      exit 0
    else
      check_status="$?"
    fi
    if [[ "$check_status" -eq 2 ]]; then
      echo "Tikpal Radio preset sync blocked by target-id conflicts: $database" >&2
      exit "$check_status"
    fi
    TIKPAL_RADIO_SQLITE_DB="$database" "$sync_helper" apply
    ;;
  -h|--help)
    usage
    ;;
  *)
    usage
    exit 64
    ;;
esac

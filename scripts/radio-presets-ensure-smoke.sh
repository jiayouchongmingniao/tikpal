#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
helper="$repo_root/deploy/moode/tikpal-radio-presets-ensure.sh"
temporary_dir="$(mktemp -d)"
trap 'rm -rf "$temporary_dir"' EXIT

app_dir="$temporary_dir/app"
fake_helper_dir="$app_dir/deploy/moode"
log_file="$temporary_dir/radio-helper.log"
environment_db="$temporary_dir/environment.sqlite3"
kiosk_db="$temporary_dir/kiosk.sqlite3"
explicit_db="$temporary_dir/explicit.sqlite3"
mkdir -p "$fake_helper_dir"
touch "$environment_db" "$kiosk_db" "$explicit_db"
printf '%s\n' "TIKPAL_RADIO_SQLITE_DB=$environment_db" > "$app_dir/.env"
printf '%s\n' "TIKPAL_RADIO_SQLITE_DB=\"$kiosk_db\"" > "$app_dir/.env.kiosk"

fake_helper="$fake_helper_dir/tikpal-radio-presets-sync.sh"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'printf "%s:%s\\n" "$1" "$TIKPAL_RADIO_SQLITE_DB" >> "$FAKE_RADIO_LOG"' \
  'if [[ "$1" == "check" ]]; then exit "${FAKE_CHECK_STATUS:-0}"; fi' \
  > "$fake_helper"
chmod 0755 "$fake_helper"

assert_equal() {
  [[ "$1" == "$2" ]] || {
    echo "expected: $2" >&2
    echo "actual:   $1" >&2
    exit 1
  }
}

read_log() {
  [[ -f "$log_file" ]] && tr -d '\r' < "$log_file" || true
}

FAKE_RADIO_LOG="$log_file" TIKPAL_APP_DIR="$app_dir" "$helper" ensure >/dev/null
assert_equal "$(read_log)" "check:$kiosk_db"

: > "$log_file"
FAKE_RADIO_LOG="$log_file" TIKPAL_RADIO_SQLITE_DB="$explicit_db" TIKPAL_APP_DIR="$app_dir" "$helper" ensure >/dev/null
assert_equal "$(read_log)" "check:$explicit_db"

: > "$log_file"
FAKE_RADIO_LOG="$log_file" FAKE_CHECK_STATUS=1 TIKPAL_APP_DIR="$app_dir" "$helper" ensure >/dev/null
assert_equal "$(read_log)" "$(printf 'check:%s\napply:%s' "$kiosk_db" "$kiosk_db")"

: > "$log_file"
if FAKE_RADIO_LOG="$log_file" FAKE_CHECK_STATUS=2 TIKPAL_APP_DIR="$app_dir" "$helper" ensure >/dev/null 2>&1; then
  echo "target-id conflicts must block Radio preset apply" >&2
  exit 1
fi
assert_equal "$(read_log)" "check:$kiosk_db"

rm -f "$kiosk_db"
: > "$log_file"
FAKE_RADIO_LOG="$log_file" TIKPAL_APP_DIR="$app_dir" "$helper" ensure >/dev/null 2>&1
assert_equal "$(read_log)" ""

echo "radio presets ensure smoke passed"

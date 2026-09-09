#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
helper="$repo_root/deploy/gentoo/tikpal-mpd-httpd.sh"
temporary_dir="$(mktemp -d)"
trap 'rm -rf "$temporary_dir"' EXIT

fake_bin="$temporary_dir/bin"
log_file="$temporary_dir/actions.log"
mpd_conf="$temporary_dir/mpd.conf"
package_use_file="$temporary_dir/package.use/tikpal-mpd"
mkdir -p "$fake_bin" "$(dirname "$package_use_file")"
printf '%s\n' "# Tikpal DLNA recognition tap: start" > "$mpd_conf"

write_executable() {
  local path="$1"
  shift
  printf '%s\n' "$@" > "$path"
  chmod 0755 "$path"
}

write_executable "$fake_bin/mpd" \
  '#!/usr/bin/env bash' \
  'if [[ "${FAKE_MPD_MODE:-ready}" == "missing" ]]; then printf "%s\\n" "Output plugins:" " alsa" ""; exit 0; fi' \
  'printf "%s\\n" "Output plugins:" " httpd" "" "Encoder plugins:" " flac" ""'

write_executable "$fake_bin/mpc" \
  '#!/usr/bin/env bash' \
  'case "$1" in' \
  '  outputs) printf "%s\\n" "Output 1 (Tikpal Everyday) is enabled" "Output 2 (Tikpal DLNA Recognition Tap) is disabled" ;;' \
  '  playlist) printf "%s\\n" "first.flac" "second.flac" ;;' \
  '  status) printf "%s\\n" "second.flac" "[playing] #2/2   0:34/4:00 (14%)" "volume: 30%   repeat: off   random: off   single: off   consume: off"; [[ "${FAKE_MPC_MODE:-ready}" != "output-error" ]] || printf "%s\\n" "ERROR: Failed to open primary output" ;;' \
  '  *) printf "%s\\n" "$*" >> "$FAKE_MPD_HTTPD_LOG" ;;' \
  'esac'

write_executable "$fake_bin/emerge" \
  '#!/usr/bin/env bash' \
  'printf "emerge:%s\\n" "$*" >> "$FAKE_MPD_HTTPD_LOG"'

write_executable "$fake_bin/ss" \
  '#!/usr/bin/env bash' \
  'exit 0'

write_executable "$fake_bin/tap-installer" \
  '#!/usr/bin/env bash' \
  'printf "tap:%s\\n" "$1" >> "$FAKE_MPD_HTTPD_LOG"' \
  'if [[ "$1" == "install" ]]; then printf "%s\\n" "# Tikpal DLNA recognition tap: start" >> "$TIKPAL_MPD_CONF"; fi'

assert_log_contains() {
  rg -Fxq "$1" "$log_file" || {
    echo "missing action: $1" >&2
    sed -n '1,160p' "$log_file" >&2
    exit 1
  }
}

run_helper() {
  FAKE_MPD_HTTPD_LOG="$log_file" \
    TIKPAL_MPD_HTTPD_MPD_BIN="$fake_bin/mpd" \
    TIKPAL_MPD_HTTPD_MPC_BIN="$fake_bin/mpc" \
    TIKPAL_MPD_HTTPD_EMERGE_BIN="$fake_bin/emerge" \
    TIKPAL_MPD_HTTPD_SS_BIN="$fake_bin/ss" \
    TIKPAL_MPD_HTTPD_TAP_INSTALLER="$fake_bin/tap-installer" \
    TIKPAL_MPD_HTTPD_PACKAGE_USE_FILE="$package_use_file" \
    TIKPAL_MPD_CONF="$mpd_conf" \
    "$helper" "$@"
}

printf '%s\n' "media-sound/mpd httpd flac" > "$package_use_file"
run_helper check
[[ ! -s "$log_file" ]] || {
  echo "check must not mutate playback or Portage state" >&2
  exit 1
}

printf '%s\n' "media-sound/mpd alsa" > "$package_use_file"
run_helper enable
snapshot_name="$(sed -n -E 's/^save (tikpal-mpd-httpd-recovery-.+)$/\1/p' "$log_file" | head -n 1)"
[[ -n "$snapshot_name" ]] || {
  echo "enable must save the active MPD queue before restarting it" >&2
  exit 1
}
assert_log_contains "emerge:--oneshot --changed-use media-sound/mpd"
assert_log_contains "tap:install"
assert_log_contains "save $snapshot_name"
assert_log_contains "clear"
assert_log_contains "load $snapshot_name"
assert_log_contains "play"
assert_log_contains "next"
assert_log_contains "seek 0:34"
assert_log_contains "rm $snapshot_name"
grep -Fxq "media-sound/mpd httpd flac" "$package_use_file"

if FAKE_MPD_HTTPD_LOG="$log_file" FAKE_MPD_MODE=missing \
  TIKPAL_MPD_HTTPD_MPD_BIN="$fake_bin/mpd" \
  TIKPAL_MPD_HTTPD_MPC_BIN="$fake_bin/mpc" \
  TIKPAL_MPD_HTTPD_PACKAGE_USE_FILE="$package_use_file" \
  TIKPAL_MPD_CONF="$mpd_conf" \
  "$helper" check >/dev/null 2>&1; then
  echo "check must reject a missing httpd plugin" >&2
  exit 1
fi

: > "$log_file"
if FAKE_MPD_HTTPD_LOG="$log_file" FAKE_MPC_MODE=output-error \
  TIKPAL_MPD_HTTPD_MPD_BIN="$fake_bin/mpd" \
  TIKPAL_MPD_HTTPD_MPC_BIN="$fake_bin/mpc" \
  TIKPAL_MPD_HTTPD_EMERGE_BIN="$fake_bin/emerge" \
  TIKPAL_MPD_HTTPD_SS_BIN="$fake_bin/ss" \
  TIKPAL_MPD_HTTPD_TAP_INSTALLER="$fake_bin/tap-installer" \
  TIKPAL_MPD_HTTPD_PACKAGE_USE_FILE="$package_use_file" \
  TIKPAL_MPD_CONF="$mpd_conf" \
  "$helper" enable >/dev/null 2>&1; then
  echo "enable must stop before Portage changes when the primary output is unavailable" >&2
  exit 1
fi
[[ ! -s "$log_file" ]] || {
  echo "failed primary-output preflight must not mutate MPD state" >&2
  exit 1
}

echo "mpd httpd smoke passed"

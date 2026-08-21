#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
workspace="$(mktemp -d "${TMPDIR:-/tmp}/tikpal-upnp-recognition.XXXXXX")"
trap 'rm -rf "$workspace"' EXIT

fake_bin="$workspace/bin"
mpd_conf="$workspace/mpd.conf"
mpc_log="$workspace/mpc.log"
ffmpeg_log="$workspace/ffmpeg.log"
mpc_state="$workspace/mpc-state"
systemctl_log="$workspace/systemctl.log"
output_path="$workspace/capture.wav"
mkdir -p "$fake_bin"
printf 'disabled\n' > "$mpc_state"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_contains() {
  local file="$1"
  local expected="$2"
  grep -Fq -- "$expected" "$file" || fail "expected $file to contain: $expected"
}

assert_not_exists() {
  [[ ! -e "$1" ]] || fail "expected path to be absent: $1"
}

cat > "$fake_bin/mpd" <<'EOF'
#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\n' 'Music Player Daemon 0.23' 'Output plugins:' ' httpd' '' 'Encoder plugins:' ' flac'
  exit 0
fi
exit 0
EOF

cat > "$fake_bin/mpc" <<'EOF'
#!/bin/sh
state_file="${FAKE_MPC_STATE:?}"
log_file="${FAKE_MPC_LOG:?}"
case "$1" in
  outputs)
    state=$(cat "$state_file")
    printf 'Output 0 (Tikpal Pure Listening) is enabled\n'
    printf 'Output 1 (Tikpal DLNA Recognition Tap) is %s\n' "$state"
    ;;
  enable|disable)
    printf '%s %s\n' "$1" "$2" >> "$log_file"
    printf '%s\n' "$1" | sed 's/enable/enabled/; s/disable/disabled/' > "$state_file"
    ;;
  status)
    exit 0
    ;;
  *)
    printf '%s\n' "$*" >> "$log_file"
    ;;
esac
EOF

cat > "$fake_bin/ffmpeg" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >> "${FAKE_FFMPEG_LOG:?}"
if [ "${FAKE_FFMPEG_FAIL:-0}" = "1" ]; then
  exit 1
fi
last=""
for value in "$@"; do last="$value"; done
printf 'RIFFfake-wav' > "$last"
EOF

cat > "$fake_bin/systemctl" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >> "${FAKE_SYSTEMCTL_LOG:?}"
case "$1" in
  cat) exit 0 ;;
  restart) exit 0 ;;
  *) exit 0 ;;
esac
EOF

cat > "$fake_bin/sudo" <<'EOF'
#!/bin/sh
while [ "$1" = "-n" ]; do shift; done
exec "$@"
EOF
chmod +x "$fake_bin/mpd" "$fake_bin/mpc" "$fake_bin/ffmpeg" "$fake_bin/systemctl" "$fake_bin/sudo"

cat > "$mpd_conf" <<'EOF'
music_directory "/var/lib/mpd/music"

# Tikpal managed MPD audio output: start
audio_output {
        type            "alsa"
        name            "Tikpal Pure Listening"
        device          "hw:0,0"
}
# Tikpal managed MPD audio output: end
EOF

test_env=(
  "PATH=$fake_bin:$PATH"
  "FAKE_MPC_STATE=$mpc_state"
  "FAKE_MPC_LOG=$mpc_log"
  "FAKE_FFMPEG_LOG=$ffmpeg_log"
  "FAKE_SYSTEMCTL_LOG=$systemctl_log"
  "TIKPAL_MPD_CONF=$mpd_conf"
  "TIKPAL_UPNP_CAPTURE_MPD_BIN=mpd"
  "TIKPAL_UPNP_CAPTURE_MPC_BIN=mpc"
  "TIKPAL_UPNP_CAPTURE_FFMPEG_BIN=ffmpeg"
  "TIKPAL_UPNP_CAPTURE_SYSTEMCTL_BIN=systemctl"
)

env "${test_env[@]}" "$repo_root/deploy/moode/tikpal-upnp-capture-install.sh" install
assert_contains "$mpd_conf" '# Tikpal DLNA recognition tap: start'
assert_contains "$mpd_conf" 'type            "httpd"'
assert_contains "$mpd_conf" 'encoder         "flac"'
assert_contains "$mpd_conf" 'bind_to_address "127.0.0.1"'
assert_contains "$mpd_conf" 'enabled         "no"'
assert_contains "$mpd_conf" 'always_on       "no"'
profile_end_line="$(grep -n -F '# Tikpal managed MPD audio output: end' "$mpd_conf" | cut -d: -f1)"
tap_start_line="$(grep -n -F '# Tikpal DLNA recognition tap: start' "$mpd_conf" | cut -d: -f1)"
(( tap_start_line > profile_end_line )) || fail 'recognition tap was written into the managed MPD profile block'
[[ "$(grep -Fc 'restart mpd.service' "$systemctl_log")" -eq 1 ]] || fail 'first recognition-tap install must restart MPD exactly once'
assert_contains "$mpc_log" 'disable 1'
[[ "$(cat "$mpc_state")" == 'disabled' ]] || fail 'recognition tap must be disabled after install'

: > "$mpc_log"
env "${test_env[@]}" "$repo_root/deploy/moode/tikpal-upnp-capture.sh" "$output_path" 6
[[ -s "$output_path" ]] || fail 'successful DLNA capture did not produce a WAV file'
assert_contains "$mpc_log" 'enable 1'
assert_contains "$mpc_log" 'disable 1'
assert_contains "$ffmpeg_log" '-i http://127.0.0.1:8001/'
[[ "$(cat "$mpc_state")" == 'disabled' ]] || fail 'successful DLNA capture did not restore the tap to disabled'

rm -f "$output_path" "${output_path}.part"
: > "$mpc_log"
if env FAKE_FFMPEG_FAIL=1 "${test_env[@]}" "$repo_root/deploy/moode/tikpal-upnp-capture.sh" "$output_path" 6; then
  fail 'failed ffmpeg capture unexpectedly succeeded'
fi
assert_not_exists "$output_path"
assert_not_exists "${output_path}.part"
assert_contains "$mpc_log" 'enable 1'
assert_contains "$mpc_log" 'disable 1'
[[ "$(cat "$mpc_state")" == 'disabled' ]] || fail 'failed DLNA capture did not restore the tap to disabled'

echo 'UPnP recognition smoke passed.'

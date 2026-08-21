#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 2 ]]; then
  echo "usage: $0 <output-wav-path> <duration-seconds>" >&2
  exit 64
fi

output_path="$1"
duration_seconds="$2"
mpc_bin="${TIKPAL_UPNP_CAPTURE_MPC_BIN:-mpc}"
ffmpeg_bin="${TIKPAL_UPNP_CAPTURE_FFMPEG_BIN:-ffmpeg}"
output_name="${TIKPAL_UPNP_CAPTURE_OUTPUT_NAME:-Tikpal DLNA Recognition Tap}"
capture_url="${TIKPAL_UPNP_CAPTURE_URL:-http://127.0.0.1:8001/}"
tmp_path="${output_path}.part"

if ! [[ "$duration_seconds" =~ ^[1-9][0-9]*$ ]]; then
  echo "DLNA capture duration must be a positive whole number of seconds" >&2
  exit 64
fi

if [[ ! "$capture_url" =~ ^http://127\.0\.0\.1:[0-9]+/?$ ]]; then
  echo "DLNA capture URL must bind to 127.0.0.1" >&2
  exit 64
fi

command -v "$mpc_bin" >/dev/null 2>&1 || {
  echo "DLNA capture requires mpc" >&2
  exit 127
}
command -v "$ffmpeg_bin" >/dev/null 2>&1 || {
  echo "DLNA capture requires ffmpeg" >&2
  exit 127
}

tap_output_id="$($mpc_bin outputs | awk -v name="$output_name" '
  /^Output [0-9]+ \(/ {
    line = $0
    sub(/^Output /, "", line)
    id = line
    sub(/ .*/, "", id)
    label = $0
    sub(/^Output [0-9]+ \(/, "", label)
    sub(/\) is .*/, "", label)
    if (label == name) {
      print id
      exit
    }
  }
')"

if [[ ! "$tap_output_id" =~ ^[0-9]+$ ]]; then
  echo "DLNA capture output is not installed: $output_name" >&2
  exit 1
fi

cleanup() {
  "$mpc_bin" disable "$tap_output_id" >/dev/null 2>&1 || true
  rm -f "$tmp_path"
}
trap cleanup EXIT INT TERM

rm -f "$tmp_path"
"$mpc_bin" enable "$tap_output_id"
"$ffmpeg_bin" -nostdin -hide_banner -loglevel error -y \
  -i "$capture_url" \
  -t "$duration_seconds" \
  -vn \
  -ac 2 \
  -ar 44100 \
  -c:a pcm_s16le \
  "$tmp_path"

[[ -s "$tmp_path" ]] || {
  echo "DLNA capture returned no audio" >&2
  exit 1
}

mv "$tmp_path" "$output_path"

#!/bin/sh
set -eu

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <output-wav-path> <duration-seconds>" >&2
  exit 64
fi

output_path="$1"
duration_seconds="$2"
ffmpeg_bin="${TIKPAL_FFMPEG_BIN:-ffmpeg}"
capture_device="${TIKPAL_BLUETOOTH_CAPTURE_DEVICE:-}"
loopback_device="${TIKPAL_BLUETOOTH_LOOPBACK_DEVICE:-plughw:Loopback,1}"

if [ "${TIKPAL_BLUETOOTH_CAPTURE_MOCK:-0}" = "1" ]; then
  if [ -n "${TIKPAL_BLUETOOTH_CAPTURE_MOCK_FILE:-}" ] && [ -f "${TIKPAL_BLUETOOTH_CAPTURE_MOCK_FILE:-}" ]; then
    mock_text="$(cat "${TIKPAL_BLUETOOTH_CAPTURE_MOCK_FILE}")"
  else
    mock_text="${TIKPAL_BLUETOOTH_CAPTURE_MOCK_TEXT:-BT_SUCCESS}"
  fi
  printf '%s\n' "$mock_text" >"$output_path"
  exit 0
fi

connected_mac="$(bluetoothctl devices Connected 2>/dev/null | awk 'NR==1 {print $2}')"

candidate_devices=""
if [ -n "$capture_device" ]; then
  candidate_devices="$capture_device"
fi
if [ -n "$loopback_device" ]; then
  candidate_devices="${candidate_devices}
${loopback_device}
hw:Loopback,1"
fi
if [ -n "$connected_mac" ]; then
  candidate_devices="${candidate_devices}
bluealsa:DEV=${connected_mac},PROFILE=a2dp
bluealsa:SRV=org.bluealsa,DEV=${connected_mac},PROFILE=a2dp
bluealsa:DEV=${connected_mac}"
fi
if [ -z "$candidate_devices" ]; then
  candidate_devices="bluealsa"
fi

tmp_path="${output_path}.part"
rm -f "$tmp_path"

capture_with_ffmpeg() {
  device="$1"
  case "$device" in
    bluealsa:*)
      return 1
      ;;
  esac
  "$ffmpeg_bin" -hide_banner -loglevel error -y \
    -f alsa \
    -ac 2 \
    -ar 44100 \
    -i "$device" \
    -t "$duration_seconds" \
    -vn \
    "$tmp_path"
}

capture_with_arecord() {
  device="$1"
  channels=2
  sample_rate=44100
  case "$device" in
    bluealsa:*|*Loopback*)
      channels=2
      sample_rate=44100
      ;;
    *)
      channels=1
      sample_rate=16000
      ;;
  esac
  arecord -q \
    -D "$device" \
    -f S16_LE \
    -c "$channels" \
    -r "$sample_rate" \
    -d "$duration_seconds" \
    "$tmp_path"
}

for device in $candidate_devices; do
  if command -v "$ffmpeg_bin" >/dev/null 2>&1 && capture_with_ffmpeg "$device"; then
    mv "$tmp_path" "$output_path"
    exit 0
  fi

  rm -f "$tmp_path"

  if command -v arecord >/dev/null 2>&1 && capture_with_arecord "$device"; then
    mv "$tmp_path" "$output_path"
    exit 0
  fi

  rm -f "$tmp_path"
done

echo "Bluetooth capture failed: no readable BlueALSA/ALSA input device was found" >&2
exit 1

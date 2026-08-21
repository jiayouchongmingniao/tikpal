#!/usr/bin/env bash
set -euo pipefail

mode="${1:-install}"
mpd_conf="${TIKPAL_MPD_CONF:-/etc/mpd.conf}"
mpd_bin="${TIKPAL_UPNP_CAPTURE_MPD_BIN:-mpd}"
mpc_bin="${TIKPAL_UPNP_CAPTURE_MPC_BIN:-mpc}"
ffmpeg_bin="${TIKPAL_UPNP_CAPTURE_FFMPEG_BIN:-ffmpeg}"
systemctl_bin="${TIKPAL_UPNP_CAPTURE_SYSTEMCTL_BIN:-systemctl}"
output_name="${TIKPAL_UPNP_CAPTURE_OUTPUT_NAME:-Tikpal DLNA Recognition Tap}"
capture_host="${TIKPAL_UPNP_CAPTURE_BIND_ADDRESS:-127.0.0.1}"
capture_port="${TIKPAL_UPNP_CAPTURE_PORT:-8001}"
marker_start="# Tikpal DLNA recognition tap: start"
marker_end="# Tikpal DLNA recognition tap: end"
profile_marker_start="# Tikpal managed MPD audio output: start"
profile_marker_end="# Tikpal managed MPD audio output: end"

usage() {
  echo "usage: $0 [install|check]" >&2
}

run_root() {
  if [[ "$(id -u)" == "0" ]]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo -n "$@"
  else
    "$@"
  fi
}

mpd_unit() {
  if "$systemctl_bin" cat mpd.service >/dev/null 2>&1; then
    printf 'mpd.service\n'
  else
    printf 'mpd\n'
  fi
}

tap_output_id() {
  "$mpc_bin" outputs | awk -v name="$output_name" '
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
  '
}

validate_dependencies() {
  command -v "$mpd_bin" >/dev/null 2>&1 || {
    echo "UPnP recognition tap requires mpd" >&2
    return 1
  }
  command -v "$mpc_bin" >/dev/null 2>&1 || {
    echo "UPnP recognition tap requires mpc" >&2
    return 1
  }
  command -v "$ffmpeg_bin" >/dev/null 2>&1 || {
    echo "UPnP recognition tap requires ffmpeg" >&2
    return 1
  }
  "$mpd_bin" --version 2>/dev/null | grep -qi 'httpd' || {
    echo "UPnP recognition tap requires MPD's httpd output plugin" >&2
    return 1
  }
  "$mpd_bin" --version 2>/dev/null | awk '
    /^Encoder plugins:/ { in_encoders=1; next }
    in_encoders && /^$/ { exit }
    in_encoders { print }
  ' | grep -qw 'flac' || {
    echo "UPnP recognition tap requires MPD's flac encoder" >&2
    return 1
  }
}

validate_config() {
  [[ -f "$mpd_conf" ]] || {
    echo "MPD config not found: $mpd_conf" >&2
    return 1
  }
  [[ "$capture_host" == "127.0.0.1" ]] || {
    echo "UPnP recognition tap may only bind 127.0.0.1" >&2
    return 1
  }
  [[ "$capture_port" =~ ^[1-9][0-9]*$ ]] && (( capture_port <= 65535 )) || {
    echo "UPnP recognition tap port must be valid" >&2
    return 1
  }

  local profile_start profile_end tap_start tap_end
  profile_start="$(grep -n -F "$profile_marker_start" "$mpd_conf" | head -n 1 | cut -d: -f1 || true)"
  profile_end="$(grep -n -F "$profile_marker_end" "$mpd_conf" | head -n 1 | cut -d: -f1 || true)"
  tap_start="$(grep -n -F "$marker_start" "$mpd_conf" | head -n 1 | cut -d: -f1 || true)"
  tap_end="$(grep -n -F "$marker_end" "$mpd_conf" | head -n 1 | cut -d: -f1 || true)"

  if [[ -n "$profile_start" || -n "$profile_end" ]]; then
    [[ -n "$profile_start" && -n "$profile_end" && "$profile_start" -lt "$profile_end" ]] || {
      echo "MPD audio profile marker is malformed" >&2
      return 1
    }
  fi
  if [[ -n "$tap_start" || -n "$tap_end" ]]; then
    [[ -n "$tap_start" && -n "$tap_end" && "$tap_start" -lt "$tap_end" ]] || {
      echo "UPnP recognition tap marker is malformed" >&2
      return 1
    }
    if [[ -n "$profile_start" ]] && (( tap_start > profile_start && tap_end < profile_end )); then
      echo "UPnP recognition tap must not be nested in the managed audio profile" >&2
      return 1
    fi
  fi

  if grep -F "port            \"$capture_port\"" "$mpd_conf" | grep -Fv "$marker_start" >/dev/null 2>&1 && [[ -z "$tap_start" ]]; then
    echo "MPD HTTP port $capture_port is already configured" >&2
    return 1
  fi
}

build_block() {
  cat <<EOF
$marker_start
audio_output {
        type            "httpd"
        name            "$output_name"
        encoder         "flac"
        bind_to_address "$capture_host"
        port            "$capture_port"
        format          "44100:16:2"
        enabled         "no"
        always_on       "no"
}
$marker_end
EOF
}

write_block() {
  local tmp_file
  tmp_file="$(mktemp)"
  if grep -Fq "$marker_start" "$mpd_conf"; then
    awk -v start="$marker_start" -v end="$marker_end" '
      $0 == start { skip=1; next }
      $0 == end { skip=0; next }
      skip != 1 { print }
    ' "$mpd_conf" > "$tmp_file"
  else
    cp "$mpd_conf" "$tmp_file"
  fi
  {
    sed -e '${/^$/d;}' "$tmp_file"
    printf '\n\n'
    build_block
  } > "${tmp_file}.next"
  run_root install -m 0644 "${tmp_file}.next" "$mpd_conf"
  rm -f "$tmp_file" "${tmp_file}.next"
}

check_runtime_output() {
  local output_id
  output_id="$(tap_output_id)"
  [[ "$output_id" =~ ^[0-9]+$ ]] || {
    echo "MPD did not expose the UPnP recognition tap" >&2
    return 1
  }
  "$mpc_bin" disable "$output_id"
}

install_tap() {
  validate_dependencies
  validate_config

  if grep -Fq "$marker_start" "$mpd_conf"; then
    check_runtime_output
    printf 'UPnP recognition tap is already installed\n'
    return
  fi

  local backup_file unit
  backup_file="${mpd_conf}.tikpal-upnp-capture-$(date +%Y%m%d%H%M%S).bak"
  run_root cp -p "$mpd_conf" "$backup_file"
  write_block
  unit="$(mpd_unit)"
  if ! run_root "$systemctl_bin" restart "$unit" || ! check_runtime_output; then
    echo "UPnP recognition tap activation failed; restoring MPD config" >&2
    run_root install -m 0644 "$backup_file" "$mpd_conf"
    run_root "$systemctl_bin" restart "$unit" || true
    return 1
  fi
  printf 'UPnP recognition tap installed\n'
}

case "$mode" in
  check)
    validate_dependencies
    validate_config
    grep -Fq "$marker_start" "$mpd_conf" || {
      echo "UPnP recognition tap is not installed" >&2
      exit 1
    }
    check_runtime_output
    ;;
  install)
    install_tap
    ;;
  *)
    usage
    exit 64
    ;;
esac

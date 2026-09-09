#!/usr/bin/env bash
set -euo pipefail

mode="${1:-check}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
app_dir="${TIKPAL_APP_DIR:-$(cd "$script_dir/../.." && pwd)}"
package_use_file="${TIKPAL_MPD_HTTPD_PACKAGE_USE_FILE:-/etc/portage/package.use/tikpal-mpd}"
mpd_bin="${TIKPAL_MPD_HTTPD_MPD_BIN:-mpd}"
mpc_bin="${TIKPAL_MPD_HTTPD_MPC_BIN:-mpc}"
emerge_bin="${TIKPAL_MPD_HTTPD_EMERGE_BIN:-emerge}"
ss_bin="${TIKPAL_MPD_HTTPD_SS_BIN:-ss}"
tap_installer="${TIKPAL_MPD_HTTPD_TAP_INSTALLER:-$app_dir/deploy/moode/tikpal-upnp-capture-install.sh}"
mpd_conf="${TIKPAL_MPD_CONF:-/etc/mpd.conf}"
tap_name="${TIKPAL_UPNP_CAPTURE_OUTPUT_NAME:-Tikpal DLNA Recognition Tap}"
tap_port="${TIKPAL_UPNP_CAPTURE_PORT:-8001}"
tap_marker="# Tikpal DLNA recognition tap: start"

snapshot_playlist=""
snapshot_state="stopped"
snapshot_position=""
snapshot_elapsed=""
snapshot_repeat="off"
snapshot_random="off"
snapshot_single="off"
snapshot_consume="off"
snapshot_volume=""

usage() {
  echo "usage: $0 [check|enable]" >&2
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "required command is unavailable: $1" >&2
    exit 127
  }
}

has_httpd_plugin() {
  "$mpd_bin" --version 2>/dev/null | awk '
    /^Output plugins:/ { in_outputs=1; next }
    in_outputs && /^$/ { exit }
    in_outputs { print }
  ' | grep -qw httpd
}

has_flac_encoder() {
  "$mpd_bin" --version 2>/dev/null | awk '
    /^Encoder plugins:/ { in_encoders=1; next }
    in_encoders && /^$/ { exit }
    in_encoders { print }
  ' | grep -qw flac
}

tap_output_state() {
  "$mpc_bin" outputs | awk -v name="$tap_name" '
    /^Output [0-9]+ \(/ {
      label = $0
      sub(/^Output [0-9]+ \(/, "", label)
      sub(/\) is .*/, "", label)
      if (label == name) {
        if ($0 ~ /\) is enabled/) print "enabled"
        if ($0 ~ /\) is disabled/) print "disabled"
        exit
      }
    }
  '
}

assert_plugins() {
  has_httpd_plugin || {
    echo "MPD is missing the httpd output plugin; enable media-sound/mpd httpd" >&2
    return 1
  }
  has_flac_encoder || {
    echo "MPD is missing the flac encoder; enable media-sound/mpd flac" >&2
    return 1
  }
}

assert_idle_tap() {
  [[ -f "$mpd_conf" ]] && grep -Fq "$tap_marker" "$mpd_conf" || {
    echo "UPnP recognition tap is not configured in $mpd_conf" >&2
    return 1
  }
  [[ "$(tap_output_state)" == "disabled" ]] || {
    echo "UPnP recognition tap must be present and disabled at rest" >&2
    return 1
  }
  require_command "$ss_bin"
  if "$ss_bin" -ltn "( sport = :$tap_port )" | grep -q LISTEN; then
    echo "UPnP recognition tap port $tap_port must not listen while disabled" >&2
    return 1
  fi
}

assert_primary_playback_ready() {
  local status
  status="$("$mpc_bin" status 2>&1 || true)"
  if printf '%s\n' "$status" | grep -q '^ERROR: Failed to open '; then
    echo "refusing MPD maintenance while the primary playback output is unavailable" >&2
    return 1
  fi
}

write_package_use() {
  local target_dir temporary_file backup_file
  target_dir="$(dirname "$package_use_file")"
  mkdir -p "$target_dir"
  if [[ -f "$package_use_file" ]] && grep -Fxq "media-sound/mpd httpd flac" "$package_use_file"; then
    return 0
  fi
  if [[ -f "$package_use_file" ]]; then
    backup_file="${package_use_file}.tikpal-mpd-httpd-$(date +%Y%m%d%H%M%S).bak"
    cp -p "$package_use_file" "$backup_file"
  fi
  temporary_file="$(mktemp "$target_dir/.tikpal-mpd.XXXXXX")"
  printf '%s\n' "media-sound/mpd httpd flac" > "$temporary_file"
  install -m 0644 "$temporary_file" "$package_use_file"
  rm -f "$temporary_file"
}

status_value() {
  local status="$1"
  local key="$2"
  printf '%s\n' "$status" | sed -n -E "s/.*${key}:[[:space:]]*([^[:space:]]+).*/\\1/p" | tail -n 1
}

snapshot_playback() {
  local queue status status_line time_fragment
  queue="$("$mpc_bin" playlist)"
  [[ -n "$queue" ]] || return 0

  snapshot_playlist="tikpal-mpd-httpd-recovery-$(date +%Y%m%d%H%M%S)-$$"
  "$mpc_bin" rm "$snapshot_playlist" >/dev/null 2>&1 || true
  "$mpc_bin" save "$snapshot_playlist"

  status="$("$mpc_bin" status)"
  status_line="$(printf '%s\n' "$status" | sed -n -E '/^\[(playing|paused|stopped)\]/p' | head -n 1)"
  snapshot_state="$(printf '%s\n' "$status_line" | sed -n -E 's/^\[(playing|paused|stopped)\].*/\1/p')"
  snapshot_state="${snapshot_state:-stopped}"
  snapshot_position="$(printf '%s\n' "$status_line" | sed -n -E 's/^\[[^]]+\][[:space:]]*#([0-9]+)\/.*/\1/p')"
  time_fragment="$(printf '%s\n' "$status_line" | grep -o -E '([0-9]+:)?[0-9]{1,2}:[0-9]{2}' | head -n 1 || true)"
  snapshot_elapsed="${time_fragment:-00:00:00}"
  snapshot_repeat="$(status_value "$status" repeat)"
  snapshot_random="$(status_value "$status" random)"
  snapshot_single="$(status_value "$status" single)"
  snapshot_consume="$(status_value "$status" consume)"
  snapshot_volume="$(printf '%s\n' "$status" | sed -n -E 's/^volume:[[:space:]]*([0-9]+)%.*/\1/p' | head -n 1)"
}

restore_playback() {
  local step
  [[ -n "$snapshot_playlist" ]] || return 0

  "$mpc_bin" clear
  "$mpc_bin" load "$snapshot_playlist"
  "$mpc_bin" repeat off
  "$mpc_bin" random off
  "$mpc_bin" single off
  "$mpc_bin" consume off

  if [[ "$snapshot_state" == "playing" || "$snapshot_state" == "paused" ]]; then
    "$mpc_bin" play
    if [[ "$snapshot_position" =~ ^[1-9][0-9]*$ ]]; then
      for ((step = 1; step < snapshot_position; step += 1)); do
        "$mpc_bin" next
      done
    fi
    "$mpc_bin" seek "$snapshot_elapsed"
    [[ "$snapshot_state" != "paused" ]] || "$mpc_bin" pause
  else
    "$mpc_bin" stop
  fi

  "$mpc_bin" repeat "${snapshot_repeat:-off}"
  "$mpc_bin" random "${snapshot_random:-off}"
  "$mpc_bin" single "${snapshot_single:-off}"
  "$mpc_bin" consume "${snapshot_consume:-off}"
  [[ -z "$snapshot_volume" ]] || "$mpc_bin" volume "$snapshot_volume"
  "$mpc_bin" rm "$snapshot_playlist"
  snapshot_playlist=""
}

check() {
  assert_plugins
  [[ -f "$package_use_file" ]] && grep -Fxq "media-sound/mpd httpd flac" "$package_use_file" || {
    echo "MPD USE configuration is missing from $package_use_file" >&2
    return 1
  }
  assert_idle_tap
}

enable() {
  require_command "$emerge_bin"
  require_command "$mpc_bin"
  [[ -x "$tap_installer" ]] || {
    echo "UPnP recognition tap installer is unavailable: $tap_installer" >&2
    return 1
  }
  assert_primary_playback_ready
  write_package_use
  "$emerge_bin" --oneshot --changed-use media-sound/mpd
  assert_plugins
  snapshot_playback
  if ! "$tap_installer" install; then
    restore_playback || true
    return 1
  fi
  assert_idle_tap
  restore_playback
  assert_idle_tap
}

case "$mode" in
  check)
    check
    ;;
  enable)
    enable
    ;;
  -h|--help)
    usage
    ;;
  *)
    usage
    exit 64
    ;;
esac

#!/usr/bin/env bash
set -euo pipefail

profile="${1:-status}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mpd_conf="${TIKPAL_MPD_CONF:-/etc/mpd.conf}"
mpd_music_directory="${TIKPAL_MPD_MUSIC_ROOT:-/var/lib/mpd/music}"
mpd_database_file="${TIKPAL_MPD_DATABASE_FILE:-/var/lib/mpd/database}"
mpd_playlist_directory="${TIKPAL_MPD_PLAYLIST_DIRECTORY:-/var/lib/mpd/playlists}"
standard_device="${TIKPAL_MPD_STANDARD_ALSA_DEVICE:-_audioout}"
pure_path="${TIKPAL_MPD_PURE_PATH:-unknown}"
pure_target_rate="${TIKPAL_MPD_PURE_TARGET_RATE:-48000}"
resampler_plugin="${TIKPAL_MPD_RESAMPLER_PLUGIN:-soxr}"
resampler_quality="${TIKPAL_MPD_RESAMPLER_QUALITY:-high}"
resampler_threads="${TIKPAL_MPD_RESAMPLER_THREADS:-0}"
mpd_bin="${TIKPAL_MPD_BIN:-mpd}"
sleep_rate="${TIKPAL_MPD_SLEEP_SAMPLE_RATE:-48000}"
sleep_volume_limit="${TIKPAL_MPD_SLEEP_VOLUME_LIMIT:-45}"
mpc_timeout_seconds="${TIKPAL_MPC_TIMEOUT_SECONDS:-1}"
mpd_stop_timeout_seconds="${TIKPAL_MPD_STOP_TIMEOUT_SECONDS:-2}"
mpd_start_timeout_seconds="${TIKPAL_MPD_START_TIMEOUT_SECONDS:-5}"
mpd_restart_on_profile_write="${TIKPAL_MPD_RESTART_ON_PROFILE_WRITE:-1}"
custom_device="${TIKPAL_MPD_CUSTOM_ALSA_DEVICE:-$standard_device}"
custom_name="${TIKPAL_MPD_CUSTOM_OUTPUT_NAME:-Tikpal Custom}"
custom_mixer_type="${TIKPAL_MPD_CUSTOM_MIXER_TYPE:-}"
custom_replay_gain_handler="${TIKPAL_MPD_CUSTOM_REPLAY_GAIN_HANDLER:-}"
custom_format="${TIKPAL_MPD_CUSTOM_FORMAT:-}"
custom_fixed_sample_rate="${TIKPAL_MPD_CUSTOM_FIXED_SAMPLE_RATE:-48000}"
custom_replaygain="${TIKPAL_MPD_CUSTOM_REPLAYGAIN:-}"
custom_crossfade="${TIKPAL_MPD_CUSTOM_CROSSFADE:-}"
marker_start="# Tikpal managed MPD audio output: start"
marker_end="# Tikpal managed MPD audio output: end"
src_marker_start="# Tikpal managed MPD resampler: start"
src_marker_end="# Tikpal managed MPD resampler: end"
library_marker_start="# Tikpal managed MPD library: start"
library_marker_end="# Tikpal managed MPD library: end"

validate_library_path() {
  local value="$1"
  [[ "$value" == /* && "$value" != *$'\n'* && "$value" != *'"'* ]] || {
    printf 'MPD library paths must be absolute and must not contain quotes or newlines\n' >&2
    return 1
  }
}

build_library_block() {
  validate_library_path "$mpd_music_directory"
  validate_library_path "$mpd_database_file"
  validate_library_path "$mpd_playlist_directory"
  printf '%s\n' "$library_marker_start"
  printf 'music_directory "%s"\n' "$mpd_music_directory"
  printf 'db_file "%s"\n' "$mpd_database_file"
  printf 'playlist_directory "%s"\n' "$mpd_playlist_directory"
  printf 'follow_inside_symlinks "yes"\n'
  printf 'follow_outside_symlinks "yes"\n'
  printf '%s\n' "$library_marker_end"
}

write_library_config() {
  [[ -f "$mpd_conf" ]] || { printf '%s not found\n' "$mpd_conf" >&2; exit 66; }

  local tmp_file backup_file
  tmp_file="$(mktemp)"
  if grep -Fq "$library_marker_start" "$mpd_conf"; then
    awk -v start="$library_marker_start" -v end="$library_marker_end" '
      $0 == start { skip=1; next }
      $0 == end { skip=0; next }
      skip != 1 { print }
    ' "$mpd_conf" > "$tmp_file"
  else
    cp "$mpd_conf" "$tmp_file"
  fi

  {
    sed -e '${/^$/d;}' "$tmp_file"
    printf '\n'
    build_library_block
  } > "${tmp_file}.next"

  if cmp -s "${tmp_file}.next" "$mpd_conf"; then
    rm -f "$tmp_file" "${tmp_file}.next"
    printf 'libraryManaged=1\n'
    return 0
  fi

  backup_file="${mpd_conf}.tikpal-library-$(date +%Y%m%d%H%M%S).bak"
  cp -p "$mpd_conf" "$backup_file"
  if [[ "$(id -u)" == "0" ]]; then
    install -m 0644 "${tmp_file}.next" "$mpd_conf"
  else
    sudo -n install -m 0644 "${tmp_file}.next" "$mpd_conf"
  fi
  rm -f "$tmp_file" "${tmp_file}.next"
  printf 'libraryManaged=1\n'
}

env_enabled() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on|enabled) return 0 ;;
    *) return 1 ;;
  esac
}

profile_restart_enabled() {
  env_enabled "$mpd_restart_on_profile_write"
}

run_with_timeout() {
  local seconds="$1"
  shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$seconds" "$@"
  else
    "$@"
  fi
}

run_systemctl() {
  local seconds="$1"
  shift
  if [[ "$(id -u)" == "0" ]]; then
    run_with_timeout "$seconds" systemctl "$@"
  else
    run_with_timeout "$seconds" sudo -n systemctl "$@"
  fi
}

run_mpc() {
  command -v mpc >/dev/null 2>&1 || return 127
  run_with_timeout "$mpc_timeout_seconds" mpc "$@"
}

normalize_profile() {
  case "${1:-}" in
    pure|bit-perfect|bit_perfect|bitperfect|strict) printf 'pure\n' ;;
    everyday|standard) printf 'everyday\n' ;;
    sleep|meditation|sleep-meditation|sleep_meditation) printf 'sleep\n' ;;
    custom|user|manual) printf 'custom\n' ;;
    *) return 1 ;;
  esac
}

detect_pure_device() {
  local audio_adapt_bin="${TIKPAL_AUDIO_ADAPT_BIN:-}"
  if [[ -z "$audio_adapt_bin" && -x "$script_dir/tikpal-audio-adapt.sh" ]]; then
    audio_adapt_bin="$script_dir/tikpal-audio-adapt.sh"
  elif [[ -z "$audio_adapt_bin" && -x "$script_dir/tikpal-audio-adapt" ]]; then
    audio_adapt_bin="$script_dir/tikpal-audio-adapt"
  elif [[ -z "$audio_adapt_bin" && -x /usr/local/sbin/tikpal-audio-adapt ]]; then
    audio_adapt_bin=/usr/local/sbin/tikpal-audio-adapt
  fi
  [[ -n "$audio_adapt_bin" && -x "$audio_adapt_bin" ]] || {
    printf 'Tikpal audio resolver was not found; set TIKPAL_AUDIO_ADAPT_BIN\n' >&2
    return 1
  }
  "$audio_adapt_bin" resolve-hw
}

build_block() {
  local selected_profile="$1"
  local device="$standard_device"
  local output_name="Tikpal Everyday"
  local mixer_type="software"
  local replay_gain_handler="software"
  local format_line=""
  local option_lines=""

  case "$selected_profile" in
    pure)
      case "$pure_path" in
        native|resampled|unknown) ;;
        *) printf 'invalid TIKPAL_MPD_PURE_PATH=%s\n' "$pure_path" >&2; return 1 ;;
      esac
      device="$(detect_pure_device)"
      output_name="Tikpal Pure Listening"
      mixer_type="none"
      replay_gain_handler="none"
      if [[ "$pure_path" == "resampled" ]]; then
        [[ "$pure_target_rate" =~ ^[1-9][0-9]*$ ]] || {
          printf 'invalid TIKPAL_MPD_PURE_TARGET_RATE=%s\n' "$pure_target_rate" >&2
          return 1
        }
        format_line="        format          \"${pure_target_rate}:16:2\""
      fi
      ;;
    sleep)
      output_name="Tikpal Sleep Meditation"
      format_line="        format          \"${sleep_rate}:*:*\""
      ;;
    custom)
      local custom_pure_direct="${TIKPAL_MPD_CUSTOM_PURE_DIRECT:-0}"
      local custom_volume_normalization="${TIKPAL_MPD_CUSTOM_VOLUME_NORMALIZATION:-1}"
      local custom_automatic_sample_rate="${TIKPAL_MPD_CUSTOM_AUTOMATIC_SAMPLE_RATE:-1}"
      local custom_dsd_mode="${TIKPAL_MPD_CUSTOM_DSD_MODE:-0}"
      local custom_playback_stability="${TIKPAL_MPD_CUSTOM_PLAYBACK_STABILITY:-1}"

      device="$custom_device"
      output_name="$custom_name"
      if env_enabled "$custom_pure_direct"; then
        device="$(detect_pure_device)"
        mixer_type="none"
        replay_gain_handler="none"
      else
        mixer_type="software"
        if env_enabled "$custom_volume_normalization"; then
          replay_gain_handler="software"
        else
          replay_gain_handler="none"
        fi
      fi
      if [[ -n "$custom_mixer_type" ]]; then
        mixer_type="$custom_mixer_type"
      fi
      if [[ -n "$custom_replay_gain_handler" ]]; then
        replay_gain_handler="$custom_replay_gain_handler"
      fi
      if [[ -n "$custom_format" ]]; then
        format_line="        format          \"${custom_format}\""
      elif ! env_enabled "$custom_automatic_sample_rate"; then
        format_line="        format          \"${custom_fixed_sample_rate}:*:*\""
      fi
      if env_enabled "$custom_dsd_mode"; then
        option_lines="${option_lines}        dop             \"yes\"\n"
      fi
      if env_enabled "$custom_playback_stability"; then
        option_lines="${option_lines}        buffer_time     \"500000\"\n        period_time     \"125000\"\n"
      fi
      ;;
  esac

  cat <<EOF
$marker_start
audio_output {
        type            "alsa"
        name            "$output_name"
        device          "$device"
        mixer_type      "$mixer_type"
        replay_gain_handler "$replay_gain_handler"
${format_line}
$(printf '%b' "$option_lines")
}
$marker_end
EOF
}

validate_src_settings() {
  [[ "$resampler_plugin" =~ ^[A-Za-z0-9_-]+$ ]] || {
    printf 'invalid TIKPAL_MPD_RESAMPLER_PLUGIN=%s\n' "$resampler_plugin" >&2
    return 1
  }
  [[ "$resampler_quality" =~ ^[A-Za-z0-9_-]+([[:space:]][A-Za-z0-9_-]+)*$ ]] || {
    printf 'invalid TIKPAL_MPD_RESAMPLER_QUALITY=%s\n' "$resampler_quality" >&2
    return 1
  }
  [[ "$resampler_threads" =~ ^[0-9]+$ ]] || {
    printf 'invalid TIKPAL_MPD_RESAMPLER_THREADS=%s\n' "$resampler_threads" >&2
    return 1
  }
}

build_resampler_block() {
  validate_src_settings
  cat <<EOF
$src_marker_start
resampler {
        plugin          "$resampler_plugin"
EOF
  if [[ "$resampler_plugin" == "soxr" ]]; then
    printf '        quality         "%s"\n' "$resampler_quality"
    printf '        threads         "%s"\n' "$resampler_threads"
  fi
  printf '%s\n%s\n' '}' "$src_marker_end"
}

print_resampler_block() {
  [[ -f "$mpd_conf" ]] || return 0
  awk -v start="$src_marker_start" -v end="$src_marker_end" '
    $0 == start { show=1 }
    show == 1 { print }
    $0 == end { show=0 }
  ' "$mpd_conf" 2>/dev/null || true
}

src_check() {
  [[ -f "$mpd_conf" ]] || { printf '%s not found\n' "$mpd_conf" >&2; return 66; }
  validate_src_settings
  local expected actual version
  expected="$(mktemp)"
  actual="$(mktemp)"
  build_resampler_block >"$expected"
  print_resampler_block >"$actual"
  if ! cmp -s "$expected" "$actual"; then
    printf 'managed MPD resampler block does not match requested settings\n' >&2
    rm -f "$expected" "$actual"
    return 1
  fi
  rm -f "$expected" "$actual"

  command -v "$mpd_bin" >/dev/null 2>&1 || {
    printf '%s was not found\n' "$mpd_bin" >&2
    return 127
  }
  version="$("$mpd_bin" --version 2>&1 || true)"
  if ! grep -Eq "(^|[[:space:]])${resampler_plugin}([[:space:]]|$)" <<<"$version"; then
    printf 'MPD does not list resampler plugin %s\n' "$resampler_plugin" >&2
    return 1
  fi
  printf 'srcPlugin=%s\n' "$resampler_plugin"
  if [[ "$resampler_plugin" == "soxr" ]]; then
    printf 'srcQuality=%s\n' "$resampler_quality"
    printf 'srcThreads=%s\n' "$resampler_threads"
  fi
  printf 'srcManaged=1\n'
}

write_src() {
  [[ -f "$mpd_conf" ]] || { printf '%s not found\n' "$mpd_conf" >&2; exit 66; }
  validate_src_settings

  local tmp_file backup_file
  tmp_file="$(mktemp)"
  if grep -Fq "$src_marker_start" "$mpd_conf"; then
    awk -v start="$src_marker_start" -v end="$src_marker_end" '
      $0 == start { skip=1; next }
      $0 == end { skip=0; next }
      skip != 1 { print }
    ' "$mpd_conf" >"$tmp_file"
  else
    cp "$mpd_conf" "$tmp_file"
  fi
  {
    sed -e '${/^$/d;}' "$tmp_file"
    printf '\n'
    build_resampler_block
  } >"${tmp_file}.next"

  if cmp -s "${tmp_file}.next" "$mpd_conf"; then
    rm -f "$tmp_file" "${tmp_file}.next"
    src_check
    return
  fi

  backup_file="${mpd_conf}.tikpal-src-$(date +%Y%m%d%H%M%S).bak"
  cp -p "$mpd_conf" "$backup_file"

  if [[ "$(id -u)" == "0" ]]; then
    install -m 0644 "${tmp_file}.next" "$mpd_conf"
  else
    sudo -n install -m 0644 "${tmp_file}.next" "$mpd_conf"
  fi
  rm -f "$tmp_file" "${tmp_file}.next"
  if ! src_check; then
    if [[ "$(id -u)" == "0" ]]; then
      cp -p "$backup_file" "$mpd_conf"
    else
      sudo -n cp -p "$backup_file" "$mpd_conf"
    fi
    printf 'restored %s after SRC validation failure\n' "$backup_file" >&2
    return 1
  fi
  restart_mpd_quickly
  wait_for_mpd
}

profile_output_name() {
  case "$1" in
    pure) printf 'Tikpal Pure Listening\n' ;;
    everyday) printf 'Tikpal Everyday\n' ;;
    sleep) printf 'Tikpal Sleep Meditation\n' ;;
    custom) printf '%s\n' "$custom_name" ;;
  esac
}

runtime_mpc() {
  run_mpc "$@" >/dev/null 2>&1 || true
}

wait_for_mpd() {
  command -v mpc >/dev/null 2>&1 || return 0
  local attempt
  for attempt in {1..8}; do
    if run_mpc status >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
}

select_runtime_output() {
  command -v mpc >/dev/null 2>&1 || return 0
  local selected_name="$1"
  while IFS= read -r line; do
    [[ "$line" =~ ^Output[[:space:]]+([0-9]+)[[:space:]]+\((.*)\)[[:space:]]+is ]] || continue
    local output_id="${BASH_REMATCH[1]}"
    local output_name="${BASH_REMATCH[2]}"
    if [[ "$output_name" == "$selected_name" ]]; then
      runtime_mpc enable "$output_id"
    else
      runtime_mpc disable "$output_id"
    fi
  done < <(run_mpc outputs 2>/dev/null || true)
}

apply_runtime_profile() {
  local selected_profile="$1"
  case "$selected_profile" in
    pure)
      runtime_mpc replaygain off
      runtime_mpc crossfade 0
      ;;
    everyday)
      runtime_mpc replaygain auto
      runtime_mpc crossfade 2
      ;;
    sleep)
      runtime_mpc replaygain track
      runtime_mpc crossfade 5
      if command -v mpc >/dev/null 2>&1; then
        local current_volume
        current_volume="$(run_mpc volume 2>/dev/null | awk -F: '/volume:/ { gsub(/[^0-9]/, "", $2); print $2; exit }' || true)"
        if [[ "$current_volume" =~ ^[0-9]+$ ]] && (( current_volume > sleep_volume_limit )); then
          runtime_mpc volume "$sleep_volume_limit"
        fi
      fi
      ;;
    custom)
      local custom_pure_direct="${TIKPAL_MPD_CUSTOM_PURE_DIRECT:-0}"
      local custom_volume_normalization="${TIKPAL_MPD_CUSTOM_VOLUME_NORMALIZATION:-1}"
      local custom_smooth_transition="${TIKPAL_MPD_CUSTOM_SMOOTH_TRANSITION:-1}"
      if [[ -n "$custom_replaygain" ]]; then
        runtime_mpc replaygain "$custom_replaygain"
      elif env_enabled "$custom_pure_direct" || ! env_enabled "$custom_volume_normalization"; then
        runtime_mpc replaygain off
      else
        runtime_mpc replaygain auto
      fi
      if [[ -n "$custom_crossfade" ]]; then
        runtime_mpc crossfade "$custom_crossfade"
      elif env_enabled "$custom_smooth_transition"; then
        runtime_mpc crossfade 2
      else
        runtime_mpc crossfade 0
      fi
      ;;
  esac
}

mpd_unit() {
  if systemctl cat mpd.service >/dev/null 2>&1; then
    printf 'mpd.service\n'
  else
    printf 'mpd\n'
  fi
}

mpd_is_stopping_or_running() {
  case "${1:-}" in
    active|activating|deactivating|reloading) return 0 ;;
    *) return 1 ;;
  esac
}

stop_mpd_quickly() {
  local unit="$1"
  run_systemctl "$mpd_stop_timeout_seconds" stop "$unit" >/dev/null 2>&1 || true

  local state attempt
  for attempt in {1..8}; do
    state="$(systemctl is-active "$unit" 2>/dev/null || true)"
    mpd_is_stopping_or_running "$state" || break
    if (( attempt == 2 )); then
      run_systemctl 1 kill -s SIGTERM "$unit" >/dev/null 2>&1 || true
    elif (( attempt == 4 )); then
      run_systemctl 1 kill -s SIGKILL "$unit" >/dev/null 2>&1 || true
    fi
    sleep 0.25
  done
  run_systemctl 1 reset-failed "$unit" >/dev/null 2>&1 || true
}

restart_mpd_quickly() {
  local unit
  unit="$(mpd_unit)"
  stop_mpd_quickly "$unit"
  run_systemctl "$mpd_start_timeout_seconds" start "$unit" >/dev/null 2>&1 || true
}

current_profile() {
  if grep -Fq 'name            "Tikpal Pure Listening"' "$mpd_conf" 2>/dev/null \
    || grep -Fq 'name            "Tikpal Bit-perfect"' "$mpd_conf" 2>/dev/null; then
    printf 'pure\n'
  elif grep -Fq 'name            "Tikpal Sleep Meditation"' "$mpd_conf" 2>/dev/null; then
    printf 'sleep\n'
  elif grep -Fq 'name            "Tikpal Everyday"' "$mpd_conf" 2>/dev/null; then
    printf 'everyday\n'
  elif grep -Fq "$marker_start" "$mpd_conf" 2>/dev/null; then
    printf 'custom\n'
  else
    printf 'everyday\n'
  fi
}

write_profile() {
  local selected_profile="$1"
  [[ -f "$mpd_conf" ]] || { printf '%s not found\n' "$mpd_conf" >&2; exit 66; }

  local tmp_file backup_file
  tmp_file="$(mktemp)"
  backup_file="${mpd_conf}.tikpal-$(date +%Y%m%d%H%M%S).bak"
  cp -p "$mpd_conf" "$backup_file"

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
    printf '\n'
    build_block "$selected_profile"
  } > "${tmp_file}.next"

  if [[ "$(id -u)" == "0" ]]; then
    install -m 0644 "${tmp_file}.next" "$mpd_conf"
  else
    sudo -n install -m 0644 "${tmp_file}.next" "$mpd_conf"
  fi

  rm -f "$tmp_file" "${tmp_file}.next"
  if profile_restart_enabled; then
    restart_mpd_quickly
    wait_for_mpd
    select_runtime_output "$(profile_output_name "$selected_profile")"
    apply_runtime_profile "$selected_profile"
  fi
  printf '%s\n' "$selected_profile"
}

bootstrap_mpd_config() {
  write_library_config
  if ! grep -Fq "$marker_start" "$mpd_conf"; then
    write_profile "everyday"
  fi
}

print_managed_block() {
  [[ -f "$mpd_conf" ]] || return 0
  awk -v start="$marker_start" -v end="$marker_end" '
    $0 == start { show=1 }
    show == 1 { print }
    $0 == end { show=0 }
  ' "$mpd_conf" 2>/dev/null || true
}

diagnostics() {
  printf 'profile=%s\n' "$(current_profile)"
  printf 'purePath=%s\n' "$pure_path"
  if [[ "$pure_path" == "resampled" ]]; then
    printf 'pureTargetRateHz=%s\n' "$pure_target_rate"
  fi
  printf 'resamplerPlugin=%s\n' "$resampler_plugin"
  printf 'mpd_conf=%s\n' "$mpd_conf"
  printf 'output_block<<EOF\n'
  print_managed_block
  printf 'EOF\n'
  printf 'resampler_block<<EOF\n'
  print_resampler_block
  printf 'EOF\n'
  if command -v mpc >/dev/null 2>&1; then
    printf 'mpc_replaygain=%s\n' "$(mpc replaygain 2>/dev/null | tr '\n' ' ' | sed 's/[[:space:]]*$//' || true)"
    printf 'mpc_crossfade=%s\n' "$(mpc crossfade 2>/dev/null | tr '\n' ' ' | sed 's/[[:space:]]*$//' || true)"
  fi
  if compgen -G '/proc/asound/card*/pcm*p/sub*/hw_params' >/dev/null; then
    printf 'hw_params<<EOF\n'
    for file in /proc/asound/card*/pcm*p/sub*/hw_params; do
      printf '%s\n' "$file"
      sed 's/^/  /' "$file" 2>/dev/null || true
    done
    printf 'EOF\n'
  fi
  if command -v fuser >/dev/null 2>&1; then
    printf 'snd_owners=%s\n' "$(fuser /dev/snd/* 2>/dev/null | tr '\n' ' ' | sed 's/[[:space:]]*$//' || true)"
  fi
}

case "$profile" in
  status)
    current_profile
    ;;
  library-setup)
    write_library_config
    ;;
  bootstrap)
    bootstrap_mpd_config
    ;;
  diagnostics)
    diagnostics
    ;;
  src-check)
    src_check
    ;;
  src-apply)
    write_src
    ;;
  *)
    selected_profile="$(normalize_profile "$profile")" || {
      printf 'usage: %s {pure|everyday|sleep|custom|status|diagnostics|library-setup|bootstrap|src-apply|src-check}\n' "$0" >&2
      exit 64
    }
    write_profile "$selected_profile"
    ;;
esac

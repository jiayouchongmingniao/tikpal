#!/usr/bin/env bash
set -euo pipefail

profile="${1:-status}"
mpd_conf="${TIKPAL_MPD_CONF:-/etc/mpd.conf}"
standard_device="${TIKPAL_MPD_STANDARD_ALSA_DEVICE:-_audioout}"
pure_device="${TIKPAL_MPD_PURE_ALSA_DEVICE:-${TIKPAL_MPD_BITPERFECT_ALSA_DEVICE:-}}"
sleep_rate="${TIKPAL_MPD_SLEEP_SAMPLE_RATE:-48000}"
sleep_volume_limit="${TIKPAL_MPD_SLEEP_VOLUME_LIMIT:-45}"
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

env_enabled() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on|enabled) return 0 ;;
    *) return 1 ;;
  esac
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
  if [[ -n "$pure_device" ]]; then
    printf '%s\n' "$pure_device"
    return
  fi

  local forced_card="${TIKPAL_AUDIO_CARD_FORCE:-}"
  if [[ -n "$forced_card" ]] && command -v aplay >/dev/null 2>&1; then
    local detected
    detected="$(aplay -l 2>/dev/null | awk -v forced="$forced_card" '
      $0 ~ /^card / {
        card=$2; sub(/:$/, "", card);
        name=$3; gsub(/\[|\]/, "", name);
        device=$6; sub(/:$/, "", device);
        if (name == forced || $0 ~ forced) {
          print "hw:CARD=" name ",DEV=" device;
          exit
        }
      }')"
    if [[ -n "$detected" ]]; then
      printf '%s\n' "$detected"
      return
    fi
  fi

  if command -v aplay >/dev/null 2>&1; then
    local detected
    detected="$(aplay -l 2>/dev/null | awk '
      $0 ~ /^card / && $0 !~ /Loopback|HDMI|NVidia|Intel/ {
        name=$3; gsub(/\[|\]/, "", name);
        device=$6; sub(/:$/, "", device);
        print "hw:CARD=" name ",DEV=" device;
        exit
      }')"
    if [[ -n "$detected" ]]; then
      printf '%s\n' "$detected"
      return
    fi
  fi

  printf 'hw:0,0\n'
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
      device="$(detect_pure_device)"
      output_name="Tikpal Pure Listening"
      mixer_type="none"
      replay_gain_handler="none"
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

runtime_mpc() {
  command -v mpc >/dev/null 2>&1 || return 0
  mpc "$@" >/dev/null 2>&1 || true
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
        current_volume="$(mpc volume 2>/dev/null | awk -F: '/volume:/ { gsub(/[^0-9]/, "", $2); print $2; exit }' || true)"
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
    printf '\n\n'
    build_block "$selected_profile"
  } > "${tmp_file}.next"

  if [[ "$(id -u)" == "0" ]]; then
    install -m 0644 "${tmp_file}.next" "$mpd_conf"
    systemctl restart mpd.service >/dev/null 2>&1 || systemctl restart mpd >/dev/null 2>&1 || true
  else
    sudo -n install -m 0644 "${tmp_file}.next" "$mpd_conf"
    sudo -n systemctl restart mpd.service >/dev/null 2>&1 || sudo -n systemctl restart mpd >/dev/null 2>&1 || true
  fi

  rm -f "$tmp_file" "${tmp_file}.next"
  apply_runtime_profile "$selected_profile"
  printf '%s\n' "$selected_profile"
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
  printf 'mpd_conf=%s\n' "$mpd_conf"
  printf 'output_block<<EOF\n'
  print_managed_block
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
  diagnostics)
    diagnostics
    ;;
  *)
    selected_profile="$(normalize_profile "$profile")" || {
      printf 'usage: %s {pure|everyday|sleep|custom|status|diagnostics}\n' "$0" >&2
      exit 64
    }
    write_profile "$selected_profile"
    ;;
esac

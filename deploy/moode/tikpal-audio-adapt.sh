#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

ACTION="${1:-check}"

: "${TIKPAL_AUDIO_ADAPT_MODE:=auto}"
: "${TIKPAL_AUDIO_CARD_PRIORITY:=BT66,Crimson}"
: "${TIKPAL_AUDIO_CARD_FORCE:=}"
: "${TIKPAL_AUDIO_ALLOW_UNKNOWN_SINGLE:=1}"
: "${TIKPAL_AUDIO_BROWSER_PROBE:=1}"
: "${TIKPAL_AUDIO_BROWSER_PROBE_TIMEOUT_SECONDS:=2}"
: "${TIKPAL_AUDIO_BROWSER_PROBE_FORMAT:=S16_LE}"
: "${TIKPAL_AUDIO_BROWSER_PROBE_FORMATS:=$TIKPAL_AUDIO_BROWSER_PROBE_FORMAT,S24_3LE,S32_LE}"
: "${TIKPAL_AUDIO_BROWSER_SHARED_FORMATS:=S24_3LE,S32_LE}"
: "${TIKPAL_AUDIO_BROWSER_SHARED_PCM:=tikpal_browser_output}"
: "${TIKPAL_AUDIO_BROWSER_SHARED_IPC_KEY:=742110}"
: "${TIKPAL_AUDIO_BROWSER_PROBE_RATE:=48000}"
: "${TIKPAL_AUDIO_BROWSER_PROBE_CHANNELS:=2}"
: "${TIKPAL_AUDIO_MIXER_CONTROLS:=PCM,Master,Digital,Speaker,Headphone,Line Out}"
: "${TIKPAL_AUDIOOUT_CONFIG:=/etc/alsa/conf.d/_audioout.conf}"
: "${TIKPAL_BROWSER_OUTPUT_CONFIG:=/etc/alsa/conf.d/99-tikpal-browser-output.conf}"
: "${TIKPAL_SNDALOOP_CONFIG:=/etc/alsa/conf.d/_sndaloop.conf}"
: "${TIKPAL_MOODE_DB:=/var/local/www/db/moode-sqlite3.db}"
: "${TIKPAL_SND_ALOOP_MODULES_LOAD:=/etc/modules-load.d/tikpal-snd-aloop.conf}"

log() {
  printf '[tikpal-audio-adapt] %s\n' "$*" >&2
}

fail() {
  log "ERROR: $*"
  exit 1
}

is_enabled() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on|enabled)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

trim() {
  printf '%s' "${1:-}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

lower() {
  printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]'
}

run_as_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo -n "$@"
  else
    "$@"
  fi
}

modprobe_command() {
  local modprobe_cmd
  modprobe_cmd="$(command -v modprobe 2>/dev/null || true)"
  if [[ -n "$modprobe_cmd" ]]; then
    printf '%s\n' "$modprobe_cmd"
    return 0
  fi
  if [[ -x /usr/sbin/modprobe ]]; then
    printf '%s\n' /usr/sbin/modprobe
    return 0
  fi
  if [[ -x /sbin/modprobe ]]; then
    printf '%s\n' /sbin/modprobe
    return 0
  fi
  return 1
}

modprobe_snd_aloop() {
  local modprobe_cmd
  modprobe_cmd="$(modprobe_command || true)"
  if [[ -z "$modprobe_cmd" ]]; then
    log "WARN: modprobe was not found; cannot load snd_aloop"
    return 1
  fi
  run_as_root "$modprobe_cmd" snd_aloop >/dev/null 2>&1 \
    || run_as_root "$modprobe_cmd" snd-aloop >/dev/null 2>&1
}

write_root_file() {
  local target="$1"
  local tmp
  tmp="$(mktemp)"
  cat >"$tmp"
  run_as_root install -m 0644 "$tmp" "$target"
  rm -f "$tmp"
}

sql_value() {
  printf '%s' "$1" | sed "s/'/''/g"
}

list_playback_cards() {
  command -v aplay >/dev/null 2>&1 || return 1
  aplay -l 2>/dev/null | awk '
    /^card [0-9]+:/ && / device [0-9]+:/ {
      line = $0
      low = tolower(line)
      if (low ~ /loopback|vc4-hdmi|vc4hdmi|bcm2835|hdmi/) next

      card_index = $2
      sub(/:$/, "", card_index)

      card_id = $3
      sub(/:$/, "", card_id)
      gsub(/[^[:alnum:]_-]/, "", card_id)
      if (card_id == "") next

      device_id = "0"
      for (i = 1; i <= NF; i++) {
        if ($i == "device" && (i + 1) <= NF) {
          device_id = $(i + 1)
          sub(/:$/, "", device_id)
          break
        }
      }

      label = line
      sub(/^card [0-9]+: [^[]*\[/, "", label)
      sub(/\].*$/, "", label)
      gsub(/\t/, " ", label)
      if (label == "" || label == line) label = card_id

      print card_index "\t" card_id "\t" device_id "\t" label "\t" line
    }
  '
}

card_matches_token() {
  local line="$1"
  local token="$2"
  local index card_id device_id label raw
  local token_l card_l label_l raw_l
  token="$(trim "$token")"
  [[ -n "$token" ]] || return 1
  IFS=$'\t' read -r index card_id device_id label raw <<<"$line"
  token_l="$(lower "$token")"
  card_l="$(lower "$card_id")"
  label_l="$(lower "$label")"
  raw_l="$(lower "$raw")"
  [[ "$token_l" == "$index" || "$token_l" == "$card_l" || "$token_l" == "$label_l" || "$raw_l" == *"$token_l"* ]]
}

find_matching_card() {
  local cards="$1"
  local token="$2"
  local line
  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    if card_matches_token "$line" "$token"; then
      printf '%s\n' "$line"
      return 0
    fi
  done <<<"$cards"
  return 1
}

select_card() {
  local cards force token matched card_count
  local priority_line
  cards="$(list_playback_cards || true)"
  [[ -n "$cards" ]] || fail "no non-HDMI playback card detected"

  force="$(trim "$TIKPAL_AUDIO_CARD_FORCE")"
  if [[ -n "$force" ]]; then
    matched="$(find_matching_card "$cards" "$force" || true)"
    [[ -n "$matched" ]] || fail "forced audio card '$force' was not detected"
    printf '%s\tforce:%s\n' "$matched" "$force"
    return 0
  fi

  while IFS= read -r token; do
    token="$(trim "$token")"
    [[ -n "$token" ]] || continue
    matched="$(find_matching_card "$cards" "$token" || true)"
    if [[ -n "$matched" ]]; then
      printf '%s\tpriority:%s\n' "$matched" "$token"
      return 0
    fi
  done < <(printf '%s\n' "$TIKPAL_AUDIO_CARD_PRIORITY" | tr ',' '\n')

  card_count="$(printf '%s\n' "$cards" | awk 'NF { count += 1 } END { print count + 0 }')"
  if [[ "$card_count" -eq 1 ]] && is_enabled "$TIKPAL_AUDIO_ALLOW_UNKNOWN_SINGLE"; then
    priority_line="$(printf '%s\n' "$cards" | awk 'NF { print; exit }')"
    printf '%s\tsingle-unknown\n' "$priority_line"
    return 0
  fi

  fail "multiple unknown non-HDMI audio cards detected; set TIKPAL_AUDIO_CARD_FORCE to choose one"
}

selected_field() {
  local selected="$1"
  local field="$2"
  awk -F '\t' -v field="$field" '{ print $field; exit }' <<<"$selected"
}

selected_audioout_pcm() {
  local selected="$1"
  local card_id device_id
  card_id="$(selected_field "$selected" 2)"
  device_id="$(selected_field "$selected" 3)"
  printf 'plughw:CARD=%s,DEV=%s\n' "$card_id" "$device_id"
}

sample_bytes_for_format() {
  case "$(printf '%s' "${1:-}" | tr '[:lower:]' '[:upper:]')" in
    U8|S8)
      printf '1\n'
      ;;
    S24_3LE|S24_3BE)
      printf '3\n'
      ;;
    S32_LE|S32_BE|FLOAT_LE|FLOAT_BE)
      printf '4\n'
      ;;
    *)
      printf '2\n'
      ;;
  esac
}

configured_browser_probe_formats() {
  printf '%s\n' "$TIKPAL_AUDIO_BROWSER_PROBE_FORMATS" | tr ',' '\n' | while IFS= read -r format; do
    format="$(trim "$format")"
    [[ -n "$format" ]] && printf '%s\n' "$format"
  done | awk '!seen[$0]++'
}

configured_browser_shared_formats() {
  printf '%s\n' "$TIKPAL_AUDIO_BROWSER_SHARED_FORMATS" | tr ',' '\n' | while IFS= read -r format; do
    format="$(trim "$format")"
    [[ -n "$format" ]] && printf '%s\n' "$format"
  done | awk '!seen[$0]++'
}

probe_browser_pcm_format() {
  local pcm="$1"
  local format="$2"
  local rate="$TIKPAL_AUDIO_BROWSER_PROBE_RATE"
  local channels="$TIKPAL_AUDIO_BROWSER_PROBE_CHANNELS"
  local sample_bytes
  local bytes
  is_enabled "$TIKPAL_AUDIO_BROWSER_PROBE" || return 0
  command -v aplay >/dev/null 2>&1 || return 1
  sample_bytes="$(sample_bytes_for_format "$format")"
  bytes=$((rate * channels * sample_bytes / 20))
  if command -v timeout >/dev/null 2>&1; then
    dd if=/dev/zero bs="$bytes" count=1 2>/dev/null \
      | timeout -k 1s "${TIKPAL_AUDIO_BROWSER_PROBE_TIMEOUT_SECONDS}s" \
          aplay -q -D "$pcm" -t raw -f "$format" -r "$rate" -c "$channels" >/dev/null 2>&1
  else
    dd if=/dev/zero bs="$bytes" count=1 2>/dev/null \
      | aplay -q -D "$pcm" -t raw -f "$format" -r "$rate" -c "$channels" >/dev/null 2>&1
  fi
}

card_stream_supports_playback_format() {
  local selected="$1"
  local format="$2"
  local card_index
  card_index="$(selected_field "$selected" 1)"
  awk -v wanted="$format" '
    /^Playback:/ { in_playback = 1; next }
    /^Capture:/ { in_playback = 0; next }
    in_playback && $1 == "Format:" && $2 == wanted { found = 1 }
    END { exit(found ? 0 : 1) }
  ' /proc/asound/card"${card_index}"/stream* >/dev/null 2>&1
}

selected_browser_shared_format() {
  local selected="$1"
  local dmix_pcm="$2"
  local format
  while IFS= read -r format; do
    [[ -n "$format" ]] || continue
    if card_stream_supports_playback_format "$selected" "$format" || probe_browser_pcm_format "$dmix_pcm" "$format"; then
      printf '%s\n' "$format"
      return 0
    fi
  done < <(configured_browser_shared_formats)
  return 1
}

selected_browser_pcm() {
  local selected="$1"
  local card_id device_id dmix_pcm plughw_pcm format formats_label shared_format
  card_id="$(selected_field "$selected" 2)"
  device_id="$(selected_field "$selected" 3)"
  dmix_pcm="dmix:CARD=$card_id,DEV=$device_id"
  plughw_pcm="plughw:CARD=$card_id,DEV=$device_id"
  formats_label="$(configured_browser_probe_formats | paste -sd, -)"
  while IFS= read -r format; do
    [[ -n "$format" ]] || continue
    if probe_browser_pcm_format "$dmix_pcm" "$format"; then
      printf '%s\n' "$dmix_pcm"
      return 0
    fi
  done < <(configured_browser_probe_formats)
  shared_format="$(selected_browser_shared_format "$selected" "$dmix_pcm" || true)"
  if [[ -n "$shared_format" ]]; then
    log "WARN: $dmix_pcm did not accept ${formats_label}/${TIKPAL_AUDIO_BROWSER_PROBE_RATE}Hz/${TIKPAL_AUDIO_BROWSER_PROBE_CHANNELS}ch; using shared $TIKPAL_AUDIO_BROWSER_SHARED_PCM with $shared_format conversion"
    printf '%s\n' "$TIKPAL_AUDIO_BROWSER_SHARED_PCM"
    return 0
  fi
  log "WARN: $dmix_pcm did not accept ${formats_label}/${TIKPAL_AUDIO_BROWSER_PROBE_RATE}Hz/${TIKPAL_AUDIO_BROWSER_PROBE_CHANNELS}ch and no shared conversion format was found; using $plughw_pcm"
  printf '%s\n' "$plughw_pcm"
}

configured_mixer_controls() {
  if [[ -n "${TIKPAL_OUTPUT_VOLUME_CONTROL:-}" ]]; then
    printf '%s\n' "$TIKPAL_OUTPUT_VOLUME_CONTROL"
    return 0
  fi
  printf '%s\n' "$TIKPAL_AUDIO_MIXER_CONTROLS" | tr ',' '\n' | while IFS= read -r control; do
    control="$(trim "$control")"
    [[ -n "$control" ]] && printf '%s\n' "$control"
  done
}

selected_mixer_control() {
  local selected="$1"
  local card_id control
  card_id="$(selected_field "$selected" 2)"
  command -v amixer >/dev/null 2>&1 || return 1
  while IFS= read -r control; do
    [[ -n "$control" ]] || continue
    if amixer -c "$card_id" get "$control" >/dev/null 2>&1; then
      printf '%s\n' "$control"
      return 0
    fi
  done < <(configured_mixer_controls)
  return 1
}

selected_mixer_percent() {
  local selected="$1"
  local control="$2"
  local card_id
  card_id="$(selected_field "$selected" 2)"
  amixer -c "$card_id" get "$control" 2>/dev/null | awk '
    match($0, /\[[0-9]+%\]/) {
      value = substr($0, RSTART + 1, RLENGTH - 3)
      print value
      exit
    }
  '
}

loopback_visible() {
  aplay -l 2>/dev/null | grep -q 'Loopback'
}

update_moode_db() {
  local selected="$1"
  local mixer_control="$2"
  local card_index card_label percent amix_name alsa_volume
  [[ -f "$TIKPAL_MOODE_DB" ]] || {
    log "WARN: moOde DB not found at $TIKPAL_MOODE_DB; skipping DB update"
    return 0
  }
  command -v sqlite3 >/dev/null 2>&1 || {
    log "WARN: sqlite3 is unavailable; skipping moOde DB update"
    return 0
  }
  card_index="$(selected_field "$selected" 1)"
  card_label="$(selected_field "$selected" 4)"
  if [[ -n "$mixer_control" ]]; then
    amix_name="$mixer_control"
    percent="$(selected_mixer_percent "$selected" "$mixer_control" || true)"
    alsa_volume="${percent:-75}"
  else
    amix_name="none"
    alsa_volume="none"
  fi

  run_as_root sqlite3 "$TIKPAL_MOODE_DB" \
    "update cfg_system set value='$(sql_value "$card_index")' where param='cardnum';
     update cfg_system set value='$(sql_value "$card_label")' where param='adevname';
     update cfg_system set value='$(sql_value "$amix_name")' where param='amixname';
     update cfg_system set value='$(sql_value "$alsa_volume")' where param='alsavolume';
     update cfg_system set value='software' where param='mpdmixer';"
}

write_audioout_config() {
  local pcm="$1"
  write_root_file "$TIKPAL_AUDIOOUT_CONFIG" <<EOF
#########################################
# This file is managed by moOde
#########################################
pcm._audioout {
type copy
slave.pcm "$pcm"
}
EOF
}

write_browser_output_config() {
  local selected="$1"
  local format="$2"
  local card_id device_id
  [[ -n "$format" ]] || return 0
  card_id="$(selected_field "$selected" 2)"
  device_id="$(selected_field "$selected" 3)"
  printf '%s\n' "$TIKPAL_AUDIO_BROWSER_SHARED_PCM" | grep -Eq '^[A-Za-z0-9_-]+$' || fail "invalid shared browser PCM '$TIKPAL_AUDIO_BROWSER_SHARED_PCM'"
  printf '%s\n' "$card_id" | grep -Eq '^[A-Za-z0-9_-]+$' || fail "invalid ALSA card id '$card_id'"
  printf '%s\n' "$device_id" | grep -Eq '^[0-9]+$' || fail "invalid ALSA device id '$device_id'"
  printf '%s\n' "$format" | grep -Eq '^[A-Za-z0-9_]+$' || fail "invalid ALSA format '$format'"
  write_root_file "$TIKPAL_BROWSER_OUTPUT_CONFIG" <<EOF
#########################################
# This file is managed by Tikpal for shared browser audio
#########################################
pcm.$TIKPAL_AUDIO_BROWSER_SHARED_PCM {
type plug
slave.pcm {
type dmix
ipc_key $TIKPAL_AUDIO_BROWSER_SHARED_IPC_KEY
ipc_key_add_uid true
slave {
pcm "hw:CARD=$card_id,DEV=$device_id"
format $format
rate $TIKPAL_AUDIO_BROWSER_PROBE_RATE
channels $TIKPAL_AUDIO_BROWSER_PROBE_CHANNELS
period_size 1024
buffer_size 4096
}
}
}
EOF
}

enable_loopback_config() {
  local pcm="$1"
  printf 'snd_aloop\n' | write_root_file "$TIKPAL_SND_ALOOP_MODULES_LOAD"
  if [[ -f "$SCRIPT_DIR/tikpal-alsa-loopback.sh" ]]; then
    # shellcheck disable=SC1091
    . "$SCRIPT_DIR/tikpal-alsa-loopback.sh"
    if ! TIKPAL_ALSA_PHYSICAL_OUTPUT_DEVICE="$pcm" tikpal_enable_alsa_loopback_output "$TIKPAL_SNDALOOP_CONFIG"; then
      fail "failed to enable ALSA Loopback for $pcm"
    fi
  else
    write_root_file "$TIKPAL_SNDALOOP_CONFIG" <<EOF
#########################################
# This file is managed by Tikpal for moOde ALSA Loopback
#########################################
pcm.!_audioout {
type plug
slave.pcm {
type multi
slaves {
a { channels 2 pcm "$pcm" }
b { channels 2 pcm "hw:CARD=Loopback,DEV=0" }
}
bindings {
0 { slave a channel 0 }
1 { slave a channel 1 }
2 { slave b channel 0 }
3 { slave b channel 1 }
}
}
ttable [
[ 1 0 1 0 ]
[ 0 1 0 1 ]
]
}
EOF
    modprobe_snd_aloop || true
  fi
  loopback_visible || fail "snd_aloop is not visible after applying Loopback config"
}

check_audio() {
  local selected audioout_pcm browser_pcm browser_shared_format mixer_control volume_strategy
  selected="$(select_card)"
  audioout_pcm="$(selected_audioout_pcm "$selected")"
  browser_pcm="$(selected_browser_pcm "$selected")"
  browser_shared_format="$(selected_browser_shared_format "$selected" "dmix:CARD=$(selected_field "$selected" 2),DEV=$(selected_field "$selected" 3)" || true)"
  mixer_control="$(selected_mixer_control "$selected" || true)"
  if [[ -n "$mixer_control" ]]; then
    volume_strategy="alsa:$mixer_control"
  else
    volume_strategy="mpd-software"
  fi
  printf 'selectedIndex=%s\n' "$(selected_field "$selected" 1)"
  printf 'selectedCard=%s\n' "$(selected_field "$selected" 2)"
  printf 'selectedDevice=%s\n' "$(selected_field "$selected" 3)"
  printf 'selectedLabel=%s\n' "$(selected_field "$selected" 4)"
  printf 'selectionReason=%s\n' "$(selected_field "$selected" 6)"
  printf 'browserPcm=%s\n' "$browser_pcm"
  printf 'browserSharedFormat=%s\n' "${browser_shared_format:-none}"
  printf 'audiooutPcm=%s\n' "$audioout_pcm"
  printf 'mixerControl=%s\n' "${mixer_control:-none}"
  printf 'volumeStrategy=%s\n' "$volume_strategy"
  if loopback_visible; then
    printf 'loopbackVisible=1\n'
  else
    printf 'loopbackVisible=0\n'
  fi
}

apply_audio() {
  local selected audioout_pcm browser_shared_format mixer_control
  case "$(lower "$TIKPAL_AUDIO_ADAPT_MODE")" in
    off|0|false|no)
      log "audio adaptation disabled by TIKPAL_AUDIO_ADAPT_MODE=$TIKPAL_AUDIO_ADAPT_MODE"
      return 0
      ;;
    check)
      check_audio
      return 0
      ;;
  esac

  selected="$(select_card)"
  audioout_pcm="$(selected_audioout_pcm "$selected")"
  browser_shared_format="$(selected_browser_shared_format "$selected" "dmix:CARD=$(selected_field "$selected" 2),DEV=$(selected_field "$selected" 3)" || true)"
  mixer_control="$(selected_mixer_control "$selected" || true)"
  update_moode_db "$selected" "$mixer_control"
  write_browser_output_config "$selected" "$browser_shared_format"
  write_audioout_config "$audioout_pcm"
  enable_loopback_config "$audioout_pcm"
  log "selected $(selected_field "$selected" 2) ($(selected_field "$selected" 4)) for $audioout_pcm"
  if [[ -n "$browser_shared_format" ]]; then
    log "browser shared PCM: $TIKPAL_AUDIO_BROWSER_SHARED_PCM ($browser_shared_format)"
  fi
  if [[ -n "$mixer_control" ]]; then
    log "volume mixer: $mixer_control"
  else
    log "volume mixer: none; MPD software fallback should remain enabled"
  fi
}

case "$ACTION" in
  check)
    check_audio
    ;;
  apply)
    apply_audio
    ;;
  resolve-browser)
    selected_browser_pcm "$(select_card)"
    ;;
  resolve-audioout)
    selected_audioout_pcm "$(select_card)"
    ;;
  *)
    fail "usage: $0 check|apply|resolve-browser|resolve-audioout"
    ;;
esac

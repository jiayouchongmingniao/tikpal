#!/bin/sh
set -eu

action="${1:-get}"
value="${2:-}"
control="${TIKPAL_OUTPUT_VOLUME_CONTROL:-}"
controls="${TIKPAL_OUTPUT_VOLUME_CONTROLS:-PCM,Master,Digital,Speaker,Headphone,Line Out}"
mirror_loopback="${TIKPAL_OUTPUT_VOLUME_MIRROR_LOOPBACK:-1}"
fallback_mpc="${TIKPAL_OUTPUT_VOLUME_FALLBACK_MPC:-1}"
alsa_configs="${TIKPAL_OUTPUT_VOLUME_ALSA_CONFIGS:-/etc/alsa/conf.d/_sndaloop.conf /etc/alsa/conf.d/_audioout.conf}"

discover_cards_from_config() {
  for config_path in $alsa_configs; do
    [ -r "$config_path" ] || continue
    awk '
      {
        line = $0
        while (match(line, /((plug)?hw|default):[^" ,)]+/)) {
          token = substr(line, RSTART, RLENGTH)
          sub(/^plughw:/, "", token)
          sub(/^hw:/, "", token)
          sub(/^default:/, "", token)
          sub(/^CARD=/, "", token)
          sub(/,.*/, "", token)
          if (token != "" && token != "Loopback") print token
          line = substr(line, RSTART + RLENGTH)
        }
      }
    ' "$config_path"
  done
}

discover_first_playback_card() {
  aplay -l 2>/dev/null | awk '
    /^card [0-9]+:/ {
      lower = tolower($0)
      if (lower ~ /loopback|vc4-hdmi|vc4hdmi|bcm2835|hdmi/) next
      card = $2
      sub(/:.*/, "", card)
      print card
      exit
    }
  '
}

unique_lines() {
  awk 'NF && !seen[$0]++'
}

physical_cards() {
  if [ -n "${TIKPAL_OUTPUT_VOLUME_CARDS:-}" ]; then
    printf '%s\n' $TIKPAL_OUTPUT_VOLUME_CARDS | unique_lines
    return
  fi

  {
    discover_cards_from_config
    discover_first_playback_card
  } | unique_lines
}

set_cards() {
  physical_cards
  if [ "$mirror_loopback" != "0" ] && card_accepts_any_control Loopback get; then
    printf '%s\n' Loopback
  fi
}

control_list() {
  if [ -n "$control" ]; then
    printf '%s\n' "$control"
    return
  fi
  printf '%s\n' "$controls" | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | awk 'NF && !seen[$0]++'
}

card_accepts_any_control() {
  card="$1"
  action_name="$2"
  for next_control in $(control_list | sed 's/ /__TIKPAL_SPACE__/g'); do
    next_control="$(printf '%s\n' "$next_control" | sed 's/__TIKPAL_SPACE__/ /g')"
    case "$action_name" in
      get)
        if amixer -c "$card" get "$next_control" >/dev/null 2>&1; then
          return 0
        fi
        ;;
      set)
        if amixer -c "$card" sset "$next_control" "${numeric_value}%" >/dev/null 2>&1; then
          return 0
        fi
        ;;
    esac
  done
  return 1
}

get_first_accepted_control() {
  card="$1"
  for next_control in $(control_list | sed 's/ /__TIKPAL_SPACE__/g'); do
    next_control="$(printf '%s\n' "$next_control" | sed 's/__TIKPAL_SPACE__/ /g')"
    if amixer -c "$card" get "$next_control" 2>/dev/null; then
      return 0
    fi
  done
  return 1
}

get_mpc_volume() {
  [ "$fallback_mpc" != "0" ] || return 1
  command -v mpc >/dev/null 2>&1 || return 1
  percent="$(mpc status 2>/dev/null | awk '
    /volume:/ {
      for (i = 1; i <= NF; i++) {
        if ($i ~ /^[0-9]+%$/) {
          gsub(/%/, "", $i)
          print $i
          exit
        }
      }
    }
  ')"
  [ -n "$percent" ] || return 1
  printf 'tikpal-output-volume: mpc software [%s%%]\n' "$percent"
}

set_mpc_volume() {
  [ "$fallback_mpc" != "0" ] || return 1
  command -v mpc >/dev/null 2>&1 || return 1
  mpc volume "$1" >/dev/null 2>&1
}

case "$action" in
  get)
    for card in $(physical_cards); do
      if get_first_accepted_control "$card"; then
        exit 0
      fi
    done
    for next_control in $(control_list | sed 's/ /__TIKPAL_SPACE__/g'); do
      next_control="$(printf '%s\n' "$next_control" | sed 's/__TIKPAL_SPACE__/ /g')"
      if amixer get "$next_control" 2>/dev/null; then
        exit 0
      fi
    done
    if get_mpc_volume; then
      exit 0
    fi
    printf 'tikpal-output-volume: no output mixer accepted configured controls and MPD software volume is unavailable\n' >&2
    exit 1
    ;;
  set)
    numeric_value="$(printf '%s' "$value" | awk '{ value = int($1 + 0); if (value < 0) value = 0; if (value > 100) value = 100; print value }')"
    changed=0
    failed_cards=""
    for card in $(set_cards | unique_lines); do
      if card_accepts_any_control "$card" set; then
        changed=1
      else
        failed_cards="${failed_cards}${failed_cards:+ }$card"
      fi
    done
    if [ "$changed" -eq 0 ]; then
      if set_mpc_volume "$numeric_value"; then
        exit 0
      fi
      for card in $failed_cards; do
        printf 'tikpal-output-volume: failed to set configured controls on card %s\n' "$card" >&2
      done
      printf 'tikpal-output-volume: no output mixer accepted configured controls\n' >&2
      exit 1
    fi
    ;;
  *)
    printf 'Usage: %s get|set [0-100]\n' "$0" >&2
    exit 2
    ;;
esac

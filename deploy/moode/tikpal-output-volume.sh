#!/bin/sh
set -eu

action="${1:-get}"
value="${2:-}"
control="${TIKPAL_OUTPUT_VOLUME_CONTROL:-PCM}"
mirror_loopback="${TIKPAL_OUTPUT_VOLUME_MIRROR_LOOPBACK:-1}"
alsa_configs="${TIKPAL_OUTPUT_VOLUME_ALSA_CONFIGS:-/etc/alsa/conf.d/_sndaloop.conf /etc/alsa/conf.d/_audioout.conf}"

discover_cards_from_config() {
  for config_path in $alsa_configs; do
    [ -r "$config_path" ] || continue
    awk '
      {
        line = $0
        while (match(line, /(plug)?hw:[^" ,)]+/)) {
          token = substr(line, RSTART, RLENGTH)
          sub(/^plughw:/, "", token)
          sub(/^hw:/, "", token)
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
    /^card [0-9]+:/ && $0 !~ /Loopback/ {
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
  if [ "$mirror_loopback" != "0" ] && amixer -c Loopback get "$control" >/dev/null 2>&1; then
    printf '%s\n' Loopback
  fi
}

case "$action" in
  get)
    for card in $(physical_cards); do
      if amixer -c "$card" get "$control" 2>/dev/null; then
        exit 0
      fi
    done
    exec amixer get "$control"
    ;;
  set)
    numeric_value="$(printf '%s' "$value" | awk '{ value = int($1 + 0); if (value < 0) value = 0; if (value > 100) value = 100; print value }')"
    changed=0
    for card in $(set_cards | unique_lines); do
      if amixer -c "$card" sset "$control" "${numeric_value}%" >/dev/null 2>&1; then
        changed=1
      else
        printf 'tikpal-output-volume: failed to set %s on card %s\n' "$control" "$card" >&2
      fi
    done
    if [ "$changed" -eq 0 ]; then
      printf 'tikpal-output-volume: no output mixer accepted %s\n' "$control" >&2
      exit 1
    fi
    ;;
  *)
    printf 'Usage: %s get|set [0-100]\n' "$0" >&2
    exit 2
    ;;
esac

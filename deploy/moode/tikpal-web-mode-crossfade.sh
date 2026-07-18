#!/bin/sh
set -eu

action="${1:-check}"
bus="${2:-}"
value="${3:-}"
configured_base_pcm="${TIKPAL_WEB_MODE_ALSA_OUTPUT_DEVICE:-auto}"
card="${TIKPAL_WEB_MODE_CROSSFADE_CARD:-}"
pcm_a="${TIKPAL_WEB_MODE_CROSSFADE_PCM_A:-tikpal_explore_a}"
pcm_b="${TIKPAL_WEB_MODE_CROSSFADE_PCM_B:-tikpal_explore_b}"
control_a="${TIKPAL_WEB_MODE_CROSSFADE_CONTROL_A:-Tikpal Explore A}"
control_b="${TIKPAL_WEB_MODE_CROSSFADE_CONTROL_B:-Tikpal Explore B}"
config_path="${TIKPAL_WEB_MODE_CROSSFADE_CONFIG_PATH:-/etc/alsa/conf.d/99-tikpal-explore-crossfade.conf}"

log() {
  printf '[tikpal-web-crossfade] %s\n' "$*"
}

fail() {
  log "ERROR: $*" >&2
  exit 1
}

trim_value() {
  printf '%s' "${1:-}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

detect_non_hdmi_card_id() {
  command -v aplay >/dev/null 2>&1 || return 1
  aplay -l 2>/dev/null | awk '
    /^card [0-9]+:/ {
      line = $0
      lower = tolower(line)
      if (lower ~ /loopback|vc4hdmi|bcm2835|hdmi/) next
      id = line
      sub(/^card [0-9]+: /, "", id)
      sub(/[[:space:]].*$/, "", id)
      gsub(/[^[:alnum:]_-]/, "", id)
      if (id == "") next
      if (lower ~ /usb/) {
        print id
        found = 1
        exit
      }
      if (first == "") first = id
    }
    END {
      if (!found && first != "") print first
    }
  '
}

resolve_base_pcm() {
  next_base_pcm="$(trim_value "$1")"
  next_base_pcm_lower="$(printf '%s' "$next_base_pcm" | tr '[:upper:]' '[:lower:]')"
  case "$next_base_pcm_lower" in
    ""|default)
      fail "TIKPAL_WEB_MODE_ALSA_OUTPUT_DEVICE must be auto or a physical ALSA PCM for crossfade"
      ;;
    auto)
      detected_card="$(detect_non_hdmi_card_id || true)"
      [ -n "$detected_card" ] || fail "auto ALSA output requested but no non-HDMI card was detected"
      printf 'dmix:CARD=%s,DEV=0\n' "$detected_card"
      ;;
    *)
      printf '%s\n' "$next_base_pcm"
      ;;
  esac
}

base_pcm="$(resolve_base_pcm "$configured_base_pcm")"

derive_card() {
  printf '%s\n' "$base_pcm" | sed -n 's/.*CARD=\([^,]*\).*/\1/p'
}

validate_config() {
  [ -n "$card" ] || card="$(derive_card)"
  printf '%s\n' "$base_pcm" | grep -Eq '^[A-Za-z0-9_:+.,=-]+$' || fail "invalid ALSA output '$base_pcm'"
  printf '%s\n' "$card" | grep -Eq '^[A-Za-z0-9_-]+$' || fail "cannot derive a mixer card from '$base_pcm'"
  printf '%s\n' "$pcm_a" | grep -Eq '^[A-Za-z0-9_-]+$' || fail "invalid A bus name"
  printf '%s\n' "$pcm_b" | grep -Eq '^[A-Za-z0-9_-]+$' || fail "invalid B bus name"
}

pcm_for_bus() {
  case "$1" in
    a) printf '%s\n' "$pcm_a" ;;
    b) printf '%s\n' "$pcm_b" ;;
    *) fail "bus must be a or b" ;;
  esac
}

control_for_bus() {
  case "$1" in
    a) printf '%s\n' "$control_a" ;;
    b) printf '%s\n' "$control_b" ;;
    *) fail "bus must be a or b" ;;
  esac
}

install_config() {
  local_tmp="$(mktemp)"
  trap 'rm -f "$local_tmp"' EXIT INT TERM
  cat >"$local_tmp" <<EOF
# Tikpal Explore A/B per-provider gain controls.
# This file is owned by Tikpal and does not replace moOde _audioout or _sndaloop.
pcm.$pcm_a {
  type softvol
  slave.pcm "$base_pcm"
  control {
    name "$control_a"
    card "$card"
  }
  min_dB -90.0
  max_dB 0.0
  resolution 256
}

pcm.$pcm_b {
  type softvol
  slave.pcm "$base_pcm"
  control {
    name "$control_b"
    card "$card"
  }
  min_dB -90.0
  max_dB 0.0
  resolution 256
}
EOF

  if [ -w "$(dirname "$config_path")" ]; then
    install -m 0644 "$local_tmp" "$config_path"
  else
    command -v sudo >/dev/null 2>&1 || fail "sudo is required to install $config_path"
    sudo -n install -m 0644 "$local_tmp" "$config_path"
  fi
  trap - EXIT INT TERM
  rm -f "$local_tmp"

  for next_bus in a b; do
    next_pcm="$(pcm_for_bus "$next_bus")"
    next_control="$(control_for_bus "$next_bus")"
    if ! amixer -c "$card" get "$next_control" >/dev/null 2>&1; then
      dd if=/dev/zero bs=19200 count=1 2>/dev/null \
        | aplay -q -D "$next_pcm" -t raw -f S16_LE -r 48000 -c 2 >/dev/null 2>&1 \
        || true
    fi
    amixer -q -c "$card" sset "$next_control" 100% || fail "cannot initialize $next_control"
  done
  log "installed $config_path for $base_pcm"
}

check_config() {
  command -v aplay >/dev/null 2>&1 || fail "aplay is unavailable"
  command -v amixer >/dev/null 2>&1 || fail "amixer is unavailable"
  aplay -L 2>/dev/null | grep -Fxq "$pcm_a" || fail "$pcm_a is unavailable"
  aplay -L 2>/dev/null | grep -Fxq "$pcm_b" || fail "$pcm_b is unavailable"
  amixer -c "$card" get "$control_a" >/dev/null 2>&1 || fail "$control_a is unavailable"
  amixer -c "$card" get "$control_b" >/dev/null 2>&1 || fail "$control_b is unavailable"
  log "ready: $pcm_a / $pcm_b on $card"
}

set_bus() {
  percent="$(printf '%s\n' "$2" | awk '{ value = int($1 + 0); if (value < 0) value = 0; if (value > 100) value = 100; print value }')"
  control="$(control_for_bus "$1")"
  amixer -q -c "$card" sset "$control" "${percent}%"
}

fade_buses() {
  old_bus="$1"
  new_bus="$2"
  duration_ms="$(printf '%s\n' "$3" | awk '{ value = int($1 + 0); if (value < 100) value = 100; print value }')"
  steps=12
  interval="$(awk "BEGIN { printf \"%.3f\", ($duration_ms / $steps) / 1000 }")"
  step=1
  while [ "$step" -le "$steps" ]; do
    old_percent=$((100 - (100 * step / steps)))
    new_percent=$((100 * step / steps))
    set_bus "$old_bus" "$old_percent"
    set_bus "$new_bus" "$new_percent"
    [ "$step" -eq "$steps" ] || sleep "$interval"
    step=$((step + 1))
  done
}

validate_config

case "$action" in
  install)
    install_config
    ;;
  check)
    check_config
    ;;
  device)
    pcm_for_bus "$bus"
    ;;
  set)
    [ -n "$value" ] || fail "set requires a percentage"
    set_bus "$bus" "$value"
    ;;
  fade)
    new_bus="${3:-}"
    duration_ms="${4:-2000}"
    [ -n "$bus" ] && [ -n "$new_bus" ] || fail "fade requires old bus and new bus"
    [ "$bus" != "$new_bus" ] || fail "fade buses must differ"
    fade_buses "$bus" "$new_bus" "$duration_ms"
    ;;
  *)
    fail "usage: $0 install|check|device <a|b>|set <a|b> <0-100>|fade <old> <new> [duration-ms]"
    ;;
esac

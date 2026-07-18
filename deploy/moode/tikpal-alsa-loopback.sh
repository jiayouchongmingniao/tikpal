#!/bin/sh

# Shared guard for moOde ALSA Loopback. Tikpal should follow moOde's current
# physical output, and most installs use a USB speaker or amplifier rather than HDMI.

TIKPAL_ALSA_LOG_PREFIX="${TIKPAL_ALSA_LOG_PREFIX:-tikpal-alsa}"

tikpal_alsa_log() {
  printf '[%s] %s\n' "$TIKPAL_ALSA_LOG_PREFIX" "$*"
}

tikpal_alsa_warn() {
  printf '[%s] WARN: %s\n' "$TIKPAL_ALSA_LOG_PREFIX" "$*" >&2
}

tikpal_alsa_bool_enabled() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on|enabled)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

tikpal_run_as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo -n "$@"
  else
    "$@"
  fi
}

tikpal_alsa_config_targets() {
  config_path="$1"
  awk '
    {
      line = $0
      while (match(line, /pcm[[:space:]]+"[^"]+"/)) {
        token = substr(line, RSTART, RLENGTH)
        sub(/^pcm[[:space:]]+"/, "", token)
        sub(/"$/, "", token)
        if (token != "" && token !~ /Loopback/) print token
        line = substr(line, RSTART + RLENGTH)
      }
    }
  ' "$config_path" | awk 'NF && !seen[$0]++'
}

tikpal_alsa_target_is_hdmi() {
  target="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "$target" in
    *vc4hdmi*|*bcm2835*|*hdmi*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

tikpal_alsa_card_id_for_index() {
  card_index="$1"
  aplay -l 2>/dev/null | sed -n "s/^card ${card_index}: \\([^ ]*\\) \\[.*/\\1/p" | head -n 1
}

tikpal_alsa_normalize_pcm_target() {
  target="$1"
  case "$target" in
    plughw:[0-9]*,[0-9]*|hw:[0-9]*,[0-9]*)
      prefix="${target%%:*}"
      rest="${target#*:}"
      card_index="${rest%%,*}"
      device_index="${rest#*,}"
      device_index="${device_index%%,*}"
      card_id="$(tikpal_alsa_card_id_for_index "$card_index" || true)"
      if [ -n "$card_id" ]; then
        printf '%s:CARD=%s,DEV=%s\n' "$prefix" "$card_id" "$device_index"
        return 0
      fi
      ;;
  esac

  printf '%s\n' "$target"
}

tikpal_alsa_base_audioout_target() {
  config_path="${1:-/etc/alsa/conf.d/_audioout.conf}"
  [ -f "$config_path" ] || return 1
  target="$(
    tikpal_alsa_config_targets "$config_path" \
      | while IFS= read -r candidate; do
          [ -n "$candidate" ] || continue
          case "$candidate" in
            *Loopback*) continue ;;
          esac
          normalized="$(tikpal_alsa_normalize_pcm_target "$candidate")"
          if [ -n "$normalized" ] && ! tikpal_alsa_target_is_hdmi "$normalized"; then
            printf '%s\n' "$normalized"
            break
          fi
        done
  )"
  [ -n "$target" ] || return 1
  printf '%s\n' "$target"
}

tikpal_alsa_detect_playback_target() {
  if [ -n "${TIKPAL_ALSA_PHYSICAL_OUTPUT_DEVICE:-}" ]; then
    tikpal_alsa_normalize_pcm_target "$TIKPAL_ALSA_PHYSICAL_OUTPUT_DEVICE"
    return 0
  fi

  base_target="$(tikpal_alsa_base_audioout_target "${TIKPAL_ALSA_BASE_AUDIOOUT_CONFIG:-/etc/alsa/conf.d/_audioout.conf}" || true)"
  if [ -n "$base_target" ]; then
    printf '%s\n' "$base_target"
    return 0
  fi

  aplay -l 2>/dev/null | awk '
    /^card [0-9]+:/ && / device [0-9]+:/ {
      line = $0
      low = tolower(line)
      if (low ~ /loopback|vc4-hdmi|vc4hdmi|bcm2835|hdmi/) next
      card_id = $3
      device_id = $6
      sub(/:$/, "", device_id)
      if (card_id != "" && device_id != "") {
        print "plughw:CARD=" card_id ",DEV=" device_id
        exit
      }
    }
  '
}

tikpal_write_alsa_loopback_config() {
  config_path="$1"
  physical_target="$2"
  tmp_path="$(mktemp)"

  {
    printf '%s\n' '#########################################'
    printf '%s\n' '# This file is managed by Tikpal for moOde ALSA Loopback'
    printf '%s\n' '#########################################'
    printf '%s\n' 'pcm.!_audioout {'
    printf '%s\n' 'type plug'
    printf '%s\n' 'slave.pcm {'
    printf '%s\n' 'type multi'
    printf '%s\n' 'slaves {'
    printf '%s\n' "a { channels 2 pcm \"$physical_target\" }"
    printf '%s\n' 'b { channels 2 pcm "hw:CARD=Loopback,DEV=0" }'
    printf '%s\n' '}'
    printf '%s\n' 'bindings {'
    printf '%s\n' '0 { slave a channel 0 }'
    printf '%s\n' '1 { slave a channel 1 }'
    printf '%s\n' '2 { slave b channel 0 }'
    printf '%s\n' '3 { slave b channel 1 }'
    printf '%s\n' '}'
    printf '%s\n' '}'
    printf '%s\n' 'ttable ['
    printf '%s\n' '[ 1 0 1 0 ]'
    printf '%s\n' '[ 0 1 0 1 ]'
    printf '%s\n' ']'
    printf '%s\n' '}'
  } > "$tmp_path" || {
    rm -f "$tmp_path"
    return 1
  }

  tikpal_run_as_root cp "$tmp_path" "$config_path" || {
    rm -f "$tmp_path"
    return 1
  }
  rm -f "$tmp_path"
}

tikpal_validate_alsa_loopback_config() {
  config_path="${1:-/etc/alsa/conf.d/_sndaloop.conf}"

  [ -f "$config_path" ] || return 0

  targets="$(tikpal_alsa_config_targets "$config_path" || true)"
  [ -n "$targets" ] || return 0

  physical_count=0
  non_hdmi_count=0
  hdmi_targets=""

  for target in $targets; do
    physical_count=$((physical_count + 1))
    if tikpal_alsa_target_is_hdmi "$target"; then
      hdmi_targets="${hdmi_targets}${hdmi_targets:+ }$target"
    else
      non_hdmi_count=$((non_hdmi_count + 1))
    fi
  done

  [ "$physical_count" -gt 0 ] || return 0
  [ "$non_hdmi_count" -gt 0 ] && return 0

  if tikpal_alsa_bool_enabled "${TIKPAL_ALSA_LOOPBACK_ALLOW_HDMI:-0}"; then
    tikpal_alsa_warn "allowing HDMI-only ALSA Loopback target(s): $hdmi_targets"
    return 0
  fi

  tikpal_alsa_warn "$config_path routes _audioout only to HDMI target(s): $hdmi_targets"
  tikpal_alsa_warn "select the USB output in moOde before enabling Tikpal Loopback, or set TIKPAL_ALSA_LOOPBACK_ALLOW_HDMI=1 for an intentional HDMI install"
  return 1
}

tikpal_ensure_snd_aloop_loaded() {
  if aplay -l 2>/dev/null | grep -q 'Loopback'; then
    return 0
  fi

  tikpal_run_as_root modprobe snd-aloop >/dev/null 2>&1 || true

  if aplay -l 2>/dev/null | grep -q 'Loopback'; then
    return 0
  fi

  tikpal_alsa_warn "snd-aloop is not visible in aplay output; Loopback may require sudo permissions or a reboot"
  return 1
}

tikpal_enable_alsa_loopback_output() {
  config_path="${1:-/etc/alsa/conf.d/_sndaloop.conf}"
  physical_target="$(tikpal_alsa_detect_playback_target || true)"

  if [ -n "$physical_target" ]; then
    if tikpal_alsa_target_is_hdmi "$physical_target" && ! tikpal_alsa_bool_enabled "${TIKPAL_ALSA_LOOPBACK_ALLOW_HDMI:-0}"; then
      tikpal_alsa_warn "detected HDMI-only ALSA Loopback target: $physical_target"
      tikpal_alsa_warn "select the USB output in moOde before enabling Tikpal Loopback, or set TIKPAL_ALSA_LOOPBACK_ALLOW_HDMI=1 for an intentional HDMI install"
      return 1
    fi
    tikpal_write_alsa_loopback_config "$config_path" "$physical_target" || return 1
    tikpal_alsa_log "wrote $config_path for physical output $physical_target"
  fi

  if [ -f "$config_path" ]; then
    tikpal_validate_alsa_loopback_config "$config_path" || return 1
    tikpal_run_as_root sed -i '0,/_audioout__ {/s//_audioout {/' "$config_path" || return 1
    tikpal_alsa_log "ensured $config_path overrides _audioout"
  else
    tikpal_alsa_warn "$config_path is not present; loading snd-aloop is still safe"
  fi

  tikpal_ensure_snd_aloop_loaded
}

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

  if [ -f "$config_path" ]; then
    tikpal_validate_alsa_loopback_config "$config_path" || return 1
    tikpal_run_as_root sed -i '0,/_audioout__ {/s//_audioout {/' "$config_path" || return 1
    tikpal_alsa_log "ensured $config_path overrides _audioout"
  else
    tikpal_alsa_warn "$config_path is not present; loading snd-aloop is still safe"
  fi

  tikpal_ensure_snd_aloop_loaded
}

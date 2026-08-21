#!/bin/sh

# Shared guard for Tikpal ALSA Loopback. The device owns its base _audioout
# route; Tikpal mirrors that route only after the base configuration is loaded.

TIKPAL_ALSA_LOG_PREFIX="${TIKPAL_ALSA_LOG_PREFIX:-tikpal-alsa}"
TIKPAL_ALSA_POSTLOAD_BEGIN="# BEGIN Tikpal ALSA Loopback"
TIKPAL_ALSA_POSTLOAD_END="# END Tikpal ALSA Loopback"

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

tikpal_modprobe_command() {
  modprobe_cmd="$(command -v modprobe 2>/dev/null || true)"
  if [ -n "$modprobe_cmd" ]; then
    printf '%s\n' "$modprobe_cmd"
    return 0
  fi
  if [ -x /usr/sbin/modprobe ]; then
    printf '%s\n' /usr/sbin/modprobe
    return 0
  fi
  if [ -x /sbin/modprobe ]; then
    printf '%s\n' /sbin/modprobe
    return 0
  fi
  return 1
}

tikpal_modprobe_snd_aloop() {
  modprobe_cmd="$(tikpal_modprobe_command || true)"
  if [ -z "$modprobe_cmd" ]; then
    tikpal_alsa_warn "modprobe was not found; cannot load snd_aloop"
    return 1
  fi
  tikpal_run_as_root "$modprobe_cmd" snd_aloop >/dev/null 2>&1 \
    || tikpal_run_as_root "$modprobe_cmd" snd-aloop >/dev/null 2>&1
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

tikpal_alsa_target_is_loopback() {
  case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
    *loopback*)
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

# Extract only the PCM that the currently configured _audioout routes to. Do
# not scan every PCM value: that is how an arbitrary sound card became MID.
tikpal_alsa_audioout_slave_target() {
  config_path="$1"
  [ -r "$config_path" ] || return 1

  awk '
    function brace_delta(value, copy) {
      copy = value
      opens = gsub(/\{/, "", copy)
      copy = value
      closes = gsub(/\}/, "", copy)
      return opens - closes
    }
    function quoted_pcm(value, token) {
      token = value
      sub(/^[^"]*"/, "", token)
      sub(/".*$/, "", token)
      return token
    }
    {
      line = $0
      sub(/[[:space:]]*#.*/, "", line)
      if (!inside) {
        if (line ~ /^[[:space:]]*pcm\._audioout[[:space:]]*\{/) {
          inside = 1
          depth = brace_delta(line)
        }
        next
      }

      if (line ~ /slave\.pcm[[:space:]]+"[^"]+"/) {
        print quoted_pcm(line)
        exit
      }
      if (line ~ /^[[:space:]]*slave[[:space:]]*\{/) {
        inside_slave = 1
        slave_depth = brace_delta(line)
      }
      if (inside_slave && line ~ /pcm[[:space:]]+"[^"]+"/) {
        print quoted_pcm(line)
        exit
      }

      depth += brace_delta(line)
      if (inside_slave) {
        slave_depth += brace_delta(line)
        if (slave_depth <= 0) inside_slave = 0
      }
      if (depth <= 0) exit
    }
  ' "$config_path" | head -n 1
}

tikpal_alsa_base_audioout_target() {
  if [ -n "${TIKPAL_ALSA_BASE_AUDIOOUT_CONFIG:-}" ]; then
    config_paths="$TIKPAL_ALSA_BASE_AUDIOOUT_CONFIG"
  else
    config_paths="${TIKPAL_ALSA_BASE_AUDIOOUT_CONFIGS:-/etc/asound.conf /etc/alsa/conf.d/_audioout.conf}"
  fi

  for config_path in $config_paths; do
    target="$(tikpal_alsa_audioout_slave_target "$config_path" || true)"
    [ -n "$target" ] || continue
    target="$(tikpal_alsa_normalize_pcm_target "$target")"
    case "$target" in
      _audioout|!_audioout) continue ;;
    esac
    tikpal_alsa_target_is_loopback "$target" && continue
    printf '%s\n' "$target"
    return 0
  done

  return 1
}

tikpal_alsa_detect_playback_target() {
  if [ -n "${TIKPAL_ALSA_PHYSICAL_OUTPUT_DEVICE:-}" ]; then
    tikpal_alsa_normalize_pcm_target "$TIKPAL_ALSA_PHYSICAL_OUTPUT_DEVICE"
    return 0
  fi

  tikpal_alsa_base_audioout_target
}

tikpal_alsa_backup_path() {
  printf '%s.bak.%s\n' "$1" "$(date +%Y%m%d%H%M%S)"
}

tikpal_alsa_install_managed_file() {
  source_path="$1"
  target_path="$2"
  TIKPAL_ALSA_INSTALL_BACKUP=""
  TIKPAL_ALSA_INSTALL_CREATED=0

  if [ -f "$target_path" ] && cmp -s "$source_path" "$target_path"; then
    return 0
  fi
  if [ -f "$target_path" ]; then
    TIKPAL_ALSA_INSTALL_BACKUP="$(tikpal_alsa_backup_path "$target_path")"
    tikpal_run_as_root cp -p "$target_path" "$TIKPAL_ALSA_INSTALL_BACKUP" || return 1
  else
    TIKPAL_ALSA_INSTALL_CREATED=1
  fi

  tikpal_run_as_root install -d -o root -g root -m 0755 "$(dirname "$target_path")" || return 1
  tikpal_run_as_root install -o root -g root -m 0644 "$source_path" "$target_path"
}

tikpal_alsa_rollback_managed_file() {
  target_path="$1"
  backup_path="$2"
  created="$3"

  if [ -n "$backup_path" ]; then
    tikpal_run_as_root cp -p "$backup_path" "$target_path"
  elif [ "$created" -eq 1 ]; then
    tikpal_run_as_root rm -f "$target_path"
  fi
}

tikpal_write_alsa_loopback_config() {
  config_path="$1"
  physical_target="$2"
  case "$physical_target" in
    *'"'*|*'\\'*)
      tikpal_alsa_warn "refusing an unsafe _audioout PCM target"
      return 1
      ;;
  esac
  tmp_path="$(mktemp)"

  {
    printf '%s\n' '#########################################'
    printf '%s\n' '# This file is managed by Tikpal for ALSA Loopback'
    printf '%s\n' '# It is included after the device-owned _audioout route.'
    printf '%s\n' '#########################################'
    printf '%s\n' 'pcm.!_audioout {'
    printf '%s\n' '  type plug'
    printf '%s\n' '  slave.pcm {'
    printf '%s\n' '    type multi'
    printf '%s\n' '    slaves {'
    printf '%s\n' "      a { channels 2 pcm \"$physical_target\" }"
    printf '%s\n' '      b { channels 2 pcm "hw:CARD=Loopback,DEV=0" }'
    printf '%s\n' '    }'
    printf '%s\n' '    bindings {'
    printf '%s\n' '      0 { slave a channel 0 }'
    printf '%s\n' '      1 { slave a channel 1 }'
    printf '%s\n' '      2 { slave b channel 0 }'
    printf '%s\n' '      3 { slave b channel 1 }'
    printf '%s\n' '    }'
    printf '%s\n' '  }'
    printf '%s\n' '  ttable ['
    printf '%s\n' '    [ 1 0 1 0 ]'
    printf '%s\n' '    [ 0 1 0 1 ]'
    printf '%s\n' '  ]'
    printf '%s\n' '}'
  } > "$tmp_path" || {
    rm -f "$tmp_path"
    return 1
  }

  tikpal_alsa_install_managed_file "$tmp_path" "$config_path"
  result=$?
  TIKPAL_ALSA_CONFIG_BACKUP="$TIKPAL_ALSA_INSTALL_BACKUP"
  TIKPAL_ALSA_CONFIG_CREATED="$TIKPAL_ALSA_INSTALL_CREATED"
  rm -f "$tmp_path"
  return "$result"
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

tikpal_validate_alsa_loopback_config() {
  config_path="${1:-${TIKPAL_ALSA_LOOPBACK_CONFIG:-/etc/tikpal/alsa-loopback.conf}}"

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
  tikpal_alsa_warn "select a non-HDMI output before enabling Tikpal Loopback, or set TIKPAL_ALSA_LOOPBACK_ALLOW_HDMI=1 for an intentional HDMI install"
  return 1
}

tikpal_alsa_disable_legacy_loopback_config() {
  legacy_path="$1"
  [ -f "$legacy_path" ] || return 0
  if ! grep -Eq 'managed by Tikpal|Tikpal Gentoo' "$legacy_path"; then
    tikpal_alsa_warn "refusing to move unrecognised legacy ALSA config: $legacy_path"
    return 1
  fi

  TIKPAL_ALSA_LEGACY_BACKUP="${legacy_path}.disabled.$(date +%Y%m%d%H%M%S)"
  tikpal_run_as_root mv "$legacy_path" "$TIKPAL_ALSA_LEGACY_BACKUP" || return 1
  tikpal_alsa_log "disabled legacy preloaded config $legacy_path"
}

tikpal_alsa_restore_legacy_loopback_config() {
  legacy_path="$1"
  [ -n "${TIKPAL_ALSA_LEGACY_BACKUP:-}" ] || return 0
  [ -f "$TIKPAL_ALSA_LEGACY_BACKUP" ] || return 0
  tikpal_run_as_root mv "$TIKPAL_ALSA_LEGACY_BACKUP" "$legacy_path"
}

tikpal_alsa_write_postload_include() {
  base_config="$1"
  loopback_config="$2"
  tmp_path="$(mktemp)"

  if [ -f "$base_config" ]; then
    awk -v begin="$TIKPAL_ALSA_POSTLOAD_BEGIN" -v end="$TIKPAL_ALSA_POSTLOAD_END" '
      $0 == begin { skipping = 1; next }
      skipping && $0 == end { skipping = 0; next }
      !skipping { print }
      END { if (skipping) exit 2 }
    ' "$base_config" > "$tmp_path" || {
      rm -f "$tmp_path"
      tikpal_alsa_warn "could not update Tikpal ALSA include in $base_config"
      return 1
    }
  else
    : > "$tmp_path"
  fi

  printf '\n%s\n<%s>\n%s\n' "$TIKPAL_ALSA_POSTLOAD_BEGIN" "$loopback_config" "$TIKPAL_ALSA_POSTLOAD_END" >> "$tmp_path"
  tikpal_alsa_install_managed_file "$tmp_path" "$base_config"
  result=$?
  TIKPAL_ALSA_BASE_BACKUP="$TIKPAL_ALSA_INSTALL_BACKUP"
  TIKPAL_ALSA_BASE_CREATED="$TIKPAL_ALSA_INSTALL_CREATED"
  rm -f "$tmp_path"
  return "$result"
}

tikpal_ensure_snd_aloop_loaded() {
  if aplay -l 2>/dev/null | grep -q 'Loopback'; then
    return 0
  fi

  if ! tikpal_modprobe_snd_aloop; then
    tikpal_alsa_warn "could not load snd_aloop with modprobe"
  fi

  if aplay -l 2>/dev/null | grep -q 'Loopback'; then
    return 0
  fi

  tikpal_alsa_warn "snd_aloop is not visible in aplay output; Loopback may require sudo permissions or a reboot"
  return 1
}

tikpal_alsa_config_parses() {
  aplay -L >/dev/null 2>&1
}

tikpal_enable_alsa_loopback_output() {
  config_path="${1:-${TIKPAL_ALSA_LOOPBACK_CONFIG:-/etc/tikpal/alsa-loopback.conf}}"
  base_config="${TIKPAL_ALSA_BASE_CONFIG:-/etc/asound.conf}"
  legacy_config="${TIKPAL_ALSA_LEGACY_LOOPBACK_CONFIG:-/etc/alsa/conf.d/_sndaloop.conf}"
  physical_target="$(tikpal_alsa_detect_playback_target || true)"

  if [ -z "$physical_target" ]; then
    tikpal_alsa_warn "could not resolve the active _audioout route; refusing to choose an arbitrary sound card"
    return 1
  fi
  if tikpal_alsa_target_is_hdmi "$physical_target" && ! tikpal_alsa_bool_enabled "${TIKPAL_ALSA_LOOPBACK_ALLOW_HDMI:-0}"; then
    tikpal_alsa_warn "detected HDMI-only ALSA Loopback target: $physical_target"
    tikpal_alsa_warn "select a non-HDMI output before enabling Tikpal Loopback, or set TIKPAL_ALSA_LOOPBACK_ALLOW_HDMI=1 for an intentional HDMI install"
    return 1
  fi
  if ! tikpal_ensure_snd_aloop_loaded; then
    return 1
  fi

  TIKPAL_ALSA_LEGACY_BACKUP=""
  tikpal_write_alsa_loopback_config "$config_path" "$physical_target" || return 1
  if ! tikpal_validate_alsa_loopback_config "$config_path"; then
    tikpal_alsa_rollback_managed_file "$config_path" "$TIKPAL_ALSA_CONFIG_BACKUP" "$TIKPAL_ALSA_CONFIG_CREATED"
    return 1
  fi
  if [ "$legacy_config" != "$config_path" ] && ! tikpal_alsa_disable_legacy_loopback_config "$legacy_config"; then
    tikpal_alsa_rollback_managed_file "$config_path" "$TIKPAL_ALSA_CONFIG_BACKUP" "$TIKPAL_ALSA_CONFIG_CREATED"
    return 1
  fi
  if ! tikpal_alsa_write_postload_include "$base_config" "$config_path"; then
    tikpal_alsa_restore_legacy_loopback_config "$legacy_config"
    tikpal_alsa_rollback_managed_file "$config_path" "$TIKPAL_ALSA_CONFIG_BACKUP" "$TIKPAL_ALSA_CONFIG_CREATED"
    return 1
  fi
  if ! tikpal_alsa_config_parses; then
    tikpal_alsa_warn "ALSA rejected the Tikpal postload configuration; restoring the prior files"
    tikpal_alsa_rollback_managed_file "$base_config" "$TIKPAL_ALSA_BASE_BACKUP" "$TIKPAL_ALSA_BASE_CREATED"
    tikpal_alsa_restore_legacy_loopback_config "$legacy_config"
    tikpal_alsa_rollback_managed_file "$config_path" "$TIKPAL_ALSA_CONFIG_BACKUP" "$TIKPAL_ALSA_CONFIG_CREATED"
    return 1
  fi

  tikpal_alsa_log "mirroring _audioout through $physical_target and ALSA Loopback"
}

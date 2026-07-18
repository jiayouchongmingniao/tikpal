#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

run_as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo -n "$@"
  else
    "$@"
  fi
}

ensure_loopback_output() {
  TIKPAL_ALSA_LOG_PREFIX="${TIKPAL_ALSA_LOG_PREFIX:-tikpal-airplay}"
  # shellcheck disable=SC1091
  . "$SCRIPT_DIR/tikpal-alsa-loopback.sh"
  tikpal_enable_alsa_loopback_output /etc/alsa/conf.d/_sndaloop.conf
}

shairport_config_changed=0
airplay_artwork_root="${TIKPAL_AIRPLAY_ARTWORK_ROOT:-/var/local/www/imagesw/airplay-covers}"
airplay_service_name="${TIKPAL_AIRPLAY_SERVICE_NAME:-}"
airplay_service_type="${TIKPAL_AIRPLAY_SERVICE_TYPE:-}"
airplay_metadata_pipe="${TIKPAL_AIRPLAY_METADATA_PIPE:-/tmp/shairport-sync-metadata}"
airplay_pre_hook="/usr/local/bin/tikpal-shairport-spspre"
airplay_post_hook="/usr/local/bin/tikpal-shairport-spspost"
airplay_pre_hook_command="${airplay_pre_hook}"
airplay_post_hook_command="${airplay_post_hook}"

ensure_shairport_hooks() {
  visudo_path="$(command -v visudo 2>/dev/null || printf '%s\n' /usr/sbin/visudo)"
  if ! command -v sudo >/dev/null 2>&1 || ! [ -x "$visudo_path" ] || ! id shairport-sync >/dev/null 2>&1; then
    return 0
  fi

  tmp_pre="$(mktemp)"
  tmp_post="$(mktemp)"
  tmp_sudoers="$(mktemp)"
  trap 'rm -f "$tmp_pre" "$tmp_post" "$tmp_sudoers"' EXIT INT TERM

  printf '%s\n' '#!/bin/sh' 'exec /usr/bin/sudo -n /var/local/www/commandw/spspre.sh "$@"' > "$tmp_pre"
  printf '%s\n' '#!/bin/sh' 'exec /usr/bin/sudo -n /var/local/www/commandw/spspost.sh "$@"' > "$tmp_post"
  printf '%s\n' 'shairport-sync ALL=(root) NOPASSWD: /var/local/www/commandw/spspre.sh, /var/local/www/commandw/spspost.sh' > "$tmp_sudoers"

  run_as_root "$visudo_path" -cf "$tmp_sudoers" >/dev/null || return 0
  run_as_root install -o root -g root -m 755 "$tmp_pre" "$airplay_pre_hook" || return 0
  run_as_root install -o root -g root -m 755 "$tmp_post" "$airplay_post_hook" || return 0
  run_as_root install -o root -g root -m 440 "$tmp_sudoers" /etc/sudoers.d/tikpal-shairport-sync-hooks || return 0
}

write_shairport_config() {
  config_path="$1"
  output_device="$2"
  artwork_root="$3"
  service_name="$4"
  service_type="$5"
  metadata_pipe="$6"
  tmp_path="$(mktemp)"

  awk -v output_device="$output_device" -v artwork_root="$artwork_root" -v service_name="$service_name" -v service_type="$service_type" -v metadata_pipe="$metadata_pipe" -v pre_hook="$airplay_pre_hook_command" -v post_hook="$airplay_post_hook_command" '
    function config_value(value) {
      gsub(/\\/, "\\\\", value);
      gsub(/"/, "\\\"", value);
      return value;
    }
    BEGIN {
      output_device = config_value(output_device);
      artwork_root = config_value(artwork_root);
      service_name = config_value(service_name);
      service_type = config_value(service_type);
      metadata_pipe = config_value(metadata_pipe);
      pre_hook = config_value(pre_hook);
      post_hook = config_value(post_hook);
    }
    service_name != "" && !updated_name && $0 ~ /^[[:space:]]*(\/\/[[:space:]]*)?name[[:space:]]*=/ {
      print "\tname = \"" service_name "\";";
      updated_name = 1;
      next;
    }
    service_type != "" && !updated_service_type && $0 ~ /^[[:space:]]*(\/\/[[:space:]]*)?service_type[[:space:]]*=/ {
      print "\tservice_type = \"" service_type "\";";
      updated_service_type = 1;
      next;
    }
    !updated && $0 ~ /^[[:space:]]*(\/\/[[:space:]]*)?output_device[[:space:]]*=/ {
      print "\toutput_device = \"" output_device "\";";
      updated = 1;
      next;
    }
    !updated_start && $0 ~ /^[[:space:]]*(\/\/[[:space:]]*)?run_this_before_entering_active_state[[:space:]]*=/ {
      print "run_this_before_entering_active_state = \"" pre_hook "\";";
      updated_start = 1;
      next;
    }
    !updated_stop && $0 ~ /^[[:space:]]*(\/\/[[:space:]]*)?run_this_after_exiting_active_state[[:space:]]*=/ {
      print "run_this_after_exiting_active_state = \"" post_hook "\";";
      updated_stop = 1;
      next;
    }
    !updated_wait && $0 ~ /^[[:space:]]*(\/\/[[:space:]]*)?wait_for_completion[[:space:]]*=/ {
      print "wait_for_completion = \"yes\";";
      updated_wait = 1;
      next;
    }
    !updated_artwork && $0 ~ /^[[:space:]]*(\/\/[[:space:]]*)?cover_art_cache_directory[[:space:]]*=/ {
      print "\tcover_art_cache_directory = \"" artwork_root "\";";
      updated_artwork = 1;
      next;
    }
    $0 ~ /^[[:space:]]*metadata[[:space:]]*=/ {
      metadata_pending = 1;
      print;
      next;
    }
    metadata_pending && $0 ~ /^[[:space:]]*\{/ {
      in_metadata = 1;
      metadata_pending = 0;
      print;
      next;
    }
    in_metadata && !updated_metadata_enabled && $0 ~ /^[[:space:]]*(\/\/[[:space:]]*)?enabled[[:space:]]*=/ {
      print "\tenabled = \"yes\";";
      updated_metadata_enabled = 1;
      next;
    }
    in_metadata && !updated_metadata_cover && $0 ~ /^[[:space:]]*(\/\/[[:space:]]*)?include_cover_art[[:space:]]*=/ {
      print "\tinclude_cover_art = \"yes\";";
      updated_metadata_cover = 1;
      next;
    }
    in_metadata && !updated_metadata_pipe && $0 ~ /^[[:space:]]*(\/\/[[:space:]]*)?pipe_name[[:space:]]*=/ {
      print "\tpipe_name = \"" metadata_pipe "\";";
      updated_metadata_pipe = 1;
      next;
    }
    in_metadata && $0 ~ /^[[:space:]]*\};/ {
      if (!updated_metadata_enabled) {
        print "\tenabled = \"yes\";";
        updated_metadata_enabled = 1;
      }
      if (!updated_metadata_cover) {
        print "\tinclude_cover_art = \"yes\";";
        updated_metadata_cover = 1;
      }
      if (!updated_metadata_pipe) {
        print "\tpipe_name = \"" metadata_pipe "\";";
        updated_metadata_pipe = 1;
      }
      in_metadata = 0;
      print;
      next;
    }
    { print }
  ' "$config_path" > "$tmp_path" || {
    rm -f "$tmp_path"
    return 1
  }

  run_as_root cp "$tmp_path" "$config_path"
  rm -f "$tmp_path"
}

ensure_shairport_config() {
  config_path="${TIKPAL_SHAIRPORT_SYNC_CONFIG:-/etc/shairport-sync.conf}"
  output_device="${TIKPAL_AIRPLAY_ALSA_OUTPUT_DEVICE:-_audioout}"

  [ -f "$config_path" ] || return 0
  name_ok=1
  if [ -n "$airplay_service_name" ] && ! grep -Fq "name = \"${airplay_service_name}\";" "$config_path"; then
    name_ok=0
  fi
  service_type_ok=1
  if [ -n "$airplay_service_type" ] && ! grep -Fq "service_type = \"${airplay_service_type}\";" "$config_path"; then
    service_type_ok=0
  fi

  if [ "$name_ok" -eq 1 ] \
    && [ "$service_type_ok" -eq 1 ] \
    && grep -Fq "output_device = \"${output_device}\";" "$config_path" \
    && grep -Fq "run_this_before_entering_active_state = \"${airplay_pre_hook_command}\";" "$config_path" \
    && grep -Fq "run_this_after_exiting_active_state = \"${airplay_post_hook_command}\";" "$config_path" \
    && grep -Fq 'wait_for_completion = "yes";' "$config_path" \
    && grep -Fq "cover_art_cache_directory = \"${airplay_artwork_root}\";" "$config_path" \
    && grep -Fq 'enabled = "yes";' "$config_path" \
    && grep -Fq 'include_cover_art = "yes";' "$config_path" \
    && grep -Fq "pipe_name = \"${airplay_metadata_pipe}\";" "$config_path"; then
    return 0
  fi

  write_shairport_config "$config_path" "$output_device" "$airplay_artwork_root" "$airplay_service_name" "$airplay_service_type" "$airplay_metadata_pipe" || return 0
  shairport_config_changed=1
}

shairport_receiver_running() {
  pgrep -f '[s]hairport-sync' >/dev/null 2>&1
}

ensure_loopback_output
ensure_shairport_hooks
ensure_shairport_config

if [ -n "$airplay_artwork_root" ]; then
  run_as_root install -d -o shairport-sync -g shairport-sync -m 775 "$airplay_artwork_root" >/dev/null 2>&1 || true
  run_as_root chown -R shairport-sync:shairport-sync "$airplay_artwork_root" >/dev/null 2>&1 || true
fi

moodeutl -Ro --airplay on

if command -v systemctl >/dev/null 2>&1; then
  systemctl start nqptp.service >/dev/null 2>&1 \
    || sudo -n systemctl start nqptp.service >/dev/null 2>&1 \
    || true

  sleep 2
  if shairport_receiver_running; then
    systemctl reset-failed shairport-sync.service >/dev/null 2>&1 \
      || sudo -n systemctl reset-failed shairport-sync.service >/dev/null 2>&1 \
      || true
  elif [ "$shairport_config_changed" -eq 1 ]; then
    systemctl restart shairport-sync.service >/dev/null 2>&1 \
      || sudo -n systemctl restart shairport-sync.service >/dev/null 2>&1 \
      || true
  elif ! systemctl is-active --quiet shairport-sync.service >/dev/null 2>&1; then
    systemctl reset-failed shairport-sync.service >/dev/null 2>&1 \
      || sudo -n systemctl reset-failed shairport-sync.service >/dev/null 2>&1 \
      || true
    systemctl start shairport-sync.service >/dev/null 2>&1 \
      || sudo -n systemctl start shairport-sync.service >/dev/null 2>&1 \
      || true
  fi
fi

if command -v pgrep >/dev/null 2>&1 && command -v renice >/dev/null 2>&1; then
  for pid in $(pgrep -f 'aplmeta-reader.sh|shairport-sync-metadata-reader|/var/www/util/aplmeta.py' 2>/dev/null || true); do
    renice 15 -p "$pid" >/dev/null 2>&1 || true
  done
fi

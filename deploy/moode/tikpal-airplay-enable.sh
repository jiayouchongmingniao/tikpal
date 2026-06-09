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

write_shairport_output_config() {
  config_path="$1"
  output_device="$2"
  tmp_path="$(mktemp)"

  awk -v output_device="$output_device" '
    !updated && $0 ~ /^[[:space:]]*(\/\/[[:space:]]*)?output_device[[:space:]]*=/ {
      print "\toutput_device = \"" output_device "\";";
      updated = 1;
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

ensure_shairport_output() {
  config_path="${TIKPAL_SHAIRPORT_SYNC_CONFIG:-/etc/shairport-sync.conf}"
  output_device="${TIKPAL_AIRPLAY_ALSA_OUTPUT_DEVICE:-_audioout}"

  [ -f "$config_path" ] || return 0
  if grep -Eq "^[[:space:]]*output_device[[:space:]]*=[[:space:]]*\"${output_device}\";" "$config_path"; then
    return 0
  fi

  if grep -Eq '^[[:space:]]*(//[[:space:]]*)?output_device[[:space:]]*=' "$config_path"; then
    write_shairport_output_config "$config_path" "$output_device" || return 0
    shairport_config_changed=1
  fi
}

ensure_loopback_output
ensure_shairport_output

moodeutl -Ro --airplay on

if [ -d /var/local/www/imagesw/airplay-covers ]; then
  run_as_root chown -R shairport-sync:shairport-sync /var/local/www/imagesw/airplay-covers >/dev/null 2>&1 || true
  run_as_root chmod 775 /var/local/www/imagesw/airplay-covers >/dev/null 2>&1 || true
fi

if command -v systemctl >/dev/null 2>&1; then
  systemctl start nqptp.service >/dev/null 2>&1 \
    || sudo -n systemctl start nqptp.service >/dev/null 2>&1 \
    || true

  sleep 2
  if [ "$shairport_config_changed" -eq 1 ]; then
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

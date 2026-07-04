#!/usr/bin/env bash
set -euo pipefail

SQLDB="${TIKPAL_MOODE_SQLITE_DB:-/var/local/www/db/moode-sqlite3.db}"
SPOTMETA_CACHE_FILE="${TIKPAL_SPOTIFY_METADATA_FILE:-/var/local/www/spotmeta.json}"
ZEROCONF_PORT="${TIKPAL_SPOTIFY_ZEROCONF_PORT:-9000}"
LIBRESPOT_BIN="${TIKPAL_SPOTIFY_LIBRESPOT_BIN:-}"
GO_LIBRESPOT_BIN="${TIKPAL_SPOTIFY_GO_LIBRESPOT_BIN:-}"
GO_LIBRESPOT_CONFIG_DIR="${TIKPAL_SPOTIFY_GO_LIBRESPOT_CONFIG_DIR:-/home/moode/.config/tikpal-go-librespot}"
SPOTIFY_BITRATE="${TIKPAL_SPOTIFY_BITRATE:-160}"
SPOTIFY_DEVICE_NAME="${TIKPAL_SPOTIFY_DEVICE_NAME:-Tikpal-Speaker Spotify}"
SPOTIFY_PROXY_URL="${TIKPAL_SPOTIFY_PROXY_URL:-}"
SPOTIFY_LOG_FILE="${TIKPAL_SPOTIFY_LOG_FILE:-/var/log/moode_librespot.log}"

if [[ ! "$ZEROCONF_PORT" =~ ^[0-9]+$ ]]; then
  echo "invalid TIKPAL_SPOTIFY_ZEROCONF_PORT: $ZEROCONF_PORT" >&2
  exit 1
fi

spotify_ready() {
  curl -fsS --max-time 2 "http://127.0.0.1:${ZEROCONF_PORT}/?action=getInfo" >/dev/null
}

stop_mpd_playback() {
  command -v mpc >/dev/null 2>&1 || return 0
  mpc stop >/dev/null 2>&1 || true
}

stop_librespot_processes() {
  command -v pgrep >/dev/null 2>&1 || return 0
  mapfile -t pids < <(
    pgrep -x librespot 2>/dev/null || true
    pgrep -x go-librespot 2>/dev/null || true
  )
  if ((${#pids[@]} > 0)); then
    sudo kill -9 "${pids[@]}" >/dev/null 2>&1 || true
  fi
}

start_go_librespot() {
  [[ -n "$GO_LIBRESPOT_BIN" && -x "$GO_LIBRESPOT_BIN" ]] || return 1
  local env_args=()
  if [[ -n "$SPOTIFY_PROXY_URL" ]]; then
    env_args=(HTTP_PROXY="$SPOTIFY_PROXY_URL" HTTPS_PROXY="$SPOTIFY_PROXY_URL" ALL_PROXY="$SPOTIFY_PROXY_URL")
  fi

  moodeutl -Ro --spotify off >/dev/null 2>&1 || true
  stop_librespot_processes
  mkdir -p "$GO_LIBRESPOT_CONFIG_DIR"
  rm -f "$SPOTMETA_CACHE_FILE" >/dev/null 2>&1 || true
  : > "$SPOTIFY_LOG_FILE" 2>/dev/null || true

  env "${env_args[@]}" "$GO_LIBRESPOT_BIN" \
    --config_dir "$GO_LIBRESPOT_CONFIG_DIR" \
    -c log_level=debug \
    -c device_name="$SPOTIFY_DEVICE_NAME" \
    -c device_type=speaker \
    -c zeroconf_enabled=true \
    -c zeroconf_port="$ZEROCONF_PORT" \
    -c zeroconf_backend=avahi \
    -c credentials.type=zeroconf \
    -c credentials.zeroconf.persist_credentials=true \
    -c audio_backend=alsa \
    -c audio_device=_audioout \
    -c bitrate="$SPOTIFY_BITRATE" \
    -c initial_volume=20 \
    > "$SPOTIFY_LOG_FILE" 2>&1 &
}

start_custom_librespot() {
  [[ -n "$LIBRESPOT_BIN" && -x "$LIBRESPOT_BIN" ]] || return 1
  local proxy_args=()
  if [[ -n "$SPOTIFY_PROXY_URL" ]]; then
    proxy_args=(--proxy "$SPOTIFY_PROXY_URL")
  fi

  moodeutl -Ro --spotify off >/dev/null 2>&1 || true
  stop_librespot_processes
  rm -f "$SPOTMETA_CACHE_FILE" >/dev/null 2>&1 || true
  : > "$SPOTIFY_LOG_FILE" 2>/dev/null || true

  sudo env LC_ALL=C "$LIBRESPOT_BIN" \
    --name "$SPOTIFY_DEVICE_NAME" \
    --bitrate "$SPOTIFY_BITRATE" \
    --format S16 \
    --mixer softvol \
    --initial-volume 20 \
    --volume-ctrl log \
    --volume-range 60 \
    --zeroconf-port "$ZEROCONF_PORT" \
    --cache /var/local/www/spotify_cache \
    --disable-audio-cache \
    --backend alsa \
    --device _audioout \
    "${proxy_args[@]}" \
    --onevent /var/local/www/commandw/spotevent.sh \
    > "$SPOTIFY_LOG_FILE" 2>&1 &
}

if command -v sqlite3 >/dev/null 2>&1 && [[ -f "$SQLDB" ]]; then
  sqlite3 "$SQLDB" "UPDATE cfg_system SET value='No' WHERE param='rsmafterspot'" >/dev/null 2>&1 || true
  stop_mpd_playback
  if spotify_ready; then
    exit 0
  fi
  sqlite3 "$SQLDB" "UPDATE cfg_system SET value='0' WHERE param='spotactive'" >/dev/null 2>&1 || true
  sqlite3 "$SQLDB" "UPDATE cfg_spotify SET value='$SPOTIFY_BITRATE' WHERE param='bitrate'" >/dev/null 2>&1 || true
  sqlite3 "$SQLDB" "UPDATE cfg_spotify SET value='manual' WHERE param='zeroconf'" >/dev/null 2>&1 || true
  sqlite3 "$SQLDB" "UPDATE cfg_spotify SET value='$ZEROCONF_PORT' WHERE param='zeroconf_port'" >/dev/null 2>&1 || true
fi
rm -f "$SPOTMETA_CACHE_FILE" >/dev/null 2>&1 || true

if start_go_librespot; then
  exit 0
fi

if start_custom_librespot; then
  exit 0
fi

moodeutl -Ro --spotify on

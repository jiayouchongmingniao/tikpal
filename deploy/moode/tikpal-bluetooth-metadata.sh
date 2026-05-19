#!/bin/sh
set -eu

if ! command -v busctl >/dev/null 2>&1; then
  exit 0
fi

player_path="$(
  busctl --system tree org.bluez 2>/dev/null \
    | sed -n 's#.*\(/org/bluez/hci[0-9][0-9]*/dev_[^[:space:]]*/player[0-9][0-9]*\).*#\1#p' \
    | head -n 1
)"

if [ -z "$player_path" ]; then
  exit 0
fi

track="$(
  busctl --system get-property org.bluez "$player_path" org.bluez.MediaPlayer1 Track 2>/dev/null \
    || true
)"
status="$(
  busctl --system get-property org.bluez "$player_path" org.bluez.MediaPlayer1 Status 2>/dev/null \
    || true
)"
position="$(
  busctl --system get-property org.bluez "$player_path" org.bluez.MediaPlayer1 Position 2>/dev/null \
    || true
)"

extract_string() {
  key="$1"
  printf '%s\n' "$track" | sed -n "s/.*\"$key\" s \"\\([^\"]*\\)\".*/\\1/p" | head -n 1
}

extract_artist_array() {
  printf '%s\n' "$track" | sed -n 's/.*"Artist" as [0-9][0-9]* "\([^"]*\)".*/\1/p' | head -n 1
}

extract_uint() {
  key="$1"
  printf '%s\n' "$track" | sed -n "s/.*\"$key\" u \\([0-9][0-9]*\\).*/\\1/p" | head -n 1
}

extract_property_string() {
  printf '%s\n' "$1" | sed -n 's/^s "\([^"]*\)"/\1/p' | head -n 1
}

extract_property_uint() {
  printf '%s\n' "$1" | sed -n 's/^u \([0-9][0-9]*\)/\1/p' | head -n 1
}

decode_busctl_string() {
  value="$1"
  if [ -z "$value" ]; then
    return 0
  fi
  printf '%b' "$value"
}

sanitize_text_value() {
  value="$(decode_busctl_string "$1")"
  normalized="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"
  case "$normalized" in
    "" | "unknown" | "unknow" | "unknown artist" | "unknown album")
      return 0
      ;;
  esac
  printf '%s' "$value"
}

title="$(sanitize_text_value "$(extract_string Title)")"
artist="$(sanitize_text_value "$(extract_string Artist)")"
album="$(sanitize_text_value "$(extract_string Album)")"
duration_ms="$(extract_uint Duration)"
status_value="$(extract_property_string "$status")"
position_ms="$(extract_property_uint "$position")"

if [ -z "$artist" ]; then
  artist="$(sanitize_text_value "$(extract_artist_array)")"
fi

if [ -n "$title" ]; then
  printf 'title=%s\n' "$title"
fi
if [ -n "$artist" ]; then
  printf 'artist=%s\n' "$artist"
fi
if [ -n "$album" ]; then
  printf 'album=%s\n' "$album"
fi
if [ -n "$status_value" ]; then
  printf 'status=%s\n' "$status_value"
fi
if [ -n "$position_ms" ]; then
  printf 'positionMs=%s\n' "$position_ms"
fi
if [ -n "$duration_ms" ]; then
  printf 'durationMs=%s\n' "$duration_ms"
fi

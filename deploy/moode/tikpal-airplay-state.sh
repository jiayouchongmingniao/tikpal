#!/bin/sh
set -eu

mode="${1:-ready}"
db_path="${TIKPAL_MOODE_SQLITE_DB:-/var/local/www/db/moode-sqlite3.db}"

moode_flag_is_set() {
  param="$1"
  command -v sqlite3 >/dev/null 2>&1 || return 1
  value="$(sqlite3 "$db_path" "SELECT value FROM cfg_system WHERE param='${param}';" 2>/dev/null | head -n 1)"
  [ "$value" = "1" ]
}

shairport_mpris_session_is_active() {
  command -v busctl >/dev/null 2>&1 || return 1
  for mpris_service in \
    "${TIKPAL_AIRPLAY_MPRIS_SERVICE:-org.mpris.MediaPlayer2.ShairportSync}" \
    "${TIKPAL_AIRPLAY_MPRIS_LEGACY_SERVICE:-org.gnome.ShairportSync}"; do
    playback_status="$(busctl --system get-property "$mpris_service" /org/mpris/MediaPlayer2 org.mpris.MediaPlayer2.Player PlaybackStatus 2>/dev/null || true)"
    case "$playback_status" in
      *'"Playing"'*|*'"Paused"'*) break ;;
      *) playback_status="" ;;
    esac
  done
  [ -n "$playback_status" ] || return 1

  # MPRIS can outlive a sender briefly. Require an established RAOP client so
  # stale title/artwork does not promote an armed Gentoo receiver to connected.
  command -v ss >/dev/null 2>&1 || return 1
  ss -Htn 2>/dev/null | awk '$1 == "ESTAB" && $4 ~ /:(5000|7000)$/ { found = 1 } END { exit found ? 0 : 1 }'
}

case "$mode" in
  ready)
    moode_flag_is_set "airplaysvc"
    ;;
  active|connected)
    # Gentoo's standalone Shairport Sync does not write moOde's aplactive flag.
    # MPRIS is its live sender-session truth; retain the flag as a moOde fallback.
    shairport_mpris_session_is_active || moode_flag_is_set "aplactive"
    ;;
  receiver)
    if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet shairport-sync.service; then
      exit 0
    fi
    if command -v ss >/dev/null 2>&1 && ss -ltn | awk '$4 ~ /:(5000|7000)$/ { found = 1 } END { exit found ? 0 : 1 }'; then
      exit 0
    fi
    exit 1
    ;;
  *)
    printf 'usage: %s ready|active|receiver\n' "$0" >&2
    exit 2
    ;;
esac

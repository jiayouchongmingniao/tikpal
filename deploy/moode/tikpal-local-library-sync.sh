#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${TIKPAL_APP_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
MPD_MUSIC_ROOT="${TIKPAL_MPD_MUSIC_ROOT:-/var/lib/mpd/music}"
LOCAL_MPD_PREFIX="${TIKPAL_LOCAL_LIBRARY_MPD_PREFIX:-${TIKPAL_MPD_DEFAULT_QUEUE_PATH:-Codex}}"
PUBLIC_ASSETS_ROOT="${TIKPAL_PUBLIC_ASSETS_ROOT:-$APP_DIR/public/assets}"
LOCAL_SOURCE_ROOT="${TIKPAL_LOCAL_LIBRARY_SOURCE_ROOT:-$PUBLIC_ASSETS_ROOT/music}"
LOCAL_IMPORTS_DIR_NAME="${TIKPAL_LOCAL_LIBRARY_IMPORTS_DIR_NAME:-USB Imports}"
MPC_BIN="${TIKPAL_MPC_BIN:-mpc}"
MPD_HOST="${TIKPAL_MPD_HOST:-127.0.0.1}"
MPD_PORT="${TIKPAL_MPD_PORT:-6600}"
MPD_LIBRARY_OWNER="${TIKPAL_MPD_LIBRARY_OWNER:-mpd:audio}"
MPC_UPDATE_TIMEOUT_SECONDS="${TIKPAL_MPC_UPDATE_TIMEOUT_SECONDS:-8}"
RSYNC_BIN="${TIKPAL_RSYNC_BIN:-rsync}"
SUDO=()

warn() {
  printf 'tikpal-local-library-sync: %s\n' "$*" >&2
}

normalize_relative_path() {
  local path_value="$1"
  path_value="${path_value#/}"
  path_value="${path_value%/}"
  case "$path_value" in
    ""|.*|*/../*|../*|*/..) return 1 ;;
    *) printf '%s\n' "$path_value" ;;
  esac
}

select_sudo() {
  local target_dir="$1"
  local parent_dir
  parent_dir="$(dirname "$target_dir")"
  SUDO=()
  if { [ -d "$target_dir" ] && [ -w "$target_dir" ]; } \
    || { [ -L "$target_dir" ] && [ -w "$parent_dir" ]; } \
    || { [ ! -e "$target_dir" ] && [ -w "$parent_dir" ]; }; then
    return
  fi
  if command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
    SUDO=(sudo -n)
    return
  fi
  warn "$MPD_MUSIC_ROOT is not writable; run this helper as root or allow passwordless sudo"
  exit 1
}

run_privileged() {
  if [ "${#SUDO[@]}" -gt 0 ]; then
    "${SUDO[@]}" "$@"
  else
    "$@"
  fi
}

count_audio_files() {
  find "$1" -maxdepth 10 -type f \( \
    -iname '*.aac' -o -iname '*.aif' -o -iname '*.aiff' -o -iname '*.alac' -o \
    -iname '*.flac' -o -iname '*.m4a' -o -iname '*.mp3' -o -iname '*.ogg' -o \
    -iname '*.opus' -o -iname '*.wav' -o -iname '*.wma' \
  \) ! -name '._*' 2>/dev/null | wc -l | tr -d '[:space:]'
}

apply_permissions() {
  local target_dir="$1"
  run_privileged chown -R "$MPD_LIBRARY_OWNER" "$target_dir" 2>/dev/null || true
  run_privileged find "$target_dir" -type d -exec chmod 2775 {} + 2>/dev/null || true
  run_privileged find "$target_dir" -type f -exec chmod 0664 {} + 2>/dev/null || true
}

update_mpd() {
  local prefix="$1"
  if command -v "$MPC_BIN" >/dev/null 2>&1; then
    if command -v timeout >/dev/null 2>&1; then
      timeout -k 1s "${MPC_UPDATE_TIMEOUT_SECONDS}s" "$MPC_BIN" --host "$MPD_HOST" --port "$MPD_PORT" update "$prefix" >/dev/null \
        || warn "mpc update $prefix timed out or failed"
    else
      "$MPC_BIN" --host "$MPD_HOST" --port "$MPD_PORT" update "$prefix" >/dev/null || warn "mpc update $prefix failed"
    fi
  else
    warn "$MPC_BIN not found; local library files were synced but MPD was not refreshed"
  fi
}

check_sync() {
  local safe_prefix
  safe_prefix="$(normalize_relative_path "$LOCAL_MPD_PREFIX")" || {
    warn "invalid local MPD prefix: $LOCAL_MPD_PREFIX"
    exit 2
  }
  local target_dir="$MPD_MUSIC_ROOT/$safe_prefix"
  local tracks=0
  if [ -d "$LOCAL_SOURCE_ROOT" ]; then
    tracks="$(count_audio_files "$LOCAL_SOURCE_ROOT")"
  fi
  printf 'sourceRoot=%s targetDir=%s mpdPrefix=%s audioFiles=%s targetExists=%s\n' \
    "$LOCAL_SOURCE_ROOT" "$target_dir" "$safe_prefix" "$tracks" "$([ -d "$target_dir" ] && printf 1 || printf 0)"
}

apply_sync() {
  local safe_prefix safe_imports_dir
  safe_prefix="$(normalize_relative_path "$LOCAL_MPD_PREFIX")" || {
    warn "invalid local MPD prefix: $LOCAL_MPD_PREFIX"
    exit 2
  }
  safe_imports_dir="$(normalize_relative_path "$LOCAL_IMPORTS_DIR_NAME")" || {
    warn "invalid local imports directory: $LOCAL_IMPORTS_DIR_NAME"
    exit 2
  }
  if [ ! -d "$LOCAL_SOURCE_ROOT" ]; then
    warn "$LOCAL_SOURCE_ROOT not found; skipping local library sync"
    printf 'sourceRoot=%s synced=0 audioFiles=0 mpdPrefix=%s\n' "$LOCAL_SOURCE_ROOT" "$safe_prefix"
    return
  fi
  if [ ! -f "$LOCAL_SOURCE_ROOT/_metadata/library_manifest.json" ]; then
    warn "$LOCAL_SOURCE_ROOT has no _metadata/library_manifest.json; skipping local library sync"
    printf 'sourceRoot=%s synced=0 audioFiles=0 mpdPrefix=%s\n' "$LOCAL_SOURCE_ROOT" "$safe_prefix"
    return
  fi
  if ! command -v "$RSYNC_BIN" >/dev/null 2>&1; then
    warn "$RSYNC_BIN not found; install rsync or set TIKPAL_RSYNC_BIN"
    exit 1
  fi

  local target_dir="$MPD_MUSIC_ROOT/$safe_prefix"
  select_sudo "$target_dir"
  if [ -L "$target_dir" ]; then
    run_privileged unlink "$target_dir"
  fi
  if [ -e "$target_dir" ] && [ ! -d "$target_dir" ]; then
    warn "$target_dir exists and is not a directory"
    exit 1
  fi
  run_privileged mkdir -p "$target_dir"
  rsync_args=(-r --links --delete --filter "P /$safe_imports_dir/***" --exclude '._*')
  run_privileged "$RSYNC_BIN" "${rsync_args[@]}" "$LOCAL_SOURCE_ROOT/" "$target_dir/"
  apply_permissions "$target_dir"
  update_mpd "$safe_prefix"

  printf 'sourceRoot=%s synced=1 audioFiles=%s mpdPrefix=%s\n' \
    "$LOCAL_SOURCE_ROOT" "$(count_audio_files "$LOCAL_SOURCE_ROOT")" "$safe_prefix"
}

case "${1:-apply}" in
  apply|sync)
    apply_sync
    ;;
  check)
    check_sync
    ;;
  *)
    printf 'Usage: %s [apply|sync|check]\n' "$0" >&2
    exit 2
    ;;
esac

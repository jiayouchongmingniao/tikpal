#!/usr/bin/env bash
set -euo pipefail

MPD_MUSIC_ROOT="${TIKPAL_MPD_MUSIC_ROOT:-/var/lib/mpd/music}"
USB_MPD_PREFIX="${TIKPAL_USB_LIBRARY_MPD_PREFIX:-USB}"
USB_LIBRARY_ROOTS="${TIKPAL_USB_LIBRARY_ROOTS:-}"
USB_LIBRARY_AUTO_ROOTS="${TIKPAL_USB_LIBRARY_AUTO_ROOTS:-/media,/run/media}"
MPC_BIN="${TIKPAL_MPC_BIN:-mpc}"
MPD_HOST="${TIKPAL_MPD_HOST:-127.0.0.1}"
MPD_PORT="${TIKPAL_MPD_PORT:-6600}"
MPD_LIBRARY_OWNER="${TIKPAL_MPD_LIBRARY_OWNER:-mpd:audio}"
MPC_UPDATE_TIMEOUT_SECONDS="${TIKPAL_MPC_UPDATE_TIMEOUT_SECONDS:-8}"

warn() {
  printf 'tikpal-usb-library-sync: %s\n' "$*" >&2
}

split_path_list() {
  local value="$1"
  local old_ifs="$IFS"
  local -a parts=()
  IFS=',:' read -r -a parts <<< "$value"
  IFS="$old_ifs"
  for part in "${parts[@]}"; do
    part="${part#"${part%%[![:space:]]*}"}"
    part="${part%"${part##*[![:space:]]}"}"
    [ -n "$part" ] && printf '%s\n' "$part"
  done
}

path_is_within() {
  local base="${1%/}"
  local candidate="${2%/}"
  [ "$candidate" = "$base" ] || [[ "$candidate" == "$base/"* ]]
}

skip_mount_name() {
  local name
  name="$(basename "$1")"
  name="$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')"
  case "$name" in
    ""|.*|boot|bootfs|root|rootfs) return 0 ;;
    *) return 1 ;;
  esac
}

list_mount_targets() {
  if command -v findmnt >/dev/null 2>&1; then
    findmnt -rn -o TARGET
  elif [ -r /proc/mounts ]; then
    awk '{print $2}' /proc/mounts | sed 's/\\040/ /g'
  else
    mount | sed -n 's/^.* on \([^ ]*\) .*$/\1/p'
  fi
}

discover_roots() {
  if [ -n "$USB_LIBRARY_ROOTS" ]; then
    split_path_list "$USB_LIBRARY_ROOTS" | while IFS= read -r root; do
      [ -d "$root" ] && ! skip_mount_name "$root" && printf '%s\n' "$root"
    done
    return
  fi

  auto_roots=()
  while IFS= read -r auto_root; do
    auto_roots+=("$auto_root")
  done < <(split_path_list "$USB_LIBRARY_AUTO_ROOTS")
  list_mount_targets | while IFS= read -r target; do
    [ -d "$target" ] || continue
    skip_mount_name "$target" && continue
    for base in "${auto_roots[@]}"; do
      [ -n "$base" ] || continue
      [ "$target" = "${base%/}" ] && continue
      if path_is_within "$base" "$target"; then
        printf '%s\n' "$target"
        break
      fi
    done
  done | sort -u
}

pick_sudo() {
  local prefix_dir="$1"
  local parent_dir
  parent_dir="$(dirname "$prefix_dir")"
  if [ -L "$prefix_dir" ] && [ -w "$parent_dir" ]; then
    printf ''
    return
  fi
  if [ -L "$prefix_dir" ]; then
    if command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
      printf 'sudo -n '
      return
    fi
    warn "$prefix_dir is a symlink but its parent is not writable; run this helper with sudo or allow passwordless sudo"
    exit 1
  fi
  if [ -d "$prefix_dir" ] && [ -w "$prefix_dir" ]; then
    printf ''
    return
  fi
  if mkdir -p "$prefix_dir" 2>/dev/null && [ -w "$prefix_dir" ]; then
    printf ''
    return
  fi
  if command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
    printf 'sudo -n '
    return
  fi
  warn "$MPD_MUSIC_ROOT is not writable; run this helper with sudo or allow passwordless sudo for the library scan command"
  exit 1
}

make_mount_id() {
  local root="$1"
  local base
  base="$(basename "$root")"
  [ -n "$base" ] && [ "$base" != "." ] || base="drive"
  printf '%s\n' "$base"
}

count_audio_files() {
  find "$1" -maxdepth 10 -type f \( \
    -iname '*.aac' -o -iname '*.aif' -o -iname '*.aiff' -o -iname '*.alac' -o \
    -iname '*.flac' -o -iname '*.m4a' -o -iname '*.mp3' -o -iname '*.ogg' -o \
    -iname '*.opus' -o -iname '*.wav' -o -iname '*.wma' \
  \) ! -name '._*' 2>/dev/null | wc -l | tr -d '[:space:]'
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
    warn "$MPC_BIN not found; symlinks were updated but MPD was not refreshed"
  fi
}

apply_sync() {
  roots=()
  while IFS= read -r root; do
    roots+=("$root")
  done < <(discover_roots)
  local prefix_dir="$MPD_MUSIC_ROOT/$USB_MPD_PREFIX"
  local sudo_prefix
  sudo_prefix="$(pick_sudo "$prefix_dir")"
  if [ -L "$prefix_dir" ]; then
    ${sudo_prefix}rm -f "$prefix_dir"
  fi
  ${sudo_prefix}mkdir -p "$prefix_dir"
  ${sudo_prefix}chown "$MPD_LIBRARY_OWNER" "$prefix_dir" 2>/dev/null || true
  ${sudo_prefix}chmod 2775 "$prefix_dir" 2>/dev/null || true

  declare -A active_ids=()
  declare -A id_counts=()
  local linked=0
  local tracks=0

  for root in "${roots[@]}"; do
    [ -d "$root" ] || continue
    local id
    id="$(make_mount_id "$root")"
    local next_count="${id_counts[$id]:-0}"
    id_counts[$id]=$((next_count + 1))
    if [ "$next_count" -gt 0 ]; then
      id="$id-$((next_count + 1))"
    fi
    active_ids[$id]=1

    local link_path="$prefix_dir/$id"
    if [ -e "$link_path" ] && [ ! -L "$link_path" ]; then
      warn "$link_path exists and is not a symlink; leaving it untouched"
      continue
    fi
    ${sudo_prefix}ln -sfn "$root" "$link_path"
    linked=$((linked + 1))
    tracks=$((tracks + $(count_audio_files "$root")))
  done

  if [ -d "$prefix_dir" ]; then
    while IFS= read -r stale_link; do
      local stale_id
      stale_id="$(basename "$stale_link")"
      if [ -z "${active_ids[$stale_id]:-}" ]; then
        ${sudo_prefix}rm -f "$stale_link"
      fi
    done < <(find "$prefix_dir" -maxdepth 1 -mindepth 1 -type l 2>/dev/null)
  fi

  update_mpd "$USB_MPD_PREFIX"

  printf 'usbRoots=%s linked=%s audioFiles=%s mpdPrefix=%s\n' "${#roots[@]}" "$linked" "$tracks" "$USB_MPD_PREFIX"
}

case "${1:-apply}" in
  apply|sync)
    apply_sync
    ;;
  check)
    discover_roots
    ;;
  *)
    printf 'Usage: %s [apply|sync|check]\n' "$0" >&2
    exit 2
    ;;
esac

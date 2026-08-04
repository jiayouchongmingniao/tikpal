#!/bin/sh
set -eu

action="${1:-mount}"

die() {
  printf '%s\n' "$*" >&2
  exit 1
}

require_env() {
  var_name="$1"
  eval "value=\${$var_name:-}"
  [ -n "$value" ] || die "$var_name is required"
}

is_mounted() {
  findmnt -rn --mountpoint "$1" >/dev/null 2>&1
}

case "$action" in
  mount)
    require_env TIKPAL_NAS_REMOTE
    require_env TIKPAL_NAS_MOUNT_POINT
    require_env TIKPAL_NAS_CONTENT_ROOT
    require_env TIKPAL_NAS_MPD_ENTRY

    auth_mode="${TIKPAL_NAS_AUTH_MODE:-guest}"
    port="${TIKPAL_NAS_PORT:-445}"
    smb_version="${TIKPAL_NAS_SMB_VERSION:-3.0}"
    mount_options="ro,uid=mpd,gid=audio,iocharset=utf8,nounix,soft,port=${port},vers=${smb_version}"

    if [ "$auth_mode" = "password" ]; then
      require_env TIKPAL_NAS_CREDENTIALS
      [ -r "$TIKPAL_NAS_CREDENTIALS" ] || die "credential file is not readable"
      mount_options="${mount_options},credentials=${TIKPAL_NAS_CREDENTIALS}"
    else
      mount_options="${mount_options},guest"
    fi

    mkdir -p "$TIKPAL_NAS_MOUNT_POINT" "$(dirname "$TIKPAL_NAS_MPD_ENTRY")"
    if ! is_mounted "$TIKPAL_NAS_MOUNT_POINT"; then
      mount -t cifs "$TIKPAL_NAS_REMOTE" "$TIKPAL_NAS_MOUNT_POINT" -o "$mount_options"
    fi

    [ -d "$TIKPAL_NAS_CONTENT_ROOT" ] || die "NAS folder is not readable"
    mkdir -p "$TIKPAL_NAS_MPD_ENTRY"
    if ! is_mounted "$TIKPAL_NAS_MPD_ENTRY"; then
      mount --bind "$TIKPAL_NAS_CONTENT_ROOT" "$TIKPAL_NAS_MPD_ENTRY"
    fi
    ;;
  unmount)
    require_env TIKPAL_NAS_MOUNT_POINT
    require_env TIKPAL_NAS_MPD_ENTRY

    if is_mounted "$TIKPAL_NAS_MPD_ENTRY"; then
      umount "$TIKPAL_NAS_MPD_ENTRY"
    fi
    if is_mounted "$TIKPAL_NAS_MOUNT_POINT"; then
      umount "$TIKPAL_NAS_MOUNT_POINT"
    fi
    ;;
  *)
    die "Usage: $0 mount|unmount"
    ;;
esac

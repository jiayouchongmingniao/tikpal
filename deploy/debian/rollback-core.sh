#!/usr/bin/env bash
set -euo pipefail
SERVICE_USER="${1:-${SUDO_USER:-}}"
[[ $(id -u) == 0 && -n "$SERVICE_USER" && "$SERVICE_USER" != root ]] || { echo 'Usage: sudo bash deploy/debian/rollback-core.sh USER' >&2; exit 1; }
SERVICE_HOME="$(getent passwd "$SERVICE_USER" | cut -d: -f6)"
SERVICE_UID="$(id -u "$SERVICE_USER")"
BACKUP="$SERVICE_HOME/tikpal-migration/install-backup"
[[ -f "$BACKUP/manifest.tsv" ]] || { echo 'No installation manifest' >&2; exit 1; }
user_systemctl() {
  runuser -u "$SERVICE_USER" -- env XDG_RUNTIME_DIR="/run/user/$SERVICE_UID" \
    DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$SERVICE_UID/bus" systemctl --user "$@"
}
user_systemctl stop tikpal-debian.target
while IFS=$'\t' read -r state target; do
  # Keep runtime user data, even if this installation originally created it.
  [[ "$target" != /var/lib/tikpal/radio.sqlite3 ]] || continue
  case "$state" in
    existing) cp -a "$BACKUP/files$target" "$target" ;;
    new) rm -f -- "$target" ;;
    *) echo 'Invalid backup manifest' >&2; exit 1 ;;
  esac
done < "$BACKUP/manifest.tsv"
user_systemctl daemon-reload
if [[ -f "$BACKUP/ssh.service.enabled" && "$(cat "$BACKUP/ssh.service.enabled")" == disabled ]]; then
  # Restore boot policy without interrupting the current remote recovery session.
  systemctl disable ssh.service
fi
if grep -q $'^mpd\t' "$BACKUP/packages-before.tsv"; then
  for unit in mpd.service mpd.socket; do
    if [[ "$(cat "$BACKUP/$unit.enabled")" == enabled ]]; then systemctl enable "$unit"; fi
  done
fi
echo 'Tikpal services removed/restored. Source, profiles, database and installed dependencies retained.'

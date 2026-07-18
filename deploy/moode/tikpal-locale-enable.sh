#!/usr/bin/env bash
set -euo pipefail

LOCALE_NAME="${TIKPAL_SSH_LOCALE:-C.UTF-8}"
SSHD_DROPIN_DIR="${TIKPAL_SSHD_CONFIG_DIR:-/etc/ssh/sshd_config.d}"
SSHD_DROPIN="$SSHD_DROPIN_DIR/99-tikpal-locale.conf"

log() {
  printf '[tikpal-locale] %s\n' "$*"
}

fail() {
  printf '[tikpal-locale] ERROR: %s\n' "$*" >&2
  exit 1
}

require_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    fail "Please run with sudo so SSH and system locale config can be updated."
  fi
}

find_sshd_bin() {
  local candidate
  for candidate in /usr/sbin/sshd /usr/local/sbin/sshd; do
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  command -v sshd 2>/dev/null || return 1
}

reload_sshd() {
  if systemctl list-unit-files ssh.service --no-legend 2>/dev/null | grep -q '^ssh\.service'; then
    systemctl reload ssh.service || systemctl restart ssh.service
    return
  fi

  if systemctl list-unit-files sshd.service --no-legend 2>/dev/null | grep -q '^sshd\.service'; then
    systemctl reload sshd.service || systemctl restart sshd.service
    return
  fi

  log "WARN: ssh.service not found; SSH config will apply on the next sshd restart"
}

require_root

SSHD_BIN="$(find_sshd_bin)" || fail "sshd binary not found"

mkdir -p "$SSHD_DROPIN_DIR"
cat > "$SSHD_DROPIN" <<EOF
# Tikpal appliance default: macOS can send LC_CTYPE=UTF-8, which is not a
# valid Debian locale name. Force SSH sessions onto Debian's built-in UTF-8
# locale before the user's login shell starts.
SetEnv LANG=$LOCALE_NAME LC_CTYPE=$LOCALE_NAME
EOF
chmod 0644 "$SSHD_DROPIN"

if command -v update-locale >/dev/null 2>&1; then
  update-locale LANG="$LOCALE_NAME" LC_CTYPE="$LOCALE_NAME"
else
  cat > /etc/default/locale <<EOF
LANG=$LOCALE_NAME
LC_CTYPE=$LOCALE_NAME
EOF
fi

"$SSHD_BIN" -t
reload_sshd

log "installed $SSHD_DROPIN"
log "default locale: $LOCALE_NAME"

#!/usr/bin/env bash
# Allow the local Tikpal API to perform only the two system-power actions it exposes.
set -euo pipefail

SERVICE_USER="${1:-${SUDO_USER:-}}"
[[ $(id -u) == 0 && -n "$SERVICE_USER" && "$SERVICE_USER" != root ]] || {
  echo "Usage: sudo bash $0 USER" >&2
  exit 1
}
[[ "$SERVICE_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] || {
  echo "Invalid service user" >&2
  exit 1
}

SYSTEMCTL=/usr/bin/systemctl
SUDOERS_FILE=/etc/sudoers.d/tikpal-system-power
[[ -x "$SYSTEMCTL" ]] || {
  echo "Expected $SYSTEMCTL" >&2
  exit 1
}
command -v visudo >/dev/null 2>&1 || {
  echo "visudo is required" >&2
  exit 1
}

candidate="$(mktemp "${SUDOERS_FILE}.new.XXXXXX")"
cleanup() {
  [[ -e "$candidate" ]] && unlink "$candidate"
}
trap cleanup EXIT

cat > "$candidate" <<EOF
# Managed by Tikpal Debian installation. Do not broaden this command list.
$SERVICE_USER ALL=(root) NOPASSWD: $SYSTEMCTL --no-wall --no-block reboot, $SYSTEMCTL --no-wall --no-block poweroff
EOF
chmod 0440 "$candidate"
visudo -cf "$candidate"

if [[ -e "$SUDOERS_FILE" ]] && ! cmp -s "$candidate" "$SUDOERS_FILE"; then
  echo "Refusing to replace an unrelated $SUDOERS_FILE" >&2
  exit 1
fi

install -o root -g root -m 0440 "$candidate" "$SUDOERS_FILE"
visudo -cf "$SUDOERS_FILE"

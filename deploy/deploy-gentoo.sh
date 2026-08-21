#!/usr/bin/env bash
set -euo pipefail

# Deploy tikpal to a remote Gentoo/Pi device.
# Preserves .env.kiosk, .env, and .tikpal/ on the remote.
# Fixes ownership after rsync (rsync runs as root, services run as moode).
# Reinstalls the synchronized non-kiosk systemd units before restarting the
# physical kiosk, so service definitions and device-local configuration stay
# aligned with the released code.
# Backs up remote .env.kiosk with timestamp before each deploy.
# Uses the SSH agent by default. Set TIKPAL_DEPLOY_PASSWORD only for a
# one-off password-authenticated deployment; never put it in an env file.
#
# Usage: ./deploy/deploy-gentoo.sh [--host HOST] [--user USER] [--proxy PROXY]
#   Defaults: host=192.168.10.115, user=root, proxy=127.0.0.1:7897

HOST="${TIKPAL_DEPLOY_HOST:-192.168.10.115}"
USER="${TIKPAL_DEPLOY_USER:-root}"
PROXY="${TIKPAL_DEPLOY_PROXY:-127.0.0.1:7897}"
REMOTE_DIR="/home/moode/code/tikpal"
SERVICE_USER="moode"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) HOST="$2"; shift 2 ;;
    --user) USER="$2"; shift 2 ;;
    --proxy) PROXY="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: $0 [--host HOST] [--user USER] [--proxy PROXY]"
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

SSH_OPTS=(-o StrictHostKeyChecking=no -o ConnectTimeout=5)
RSYNC_SSH="ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5"
if [[ -n "$PROXY" ]]; then
  proxy_command="ProxyCommand=nc -X connect -x $PROXY %h %p"
  SSH_OPTS+=(-o "$proxy_command")
  RSYNC_SSH+=" -o \"$proxy_command\""
fi

ssh_cmd() {
  if [[ -n "${TIKPAL_DEPLOY_PASSWORD:-}" ]]; then
    SSHPASS="$TIKPAL_DEPLOY_PASSWORD" sshpass -e ssh "${SSH_OPTS[@]}" "${USER}@${HOST}" "$@"
  else
    ssh "${SSH_OPTS[@]}" "${USER}@${HOST}" "$@"
  fi
}

rsync_cmd() {
  if [[ -n "${TIKPAL_DEPLOY_PASSWORD:-}" ]]; then
    SSHPASS="$TIKPAL_DEPLOY_PASSWORD" sshpass -e rsync "$@"
  else
    rsync "$@"
  fi
}

check_remote_source_command_compatibility() {
  ssh_cmd "cd '$REMOTE_DIR' || exit 2
invalid=0
for env_file in .env .env.kiosk; do
  [ -f \"\$env_file\" ] || continue
  if ! awk '
    /^[[:space:]]*TIKPAL_(SPOTIFY|BLUETOOTH|AIRPLAY|UPNP)_(ACTIVATE|ENABLE|DISABLE)_COMMAND=/ && /moodeutl/ {
      key = \$0
      sub(/^[[:space:]]*/, \"\", key)
      sub(/=.*/, \"\", key)
      print FILENAME \": \" key \" must not invoke moodeutl on Gentoo\"
      invalid = 1
    }
    END { exit invalid }
  ' \"\$env_file\"; then
    invalid=1
  fi
done
if [ \"\$invalid\" -ne 0 ]; then
  echo \"Gentoo deployment blocked: replace bare moodeutl source commands with Tikpal helpers.\" >&2
  exit 1
fi"
}

echo "=== Deploying to ${USER}@${HOST} ==="

echo "--- Checking Gentoo source commands ---"
check_remote_source_command_compatibility

# Build
echo "--- Building ---"
cd "$APP_DIR"
npm run build

# Backup remote .env.kiosk with timestamp
echo "--- Backing up remote .env.kiosk ---"
ssh_cmd "cd $REMOTE_DIR && cp .env.kiosk .env.kiosk.bak.\$(date +%Y%m%d%H%M%S) 2>/dev/null || true"

# Rsync with exclusions for env files and local state
echo "--- Syncing files ---"
rsync_cmd -az --delete \
  --exclude='node_modules' \
  --exclude='.env' \
  --exclude='.env.*' \
  --exclude='.tikpal/' \
  --exclude='.codex/' \
  --exclude='.env.kiosk.bak.*' \
  --exclude='deploy/chromium/tikpal-web-mode.sh.bak' \
  --exclude='deploy/chromium/tikpal-web-mode.sh.pre-*' \
  --exclude='.git' \
  -e "$RSYNC_SSH" \
  "$APP_DIR/" "${USER}@${HOST}:${REMOTE_DIR}/"

# Fix ownership (rsync as root changes owner to root)
echo "--- Fixing ownership ---"
ssh_cmd "chown -R ${SERVICE_USER}: ${REMOTE_DIR}/"

# Install the synchronized API/web/audio units. This also performs the guarded
# DLNA recognition-tap preflight without replacing device-local .env files.
echo "--- Installing synchronized systemd services ---"
ssh_cmd "cd '$REMOTE_DIR' && ./deploy/systemd/install-systemd-services.sh --app-dir '$REMOTE_DIR' --user '$SERVICE_USER' --restart"

# The installer intentionally leaves the existing physical kiosk unit alone;
# restart it here to load the newly built frontend and kiosk scripts.
echo "--- Restarting kiosk and verifying services ---"
ssh_cmd "systemctl restart tikpal-kiosk && systemctl is-active --quiet tikpal-api tikpal-web tikpal-kiosk && curl -fsS http://127.0.0.1:8787/api/v1/health >/dev/null"

echo "=== Deploy complete ==="

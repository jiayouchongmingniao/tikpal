#!/usr/bin/env bash
set -euo pipefail

# Deploy tikpal to a remote Gentoo/Pi device.
# Preserves .env.kiosk, .env, and .tikpal/ on the remote.
# Fixes ownership after rsync (rsync runs as root, services run as moode).
# Backs up remote .env.kiosk with timestamp before each deploy.
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

SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=5"
if [[ -n "$PROXY" ]]; then
  if command -v ncat >/dev/null 2>&1; then
    SSH_OPTS="$SSH_OPTS -o ProxyCommand=ncat --proxy $PROXY --proxy-type http %h %p"
  else
    SSH_OPTS="$SSH_OPTS -o ProxyCommand=nc -X 5 -x $PROXY %h %p"
  fi
fi

ssh_cmd() {
  sshpass -p moode ssh $SSH_OPTS "${USER}@${HOST}" "$@"
}

echo "=== Deploying to ${USER}@${HOST} ==="

# Build
echo "--- Building ---"
cd "$APP_DIR"
npm run build

# Backup remote .env.kiosk with timestamp
echo "--- Backing up remote .env.kiosk ---"
ssh_cmd "cd $REMOTE_DIR && cp .env.kiosk .env.kiosk.bak.\$(date +%Y%m%d%H%M%S) 2>/dev/null || true"

# Rsync with exclusions for env files and local state
echo "--- Syncing files ---"
sshpass -p moode rsync -az --delete \
  --exclude='node_modules' \
  --exclude='.env' \
  --exclude='.env.*' \
  --exclude='.tikpal/' \
  --exclude='.env.kiosk.bak.*' \
  --exclude='.git' \
  -e "ssh $SSH_OPTS" \
  "$APP_DIR/" "${USER}@${HOST}:${REMOTE_DIR}/"

# Fix ownership (rsync as root changes owner to root)
echo "--- Fixing ownership ---"
ssh_cmd "chown -R ${SERVICE_USER}: ${REMOTE_DIR}/"

# Restart services
echo "--- Restarting services ---"
ssh_cmd "systemctl restart tikpal-api tikpal-kiosk || true"

echo "=== Deploy complete ==="

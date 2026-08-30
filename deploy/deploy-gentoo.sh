#!/usr/bin/env bash
set -euo pipefail

# Deploy tikpal to a remote Gentoo/Pi device.
# Preserves .env.kiosk, .env, and .tikpal/ on the remote.
# Fixes ownership after rsync (rsync runs as root, services run as moode).
# Reinstalls the synchronized non-kiosk systemd units and read-only native X11
# helper before restarting the physical kiosk, so service definitions and
# device-local configuration stay aligned with the released code.
# Backs up remote .env.kiosk with timestamp before each deploy.
# Uses the SSH agent by default. Set TIKPAL_DEPLOY_PASSWORD only for a
# one-off password-authenticated deployment; never put it in an env file.
#
# Usage: ./deploy/deploy-gentoo.sh [--host HOST] [--user USER] [--proxy PROXY]
#                                  [--local-preflight] [--allow-dirty]
#   Defaults: host=192.168.10.115, user=root, proxy=127.0.0.1:7897

HOST="${TIKPAL_DEPLOY_HOST:-192.168.10.115}"
USER="${TIKPAL_DEPLOY_USER:-root}"
PROXY="${TIKPAL_DEPLOY_PROXY:-127.0.0.1:7897}"
REMOTE_DIR="/home/moode/code/tikpal"
SERVICE_USER="moode"
LOCAL_PREFLIGHT=0
ALLOW_DIRTY=0
WORKTREE_DIRTY=0

usage() {
  cat <<USAGE
Usage: $0 [--host HOST] [--user USER] [--proxy PROXY] [options]

Options:
  --local-preflight  Run repository-only release checks; never call SSH or rsync
  --allow-dirty      Explicitly allow tracked or untracked workspace changes
  -h, --help         Show this help
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) HOST="$2"; shift 2 ;;
    --user) USER="$2"; shift 2 ;;
    --proxy) PROXY="$2"; shift 2 ;;
    --local-preflight) LOCAL_PREFLIGHT=1; shift ;;
    --allow-dirty) ALLOW_DIRTY=1; shift ;;
    -h|--help)
      usage
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

check_worktree_policy() {
  command -v git >/dev/null 2>&1 || return 0
  git -C "$APP_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 0

  local status
  status="$(git -C "$APP_DIR" status --short --untracked-files=all)"
  [[ -n "$status" ]] || return 0
  WORKTREE_DIRTY=1

  printf '%s\n' "--- Dirty worktree ---" >&2
  printf '%s\n' "$status" >&2
  if [[ "$ALLOW_DIRTY" -eq 1 ]]; then
    printf '%s\n' "WARN: --allow-dirty permits every listed tracked and untracked file to enter the broad rsync deployment." >&2
  elif [[ "$LOCAL_PREFLIGHT" -eq 1 ]]; then
    printf '%s\n' "WARN: local checks will continue, but broad deployment remains blocked for this dirty worktree." >&2
  else
    printf '%s\n' "Deployment blocked: review the exact files, commit/stage a clean release, or pass --allow-dirty explicitly." >&2
    return 1
  fi
}

run_local_preflight() {
  local required relative script digest
  local audio_staging_files=(
    "deploy/moode/tikpal-alsa-loopback.sh"
    "deploy/moode/tikpal-audio-adapt.sh"
    "deploy/moode/tikpal-audio-output-profile.sh"
    "deploy/systemd/tikpal-audio-adapt.service"
    "deploy/udev/70-tikpal-usb-audio-display-power.rules"
  )
  local required_files=(
    "$APP_DIR/.env.example"
    "$APP_DIR/deploy/moode/tikpal-alsa-loopback.sh"
    "$APP_DIR/deploy/moode/tikpal-audio-adapt.sh"
    "$APP_DIR/deploy/moode/tikpal-audio-output-profile.sh"
    "$APP_DIR/deploy/systemd/install-systemd-services.sh"
    "$APP_DIR/deploy/udev/70-tikpal-usb-audio-display-power.rules"
  )
  local shell_scripts=(
    "$APP_DIR/deploy/deploy-gentoo.sh"
    "$APP_DIR/deploy/moode/"*.sh
    "$APP_DIR/deploy/systemd/install-systemd-services.sh"
  )

  printf '%s\n' "=== Tikpal local deployment preflight ==="
  printf 'target=%s@%s:%s (not contacted)\n' "$USER" "$HOST" "$REMOTE_DIR"
  for required in "${required_files[@]}"; do
    [[ -f "$required" ]] || {
      printf 'Missing deployment input: %s\n' "$required" >&2
      return 1
    }
  done
  for script in "${shell_scripts[@]}"; do
    bash -n "$script"
  done

  cd "$APP_DIR"
  npm run typecheck
  npm run build
  npm run test:kiosk
  [[ -s "$APP_DIR/dist/index.html" ]] || {
    printf '%s\n' "Build did not produce dist/index.html" >&2
    return 1
  }
  git diff --check
  printf '%s\n' "audioStagingManifest<<EOF"
  for relative in "${audio_staging_files[@]}"; do
    if command -v sha256sum >/dev/null 2>&1; then
      digest="$(sha256sum "$APP_DIR/$relative" | awk '{ print $1 }')"
    else
      digest="$(shasum -a 256 "$APP_DIR/$relative" | awk '{ print $1 }')"
    fi
    printf '%s  %s\n' "$digest" "$relative"
  done
  printf '%s\n' "EOF"
  printf '%s\n' "preflight=passed"
  if [[ "$WORKTREE_DIRTY" -eq 1 && "$ALLOW_DIRTY" -ne 1 ]]; then
    printf '%s\n' "broadDeployReady=0"
  else
    printf '%s\n' "broadDeployReady=1"
  fi
  printf '%s\n' "remoteActions=0"
}

check_worktree_policy
if [[ "$LOCAL_PREFLIGHT" -eq 1 ]]; then
  run_local_preflight
  exit 0
fi

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
  --include='/.env.example' \
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
ssh_cmd "cd '$REMOTE_DIR' && ./deploy/systemd/install-systemd-services.sh --app-dir '$REMOTE_DIR' --user '$SERVICE_USER' --enable-x11-helper --restart"

# The installer intentionally leaves the existing physical kiosk unit alone;
# restart it here to load the newly built frontend and kiosk scripts.
echo "--- Restarting kiosk and verifying services ---"
ssh_cmd "systemctl restart tikpal-kiosk && systemctl is-active --quiet tikpal-api tikpal-web tikpal-kiosk && curl -fsS http://127.0.0.1:8787/api/v1/health >/dev/null"

echo "=== Deploy complete ==="

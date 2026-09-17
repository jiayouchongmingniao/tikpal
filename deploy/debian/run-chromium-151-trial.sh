#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
KIOSK_UNIT="${TIKPAL_KIOSK_UNIT:-tikpal-debian-kiosk.service}"
CANDIDATE_BIN="${TIKPAL_CHROMIUM_151_BIN:-/opt/tikpal-chromium-151.0.7922.173-arm64/chromium}"
LAUNCHER="$APP_DIR/deploy/chromium/launch-tikpal-kiosk.sh"
DURATION_SECONDS="${TIKPAL_CHROMIUM_151_TRIAL_DURATION_SECONDS:-1800}"
MODE="${1:---run}"

if [[ "$MODE" != "--check" && "$MODE" != "--run" ]]; then
  printf 'Usage: %s [--check|--run]\n' "$0" >&2
  exit 64
fi

[[ -x "$CANDIDATE_BIN" ]] || { printf 'Chromium 151 is not executable: %s\n' "$CANDIDATE_BIN" >&2; exit 1; }
[[ -x "$LAUNCHER" ]] || { printf 'Kiosk launcher is not executable: %s\n' "$LAUNCHER" >&2; exit 1; }
[[ "$DURATION_SECONDS" =~ ^[1-9][0-9]*$ ]] || { printf 'Trial duration must be a positive integer\n' >&2; exit 64; }

if [[ "$MODE" == "--check" ]]; then
  if [[ -f "$HOME/.config/tikpal/session.env" ]]; then
    set -a
    source "$HOME/.config/tikpal/session.env"
    set +a
  fi
  printf 'candidate=%s\n' "$CANDIDATE_BIN"
  printf 'duration_seconds=%s\n' "$DURATION_SECONDS"
  printf 'kiosk_state=%s\n' "$(systemctl --user is-active "$KIOSK_UNIT" 2>/dev/null || true)"
  printf 'display=%s\n' "${DISPLAY:-unset}"
  printf 'xauthority=%s\n' "${XAUTHORITY:-unset}"
  exit 0
fi

if ! systemctl --user is-active --quiet "$KIOSK_UNIT"; then
  printf 'Refusing trial because %s is not active\n' "$KIOSK_UNIT" >&2
  exit 1
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
trial_dir="${TIKPAL_CHROMIUM_151_TRIAL_DIR:-$HOME/.local/state/tikpal/chromium151-trials/$stamp}"
profile_dir="$trial_dir/profile"
flags_file="$trial_dir/chromium-flags.conf"
log_file="$trial_dir/chromium.log"
result_file="$trial_dir/result.env"
mkdir -p "$trial_dir"

set -a
source "$APP_DIR/.env.kiosk"
source "$HOME/.config/tikpal/session.env"
set +a

export TIKPAL_KIOSK_SKIP_ENV_SOURCE=1
export TIKPAL_CHROMIUM_BIN="$CANDIDATE_BIN"
export TIKPAL_CHROMIUM_PROFILE_DIR="$profile_dir"
export TIKPAL_CHROMIUM_FLAGS_FILE="$flags_file"
export TIKPAL_CHROMIUM_ENABLE_FEATURES=AcceleratedVideoDecoder
export TIKPAL_KIOSK_XRANDR_MODE=none
export TIKPAL_KIOSK_REMOTE_DEBUG=1
export TIKPAL_KIOSK_REMOTE_DEBUG_PORT=9322
export TIKPAL_WEB_MODE_BOOT_PREWARM_ENABLED=0

cat >"$flags_file" <<'EOF'
--use-gl=angle
--use-angle=gles-egl
--use-cmd-decoder=passthrough
--ignore-gpu-blacklist
--ignore-gpu-blocklist
--enable-accelerated-video-decode
--disable-features=ContextualTasksContext,ContextualTasks,Translate,InterestFeedContentSuggestions,MediaRouter,OptimizationHints,OptimizationGuideModelExecution,OptimizationGuideOnDeviceModel,StatusBubble,PaintHolding
--no-first-run
--no-default-browser-check
--disable-session-crashed-bubble
--disable-infobars
--autoplay-policy=no-user-gesture-required
--overscroll-history-navigation=0
--disable-pinch
--hide-scrollbars
--disable-smooth-scrolling
--disable-low-res-tiling
--disable-backgrounding-occluded-windows
--disable-renderer-backgrounding
--default-background-color=000000
--password-store=basic
--use-mock-keychain
--enable-logging=stderr
--vmodule=*v4l2*=3,*video_decoder*=2,*gpu_video*=2
--disable-breakpad
EOF

stopped_kiosk=0
trial_pid=""
trial_started_seconds=0
trial_elapsed_seconds=0
restoring=0
restore_kiosk() {
  local result="$1"
  local code="$2"
  (( restoring )) && return
  restoring=1
  if [[ -n "$trial_pid" ]] && kill -0 "$trial_pid" 2>/dev/null; then
    kill -TERM "$trial_pid" 2>/dev/null || true
    wait "$trial_pid" 2>/dev/null || true
  fi
  printf 'finished_at=%s\nresult=%s\nexit_code=%s\nelapsed_seconds=%s\n' "$(date -u +%FT%TZ)" "$result" "$code" "$trial_elapsed_seconds" >>"$result_file"
  if (( stopped_kiosk )); then
    systemctl --user start "$KIOSK_UNIT" || true
  fi
}

trial_result="interrupted"
trial_status=1
trap 'restore_kiosk "$trial_result" "$trial_status"' EXIT
trap 'trial_result="interrupted"; trial_status=130; exit 130' INT TERM

printf 'started_at=%s\ncandidate=%s\nduration_seconds=%s\n' "$(date -u +%FT%TZ)" "$CANDIDATE_BIN" "$DURATION_SECONDS" >"$result_file"
ulimit -c unlimited
cd "$trial_dir"
systemctl --user stop "$KIOSK_UNIT"
stopped_kiosk=1

set +e
trial_started_seconds=$SECONDS
timeout --foreground --preserve-status --kill-after=20s "${DURATION_SECONDS}s" bash "$LAUNCHER" >"$log_file" 2>&1 &
trial_pid=$!
wait "$trial_pid"
trial_status=$?
trial_elapsed_seconds=$((SECONDS - trial_started_seconds))
trial_pid=""
set -e

if (( trial_elapsed_seconds >= DURATION_SECONDS )); then
  trial_result="duration_complete"
elif [[ "$trial_status" == "0" ]]; then
  trial_result="exited_cleanly"
else
  trial_result="failed"
fi

exit "$trial_status"

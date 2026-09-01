#!/usr/bin/env bash
set -euo pipefail

SCRIPT_SOURCE="${BASH_SOURCE[0]:-$0}"
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_SOURCE")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="${TIKPAL_KIOSK_ENV_FILE:-$APP_DIR/.env.kiosk}"
export TIKPAL_APP_DIR="${TIKPAL_APP_DIR:-$APP_DIR}"
FLAGS_FILE="${TIKPAL_CHROMIUM_FLAGS_FILE:-$SCRIPT_DIR/chromium-flags.conf}"
WEB_MODE_COMMAND_ARGS=("$@")

should_source_env_file() {
  local value
  value="$(printf '%s' "${TIKPAL_KIOSK_SKIP_ENV_SOURCE:-0}" | tr '[:upper:]' '[:lower:]')"
  [[ "$value" != "1" && "$value" != "true" && "$value" != "yes" && "$value" != "on" ]]
}

if should_source_env_file && [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

: "${TIKPAL_KIOSK_DISPLAY:=:0}"
: "${TIKPAL_CHROMIUM_BIN:=/usr/lib/chromium-browser/chromium-browser}"
# When running as root (e.g. via SSH), $HOME is /root but the kiosk data
# lives under the kiosk user's home.  Detect it from the running Chromium
# process or fall back to the first /home/* user with a tikpal-web-mode dir.
if [[ "$(id -u)" == "0" && "$HOME" != "/home/"* ]]; then
  _kiosk_home="$(ps -eo user,args 2>/dev/null | awk '/chromium.*--user-data-dir=.*tikpal-web-mode/ && !/root/{print $1; exit}' | head -1)"
  if [[ -n "$_kiosk_home" ]]; then
    _kiosk_home="$(eval echo "~$_kiosk_home" 2>/dev/null || true)"
  fi
  if [[ -z "$_kiosk_home" || ! -d "$_kiosk_home" ]]; then
    _kiosk_home="$(ls -d /home/*/.config/tikpal-web-mode 2>/dev/null | head -1 | sed 's|/.config/tikpal-web-mode||')"
  fi
  if [[ -n "$_kiosk_home" && -d "$_kiosk_home" ]]; then
    HOME="$_kiosk_home"
    export HOME
  fi
fi
: "${TIKPAL_CHROMIUM_PROFILE_DIR:=$HOME/.config/tikpal-chromium-kiosk}"
: "${TIKPAL_CHROMIUM_ALSA_OUTPUT_DEVICE:=}"
: "${TIKPAL_AUDIO_ADAPT_BIN:=$APP_DIR/deploy/moode/tikpal-audio-adapt.sh}"
: "${TIKPAL_WEB_MODE_PROFILE_ROOT:=$HOME/.config/tikpal-web-mode}"
: "${TIKPAL_WEB_MODE_PHYSICAL_REVEAL_STAMP_PATH:=$TIKPAL_WEB_MODE_PROFILE_ROOT/last-physical-reveal.tsv}"
: "${TIKPAL_WEB_MODE_SWITCH_SEGMENT_TIMING_ONCE_PATH:=$TIKPAL_WEB_MODE_PROFILE_ROOT/switch-segment-timing.once}"
: "${TIKPAL_WEB_MODE_SETTINGS_PATH:=$APP_DIR/.tikpal/web-mode-settings.json}"
: "${TIKPAL_WEB_MODE_STATE_PATH:=$APP_DIR/.tikpal/web-mode-state.json}"
: "${TIKPAL_WEB_MODE_EXTENSION_DIR:=$SCRIPT_DIR/web-mode-extension}"
: "${TIKPAL_WEB_MODE_EXTENSION_ENABLED:=1}"
: "${TIKPAL_WEB_MODE_EXTENSION_ID:=dlaggcjljagbfgfidblabfdonkemimfe}"
: "${TIKPAL_WEB_MODE_PROXY_APPLY_TIMEOUT_SECONDS:=5}"
: "${TIKPAL_WEB_MODE_PROVIDER_BOOTSTRAP_TIMEOUT_SECONDS:=7}"
: "${TIKPAL_WEB_MODE_PROVIDER_READY_TIMEOUT_SECONDS:=18}"
: "${TIKPAL_WEB_MODE_PROVIDER_WINDOW_TIMEOUT_SECONDS:=30}"
: "${TIKPAL_WEB_MODE_ENTRY_PROVIDER_PAINT_TIMEOUT_SECONDS:=1.5}"
: "${TIKPAL_WEB_MODE_RESIDENT_ENTRY_SETTLE_SECONDS:=0.16}"
: "${TIKPAL_WEB_MODE_RESIDENT_ENTRY_PAINT_SETTLE_SECONDS:=0.5}"
: "${TIKPAL_WEB_MODE_LEFT_WINDOW:=1920x720}"
: "${TIKPAL_WEB_MODE_LEFT_POSITION:=0,0}"
: "${TIKPAL_WEB_MODE_PANEL_WINDOW:=640x720}"
: "${TIKPAL_WEB_MODE_PANEL_POSITION:=1920,0}"
: "${TIKPAL_WEB_MODE_SIDE_PANEL_URL:=http://localhost:4173/side-panel}"
: "${TIKPAL_WEB_MODE_BACKGROUND_URL:=http://127.0.0.1:4173/web-mode-background.html}"
: "${TIKPAL_WEB_MODE_TRANSITION_URL:=http://127.0.0.1:4173/web-mode-transition.html}"
: "${TIKPAL_WEB_MODE_TRANSITION_DEBUG_PORT:=9250}"
: "${TIKPAL_WEB_MODE_TRANSITION_VEIL_READY_TIMEOUT_SECONDS:=3}"
: "${TIKPAL_WEB_MODE_CLOSE_PARK_TIMEOUT_SECONDS:=3}"
: "${TIKPAL_WEB_MODE_ENTRY_STAGE_POSITION:=0,0}"
: "${TIKPAL_WEB_MODE_ENTRY_STAGE_WINDOW:=2560x720}"
: "${TIKPAL_WEB_MODE_ENTRY_REVEAL_SETTLE_SECONDS:=0.45}"
: "${TIKPAL_WEB_MODE_ENTRY_GUARD_INTERVAL_SECONDS:=0.12}"
: "${TIKPAL_WEB_MODE_CLOSE_ACTIVE_PROVIDER:=}"
: "${TIKPAL_WEB_MODE_CLOSE_REQUEST_ID:=}"
: "${TIKPAL_WEB_MODE_OPEN_EXPECTED_ACTIVE_PROVIDER:=}"
: "${TIKPAL_WEB_MODE_SWITCH_TRACE_EVENTS_PATH:=}"
: "${TIKPAL_WEB_MODE_SWITCH_TRACE_RUN_ID:=}"
: "${TIKPAL_WEB_MODE_SWITCH_TRACE_ROUND_ID:=}"
: "${TIKPAL_WEB_MODE_SWITCH_TRACE_PASS_INDEX:=}"
: "${TIKPAL_WEB_MODE_SWITCH_TRACE_FROM_PROVIDER:=}"
: "${TIKPAL_WEB_MODE_SWITCH_TRACE_TO_PROVIDER:=}"
: "${TIKPAL_WEB_MODE_SWITCH_TRACE_REQUEST_ID:=}"
: "${TIKPAL_WEB_MODE_SWITCH_TRACE_MONOTONIC_OFFSET_MS:=}"
: "${TIKPAL_WEB_MODE_STAGE_POSITION:=2560,0}"
: "${TIKPAL_WEB_MODE_STAGE_REVEAL_MS:=650}"
: "${TIKPAL_WEB_MODE_AUDIO_CROSSFADE_ENABLED:=1}"
: "${TIKPAL_WEB_MODE_AUDIO_CROSSFADE_MS:=2000}"
: "${TIKPAL_WEB_MODE_AUDIO_CROSSFADE_HELPER:=$SCRIPT_DIR/../moode/tikpal-web-mode-crossfade.sh}"
: "${TIKPAL_WEB_MODE_CROSSFADE_CARD:=}"
: "${TIKPAL_WEB_MODE_CROSSFADE_PCM_A:=tikpal_explore_a}"
: "${TIKPAL_WEB_MODE_CROSSFADE_PCM_B:=tikpal_explore_b}"
: "${TIKPAL_WEB_MODE_AUDIO_BUS_STATE_PATH:=$TIKPAL_WEB_MODE_PROFILE_ROOT/active-audio-bus}"
: "${TIKPAL_WEB_MODE_LOCK_TIMEOUT_SECONDS:=2}"
: "${TIKPAL_WEB_MODE_X11_SYNC_WINDOW_OPS:=0}"
: "${TIKPAL_WEB_MODE_X11_HELPER_MODE:=disabled}"
: "${TIKPAL_WEB_MODE_X11_HELPER_BINARY:=/usr/local/libexec/tikpal-x11-helper}"
: "${TIKPAL_WEB_MODE_X11_HELPER_SOCKET:=/run/tikpal/x11-helper.sock}"
: "${TIKPAL_WEB_MODE_X11_HELPER_CONNECT_TIMEOUT_MS:=50}"
: "${TIKPAL_WEB_MODE_X11_HELPER_RESPONSE_TIMEOUT_MS:=300}"
: "${TIKPAL_WEB_MODE_X11_HELPER_INSPECT_RESPONSE_TIMEOUT_MS:=700}"
: "${TIKPAL_WEB_MODE_X11_HELPER_GENERATION_PATH:=$TIKPAL_WEB_MODE_PROFILE_ROOT/x11-helper-generation}"
: "${TIKPAL_WEB_MODE_X11_HELPER_OWNER_PATH:=$TIKPAL_WEB_MODE_PROFILE_ROOT/x11-helper-owner.json}"
: "${TIKPAL_WEB_MODE_X11_HELPER_LEASE_MS:=350}"
: "${TIKPAL_WEB_MODE_X11_MUTATION_TRACE_PATH:=}"
: "${TIKPAL_WEB_MODE_INITIAL_ENTRY_TRACE_PATH:=}"
: "${TIKPAL_WEB_MODE_INITIAL_ENTRY_TRACE_OUTPUT_LIMIT_BYTES:=2048}"
: "${TIKPAL_WEB_MODE_X11_TRACE_GEOMETRY_COMMAND:=}"
: "${TIKPAL_WEB_MODE_X11_MUTATION_BARRIER_FIFO:=}"
: "${TIKPAL_WEB_MODE_X11_MUTATION_BARRIER_READY_PATH:=}"
: "${TIKPAL_WEB_MODE_X11_MUTATION_BARRIER_MATCH:=}"
: "${TIKPAL_WEB_MODE_X11_PROCESS_GENERATION:=}"
: "${TIKPAL_KIOSK_X_SESSION_GENERATION_PATH:=$APP_DIR/.tikpal/kiosk-x-session-generation}"
: "${TIKPAL_WEB_MODE_OPEN_X_SESSION_GENERATION:=}"
: "${TIKPAL_WEB_MODE_CLOSE_WARM_ENABLED:=1}"
: "${TIKPAL_WEB_MODE_CLOSE_KEEP_RESIDENT:=1}"
: "${TIKPAL_WEB_MODE_CLOSE_WARM_TTL_SECONDS:=45}"
: "${TIKPAL_WEB_MODE_CLOSE_AUDIO_GATE_SETTLE_SECONDS:=0.35}"
: "${TIKPAL_WEB_MODE_CLOSE_REFILL_PROVIDER_POOL_ENABLED:=1}"
: "${TIKPAL_WEB_MODE_RESIDENT_SWITCH_SETTLE_SECONDS:=0.16}"
: "${TIKPAL_WEB_MODE_RESIDENT_SWITCH_PAINT_TIMEOUT_SECONDS:=0.6}"
: "${TIKPAL_WEB_MODE_RESIDENT_SWITCH_PAINT_POLL_SECONDS:=0.08}"
: "${TIKPAL_WEB_MODE_PROVIDER_SWITCH_FADE_SECONDS:=0.16}"
: "${TIKPAL_WEB_MODE_TRANSITION_MIN_VISIBLE_SECONDS:=0.5}"
: "${TIKPAL_WEB_MODE_ONBOARD_LOCK_TIMEOUT_SECONDS:=8}"
: "${TIKPAL_WEB_MODE_DEFAULT_PROXY_URL:=http://127.0.0.1:7897}"
: "${TIKPAL_WEB_MODE_ONBOARD:=1}"
: "${TIKPAL_WEB_MODE_ONBOARD_AUTO_FOCUS:=1}"
: "${TIKPAL_WEB_MODE_ONBOARD_WINDOW:=900x280}"
: "${TIKPAL_WEB_MODE_ONBOARD_POSITION:=500,420}"
: "${TIKPAL_WEB_MODE_ONBOARD_SUPPRESS_PATH:=$TIKPAL_WEB_MODE_PROFILE_ROOT/onboard-manual-hidden}"
: "${TIKPAL_WEB_MODE_KEYBOARD_TARGET:=auto}"
: "${TIKPAL_WEB_MODE_ALSA_OUTPUT_DEVICE:=${TIKPAL_CHROMIUM_ALSA_OUTPUT_DEVICE:-}}"
: "${TIKPAL_WEB_MODE_WINDOW_GUARD:=1}"
: "${TIKPAL_WEB_MODE_SINGLE_PROVIDER_WINDOW:=1}"
: "${TIKPAL_WEB_MODE_PROVIDER_POOL:=1}"
: "${TIKPAL_WEB_MODE_PROVIDER_IDLE_POOL_ENABLED:=1}"
: "${TIKPAL_WEB_MODE_PROVIDER_PREWARM_ENABLED:=1}"
: "${TIKPAL_WEB_MODE_PROVIDER_PREWARM_CONTINUE_AFTER_CLOSE:=1}"
: "${TIKPAL_WEB_MODE_PROVIDER_PREWARM_DELAY_SECONDS:=0.4}"
: "${TIKPAL_WEB_MODE_PROVIDER_PREWARM_MAX_CONCURRENT_LAUNCHES:=3}"
: "${TIKPAL_WEB_MODE_PROVIDER_PREWARM_LOCK_TIMEOUT_SECONDS:=2}"
: "${TIKPAL_WEB_MODE_PROVIDER_GUARD_IDLE_POLL_MS:=2000}"
: "${TIKPAL_WEB_MODE_DIRECT_PROBE_ENABLED:=1}"
: "${TIKPAL_WEB_MODE_DIRECT_PROBE_TIMEOUT_SECONDS:=4}"
: "${TIKPAL_WEB_MODE_POPUP_BLOCKING:=1}"
: "${TIKPAL_WEB_MODE_PROVIDER_DEBUG_PORT:=9234}"
: "${TIKPAL_WEB_MODE_PROVIDER_GUARD:=1}"
: "${TIKPAL_WEB_MODE_DISABLE_HANG_MONITOR:=1}"
: "${TIKPAL_WEB_MODE_REFRESH_EXTENSION_CACHE:=1}"
: "${TIKPAL_WEB_MODE_ERROR_PAGE_URL:=http://127.0.0.1:4173/web-mode-error.html}"
: "${TIKPAL_WEB_MODE_PROXY_CONNECT_ERROR:=Proxy did not connect. Try again.}"
: "${TIKPAL_WEB_MODE_QQ_AUTO_CONFIRM:=1}"
: "${TIKPAL_WEB_MODE_QQ_AUDIO_PRIME:=1}"
: "${TIKPAL_WEB_MODE_QQ_MUSIC_AUTO_PLAY:=0}"
: "${TIKPAL_WEB_MODE_QQ_MV_AUTO_FULLSCREEN:=0}"
: "${TIKPAL_WEB_MODE_QQ_MV_CINEMA_MODE:=1}"
: "${TIKPAL_WEB_MODE_QQ_MV_AUTO_PLAY:=1}"
: "${TIKPAL_WEB_MODE_NETEASE_AUTO_PLAY:=1}"

if [[ -n "${TIKPAL_WEB_MODE_ONBOARD_ACTION_POSITION:-}" ]]; then
  TIKPAL_WEB_MODE_ONBOARD_POSITION="$TIKPAL_WEB_MODE_ONBOARD_ACTION_POSITION"
fi

if [[ -n "${TIKPAL_WEB_MODE_ONBOARD_ACTION_WINDOW:-}" ]]; then
  TIKPAL_WEB_MODE_ONBOARD_WINDOW="$TIKPAL_WEB_MODE_ONBOARD_ACTION_WINDOW"
fi

TIKPAL_X11_HELPER_PREPARED=0
TIKPAL_X11_HELPER_ACTIVE=0
TIKPAL_X11_HELPER_UNKNOWN=0
TIKPAL_X11_HELPER_DAEMON_INSTANCE_ID=""
TIKPAL_X11_HELPER_CONNECTION_EPOCH=""
TIKPAL_X11_HELPER_GENERATION=""
TIKPAL_X11_HELPER_LEASE_ID=""
TIKPAL_X11_HELPER_LAST_RESPONSE=""
TIKPAL_X11_HELPER_REQUEST_ID=""
TIKPAL_X11_TRACE_APPEND_WARNING_EMITTED=0
TIKPAL_SWITCH_TRACE_APPEND_WARNING_EMITTED=0
TIKPAL_INITIAL_ENTRY_TRACE_APPEND_WARNING_EMITTED=0
TIKPAL_INITIAL_ENTRY_MUTATION_STARTED=0
TIKPAL_INITIAL_ENTRY_FAILED_STEP=""
TIKPAL_INITIAL_ENTRY_FAILED_STATUS=0
TIKPAL_INITIAL_ENTRY_PANEL_WINDOW=""
TIKPAL_INITIAL_ENTRY_KIOSK_WINDOW=""
TIKPAL_INITIAL_ENTRY_TARGET_WINDOW=""
TIKPAL_INITIAL_ENTRY_PROVIDER=""
TIKPAL_INITIAL_ENTRY_PROXY_LINE=""
TIKPAL_INITIAL_ENTRY_PROXY_ENABLED=""
TIKPAL_INITIAL_ENTRY_TRACE_CONTEXT_KEY=""
if [[ -z "$TIKPAL_WEB_MODE_X11_PROCESS_GENERATION" &&
      -r "$TIKPAL_WEB_MODE_X11_HELPER_GENERATION_PATH" ]]; then
  IFS= read -r TIKPAL_WEB_MODE_X11_PROCESS_GENERATION \
    < "$TIKPAL_WEB_MODE_X11_HELPER_GENERATION_PATH" ||
    TIKPAL_WEB_MODE_X11_PROCESS_GENERATION=""
fi

export DISPLAY="$TIKPAL_KIOSK_DISPLAY"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"
export GTK_IM_MODULE="${GTK_IM_MODULE:-fcitx}"
export QT_IM_MODULE="${QT_IM_MODULE:-fcitx}"
export XMODIFIERS="${XMODIFIERS:-@im=fcitx}"

log() {
  printf '[tikpal-web-mode] %s\n' "$*"
}

log_stage() {
  log "$@"
  if command -v logger >/dev/null 2>&1; then
    logger -t tikpal-web-mode -- "$*" >/dev/null 2>&1 || true
  fi
}

log_open_stage() {
  local stage="$1"
  shift
  log_stage "stage=$stage open_request_id=${TIKPAL_WEB_MODE_OPEN_REQUEST_ID:-legacy} x_session_generation=${TIKPAL_WEB_MODE_OPEN_X_SESSION_GENERATION:-legacy} helper_mode=$TIKPAL_WEB_MODE_X11_HELPER_MODE $*"
}

now_ms() {
  local value
  value="$(date +%s%3N 2>/dev/null || true)"
  if [[ "$value" =~ ^[0-9]+$ ]]; then
    printf '%s\n' "$value"
    return 0
  fi
  node -e 'process.stdout.write(String(Date.now()))'
}

x11_monotonic_ns() {
  local value uptime seconds fraction
  if [[ -x "$TIKPAL_WEB_MODE_X11_HELPER_BINARY" ]]; then
    value="$("$TIKPAL_WEB_MODE_X11_HELPER_BINARY" monotonic-ns 2>/dev/null || true)"
    if [[ "$value" =~ ^[1-9][0-9]*$ ]]; then
      printf '%s\n' "$value"
      return 0
    fi
  fi
  if [[ -r /proc/uptime ]]; then
    IFS=' ' read -r uptime _ < /proc/uptime || uptime=""
    if [[ "$uptime" =~ ^([0-9]+)[.]([0-9]+)$ ]]; then
      seconds="${BASH_REMATCH[1]}"
      fraction="${BASH_REMATCH[2]}000000000"
      fraction="${fraction:0:9}"
      printf '%s\n' "$((10#$seconds * 1000000000 + 10#$fraction))"
      return 0
    fi
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import time; print(time.monotonic_ns())'
    return
  fi
  node -e 'process.stdout.write(process.hrtime.bigint().toString())'
}

x11_trace_enabled() {
  [[ -n "$TIKPAL_WEB_MODE_X11_MUTATION_TRACE_PATH" ]]
}

x11_trace_require_writable() {
  local trace_dir trace_fd=""
  x11_trace_enabled || return 0
  trace_dir="$(dirname "$TIKPAL_WEB_MODE_X11_MUTATION_TRACE_PATH")"
  [[ -d "$trace_dir" && -x "$trace_dir" ]] || return 1
  [[ -f "$TIKPAL_WEB_MODE_X11_MUTATION_TRACE_PATH" ]] || return 1
  if ! { exec {trace_fd}>>"$TIKPAL_WEB_MODE_X11_MUTATION_TRACE_PATH"; } 2>/dev/null; then
    return 1
  fi
  exec {trace_fd}>&-
}

x11_trace_json_escape() {
  local value="${1:-}"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  printf '%s' "$value"
}

initial_entry_trace_enabled() {
  [[ -n "$TIKPAL_WEB_MODE_INITIAL_ENTRY_TRACE_PATH" ]]
}

initial_entry_trace_require_writable() {
  local trace_dir trace_fd=""
  initial_entry_trace_enabled || return 0
  trace_dir="$(dirname "$TIKPAL_WEB_MODE_INITIAL_ENTRY_TRACE_PATH")"
  [[ -d "$trace_dir" && -x "$trace_dir" &&
     -f "$TIKPAL_WEB_MODE_INITIAL_ENTRY_TRACE_PATH" ]] || return 1
  if ! { exec {trace_fd}>>"$TIKPAL_WEB_MODE_INITIAL_ENTRY_TRACE_PATH"; } 2>/dev/null; then
    return 1
  fi
  exec {trace_fd}>&-
}

initial_entry_trace_append_line() {
  local line="$1" trace_fd=""
  initial_entry_trace_enabled || return 0
  [[ -f "$TIKPAL_WEB_MODE_INITIAL_ENTRY_TRACE_PATH" ]] || return 1
  if ! { exec {trace_fd}>>"$TIKPAL_WEB_MODE_INITIAL_ENTRY_TRACE_PATH"; } 2>/dev/null; then
    return 1
  fi
  if command -v flock >/dev/null 2>&1; then
    if ! flock -x "$trace_fd" || ! printf '%s\n' "$line" >&"$trace_fd" 2>/dev/null; then
      flock -u "$trace_fd" >/dev/null 2>&1 || true
      exec {trace_fd}>&-
      return 1
    fi
    flock -u "$trace_fd" >/dev/null 2>&1 || true
  elif ! printf '%s\n' "$line" >&"$trace_fd" 2>/dev/null; then
    exec {trace_fd}>&-
    return 1
  fi
  exec {trace_fd}>&-
}

initial_entry_trace_warn() {
  local reason="$1"
  if [[ "$TIKPAL_INITIAL_ENTRY_TRACE_APPEND_WARNING_EMITTED" != "1" ]]; then
    log_stage "WARN: INITIAL_ENTRY_TRACE_APPEND_FAILED path=$TIKPAL_WEB_MODE_INITIAL_ENTRY_TRACE_PATH reason=$reason"
    TIKPAL_INITIAL_ENTRY_TRACE_APPEND_WARNING_EMITTED=1
  fi
}

initial_entry_trace_generation() {
  local generation="${TIKPAL_WEB_MODE_X11_PROCESS_GENERATION:-}"
  if [[ -z "$generation" && -r "$TIKPAL_WEB_MODE_X11_HELPER_GENERATION_PATH" ]]; then
    IFS= read -r generation < "$TIKPAL_WEB_MODE_X11_HELPER_GENERATION_PATH" || generation=""
  fi
  printf '%s\n' "${generation:-missing}"
}

initial_entry_trace_read_bounded() {
  local path="$1" limit="$TIKPAL_WEB_MODE_INITIAL_ENTRY_TRACE_OUTPUT_LIMIT_BYTES"
  [[ "$limit" =~ ^[1-9][0-9]*$ ]] || limit=2048
  [[ -r "$path" ]] || return 0
  head -c "$limit" "$path" 2>/dev/null || true
}

initial_entry_inspect_profile() {
  local window="$1"
  if [[ "$window" == "$TIKPAL_INITIAL_ENTRY_TARGET_WINDOW" &&
        -n "$TIKPAL_INITIAL_ENTRY_PROVIDER" ]]; then
    printf '%s\n' "$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$TIKPAL_INITIAL_ENTRY_PROVIDER"
  elif [[ "$window" == "$TIKPAL_INITIAL_ENTRY_PANEL_WINDOW" ]]; then
    printf '%s\n' "$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel"
  elif [[ "$window" == "$TIKPAL_INITIAL_ENTRY_KIOSK_WINDOW" ]]; then
    printf '%s\n' "$TIKPAL_CHROMIUM_PROFILE_DIR"
  else
    return 1
  fi
}

initial_entry_inspect_surfaces() {
  local xids="$1" xid profile response generation=0 index=0 status
  local -a arguments=(client inspect)
  [[ -x "$TIKPAL_WEB_MODE_X11_HELPER_BINARY" &&
     -S "$TIKPAL_WEB_MODE_X11_HELPER_SOCKET" ]] || return 1
  command -v jq >/dev/null 2>&1 || return 1
  [[ "$TIKPAL_WEB_MODE_X11_PROCESS_GENERATION" =~ ^[1-9][0-9]*$ ]] &&
    generation="$TIKPAL_WEB_MODE_X11_PROCESS_GENERATION"
  arguments+=(--request-id "initial-entry-inspect-$(x11_helper_new_id)" --generation "$generation")
  while IFS= read -r xid; do
    [[ "$xid" =~ ^[1-9][0-9]*$ ]] || continue
    profile="$(initial_entry_inspect_profile "$xid")" || return 1
    arguments+=(--surface "initial_$index" "$xid" "$profile")
    index=$((index + 1))
  done < <(tr ',' '\n' <<< "$xids")
  (( index > 0 )) || return 1
  if response="$(
    TIKPAL_X11_HELPER_CALLER_ROLE=initial_entry_inspect \
    TIKPAL_WEB_MODE_X11_HELPER_SOCKET="$TIKPAL_WEB_MODE_X11_HELPER_SOCKET" \
    TIKPAL_WEB_MODE_X11_HELPER_CONNECT_TIMEOUT_MS=50 \
    TIKPAL_WEB_MODE_X11_HELPER_RESPONSE_TIMEOUT_MS=450 \
      "$TIKPAL_WEB_MODE_X11_HELPER_BINARY" "${arguments[@]}"
  )"; then
    status=0
  else
    status=$?
  fi
  [[ "$status" == "0" ]] || return "$status"
  jq -e --arg xids "$xids" '
    (.operation == "inspect" and .readOnly == true and .ok == true) as $header |
    ([ $xids | split(",")[] | tonumber ] | sort) as $expected |
    ([.surfaces[] | select(.ok == true and .profileMatched == true) | .xid] | sort) as $actual |
    $header and $actual == $expected
  ' <<< "$response" >/dev/null || return 1
  printf '%s\n' "$response"
}

initial_entry_snapshot_from_inspect() {
  jq -r '
    [.surfaces[] |
      "\(.xid):geometry=\(.geometry.x),\(.geometry.y)_\(.geometry.width)x\(.geometry.height),map=\(.mapState),opacity=\(if .opacity.present then (.opacity.value | tostring) else \"unset\" end)"
    ] | join(";")
  '
}

initial_entry_inspected_surface_state() {
  local response="$1" window="$2"
  jq -r --argjson window "$window" '
    .surfaces[] | select(.xid == $window) |
    [
      .mapState,
      "\(.geometry.x),\(.geometry.y)_\(.geometry.width)x\(.geometry.height)",
      (if .opacity.present then (.opacity.value | tostring) else "unset" end)
    ] | @tsv
  ' <<< "$response"
}

initial_entry_expected_geometry() {
  local position="$1" size="$2" normalized_size
  normalized_size="$(normalize_window_size "$size")" || return 1
  printf '%s_%s\n' "$position" "${normalized_size/,/x}"
}

initial_entry_window_snapshot() {
  local xid geometry map_state opacity result="" separator="" inspect_response
  if inspect_response="$(initial_entry_inspect_surfaces "$1")"; then
    initial_entry_snapshot_from_inspect <<< "$inspect_response"
    return 0
  fi
  local -a xids=()
  IFS=',' read -r -a xids <<< "${1:-}"
  for xid in "${xids[@]:-}"; do
    [[ "$xid" =~ ^[1-9][0-9]*$ ]] || continue
    geometry="$(window_geometry_compact "$xid" 2>/dev/null || printf unreadable)"
    map_state="$(initial_entry_window_map_state "$xid" 2>/dev/null || printf unreadable)"
    opacity="$(window_opacity_value "$xid" 2>/dev/null || printf unreadable)"
    result+="$separator$xid:geometry=$geometry,map=$map_state,opacity=$opacity"
    separator=";"
  done
  printf '%s\n' "${result:-not_available}"
}

initial_entry_trace_event() {
  local event="$1" provider="$2" phase="$3" step_number="$4" step="$5"
  local xids="$6" command_type="$7" expected_geometry="$8"
  local started_ns="$9" finished_ns="${10}" exit_status="${11}"
  local stdout_text="${12}" stderr_text="${13}" mutation_started="${14}"
  local before_snapshot="${15}" after_snapshot="${16}"
  local generation line
  initial_entry_trace_enabled || return 0
  generation="$(initial_entry_trace_generation)"
  printf -v line '%s' \
    "{\"event\":\"$(x11_trace_json_escape "$event")\",\"request_id\":\"$(x11_trace_json_escape "${TIKPAL_WEB_MODE_OPEN_REQUEST_ID:-legacy}")\",\"provider\":\"$(x11_trace_json_escape "$provider")\",\"phase\":\"$(x11_trace_json_escape "$phase")\",\"step_number\":$step_number,\"step\":\"$(x11_trace_json_escape "$step")\",\"xid\":\"$(x11_trace_json_escape "$xids")\",\"generation\":\"$(x11_trace_json_escape "$generation")\",\"caller_pid\":$BASHPID,\"command_type\":\"$(x11_trace_json_escape "$command_type")\",\"expected_geometry\":\"$(x11_trace_json_escape "$expected_geometry")\",\"monotonic_started_ns\":$started_ns,\"monotonic_finished_ns\":$finished_ns,\"exit_status\":$exit_status,\"stdout\":\"$(x11_trace_json_escape "$stdout_text")\",\"stderr\":\"$(x11_trace_json_escape "$stderr_text")\",\"mutation_started\":$mutation_started,\"before_snapshot\":\"$(x11_trace_json_escape "$before_snapshot")\",\"after_snapshot\":\"$(x11_trace_json_escape "$after_snapshot")\"}"
  initial_entry_trace_append_line "$line"
}

initial_entry_step_run() {
  local step_number="$1" provider="$2" phase="$3" step="$4" xids="$5"
  local command_type="$6" expected_geometry="$7" mutation_expected="$8"
  local started_ns finished_ns status=0 event mutation_started=false
  local before_snapshot after_snapshot stdout_text stderr_text
  local stdout_path stderr_path
  shift 8

  stdout_path="$(mktemp "${TMPDIR:-/tmp}/tikpal-initial-entry.stdout.XXXXXX")" || return 91
  stderr_path="$(mktemp "${TMPDIR:-/tmp}/tikpal-initial-entry.stderr.XXXXXX")" || {
    rm -f "$stdout_path"
    return 91
  }
  before_snapshot="$(initial_entry_window_snapshot "$xids" || true)"
  started_ns="$(x11_monotonic_ns)"
  log_open_stage initial_entry_step_started \
    "provider=$provider phase=$phase step_number=$step_number step=$step xids=${xids:-none} command_type=$command_type expected_geometry=$expected_geometry"
  if ! initial_entry_trace_event initial_entry_step_started "$provider" "$phase" \
      "$step_number" "$step" "$xids" "$command_type" "$expected_geometry" \
      "$started_ns" "$started_ns" 0 "" "" false "$before_snapshot" "$before_snapshot"; then
    initial_entry_trace_warn started_append_failed
    rm -f "$stdout_path" "$stderr_path"
    TIKPAL_INITIAL_ENTRY_FAILED_STEP="$step"
    TIKPAL_INITIAL_ENTRY_FAILED_STATUS=90
    log_open_stage initial_entry_step_failed \
      "provider=$provider phase=$phase step_number=$step_number step=$step status=90 reason=trace_not_writable mutation_started=false"
    return 90
  fi

  if [[ "$mutation_expected" == "1" ]]; then
    TIKPAL_INITIAL_ENTRY_MUTATION_STARTED=1
    mutation_started=true
  fi
  if "$@" >"$stdout_path" 2>"$stderr_path"; then
    status=0
  else
    status=$?
  fi
  finished_ns="$(x11_monotonic_ns)"
  after_snapshot="$(initial_entry_window_snapshot "$xids" || true)"
  stdout_text="$(initial_entry_trace_read_bounded "$stdout_path")"
  stderr_text="$(initial_entry_trace_read_bounded "$stderr_path")"
  [[ "$status" == "0" ]] && event=initial_entry_step_completed || event=initial_entry_step_failed
  if ! initial_entry_trace_event "$event" "$provider" "$phase" \
      "$step_number" "$step" "$xids" "$command_type" "$expected_geometry" \
      "$started_ns" "$finished_ns" "$status" "$stdout_text" "$stderr_text" \
      "$mutation_started" "$before_snapshot" "$after_snapshot"; then
    initial_entry_trace_warn result_append_failed
    if [[ "$TIKPAL_INITIAL_ENTRY_MUTATION_STARTED" != "1" && "$status" == "0" ]]; then
      status=90
      event=initial_entry_step_failed
    fi
  fi
  rm -f "$stdout_path" "$stderr_path"
  if [[ "$status" == "0" ]]; then
    log_open_stage initial_entry_step_completed \
      "provider=$provider phase=$phase step_number=$step_number step=$step status=0 mutation_started=$mutation_started"
    return 0
  fi
  TIKPAL_INITIAL_ENTRY_FAILED_STEP="$step"
  TIKPAL_INITIAL_ENTRY_FAILED_STATUS="$status"
  log_open_stage initial_entry_step_failed \
    "provider=$provider phase=$phase step_number=$step_number step=$step status=$status mutation_started=$mutation_started"
  return "$status"
}

x11_trace_read_active_provider() {
  local line
  [[ -r "$TIKPAL_WEB_MODE_STATE_PATH" ]] || return 0
  while IFS= read -r line; do
    if [[ "$line" =~ \"activeProvider\"[[:space:]]*:[[:space:]]*\"([^\"]+)\" ]]; then
      printf '%s\n' "${BASH_REMATCH[1]}"
      return 0
    fi
  done < "$TIKPAL_WEB_MODE_STATE_PATH"
}

x11_trace_read_registry_generation() {
  local kind value _rest list_path
  list_path="$TIKPAL_WEB_MODE_PROFILE_ROOT/guard-windows.tsv"
  [[ -r "$list_path" ]] || return 0
  while IFS=$'\t' read -r kind value _rest; do
    if [[ "$kind" == "generation" ]]; then
      printf '%s\n' "$value"
      return 0
    fi
  done < "$list_path"
}

x11_trace_load_snapshot() {
  local packet="" remainder
  TIKPAL_X11_TRACE_OWNER=missing
  TIKPAL_X11_TRACE_GENERATION=missing
  TIKPAL_X11_TRACE_LEASE_ID=""
  TIKPAL_X11_TRACE_ACTIVE_PROVIDER="$(x11_trace_read_active_provider || true)"
  TIKPAL_X11_TRACE_REGISTRY_GENERATION="$(x11_trace_read_registry_generation || true)"
  [[ -n "$TIKPAL_X11_TRACE_ACTIVE_PROVIDER" ]] || TIKPAL_X11_TRACE_ACTIVE_PROVIDER=none
  [[ -n "$TIKPAL_X11_TRACE_REGISTRY_GENERATION" ]] || TIKPAL_X11_TRACE_REGISTRY_GENERATION=missing
  if [[ -r "$TIKPAL_WEB_MODE_X11_HELPER_GENERATION_PATH" ]]; then
    IFS= read -r TIKPAL_X11_TRACE_GENERATION < "$TIKPAL_WEB_MODE_X11_HELPER_GENERATION_PATH" ||
      TIKPAL_X11_TRACE_GENERATION=unreadable
  fi
  [[ -r "$TIKPAL_WEB_MODE_X11_HELPER_OWNER_PATH" ]] || return 0
  IFS= read -r packet < "$TIKPAL_WEB_MODE_X11_HELPER_OWNER_PATH" || packet=""
  if [[ "$packet" == *'"owner":"'* ]]; then
    remainder="${packet#*\"owner\":\"}"
    TIKPAL_X11_TRACE_OWNER="${remainder%%\"*}"
  else
    TIKPAL_X11_TRACE_OWNER=malformed
  fi
  if [[ "$packet" == *'"leaseId":"'* ]]; then
    remainder="${packet#*\"leaseId\":\"}"
    TIKPAL_X11_TRACE_LEASE_ID="${remainder%%\"*}"
  fi
}

x11_trace_writer_role() {
  local command="${WEB_MODE_COMMAND_ARGS[0]:-source}"
  if [[ -n "${TIKPAL_WEB_MODE_X11_WRITER_ROLE:-}" ]]; then
    printf '%s\n' "$TIKPAL_WEB_MODE_X11_WRITER_ROLE"
    return 0
  fi
  case "$command" in
    guard) printf 'window_guard\n' ;;
    prewarm) printf 'prewarm_worker\n' ;;
    warm-pool) printf 'idle_prewarm_worker\n' ;;
    reconcile) printf 'reconcile_worker\n' ;;
    close|close-full|cleanup-warm) printf 'close_shell\n' ;;
    open|prepare-entry|park-entry) printf 'foreground_shell\n' ;;
    *) printf 'shell_%s\n' "$command" ;;
  esac
}

x11_trace_writer_provider() {
  local value="${TIKPAL_WEB_MODE_X11_WRITER_PROVIDER:-${provider:-${active_provider:-}}}"
  if [[ -z "$value" && -n "${provider_profile:-}" ]]; then
    value="${provider_profile##*/}"
  fi
  if [[ -z "$value" ]]; then
    value="$(x11_trace_read_active_provider || true)"
  fi
  printf '%s\n' "${value:-none}"
}

x11_trace_observed_geometries() {
  local xid output result="" separator=""
  local x y width height
  local -a xids=()
  IFS=',' read -r -a xids <<< "${1:-}"
  for xid in "${xids[@]:-}"; do
    [[ "$xid" =~ ^[1-9][0-9]*$ ]] || continue
    output=""
    if [[ -n "$TIKPAL_WEB_MODE_X11_TRACE_GEOMETRY_COMMAND" ]]; then
      output="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" "$TIKPAL_WEB_MODE_X11_TRACE_GEOMETRY_COMMAND" geometry "$xid" 2>/dev/null || true)"
    elif command -v xdotool >/dev/null 2>&1; then
      output="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_probe getwindowgeometry --shell "$xid" 2>/dev/null || true)"
    fi
    if [[ "$output" =~ ^-?[0-9]+,-?[0-9]+_[1-9][0-9]*x[1-9][0-9]*$ ]]; then
      result+="$separator$xid:$output"
      separator=";"
      continue
    fi
    x="$(printf '%s\n' "$output" | awk -F= '$1 == "X" { print $2 }')"
    y="$(printf '%s\n' "$output" | awk -F= '$1 == "Y" { print $2 }')"
    width="$(printf '%s\n' "$output" | awk -F= '$1 == "WIDTH" { print $2 }')"
    height="$(printf '%s\n' "$output" | awk -F= '$1 == "HEIGHT" { print $2 }')"
    if [[ "$x" =~ ^-?[0-9]+$ && "$y" =~ ^-?[0-9]+$ &&
          "$width" =~ ^[1-9][0-9]*$ && "$height" =~ ^[1-9][0-9]*$ ]]; then
      result+="$separator$xid:$x,${y}_${width}x${height}"
    else
      result+="$separator$xid:unreadable"
    fi
    separator=";"
  done
  printf '%s\n' "${result:-not_applicable}"
}

x11_trace_append_line() {
  local line="$1" trace_fd=""
  if [[ ! -f "$TIKPAL_WEB_MODE_X11_MUTATION_TRACE_PATH" ]]; then
    if [[ "$TIKPAL_X11_TRACE_APPEND_WARNING_EMITTED" != "1" ]]; then
      log_stage "WARN: X11_TRACE_APPEND_FAILED path=$TIKPAL_WEB_MODE_X11_MUTATION_TRACE_PATH reason=missing"
      TIKPAL_X11_TRACE_APPEND_WARNING_EMITTED=1
    fi
    return 0
  fi
  if command -v flock >/dev/null 2>&1; then
    if ! { exec {trace_fd}>>"$TIKPAL_WEB_MODE_X11_MUTATION_TRACE_PATH"; } 2>/dev/null; then
      if [[ "$TIKPAL_X11_TRACE_APPEND_WARNING_EMITTED" != "1" ]]; then
        log_stage "WARN: X11_TRACE_APPEND_FAILED path=$TIKPAL_WEB_MODE_X11_MUTATION_TRACE_PATH reason=not_writable"
        TIKPAL_X11_TRACE_APPEND_WARNING_EMITTED=1
      fi
      return 0
    fi
    if ! flock -x "$trace_fd" || ! printf '%s\n' "$line" >&"$trace_fd" 2>/dev/null; then
      if [[ "$TIKPAL_X11_TRACE_APPEND_WARNING_EMITTED" != "1" ]]; then
        log_stage "WARN: X11_TRACE_APPEND_FAILED path=$TIKPAL_WEB_MODE_X11_MUTATION_TRACE_PATH reason=append_failed"
        TIKPAL_X11_TRACE_APPEND_WARNING_EMITTED=1
      fi
    fi
    flock -u "$trace_fd" >/dev/null 2>&1 || true
    exec {trace_fd}>&-
    return 0
  fi
  if ! { printf '%s\n' "$line" >> "$TIKPAL_WEB_MODE_X11_MUTATION_TRACE_PATH"; } 2>/dev/null; then
    if [[ "$TIKPAL_X11_TRACE_APPEND_WARNING_EMITTED" != "1" ]]; then
      log_stage "WARN: X11_TRACE_APPEND_FAILED path=$TIKPAL_WEB_MODE_X11_MUTATION_TRACE_PATH reason=append_failed"
      TIKPAL_X11_TRACE_APPEND_WARNING_EMITTED=1
    fi
  fi
  return 0
}

x11_trace_record() {
  local operation="$1" xids="$2" requested_geometry="$3"
  local command_started="$4" command_finished="$5" exit_status="$6"
  local observed_geometry="$7" detail="${8:-}"
  local writer_role writer_provider lock_acquired line
  local owner_after generation_after lease_after active_after registry_after
  x11_trace_enabled || return 0
  writer_role="$(x11_trace_writer_role)"
  writer_provider="$(x11_trace_writer_provider)"
  lock_acquired=0
  if [[ "${TIKPAL_WEB_MODE_LOCKED:-0}" == "1" ||
        "${TIKPAL_WEB_MODE_GUARD_LOCKED:-0}" == "1" ||
        "${TIKPAL_WEB_MODE_X11_MUTATION_LOCKED:-0}" == "1" ]]; then
    lock_acquired=1
  fi
  owner_after="$TIKPAL_X11_TRACE_OWNER"
  generation_after="$TIKPAL_X11_TRACE_GENERATION"
  lease_after="$TIKPAL_X11_TRACE_LEASE_ID"
  active_after="$TIKPAL_X11_TRACE_ACTIVE_PROVIDER"
  registry_after="$TIKPAL_X11_TRACE_REGISTRY_GENERATION"
  x11_trace_load_snapshot
  line="{\"monotonic_ns\":$command_finished,\"writer_pid\":$BASHPID,\"ppid\":$PPID,\"command_pid\":${TIKPAL_X11_TRACE_COMMAND_PID:-$BASHPID},\"writer_role\":\"$(x11_trace_json_escape "$writer_role")\",\"provider\":\"$(x11_trace_json_escape "$writer_provider")\",\"operation\":\"$(x11_trace_json_escape "$operation")\",\"xid\":\"$(x11_trace_json_escape "$xids")\",\"requested_geometry\":\"$(x11_trace_json_escape "$requested_geometry")\",\"owner\":\"$(x11_trace_json_escape "$owner_after")\",\"generation\":\"$(x11_trace_json_escape "$generation_after")\",\"lease_id\":\"$(x11_trace_json_escape "$lease_after")\",\"active_provider\":\"$(x11_trace_json_escape "$active_after")\",\"registry_generation\":\"$(x11_trace_json_escape "$registry_after")\",\"lock_acquired\":$lock_acquired,\"command_started\":$command_started,\"command_finished\":$command_finished,\"observed_geometry_after\":\"$(x11_trace_json_escape "$observed_geometry")\",\"exit_status\":$exit_status,\"owner_after\":\"$(x11_trace_json_escape "$TIKPAL_X11_TRACE_OWNER")\",\"generation_after\":\"$(x11_trace_json_escape "$TIKPAL_X11_TRACE_GENERATION")\",\"lease_id_after\":\"$(x11_trace_json_escape "$TIKPAL_X11_TRACE_LEASE_ID")\",\"active_provider_after\":\"$(x11_trace_json_escape "$TIKPAL_X11_TRACE_ACTIVE_PROVIDER")\",\"registry_generation_after\":\"$(x11_trace_json_escape "$TIKPAL_X11_TRACE_REGISTRY_GENERATION")\",\"detail\":\"$(x11_trace_json_escape "$detail")\"}"
  x11_trace_append_line "$line"
}

x11_mutation_run() {
  local operation="$1" xids="$2" requested_geometry="$3"
  local command_started=0 command_finished=0 exit_status=0 observed_geometry=not_recorded
  local trace_detail="" current_generation="" mutation_lock_fd=""
  local gate_required=0 acquired_here=0 tracing=0
  local TIKPAL_WEB_MODE_X11_MUTATION_LOCKED="${TIKPAL_WEB_MODE_X11_MUTATION_LOCKED:-0}"
  local TIKPAL_X11_TRACE_COMMAND_PID=""
  shift 3
  if x11_trace_enabled; then
    tracing=1
    x11_trace_load_snapshot
  fi
  if [[ -n "$TIKPAL_WEB_MODE_X11_MUTATION_BARRIER_FIFO" &&
        ( -z "$TIKPAL_WEB_MODE_X11_MUTATION_BARRIER_MATCH" ||
          "$operation" == *"$TIKPAL_WEB_MODE_X11_MUTATION_BARRIER_MATCH"* ) ]]; then
    if [[ -n "$TIKPAL_WEB_MODE_X11_MUTATION_BARRIER_READY_PATH" ]]; then
      printf '%s\n' "$BASHPID" > "$TIKPAL_WEB_MODE_X11_MUTATION_BARRIER_READY_PATH"
    fi
    IFS= read -r _ < "$TIKPAL_WEB_MODE_X11_MUTATION_BARRIER_FIFO"
  fi

  if x11_helper_switch_enabled && [[ -n "$xids" ]]; then
    gate_required=1
    if [[ "${TIKPAL_WEB_MODE_LOCKED:-0}" != "1" &&
          "${TIKPAL_WEB_MODE_GUARD_LOCKED:-0}" != "1" &&
          "$TIKPAL_WEB_MODE_X11_MUTATION_LOCKED" != "1" ]]; then
      if ! command -v flock >/dev/null 2>&1; then
        exit_status=78
        trace_detail="permission=blocked reason=flock_missing expected_generation=${TIKPAL_WEB_MODE_X11_PROCESS_GENERATION:-missing}"
      else
        mkdir -p "$TIKPAL_WEB_MODE_PROFILE_ROOT"
        exec {mutation_lock_fd}>"$TIKPAL_WEB_MODE_PROFILE_ROOT/web-mode.lock"
        if flock -x -w "$TIKPAL_WEB_MODE_LOCK_TIMEOUT_SECONDS" "$mutation_lock_fd"; then
          acquired_here=1
          TIKPAL_WEB_MODE_X11_MUTATION_LOCKED=1
        else
          exit_status=75
          trace_detail="permission=blocked reason=lock_timeout expected_generation=${TIKPAL_WEB_MODE_X11_PROCESS_GENERATION:-missing}"
        fi
      fi
    fi
    if [[ "$exit_status" == "0" ]]; then
      if [[ -r "$TIKPAL_WEB_MODE_X11_HELPER_GENERATION_PATH" ]]; then
        IFS= read -r current_generation < "$TIKPAL_WEB_MODE_X11_HELPER_GENERATION_PATH" ||
          current_generation=unreadable
      else
        current_generation=missing
      fi
      if [[ ! "${TIKPAL_WEB_MODE_X11_PROCESS_GENERATION:-}" =~ ^[1-9][0-9]*$ ||
            "$current_generation" != "$TIKPAL_WEB_MODE_X11_PROCESS_GENERATION" ]]; then
        exit_status=76
        trace_detail="permission=blocked reason=stale_generation expected_generation=${TIKPAL_WEB_MODE_X11_PROCESS_GENERATION:-missing} current_generation=$current_generation"
      elif ! x11_helper_legacy_writer_may_write; then
        exit_status=77
        trace_detail="permission=blocked reason=helper_owner expected_generation=$TIKPAL_WEB_MODE_X11_PROCESS_GENERATION current_generation=$current_generation"
      else
        trace_detail="permission=allowed expected_generation=$TIKPAL_WEB_MODE_X11_PROCESS_GENERATION current_generation=$current_generation"
      fi
    fi
  fi

  if [[ "$exit_status" == "0" ]]; then
    if [[ "${TIKPAL_WEB_MODE_GUARD_TICK_ACTIVE:-0}" == "1" ]]; then
      [[ "${TIKPAL_GUARD_MUTATION_COUNT:-}" =~ ^[0-9]+$ ]] || TIKPAL_GUARD_MUTATION_COUNT=0
      TIKPAL_GUARD_MUTATION_COUNT=$((TIKPAL_GUARD_MUTATION_COUNT + 1))
    fi
    [[ "$tracing" == "0" ]] || command_started="$(x11_monotonic_ns)"
    if [[ "$tracing" == "1" ]]; then
      "$@" &
      TIKPAL_X11_TRACE_COMMAND_PID=$!
      if wait "$TIKPAL_X11_TRACE_COMMAND_PID"; then
        exit_status=0
      else
        exit_status=$?
      fi
    elif "$@"; then
      exit_status=0
    else
      exit_status=$?
    fi
  fi

  if [[ "$tracing" == "1" ]]; then
    command_finished="$(x11_monotonic_ns)"
    observed_geometry="$(x11_trace_observed_geometries "$xids")"
    x11_trace_record "$operation" "$xids" "$requested_geometry" \
      "$command_started" "$command_finished" "$exit_status" "$observed_geometry" \
      "$trace_detail"
  fi
  if [[ "$acquired_here" == "1" ]]; then
    flock -u "$mutation_lock_fd" >/dev/null 2>&1 || true
    exec {mutation_lock_fd}>&-
  elif [[ -n "$mutation_lock_fd" ]]; then
    exec {mutation_lock_fd}>&-
  fi
  if [[ "$gate_required" == "1" && "$exit_status" != "0" ]]; then
    return "$exit_status"
  fi
  if [[ "$exit_status" == "0" ]]; then
    return 0
  else
    return "$exit_status"
  fi
}

x11_trace_control_event() {
  local operation="$1" exit_status="${2:-0}" detail="${3:-}" xids="${4:-}"
  local timestamp observed_geometry="not_sampled_control"
  x11_trace_enabled || return 0
  timestamp="$(x11_monotonic_ns)"
  x11_trace_load_snapshot
  x11_trace_record "$operation" "$xids" "control" "$timestamp" "$timestamp" \
    "$exit_status" "$observed_geometry" "$detail"
}

switch_trace_enabled() {
  [[ -n "$TIKPAL_WEB_MODE_SWITCH_TRACE_EVENTS_PATH" \
    && -n "$TIKPAL_WEB_MODE_SWITCH_TRACE_RUN_ID" \
    && "$TIKPAL_WEB_MODE_SWITCH_TRACE_ROUND_ID" =~ ^[1-9][0-9]*$ \
    && "$TIKPAL_WEB_MODE_SWITCH_TRACE_PASS_INDEX" =~ ^[1-9][0-9]*$ \
    && -n "$TIKPAL_WEB_MODE_SWITCH_TRACE_FROM_PROVIDER" \
    && -n "$TIKPAL_WEB_MODE_SWITCH_TRACE_TO_PROVIDER" \
    && -n "$TIKPAL_WEB_MODE_SWITCH_TRACE_REQUEST_ID" \
    && "$TIKPAL_WEB_MODE_SWITCH_TRACE_MONOTONIC_OFFSET_MS" =~ ^-?[0-9]+$ ]]
}

switch_trace_now_ms() {
  local output_variable="$1"
  local realtime="${EPOCHREALTIME:-}" seconds fraction computed_ms
  if [[ "$realtime" =~ ^([0-9]+)[.]([0-9]+)$ ]]; then
    seconds="${BASH_REMATCH[1]}"
    fraction="${BASH_REMATCH[2]}000"
    fraction="${fraction:0:3}"
    computed_ms=$((seconds * 1000 + 10#$fraction - TIKPAL_WEB_MODE_SWITCH_TRACE_MONOTONIC_OFFSET_MS))
  else
    computed_ms="$(( $(now_ms) - TIKPAL_WEB_MODE_SWITCH_TRACE_MONOTONIC_OFFSET_MS ))"
  fi
  printf -v "$output_variable" '%s' "$computed_ms"
}

record_switch_trace_event() {
  local event="$1"
  local result="${2:-ok}"
  local error_code="${3:-}"
  local elapsed_ms="${4:-0}"
  local timestamp
  switch_trace_enabled || return 0
  switch_trace_now_ms timestamp
  if [[ ! -f "$TIKPAL_WEB_MODE_SWITCH_TRACE_EVENTS_PATH" ]]; then
    if [[ "$TIKPAL_SWITCH_TRACE_APPEND_WARNING_EMITTED" != "1" ]]; then
      log_stage "WARN: SWITCH_TRACE_APPEND_FAILED path=$TIKPAL_WEB_MODE_SWITCH_TRACE_EVENTS_PATH reason=missing"
      TIKPAL_SWITCH_TRACE_APPEND_WARNING_EMITTED=1
    fi
    return 0
  fi
  if ! { printf '{"run_id":"%s","round_id":%s,"from_provider":"%s","to_provider":"%s","pass_index":%s,"request_id":"%s","event":"%s","timestamp":%s,"elapsed_ms":%s,"result":"%s","error_code":"%s"}\n' \
      "$TIKPAL_WEB_MODE_SWITCH_TRACE_RUN_ID" \
      "$TIKPAL_WEB_MODE_SWITCH_TRACE_ROUND_ID" \
      "$TIKPAL_WEB_MODE_SWITCH_TRACE_FROM_PROVIDER" \
      "$TIKPAL_WEB_MODE_SWITCH_TRACE_TO_PROVIDER" \
      "$TIKPAL_WEB_MODE_SWITCH_TRACE_PASS_INDEX" \
      "$TIKPAL_WEB_MODE_SWITCH_TRACE_REQUEST_ID" \
      "$event" "$timestamp" "$elapsed_ms" "$result" "$error_code" \
      >> "$TIKPAL_WEB_MODE_SWITCH_TRACE_EVENTS_PATH"; } 2>/dev/null
  then
    if [[ "$TIKPAL_SWITCH_TRACE_APPEND_WARNING_EMITTED" != "1" ]]; then
      log_stage "WARN: SWITCH_TRACE_APPEND_FAILED path=$TIKPAL_WEB_MODE_SWITCH_TRACE_EVENTS_PATH"
      TIKPAL_SWITCH_TRACE_APPEND_WARNING_EMITTED=1
    fi
  fi
  return 0
}

switch_detail_timing_path() {
  printf '%s.details\n' "$TIKPAL_WEB_MODE_SWITCH_SEGMENT_TIMING_ONCE_PATH"
}

record_switch_detail_timing() {
  local enabled="$1"
  shift
  [[ "$enabled" == "1" && -e "$TIKPAL_WEB_MODE_SWITCH_SEGMENT_TIMING_ONCE_PATH" ]] || return 0
  printf '%s\n' "$*" >> "$(switch_detail_timing_path)"
}

fail() {
  log "ERROR: $*"
  exit 1
}

with_web_mode_lock() {
  if [[ "${TIKPAL_WEB_MODE_LOCKED:-0}" == "1" ]]; then
    local lock_acquired_ms lock_wait_ms=0
    if switch_trace_enabled; then
      switch_trace_now_ms lock_acquired_ms
      if [[ "${TIKPAL_WEB_MODE_SWITCH_TRACE_LOCK_REQUESTED_MS:-}" =~ ^[0-9]+$ ]]; then
        lock_wait_ms=$((lock_acquired_ms - TIKPAL_WEB_MODE_SWITCH_TRACE_LOCK_REQUESTED_MS))
      fi
      record_switch_trace_event lock_acquired ok "" "$lock_wait_ms"
    fi
    "$@"
    return
  fi
  mkdir -p "$TIKPAL_WEB_MODE_PROFILE_ROOT"
  # Kill orphan close-overlay Chromium via PID file only.
  # Do NOT use pgrep/pkill -f which matches parent sh -lc env vars
  # containing the overlay URL and kills the wrong process.
  local _orphan_pid
  _orphan_pid="$(cat "$TIKPAL_WEB_MODE_PROFILE_ROOT/close-overlay-veil.pid" 2>/dev/null || true)"
  if close_overlay_process_matches "$_orphan_pid"; then
    terminate_close_overlay_process "$_orphan_pid" || true
  fi
  rm -f "$TIKPAL_WEB_MODE_PROFILE_ROOT/close-overlay-veil.pid" 2>/dev/null
  rm -rf "$TIKPAL_WEB_MODE_PROFILE_ROOT/close-overlay."* 2>/dev/null
  if command -v flock >/dev/null 2>&1; then
    local lock_status lock_requested_ms=0 lock_released_ms lock_held_ms=0
    if switch_trace_enabled; then
      switch_trace_now_ms lock_requested_ms
      record_switch_trace_event lock_requested
    fi
    # Keep the lock in flock's parent and close its descriptor before the
    # launcher runs. Background veil/probe helpers then cannot inherit it and
    # extend a completed foreground switch indefinitely.
    if flock -E 75 -o -x -w "$TIKPAL_WEB_MODE_LOCK_TIMEOUT_SECONDS" \
      "$TIKPAL_WEB_MODE_PROFILE_ROOT/web-mode.lock" \
      env TIKPAL_WEB_MODE_LOCKED=1 TIKPAL_WEB_MODE_SWITCH_TRACE_LOCK_REQUESTED_MS="$lock_requested_ms" \
      "$0" "${WEB_MODE_COMMAND_ARGS[@]}"
    then
      lock_status=0
    else
      lock_status=$?
    fi
    if switch_trace_enabled; then
      switch_trace_now_ms lock_released_ms
      lock_held_ms=$((lock_released_ms - lock_requested_ms))
      if [[ "$lock_status" == "75" ]]; then
        record_switch_trace_event lock_released failed lock_failed "$lock_held_ms"
      else
        record_switch_trace_event lock_released ok "" "$lock_held_ms"
      fi
    fi
    [[ "$lock_status" == "75" ]] && fail "Explore is already switching"
    return "$lock_status"
  fi
  "$@"
}

x11_helper_switch_enabled() {
  [[ "$TIKPAL_WEB_MODE_X11_HELPER_MODE" == "switch" ||
     "$TIKPAL_WEB_MODE_X11_HELPER_MODE" == "auto" ]]
}

x11_helper_new_id() {
  local value=""
  if [[ -r /proc/sys/kernel/random/uuid ]]; then
    value="$(head -1 /proc/sys/kernel/random/uuid 2>/dev/null || true)"
  fi
  [[ "$value" =~ ^[A-Za-z0-9._:-]+$ ]] || value="${BASHPID}-$(now_ms)-${RANDOM}"
  printf '%s\n' "$value"
}

x11_helper_increment_generation() {
  local output_variable="$1"
  local current=0 next temporary_path
  [[ "${TIKPAL_WEB_MODE_LOCKED:-0}" == "1" ]] || return 1
  if [[ -e "$TIKPAL_WEB_MODE_X11_HELPER_GENERATION_PATH" ]]; then
    current="$(cat "$TIKPAL_WEB_MODE_X11_HELPER_GENERATION_PATH" 2>/dev/null || true)"
    [[ "$current" =~ ^[0-9]+$ ]] || return 1
  fi
  (( current < 9223372036854775806 )) || return 1
  next=$((current + 1))
  mkdir -p "$(dirname "$TIKPAL_WEB_MODE_X11_HELPER_GENERATION_PATH")"
  temporary_path="$TIKPAL_WEB_MODE_X11_HELPER_GENERATION_PATH.$$.$RANDOM.tmp"
  if ! printf '%s\n' "$next" > "$temporary_path" ||
     ! mv -f "$temporary_path" "$TIKPAL_WEB_MODE_X11_HELPER_GENERATION_PATH"; then
    rm -f "$temporary_path" 2>/dev/null || true
    return 1
  fi
  printf -v "$output_variable" '%s' "$next"
  TIKPAL_WEB_MODE_X11_PROCESS_GENERATION="$next"
  x11_trace_control_event generation_published 0 "generation=$next"
}

x11_helper_publish_owner() {
  local owner="$1"
  local generation="$2"
  local target_window="${3:-}"
  local previous_window="${4:-}"
  local panel_window="${5:-}"
  local temporary_path
  [[ "${TIKPAL_WEB_MODE_LOCKED:-0}" == "1" && "$generation" =~ ^[1-9][0-9]*$ ]] || return 1
  mkdir -p "$(dirname "$TIKPAL_WEB_MODE_X11_HELPER_OWNER_PATH")"
  temporary_path="$TIKPAL_WEB_MODE_X11_HELPER_OWNER_PATH.$$.$RANDOM.tmp"
  if [[ "$owner" == "helper" ]]; then
    [[ "$TIKPAL_X11_HELPER_DAEMON_INSTANCE_ID" =~ ^[A-Za-z0-9._:-]+$ &&
       "$TIKPAL_X11_HELPER_CONNECTION_EPOCH" =~ ^[1-9][0-9]*$ &&
       "$TIKPAL_X11_HELPER_LEASE_ID" =~ ^[A-Za-z0-9._:-]+$ &&
       "$target_window" =~ ^[1-9][0-9]*$ && "$previous_window" =~ ^[1-9][0-9]*$ &&
       "$panel_window" =~ ^[1-9][0-9]*$ ]] || return 1
    printf '{"owner":"helper","daemonInstanceId":"%s","connectionEpoch":%s,"generation":%s,"leaseId":"%s","surfaces":[{"role":"target","xid":%s},{"role":"previous","xid":%s},{"role":"panel","xid":%s}]}\n' \
      "$TIKPAL_X11_HELPER_DAEMON_INSTANCE_ID" "$TIKPAL_X11_HELPER_CONNECTION_EPOCH" \
      "$generation" "$TIKPAL_X11_HELPER_LEASE_ID" "$target_window" "$previous_window" \
      "$panel_window" > "$temporary_path" || return 1
  else
    printf '{"owner":"shell","generation":%s,"surfaces":[]}\n' "$generation" > "$temporary_path" || return 1
  fi
  if ! mv -f "$temporary_path" "$TIKPAL_WEB_MODE_X11_HELPER_OWNER_PATH"; then
    rm -f "$temporary_path" 2>/dev/null || true
    return 1
  fi
  x11_trace_control_event "owner_published_$owner" 0 \
    "generation=$generation lease=${TIKPAL_X11_HELPER_LEASE_ID:-}" \
    "${target_window:-}${previous_window:+,$previous_window}${panel_window:+,$panel_window}"
}

x11_helper_prepare_switch() {
  local health request_id
  x11_helper_switch_enabled || return 1
  [[ -x "$TIKPAL_WEB_MODE_X11_HELPER_BINARY" ]] || return 1
  x11_helper_increment_generation TIKPAL_X11_HELPER_GENERATION || return 1
  request_id="$(x11_helper_new_id)"
  if ! health="$(
    TIKPAL_X11_HELPER_CALLER_ROLE="$(x11_trace_writer_role)" \
    TIKPAL_WEB_MODE_X11_HELPER_SOCKET="$TIKPAL_WEB_MODE_X11_HELPER_SOCKET" \
    TIKPAL_WEB_MODE_X11_HELPER_CONNECT_TIMEOUT_MS="$TIKPAL_WEB_MODE_X11_HELPER_CONNECT_TIMEOUT_MS" \
    TIKPAL_WEB_MODE_X11_HELPER_RESPONSE_TIMEOUT_MS="$TIKPAL_WEB_MODE_X11_HELPER_RESPONSE_TIMEOUT_MS" \
      "$TIKPAL_WEB_MODE_X11_HELPER_BINARY" client health --request-id "$request_id" --format tsv
  )"; then
    return 1
  fi
  IFS=$'\t' read -r TIKPAL_X11_HELPER_DAEMON_INSTANCE_ID \
    TIKPAL_X11_HELPER_CONNECTION_EPOCH TIKPAL_X11_HELPER_HEALTH_IN_FLIGHT \
    TIKPAL_X11_HELPER_GENERATION_STATE <<< "$health"
  [[ "$TIKPAL_X11_HELPER_DAEMON_INSTANCE_ID" =~ ^[A-Za-z0-9._:-]+$ &&
     "$TIKPAL_X11_HELPER_CONNECTION_EPOCH" =~ ^[1-9][0-9]*$ &&
     "$TIKPAL_X11_HELPER_HEALTH_IN_FLIGHT" == "0" &&
     "$TIKPAL_X11_HELPER_GENERATION_STATE" == "ok" ]] || return 1
  TIKPAL_X11_HELPER_LEASE_ID="$(x11_helper_new_id)"
  TIKPAL_X11_HELPER_PREPARED=1
  return 0
}

x11_helper_begin_switch() {
  local target_window="$1"
  local target_profile="$2"
  local previous_window="$3"
  local previous_profile="$4"
  local panel_window="$5"
  local panel_profile="$6"
  local target_size target_width target_height panel_size panel_width panel_height
  local target_x target_y previous_x previous_y panel_x panel_y request_id response status
  [[ "$TIKPAL_X11_HELPER_PREPARED" == "1" ]] || return 20
  target_size="$(normalize_window_size "$TIKPAL_WEB_MODE_LEFT_WINDOW")"
  target_width="${target_size%,*}"
  target_height="${target_size#*,}"
  panel_size="$(normalize_window_size "$TIKPAL_WEB_MODE_PANEL_WINDOW")"
  panel_width="${panel_size%,*}"
  panel_height="${panel_size#*,}"
  target_x="${TIKPAL_WEB_MODE_LEFT_POSITION%,*}"
  target_y="${TIKPAL_WEB_MODE_LEFT_POSITION#*,}"
  previous_x="${TIKPAL_WEB_MODE_STAGE_POSITION%,*}"
  previous_y="${TIKPAL_WEB_MODE_STAGE_POSITION#*,}"
  panel_x="${TIKPAL_WEB_MODE_PANEL_POSITION%,*}"
  panel_y="${TIKPAL_WEB_MODE_PANEL_POSITION#*,}"
  x11_helper_publish_owner helper "$TIKPAL_X11_HELPER_GENERATION" \
    "$target_window" "$previous_window" "$panel_window" || return 20
  TIKPAL_X11_HELPER_ACTIVE=1
  request_id="$(x11_helper_new_id)"
  TIKPAL_X11_HELPER_REQUEST_ID="$request_id"
  x11_trace_control_event helper_switch_started 0 \
    "request_id=$request_id generation=$TIKPAL_X11_HELPER_GENERATION lease=$TIKPAL_X11_HELPER_LEASE_ID" \
    "$target_window,$previous_window,$panel_window"
  if response="$(
    TIKPAL_X11_HELPER_CALLER_ROLE="$(x11_trace_writer_role)" \
    TIKPAL_WEB_MODE_X11_HELPER_SOCKET="$TIKPAL_WEB_MODE_X11_HELPER_SOCKET" \
    TIKPAL_WEB_MODE_X11_HELPER_CONNECT_TIMEOUT_MS="$TIKPAL_WEB_MODE_X11_HELPER_CONNECT_TIMEOUT_MS" \
    TIKPAL_WEB_MODE_X11_HELPER_RESPONSE_TIMEOUT_MS="$TIKPAL_WEB_MODE_X11_HELPER_RESPONSE_TIMEOUT_MS" \
      "$TIKPAL_WEB_MODE_X11_HELPER_BINARY" client switch \
        --request-id "$request_id" \
        --daemon-instance-id "$TIKPAL_X11_HELPER_DAEMON_INSTANCE_ID" \
        --connection-epoch "$TIKPAL_X11_HELPER_CONNECTION_EPOCH" \
        --generation "$TIKPAL_X11_HELPER_GENERATION" \
        --lease-id "$TIKPAL_X11_HELPER_LEASE_ID" \
        --lease-duration-ms "$TIKPAL_WEB_MODE_X11_HELPER_LEASE_MS" \
        --surface target "$target_window" "$target_profile" "$target_x" "$target_y" "$target_width" "$target_height" 4294967295 \
        --surface previous "$previous_window" "$previous_profile" "$previous_x" "$previous_y" "$target_width" "$target_height" keep \
        --surface panel "$panel_window" "$panel_profile" "$panel_x" "$panel_y" "$panel_width" "$panel_height" 4294967295
  )"; then
    status=0
  else
    status=$?
  fi
  TIKPAL_X11_HELPER_LAST_RESPONSE="$response"
  x11_trace_control_event helper_switch_finished "$status" \
    "request_id=$request_id response=$response" \
    "$target_window,$previous_window,$panel_window"
  log_stage "x11_helper_switch generation=$TIKPAL_X11_HELPER_GENERATION lease=$TIKPAL_X11_HELPER_LEASE_ID status=$status response=$response"
  if [[ "$status" == "70" ]]; then
    TIKPAL_X11_HELPER_UNKNOWN=1
  fi
  return "$status"
}

x11_helper_revoke() {
  local request_id response
  [[ "$TIKPAL_X11_HELPER_ACTIVE" == "1" ]] || return 0
  request_id="$(x11_helper_new_id)"
  x11_trace_control_event helper_revoke_started 0 \
    "request_id=$request_id switch_request_id=$TIKPAL_X11_HELPER_REQUEST_ID generation=$TIKPAL_X11_HELPER_GENERATION lease=$TIKPAL_X11_HELPER_LEASE_ID"
  if ! response="$(
    TIKPAL_X11_HELPER_CALLER_ROLE="$(x11_trace_writer_role)" \
    TIKPAL_WEB_MODE_X11_HELPER_SOCKET="$TIKPAL_WEB_MODE_X11_HELPER_SOCKET" \
    TIKPAL_WEB_MODE_X11_HELPER_CONNECT_TIMEOUT_MS="$TIKPAL_WEB_MODE_X11_HELPER_CONNECT_TIMEOUT_MS" \
    TIKPAL_WEB_MODE_X11_HELPER_RESPONSE_TIMEOUT_MS="$TIKPAL_WEB_MODE_X11_HELPER_RESPONSE_TIMEOUT_MS" \
      "$TIKPAL_WEB_MODE_X11_HELPER_BINARY" client revoke \
        --request-id "$request_id" \
        --daemon-instance-id "$TIKPAL_X11_HELPER_DAEMON_INSTANCE_ID" \
        --connection-epoch "$TIKPAL_X11_HELPER_CONNECTION_EPOCH" \
        --generation "$TIKPAL_X11_HELPER_GENERATION" \
        --lease-id "$TIKPAL_X11_HELPER_LEASE_ID"
  )"; then
    x11_trace_control_event helper_revoke_finished 1 \
      "request_id=$request_id result=failed response=$response"
    log_stage "x11_helper_revoke generation=$TIKPAL_X11_HELPER_GENERATION result=failed response=$response"
    return 1
  fi
  x11_trace_control_event helper_revoke_finished 0 \
    "request_id=$request_id result=ok response=$response"
  log_stage "x11_helper_revoke generation=$TIKPAL_X11_HELPER_GENERATION result=ok response=$response"
  TIKPAL_X11_HELPER_ACTIVE=0
  return 0
}

x11_helper_finish_success() {
  [[ "$TIKPAL_X11_HELPER_UNKNOWN" == "0" ]] || return 1
  x11_helper_revoke || return 1
  x11_helper_publish_owner shell "$TIKPAL_X11_HELPER_GENERATION" || return 1
  TIKPAL_X11_HELPER_PREPARED=0
}

x11_helper_cleanup_active_transaction() {
  local cleanup_status=0
  [[ "$TIKPAL_X11_HELPER_ACTIVE" == "1" ]] || return 0
  if [[ "$TIKPAL_X11_HELPER_UNKNOWN" == "1" ]]; then
    log_stage "WARN: X11_HELPER_CLEANUP_BLOCKED reason=unknown_outcome generation=${TIKPAL_X11_HELPER_GENERATION:-missing}"
    return 1
  fi
  if ! x11_helper_revoke; then
    log_stage "WARN: X11_HELPER_CLEANUP_FAILED stage=revoke generation=${TIKPAL_X11_HELPER_GENERATION:-missing}"
    return 1
  fi
  if ! x11_helper_publish_owner shell "$TIKPAL_X11_HELPER_GENERATION"; then
    log_stage "WARN: X11_HELPER_CLEANUP_FAILED stage=owner_restore generation=${TIKPAL_X11_HELPER_GENERATION:-missing}"
    cleanup_status=1
  else
    TIKPAL_X11_HELPER_PREPARED=0
    log_stage "x11_helper_cleanup generation=$TIKPAL_X11_HELPER_GENERATION result=ok"
  fi
  return "$cleanup_status"
}

x11_helper_cleanup_on_exit() {
  local status=$? cleanup_status=0
  trap - EXIT
  set +e
  if [[ "$TIKPAL_X11_HELPER_ACTIVE" == "1" ]]; then
    x11_helper_cleanup_active_transaction
    cleanup_status=$?
    if [[ "$status" == "0" && "$cleanup_status" != "0" ]]; then
      status=1
    fi
  fi
  if [[ "${WEB_MODE_COMMAND_ARGS[0]:-}" == "guard" ]]; then
    window_guard_cleanup_pid_on_exit || true
  fi
  exit "$status"
}

x11_helper_enter_fallback() {
  local switch_status="$1"
  local fallback_generation
  [[ "$switch_status" != "70" && "$TIKPAL_X11_HELPER_UNKNOWN" == "0" ]] || return 1
  if [[ "$switch_status" != "69" ]]; then
    x11_helper_revoke || return 1
  else
    TIKPAL_X11_HELPER_ACTIVE=0
  fi
  x11_helper_increment_generation fallback_generation || return 1
  TIKPAL_X11_HELPER_GENERATION="$fallback_generation"
  x11_helper_publish_owner shell "$fallback_generation" || return 1
  TIKPAL_X11_HELPER_PREPARED=0
  return 0
}

x11_helper_restore_shell_owner() {
  local owner_state health request_id owner generation current_generation
  local daemon_instance connection_epoch lease_id in_flight health_lease restore_generation
  [[ "${TIKPAL_WEB_MODE_LOCKED:-0}" == "1" ]] || return 1
  if [[ ! -e "$TIKPAL_WEB_MODE_X11_HELPER_OWNER_PATH" ]]; then
    [[ "$TIKPAL_WEB_MODE_X11_HELPER_MODE" == "disabled" ]]
    return
  fi
  command -v jq >/dev/null 2>&1 || return 1
  owner_state="$(cat "$TIKPAL_WEB_MODE_X11_HELPER_OWNER_PATH" 2>/dev/null || true)"
  owner="$(jq -r '.owner // empty' <<< "$owner_state" 2>/dev/null || true)"
  generation="$(jq -r '.generation // empty' <<< "$owner_state" 2>/dev/null || true)"
  current_generation="$(cat "$TIKPAL_WEB_MODE_X11_HELPER_GENERATION_PATH" 2>/dev/null || true)"
  [[ "$generation" =~ ^[1-9][0-9]*$ && "$current_generation" == "$generation" ]] || return 1
  if [[ "$owner" == "shell" || "$owner" == "none" ]]; then
    return 0
  fi
  [[ "$owner" == "helper" && -x "$TIKPAL_WEB_MODE_X11_HELPER_BINARY" ]] || return 1
  daemon_instance="$(jq -r '.daemonInstanceId // empty' <<< "$owner_state")"
  connection_epoch="$(jq -r '.connectionEpoch // empty' <<< "$owner_state")"
  lease_id="$(jq -r '.leaseId // empty' <<< "$owner_state")"
  [[ "$daemon_instance" =~ ^[A-Za-z0-9._:-]+$ &&
     "$connection_epoch" =~ ^[1-9][0-9]*$ &&
     "$lease_id" =~ ^[A-Za-z0-9._:-]+$ ]] || return 1
  request_id="cleanup-health-$(x11_helper_new_id)"
  health="$(
    TIKPAL_X11_HELPER_CALLER_ROLE=cleanup_shell \
    TIKPAL_WEB_MODE_X11_HELPER_SOCKET="$TIKPAL_WEB_MODE_X11_HELPER_SOCKET" \
    TIKPAL_WEB_MODE_X11_HELPER_CONNECT_TIMEOUT_MS="$TIKPAL_WEB_MODE_X11_HELPER_CONNECT_TIMEOUT_MS" \
    TIKPAL_WEB_MODE_X11_HELPER_RESPONSE_TIMEOUT_MS="$TIKPAL_WEB_MODE_X11_HELPER_RESPONSE_TIMEOUT_MS" \
      "$TIKPAL_WEB_MODE_X11_HELPER_BINARY" client health --request-id "$request_id"
  )" || return 1
  in_flight="$(jq -r '.inFlight | tostring' <<< "$health")"
  health_lease="$(jq -r '.leaseId // empty' <<< "$health")"
  if [[ "$in_flight" == "true" || -n "$health_lease" ]]; then
    [[ "$(jq -r '.daemonInstanceId // empty' <<< "$health")" == "$daemon_instance" &&
       "$(jq -r '.connectionEpoch // empty' <<< "$health")" == "$connection_epoch" &&
       "$health_lease" == "$lease_id" ]] || return 1
    TIKPAL_X11_HELPER_DAEMON_INSTANCE_ID="$daemon_instance"
    TIKPAL_X11_HELPER_CONNECTION_EPOCH="$connection_epoch"
    TIKPAL_X11_HELPER_GENERATION="$generation"
    TIKPAL_X11_HELPER_LEASE_ID="$lease_id"
    TIKPAL_X11_HELPER_ACTIVE=1
    TIKPAL_X11_HELPER_UNKNOWN=0
    x11_helper_revoke || return 1
  fi
  x11_helper_increment_generation restore_generation || return 1
  TIKPAL_X11_HELPER_GENERATION="$restore_generation"
  x11_helper_publish_owner shell "$restore_generation" || return 1
  TIKPAL_X11_HELPER_PREPARED=0
  TIKPAL_X11_HELPER_ACTIVE=0
  TIKPAL_X11_HELPER_UNKNOWN=0
  log_stage "x11_helper_cleanup_owner_restored generation=$restore_generation"
}

x11_helper_guard_may_write() {
  local -a arguments=(client owner-allows
    --file "$TIKPAL_WEB_MODE_X11_HELPER_OWNER_PATH"
    --generation-file "$TIKPAL_WEB_MODE_X11_HELPER_GENERATION_PATH")
  local xid
  if [[ ! -e "$TIKPAL_WEB_MODE_X11_HELPER_OWNER_PATH" ]]; then
    [[ "$TIKPAL_WEB_MODE_X11_HELPER_MODE" == "disabled" ]]
    return
  fi
  [[ -x "$TIKPAL_WEB_MODE_X11_HELPER_BINARY" ]] || return 1
  for xid in "$@"; do
    [[ "$xid" =~ ^[1-9][0-9]*$ ]] && arguments+=(--xid "$xid")
  done
  [[ "${#arguments[@]}" -gt 6 ]] || return 1
  "$TIKPAL_WEB_MODE_X11_HELPER_BINARY" "${arguments[@]}" >/dev/null 2>&1
}

x11_helper_guard_may_recover_all() {
  local diagnostic status
  if [[ ! -e "$TIKPAL_WEB_MODE_X11_HELPER_OWNER_PATH" ]]; then
    [[ "$TIKPAL_WEB_MODE_X11_HELPER_MODE" == "disabled" ]]
    return
  fi
  [[ -x "$TIKPAL_WEB_MODE_X11_HELPER_BINARY" ]] || return 1
  if diagnostic="$(
    "$TIKPAL_WEB_MODE_X11_HELPER_BINARY" client owner-allows \
      --file "$TIKPAL_WEB_MODE_X11_HELPER_OWNER_PATH" \
      --generation-file "$TIKPAL_WEB_MODE_X11_HELPER_GENERATION_PATH" \
      --all 2>&1
  )"; then
    return 0
  else
    status=$?
  fi
  [[ -z "$diagnostic" ]] || log "ERROR: Explore recovery arbitration failed: $diagnostic"
  return "$status"
}

x11_helper_legacy_writer_may_write() {
  if [[ ! -e "$TIKPAL_WEB_MODE_X11_HELPER_OWNER_PATH" ]]; then
    [[ "$TIKPAL_WEB_MODE_X11_HELPER_MODE" == "disabled" ]]
    return
  fi
  [[ -x "$TIKPAL_WEB_MODE_X11_HELPER_BINARY" ]] || return 1
  "$TIKPAL_WEB_MODE_X11_HELPER_BINARY" client owner-allows \
    --file "$TIKPAL_WEB_MODE_X11_HELPER_OWNER_PATH" \
    --generation-file "$TIKPAL_WEB_MODE_X11_HELPER_GENERATION_PATH" \
    --all >/dev/null 2>&1
}

provider_state_lock_path() {
  printf '%s\n' "$TIKPAL_WEB_MODE_PROFILE_ROOT/provider-state.lock"
}

with_provider_state_lock() {
  if [[ "${TIKPAL_WEB_MODE_PROVIDER_STATE_LOCKED:-0}" == "1" ]]; then
    "$@"
    return
  fi
  mkdir -p "$TIKPAL_WEB_MODE_PROFILE_ROOT"
  if command -v flock >/dev/null 2>&1; then
    (
      flock -x 8
      TIKPAL_WEB_MODE_PROVIDER_STATE_LOCKED=1 "$@"
    ) 8>"$(provider_state_lock_path)"
    return
  fi
  TIKPAL_WEB_MODE_PROVIDER_STATE_LOCKED=1 "$@"
}

with_onboard_lock() {
  mkdir -p "$TIKPAL_WEB_MODE_PROFILE_ROOT"
  if command -v flock >/dev/null 2>&1; then
    (
      flock -x -w "$TIKPAL_WEB_MODE_ONBOARD_LOCK_TIMEOUT_SECONDS" 8 || fail "Onboard is busy"
      "$@"
    ) 8>"$TIKPAL_WEB_MODE_PROFILE_ROOT/onboard.lock"
    return
  fi
  "$@"
}

is_enabled() {
  local value
  value="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  [[ "$value" == "1" || "$value" == "true" || "$value" == "yes" || "$value" == "on" || "$value" == "enabled" ]]
}

detect_non_hdmi_card_id() {
  command -v aplay >/dev/null 2>&1 || return 1
  aplay -l 2>/dev/null | awk '
    /^card [0-9]+:/ {
      line = $0
      lower = tolower(line)
      if (lower ~ /loopback|vc4hdmi|bcm2835|hdmi/) next
      id = line
      sub(/^card [0-9]+: /, "", id)
      sub(/[[:space:]].*$/, "", id)
      gsub(/[^[:alnum:]_-]/, "", id)
      if (id == "") next
      if (lower ~ /usb/) {
        print id
        found = 1
        exit
      }
      if (first == "") first = id
    }
    END {
      if (!found && first != "") print first
    }
  '
}

resolve_physical_alsa_output_device() {
  local value lower card_id
  value="$(printf '%s' "${1:-}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  lower="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"
  case "$lower" in
    ""|default)
      printf '\n'
      ;;
    auto)
      if [[ -x "$TIKPAL_AUDIO_ADAPT_BIN" ]]; then
        if "$TIKPAL_AUDIO_ADAPT_BIN" resolve-browser; then
          return
        fi
        log "WARN: audio adapter failed; falling back to first non-HDMI ALSA card" >&2
      fi
      card_id="$(detect_non_hdmi_card_id || true)"
      if [[ -z "$card_id" ]]; then
        log "WARN: auto ALSA output requested but no non-HDMI card was detected" >&2
        printf '\n'
        return
      fi
      printf 'dmix:CARD=%s,DEV=0\n' "$card_id"
      ;;
    *)
      printf '%s\n' "$value"
      ;;
  esac
}

resolve_web_mode_audio_devices() {
  [[ "${TIKPAL_WEB_MODE_AUDIO_DEVICES_RESOLVED:-0}" == "1" ]] && return 0
  TIKPAL_CHROMIUM_ALSA_OUTPUT_DEVICE="$(resolve_physical_alsa_output_device "$TIKPAL_CHROMIUM_ALSA_OUTPUT_DEVICE")"
  TIKPAL_WEB_MODE_ALSA_OUTPUT_DEVICE="$(resolve_physical_alsa_output_device "$TIKPAL_WEB_MODE_ALSA_OUTPUT_DEVICE")"
  TIKPAL_WEB_MODE_AUDIO_DEVICES_RESOLVED=1
}

normalize_window_size() {
  local value
  value="$(printf '%s' "$1" | tr -d '[:space:]')"
  if [[ "$value" =~ ^([0-9]+)[xX,]([0-9]+)$ ]]; then
    printf '%s,%s\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
    return
  fi
  fail "Invalid window size '$1'; expected WIDTHxHEIGHT or WIDTH,HEIGHT"
}

window_width() {
  local size
  size="$(normalize_window_size "$1")"
  printf '%s\n' "${size%,*}"
}

window_height() {
  local size
  size="$(normalize_window_size "$1")"
  printf '%s\n' "${size#*,}"
}

position_x() {
  printf '%s\n' "${1%,*}"
}

position_y() {
  printf '%s\n' "${1#*,}"
}

provider_url() {
  case "$1" in
    suno) printf '%s\n' "${TIKPAL_WEB_MODE_SUNO_URL:-https://suno.com/explore}" ;;
    spotify) printf '%s\n' "${TIKPAL_WEB_MODE_SPOTIFY_URL:-https://open.spotify.com/}" ;;
    youtube_music) printf '%s\n' "${TIKPAL_WEB_MODE_YOUTUBE_MUSIC_URL:-https://music.youtube.com/}" ;;
    apple_music) printf '%s\n' "${TIKPAL_WEB_MODE_APPLE_MUSIC_URL:-https://music.apple.com/}" ;;
    tidal) printf '%s\n' "${TIKPAL_WEB_MODE_TIDAL_URL:-https://listen.tidal.com/}" ;;
    qobuz) printf '%s\n' "${TIKPAL_WEB_MODE_QOBUZ_URL:-https://play.qobuz.com/}" ;;
    deezer) printf '%s\n' "${TIKPAL_WEB_MODE_DEEZER_URL:-https://www.deezer.com/en/channels/explore/}" ;;
    amazon_music) printf '%s\n' "${TIKPAL_WEB_MODE_AMAZON_MUSIC_URL:-https://music.amazon.com/}" ;;
    qq_music) printf '%s\n' "${TIKPAL_WEB_MODE_QQ_MUSIC_URL:-https://y.qq.com/n/ryqq/player}" ;;
    netease_music) printf '%s\n' "${TIKPAL_WEB_MODE_NETEASE_MUSIC_URL:-https://music.163.com/st/webplayer}" ;;
    *) fail "Unknown Explore provider '$1'" ;;
  esac
}

provider_label() {
  case "$1" in
    suno) printf '%s\n' "Suno" ;;
    spotify) printf '%s\n' "Spotify" ;;
    youtube_music) printf '%s\n' "YouTube Music" ;;
    apple_music) printf '%s\n' "Apple Music" ;;
    tidal) printf '%s\n' "TIDAL" ;;
    qobuz) printf '%s\n' "Qobuz" ;;
    deezer) printf '%s\n' "Deezer" ;;
    amazon_music) printf '%s\n' "Amazon Music" ;;
    qq_music) printf '%s\n' "QQ Music" ;;
    netease_music) printf '%s\n' "NetEase Cloud Music" ;;
    *) printf '%s\n' "$1" ;;
  esac
}

provider_ids() {
  printf '%s\n' \
    suno \
    spotify \
    youtube_music \
    apple_music \
    tidal \
    qobuz \
    deezer \
    amazon_music \
    qq_music \
    netease_music
}

# Prewarm order: slow providers first so they get the earliest concurrent
# slots while fast direct-bootstrap providers fill in later.
provider_prewarm_order() {
  printf '%s\n' \
    youtube_music \
    apple_music \
    tidal \
    deezer \
    spotify \
    suno \
    qobuz \
    amazon_music \
    qq_music \
    netease_music
}


provider_uses_direct_bootstrap() {
  case "$1" in
    deezer|qq_music|netease_music) return 0 ;;
    *) return 1 ;;
  esac
}

provider_prefers_direct_proxy() {
  case "$1" in
    qq_music|netease_music) return 0 ;;
    *) return 1 ;;
  esac
}

effective_provider_proxy_enabled() {
  local provider="$1"
  local global_proxy_enabled="${2:-0}"
  if [[ "$global_proxy_enabled" != "1" ]]; then
    printf '0\n'
    return
  fi
  if provider_prefers_direct_proxy "$provider"; then
    printf '0\n'
    return
  fi
  printf '1\n'
}

provider_debug_port() {
  local base="$TIKPAL_WEB_MODE_PROVIDER_DEBUG_PORT"
  local offset=0
  [[ "$base" =~ ^[0-9]+$ ]] || base=9234
  case "$1" in
    suno) offset=9 ;;
    spotify) offset=0 ;;
    youtube_music) offset=1 ;;
    apple_music) offset=2 ;;
    tidal) offset=3 ;;
    qobuz) offset=4 ;;
    deezer) offset=5 ;;
    amazon_music) offset=6 ;;
    qq_music) offset=7 ;;
    netease_music) offset=8 ;;
  esac
  printf '%s\n' "$((base + offset))"
}

read_flags() {
  local flags=()
  local line
  [[ -f "$FLAGS_FILE" ]] || {
    printf '%s\n' "${flags[@]}"
    return
  }
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    flags+=("$line")
  done < "$FLAGS_FILE"
  printf '%s\n' "${flags[@]}"
}

read_proxy_settings() {
  node - "$TIKPAL_WEB_MODE_SETTINGS_PATH" "$TIKPAL_WEB_MODE_DEFAULT_PROXY_URL" <<'NODE'
const fs = require("node:fs");
const [settingsPath, defaultProxy] = process.argv.slice(2);
let settings = {};
try { settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")); } catch {}
const enabled = typeof settings.proxyEnabled === "boolean" ? settings.proxyEnabled : true;
const proxyUrl = String(settings.proxyUrl || defaultProxy).trim();
console.log(`${enabled ? "1" : "0"}\t${proxyUrl}`);
NODE
}

http_code_is_reachable() {
  local code="$1"
  [[ "$code" =~ ^[1-5][0-9][0-9]$ && "$code" != "000" ]]
}

provider_direct_reachable() {
  local provider="$1"
  local url code timeout
  is_enabled "$TIKPAL_WEB_MODE_DIRECT_PROBE_ENABLED" || return 0
  command -v curl >/dev/null 2>&1 || return 0
  timeout="$TIKPAL_WEB_MODE_DIRECT_PROBE_TIMEOUT_SECONDS"
  [[ "$timeout" =~ ^[0-9]+$ ]] || timeout=4
  url="$(provider_url "$provider")"
  code="$(curl --noproxy '*' -k -I -L -sS -o /dev/null \
    --connect-timeout 2 --max-time "$timeout" -w '%{http_code}' "$url" 2>/dev/null || true)"
  if http_code_is_reachable "$code"; then
    return 0
  fi
  code="$(curl --noproxy '*' -k -L -r 0-0 -sS -o /dev/null \
    --connect-timeout 2 --max-time "$timeout" -w '%{http_code}' "$url" 2>/dev/null || true)"
  http_code_is_reachable "$code"
}

provider_needs_proxy_message() {
  printf '%s needs proxy' "$(provider_label "$1")"
}

urlencode_query() {
  node -e 'process.stdout.write(encodeURIComponent(process.argv[1] || ""))' "$1"
}

read_provider_text_scale() {
  node - "$TIKPAL_WEB_MODE_SETTINGS_PATH" <<'NODE'
const fs = require("node:fs");
const [settingsPath] = process.argv.slice(2);
let settings = {};
try { settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")); } catch {}
const raw = Number(settings.providerTextScale);
const rounded = Math.round(raw * 100) / 100;
const value = [1, 1.1, 1.2].find((candidate) => Math.abs(candidate - rounded) < 0.001) ?? 1.1;
console.log(value.toFixed(2).replace(/\.00$/, ""));
NODE
}

proxy_revision_applied() {
  node - "$TIKPAL_WEB_MODE_SETTINGS_PATH" "$TIKPAL_WEB_MODE_STATE_PATH" <<'NODE'
const fs = require("node:fs");
const [settingsPath, statePath] = process.argv.slice(2);
let settings = {};
let state = {};
try { settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")); } catch {}
try { state = JSON.parse(fs.readFileSync(statePath, "utf8")); } catch {}
process.exit(settings.updatedAt && settings.updatedAt === state.proxyAppliedSettingsUpdatedAt ? 0 : 1);
NODE
}

wait_for_proxy_applied() {
  local attempts=$((TIKPAL_WEB_MODE_PROXY_APPLY_TIMEOUT_SECONDS * 10))
  while [[ "$attempts" -gt 0 ]]; do
    proxy_revision_applied && return 0
    sleep 0.1
    attempts=$((attempts - 1))
  done
  return 1
}

wait_for_real_provider_url() {
  local provider_port="$1"
  local deadline
  deadline=$((SECONDS + TIKPAL_WEB_MODE_PROVIDER_BOOTSTRAP_TIMEOUT_SECONDS))
  while [[ "$SECONDS" -lt "$deadline" ]]; do
    if provider_cdp_json_list "$provider_port" \
      | node -e 'let body=""; process.stdin.on("data", chunk => body += chunk); process.stdin.on("end", () => { try { process.exit(JSON.parse(body).some(target => target.type === "page" && String(target.url || "").startsWith("https://")) ? 0 : 1); } catch { process.exit(1); } });'; then
      return 0
    fi
    sleep 0.1
  done
  return 1
}

provider_cdp_json_list() {
  local provider_port="$1"
  # Chromium can accept a DevTools connection while its renderer is wedged.
  # This check is part of the foreground switch path, so it must never inherit
  # the API command's much longer timeout.
  # The Gentoo curl accepts only integer --connect-timeout values. Keep the
  # foreground probe bounded below one second without making every resident
  # page look absent on that runtime.
  timeout 0.8 curl --noproxy '*' -sf --connect-timeout 1 --max-time 1 "http://127.0.0.1:$provider_port/json/list" 2>/dev/null
}

set_provider_media_active_via_cdp() {
  local _gate_started_ms="$(now_ms)"
  local provider_port="$1"
  local active="${2:-0}"
  local cdp_json="${3:-}"
  local ws_url
  if [[ -z "$cdp_json" ]]; then
    cdp_json="$(timeout 1 curl --noproxy '*' -sf --connect-timeout 1 --max-time 1 "http://127.0.0.1:$provider_port/json/list" 2>/dev/null)"
  fi
  # Extract ws_url with grep (no node startup).
  ws_url="$(printf '%s\n' "$cdp_json" | grep -A2 '"type": "page"' | grep -o '"ws://[^"]*"' | head -1 | tr -d '"')"
  [[ -n "$ws_url" ]] || return 1
  # Python raw socket WebSocket — avoids ~460ms node startup per call.
  timeout 2 python3 -c '
import socket, json, base64, os, sys, select
def recv_exact(s, n):
    buf = b""
    while len(buf) < n:
        if not select.select([s], [], [], 1.0)[0]: return buf
        d = s.recv(n - len(buf))
        if not d: return buf
        buf += d
    return buf
ws_url = sys.argv[1]
active = sys.argv[2] == "1"
host_port = ws_url.split("/")[2]
host, port = host_port.split(":", 1)
path = "/" + "/".join(ws_url.split("/")[3:])
sock = socket.create_connection((host, int(port)), timeout=1)
key = base64.b64encode(os.urandom(16)).decode()
req = "GET " + path + " HTTP/1.1\r\nHost: " + host_port + "\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: " + key + "\r\nSec-WebSocket-Version: 13\r\n\r\n"
sock.sendall(req.encode())
resp = b""
while b"\r\n\r\n" not in resp:
    d = sock.recv(4096)
    if not d: break
    resp += d
if b"101" not in resp.split(b"\r\n")[0]:
    sock.close(); sys.exit(1)
cmd = json.dumps({"id":1,"method":"Runtime.evaluate","params":{
    "expression":"(window.__tikpalProviderAudioGate?.setActive(" + ("true" if active else "false") + ") || {}).active",
    "returnByValue":True}}).encode()
mask = os.urandom(4)
masked = bytes(cmd[i] ^ mask[i%4] for i in range(len(cmd)))
hdr = bytearray([0x81])
n = len(cmd)
if n < 126:
    hdr.append(0x80 | n)
elif n < 65536:
    hdr.append(0x80 | 126)
    hdr.extend(n.to_bytes(2, "big"))
hdr.extend(mask)
sock.sendall(bytes(hdr) + masked)
hdr2 = recv_exact(sock, 2)
if len(hdr2) < 2: sock.close(); sys.exit(1)
plen = hdr2[1] & 0x7F
if plen == 126: plen = int.from_bytes(recv_exact(sock, 2), "big")
payload = recv_exact(sock, plen)
sock.close()
try:
    message = json.loads(payload.decode())
    value = message.get("result", {}).get("result", {}).get("value")
except Exception:
    sys.exit(1)
sys.exit(0 if value is active else 1)
' "$ws_url" "$active" 2>/dev/null
}

pause_provider_media_via_cdp() {
  set_provider_media_active_via_cdp "$1" 0 "${2:-}"
}

activate_target_provider_audio_gate() {
  local provider="$1"
  local provider_port="$2"
  local started_ms elapsed_ms
  started_ms="$(now_ms)"
  record_switch_trace_event target_audio_gate_activation_started
  if set_provider_media_active_via_cdp "$provider_port" 1; then
    elapsed_ms="$(( $(now_ms) - started_ms ))"
    log_stage "target_audio_gate provider=$provider result=active ms=$elapsed_ms"
    record_switch_trace_event target_audio_gate_activated ok "" "$elapsed_ms"
    return 0
  fi
  elapsed_ms="$(( $(now_ms) - started_ms ))"
  log "WARN: target provider audio gate did not activate synchronously: $provider"
  record_switch_trace_event target_audio_gate_activated failed target_audio_gate_failed "$elapsed_ms"
  return 1
}

provider_window_has_nonblank_x11_frame() {
  local target_window="$1"
  [[ "$target_window" =~ ^[0-9]+$ ]] || return 1
  command -v ffmpeg >/dev/null 2>&1 || return 1
  # Read the target X11 window itself while the transition veil is still on
  # top.  Sampling the composed left pane made a blank Chromium target look
  # healthy whenever the old provider, transition, or kiosk beneath it was
  # bright. A flat white/gray first paint has no useful contrast and must
  # remain covered until the already-resident provider redraws. Do not require
  # whole-frame texture: a fully rendered provider error or consent page can
  # be a dark surface with a small but physically visible text treatment.
  DISPLAY="$TIKPAL_KIOSK_DISPLAY" XAUTHORITY="$XAUTHORITY" \
    timeout 1 ffmpeg -hide_banner -loglevel error \
      -f x11grab -window_id "$target_window" -i "$TIKPAL_KIOSK_DISPLAY.0" \
      -frames:v 1 -vf 'scale=96:36:flags=fast_bilinear,format=gray' \
      -f rawvideo - 2>/dev/null \
    | node -e '
      const chunks = [];
      process.stdin.on("data", (chunk) => chunks.push(chunk));
      process.stdin.on("end", () => {
        const pixels = Buffer.concat(chunks);
        if (pixels.length < 512) process.exit(1);
        const stride = Math.max(1, Math.floor(pixels.length / 4096));
        let min = 255, max = 0;
        for (let index = 0; index < pixels.length; index += stride) {
          const value = pixels[index];
          min = Math.min(min, value);
          max = Math.max(max, value);
        }
        process.exit(max - min >= 18 ? 0 : 1);
      });
    '
}

wait_for_provider_window_nonblank_x11_frame() {
  local target_window="$1"
  local timeout_seconds="$TIKPAL_WEB_MODE_RESIDENT_SWITCH_PAINT_TIMEOUT_SECONDS"
  local poll_seconds="$TIKPAL_WEB_MODE_RESIDENT_SWITCH_PAINT_POLL_SECONDS"
  local deadline
  [[ "$timeout_seconds" =~ ^[0-9]+([.][0-9]+)?$ ]] || timeout_seconds=3
  [[ "$poll_seconds" =~ ^[0-9]+([.][0-9]+)?$ ]] || poll_seconds=0.08
  deadline="$(awk -v now="$(now_ms)" -v timeout="$timeout_seconds" 'BEGIN { printf "%.0f", now + timeout * 1000 }')"
  while (( $(now_ms) < deadline )); do
    provider_window_has_nonblank_x11_frame "$target_window" && return 0
    sleep "$poll_seconds"
  done
  provider_window_has_nonblank_x11_frame "$target_window"
}

# Background probe: check for a non-blank X11 frame while the transition
# veil is still visible.  Writes "1" to a temp file on success so
# reveal_resident_provider_window can skip its synchronous wait.
probe_target_window_background() {
  local target_window="$1"
  local probe_file="$TIKPAL_WEB_MODE_PROFILE_ROOT/.paint-probe-$target_window"
  rm -f "$probe_file"
  (
    if wait_for_provider_window_nonblank_x11_frame "$target_window"; then
      printf '1' > "$probe_file"
    fi
  ) >/dev/null 2>&1 &
}

# Check whether a background paint probe already passed.
check_target_window_probe() {
  local target_window="$1"
  local probe_file="$TIKPAL_WEB_MODE_PROFILE_ROOT/.paint-probe-$target_window"
  [[ -r "$probe_file" ]] && [[ "$(cat "$probe_file" 2>/dev/null)" == "1" ]]
}

# Clean up background probe temp files.
cleanup_target_window_probe() {
  local target_window="$1"
  rm -f "$TIKPAL_WEB_MODE_PROFILE_ROOT/.paint-probe-$target_window"
}

provider_has_real_provider_page() {
  local provider_port="$1"
  [[ "${TIKPAL_WEB_MODE_TRUSTED_PROVIDER_PAGE_PORT:-}" == "$provider_port" ]] && return 0
  # grep avoids ~460 ms node startup; "url": "https:// only appears in real provider pages.
  provider_cdp_json_list "$provider_port" | grep -q '"url": "https://'
}

provider_friendly_error_reason() {
  local provider_port="$1"
  provider_cdp_json_list "$provider_port" \
    | node -e 'let body=""; process.stdin.on("data", chunk => body += chunk); process.stdin.on("end", () => { try { const target = JSON.parse(body).find(item => { if (item.type !== "page") return false; const url = new URL(String(item.url || "")); return url.pathname.endsWith("/web-mode-error.html"); }); process.stdout.write(target ? new URL(String(target.url)).searchParams.get("reason") || "" : ""); } catch {} });'
}

wait_for_provider_ready() {
  local provider_port="$1"
  local provider="${2:-}"
  local timeout_seconds="${3:-$TIKPAL_WEB_MODE_PROVIDER_READY_TIMEOUT_SECONDS}"
  node --experimental-websocket - "$provider_port" "$timeout_seconds" "$provider" <<'NODE'
const [port, timeoutSeconds, provider] = process.argv.slice(2);
const deadline = Date.now() + Math.max(1, Number(timeoutSeconds) || 18) * 1000;
const readyExpression = `(() => {
  if (!document.body || document.readyState !== "complete") return false;
  const textLength = String(document.body.innerText || "").replace(/\\s+/g, " ").trim().length;
  const candidates = Array.from(document.querySelectorAll("main,nav,header,button,a,input,[role='button'],audio,video")).slice(0, 200);
  const visibleCount = candidates.filter((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0 && rect.width > 2 && rect.height > 2;
  }).length;
  return textLength >= 80 || visibleCount >= 3;
})()`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function evaluate(wsUrl, expression) {
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error("CDP readiness timeout"));
    }, 1000);
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
    });
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      clearTimeout(timer);
      ws.close();
      if (message.error) reject(new Error(message.error.message || "CDP readiness failed"));
      else resolve(message.result?.result?.value === true);
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("CDP readiness websocket failed"));
    });
  });
}

let stableChecks = 0;
while (Date.now() < deadline) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(800) });
    const targets = await response.json();
    const target = targets.find((item) => item.type === "page" && String(item.url || "").startsWith("https://") && item.webSocketDebuggerUrl);
    const isReady = target && await evaluate(target.webSocketDebuggerUrl, readyExpression);
    if (isReady) {
      stableChecks += 1;
      if (stableChecks >= 2) process.exit(0);
    } else {
      stableChecks = 0;
    }
  } catch {
    stableChecks = 0;
  }
  await sleep(200);
}
process.exit(1);
NODE
}

wait_for_entry_provider_paint() {
  local provider_port="$1"
  local provider="${2:-}"
  local target_window="${3:-}"
  local timeout_seconds="${TIKPAL_WEB_MODE_ENTRY_PROVIDER_PAINT_TIMEOUT_SECONDS:-0}"
  [[ "$timeout_seconds" == "0" ]] && return 0
  wait_for_provider_ready "$provider_port" "$provider" "$timeout_seconds" || return 1
  [[ -z "$target_window" ]] || wait_for_provider_window_nonblank_x11_frame "$target_window"
}

navigate_provider_target() {
  local provider_port="$1"
  local target_url="$2"
  node --experimental-websocket - "$provider_port" "$target_url" <<'NODE'
const [port, url] = process.argv.slice(2);

function navigate(wsUrl, targetUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error("CDP navigation timeout"));
    }, 1500);
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ id: 1, method: "Page.navigate", params: { url: targetUrl } }));
    });
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      clearTimeout(timer);
      ws.close();
      if (message.error) reject(new Error(message.error.message || "CDP navigation failed"));
      else resolve();
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("CDP navigation websocket failed"));
    });
  });
}

(async () => {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(800) });
  const targets = await response.json();
  const target = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
  if (!target) throw new Error("No provider page target");
  await navigate(target.webSocketDebuggerUrl, url);
})().catch(() => process.exit(1));
NODE
}

crossfade_helper() {
  TIKPAL_WEB_MODE_ALSA_OUTPUT_DEVICE="$TIKPAL_WEB_MODE_ALSA_OUTPUT_DEVICE" \
  TIKPAL_WEB_MODE_CROSSFADE_CARD="$TIKPAL_WEB_MODE_CROSSFADE_CARD" \
  TIKPAL_WEB_MODE_CROSSFADE_PCM_A="$TIKPAL_WEB_MODE_CROSSFADE_PCM_A" \
  TIKPAL_WEB_MODE_CROSSFADE_PCM_B="$TIKPAL_WEB_MODE_CROSSFADE_PCM_B" \
    "$TIKPAL_WEB_MODE_AUDIO_CROSSFADE_HELPER" "$@"
}

crossfade_available() {
  is_enabled "$TIKPAL_WEB_MODE_AUDIO_CROSSFADE_ENABLED" || return 1
  [[ -n "$TIKPAL_WEB_MODE_ALSA_OUTPUT_DEVICE" ]] || return 1
  [[ -x "$TIKPAL_WEB_MODE_AUDIO_CROSSFADE_HELPER" ]] || return 1
  crossfade_helper check >/dev/null 2>&1
}

profile_audio_bus() {
  local profile="$1"
  local pid command_line
  while IFS= read -r pid; do
    [[ "$pid" =~ ^[0-9]+$ && -r "/proc/$pid/cmdline" ]] || continue
    command_line="$(tr '\0' ' ' < "/proc/$pid/cmdline")"
    if [[ "$command_line" == *"--alsa-output-device=$TIKPAL_WEB_MODE_CROSSFADE_PCM_A"* ]]; then
      printf '%s\n' a
      return 0
    fi
    if [[ "$command_line" == *"--alsa-output-device=$TIKPAL_WEB_MODE_CROSSFADE_PCM_B"* ]]; then
      printf '%s\n' b
      return 0
    fi
  done < <(pgrep -f -- "--user-data-dir=$profile" 2>/dev/null || true)
  return 1
}

write_audio_bus_state() {
  local bus="${1:-}"
  if [[ "$bus" != "a" && "$bus" != "b" ]]; then
    rm -f "$TIKPAL_WEB_MODE_AUDIO_BUS_STATE_PATH"
    return
  fi
  mkdir -p "$(dirname "$TIKPAL_WEB_MODE_AUDIO_BUS_STATE_PATH")"
  printf '%s\n' "$bus" > "$TIKPAL_WEB_MODE_AUDIO_BUS_STATE_PATH"
}

ensure_chromium_profile_prefs() {
  local profile_dir="$1"
  node - "$profile_dir" "$TIKPAL_WEB_MODE_POPUP_BLOCKING" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [profileDir, popupBlocking] = process.argv.slice(2);
const defaultDir = path.join(profileDir, "Default");
const prefsPath = path.join(defaultDir, "Preferences");
fs.mkdirSync(defaultDir, { recursive: true });
let prefs = {};
try { prefs = JSON.parse(fs.readFileSync(prefsPath, "utf8")); } catch {}
prefs.profile = prefs.profile && typeof prefs.profile === "object" ? prefs.profile : {};
prefs.profile.default_content_setting_values = prefs.profile.default_content_setting_values && typeof prefs.profile.default_content_setting_values === "object"
  ? prefs.profile.default_content_setting_values
  : {};
prefs.profile.default_content_setting_values.cookies = 1;
if (/^(1|true|yes|on|enabled)$/i.test(String(popupBlocking))) {
  prefs.profile.default_content_setting_values.popups = 2;
  prefs.profile.default_content_setting_values.ads = 2;
}
prefs.profile.content_settings = prefs.profile.content_settings && typeof prefs.profile.content_settings === "object"
  ? prefs.profile.content_settings
  : {};
prefs.profile.content_settings.exceptions = prefs.profile.content_settings.exceptions && typeof prefs.profile.content_settings.exceptions === "object"
  ? prefs.profile.content_settings.exceptions
  : {};
const chromeTimestamp = String((BigInt(Date.now()) + 11644473600000n) * 1000n);
const blockLocalNetworkOrigins = [
  "https://suno.com:443,*",
  "https://open.spotify.com:443,*",
  "https://music.youtube.com:443,*",
  "https://music.apple.com:443,*",
  "https://listen.tidal.com:443,*",
  "https://tidal.com:443,*",
  "https://play.qobuz.com:443,*",
  "https://www.deezer.com:443,*",
  "https://music.amazon.com:443,*",
  "https://y.qq.com:443,*",
  "https://music.163.com:443,*"
];
for (const bucketName of ["loopback_network", "local_network", "local_network_access"]) {
  const bucket = prefs.profile.content_settings.exceptions[bucketName] && typeof prefs.profile.content_settings.exceptions[bucketName] === "object"
    ? prefs.profile.content_settings.exceptions[bucketName]
    : {};
  for (const origin of blockLocalNetworkOrigins) {
    bucket[origin] = { last_modified: chromeTimestamp, setting: 2 };
  }
  prefs.profile.content_settings.exceptions[bucketName] = bucket;
}
prefs.profile.cookie_controls_mode = 0;
prefs.profile.block_third_party_cookies = false;
if (prefs.profile.content_settings && typeof prefs.profile.content_settings === "object") {
  if (prefs.profile.content_settings.exceptions && typeof prefs.profile.content_settings.exceptions === "object") {
    delete prefs.profile.content_settings.exceptions.zoomlevels;
  }
}
delete prefs.profile.per_host_zoom_levels;
delete prefs.profile.default_zoom_level;
if (prefs.partition && typeof prefs.partition === "object") {
  delete prefs.partition.default_zoom_level;
}
fs.writeFileSync(prefsPath, `${JSON.stringify(prefs, null, 2)}\n`);
NODE
}

refresh_extension_script_cache() {
  local profile_dir="$1"
  if ! is_enabled "$TIKPAL_WEB_MODE_REFRESH_EXTENSION_CACHE"; then
    return 0
  fi
  rm -rf "$profile_dir/Default/Service Worker"
  node - "$profile_dir" "$TIKPAL_WEB_MODE_EXTENSION_ID" <<'NODE'
const fs = require("fs");
const path = require("path");

const [profileDir, extensionId] = process.argv.slice(2);
const prefsPath = path.join(profileDir, "Default", "Preferences");
if (!profileDir || !extensionId || !fs.existsSync(prefsPath)) process.exit(0);

let prefs;
try {
  prefs = JSON.parse(fs.readFileSync(prefsPath, "utf8"));
} catch {
  process.exit(0);
}

const settings = prefs.extensions?.settings;
const extensionSettings = settings && settings[extensionId];
if (!extensionSettings || typeof extensionSettings !== "object") process.exit(0);

delete extensionSettings.service_worker_registration_info;
delete extensionSettings.serviceworkerevents;

const tmpPath = `${prefsPath}.tmp-${process.pid}`;
fs.writeFileSync(tmpPath, JSON.stringify(prefs));
fs.renameSync(tmpPath, prefsPath);
NODE
}

profile_has_widevine_cdm() {
  local profile_dir="$1"
  [[ -n "$profile_dir" && -d "$profile_dir/WidevineCdm" ]] || return 1
  find "$profile_dir/WidevineCdm" -path "*/_platform_specific/linux_x64/libwidevinecdm.so" -type f -size +1000000c -print -quit 2>/dev/null | grep -q .
}

seed_profile_widevine_cdm() {
  local target_profile="$1"
  local source_profile source_provider
  [[ -n "$target_profile" && -d "$target_profile" ]] || return 0
  profile_has_widevine_cdm "$target_profile" && return 0

  for source_profile in "$TIKPAL_CHROMIUM_PROFILE_DIR" "$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel"; do
    [[ -n "$source_profile" && "$source_profile" != "$target_profile" ]] || continue
    profile_has_widevine_cdm "$source_profile" || continue
    if rm -rf "$target_profile/WidevineCdm" && cp -a "$source_profile/WidevineCdm" "$target_profile/WidevineCdm"; then
      log "seeded Widevine CDM for $(basename "$target_profile") from $(basename "$source_profile")"
      return 0
    fi
  done

  while IFS= read -r source_provider; do
    [[ -n "$source_provider" ]] || continue
    source_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$source_provider"
    [[ "$source_profile" != "$target_profile" ]] || continue
    profile_has_widevine_cdm "$source_profile" || continue
    if rm -rf "$target_profile/WidevineCdm" && cp -a "$source_profile/WidevineCdm" "$target_profile/WidevineCdm"; then
      log "seeded Widevine CDM for $(basename "$target_profile") from $source_provider"
      return 0
    fi
  done < <(provider_ids)

  log "WARN: Widevine CDM is unavailable for $(basename "$target_profile"); protected playback may fail"
  return 0
}

write_runtime_provider_state() {
  with_provider_state_lock write_runtime_provider_state_unlocked "$@"
}

write_runtime_provider_state_unlocked() {
  local provider="$1"
  node - "$TIKPAL_WEB_MODE_STATE_PATH" "$provider" "$(provider_ids | tr '\n' ',' | sed 's/,$//')" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [statePath, provider, providerList] = process.argv.slice(2);
const providerIds = String(providerList || "").split(",").filter(Boolean);
let state = {};
try { state = JSON.parse(fs.readFileSync(statePath, "utf8")); } catch {}
const closeRequestId = String(process.env.TIKPAL_WEB_MODE_CLOSE_REQUEST_ID || "");
const openRequestId = String(process.env.TIKPAL_WEB_MODE_OPEN_REQUEST_ID || "");
const expectedProvider = String(process.env.TIKPAL_WEB_MODE_OPEN_EXPECTED_ACTIVE_PROVIDER || "");
const expectedXSessionGeneration = String(process.env.TIKPAL_WEB_MODE_OPEN_X_SESSION_GENERATION || "");
const xSessionGenerationPath = String(process.env.TIKPAL_KIOSK_X_SESSION_GENERATION_PATH || "");
const startupReset = process.env.TIKPAL_WEB_MODE_STARTUP_RESET === "1";
const closeOwnsState = !startupReset && Boolean(state.closeRequestId);
if (closeOwnsState && closeRequestId !== state.closeRequestId) process.exit(0);
let currentXSessionGeneration = "";
try { currentXSessionGeneration = fs.readFileSync(xSessionGenerationPath, "utf8").trim(); } catch {}
if (openRequestId && (
  state.openRequestId !== openRequestId
  || state.openingProvider !== expectedProvider
  || state.openXSessionGeneration !== expectedXSessionGeneration
  || currentXSessionGeneration !== expectedXSessionGeneration
  || provider !== expectedProvider
)) process.exit(0);
const preserveCloseRequest = closeOwnsState && closeRequestId === state.closeRequestId;
state.activeProvider = provider || null;
if (state.activeProvider) state.lastProvider = state.activeProvider;
state.lastError = null;
state.updatedAt = new Date().toISOString();
if (!state.activeProvider) {
  state.closeRequestId = preserveCloseRequest ? closeRequestId : null;
  state.openingProvider = null;
  state.openRequestId = null;
  state.openStartedAt = null;
  state.openXSessionGeneration = null;
} else {
  state.closeRequestId = null;
  state.openingProvider = null;
  state.openRequestId = null;
  state.openStartedAt = null;
  state.openXSessionGeneration = null;
  if (openRequestId) {
    state.lastOpenedRequestId = openRequestId;
    state.lastOpenedXSessionGeneration = expectedXSessionGeneration;
  }
  const residentProviders = state.residentProviders && typeof state.residentProviders === "object"
    ? state.residentProviders
    : {};
  for (const id of providerIds) {
    const current = residentProviders[id] && typeof residentProviders[id] === "object"
      ? residentProviders[id]
      : {};
    if (id === state.activeProvider) {
      residentProviders[id] = { ...current, status: "active", lastError: null, updatedAt: state.updatedAt };
    } else if (current.status === "active") {
      // A former active provider has already shown a real provider page. Do
      // not send its card back through the prewarm queue while guards run
      // their later diagnostics.
      residentProviders[id] = { ...current, status: "ready", lastError: null, updatedAt: state.updatedAt };
    }
  }
  state.residentProviders = residentProviders;
}
fs.mkdirSync(path.dirname(statePath), { recursive: true });
const temporaryPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`);
fs.renameSync(temporaryPath, statePath);
NODE
}

write_runtime_provider_status() {
  with_provider_state_lock write_runtime_provider_status_unlocked "$@"
}

write_runtime_prewarm_complete() {
  local complete="$1"
  with_provider_state_lock write_runtime_prewarm_complete_unlocked "$complete"
}

write_runtime_prewarm_complete_unlocked() {
  local complete="$1"
  node - "$TIKPAL_WEB_MODE_STATE_PATH" "$complete" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [statePath, complete] = process.argv.slice(2);
let state = {};
try { state = JSON.parse(fs.readFileSync(statePath, "utf8")); } catch {}
state.prewarmComplete = complete === "1";
state.updatedAt = new Date().toISOString();
fs.mkdirSync(path.dirname(statePath), { recursive: true });
const temporaryPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`);
fs.renameSync(temporaryPath, statePath);
NODE
}

write_runtime_provider_status_unlocked() {
  local provider="$1"
  local status="$2"
  local message="${3:-}"
  node - "$TIKPAL_WEB_MODE_STATE_PATH" "$provider" "$status" "$message" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [statePath, provider, status, message] = process.argv.slice(2);
const allowed = new Set(["opening", "prewarming", "ready", "active", "check_setup", "check_proxy", "region_unavailable", "closed"]);
let state = {};
try { state = JSON.parse(fs.readFileSync(statePath, "utf8")); } catch {}
const closeRequestId = String(process.env.TIKPAL_WEB_MODE_CLOSE_REQUEST_ID || "");
if (state.closeRequestId && !state.activeProvider && closeRequestId !== state.closeRequestId) process.exit(0);
const nextStatus = state.activeProvider === provider && (status === "active" || status === "ready")
  ? "active"
  : status === "active"
    ? "ready"
    : status;
const now = new Date().toISOString();
state.residentProviders = state.residentProviders && typeof state.residentProviders === "object"
  ? state.residentProviders
  : {};
if (provider && allowed.has(nextStatus)) {
  if (nextStatus === "closed") {
    delete state.residentProviders[provider];
  } else {
    state.residentProviders[provider] = {
      ...(state.residentProviders[provider] || {}),
      status: nextStatus,
      lastError: message || null,
      updatedAt: now
    };
  }
}
state.updatedAt = now;
fs.mkdirSync(path.dirname(statePath), { recursive: true });
const temporaryPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`);
fs.renameSync(temporaryPath, statePath);
NODE
}

seed_runtime_provider_pool_statuses() {
  with_provider_state_lock seed_runtime_provider_pool_statuses_unlocked "$@"
}

seed_runtime_provider_pool_statuses_unlocked() {
  local active_provider="$1"
  local seed_mode="${2:-preserve}"
  node - "$TIKPAL_WEB_MODE_STATE_PATH" "$active_provider" "$seed_mode" "$(provider_ids | tr '\n' ',' | sed 's/,$//')" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [statePath, activeProvider, seedMode, providerList] = process.argv.slice(2);
const force = seedMode === "force";
const providerIds = String(providerList || "").split(",").filter(Boolean);
let state = {};
try { state = JSON.parse(fs.readFileSync(statePath, "utf8")); } catch {}
const now = new Date().toISOString();
const residentProviders = state.residentProviders && typeof state.residentProviders === "object"
  ? state.residentProviders
  : {};
for (const provider of providerIds) {
  if (!provider || provider === activeProvider) continue;
  const current = residentProviders[provider] && typeof residentProviders[provider] === "object"
    ? residentProviders[provider]
    : {};
  if (!force && current.status && current.status !== "opening" && current.status !== "closed" && current.status !== "check_proxy") continue;
  residentProviders[provider] = {
    ...current,
    status: "prewarming",
    lastError: null,
    updatedAt: now
  };
}
state.residentProviders = residentProviders;
state.prewarmComplete = false;
state.updatedAt = now;
fs.mkdirSync(path.dirname(statePath), { recursive: true });
const temporaryPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`);
fs.renameSync(temporaryPath, statePath);
NODE
}

read_runtime_active_provider() {
  node - "$TIKPAL_WEB_MODE_STATE_PATH" <<'NODE'
const fs = require("node:fs");
const [statePath] = process.argv.slice(2);
try {
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  process.stdout.write(String(state.activeProvider || ""));
} catch {}
NODE
}

runtime_close_request_is_current() {
  local close_request_id="${1:-$TIKPAL_WEB_MODE_CLOSE_REQUEST_ID}"
  [[ -z "$close_request_id" ]] && return 0
  node - "$TIKPAL_WEB_MODE_STATE_PATH" "$close_request_id" <<'NODE'
const fs = require("node:fs");
const [statePath, closeRequestId] = process.argv.slice(2);
try {
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  process.exit(state.closeRequestId === closeRequestId && !state.openingProvider ? 0 : 1);
} catch {
  process.exit(1);
}
NODE
}

runtime_open_request_is_current() {
  local expected_provider="${TIKPAL_WEB_MODE_OPEN_EXPECTED_ACTIVE_PROVIDER:-}"
  local open_request_id="${TIKPAL_WEB_MODE_OPEN_REQUEST_ID:-}"
  local expected_x_session_generation="${TIKPAL_WEB_MODE_OPEN_X_SESSION_GENERATION:-}"
  [[ -z "$expected_provider" ]] && return 0
  node - "$TIKPAL_WEB_MODE_STATE_PATH" "$TIKPAL_KIOSK_X_SESSION_GENERATION_PATH" \
    "$expected_provider" "$open_request_id" "$expected_x_session_generation" <<'NODE'
const fs = require("node:fs");
const [statePath, xSessionGenerationPath, expectedProvider, openRequestId, expectedXSessionGeneration] = process.argv.slice(2);
try {
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const currentXSessionGeneration = fs.readFileSync(xSessionGenerationPath, "utf8").trim();
  const ownsRequest = state.openingProvider === expectedProvider
    && (!openRequestId || state.openRequestId === openRequestId)
    && (!openRequestId || state.openXSessionGeneration === expectedXSessionGeneration)
    && (!openRequestId || currentXSessionGeneration === expectedXSessionGeneration)
    && !state.closeRequestId;
  const legacyOwner = !openRequestId && state.activeProvider === expectedProvider && !state.closeRequestId;
  process.exit(ownsRequest || legacyOwner ? 0 : 1);
} catch {
  process.exit(1);
}
NODE
}

runtime_open_request_is_current_or_log() {
  local boundary="$1" current_x_session_generation=""
  runtime_open_request_is_current && return 0
  current_x_session_generation="$(cat "$TIKPAL_KIOSK_X_SESSION_GENERATION_PATH" 2>/dev/null || true)"
  log_open_stage request_invalidated "boundary=$boundary reason=stale_or_superseded_session current_x_session_generation=${current_x_session_generation:-missing}"
  return 1
}

read_runtime_provider_status() {
  local provider="$1"
  node - "$TIKPAL_WEB_MODE_STATE_PATH" "$provider" <<'NODE'
const fs = require("node:fs");
const [statePath, provider] = process.argv.slice(2);
try {
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const status = state.residentProviders?.[provider]?.status;
  process.stdout.write(typeof status === "string" ? status : "");
} catch {}
NODE
}

chromium_base_args() {
  printf '%s\n' \
    "--force-dark-mode" \
    "--enable-features=WebUIDarkMode" \
    "--default-background-color=000000"
}

call_onboard_method() {
  local method="$1"
  local attempts="${2:-5}"
  local timeout_seconds="${3:-1}"
  local session_bus="${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$(id -u)/bus}"
  local _
  command -v gdbus >/dev/null 2>&1 || return 1
  export DBUS_SESSION_BUS_ADDRESS="$session_bus"
  [[ "$attempts" =~ ^[0-9]+$ ]] || attempts=5
  while [[ "$attempts" -gt 0 ]]; do
    if DISPLAY="$TIKPAL_KIOSK_DISPLAY" DBUS_SESSION_BUS_ADDRESS="$session_bus" \
      timeout "$timeout_seconds" gdbus call --session --dest org.onboard.Onboard \
        --object-path /org/onboard/Onboard/Keyboard \
        --method "org.onboard.Onboard.Keyboard.$method" >/dev/null 2>&1; then
      return 0
    fi
    attempts=$((attempts - 1))
    sleep 0.2
  done
  return 1
}

position_onboard() {
  local area height keyboard_area=0 keyboard_window="" window width
  is_enabled "$TIKPAL_WEB_MODE_ONBOARD" || return 0
  pgrep -u "$(id -u)" -x onboard >/dev/null 2>&1 || return 0

  if command -v xdotool >/dev/null 2>&1; then
    while IFS= read -r window; do
      [[ "$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe getwindowname "$window" 2>/dev/null || true)" == "Onboard" ]] || continue
      if command -v xwininfo >/dev/null 2>&1 &&
        DISPLAY="$TIKPAL_KIOSK_DISPLAY" xwininfo -id "$window" 2>/dev/null | grep -q "Class: InputOnly"; then
        continue
      fi
      width="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe getwindowgeometry --shell "$window" 2>/dev/null | awk -F= '$1 == "WIDTH" { print $2 }')"
      height="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe getwindowgeometry --shell "$window" 2>/dev/null | awk -F= '$1 == "HEIGHT" { print $2 }')"
      area=$(( ${width:-0} * ${height:-0} ))
      if (( area > keyboard_area )); then
        keyboard_window="$window"
        keyboard_area="$area"
      fi
    done < <(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe search --name Onboard 2>/dev/null || true)
    if [[ -n "$keyboard_window" ]]; then
      width="$(window_width "$TIKPAL_WEB_MODE_ONBOARD_WINDOW")"
      height="$(window_height "$TIKPAL_WEB_MODE_ONBOARD_WINDOW")"
      DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowmap "$keyboard_window" >/dev/null 2>&1 || true
      DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowsize "$keyboard_window" \
        "$((width - 1))" "$((height - 1))" >/dev/null 2>&1 || true
      sleep 0.2
      DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowsize "$keyboard_window" "$width" "$height" >/dev/null 2>&1 || true
      DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowmove "$keyboard_window" \
        "$(position_x "$TIKPAL_WEB_MODE_ONBOARD_POSITION")" "$(position_y "$TIKPAL_WEB_MODE_ONBOARD_POSITION")" >/dev/null 2>&1 || true
      DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowraise "$keyboard_window" >/dev/null 2>&1 || true
    fi
  fi

  if command -v wmctrl >/dev/null 2>&1 && [[ -n "$keyboard_window" ]]; then
    wmctrl_mutation add_above "$keyboard_window" above \
      -i -r "$keyboard_window" -b add,above >/dev/null 2>&1 || true
  fi
}

onboard_visible_windows() {
  local window
  command -v xdotool >/dev/null 2>&1 || return 1
  while IFS= read -r window; do
    [[ -n "$window" ]] || continue
    [[ "$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe getwindowname "$window" 2>/dev/null || true)" == "Onboard" ]] || continue
    if command -v xwininfo >/dev/null 2>&1 &&
      DISPLAY="$TIKPAL_KIOSK_DISPLAY" xwininfo -id "$window" 2>/dev/null | grep -q "Class: InputOnly"; then
      continue
    fi
    printf '%s\n' "$window"
  done < <(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe search --onlyvisible --name Onboard 2>/dev/null || true)
}

raise_onboard() {
  local window
  command -v xdotool >/dev/null 2>&1 || return 0
  while IFS= read -r window; do
    [[ -n "$window" ]] || continue
    DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowraise "$window" >/dev/null 2>&1 || true
    if command -v wmctrl >/dev/null 2>&1; then
      wmctrl_mutation add_above "$window" above \
        -i -r "$window" -b add,above >/dev/null 2>&1 || true
    fi
  done < <(onboard_visible_windows)
}

move_onboard_if_requested() {
  local area height keyboard_area=0 keyboard_window="" window width
  is_enabled "$TIKPAL_WEB_MODE_ONBOARD" || return 0
  is_enabled "${TIKPAL_WEB_MODE_ONBOARD_REQUESTED_POSITION:-0}" || return 0
  command -v xdotool >/dev/null 2>&1 || return 0
  pgrep -u "$(id -u)" -x onboard >/dev/null 2>&1 || return 0

  while IFS= read -r window; do
    [[ -n "$window" ]] || continue
    [[ "$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe getwindowname "$window" 2>/dev/null || true)" == "Onboard" ]] || continue
    if command -v xwininfo >/dev/null 2>&1 &&
      DISPLAY="$TIKPAL_KIOSK_DISPLAY" xwininfo -id "$window" 2>/dev/null | grep -q "Class: InputOnly"; then
      continue
    fi
    width="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe getwindowgeometry --shell "$window" 2>/dev/null | awk -F= '$1 == "WIDTH" { print $2 }')"
    height="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe getwindowgeometry --shell "$window" 2>/dev/null | awk -F= '$1 == "HEIGHT" { print $2 }')"
    area=$(( ${width:-0} * ${height:-0} ))
    if (( area > keyboard_area )); then
      keyboard_window="$window"
      keyboard_area="$area"
    fi
  done < <(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe search --onlyvisible --name Onboard 2>/dev/null || true)

  [[ -n "$keyboard_window" ]] || return 0
  width="$(window_width "$TIKPAL_WEB_MODE_ONBOARD_WINDOW")"
  height="$(window_height "$TIKPAL_WEB_MODE_ONBOARD_WINDOW")"
  DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowsize "$keyboard_window" "$width" "$height" >/dev/null 2>&1 || true
  DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowmove "$keyboard_window" \
    "$(position_x "$TIKPAL_WEB_MODE_ONBOARD_POSITION")" "$(position_y "$TIKPAL_WEB_MODE_ONBOARD_POSITION")" >/dev/null 2>&1 || true
  DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowraise "$keyboard_window" >/dev/null 2>&1 || true
  if command -v wmctrl >/dev/null 2>&1; then
    wmctrl_mutation add_above "$keyboard_window" above \
      -i -r "$keyboard_window" -b add,above >/dev/null 2>&1 || true
  fi
}

install_onboard_ime_toggle_script() {
  local source_script="$SCRIPT_DIR/onboard-scripts/tikpalImeToggle.py"
  local target_dir="/usr/share/onboard/scripts"
  local target_script="$target_dir/tikpalImeToggle.py"
  [[ -f "$source_script" ]] || return 1

  if [[ -r "$target_script" ]] && cmp -s "$source_script" "$target_script"; then
    return 0
  fi

  if [[ -w "$target_dir" ]]; then
    install -m 0755 "$source_script" "$target_script"
    return 0
  fi

  if command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
    sudo install -m 0755 "$source_script" "$target_script"
    return 0
  fi

  return 1
}

install_onboard_ime_color_scheme() {
  local source_scheme="$SCRIPT_DIR/onboard-themes/Tikpal-Classic.colors"
  local target_dir="${XDG_DATA_HOME:-$HOME/.local/share}/onboard/themes"
  local target_scheme="$target_dir/Tikpal-Classic.colors"
  [[ -f "$source_scheme" ]] || return 1
  mkdir -p "$target_dir"
  install -m 0644 "$source_scheme" "$target_scheme"
}

configure_onboard_input_method_key() {
  local source_dir="/usr/share/onboard/layouts"
  local target_dir="${XDG_DATA_HOME:-$HOME/.local/share}/onboard/layouts"
  local target_theme_dir="${XDG_DATA_HOME:-$HOME/.local/share}/onboard/themes"
  local target_en_layout="$target_dir/Tikpal-Compact-EN.onboard"
  local target_pinyin_layout="$target_dir/Tikpal-Compact-Pinyin.onboard"
  local target_german_layout="$target_dir/Tikpal-Compact-German.onboard"
  local target_italian_layout="$target_dir/Tikpal-Compact-Italian.onboard"
  local target_korean_layout="$target_dir/Tikpal-Compact-Korean.onboard"
  local target_japanese_layout="$target_dir/Tikpal-Compact-Japanese.onboard"
  local target_spanish_layout="$target_dir/Tikpal-Compact-Spanish.onboard"
  local target_color_scheme="$target_theme_dir/Tikpal-Classic.colors"

  if ! command -v fcitx5-remote >/dev/null 2>&1 \
    || [[ ! -f "$source_dir/Compact.onboard" ]] \
    || [[ ! -f "$source_dir/Compact-Alpha.svg" ]] \
    || [[ ! -f "$source_dir/Compact-Numbers.svg" ]] \
    || [[ ! -f "$source_dir/Compact-Utils.svg" ]]; then
    gsettings reset org.onboard layout >/dev/null 2>&1 || true
    gsettings set org.onboard.theme-settings color-scheme "/usr/share/onboard/themes/Classic Onboard.colors" >/dev/null 2>&1 || true
    gsettings reset org.onboard key-label-overrides >/dev/null 2>&1 || true
    return 0
  fi

  if ! install_onboard_ime_toggle_script; then
    log "WARN: Onboard IME toggle script could not be installed; using F9 fallback"
  fi
  if ! install_onboard_ime_color_scheme; then
    log "WARN: Tikpal Onboard IME color scheme could not be installed; using default Onboard colors"
  fi

  mkdir -p "$target_dir"
  cp -f "$source_dir/Compact-Alpha.svg" "$source_dir/Compact-Numbers.svg" \
    "$source_dir/Compact-Utils.svg" "$target_dir/"
  if ! python3 - "$source_dir/Compact.onboard" "$target_en_layout" "$target_pinyin_layout" "$target_german_layout" "$target_italian_layout" "$target_korean_layout" "$target_japanese_layout" "$target_spanish_layout" <<'PY'
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET

source, en_path, pinyin_path, german_path, italian_path, korean_path, japanese_path, spanish_path = sys.argv[1:]

variants = [
    {
        "path": en_path,
        "ime_label": "EN",
        "ime_theme": "TIKPAL-IME-INACTIVE",
        "key_theme": "TIKPAL-KEY-EN",
        "labels": {"SPCE": "Space"},
    },
    {
        "path": pinyin_path,
        "ime_label": "中文",
        "ime_theme": "TIKPAL-IME-ACTIVE",
        "key_theme": "TIKPAL-KEY-PINYIN",
        "labels": {"SPCE": "空格", "RTRN": "↵"},
    },
    {
        "path": german_path,
        "ime_label": "DE",
        "ime_theme": "TIKPAL-IME-ACTIVE",
        "key_theme": "TIKPAL-KEY-GERMAN",
        "labels": {
            "TLDE": "^ °",
            "AE02": '2 "',
            "AE03": "3 §",
            "AE06": "6 &",
            "AE07": "7 /",
            "AE08": "8 (",
            "AE09": "9 )",
            "AE10": "0 =",
            "AE11": "ß ?",
            "AE12": "´ `",
            "AD06": "Z",
            "AD11": "Ü",
            "AD12": "+ *",
            "AC10": "Ö",
            "AC11": "Ä",
            "BKSL": "# '",
            "LSGT": "< >",
            "AB01": "Y",
            "AB08": ", ;",
            "AB09": ". :",
            "AB10": "- _",
            "SPCE": "Leertaste",
            "RTRN": "Enter",
        },
    },
    {
        "path": italian_path,
        "ime_label": "IT",
        "ime_theme": "TIKPAL-IME-ACTIVE",
        "key_theme": "TIKPAL-KEY-ITALIAN",
        "labels": {
            "TLDE": "\\ |",
            "AE02": '2 "',
            "AE03": "3 £",
            "AE06": "6 &",
            "AE07": "7 /",
            "AE08": "8 (",
            "AE09": "9 )",
            "AE10": "0 =",
            "AE11": "' ?",
            "AE12": "ì ^",
            "AD11": "è é",
            "AD12": "+ *",
            "AC10": "ò ç",
            "AC11": "à °",
            "BKSL": "ù §",
            "LSGT": "< >",
            "AB08": ", ;",
            "AB09": ". :",
            "AB10": "- _",
            "SPCE": "Spazio",
            "RTRN": "Invio",
        },
    },
    {
        "path": korean_path,
        "ime_label": "한국어",
        "ime_theme": "TIKPAL-IME-ACTIVE",
        "key_theme": "TIKPAL-KEY-KOREAN",
        "labels": {
            "AD01": "ㅂ",
            "AD02": "ㅈ",
            "AD03": "ㄷ",
            "AD04": "ㄱ",
            "AD05": "ㅅ",
            "AD06": "ㅛ",
            "AD07": "ㅕ",
            "AD08": "ㅑ",
            "AD09": "ㅐ",
            "AD10": "ㅔ",
            "AC01": "ㅁ",
            "AC02": "ㄴ",
            "AC03": "ㅇ",
            "AC04": "ㄹ",
            "AC05": "ㅎ",
            "AC06": "ㅗ",
            "AC07": "ㅓ",
            "AC08": "ㅏ",
            "AC09": "ㅣ",
            "AB01": "ㅋ",
            "AB02": "ㅌ",
            "AB03": "ㅊ",
            "AB04": "ㅍ",
            "AB05": "ㅠ",
            "AB06": "ㅜ",
            "AB07": "ㅡ",
            "SPCE": "스페이스",
            "RTRN": "확인",
        },
    },
    {
        "path": japanese_path,
        "ime_label": "日本語",
        "ime_theme": "TIKPAL-IME-ACTIVE",
        "key_theme": "TIKPAL-KEY-JAPANESE",
        "labels": {"SPCE": "変換", "RTRN": "確定"},
    },
    {
        "path": spanish_path,
        "ime_label": "ES",
        "ime_theme": "TIKPAL-IME-ACTIVE",
        "key_theme": "TIKPAL-KEY-SPANISH",
        "labels": {
            "TLDE": "º ª",
            "AE11": "' ?",
            "AE12": "¡ ¿",
            "AD11": "` ^",
            "AD12": "+ *",
            "AC10": "Ñ",
            "AC11": "´ ¨",
            "BKSL": "Ç",
            "LSGT": "< >",
            "AB08": ", ;",
            "AB09": ". :",
            "AB10": "- _",
            "SPCE": "Espacio",
            "RTRN": "Intro",
        },
    },
]


def patch_key(key: ET.Element, variant: dict[str, object]) -> None:
    key_id = key.attrib.get("id", "")
    group = key.attrib.get("group", "")
    key_theme = str(variant["key_theme"])

    if group == "alphanumeric":
        key.set("theme_id", key_theme)

    if group == "bottomrow" and key_id == "move":
        key.set("theme_id", "TIKPAL-KEY-MOVE")

    if group == "bottomrow" and key_id == "LWIN":
        key.set("id", "TIKPAL-IME")
        key.set("svg_id", "LWIN")
        key.set("theme_id", str(variant["ime_theme"]))
        key.set("label", str(variant["ime_label"]))
        key.set("script", "tikpalImeToggle")
        return

    labels = variant["labels"]
    if key_id in labels:
        key.set("label", str(labels[key_id]))
        if key_id in {"SPCE", "RTRN"}:
            key.set("theme_id", key_theme)


for variant in variants:
    tree = ET.parse(source)
    root = tree.getroot()
    for key in root.iter("key"):
        patch_key(key, variant)
    tree.write(variant["path"], encoding="utf-8", xml_declaration=True)
PY
  then
    gsettings reset org.onboard layout >/dev/null 2>&1 || true
    gsettings set org.onboard.theme-settings color-scheme "/usr/share/onboard/themes/Classic Onboard.colors" >/dev/null 2>&1 || true
    gsettings reset org.onboard key-label-overrides >/dev/null 2>&1 || true
    return 0
  fi
  if [[ -f "$target_color_scheme" ]]; then
    gsettings set org.onboard.theme-settings color-scheme "$target_color_scheme" >/dev/null 2>&1 || true
  fi
  gsettings set org.onboard layout "$target_en_layout" >/dev/null 2>&1 || true
  gsettings reset org.onboard key-label-overrides >/dev/null 2>&1 || true
  python3 /usr/share/onboard/scripts/tikpalImeToggle.py --sync >/dev/null 2>&1 || true
}

sync_onboard_input_method_visual() {
  [[ -f /usr/share/onboard/scripts/tikpalImeToggle.py ]] || return 0
  python3 /usr/share/onboard/scripts/tikpalImeToggle.py --sync >/dev/null 2>&1 || true
}

configure_onboard_visibility() {
  command -v gsettings >/dev/null 2>&1 || return 0
  local session_bus
  session_bus="${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$(id -u)/bus}"
  export DBUS_SESSION_BUS_ADDRESS="$session_bus"
  gsettings set org.onboard.window docking-enabled false >/dev/null 2>&1 || true
  gsettings set org.onboard.window force-to-top true >/dev/null 2>&1 || true
  gsettings set org.onboard.window window-state-sticky true >/dev/null 2>&1 || true
  gsettings set org.onboard show-status-icon false >/dev/null 2>&1 || true
  gsettings set org.onboard.icon-palette in-use false >/dev/null 2>&1 || true
  gsettings set org.onboard.auto-show enabled false >/dev/null 2>&1 || true
  gsettings set org.onboard.auto-show hide-on-key-press false >/dev/null 2>&1 || true
  gsettings set org.onboard.window enable-inactive-transparency false >/dev/null 2>&1 || true
  gsettings set org.onboard.window inactive-transparency 0.0 >/dev/null 2>&1 || true
  gsettings set org.onboard.window transparency 0.0 >/dev/null 2>&1 || true
  gsettings set org.onboard.keyboard input-event-source XInput >/dev/null 2>&1 || true
  gsettings set org.onboard.keyboard key-synth XTest >/dev/null 2>&1 || true
}

configure_onboard() {
  command -v gsettings >/dev/null 2>&1 || return 0
  local height session_bus width x y
  session_bus="${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$(id -u)/bus}"
  export DBUS_SESSION_BUS_ADDRESS="$session_bus"
  width="$(window_width "$TIKPAL_WEB_MODE_ONBOARD_WINDOW")"
  height="$(window_height "$TIKPAL_WEB_MODE_ONBOARD_WINDOW")"
  x="$(position_x "$TIKPAL_WEB_MODE_ONBOARD_POSITION")"
  y="$(position_y "$TIKPAL_WEB_MODE_ONBOARD_POSITION")"
  configure_onboard_visibility
  gsettings set org.onboard.window.landscape width "$width" >/dev/null 2>&1 || true
  gsettings set org.onboard.window.landscape height "$height" >/dev/null 2>&1 || true
  gsettings set org.onboard.window.landscape x "$x" >/dev/null 2>&1 || true
  gsettings set org.onboard.window.landscape y "$y" >/dev/null 2>&1 || true
  configure_onboard_input_method_key
}

window_uses_profile() {
  local cmdline pid profile="$1" window="$2"
  [[ -n "$profile" ]] || return 1
  pid="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe getwindowpid "$window" 2>/dev/null || true)"
  [[ -n "$pid" ]] || return 1
  cmdline="$(tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null || true)"
  [[ "$cmdline" == *"--user-data-dir=$profile"* ]]
}

kiosk_browser_window() {
  local window
  command -v xdotool >/dev/null 2>&1 || return 1
  [[ -n "$TIKPAL_CHROMIUM_PROFILE_DIR" ]] || return 1
  while IFS= read -r window; do
    [[ -n "$window" ]] || continue
    if window_uses_profile "$TIKPAL_CHROMIUM_PROFILE_DIR" "$window"; then
      printf '%s\n' "$window"
      return 0
    fi
  done < <(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe search --onlyvisible --class chromium 2>/dev/null || true)
  return 1
}

focused_browser_window() {
  local active_provider area best_area=0 best_window="" height profile window width
  command -v xdotool >/dev/null 2>&1 || return 1
  profile="${TIKPAL_WEB_MODE_PROVIDER_PROFILE:-}"
  if [[ -z "$profile" ]]; then
    active_provider="$(read_runtime_active_provider)"
    [[ -n "$active_provider" ]] && profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$active_provider"
  fi
  if [[ -n "$profile" ]]; then
    while IFS= read -r window; do
      [[ -n "$window" ]] || continue
      if window_uses_profile "$profile" "$window"; then
        printf '%s\n' "$window"
        return 0
      fi
    done < <(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe search --onlyvisible --class chromium 2>/dev/null || true)
  fi
  window="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe getactivewindow 2>/dev/null || true)"
  if [[ -n "$window" ]]; then
    printf '%s\n' "$window"
    return 0
  fi
  while IFS= read -r window; do
    [[ -n "$window" ]] || continue
    width="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe getwindowgeometry --shell "$window" 2>/dev/null | awk -F= '$1 == "WIDTH" { print $2 }')"
    height="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe getwindowgeometry --shell "$window" 2>/dev/null | awk -F= '$1 == "HEIGHT" { print $2 }')"
    area=$(( ${width:-0} * ${height:-0} ))
    if (( area > best_area )); then
      best_window="$window"
      best_area="$area"
    fi
  done < <(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe search --onlyvisible --class chromium 2>/dev/null || true)
  [[ -n "$best_window" ]] && printf '%s\n' "$best_window"
}

focus_window() {
  local window="$1"
  [[ -n "$window" ]] || return 0
  command -v xdotool >/dev/null 2>&1 || return 0
  DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowfocus "$window" >/dev/null 2>&1 || true
  if [[ -z "$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe getactivewindow 2>/dev/null || true)" ]]; then
    DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowactivate "$window" >/dev/null 2>&1 || true
  fi
}

restore_local_kiosk_keyboard_focus() {
  local target window
  target="$(printf '%s' "${TIKPAL_WEB_MODE_KEYBOARD_TARGET:-auto}" | tr '[:upper:]' '[:lower:]')"
  [[ "$target" == "kiosk" ]] || return 0
  window="$(kiosk_browser_window || true)"
  [[ -n "$window" ]] || return 0
  focus_window "$window"
}

start_onboard_process() {
  local onboard_bin session_bus
  onboard_bin="$(command -v onboard 2>/dev/null || true)"
  [[ -n "$onboard_bin" ]] || return 1
  session_bus="${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$(id -u)/bus}"
  export DBUS_SESSION_BUS_ADDRESS="$session_bus"

  if systemctl --user cat tikpal-onboard.service >/dev/null 2>&1; then
    systemctl --user reset-failed tikpal-onboard.service >/dev/null 2>&1 || true
    systemctl --user start tikpal-onboard.service >/dev/null 2>&1 && return 0
  fi

  systemd-run --user --quiet --unit=tikpal-onboard \
    --setenv="DISPLAY=$TIKPAL_KIOSK_DISPLAY" --setenv="DBUS_SESSION_BUS_ADDRESS=$session_bus" \
    "$onboard_bin" >/dev/null 2>&1 && return 0

  DISPLAY="$TIKPAL_KIOSK_DISPLAY" DBUS_SESSION_BUS_ADDRESS="$session_bus" nohup "$onboard_bin" >/dev/null 2>&1 &
}

ensure_onboard() {
  is_enabled "$TIKPAL_WEB_MODE_ONBOARD" || return 0
  [[ ! -e "$TIKPAL_WEB_MODE_ONBOARD_SUPPRESS_PATH" ]] || return 0
  command -v onboard >/dev/null 2>&1 || {
    log "WARN: onboard not found"
    return 0
  }

  if ! pgrep -u "$(id -u)" -x onboard >/dev/null 2>&1; then
    configure_onboard
    start_onboard_process
    sleep 0.8
  else
    configure_onboard
  fi

  sync_onboard_input_method_visual
  call_onboard_method Show || true
  sleep 0.2
  call_onboard_method Show || true
  sleep 0.1
  raise_onboard
  move_onboard_if_requested
  restore_local_kiosk_keyboard_focus
}

preload_onboard() {
  is_enabled "$TIKPAL_WEB_MODE_ONBOARD" || return 0
  command -v onboard >/dev/null 2>&1 || {
    log "WARN: onboard not found"
    return 0
  }
  configure_onboard

  if ! pgrep -u "$(id -u)" -x onboard >/dev/null 2>&1; then
    start_onboard_process
    sleep 0.8
  fi

  hide_onboard
}

hide_onboard() {
  is_enabled "$TIKPAL_WEB_MODE_ONBOARD" || return 0
  pgrep -u "$(id -u)" -x onboard >/dev/null 2>&1 || return 0
  [[ -n "$(onboard_visible_windows)" ]] || return 0
  call_onboard_method Hide 1 0.35 || true
}

toggle_onboard() {
  is_enabled "$TIKPAL_WEB_MODE_ONBOARD" || return 0
  if ! pgrep -u "$(id -u)" -x onboard >/dev/null 2>&1 || [[ -z "$(onboard_visible_windows)" ]]; then
    rm -f "$TIKPAL_WEB_MODE_ONBOARD_SUPPRESS_PATH"
    ensure_onboard
    return
  fi
  mkdir -p "$(dirname "$TIKPAL_WEB_MODE_ONBOARD_SUPPRESS_PATH")"
  touch "$TIKPAL_WEB_MODE_ONBOARD_SUPPRESS_PATH"
  hide_onboard
}

force_onboard() {
  rm -f "$TIKPAL_WEB_MODE_ONBOARD_SUPPRESS_PATH"
  ensure_onboard
}

keepalive_onboard() {
  is_enabled "$TIKPAL_WEB_MODE_ONBOARD" || return 0
  rm -f "$TIKPAL_WEB_MODE_ONBOARD_SUPPRESS_PATH"
  if ! pgrep -u "$(id -u)" -x onboard >/dev/null 2>&1; then
    return
  fi
  [[ -n "$(onboard_visible_windows)" ]] || return 0
  raise_onboard || true
  restore_local_kiosk_keyboard_focus
}

close_side_panel() {
  command -v xsetroot >/dev/null 2>&1 &&
    xsetroot_mutation solid_root black -solid black 2>/dev/null || true
  pkill -f -- "--user-data-dir=$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel" >/dev/null 2>&1 || true
  sleep 0.2
  pkill -KILL -f -- "--user-data-dir=$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel" >/dev/null 2>&1 || true
}

side_panel_window_visible() {
  local panel_profile="$1"
  local window pid
  command -v xdotool >/dev/null 2>&1 || return 1
  while IFS= read -r window; do
    [[ -n "$window" ]] || continue
    pid="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe getwindowpid "$window" 2>/dev/null || true)"
    if process_tree_uses_profile "$pid" "$panel_profile"; then
      return 0
    fi
  done < <(visible_chromium_windows)
  return 1
}

window_guard_pid_file() {
  printf '%s\n' "$TIKPAL_WEB_MODE_PROFILE_ROOT/window-guard.pid"
}

window_guard_starttime_file() {
  printf '%s.starttime\n' "$(window_guard_pid_file)"
}

window_guard_lifecycle_lock_file() {
  printf '%s\n' "$TIKPAL_WEB_MODE_PROFILE_ROOT/window-guard.lock"
}

window_guard_read_pid_file() {
  local pid
  pid="$(head -n 1 "$(window_guard_pid_file)" 2>/dev/null || true)"
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 1
  printf '%s\n' "$pid"
}

window_guard_read_recorded_starttime() {
  local starttime
  starttime="$(head -n 1 "$(window_guard_starttime_file)" 2>/dev/null || true)"
  [[ -n "$starttime" ]] || return 1
  printf '%s\n' "$starttime"
}

window_guard_process_starttime() {
  local pid="$1" stat_line stat_tail starttime
  local -a stat_fields=()
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 1
  if [[ -r "/proc/$pid/stat" ]]; then
    stat_line="$(<"/proc/$pid/stat")"
    stat_tail="${stat_line##*) }"
    read -r -a stat_fields <<< "$stat_tail"
    [[ "${#stat_fields[@]}" -ge 20 && "${stat_fields[19]}" =~ ^[0-9]+$ ]] || return 1
    printf '%s\n' "${stat_fields[19]}"
    return 0
  fi
  starttime="$(ps -p "$pid" -o lstart= 2>/dev/null || true)"
  starttime="${starttime#"${starttime%%[![:space:]]*}"}"
  starttime="${starttime%"${starttime##*[![:space:]]}"}"
  [[ -n "$starttime" ]] || return 1
  printf '%s\n' "$starttime"
}

window_guard_pid_record_matches() {
  local expected_pid="$1" expected_starttime="$2"
  local recorded_pid recorded_starttime
  recorded_pid="$(window_guard_read_pid_file || true)"
  recorded_starttime="$(window_guard_read_recorded_starttime || true)"
  [[ "$recorded_pid" == "$expected_pid" &&
     -n "$expected_starttime" &&
     "$recorded_starttime" == "$expected_starttime" ]]
}

window_guard_write_pid_file() {
  local pid="$1" expected_starttime="${2:-}"
  local pid_file starttime_file pid_temporary_path starttime_temporary_path starttime
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 1
  pid_file="$(window_guard_pid_file)"
  starttime_file="$(window_guard_starttime_file)"
  starttime="$(window_guard_process_starttime "$pid" || true)"
  [[ -n "$starttime" &&
     ( -z "$expected_starttime" || "$starttime" == "$expected_starttime" ) ]] || return 1
  mkdir -p "$(dirname "$pid_file")"
  pid_temporary_path="$pid_file.$$.$RANDOM.tmp"
  starttime_temporary_path="$starttime_file.$$.$RANDOM.tmp"
  if ! printf '%s\n' "$pid" > "$pid_temporary_path" ||
     ! printf '%s\n' "$starttime" > "$starttime_temporary_path"; then
    rm -f "$pid_temporary_path" "$starttime_temporary_path" 2>/dev/null || true
    return 1
  fi
  if [[ -e "$pid_file" ]]; then
    chown --reference="$pid_file" "$pid_temporary_path" 2>/dev/null || true
    chmod --reference="$pid_file" "$pid_temporary_path" 2>/dev/null || true
  else
    chmod 0644 "$pid_temporary_path" 2>/dev/null || true
  fi
  if [[ -e "$starttime_file" ]]; then
    chown --reference="$starttime_file" "$starttime_temporary_path" 2>/dev/null || true
    chmod --reference="$starttime_file" "$starttime_temporary_path" 2>/dev/null || true
  else
    chmod 0644 "$starttime_temporary_path" 2>/dev/null || true
  fi
  if ! mv -f "$starttime_temporary_path" "$starttime_file" ||
     ! mv -f "$pid_temporary_path" "$pid_file"; then
    rm -f "$pid_temporary_path" "$starttime_temporary_path" 2>/dev/null || true
    return 1
  fi
}

window_guard_remove_pid_file_if_owned() {
  local expected_pid="$1" expected_starttime="${2:-}"
  local pid_file starttime_file current_pid current_starttime
  pid_file="$(window_guard_pid_file)"
  starttime_file="$(window_guard_starttime_file)"
  current_pid="$(window_guard_read_pid_file || true)"
  current_starttime="$(window_guard_read_recorded_starttime || true)"
  [[ "$current_pid" == "$expected_pid" ]] || return 0
  [[ -z "$expected_starttime" || "$current_starttime" == "$expected_starttime" ]] || return 0
  rm -f "$pid_file" "$starttime_file"
}

window_guard_process_matches() {
  local pid="$1" expected_starttime="${2:-}" argument previous="" command_line=""
  local current_starttime
  local -a words=()
  [[ "$pid" =~ ^[1-9][0-9]*$ && "$pid" != "$$" && "$pid" != "$BASHPID" ]] || return 1
  kill -0 "$pid" >/dev/null 2>&1 || return 1
  if [[ -n "$expected_starttime" ]]; then
    current_starttime="$(window_guard_process_starttime "$pid" || true)"
    [[ "$current_starttime" == "$expected_starttime" ]] || return 1
  fi
  if [[ -r "/proc/$pid/cmdline" ]]; then
    while IFS= read -r -d '' argument; do
      read -r -a words <<< "$argument"
      for argument in "${words[@]}"; do
        if [[ "$previous" == */tikpal-web-mode.sh && "$argument" == "guard" ]]; then
          return 0
        fi
        previous="$argument"
      done
    done < "/proc/$pid/cmdline"
    return 1
  fi
  command_line="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  [[ "$command_line" == *"/tikpal-web-mode.sh guard "* ||
     "$command_line" == *"/tikpal-web-mode.sh guard" ]]
}

window_guard_matching_pids() {
  local proc_path pid
  if [[ -d /proc ]]; then
    for proc_path in /proc/[1-9]*; do
      [[ -d "$proc_path" ]] || continue
      pid="${proc_path##*/}"
      window_guard_process_matches "$pid" && printf '%s\n' "$pid"
    done
    return 0
  fi
  command -v pgrep >/dev/null 2>&1 || return 0
  while IFS= read -r pid; do
    window_guard_process_matches "$pid" && printf '%s\n' "$pid"
  done < <(pgrep -f '[t]ikpal-web-mode.sh guard' 2>/dev/null || true)
}

window_guard_collect_matching_pids() {
  local pid
  TIKPAL_WINDOW_GUARD_MATCHING_PIDS=()
  while IFS= read -r pid; do
    [[ "$pid" =~ ^[1-9][0-9]*$ ]] || continue
    TIKPAL_WINDOW_GUARD_MATCHING_PIDS+=("$pid")
  done < <(window_guard_matching_pids)
}

window_guard_state() {
  local canonical_pid canonical_starttime matches
  canonical_pid="$(window_guard_read_pid_file || true)"
  canonical_starttime="$(window_guard_read_recorded_starttime || true)"
  window_guard_collect_matching_pids
  matches="$(IFS=,; printf '%s' "${TIKPAL_WINDOW_GUARD_MATCHING_PIDS[*]}")"
  printf 'canonical_pid\t%s\ncanonical_starttime\t%s\nmatching_pids\t%s\nmatching_count\t%s\n' \
    "${canonical_pid:-missing}" "${canonical_starttime:-missing}" \
    "${matches:-none}" "${#TIKPAL_WINDOW_GUARD_MATCHING_PIDS[@]}"
}

window_guard_launch_process() {
  local provider_profile="$1" panel_profile="$2" log_path
  local lifecycle_fd="${TIKPAL_WINDOW_GUARD_LIFECYCLE_FD:-}"
  log_path="${TIKPAL_WEB_MODE_WINDOW_GUARD_LOG_PATH:-/dev/null}"
  if [[ -n "$lifecycle_fd" ]]; then
    exec {lifecycle_fd}>&-
  fi
  nohup "$SCRIPT_DIR/tikpal-web-mode.sh" guard "$provider_profile" "$panel_profile" \
    </dev/null >>"$log_path" 2>&1 9>&- &
  printf '%s\n' "$!"
}

window_guard_terminate_process() {
  local pid="$1" expected_starttime="$2" attempt
  window_guard_process_matches "$pid" "$expected_starttime" || return 0
  pkill -TERM -P "$pid" >/dev/null 2>&1 || true
  window_guard_process_matches "$pid" "$expected_starttime" || return 0
  kill -TERM "$pid" >/dev/null 2>&1 || true
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    window_guard_process_matches "$pid" "$expected_starttime" || return 0
    sleep 0.02
  done
  pkill -KILL -P "$pid" >/dev/null 2>&1 || true
  window_guard_process_matches "$pid" "$expected_starttime" || return 0
  kill -KILL "$pid" >/dev/null 2>&1 || true
  for attempt in 1 2 3 4 5; do
    window_guard_process_matches "$pid" "$expected_starttime" || return 0
    sleep 0.02
  done
  return 1
}

window_guard_ensure_process() {
  local provider_profile="$1" panel_profile="$2"
  local lock_path lifecycle_fd="" pid_file_pid="" pid_file_starttime=""
  local guard_pid="" guard_starttime="" attempt
  command -v flock >/dev/null 2>&1 || return 78
  lock_path="$(window_guard_lifecycle_lock_file)"
  mkdir -p "$(dirname "$lock_path")"
  exec {lifecycle_fd}>"$lock_path"
  if ! flock -x -w "$TIKPAL_WEB_MODE_LOCK_TIMEOUT_SECONDS" "$lifecycle_fd"; then
    exec {lifecycle_fd}>&-
    return 75
  fi
  TIKPAL_WINDOW_GUARD_CREATED_PID=""
  pid_file_pid="$(window_guard_read_pid_file || true)"
  pid_file_starttime="$(window_guard_read_recorded_starttime || true)"
  window_guard_collect_matching_pids
  if [[ "${#TIKPAL_WINDOW_GUARD_MATCHING_PIDS[@]}" -gt 1 ]]; then
    log "ERROR: multiple Explore window guards: ${TIKPAL_WINDOW_GUARD_MATCHING_PIDS[*]}"
    flock -u "$lifecycle_fd" >/dev/null 2>&1 || true
    exec {lifecycle_fd}>&-
    return 72
  fi
  if [[ "${#TIKPAL_WINDOW_GUARD_MATCHING_PIDS[@]}" == 1 ]]; then
    guard_pid="${TIKPAL_WINDOW_GUARD_MATCHING_PIDS[0]}"
    guard_starttime="$(window_guard_process_starttime "$guard_pid" || true)"
    [[ -n "$guard_starttime" ]] || {
      flock -u "$lifecycle_fd" >/dev/null 2>&1 || true
      exec {lifecycle_fd}>&-
      return 73
    }
    if [[ "$pid_file_pid" != "$guard_pid" ||
          "$pid_file_starttime" != "$guard_starttime" ]]; then
      window_guard_write_pid_file "$guard_pid" || {
        flock -u "$lifecycle_fd" >/dev/null 2>&1 || true
        exec {lifecycle_fd}>&-
        return 1
      }
      log_stage "window_guard_claimed pid=$guard_pid previous_pid=${pid_file_pid:-missing}"
    else
      log_stage "window_guard_reused pid=$guard_pid"
    fi
    flock -u "$lifecycle_fd" >/dev/null 2>&1 || true
    exec {lifecycle_fd}>&-
    return 0
  fi

  guard_pid="$(TIKPAL_WINDOW_GUARD_LIFECYCLE_FD="$lifecycle_fd" \
    window_guard_launch_process "$provider_profile" "$panel_profile")"
  if [[ ! "$guard_pid" =~ ^[1-9][0-9]*$ ]] || ! window_guard_write_pid_file "$guard_pid"; then
    flock -u "$lifecycle_fd" >/dev/null 2>&1 || true
    exec {lifecycle_fd}>&-
    return 1
  fi
  guard_starttime="$(window_guard_read_recorded_starttime || true)"
  for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    window_guard_process_matches "$guard_pid" "$guard_starttime" && break
    sleep 0.02
  done
  window_guard_collect_matching_pids
  if [[ "${#TIKPAL_WINDOW_GUARD_MATCHING_PIDS[@]}" != 1 ||
        "${TIKPAL_WINDOW_GUARD_MATCHING_PIDS[0]:-}" != "$guard_pid" ]] ||
     ! window_guard_process_matches "$guard_pid" "$guard_starttime"; then
    window_guard_remove_pid_file_if_owned "$guard_pid" "$guard_starttime" || true
    flock -u "$lifecycle_fd" >/dev/null 2>&1 || true
    exec {lifecycle_fd}>&-
    return 73
  fi
  TIKPAL_WINDOW_GUARD_CREATED_PID="$guard_pid"
  log_stage "window_guard_created pid=$guard_pid"
  flock -u "$lifecycle_fd" >/dev/null 2>&1 || true
  exec {lifecycle_fd}>&-
}

provider_switch_marker_path() {
  printf '%s\n' "$TIKPAL_WEB_MODE_PROFILE_ROOT/provider-switch.pid"
}

begin_provider_switch_guard() {
  local marker
  marker="$(provider_switch_marker_path)"
  mkdir -p "$(dirname "$marker")"
  printf '%s\n' "$BASHPID" > "$marker"
}

provider_switch_in_progress() {
  local marker pid
  marker="$(provider_switch_marker_path)"
  [[ -r "$marker" ]] || return 1
  pid="$(cat "$marker" 2>/dev/null || true)"
  if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" >/dev/null 2>&1; then
    return 0
  fi
  rm -f "$marker"
  return 1
}

clear_provider_switch_guard() {
  local marker pid
  marker="$(provider_switch_marker_path)"
  [[ -r "$marker" ]] || return 0
  pid="$(cat "$marker" 2>/dev/null || true)"
  if [[ "$pid" == "$BASHPID" ]]; then
    rm -f "$marker"
  fi
  # A stale marker belongs to an already-finished switch. It is harmless here
  # and must not turn an otherwise successful provider open into a shell error.
  return 0
}


prewarm_pid_file() {
  printf '%s\n' "$TIKPAL_WEB_MODE_PROFILE_ROOT/provider-prewarm.pid"
}

prewarm_active_provider_file() {
  printf '%s\n' "$TIKPAL_WEB_MODE_PROFILE_ROOT/provider-prewarm.active-provider"
}


pool_warm_stamp_file() {
  printf '%s\n' "$TIKPAL_WEB_MODE_PROFILE_ROOT/pool-warm.stamp"
}
provider_pool_needs_prewarm() {
  local active_provider="${1:-}"
  local provider profile provider_port friendly_error_reason
  is_enabled "$TIKPAL_WEB_MODE_PROVIDER_POOL" || return 1
  is_enabled "$TIKPAL_WEB_MODE_PROVIDER_PREWARM_ENABLED" || return 1
  while IFS= read -r provider; do
    [[ -n "$provider" && "$provider" != "$active_provider" ]] || continue
    profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$provider"
    profile_process_exists "$profile" || return 0
    provider_port="$(provider_debug_port "$provider")"
    # A resident pool is warm once CDP has exposed the provider's real HTTPS
    # page. Full DOM readiness belongs to foreground cold starts only.
    if provider_has_real_provider_page "$provider_port"; then
      continue
    fi
    friendly_error_reason="$(provider_friendly_error_reason "$provider_port")"
    [[ "$friendly_error_reason" == "region_unavailable" ]] || return 0
  done < <(provider_ids)
  return 1
}

sync_runtime_provider_pool_process_statuses() {
  local active_provider="${1:-}"
  local allow_active_clear="${2:-1}"
  local provider profile provider_port status friendly_error_reason
  is_enabled "$TIKPAL_WEB_MODE_PROVIDER_POOL" || return 0
  while IFS= read -r provider; do
    [[ -n "$provider" ]] || continue
    [[ "$(read_runtime_active_provider)" == "$active_provider" ]] || {
      log "reconcile abandoned: active provider changed from $active_provider"
      return 0
    }
    profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$provider"
    provider_port="$(provider_debug_port "$provider")"
    if profile_process_exists "$profile"; then
      if provider_has_real_provider_page "$provider_port"; then
        if [[ "$provider" == "$active_provider" ]]; then
          write_runtime_provider_status "$provider" "active"
        else
          # Do not make a confirmed real page wait on a slow DOM probe, or let
          # an asynchronous guard demote it back to Prewarming.
          write_runtime_provider_status "$provider" "ready"
        fi
        continue
      fi
      friendly_error_reason="$(provider_friendly_error_reason "$provider_port")"
      if [[ "$friendly_error_reason" == "region_unavailable" ]]; then
        write_runtime_provider_status "$provider" "region_unavailable" "$(provider_label "$provider") is unavailable in the current Proxy region"
        continue
      fi
      status="$(read_runtime_provider_status "$provider")"
      if [[ "$provider" == "$active_provider" ]]; then
        write_runtime_provider_status "$provider" "check_setup" "$(provider_label "$provider") did not enter the provider page"
        if [[ "$allow_active_clear" == "1" ]]; then
          write_runtime_provider_state ""
        else
          log "reconcile retained active provider $provider after stale-page status"
        fi
      elif [[ "$status" == "ready" || "$status" == "active" ]]; then
        write_runtime_provider_status "$provider" "check_setup" "$(provider_label "$provider") did not enter the provider page"
      elif [[ "$status" == "prewarming" ]]; then
        # Process exists but page never materialised; the prewarm is stuck.
        write_runtime_provider_status "$provider" "check_setup" "$(provider_label "$provider") did not enter the provider page"
      elif [[ -z "$status" ]]; then
        write_runtime_provider_status "$provider" "prewarming"
      fi
      continue
    fi
    status="$(read_runtime_provider_status "$provider")"
    if [[ "$status" == "ready" || "$status" == "active" || "$status" == "opening" || "$status" == "prewarming" ]]; then
      write_runtime_provider_status "$provider" "closed"
    fi
  done < <(provider_ids)
}

reconcile_provider_pool_in_background() {
  local active_provider="$1"
  local started_ms elapsed_ms
  is_enabled "$TIKPAL_WEB_MODE_PROVIDER_POOL" || return 0
  [[ -n "$active_provider" ]] || return 0
  started_ms="$(now_ms)"
  if command -v setsid >/dev/null 2>&1; then
    setsid "$SCRIPT_DIR/tikpal-web-mode.sh" reconcile "$active_provider" "$started_ms" </dev/null >/dev/null 2>&1 9>&- &
  else
    nohup "$SCRIPT_DIR/tikpal-web-mode.sh" reconcile "$active_provider" "$started_ms" </dev/null >/dev/null 2>&1 9>&- &
  fi
}

reconcile_provider_pool() {
  local active_provider="$1"
  local started_ms="${2:-$(now_ms)}"
  local elapsed_ms provider_profile proxy_line proxy_enabled
  provider_switch_in_progress && {
    elapsed_ms="$(( $(now_ms) - started_ms ))"
    log_stage "reconcile_ms=$elapsed_ms provider=$active_provider abandoned=switching"
    return 0
  }
  [[ "$(read_runtime_active_provider)" == "$active_provider" ]] || {
    elapsed_ms="$(( $(now_ms) - started_ms ))"
    log_stage "reconcile_ms=$elapsed_ms provider=$active_provider abandoned=1"
    return 0
  }
  provider_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$active_provider"
  provider_switch_in_progress && {
    elapsed_ms="$(( $(now_ms) - started_ms ))"
    log_stage "reconcile_ms=$elapsed_ms provider=$active_provider abandoned=switching"
    return 0
  }
  proxy_line="$(read_proxy_settings)"
  proxy_enabled="$(effective_provider_proxy_enabled "$active_provider" "${proxy_line%%$'\t'*}")"
  ensure_provider_guard "$active_provider" "$provider_profile" "$(provider_url "$active_provider")" "$proxy_enabled" "$(provider_debug_port "$active_provider")"
  if provider_prewarm_queue_running; then
    elapsed_ms="$(( $(now_ms) - started_ms ))"
    log_stage "reconcile_ms=$elapsed_ms provider=$active_provider pool=prewarming"
    return 0
  fi
  if [[ -f "$(pool_warm_stamp_file)" ]]; then
    elapsed_ms="$(( $(now_ms) - started_ms ))"
    log_stage "reconcile_ms=$elapsed_ms provider=$active_provider pool=trusted"
    return 0
  fi
  sync_runtime_provider_pool_process_statuses "$active_provider" 0
  [[ "$(read_runtime_active_provider)" == "$active_provider" ]] || {
    elapsed_ms="$(( $(now_ms) - started_ms ))"
    log_stage "reconcile_ms=$elapsed_ms provider=$active_provider abandoned=1"
    return 0
  }
  provider_switch_in_progress && {
    elapsed_ms="$(( $(now_ms) - started_ms ))"
    log_stage "reconcile_ms=$elapsed_ms provider=$active_provider abandoned=switching"
    return 0
  }
  start_provider_pool_prewarm "$active_provider" preserve 0
  elapsed_ms="$(( $(now_ms) - started_ms ))"
  if [[ "$(read_runtime_active_provider)" == "$active_provider" ]]; then
    log_stage "reconcile_ms=$elapsed_ms provider=$active_provider"
  else
    log_stage "reconcile_ms=$elapsed_ms provider=$active_provider abandoned=1"
  fi
}

stop_window_guard() {
  local lock_path lifecycle_fd="" pid_file_pid="" guard_pid="" guard_starttime=""
  command -v flock >/dev/null 2>&1 || return 78
  lock_path="$(window_guard_lifecycle_lock_file)"
  mkdir -p "$(dirname "$lock_path")"
  exec {lifecycle_fd}>"$lock_path"
  if ! flock -x -w "$TIKPAL_WEB_MODE_LOCK_TIMEOUT_SECONDS" "$lifecycle_fd"; then
    exec {lifecycle_fd}>&-
    return 75
  fi
  pid_file_pid="$(window_guard_read_pid_file || true)"
  window_guard_collect_matching_pids
  if [[ "${#TIKPAL_WINDOW_GUARD_MATCHING_PIDS[@]}" -gt 1 ]]; then
    log "ERROR: refusing to stop multiple Explore window guards: ${TIKPAL_WINDOW_GUARD_MATCHING_PIDS[*]}"
    flock -u "$lifecycle_fd" >/dev/null 2>&1 || true
    exec {lifecycle_fd}>&-
    return 72
  fi
  if [[ "${#TIKPAL_WINDOW_GUARD_MATCHING_PIDS[@]}" == 1 ]]; then
    guard_pid="${TIKPAL_WINDOW_GUARD_MATCHING_PIDS[0]}"
    guard_starttime="$(window_guard_process_starttime "$guard_pid" || true)"
    if [[ -z "$guard_starttime" ]] ||
       ! window_guard_terminate_process "$guard_pid" "$guard_starttime"; then
      flock -u "$lifecycle_fd" >/dev/null 2>&1 || true
      exec {lifecycle_fd}>&-
      return 73
    fi
    window_guard_remove_pid_file_if_owned "$guard_pid" "$guard_starttime" || true
  elif [[ -n "$pid_file_pid" ]]; then
    window_guard_remove_pid_file_if_owned "$pid_file_pid" || true
  fi
  flock -u "$lifecycle_fd" >/dev/null 2>&1 || true
  exec {lifecycle_fd}>&-
}

window_guard_running() {
  local pid starttime
  pid="$(window_guard_read_pid_file || true)"
  starttime="$(window_guard_read_recorded_starttime || true)"
  window_guard_process_matches "$pid" "$starttime" || return 1
  window_guard_collect_matching_pids
  [[ "${#TIKPAL_WINDOW_GUARD_MATCHING_PIDS[@]}" == 1 &&
     "${TIKPAL_WINDOW_GUARD_MATCHING_PIDS[0]}" == "$pid" ]]
}


provider_prewarm_queue_pids() {
  local pid
  command -v pgrep >/dev/null 2>&1 || return 0
  while IFS= read -r pid; do
    [[ "$pid" =~ ^[0-9]+$ && "$pid" != "$$" && "$pid" != "$BASHPID" ]] || continue
    printf '%s\n' "$pid"
  done < <(
    {
      pgrep -f "[t]ikpal-web-mode.sh prewarm" 2>/dev/null || true
      pgrep -f "[t]ikpal-web-mode.sh warm-pool" 2>/dev/null || true
    } | awk 'NF && !seen[$0]++'
  )
}

provider_prewarm_queue_running() {
  [[ -n "$(provider_prewarm_queue_pids)" ]]
}

stop_provider_pool_prewarm() {
  local pid_file pid pids waited
  pid_file="$(prewarm_pid_file)"
  if [[ -r "$pid_file" ]]; then
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [[ "$pid" =~ ^[0-9]+$ && "$pid" != "$$" && "$pid" != "$BASHPID" ]]; then
      kill -TERM "-$pid" >/dev/null 2>&1 || true
      pkill -TERM -P "$pid" >/dev/null 2>&1 || true
      kill "$pid" >/dev/null 2>&1 || true
    fi
  fi
  if command -v pgrep >/dev/null 2>&1; then
    pids="$(provider_prewarm_queue_pids)"
    for pid in $pids; do
      kill -TERM "-$pid" >/dev/null 2>&1 || true
      kill -TERM "$pid" >/dev/null 2>&1 || true
    done
    waited=0
    while provider_prewarm_queue_running && [[ "$waited" -lt 20 ]]; do
      sleep 0.05
      waited=$((waited + 1))
    done
    if provider_prewarm_queue_running; then
      pids="$(provider_prewarm_queue_pids)"
      for pid in $pids; do
        kill -KILL "-$pid" >/dev/null 2>&1 || true
        kill -KILL "$pid" >/dev/null 2>&1 || true
      done
    fi
  fi
  rm -f "$pid_file"
}

provider_guard_pid_file() {
  local provider="${1:-}"
  if [[ -n "$provider" ]]; then
    printf '%s\n' "$TIKPAL_WEB_MODE_PROFILE_ROOT/provider-guard-$provider.pid"
    return
  fi
  printf '%s\n' "$TIKPAL_WEB_MODE_PROFILE_ROOT/provider-guard.pid"
}

stop_provider_guard() {
  local provider="${1:-}"
  local pid_file pid
  local pid_files=()
  local pids=()
  if [[ -n "$provider" ]]; then
    pid_files+=("$(provider_guard_pid_file "$provider")")
  else
    pid_files+=("$(provider_guard_pid_file)")
    for pid_file in "$TIKPAL_WEB_MODE_PROFILE_ROOT"/provider-guard-*.pid; do
      [[ -e "$pid_file" ]] && pid_files+=("$pid_file")
    done
    pid_files+=("$TIKPAL_WEB_MODE_PROFILE_ROOT/qq-confirm.pid")
  fi
  for pid_file in "${pid_files[@]}"; do
    [[ -r "$pid_file" ]] || {
      rm -f "$pid_file" >/dev/null 2>&1 || true
      continue
    }
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [[ "$pid" =~ ^[0-9]+$ ]]; then
      kill "$pid" >/dev/null 2>&1 || true
      pids+=("$pid")
    fi
    rm -f "$pid_file"
  done
  sleep 0.2
  for pid in "${pids[@]}"; do
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill -KILL "$pid" >/dev/null 2>&1 || true
    fi
  done
}

close_provider_windows() {
  command -v xsetroot >/dev/null 2>&1 &&
    xsetroot_mutation solid_root black -solid black 2>/dev/null || true
  stop_window_guard
  stop_provider_pool_prewarm
  stop_provider_guard
  pkill -f -- "--user-data-dir=$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/" >/dev/null 2>&1 || true
  sleep 0.2
  pkill -KILL -f -- "--user-data-dir=$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/" >/dev/null 2>&1 || true
}

park_profile_windows_for_reopen() {
  local profile="$1"
  local size="${2:-$TIKPAL_WEB_MODE_LEFT_WINDOW}"
  local known_window="${3:-}"
  local window pid
  # Ensure X root window background is black so compositor
  # transitions never expose a white root-window flash.
  command -v xsetroot >/dev/null 2>&1 &&
    xsetroot_mutation solid_root black -solid black 2>/dev/null || true
  [[ -n "$profile" ]] || return 0
  command -v xdotool >/dev/null 2>&1 || return 0
  window="${known_window:-$(first_window_for_profile "$profile" || true)}"
  if [[ -n "$window" ]]; then
    # Hide instantly before the async off-screen move so the X compositor
    # cannot expose a white root-window flash during the wmctrl transition.
    set_window_opacity "$window" 0 >/dev/null 2>&1 || true
    tile_window_fast "$window" "$TIKPAL_WEB_MODE_STAGE_POSITION" "$size"
    clear_window_above "$window"
    DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowlower "$window" >/dev/null 2>&1 || true
    return
  fi
  # No window found — old provider already gone, nothing to park.
  return 0
}

park_side_panel_for_reopen() {
  park_profile_windows_for_reopen "$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel" "$TIKPAL_WEB_MODE_PANEL_WINDOW"
}

park_provider_windows_for_reopen() {
  local active_provider="${1:-}"
  local provider profile failed=0
  if [[ -n "$active_provider" ]]; then
    profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$active_provider"
    if profile_process_exists "$profile"; then
      park_profile_windows_for_reopen "$profile" "$TIKPAL_WEB_MODE_LEFT_WINDOW" || failed=1
    fi
  fi
  while IFS= read -r provider; do
    [[ -n "$provider" ]] || continue
    [[ -z "$active_provider" || "$provider" != "$active_provider" ]] || continue
    profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$provider"
    profile_process_exists "$profile" || continue
    park_profile_windows_for_reopen "$profile" "$TIKPAL_WEB_MODE_LEFT_WINDOW" || failed=1
  done < <(provider_ids)
  return "$failed"
}

park_left_web_mode_surfaces_for_reopen() {
  local active_provider="${1:-}"
  park_provider_windows_for_reopen "$active_provider"
}

close_overlay_process_matches() {
  local pid="$1"
  local expected_profile="${2:-}"
  local command_line
  [[ "$pid" =~ ^[0-9]+$ && -r "/proc/$pid/cmdline" ]] || return 1
  command_line="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
  [[ "$command_line" == *"--user-data-dir=$TIKPAL_WEB_MODE_PROFILE_ROOT/close-overlay."* ]] || return 1
  [[ -z "$expected_profile" || "$command_line" == *"--user-data-dir=$expected_profile"* ]]
}

terminate_close_overlay_process() {
  local pid="$1"
  local expected_profile="${2:-}"
  close_overlay_process_matches "$pid" "$expected_profile" || return 1
  # This is a disposable, already-covered Chromium surface. A graceful
  # termination can keep its opaque X11 window alive for several seconds
  # after the provider and panel are safely gone.
  pkill -KILL -P "$pid" 2>/dev/null || true
  kill -KILL "$pid" 2>/dev/null || true
}



wait_for_close_overlay_fade() {
  local fade_seconds sleep_seconds
  fade_seconds="$TIKPAL_WEB_MODE_CLOSE_OVERLAY_FADE_SECONDS"
  [[ "$fade_seconds" =~ ^[0-9]+$ ]] || fade_seconds=3
  sleep_seconds="$(awk -v fade_seconds="$fade_seconds" 'BEGIN { printf "%.1f", fade_seconds + 0.5 }')"
  sleep "$sleep_seconds"
}

park_web_mode_surfaces_for_reopen() {
  local _active_provider="${1:-}"
  local -a surfaces=() park_pids=()
  local surface window kind attempts remaining=0

  # Closing is not on the hot switching path. Enumerate every on-screen
  # provider/panel window so a popup or stale Chromium child cannot remain
  # above Ambient while its sibling gets parked.
  while IFS= read -r surface; do
    [[ -n "$surface" ]] && surfaces+=("$surface")
  done < <(web_mode_surface_windows_on_screen)
  for surface in "${surfaces[@]:-}"; do
    [[ -n "$surface" ]] || continue
    IFS=$'\t' read -r window kind <<< "$surface"
    set_window_opacity "$window" 0 >/dev/null 2>&1 || {
      log "ERROR: could not hide $kind window $window before close"
      remaining=1
    }
  done

  # Every collected surface is transparent before any window moves. The
  # slower X11 parking work can now happen in parallel without exposing only
  # one half of Explore during the return to Ambient/Hi-Fi.
  for surface in "${surfaces[@]:-}"; do
    [[ -n "$surface" ]] || continue
    IFS=$'\t' read -r window kind <<< "$surface"
    (
      if [[ "$kind" == "panel" ]]; then
        tile_window_fast "$window" "$TIKPAL_WEB_MODE_STAGE_POSITION" "$TIKPAL_WEB_MODE_PANEL_WINDOW"
      else
        tile_window_fast "$window" "$TIKPAL_WEB_MODE_STAGE_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW"
      fi
      clear_window_above "$window"
      DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowlower "$window" >/dev/null 2>&1 || true
    ) &
    park_pids+=("$!")
  done
  for pid in "${park_pids[@]:-}"; do
    [[ -n "$pid" ]] || continue
    wait "$pid" || remaining=1
  done

  # A successful close means no provider or side-panel window intersects the
  # physical screen. Do not clear activeProvider until this is true.
  for attempts in 1 2 3; do
    if ! web_mode_surface_windows_on_screen | grep -q .; then
      [[ "$remaining" == "0" ]] && return 0
      break
    fi
    sleep 0.1
  done
  log "ERROR: Explore close left provider or side-panel windows on screen"
  return 1
}

web_mode_surface_kind_for_pid() {
  local pid="$1"
  local provider profile
  if process_tree_uses_profile "$pid" "$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel"; then
    printf 'panel\n'
    return 0
  fi
  while IFS= read -r provider; do
    [[ -n "$provider" ]] || continue
    profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$provider"
    if process_tree_uses_profile "$pid" "$profile"; then
      printf 'provider\n'
      return 0
    fi
  done < <(provider_ids)
  return 1
}

window_intersects_kiosk_screen() {
  local window="$1"
  local geometry x y width height screen_width screen_height
  geometry="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe getwindowgeometry --shell "$window" 2>/dev/null || true)"
  x="$(printf '%s\n' "$geometry" | awk -F= '$1 == "X" { print $2 }')"
  y="$(printf '%s\n' "$geometry" | awk -F= '$1 == "Y" { print $2 }')"
  width="$(printf '%s\n' "$geometry" | awk -F= '$1 == "WIDTH" { print $2 }')"
  height="$(printf '%s\n' "$geometry" | awk -F= '$1 == "HEIGHT" { print $2 }')"
  [[ "$x" =~ ^-?[0-9]+$ && "$y" =~ ^-?[0-9]+$ && "$width" =~ ^[1-9][0-9]*$ && "$height" =~ ^[1-9][0-9]*$ ]] || return 1
  screen_width=$(( $(window_width "$TIKPAL_WEB_MODE_LEFT_WINDOW") + $(window_width "$TIKPAL_WEB_MODE_PANEL_WINDOW") ))
  screen_height="$(window_height "$TIKPAL_WEB_MODE_LEFT_WINDOW")"
  [[ "$screen_width" =~ ^[1-9][0-9]*$ && "$screen_height" =~ ^[1-9][0-9]*$ ]] || return 1
  (( x < screen_width && x + width > 0 && y < screen_height && y + height > 0 ))
}

web_mode_surface_windows_on_screen() {
  local window pid kind
  while IFS= read -r window; do
    [[ "$window" =~ ^[0-9]+$ ]] || continue
    pid="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe getwindowpid "$window" 2>/dev/null || true)"
    kind="$(web_mode_surface_kind_for_pid "$pid" || true)"
    [[ -n "$kind" ]] || continue
    window_intersects_kiosk_screen "$window" || continue
    printf '%s\t%s\n' "$window" "$kind"
  done < <(visible_chromium_windows)
}

close_web_mode_process_surfaces() {
  close_provider_windows &
  local providers_pid=$!
  close_side_panel &
  local panel_pid=$!
  wait "$providers_pid" 2>/dev/null || true
  wait "$panel_pid" 2>/dev/null || true
}

schedule_web_mode_warm_cleanup() {
  is_enabled "$TIKPAL_WEB_MODE_CLOSE_WARM_ENABLED" || return 0
  is_enabled "$TIKPAL_WEB_MODE_CLOSE_KEEP_RESIDENT" && return 0
  local ttl="$TIKPAL_WEB_MODE_CLOSE_WARM_TTL_SECONDS"
  [[ "$ttl" =~ ^[0-9]+([.][0-9]+)?$ ]] || ttl=45
  if command -v setsid >/dev/null 2>&1; then
    env TIKPAL_WEB_MODE_CLOSE_WARM_TTL_SECONDS="$ttl" setsid "$SCRIPT_DIR/tikpal-web-mode.sh" cleanup-warm </dev/null >/dev/null 2>&1 9>&- &
  else
    env TIKPAL_WEB_MODE_CLOSE_WARM_TTL_SECONDS="$ttl" nohup "$SCRIPT_DIR/tikpal-web-mode.sh" cleanup-warm </dev/null >/dev/null 2>&1 9>&- &
  fi
}

schedule_provider_pool_refill_after_close() {
  is_enabled "$TIKPAL_WEB_MODE_CLOSE_KEEP_RESIDENT" || return 0
  is_enabled "$TIKPAL_WEB_MODE_CLOSE_REFILL_PROVIDER_POOL_ENABLED" || return 0
  is_enabled "$TIKPAL_WEB_MODE_PROVIDER_POOL" || return 0
  is_enabled "$TIKPAL_WEB_MODE_PROVIDER_IDLE_POOL_ENABLED" || return 0
  is_enabled "$TIKPAL_WEB_MODE_PROVIDER_PREWARM_ENABLED" || return 0
  [[ -z "$(read_runtime_active_provider)" ]] || return 0
  provider_prewarm_queue_running && return 0
  if [[ -f "$(pool_warm_stamp_file)" ]]; then
    sync_runtime_provider_pool_process_statuses ""
    return 0
  fi
  if ! provider_pool_needs_prewarm ""; then
    sync_runtime_provider_pool_process_statuses ""
    return 0
  fi
  if command -v setsid >/dev/null 2>&1; then
    setsid "$SCRIPT_DIR/tikpal-web-mode.sh" warm-pool </dev/null >/dev/null 2>&1 9>&- &
  else
    nohup "$SCRIPT_DIR/tikpal-web-mode.sh" warm-pool </dev/null >/dev/null 2>&1 9>&- &
  fi
  printf '%s\n' "$!" > "$(prewarm_pid_file)"
}

close_web_mode_full() {
  local providers_pid panel_pid
  close_legacy_exit_stage
  hide_onboard
  # Full shutdown is less common than the resident warm path, but it has the
  # same visible-state contract: hide every Explore surface first and never
  # clear activeProvider while a provider or panel window can still cover the
  # kiosk.
  park_web_mode_surfaces_for_reopen "" || return 1
  if ! runtime_close_request_is_current; then
    return 0
  fi
  close_provider_windows &
  providers_pid=$!
  close_side_panel &
  panel_pid=$!
  wait "$providers_pid" 2>/dev/null || true
  wait "$panel_pid" 2>/dev/null || true
  if web_mode_surface_windows_on_screen | grep -q .; then
    log "ERROR: Explore close left provider or side-panel windows on screen"
    return 1
  fi
  if ! runtime_close_request_is_current; then
    return 0
  fi
  write_audio_bus_state ""
  write_runtime_provider_state ""
  if is_enabled "${TIKPAL_WEB_MODE_STARTUP_RESET:-0}"; then
    rm -f "$(pool_warm_stamp_file)"
  else
    schedule_provider_pool_refill_after_close
  fi
  # The kiosk launcher starts boot prewarm after its own Chromium window is
  # stable. A startup reset runs before that point, so it must not create a
  # second warm-pool worker against the same provider profiles.
  sync_runtime_provider_pool_process_statuses ""
  # Clean stale launch lock files from previous boot.
  rm -f "$TIKPAL_WEB_MODE_PROFILE_ROOT"/provider-*.launch.lock 2>/dev/null || true
}

close_web_mode_warm() {
  local active_provider settle
  active_provider="${TIKPAL_WEB_MODE_CLOSE_ACTIVE_PROVIDER:-}"
  [[ -n "$active_provider" ]] || active_provider="$(read_runtime_active_provider)"
  settle="$TIKPAL_WEB_MODE_CLOSE_AUDIO_GATE_SETTLE_SECONDS"
  [[ "$settle" =~ ^[0-9]+([.][0-9]+)?$ ]] || settle=0.35
  close_legacy_exit_stage
  hide_onboard
  if ! runtime_close_request_is_current; then
    return 0
  fi
  stop_window_guard
  if ! runtime_close_request_is_current; then
    return 0
  fi
  park_web_mode_surfaces_for_reopen "$active_provider" || return 1
  if ! runtime_close_request_is_current; then
    return 0
  fi
  write_audio_bus_state ""
  write_runtime_provider_state ""
  sync_runtime_provider_pool_process_statuses ""
  sleep "$settle"
  if ! is_enabled "$TIKPAL_WEB_MODE_CLOSE_KEEP_RESIDENT"; then
    stop_provider_guard
  fi
  schedule_provider_pool_refill_after_close
  schedule_web_mode_warm_cleanup
}

close_web_mode() {
  if is_enabled "$TIKPAL_WEB_MODE_CLOSE_WARM_ENABLED"; then
    close_web_mode_warm
    return
  fi
  close_web_mode_full
}

cleanup_warm_web_mode() {
  is_enabled "$TIKPAL_WEB_MODE_CLOSE_KEEP_RESIDENT" && return 0
  if [[ -n "$(read_runtime_active_provider)" ]]; then
    return 0
  fi
  close_web_mode_full
}

close_web_mode_from_guard() {
  close_legacy_exit_stage
  hide_onboard
  if is_enabled "$TIKPAL_WEB_MODE_CLOSE_KEEP_RESIDENT"; then
    if [[ -n "$(read_runtime_active_provider)" ]]; then
      return 0
    fi
    park_web_mode_surfaces_for_reopen "" || return 1
    if [[ -n "$(read_runtime_active_provider)" ]]; then
      return 0
    fi
    write_audio_bus_state ""
    write_runtime_provider_state ""
    sync_runtime_provider_pool_process_statuses ""
    schedule_provider_pool_refill_after_close
    return 0
  fi
  close_web_mode_full
}

profile_command_line_matches() {
  local profile="$1"
  local command_line="$2"
  local canonical_profile
  [[ -n "$profile" ]] || return 1
  [[ " $command_line " == *" --user-data-dir=$profile "* ]] && return 0
  canonical_profile="$(readlink -f -- "$profile" 2>/dev/null || true)"
  [[ -n "$canonical_profile" && "$canonical_profile" != "$profile" ]] || return 1
  [[ " $command_line " == *" --user-data-dir=$canonical_profile "* ]]
}

profile_process_exists() {
  local profile="$1"
  local canonical_profile pid command_line executable_name
  [[ -n "$profile" ]] || return 1
  canonical_profile="$(readlink -f -- "$profile" 2>/dev/null || true)"
  while IFS= read -r pid; do
    [[ "$pid" =~ ^[0-9]+$ && -r "/proc/$pid/cmdline" ]] || continue
    command_line="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
    profile_command_line_matches "$profile" "$command_line" || continue
    # A guard is invoked with the profile as a positional argument. It must
    # never keep a dead Chromium profile falsely resident. Chromium can replace
    # the configured launcher wrapper with its real executable in /proc.
    [[ "$command_line" == "$TIKPAL_CHROMIUM_BIN"* ]] && return 0
    executable_name="$(basename "$(readlink -f "/proc/$pid/exe" 2>/dev/null || true)")"
    case "$executable_name" in
      chrome|chromium|chromium-browser) return 0 ;;
    esac
  done < <(
    pgrep -f -- "--user-data-dir=$profile" 2>/dev/null || true
    if [[ -n "$canonical_profile" && "$canonical_profile" != "$profile" ]]; then
      pgrep -f -- "--user-data-dir=$canonical_profile" 2>/dev/null || true
    fi
  )
  return 1
}

any_provider_process_exists() {
  local profile
  [[ -d "$TIKPAL_WEB_MODE_PROFILE_ROOT/providers" ]] || return 1
  for profile in "$TIKPAL_WEB_MODE_PROFILE_ROOT"/providers/*; do
    [[ -d "$profile" ]] || continue
    profile_process_exists "$profile" && return 0
  done
  return 1
}

cleanup_stale_profile_singletons() {
  local provider_profile="$1"
  [[ -n "$provider_profile" && -d "$provider_profile" ]] || return 0
  profile_process_exists "$provider_profile" && return 0
  rm -f "$provider_profile"/SingletonCookie \
    "$provider_profile"/SingletonLock \
    "$provider_profile"/SingletonSocket
}

close_provider_profile() {
  local provider_profile="$1"
  local canonical_profile
  [[ -n "$provider_profile" ]] || return 0
  canonical_profile="$(readlink -f -- "$provider_profile" 2>/dev/null || true)"
  pkill -TERM -f -- "--user-data-dir=$provider_profile" >/dev/null 2>&1 || true
  if [[ -n "$canonical_profile" && "$canonical_profile" != "$provider_profile" ]]; then
    pkill -TERM -f -- "--user-data-dir=$canonical_profile" >/dev/null 2>&1 || true
  fi
  for _ in {1..10}; do
    profile_process_exists "$provider_profile" || break
    sleep 0.1
  done
  if profile_process_exists "$provider_profile"; then
    pkill -KILL -f -- "--user-data-dir=$provider_profile" >/dev/null 2>&1 || true
    if [[ -n "$canonical_profile" && "$canonical_profile" != "$provider_profile" ]]; then
      pkill -KILL -f -- "--user-data-dir=$canonical_profile" >/dev/null 2>&1 || true
    fi
  fi
  cleanup_stale_profile_singletons "$provider_profile"
}

close_other_provider_profiles() {
  local keep_profile="$1"
  local profile
  [[ -d "$TIKPAL_WEB_MODE_PROFILE_ROOT/providers" ]] || return 0
  for profile in "$TIKPAL_WEB_MODE_PROFILE_ROOT"/providers/*; do
    [[ -d "$profile" ]] || continue
    [[ "$profile" == "$keep_profile" ]] && continue
    close_provider_profile "$profile"
  done
}

process_tree_uses_profile() {
  local pid="$1"
  local profile="$2"
  local depth=0
  [[ -n "$pid" && -n "$profile" ]] || return 1

  while [[ "$pid" =~ ^[0-9]+$ && "$pid" != "1" && "$depth" -lt 8 ]]; do
    if [[ -r "/proc/$pid/cmdline" ]] && profile_command_line_matches "$profile" "$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"; then
      return 0
    fi
    [[ -r "/proc/$pid/status" ]] || break
    pid="$(awk '/^PPid:/{print $2}' "/proc/$pid/status")"
    depth=$((depth + 1))
  done

  return 1
}

# Find an X11 window owned by a process tree rooted at $1.
# Traverses child PIDs because Chromium forks — the spawned PID may not be the
# window owner.  Uses xdotool search --pid which reads _NET_WM_PID.
find_window_for_pid() {
  local parent_pid="$1"
  local _pid _child _w geometry width height area best_window="" best_area=0 index=0
  local -a pending=()
  command -v xdotool >/dev/null 2>&1 || return 1
  [[ "$parent_pid" =~ ^[0-9]+$ ]] || return 1
  pending+=("$parent_pid")
  # Chromium can put the browser window several generations below the process
  # that owns --user-data-dir. Walk only that process tree and choose the
  # largest usable window; never enumerate unrelated Chromium windows here.
  while [[ "$index" -lt "${#pending[@]}" && "$index" -lt 64 ]]; do
    _pid="${pending[$index]}"
    index=$((index + 1))
    while IFS= read -r _w; do
      [[ "$_w" =~ ^[0-9]+$ ]] || continue
      geometry="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_probe getwindowgeometry --shell "$_w" 2>/dev/null || true)"
      width="$(printf '%s\n' "$geometry" | awk -F= '$1 == "WIDTH" { print $2 }')"
      height="$(printf '%s\n' "$geometry" | awk -F= '$1 == "HEIGHT" { print $2 }')"
      [[ "$width" =~ ^[0-9]+$ && "$height" =~ ^[0-9]+$ ]] || continue
      area=$((width * height))
      if [[ "$area" -gt "$best_area" ]]; then
        best_area="$area"
        best_window="$_w"
      fi
    done < <(
      DISPLAY="$TIKPAL_KIOSK_DISPLAY" \
        TIKPAL_WEB_MODE_X11_SEARCH_TIMEOUT_SECONDS=2 \
        xdotool_probe search --pid "$_pid" 2>/dev/null || true
    )
    # A usable Chromium app window is enough. Do not spend one bounded X11
    # search per renderer after the browser root already exposed its main XID.
    [[ "$best_area" -gt 100000 ]] && break
    while IFS= read -r _child; do
      [[ "$_child" =~ ^[0-9]+$ ]] && pending+=("$_child")
    done < <(pgrep -P "$_pid" 2>/dev/null || true)
  done
  [[ -n "$best_window" && "$best_area" -gt 100000 ]] || return 1
  printf '%s\n' "$best_window"
}

provider_profile_for_pid() {
  local pid="$1"
  local provider profile
  while IFS= read -r provider; do
    [[ -n "$provider" ]] || continue
    profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$provider"
    process_tree_uses_profile "$pid" "$profile" || continue
    printf '%s\t%s\n' "$provider" "$profile"
    return 0
  done < <(provider_ids)
  return 1
}

is_tikpal_window_title() {
  local title="$1"
  [[ "$title" == "Tikpal" || "$title" == *"Tikpal - Chromium"* || "$title" == *"Tikpal Speaker"* ]]
}

is_ad_window_title() {
  local title="$1"
  [[ "$title" == *"广告"* || "$title" == *"推广"* || "$title" == *"活动"* || "$title" == *"弹窗"* || "$title" == *"领券"* || "$title" == *"下载"* || "$title" == *"VIP"* || "$title" == *"vip"* || "$title" == *"Ad"* || "$title" == *"ad"* ]]
}

is_oauth_window_title() {
  local title="$1"
  [[ "$title" == *"Google"* && ( "$title" == *"账号"* || "$title" == *"帳號"* || "$title" == *"Account"* || "$title" == *"Sign in"* || "$title" == *"登录"* || "$title" == *"登入"* ) ]]
}

tile_window() {
  local window="$1"
  local position="$2"
  local size="$3"
  local current_height current_width current_x current_y geometry height width x y
  x="$(position_x "$position")"
  y="$(position_y "$position")"
  width="$(window_width "$size")"
  height="$(window_height "$size")"
  TIKPAL_TILE_WINDOW_CHANGED=0
  geometry="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe getwindowgeometry --shell "$window" 2>/dev/null || true)"
  current_x="$(printf '%s\n' "$geometry" | awk -F= '$1 == "X" { print $2 }')"
  current_y="$(printf '%s\n' "$geometry" | awk -F= '$1 == "Y" { print $2 }')"
  current_width="$(printf '%s\n' "$geometry" | awk -F= '$1 == "WIDTH" { print $2 }')"
  current_height="$(printf '%s\n' "$geometry" | awk -F= '$1 == "HEIGHT" { print $2 }')"
  if [[ "$current_x" == "$x" && "$current_y" == "$y" && "$current_width" == "$width" && "$current_height" == "$height" ]]; then
    return 0
  fi
  TIKPAL_TILE_WINDOW_CHANGED=1
  if command -v wmctrl >/dev/null 2>&1; then
    wmctrl_mutation clear_maximize "$window" normal \
      -i -r "$window" -b remove,fullscreen,maximized_vert,maximized_horz >/dev/null 2>&1 || true
    if ! is_enabled "$TIKPAL_WEB_MODE_X11_SYNC_WINDOW_OPS"; then
      wmctrl_mutation geometry "$window" "${x},${y}_${width}x${height}" \
        -i -r "$window" -e "0,$x,$y,$width,$height" >/dev/null 2>&1 && return 0
    fi
  fi
  if is_enabled "$TIKPAL_WEB_MODE_X11_SYNC_WINDOW_OPS"; then
    DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe \
      windowmove --sync "$window" "$x" "$y" \
      windowsize --sync "$window" "$width" "$height" \
      windowmove "$window" "$x" "$y" >/dev/null 2>&1 || true
    return 0
  fi
  DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe \
    windowmove "$window" "$x" "$y" \
    windowsize "$window" "$width" "$height" \
    windowmove "$window" "$x" "$y" >/dev/null 2>&1 || true
}

tile_window_fast() {
  local window="$1"
  local position="$2"
  local size="$3"
  local height width x y
  x="$(position_x "$position")"
  y="$(position_y "$position")"
  width="$(window_width "$size")"
  height="$(window_height "$size")"
  TIKPAL_TILE_WINDOW_CHANGED=1
  if command -v wmctrl >/dev/null 2>&1 && ! is_enabled "$TIKPAL_WEB_MODE_X11_SYNC_WINDOW_OPS"; then
    wmctrl_mutation geometry "$window" "${x},${y}_${width}x${height}" \
      -i -r "$window" -e "0,$x,$y,$width,$height" >/dev/null 2>&1 && return 0
  fi
  if is_enabled "$TIKPAL_WEB_MODE_X11_SYNC_WINDOW_OPS"; then
    tile_window "$window" "$position" "$size"
    return
  fi
  DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe \
    windowmove "$window" "$x" "$y" \
    windowsize "$window" "$width" "$height" \
    windowmove "$window" "$x" "$y" >/dev/null 2>&1 || true
}

window_is_at_position() {
  local window="$1"
  local position="$2"
  local size="$3"
  local geometry expected_height expected_width expected_x expected_y height width x y
  [[ "$window" =~ ^[0-9]+$ ]] || return 1
  geometry="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe getwindowgeometry --shell "$window" 2>/dev/null || true)"
  x="$(printf '%s\n' "$geometry" | awk -F= '$1 == "X" { print $2 }')"
  y="$(printf '%s\n' "$geometry" | awk -F= '$1 == "Y" { print $2 }')"
  width="$(printf '%s\n' "$geometry" | awk -F= '$1 == "WIDTH" { print $2 }')"
  height="$(printf '%s\n' "$geometry" | awk -F= '$1 == "HEIGHT" { print $2 }')"
  expected_x="$(position_x "$position")"
  expected_y="$(position_y "$position")"
  expected_width="$(window_width "$size")"
  expected_height="$(window_height "$size")"
  [[ "$x" == "$expected_x" && "$y" == "$expected_y" && "$width" == "$expected_width" && "$height" == "$expected_height" ]]
}

wait_for_window_position() {
  local window="$1"
  local position="$2"
  local size="$3"
  local timeout_seconds="${4:-$TIKPAL_WEB_MODE_CLOSE_PARK_TIMEOUT_SECONDS}"
  local deadline
  [[ "$timeout_seconds" =~ ^[0-9]+([.][0-9]+)?$ ]] || timeout_seconds=3
  deadline="$(awk -v now="$(now_ms)" -v timeout="$timeout_seconds" 'BEGIN { printf "%.0f", now + timeout * 1000 }')"
  while (( $(now_ms) < deadline )); do
    window_is_at_position "$window" "$position" "$size" && return 0
    sleep 0.05
  done
  window_is_at_position "$window" "$position" "$size"
}

raise_window() {
  local window="$1"
  [[ -n "$window" ]] || return 0
  DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowraise "$window" windowactivate "$window" >/dev/null 2>&1 || true
}

raise_window_without_focus() {
  local window="$1"
  [[ -n "$window" ]] || return 0
  DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowraise "$window" >/dev/null 2>&1 || true
}

mark_window_above() {
  local window="$1"
  [[ -n "$window" ]] || return 0
  command -v wmctrl >/dev/null 2>&1 || return 0
  wmctrl_mutation add_above "$window" above \
    -i -r "$window" -b add,above >/dev/null 2>&1 || true
}

clear_window_above() {
  local window="$1"
  [[ -n "$window" ]] || return 0
  command -v wmctrl >/dev/null 2>&1 || return 0
  wmctrl_mutation remove_above "$window" normal \
    -i -r "$window" -b remove,above >/dev/null 2>&1 || true
}

set_window_opacity() {
  local window="$1"
  local opacity="$2"
  local window_id value
  [[ "$window" =~ ^[0-9]+$ ]] || return 1
  command -v xprop >/dev/null 2>&1 || return 1
  [[ "$opacity" =~ ^0([.][0-9]+)?$|^1([.]0+)?$ ]] || return 1
  window_id="$(printf '0x%x' "$window")"
  value="$(awk -v opacity="$opacity" 'BEGIN { printf "0x%08x", int(4294967295 * opacity) }')"
  xprop_mutation opacity "$window" "$value" \
    -id "$window_id" -f _NET_WM_WINDOW_OPACITY 32c -set _NET_WM_WINDOW_OPACITY "$value" >/dev/null 2>&1
}

restore_window_opacity() {
  local window="$1"
  set_window_opacity "$window" 1 >/dev/null 2>&1 || true
}

window_opacity_value() {
  local window="$1"
  local window_id output value
  [[ "$window" =~ ^[0-9]+$ ]] || return 1
  command -v xprop >/dev/null 2>&1 || return 1
  window_id="$(printf '0x%x' "$window")"
  output="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xprop -id "$window_id" _NET_WM_WINDOW_OPACITY 2>/dev/null)" || return 1
  value="$(printf '%s\n' "$output" | awk -F'= ' 'NF > 1 { print $2; exit }')"
  printf '%s\n' "${value:-unset}"
}

window_opacity_is_full() {
  case "$1" in
    unset|4294967295|0xffffffff|0xFFFFFFFF) return 0 ;;
    *) return 1 ;;
  esac
}

window_geometry_compact() {
  local window="$1"
  local geometry x y width height
  [[ "$window" =~ ^[0-9]+$ ]] || return 1
  geometry="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_probe getwindowgeometry --shell "$window")" || return 1
  x="$(printf '%s\n' "$geometry" | awk -F= '$1 == "X" { print $2 }')"
  y="$(printf '%s\n' "$geometry" | awk -F= '$1 == "Y" { print $2 }')"
  width="$(printf '%s\n' "$geometry" | awk -F= '$1 == "WIDTH" { print $2 }')"
  height="$(printf '%s\n' "$geometry" | awk -F= '$1 == "HEIGHT" { print $2 }')"
  [[ "$x" =~ ^-?[0-9]+$ && "$y" =~ ^-?[0-9]+$ && "$width" =~ ^[1-9][0-9]*$ && "$height" =~ ^[1-9][0-9]*$ ]] || return 1
  printf '%s,%s_%sx%s\n' "$x" "$y" "$width" "$height"
}

xdotool_probe() {
  local timeout_seconds=3
  if [[ "${1:-}" == "search" ]]; then
    timeout_seconds="${TIKPAL_WEB_MODE_X11_SEARCH_TIMEOUT_SECONDS:-0.35}"
  fi
  timeout "$timeout_seconds" xdotool "$@" 2>/dev/null
}

# Cache hits are still targeted, but they are not trusted from geometry alone.
# Keep this helper status-preserving so a dead or reused XID cannot become a
# successful resident reveal through xdotool_safe's deliberate `|| true`.
validate_profile_window_fast() {
  local window="$1"
  local profile="$2"
  local timing_enabled="${3:-0}"
  local probe pid x y width height segment_started_ms=0
  if [[ "$timing_enabled" == "1" ]]; then
    TIKPAL_VALIDATE_PROFILE_WINDOW_X11_MS=-1
    TIKPAL_VALIDATE_PROFILE_WINDOW_PID_PARSE_MS=-1
    TIKPAL_VALIDATE_PROFILE_WINDOW_PROFILE_MS=-1
    TIKPAL_VALIDATE_PROFILE_WINDOW_GEOMETRY_MS=-1
    TIKPAL_VALIDATE_PROFILE_WINDOW_PID=none
    TIKPAL_VALIDATE_PROFILE_WINDOW_GEOMETRY=not_parsed
    TIKPAL_VALIDATE_PROFILE_WINDOW_RESULT=invalid_input
  fi
  [[ "$window" =~ ^[0-9]+$ && -n "$profile" ]] || return 1

  [[ "$timing_enabled" != "1" ]] || segment_started_ms="$(now_ms)"
  if ! probe="$(
    DISPLAY="$TIKPAL_KIOSK_DISPLAY" \
      xdotool_probe getwindowpid "$window" getwindowgeometry --shell "$window"
  )"; then
    if [[ "$timing_enabled" == "1" ]]; then
      TIKPAL_VALIDATE_PROFILE_WINDOW_X11_MS="$(( $(now_ms) - segment_started_ms ))"
      TIKPAL_VALIDATE_PROFILE_WINDOW_RESULT=x11_failed
    fi
    return 1
  fi
  [[ "$timing_enabled" != "1" ]] \
    || TIKPAL_VALIDATE_PROFILE_WINDOW_X11_MS="$(( $(now_ms) - segment_started_ms ))"

  [[ "$timing_enabled" != "1" ]] || segment_started_ms="$(now_ms)"
  pid="$(printf '%s\n' "$probe" | sed -n '1p')"
  if [[ "$timing_enabled" == "1" ]]; then
    TIKPAL_VALIDATE_PROFILE_WINDOW_PID_PARSE_MS="$(( $(now_ms) - segment_started_ms ))"
    TIKPAL_VALIDATE_PROFILE_WINDOW_PID="${pid:-none}"
  fi

  [[ "$timing_enabled" != "1" ]] || segment_started_ms="$(now_ms)"
  if ! process_tree_uses_profile "$pid" "$profile"; then
    if [[ "$timing_enabled" == "1" ]]; then
      TIKPAL_VALIDATE_PROFILE_WINDOW_PROFILE_MS="$(( $(now_ms) - segment_started_ms ))"
      TIKPAL_VALIDATE_PROFILE_WINDOW_RESULT=profile_mismatch
    fi
    return 1
  fi
  [[ "$timing_enabled" != "1" ]] \
    || TIKPAL_VALIDATE_PROFILE_WINDOW_PROFILE_MS="$(( $(now_ms) - segment_started_ms ))"

  [[ "$timing_enabled" != "1" ]] || segment_started_ms="$(now_ms)"
  x="$(printf '%s\n' "$probe" | awk -F= '$1 == "X" { print $2 }')"
  y="$(printf '%s\n' "$probe" | awk -F= '$1 == "Y" { print $2 }')"
  width="$(printf '%s\n' "$probe" | awk -F= '$1 == "WIDTH" { print $2 }')"
  height="$(printf '%s\n' "$probe" | awk -F= '$1 == "HEIGHT" { print $2 }')"
  if [[ "$timing_enabled" == "1" ]]; then
    TIKPAL_VALIDATE_PROFILE_WINDOW_GEOMETRY_MS="$(( $(now_ms) - segment_started_ms ))"
    TIKPAL_VALIDATE_PROFILE_WINDOW_GEOMETRY="${x:-?},${y:-?}_${width:-?}x${height:-?}"
  fi
  if [[ ! "$width" =~ ^[1-9][0-9]*$ || ! "$height" =~ ^[1-9][0-9]*$ ]]; then
    [[ "$timing_enabled" != "1" ]] || TIKPAL_VALIDATE_PROFILE_WINDOW_RESULT=geometry_invalid
    return 1
  fi
  if (( width * height <= 100000 )); then
    [[ "$timing_enabled" != "1" ]] || TIKPAL_VALIDATE_PROFILE_WINDOW_RESULT=area_too_small
    return 1
  fi
  [[ "$timing_enabled" != "1" ]] || TIKPAL_VALIDATE_PROFILE_WINDOW_RESULT=ok
  return 0
}

first_window_for_profile() {
  local profile="$1"
  local timing_enabled="${2:-0}"
  local timing_role="${3:-profile}"
  local window pid command_line executable_name
  local cache_path cached_window result_window="" outcome=recovery cache_present=0 retry=0 recovery=0
  local function_started_ms=0 segment_started_ms=0 cache_path_ms=-1 cache_read_ms=-1 recovery_ms=-1 total_ms=-1
  local attempt1_result=not_run attempt1_x11_ms=-1 attempt1_pid_parse_ms=-1 attempt1_profile_ms=-1 attempt1_geometry_ms=-1
  local attempt1_pid=none attempt1_geometry=not_parsed
  local attempt2_result=not_run attempt2_x11_ms=-1 attempt2_pid_parse_ms=-1 attempt2_profile_ms=-1 attempt2_geometry_ms=-1
  local attempt2_pid=none attempt2_geometry=not_parsed
  local trace_started_ms=0 trace_finished_ms=0 trace_elapsed_ms=0
  if switch_trace_enabled; then
    switch_trace_now_ms trace_started_ms
  fi
  command -v xdotool >/dev/null 2>&1 || return 1
  [[ "$timing_enabled" != "1" ]] || function_started_ms="$(now_ms)"
  [[ "$timing_enabled" != "1" ]] || segment_started_ms="$(now_ms)"
  cache_path="$(profile_window_cache_path "$profile")"
  [[ "$timing_enabled" != "1" ]] || cache_path_ms="$(( $(now_ms) - segment_started_ms ))"
  if [[ -r "$cache_path" ]]; then
    cache_present=1
    [[ "$timing_enabled" != "1" ]] || segment_started_ms="$(now_ms)"
    cached_window="$(cat "$cache_path" 2>/dev/null || true)"
    [[ "$timing_enabled" != "1" ]] || cache_read_ms="$(( $(now_ms) - segment_started_ms ))"
    if validate_profile_window_fast "$cached_window" "$profile" "$timing_enabled"; then
      attempt1_result=ok
      result_window="$cached_window"
      outcome=cache_hit
    else
      attempt1_result="${TIKPAL_VALIDATE_PROFILE_WINDOW_RESULT:-failed}"
    fi
    if [[ "$timing_enabled" == "1" ]]; then
      attempt1_x11_ms="${TIKPAL_VALIDATE_PROFILE_WINDOW_X11_MS:--1}"
      attempt1_pid_parse_ms="${TIKPAL_VALIDATE_PROFILE_WINDOW_PID_PARSE_MS:--1}"
      attempt1_profile_ms="${TIKPAL_VALIDATE_PROFILE_WINDOW_PROFILE_MS:--1}"
      attempt1_geometry_ms="${TIKPAL_VALIDATE_PROFILE_WINDOW_GEOMETRY_MS:--1}"
      attempt1_pid="${TIKPAL_VALIDATE_PROFILE_WINDOW_PID:-none}"
      attempt1_geometry="${TIKPAL_VALIDATE_PROFILE_WINDOW_GEOMETRY:-not_parsed}"
    fi
    if [[ -z "$result_window" ]]; then
      # A known XID can miss one bounded X11 probe while the device is busy.
      # Retry the same identity-sensitive lookup once before discarding it and
      # entering the more expensive browser-root recovery path.
      retry=1
      sleep 0.05
      if validate_profile_window_fast "$cached_window" "$profile" "$timing_enabled"; then
        attempt2_result=ok
        result_window="$cached_window"
        outcome=cache_hit_retry
      else
        attempt2_result="${TIKPAL_VALIDATE_PROFILE_WINDOW_RESULT:-failed}"
      fi
      if [[ "$timing_enabled" == "1" ]]; then
        attempt2_x11_ms="${TIKPAL_VALIDATE_PROFILE_WINDOW_X11_MS:--1}"
        attempt2_pid_parse_ms="${TIKPAL_VALIDATE_PROFILE_WINDOW_PID_PARSE_MS:--1}"
        attempt2_profile_ms="${TIKPAL_VALIDATE_PROFILE_WINDOW_PROFILE_MS:--1}"
        attempt2_geometry_ms="${TIKPAL_VALIDATE_PROFILE_WINDOW_GEOMETRY_MS:--1}"
        attempt2_pid="${TIKPAL_VALIDATE_PROFILE_WINDOW_PID:-none}"
        attempt2_geometry="${TIKPAL_VALIDATE_PROFILE_WINDOW_GEOMETRY:-not_parsed}"
      fi
      [[ -n "$result_window" ]] || rm -f "$cache_path"
    fi
  fi
  if [[ -z "$result_window" ]]; then
    recovery=1
    [[ "$timing_enabled" != "1" ]] || segment_started_ms="$(now_ms)"
    # Target only Chromium processes for this profile. A provider guard also has
    # the profile in its argv and must never be mistaken for the browser root.
    while IFS= read -r pid; do
      [[ "$pid" =~ ^[0-9]+$ && -r "/proc/$pid/cmdline" ]] || continue
      command_line="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
      profile_command_line_matches "$profile" "$command_line" || continue
      # pgrep also returns every renderer/gpu/utility child because Chromium
      # repeats --user-data-dir on them. Only the untyped browser process is a
      # recovery root; find_window_for_pid walks its descendants itself.
      [[ "$command_line" == *" --type="* ]] && continue
      executable_name="$(basename "$(readlink -f "/proc/$pid/exe" 2>/dev/null || true)")"
      case "$executable_name" in
        chrome|chromium|chromium-browser) ;;
        *) continue ;;
      esac
      window="$(find_window_for_pid "$pid" || true)"
      validate_profile_window_fast "$window" "$profile" || continue
      mkdir -p "$(dirname "$cache_path")"
      printf '%s\n' "$window" > "$cache_path"
      result_window="$window"
      outcome=recovered
      break
    done < <(pgrep -f -- "--user-data-dir=$profile" 2>/dev/null || true)
    [[ "$timing_enabled" != "1" ]] || recovery_ms="$(( $(now_ms) - segment_started_ms ))"
    [[ -n "$result_window" ]] || outcome=not_found
  fi
  if [[ "$timing_enabled" == "1" ]]; then
    total_ms="$(( $(now_ms) - function_started_ms ))"
    record_switch_detail_timing "$timing_enabled" \
      "switch_detail cache role=$timing_role profile=${profile##*/} total_ms=$total_ms cache_path_ms=$cache_path_ms cache_read_ms=$cache_read_ms cache_present=$cache_present outcome=$outcome xid=${result_window:-none} retry=$retry recovery=$recovery recovery_ms=$recovery_ms attempt1_result=$attempt1_result attempt1_x11_ms=$attempt1_x11_ms attempt1_pid_parse_ms=$attempt1_pid_parse_ms attempt1_pid=$attempt1_pid attempt1_profile_ms=$attempt1_profile_ms attempt1_geometry_ms=$attempt1_geometry_ms attempt1_geometry=$attempt1_geometry attempt2_result=$attempt2_result attempt2_x11_ms=$attempt2_x11_ms attempt2_pid_parse_ms=$attempt2_pid_parse_ms attempt2_pid=$attempt2_pid attempt2_profile_ms=$attempt2_profile_ms attempt2_geometry_ms=$attempt2_geometry_ms attempt2_geometry=$attempt2_geometry"
  fi
  if switch_trace_enabled; then
    switch_trace_now_ms trace_finished_ms
    trace_elapsed_ms=$((trace_finished_ms - trace_started_ms))
    record_switch_trace_event "${timing_role}_window_resolved" "$outcome" "" "$trace_elapsed_ms"
  fi
  [[ -n "$result_window" ]] || return 1
  printf '%s\n' "$result_window"
}

profile_window_cache_path() {
  local profile="$1"
  local key
  key="$(printf '%s' "$profile" | cksum | awk '{print $1 "-" $2}')"
  printf '%s\n' "$TIKPAL_WEB_MODE_PROFILE_ROOT/window-$key.id"
}

read_profile_window_cache_raw() {
  local profile="$1"
  local cache_path window
  cache_path="$(profile_window_cache_path "$profile")"
  [[ -r "$cache_path" ]] || return 1
  window="$(cat "$cache_path" 2>/dev/null || true)"
  [[ "$window" =~ ^[1-9][0-9]*$ ]] || return 1
  printf '%s\n' "$window"
}

validate_profile_window() {
  local window="$1"
  local profile="$2"
  local pid geometry width height
  [[ "$window" =~ ^[0-9]+$ ]] || return 1
  pid="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_probe getwindowpid "$window" 2>/dev/null || true)"
  process_tree_uses_profile "$pid" "$profile" || return 1
  geometry="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_probe getwindowgeometry --shell "$window" 2>/dev/null || true)"
  width="$(printf '%s\n' "$geometry" | awk -F= '$1 == "WIDTH" { print $2 }')"
  height="$(printf '%s\n' "$geometry" | awk -F= '$1 == "HEIGHT" { print $2 }')"
  [[ "$width" =~ ^[0-9]+$ && "$height" =~ ^[0-9]+$ ]] || return 1
  [[ "$((width * height))" -gt 100000 ]]
}

wait_for_profile_window() {
  local profile="$1"
  local attempts="${2:-50}"
  local window
  while [[ "$attempts" -gt 0 ]]; do
    window="$(first_window_for_profile "$profile" || true)"
    if [[ -n "$window" ]]; then
      printf '%s\n' "$window"
      return 0
    fi
    sleep 0.1
    attempts=$((attempts - 1))
  done
  return 1
}

profile_window_timeout_attempts() {
  local seconds="${1:-0}"
  [[ "$seconds" =~ ^[0-9]+$ ]] || seconds=0
  if [[ "$seconds" -le 0 ]]; then
    printf '50\n'
    return 0
  fi
  printf '%s\n' "$((seconds * 10))"
}

visible_chromium_windows() {
  {
    DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe search --onlyvisible --class chromium 2>/dev/null || true
    DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe search --onlyvisible --class Chromium-browser 2>/dev/null || true
  } | awk 'NF && !seen[$0]++'
}

profile_has_visible_window() {
  local profile="$1"
  local window pid geometry width height
  [[ -n "$profile" ]] || return 1
  while IFS= read -r window; do
    [[ -n "$window" ]] || continue
    pid="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe getwindowpid "$window" 2>/dev/null || true)"
    process_tree_uses_profile "$pid" "$profile" || continue
    geometry="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe getwindowgeometry --shell "$window" 2>/dev/null || true)"
    width="$(printf '%s\n' "$geometry" | awk -F= '$1 == "WIDTH" { print $2 }')"
    height="$(printf '%s\n' "$geometry" | awk -F= '$1 == "HEIGHT" { print $2 }')"
    [[ "$width" =~ ^[0-9]+$ && "$height" =~ ^[0-9]+$ ]] || continue
    (( width * height > 100000 )) && return 0
  done < <(visible_chromium_windows)
  return 1
}

provider_launch_position() {
  local launch_role="${1:-active}"
  if [[ "$launch_role" == "prewarm" ]]; then
    printf '%s\n' "$TIKPAL_WEB_MODE_STAGE_POSITION"
    return 0
  fi
  printf '%s\n' "$TIKPAL_WEB_MODE_LEFT_POSITION"
}

xdotool_mutation_metadata() {
  local operation="" xids="" requested="" separator="" xid="" x="" y="" width="" height=""
  local -a arguments=("$@")
  local index=0
  while [[ "$index" -lt "${#arguments[@]}" ]]; do
    case "${arguments[$index]}" in
      windowmove)
        index=$((index + 1))
        [[ "${arguments[$index]:-}" != "--sync" ]] || index=$((index + 1))
        xid="${arguments[$index]:-}"
        x="${arguments[$((index + 1))]:-}"
        y="${arguments[$((index + 2))]:-}"
        operation+="${operation:+,}windowmove"
        requested+="${separator}${xid}:position=$x,$y"
        separator=";"
        index=$((index + 3))
        ;;
      windowsize)
        index=$((index + 1))
        [[ "${arguments[$index]:-}" != "--sync" ]] || index=$((index + 1))
        xid="${arguments[$index]:-}"
        width="${arguments[$((index + 1))]:-}"
        height="${arguments[$((index + 2))]:-}"
        operation+="${operation:+,}windowsize"
        requested+="${separator}${xid}:size=${width}x${height}"
        separator=";"
        index=$((index + 3))
        ;;
      windowraise|windowlower|windowactivate|windowfocus|windowclose|windowmap)
        operation+="${operation:+,}${arguments[$index]}"
        xid="${arguments[$((index + 1))]:-}"
        requested+="${separator}${xid}:${arguments[$index]}"
        separator=";"
        index=$((index + 2))
        ;;
      mousemove)
        operation+="${operation:+,}mousemove"
        x="${arguments[$((index + 1))]:-}"
        y="${arguments[$((index + 2))]:-}"
        requested+="${separator}pointer:$x,$y"
        separator=";"
        index=$((index + 3))
        ;;
      *)
        index=$((index + 1))
        continue
        ;;
    esac
    if [[ "$xid" =~ ^[1-9][0-9]*$ && ",$xids," != *",$xid,"* ]]; then
      xids+="${xids:+,}$xid"
    fi
  done
  [[ -n "$operation" ]] || return 1
  TIKPAL_X11_MUTATION_OPERATION="xdotool:$operation"
  TIKPAL_X11_MUTATION_XIDS="$xids"
  TIKPAL_X11_MUTATION_REQUESTED="$requested"
}

xdotool_safe() {
  local timeout_seconds=3
  # Window discovery is repeated throughout a resident reveal. On this X11
  # stack a missing Chromium class can block the query for the whole command
  # timeout, so a stale scan must not keep the foreground switch lock alive.
  if [[ "${1:-}" == "search" ]]; then
    timeout_seconds="${TIKPAL_WEB_MODE_X11_SEARCH_TIMEOUT_SECONDS:-0.35}"
  fi
  if xdotool_mutation_metadata "$@"; then
    x11_mutation_run "$TIKPAL_X11_MUTATION_OPERATION" "$TIKPAL_X11_MUTATION_XIDS" \
      "$TIKPAL_X11_MUTATION_REQUESTED" timeout "$timeout_seconds" xdotool "$@" 2>/dev/null || true
    return 0
  fi
  timeout "$timeout_seconds" xdotool "$@" 2>/dev/null || true
}

xdotool_mutate() {
  xdotool_mutation_metadata "$@" || return 64
  x11_mutation_run "$TIKPAL_X11_MUTATION_OPERATION" "$TIKPAL_X11_MUTATION_XIDS" \
    "$TIKPAL_X11_MUTATION_REQUESTED" timeout 3 xdotool "$@" 2>/dev/null
}

wmctrl_mutation() {
  local operation="$1" window="$2" requested="$3"
  shift 3
  x11_mutation_run "wmctrl:$operation" "$window" "$requested" \
    env DISPLAY="$TIKPAL_KIOSK_DISPLAY" wmctrl "$@"
}

xprop_mutation() {
  local operation="$1" window="$2" requested="$3"
  shift 3
  x11_mutation_run "xprop:$operation" "$window" "$requested" \
    env DISPLAY="$TIKPAL_KIOSK_DISPLAY" xprop "$@"
}

xsetroot_mutation() {
  local requested="$1"
  shift
  x11_mutation_run xsetroot "" "$requested" \
    env DISPLAY="$TIKPAL_KIOSK_DISPLAY" xsetroot "$@"
}

park_pointer_in_side_panel() {
  local panel_x panel_y panel_width panel_height target_x target_y
  command -v xdotool >/dev/null 2>&1 || return 0
  panel_x="$(position_x "$TIKPAL_WEB_MODE_PANEL_POSITION")"
  panel_y="$(position_y "$TIKPAL_WEB_MODE_PANEL_POSITION")"
  panel_width="$(window_width "$TIKPAL_WEB_MODE_PANEL_WINDOW")"
  panel_height="$(window_height "$TIKPAL_WEB_MODE_PANEL_WINDOW")"
  [[ "$panel_x" =~ ^[0-9]+$ && "$panel_y" =~ ^[0-9]+$ && "$panel_width" =~ ^[1-9][0-9]*$ && "$panel_height" =~ ^[1-9][0-9]*$ ]] || return 0
  target_x="$((panel_x + panel_width - 1))"
  target_y="$((panel_y + panel_height - 1))"
  DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe mousemove "$target_x" "$target_y"
}

park_pointer_in_side_panel_async() {
  (
    local started_ms finished_ms
    started_ms="$(now_ms)"
    x11_trace_control_event pointer_park_started 0
    park_pointer_in_side_panel
    finished_ms="$(now_ms)"
    x11_trace_control_event pointer_park_finished 0 "elapsed_ms=$((finished_ms - started_ms))"
  ) </dev/null >/dev/null 2>&1 &
}

commit_visible_provider_state() {
  local provider="$1"
  write_runtime_provider_state "$provider"
  x11_trace_control_event runtime_state_committed 0 "provider=$provider"
  park_pointer_in_side_panel_async
}

all_chromium_windows() {
  {
    DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe search --class chromium
    DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe search --class Chromium-browser
  } | awk 'NF && !seen[$0]++'
}

_CHROMIUM_WINDOW_CACHE=""

cached_chromium_windows() {
  if [[ -z "$_CHROMIUM_WINDOW_CACHE" ]]; then
    _CHROMIUM_WINDOW_CACHE="$(all_chromium_windows)"
  fi
  printf '%s\n' "$_CHROMIUM_WINDOW_CACHE"
}

invalidate_chromium_window_cache() {
  _CHROMIUM_WINDOW_CACHE=""
}

tile_visible_web_mode_windows() {
  local provider_profile="$1"
  local panel_profile="$2"
  local force_raise="${3:-0}"
  local recovery_window_list="${4:-}"
  local did_restack=0
  local window pid title active_window active_provider_window oauth_provider_window preferred_provider_window keep_window provider_window_count provider_entry provider_entry_id provider_entry_profile
  local background_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/background"
  local background_windows=()
  local provider_windows=()
  local visible_windows=()
  command -v xdotool >/dev/null 2>&1 || return 0
  active_window="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe getactivewindow 2>/dev/null || true)"

  if [[ -n "$recovery_window_list" ]]; then
    while IFS= read -r window; do
      [[ -n "$window" ]] && visible_windows+=("$window")
    done < "$recovery_window_list"
  else
    while IFS= read -r window; do
      [[ -n "$window" ]] && visible_windows+=("$window")
    done < <(visible_chromium_windows)
  fi

  for window in "${visible_windows[@]}"; do
    pid="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe getwindowpid "$window" 2>/dev/null || true)"
    title="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe getwindowname "$window" 2>/dev/null || true)"

    if process_tree_uses_profile "$pid" "$panel_profile"; then
      tile_window "$window" "$TIKPAL_WEB_MODE_PANEL_POSITION" "$TIKPAL_WEB_MODE_PANEL_WINDOW"
      mark_window_above "$window"
      if [[ "$force_raise" == "1" || "${TIKPAL_TILE_WINDOW_CHANGED:-0}" == "1" ]]; then
        raise_window_without_focus "$window"
        did_restack=1
      fi
      continue
    fi
    if process_tree_uses_profile "$pid" "$background_profile"; then
      background_windows+=("$window")
      continue
    fi
    if is_ad_window_title "$title"; then
      DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowclose "$window" >/dev/null 2>&1 || true
      continue
    fi
    if process_tree_uses_profile "$pid" "$provider_profile"; then
      tile_window "$window" "$TIKPAL_WEB_MODE_LEFT_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW"
      mark_window_above "$window"
      provider_windows+=("$window")
      [[ "$window" == "$active_window" ]] && active_provider_window="$window"
      if is_oauth_window_title "$title" && { [[ "$window" == "$active_window" ]] || [[ -z "$oauth_provider_window" ]]; }; then
        oauth_provider_window="$window"
      fi
    elif is_enabled "$TIKPAL_WEB_MODE_PROVIDER_POOL" && provider_entry="$(provider_profile_for_pid "$pid" || true)" && [[ -n "$provider_entry" ]]; then
      provider_entry_id="${provider_entry%%$'\t'*}"
      provider_entry_profile="${provider_entry#*$'\t'}"
      if [[ "$provider_entry_profile" == "$provider_profile" ]]; then
        tile_window "$window" "$TIKPAL_WEB_MODE_LEFT_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW"
        mark_window_above "$window"
      else
        tile_window "$window" "$TIKPAL_WEB_MODE_STAGE_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW"
        clear_window_above "$window"
      fi
      if [[ "$provider_entry_profile" == "$provider_profile" ]]; then
        provider_windows+=("$window")
        [[ "$window" == "$active_window" ]] && active_provider_window="$window"
        if is_oauth_window_title "$title" && { [[ "$window" == "$active_window" ]] || [[ -z "$oauth_provider_window" ]]; }; then
          oauth_provider_window="$window"
        fi
      fi
    elif [[ -n "$title" ]] && ! is_tikpal_window_title "$title"; then
      tile_window "$window" "$TIKPAL_WEB_MODE_LEFT_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW"
      mark_window_above "$window"
      provider_windows+=("$window")
      [[ "$window" == "$active_window" ]] && active_provider_window="$window"
      if is_oauth_window_title "$title" && { [[ "$window" == "$active_window" ]] || [[ -z "$oauth_provider_window" ]]; }; then
        oauth_provider_window="$window"
      fi
    fi
  done

  for window in "${background_windows[@]}"; do
    if [[ "${#provider_windows[@]}" -gt 0 ]]; then
      tile_window "$window" "$TIKPAL_WEB_MODE_STAGE_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW"
      clear_window_above "$window"
      DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowlower "$window" >/dev/null 2>&1 || true
    else
      tile_window "$window" "$TIKPAL_WEB_MODE_LEFT_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW"
      mark_window_above "$window"
      if [[ "$force_raise" == "1" || "${TIKPAL_TILE_WINDOW_CHANGED:-0}" == "1" ]]; then
        raise_window_without_focus "$window"
        did_restack=1
      fi
    fi
  done

  # Lower kiosk window behind providers (mirrors background window handling)
  if [[ "${#provider_windows[@]}" -gt 0 ]]; then
    local kiosk_win
    kiosk_win="$(kiosk_browser_window || true)"
    if [[ -n "$kiosk_win" ]]; then
      DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowlower "$kiosk_win" >/dev/null 2>&1 || true
    fi
  fi

  if [[ "${#provider_windows[@]}" -gt 0 && ( "$force_raise" == "1" || "${TIKPAL_TILE_WINDOW_CHANGED:-0}" == "1" ) ]]; then
    preferred_provider_window="${oauth_provider_window:-${active_provider_window:-${provider_windows[0]}}}"
    raise_window_without_focus "$preferred_provider_window"
    did_restack=1
  fi

  [[ "$did_restack" == "1" ]] && raise_onboard
  is_enabled "$TIKPAL_WEB_MODE_PROVIDER_POOL" && return 0
  is_enabled "$TIKPAL_WEB_MODE_SINGLE_PROVIDER_WINDOW" || return 0
  [[ "${#provider_windows[@]}" -gt 1 ]] || return 0

  provider_window_count="${#provider_windows[@]}"
  keep_window="${provider_windows[$((provider_window_count - 1))]}"
  for window in "${provider_windows[@]}"; do
    if [[ "$window" == "$active_window" ]]; then
      keep_window="$window"
      break
    fi
  done
  for window in "${provider_windows[@]}"; do
    [[ "$window" == "$keep_window" ]] && continue
    DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowclose "$window" >/dev/null 2>&1 || true
    did_restack=1
  done
  tile_window "$keep_window" "$TIKPAL_WEB_MODE_LEFT_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW"
  mark_window_above "$keep_window"
  if [[ "$force_raise" == "1" || "$did_restack" == "1" || "${TIKPAL_TILE_WINDOW_CHANGED:-0}" == "1" ]]; then
    raise_window_without_focus "$keep_window"
    raise_onboard
  fi
}

guard_window_list_file() {
  printf '%s\n' "$TIKPAL_WEB_MODE_PROFILE_ROOT/guard-windows.tsv"
}

read_guard_window() {
  local kind="$1"
  local expected_profile="${2:-}"
  local list_path
  list_path="$(guard_window_list_file)"
  [[ -r "$list_path" ]] || return 1
  awk -F '\t' -v kind="$kind" -v profile="$expected_profile" \
    '$1 == kind && (!profile || $2 == profile) && $3 ~ /^[0-9]+$/ { print $3; exit }' "$list_path"
}

write_guard_window_list() {
  local provider_profile="$1"
  local provider_window="${2:-}"
  local panel_profile="$3"
  local panel_window="${4:-}"
  local kiosk_window="" list_path temporary_path registry_generation=missing
  [[ "$provider_window" =~ ^[0-9]+$ && "$panel_window" =~ ^[0-9]+$ ]] || return 1

  if [[ -n "$TIKPAL_CHROMIUM_PROFILE_DIR" ]]; then
    kiosk_window="$(read_guard_window kiosk "$TIKPAL_CHROMIUM_PROFILE_DIR" || true)"
    if [[ -z "$kiosk_window" ]]; then
      kiosk_window="$(kiosk_browser_window || true)"
      validate_profile_window_fast "$kiosk_window" "$TIKPAL_CHROMIUM_PROFILE_DIR" || kiosk_window=""
    fi
  fi

  list_path="$(guard_window_list_file)"
  mkdir -p "$(dirname "$list_path")"
  temporary_path="$list_path.$$.$RANDOM.tmp"
  if [[ -r "$TIKPAL_WEB_MODE_X11_HELPER_GENERATION_PATH" ]]; then
    IFS= read -r registry_generation < "$TIKPAL_WEB_MODE_X11_HELPER_GENERATION_PATH" ||
      registry_generation=unreadable
  fi
  {
    printf 'generation\t%s\t%s\n' "$registry_generation" "$(now_ms)"
    printf 'provider\t%s\t%s\n' "$provider_profile" "$provider_window"
    printf 'panel\t%s\t%s\n' "$panel_profile" "$panel_window"
    if [[ "$kiosk_window" =~ ^[0-9]+$ ]]; then
      printf 'kiosk\t%s\t%s\n' "$TIKPAL_CHROMIUM_PROFILE_DIR" "$kiosk_window"
    fi
  } > "$temporary_path"
  mv -f "$temporary_path" "$list_path"
  x11_trace_control_event guard_registry_published 0 \
    "generation=$registry_generation provider=$provider_window panel=$panel_window" \
    "$provider_window,$panel_window"
}

guard_window_map_state() {
  local window="$1" output
  command -v xwininfo >/dev/null 2>&1 || return 1
  output="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xwininfo -id "$window" 2>/dev/null)" || return 1
  if grep -q 'Map State: IsViewable' <<< "$output"; then
    printf 'viewable\n'
  elif grep -q 'Map State:' <<< "$output"; then
    printf 'not_viewable\n'
  else
    return 1
  fi
}

guard_inspect_windows_shell() {
  local provider_profile="$1" panel_profile="$2" provider_window="$3" panel_window="$4"
  local kiosk_window="${5:-}" probe rows provider_fields panel_fields kiosk_fields
  local provider_pid provider_x provider_y provider_width provider_height provider_map provider_opacity
  local panel_pid panel_x panel_y panel_width panel_height panel_map panel_opacity
  local kiosk_pid kiosk_x kiosk_y kiosk_width kiosk_height kiosk_map=not_viewable
  local provider_opacity_full=false panel_opacity_full=false stack_order
  local -a arguments=(getwindowpid "$provider_window" getwindowgeometry --shell "$provider_window"
    getwindowpid "$panel_window" getwindowgeometry --shell "$panel_window")
  if [[ "$kiosk_window" =~ ^[1-9][0-9]*$ ]]; then
    arguments+=(getwindowpid "$kiosk_window" getwindowgeometry --shell "$kiosk_window")
  fi
  probe="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_probe "${arguments[@]}")" || return 1
  rows="$(awk -F= -v provider="$provider_window" -v panel="$panel_window" -v kiosk="$kiosk_window" '
    /^[0-9]+$/ { pending_pid=$0; next }
    $1=="WINDOW" { window=$2; pid[window]=pending_pid; pending_pid="" }
    $1=="X" { x[window]=$2 }
    $1=="Y" { y[window]=$2 }
    $1=="WIDTH" { width[window]=$2 }
    $1=="HEIGHT" { height[window]=$2 }
    END {
      printf "%s,%s,%s,%s,%s\t%s,%s,%s,%s,%s\t%s,%s,%s,%s,%s\n",
        pid[provider], x[provider], y[provider], width[provider], height[provider],
        pid[panel], x[panel], y[panel], width[panel], height[panel],
        pid[kiosk], x[kiosk], y[kiosk], width[kiosk], height[kiosk]
    }
  ' <<< "$probe")"
  IFS=$'\t' read -r provider_fields panel_fields kiosk_fields <<< "$rows"
  IFS=, read -r provider_pid provider_x provider_y provider_width provider_height <<< "$provider_fields"
  IFS=, read -r panel_pid panel_x panel_y panel_width panel_height <<< "$panel_fields"
  IFS=, read -r kiosk_pid kiosk_x kiosk_y kiosk_width kiosk_height <<< "$kiosk_fields"
  [[ "$provider_width" =~ ^[1-9][0-9]*$ && "$provider_height" =~ ^[1-9][0-9]*$ &&
     "$panel_width" =~ ^[1-9][0-9]*$ && "$panel_height" =~ ^[1-9][0-9]*$ ]] || return 1
  process_tree_uses_profile "$provider_pid" "$provider_profile" || return 1
  process_tree_uses_profile "$panel_pid" "$panel_profile" || return 1
  provider_map="$(guard_window_map_state "$provider_window")" || return 1
  panel_map="$(guard_window_map_state "$panel_window")" || return 1
  provider_opacity="$(window_opacity_value "$provider_window" 2>/dev/null || printf unset)"
  panel_opacity="$(window_opacity_value "$panel_window" 2>/dev/null || printf unset)"
  window_opacity_is_full "$provider_opacity" && provider_opacity_full=true
  window_opacity_is_full "$panel_opacity" && panel_opacity_full=true
  if [[ "$kiosk_window" =~ ^[1-9][0-9]*$ ]]; then
    [[ "$kiosk_width" =~ ^[1-9][0-9]*$ && "$kiosk_height" =~ ^[1-9][0-9]*$ ]] || return 1
    process_tree_uses_profile "$kiosk_pid" "$TIKPAL_CHROMIUM_PROFILE_DIR" || return 1
    kiosk_map="$(guard_window_map_state "$kiosk_window")" || return 1
  fi
  TIKPAL_GUARD_INSPECT_RESPONSE="$(jq -cn \
    --argjson provider "$provider_window" --argjson providerPid "$provider_pid" \
    --arg providerMap "$provider_map" --argjson providerX "$provider_x" --argjson providerY "$provider_y" \
    --argjson providerWidth "$provider_width" --argjson providerHeight "$provider_height" \
    --argjson providerOpacityFull "$provider_opacity_full" \
    --argjson panel "$panel_window" --argjson panelPid "$panel_pid" \
    --arg panelMap "$panel_map" --argjson panelX "$panel_x" --argjson panelY "$panel_y" \
    --argjson panelWidth "$panel_width" --argjson panelHeight "$panel_height" \
    --argjson panelOpacityFull "$panel_opacity_full" \
    --argjson kiosk "${kiosk_window:-0}" --argjson kioskPid "${kiosk_pid:-0}" --arg kioskMap "$kiosk_map" \
    --argjson kioskX "${kiosk_x:-0}" --argjson kioskY "${kiosk_y:-0}" \
    --argjson kioskWidth "${kiosk_width:-1}" --argjson kioskHeight "${kiosk_height:-1}" '
      def surface($role; $xid; $pid; $map; $x; $y; $width; $height; $opacityFull):
        {role:$role, xid:$xid, pid:$pid, profileMatched:true,
         code:(if $map == "viewable" then "OK" else "WINDOW_NOT_VIEWABLE" end),
         mapState:$map, geometry:{x:$x,y:$y,width:$width,height:$height},
         opacity:{full:$opacityFull}};
      {operation:"inspect", surfaces:
        [surface("provider"; $provider; $providerPid; $providerMap; $providerX; $providerY;
          $providerWidth; $providerHeight; $providerOpacityFull),
         surface("panel"; $panel; $panelPid; $panelMap; $panelX; $panelY;
          $panelWidth; $panelHeight; $panelOpacityFull)] +
        (if $kiosk > 0 then
          [surface("kiosk"; $kiosk; $kioskPid; $kioskMap; $kioskX; $kioskY;
            $kioskWidth; $kioskHeight; true)] else [] end)}
    ')" || return 1
  if stack_order="$(guard_root_stack_order "$provider_window" "$panel_window" "$kiosk_window")"; then
    TIKPAL_GUARD_STACK_ORDER="$stack_order"
    TIKPAL_GUARD_STACK_STATE=known
  else
    TIKPAL_GUARD_STACK_ORDER=""
    TIKPAL_GUARD_STACK_STATE=unknown
  fi
}

guard_inspect_windows() {
  local provider_profile="$1"
  local panel_profile="$2"
  local provider_window="$3"
  local panel_window="$4"
  local kiosk_window="${5:-}"
  local generation=0 request_id response="" status=0 stack_order
  local inspect_started_ns inspect_finished_ns inspect_elapsed_ns response_code="unknown"
  local -a arguments=(client inspect)
  request_id="guard-$(x11_helper_new_id)"
  inspect_started_ns="$(x11_monotonic_ns)"
  x11_trace_control_event inspect_started 0 \
    "request_id=$request_id operation=inspect caller_pid=$BASHPID caller_role=window_guard generation=${TIKPAL_WEB_MODE_X11_PROCESS_GENERATION:-0}" \
    "$provider_window,$panel_window${kiosk_window:+,$kiosk_window}"
  if [[ ! -x "$TIKPAL_WEB_MODE_X11_HELPER_BINARY" || ! -S "$TIKPAL_WEB_MODE_X11_HELPER_SOCKET" ]]; then
    if [[ "$TIKPAL_WEB_MODE_X11_HELPER_MODE" != "disabled" ]]; then
      inspect_finished_ns="$(x11_monotonic_ns)"
      inspect_elapsed_ns=$((inspect_finished_ns - inspect_started_ns))
      x11_trace_control_event inspect_failed 69 \
        "request_id=$request_id operation=inspect caller_pid=$BASHPID caller_role=window_guard reason=helper_unavailable total_ns=$inspect_elapsed_ns" \
        "$provider_window,$panel_window${kiosk_window:+,$kiosk_window}"
      return 1
    fi
    if guard_inspect_windows_shell "$provider_profile" "$panel_profile" \
      "$provider_window" "$panel_window" "$kiosk_window"; then
      inspect_finished_ns="$(x11_monotonic_ns)"
      inspect_elapsed_ns=$((inspect_finished_ns - inspect_started_ns))
      x11_trace_control_event inspect_completed 0 \
        "request_id=$request_id operation=inspect_shell caller_pid=$BASHPID caller_role=window_guard total_ns=$inspect_elapsed_ns" \
      "$provider_window,$panel_window${kiosk_window:+,$kiosk_window}"
      return 0
    else
      status=$?
    fi
    inspect_finished_ns="$(x11_monotonic_ns)"
    inspect_elapsed_ns=$((inspect_finished_ns - inspect_started_ns))
    x11_trace_control_event inspect_failed "$status" \
      "request_id=$request_id operation=inspect_shell caller_pid=$BASHPID caller_role=window_guard total_ns=$inspect_elapsed_ns" \
      "$provider_window,$panel_window${kiosk_window:+,$kiosk_window}"
    return 1
  fi
  [[ "${TIKPAL_WEB_MODE_X11_PROCESS_GENERATION:-}" =~ ^[1-9][0-9]*$ ]] &&
    generation="$TIKPAL_WEB_MODE_X11_PROCESS_GENERATION"
  arguments+=(--request-id "$request_id" --generation "$generation"
    --surface provider "$provider_window" "$provider_profile"
    --surface panel "$panel_window" "$panel_profile")
  if [[ "$kiosk_window" =~ ^[1-9][0-9]*$ && -n "$TIKPAL_CHROMIUM_PROFILE_DIR" ]]; then
    arguments+=(--surface kiosk "$kiosk_window" "$TIKPAL_CHROMIUM_PROFILE_DIR")
  fi
  if response="$(
    TIKPAL_X11_HELPER_CALLER_ROLE=window_guard \
    TIKPAL_WEB_MODE_X11_HELPER_SOCKET="$TIKPAL_WEB_MODE_X11_HELPER_SOCKET" \
    TIKPAL_WEB_MODE_X11_HELPER_CONNECT_TIMEOUT_MS="$TIKPAL_WEB_MODE_X11_HELPER_CONNECT_TIMEOUT_MS" \
    TIKPAL_WEB_MODE_X11_HELPER_RESPONSE_TIMEOUT_MS="$TIKPAL_WEB_MODE_X11_HELPER_INSPECT_RESPONSE_TIMEOUT_MS" \
      "$TIKPAL_WEB_MODE_X11_HELPER_BINARY" "${arguments[@]}"
  )"; then
    status=0
  else
    status=$?
  fi
  inspect_finished_ns="$(x11_monotonic_ns)"
  inspect_elapsed_ns=$((inspect_finished_ns - inspect_started_ns))
  response_code="$(jq -r '.code // .errorCode // "unknown"' <<< "$response" 2>/dev/null || printf unknown)"
  if [[ "$status" != "0" && "$status" != "20" ]]; then
    x11_trace_control_event inspect_failed "$status" \
      "request_id=$request_id operation=inspect caller_pid=$BASHPID caller_role=window_guard response_code=$response_code total_ns=$inspect_elapsed_ns response=$response" \
      "$provider_window,$panel_window${kiosk_window:+,$kiosk_window}"
    return 1
  fi
  if ! jq -e '.operation == "inspect" and (.surfaces | type == "array")' \
    <<< "$response" >/dev/null 2>&1; then
    x11_trace_control_event inspect_failed 1 \
      "request_id=$request_id operation=inspect caller_pid=$BASHPID caller_role=window_guard response_code=$response_code total_ns=$inspect_elapsed_ns response=$response" \
      "$provider_window,$panel_window${kiosk_window:+,$kiosk_window}"
    return 1
  fi
  TIKPAL_GUARD_INSPECT_RESPONSE="$response"
  x11_trace_control_event inspect_completed 0 \
    "request_id=$request_id operation=inspect caller_pid=$BASHPID caller_role=window_guard response_code=$response_code client_status=$status total_ns=$inspect_elapsed_ns response=$response" \
    "$provider_window,$panel_window${kiosk_window:+,$kiosk_window}"
  if stack_order="$(guard_root_stack_order "$provider_window" "$panel_window" "$kiosk_window")"; then
    TIKPAL_GUARD_STACK_ORDER="$stack_order"
    TIKPAL_GUARD_STACK_STATE=known
  else
    TIKPAL_GUARD_STACK_ORDER=""
    TIKPAL_GUARD_STACK_STATE=unknown
  fi
}

guard_root_stack_order() {
  local provider_window="$1"
  local panel_window="$2"
  local kiosk_window="${3:-}"
  local provider_hex panel_hex kiosk_hex snapshot
  command -v xwininfo >/dev/null 2>&1 || return 1
  provider_hex="$(printf '0x%x' "$provider_window")"
  panel_hex="$(printf '0x%x' "$panel_window")"
  if [[ "$kiosk_window" =~ ^[1-9][0-9]*$ ]]; then
    kiosk_hex="$(printf '0x%x' "$kiosk_window")"
  fi
  snapshot="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xwininfo -root -children 2>/dev/null)" || return 1
  awk -v provider="$provider_hex" -v panel="$panel_hex" -v kiosk="$kiosk_hex" '
    {
      xid=tolower($1)
      if (xid == tolower(provider)) provider_rank=NR
      if (xid == tolower(panel)) panel_rank=NR
      if (kiosk && xid == tolower(kiosk)) kiosk_rank=NR
    }
    END {
      if (!provider_rank || !panel_rank || (kiosk && !kiosk_rank)) exit 1
      printf "%d\t%d\t%d\n", provider_rank, panel_rank, kiosk_rank
    }
  ' <<< "$snapshot"
}

guard_append_repair() {
  local action="$1" window="$2"
  TIKPAL_GUARD_REPAIR_PLAN+="${TIKPAL_GUARD_REPAIR_PLAN:+$'\n'}$action"$'\t'"$window"
}

guard_inspected_identity_valid() {
  local code="$1" pid="$2" profile_matched="$3" profile="$4"
  if [[ "$code" == "OK" ]]; then
    if [[ "$profile_matched" == "true" ]]; then
      return 0
    fi
    TIKPAL_GUARD_RECOVERY_REQUIRED=true
    return 1
  fi
  if [[ "$code" == "WINDOW_NOT_VIEWABLE" && "$pid" =~ ^[1-9][0-9]*$ ]] &&
     process_tree_uses_profile "$pid" "$profile"; then
    return 0
  fi
  TIKPAL_GUARD_RECOVERY_REQUIRED=true
  return 1
}

guard_plan_repair() {
  local provider_profile="$1"
  local panel_profile="$2"
  local provider_window="$3"
  local panel_window="$4"
  local kiosk_window="${5:-}"
  local rows provider_fields panel_fields kiosk_fields normalized_size
  local provider_code provider_pid provider_profile_matched provider_map
  local provider_x provider_y provider_width provider_height provider_opacity_full
  local panel_code panel_pid panel_profile_matched panel_map
  local panel_x panel_y panel_width panel_height panel_opacity_full
  local kiosk_code kiosk_pid kiosk_profile_matched kiosk_map
  local expected_x expected_y expected_width expected_height
  local provider_rank panel_rank kiosk_rank map_repair=0
  rows="$(jq -r --argjson provider "$provider_window" --argjson panel "$panel_window" \
      --argjson kiosk "${kiosk_window:-0}" '
    def row($x):
      (.surfaces[] | select(.xid == $x)) as $surface |
      [$surface.code, ($surface.pid | tostring), ($surface.profileMatched | tostring),
       $surface.mapState, ($surface.geometry.x // "missing"),
       ($surface.geometry.y // "missing"), ($surface.geometry.width // "missing"),
       ($surface.geometry.height // "missing"), ($surface.opacity.full | tostring)] | @tsv;
    row($provider), row($panel), (if $kiosk > 0 then row($kiosk) else empty end)
  ' <<< "$TIKPAL_GUARD_INSPECT_RESPONSE")" || return 1
  provider_fields="$(sed -n '1p' <<< "$rows")"
  panel_fields="$(sed -n '2p' <<< "$rows")"
  kiosk_fields="$(sed -n '3p' <<< "$rows")"
  IFS=$'\t' read -r provider_code provider_pid provider_profile_matched provider_map \
    provider_x provider_y provider_width provider_height provider_opacity_full <<< "$provider_fields"
  IFS=$'\t' read -r panel_code panel_pid panel_profile_matched panel_map \
    panel_x panel_y panel_width panel_height panel_opacity_full <<< "$panel_fields"
  guard_inspected_identity_valid "$provider_code" "$provider_pid" \
    "$provider_profile_matched" "$provider_profile" || return 1
  guard_inspected_identity_valid "$panel_code" "$panel_pid" \
    "$panel_profile_matched" "$panel_profile" || return 1
  if [[ "$kiosk_window" =~ ^[1-9][0-9]*$ ]]; then
    IFS=$'\t' read -r kiosk_code kiosk_pid kiosk_profile_matched kiosk_map _ <<< "$kiosk_fields"
    guard_inspected_identity_valid "$kiosk_code" "$kiosk_pid" \
      "$kiosk_profile_matched" "$TIKPAL_CHROMIUM_PROFILE_DIR" || return 1
  fi
  [[ "$provider_x" =~ ^-?[0-9]+$ && "$provider_y" =~ ^-?[0-9]+$ &&
     "$provider_width" =~ ^[1-9][0-9]*$ && "$provider_height" =~ ^[1-9][0-9]*$ &&
     "$panel_x" =~ ^-?[0-9]+$ && "$panel_y" =~ ^-?[0-9]+$ &&
     "$panel_width" =~ ^[1-9][0-9]*$ && "$panel_height" =~ ^[1-9][0-9]*$ ]] || return 1

  TIKPAL_GUARD_REPAIR_PLAN=""
  if [[ "$provider_map" != "viewable" ]]; then
    guard_append_repair provider_map "$provider_window"
    map_repair=1
  fi
  expected_x="${TIKPAL_WEB_MODE_LEFT_POSITION%,*}"
  expected_y="${TIKPAL_WEB_MODE_LEFT_POSITION#*,}"
  normalized_size="$(normalize_window_size "$TIKPAL_WEB_MODE_LEFT_WINDOW")"
  expected_width="${normalized_size%,*}"
  expected_height="${normalized_size#*,}"
  if [[ "$provider_x" != "$expected_x" || "$provider_y" != "$expected_y" ||
        "$provider_width" != "$expected_width" || "$provider_height" != "$expected_height" ]]; then
    guard_append_repair provider_geometry "$provider_window"
  fi
  [[ "$provider_opacity_full" == "true" ]] || guard_append_repair provider_opacity "$provider_window"

  if [[ "$panel_map" != "viewable" ]]; then
    guard_append_repair panel_map "$panel_window"
    map_repair=1
  fi
  expected_x="${TIKPAL_WEB_MODE_PANEL_POSITION%,*}"
  expected_y="${TIKPAL_WEB_MODE_PANEL_POSITION#*,}"
  normalized_size="$(normalize_window_size "$TIKPAL_WEB_MODE_PANEL_WINDOW")"
  expected_width="${normalized_size%,*}"
  expected_height="${normalized_size#*,}"
  if [[ "$panel_x" != "$expected_x" || "$panel_y" != "$expected_y" ||
        "$panel_width" != "$expected_width" || "$panel_height" != "$expected_height" ]]; then
    guard_append_repair panel_geometry "$panel_window"
  fi
  [[ "$panel_opacity_full" == "true" ]] || guard_append_repair panel_opacity "$panel_window"

  if [[ "$map_repair" == "0" && "$TIKPAL_GUARD_STACK_STATE" == "known" ]]; then
    IFS=$'\t' read -r provider_rank panel_rank kiosk_rank <<< "$TIKPAL_GUARD_STACK_ORDER"
    [[ "$provider_rank" =~ ^[1-9][0-9]*$ && "$panel_rank" =~ ^[1-9][0-9]*$ ]] || return 1
    if (( panel_rank > provider_rank )); then
      guard_append_repair panel_raise "$panel_window"
    fi
    if [[ "$kiosk_window" =~ ^[1-9][0-9]*$ ]]; then
      [[ "$kiosk_rank" =~ ^[1-9][0-9]*$ ]] || return 1
      if (( provider_rank > kiosk_rank )); then
        guard_append_repair kiosk_lower "$kiosk_window"
      fi
    fi
  fi
  if [[ -n "$TIKPAL_GUARD_REPAIR_PLAN" ]]; then
    TIKPAL_GUARD_REPAIR_REQUIRED=true
  fi
}

guard_apply_repair_plan() {
  local action window
  while IFS=$'\t' read -r action window; do
    [[ -n "$action" && "$window" =~ ^[1-9][0-9]*$ ]] || continue
    case "$action" in
      provider_map|panel_map)
        DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowmap "$window" >/dev/null 2>&1 || true
        ;;
      provider_geometry)
        tile_window_fast "$window" "$TIKPAL_WEB_MODE_LEFT_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW"
        ;;
      panel_geometry)
        tile_window_fast "$window" "$TIKPAL_WEB_MODE_PANEL_POSITION" "$TIKPAL_WEB_MODE_PANEL_WINDOW"
        ;;
      provider_opacity|panel_opacity)
        restore_window_opacity "$window"
        ;;
      panel_raise)
        raise_window_without_focus "$window"
        ;;
      kiosk_lower)
        DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowlower "$window" >/dev/null 2>&1 || true
        ;;
      *) return 1 ;;
    esac
  done <<< "$TIKPAL_GUARD_REPAIR_PLAN"
}

tile_guard_windows_fast() {
  local provider_profile="$1"
  local panel_profile="$2"
  local list_path kind profile window provider_window="" panel_window="" kiosk_window=""
  TIKPAL_GUARD_RECOVERY_REQUIRED="${TIKPAL_GUARD_RECOVERY_REQUIRED:-false}"
  list_path="$(guard_window_list_file)"
  if [[ ! -r "$list_path" ]]; then
    TIKPAL_GUARD_RECOVERY_REQUIRED=true
    return 1
  fi
  while IFS=$'\t' read -r kind profile window; do
    case "$kind" in
      provider)
        if [[ "$profile" != "$provider_profile" ]]; then
          TIKPAL_GUARD_RECOVERY_REQUIRED=true
          return 1
        fi
        provider_window="$window"
        ;;
      panel)
        if [[ "$profile" != "$panel_profile" ]]; then
          TIKPAL_GUARD_RECOVERY_REQUIRED=true
          return 1
        fi
        panel_window="$window"
        ;;
      kiosk)
        [[ "$profile" == "$TIKPAL_CHROMIUM_PROFILE_DIR" ]] || continue
        kiosk_window="$window"
        ;;
    esac
  done < "$list_path"

  if [[ ! "$provider_window" =~ ^[0-9]+$ || ! "$panel_window" =~ ^[0-9]+$ ]]; then
    TIKPAL_GUARD_RECOVERY_REQUIRED=true
    return 1
  fi
  if ! guard_inspect_windows "$provider_profile" "$panel_profile" \
      "$provider_window" "$panel_window" "$kiosk_window"; then
    TIKPAL_GUARD_TICK_OUTCOME=inspect_failed
    return 75
  fi
  if ! guard_plan_repair "$provider_profile" "$panel_profile" \
      "$provider_window" "$panel_window" "$kiosk_window"; then
    [[ "$TIKPAL_GUARD_RECOVERY_REQUIRED" == "true" ]] && return 1
    TIKPAL_GUARD_TICK_OUTCOME=plan_failed
    return 75
  fi
  if ! guard_apply_repair_plan; then
    TIKPAL_GUARD_TICK_OUTCOME=apply_failed
    return 75
  fi
  if [[ "$TIKPAL_GUARD_REPAIR_REQUIRED" == "true" ]]; then
    TIKPAL_GUARD_TICK_OUTCOME=repaired
  elif [[ "$TIKPAL_GUARD_STACK_STATE" == "known" ]]; then
    TIKPAL_GUARD_TICK_OUTCOME=steady
  else
    TIKPAL_GUARD_TICK_OUTCOME=stack_unknown
  fi
}

recover_guard_window_list_locked() {
  local provider_profile="$1"
  local panel_profile="$2"
  local provider_window panel_window recovery_window_list
  [[ "${TIKPAL_WEB_MODE_LOCKED:-0}" == "1" ||
     "${TIKPAL_WEB_MODE_GUARD_LOCKED:-0}" == "1" ]] || return 1
  if ! x11_helper_guard_may_recover_all; then
    record_x11_helper_guard_skip || true
    return 0
  fi
  recovery_window_list="$TIKPAL_WEB_MODE_PROFILE_ROOT/guard-recovery-windows.$$.$RANDOM.tmp"
  if ! visible_chromium_windows > "$recovery_window_list"; then
    rm -f "$recovery_window_list"
    return 1
  fi
  if ! x11_helper_guard_may_recover_all; then
    rm -f "$recovery_window_list"
    record_x11_helper_guard_skip || true
    return 0
  fi
  # This is the explicit recovery path. Normal guard ticks never enumerate the
  # desktop; a failed known XID is required before this full repair is allowed.
  tile_visible_web_mode_windows "$provider_profile" "$panel_profile" 1 "$recovery_window_list"
  rm -f "$recovery_window_list"
  provider_window="$(first_window_for_profile "$provider_profile" || true)"
  panel_window="$(first_window_for_profile "$panel_profile" || true)"
  write_guard_window_list "$provider_profile" "$provider_window" "$panel_profile" "$panel_window"
}

recover_guard_window_list() {
  local provider_profile="$1"
  local panel_profile="$2"
  local lock_path="$TIKPAL_WEB_MODE_PROFILE_ROOT/web-mode.lock"
  local recovery_lock_fd="" result=0
  if [[ "${TIKPAL_WEB_MODE_LOCKED:-0}" == "1" ||
        "${TIKPAL_WEB_MODE_GUARD_LOCKED:-0}" == "1" ]]; then
    recover_guard_window_list_locked "$provider_profile" "$panel_profile"
    return
  fi
  mkdir -p "$TIKPAL_WEB_MODE_PROFILE_ROOT"
  if ! command -v flock >/dev/null 2>&1; then
    [[ "$TIKPAL_WEB_MODE_X11_HELPER_MODE" == "disabled" ]] || return 1
    TIKPAL_WEB_MODE_GUARD_LOCKED=1 \
      recover_guard_window_list_locked "$provider_profile" "$panel_profile"
    return
  fi
  exec {recovery_lock_fd}>"$lock_path"
  if ! flock -x -w "$TIKPAL_WEB_MODE_LOCK_TIMEOUT_SECONDS" "$recovery_lock_fd"; then
    exec {recovery_lock_fd}>&-
    return 0
  fi
  TIKPAL_WEB_MODE_GUARD_LOCKED=1 \
    recover_guard_window_list_locked "$provider_profile" "$panel_profile" || result=$?
  flock -u "$recovery_lock_fd" >/dev/null 2>&1 || true
  exec {recovery_lock_fd}>&-
  return "$result"
}

record_x11_helper_guard_skip() {
  local path="$TIKPAL_WEB_MODE_PROFILE_ROOT/x11-helper-guard-skips"
  local count=0 temporary_path
  if [[ -r "$path" ]]; then
    count="$(cat "$path" 2>/dev/null || true)"
    [[ "$count" =~ ^[0-9]+$ ]] || count=0
  fi
  count=$((count + 1))
  temporary_path="$path.$$.$RANDOM.tmp"
  printf '%s\n' "$count" > "$temporary_path" && mv -f "$temporary_path" "$path"
}

guard_maintain_windows() {
  local provider_profile="$1"
  local panel_profile="$2"
  local lock_path="$TIKPAL_WEB_MODE_PROFILE_ROOT/web-mode.lock"
  local provider_window panel_window kiosk_window result=0 guard_lock_fd="" fast_status=0
  local registry_generation="" current_generation=""
  local TIKPAL_WEB_MODE_GUARD_LOCKED=0
  mkdir -p "$TIKPAL_WEB_MODE_PROFILE_ROOT"
  if command -v flock >/dev/null 2>&1; then
    exec {guard_lock_fd}>"$lock_path"
    if ! flock -x -w "$TIKPAL_WEB_MODE_LOCK_TIMEOUT_SECONDS" "$guard_lock_fd"; then
      exec {guard_lock_fd}>&-
      TIKPAL_GUARD_TICK_OUTCOME=lock_busy
      return 0
    fi
    TIKPAL_WEB_MODE_GUARD_LOCKED=1
  fi
  if x11_helper_switch_enabled; then
    registry_generation="$(x11_trace_read_registry_generation || true)"
    if [[ -r "$TIKPAL_WEB_MODE_X11_HELPER_GENERATION_PATH" ]]; then
      IFS= read -r current_generation < "$TIKPAL_WEB_MODE_X11_HELPER_GENERATION_PATH" ||
        current_generation=unreadable
    fi
    if [[ "$registry_generation" =~ ^[1-9][0-9]*$ &&
          "$registry_generation" != "${TIKPAL_WEB_MODE_X11_PROCESS_GENERATION:-}" ]]; then
      if [[ "$registry_generation" == "$current_generation" ]]; then
        TIKPAL_WEB_MODE_X11_PROCESS_GENERATION="$registry_generation"
        TIKPAL_GUARD_TICK_OUTCOME=generation_refreshed
        x11_trace_control_event guard_generation_refreshed 0 \
          "generation=$registry_generation mutation=skipped"
      else
        TIKPAL_GUARD_TICK_OUTCOME=generation_blocked
        x11_trace_control_event guard_generation_refresh_blocked 76 \
          "registry_generation=$registry_generation current_generation=${current_generation:-missing} mutation=skipped"
      fi
      if [[ -n "${guard_lock_fd:-}" ]]; then
        flock -u "$guard_lock_fd" >/dev/null 2>&1 || true
        exec {guard_lock_fd}>&-
      fi
      return 0
    fi
  fi
  provider_window="$(read_guard_window provider "$provider_profile" || true)"
  panel_window="$(read_guard_window panel "$panel_profile" || true)"
  kiosk_window="$(read_guard_window kiosk "$TIKPAL_CHROMIUM_PROFILE_DIR" || true)"
  if ! x11_helper_guard_may_write "$provider_window" "$panel_window" "$kiosk_window"; then
    record_x11_helper_guard_skip || true
    TIKPAL_GUARD_TICK_OUTCOME=helper_owned
    result=0
  elif tile_guard_windows_fast "$provider_profile" "$panel_profile"; then
    :
  else
    fast_status=$?
    if [[ "${TIKPAL_GUARD_RECOVERY_REQUIRED:-false}" == "true" ]]; then
      log "WARN: Explore guard window identity changed; running explicit recovery"
      TIKPAL_GUARD_REPAIR_REQUIRED=true
      TIKPAL_GUARD_TICK_OUTCOME=registry_recovery
      TIKPAL_WEB_MODE_GUARD_LOCKED=1 \
        recover_guard_window_list "$provider_profile" "$panel_profile" || result=1
    else
      [[ "$TIKPAL_GUARD_TICK_OUTCOME" != "steady" ]] ||
        TIKPAL_GUARD_TICK_OUTCOME="fast_path_failed_$fast_status"
      result=0
    fi
  fi
  if [[ -n "${guard_lock_fd:-}" ]]; then
    flock -u "$guard_lock_fd" >/dev/null 2>&1 || true
    exec {guard_lock_fd}>&-
  fi
  return "$result"
}

guard_run_tick() {
  local provider_profile="$1"
  local panel_profile="$2"
  local status=0
  local TIKPAL_WEB_MODE_GUARD_TICK_ACTIVE=1
  local TIKPAL_GUARD_REPAIR_REQUIRED=false
  local TIKPAL_GUARD_RECOVERY_REQUIRED=false
  local TIKPAL_GUARD_MUTATION_COUNT=0
  local TIKPAL_GUARD_TICK_OUTCOME=steady
  local TIKPAL_GUARD_STACK_STATE=unknown
  local TIKPAL_GUARD_STACK_ORDER=""
  local TIKPAL_GUARD_INSPECT_RESPONSE=""
  local TIKPAL_GUARD_REPAIR_PLAN=""
  if guard_maintain_windows "$provider_profile" "$panel_profile"; then
    status=0
  else
    status=$?
  fi
  x11_trace_control_event guard_tick_completed "$status" \
    "repair_required=$TIKPAL_GUARD_REPAIR_REQUIRED mutation_count=$TIKPAL_GUARD_MUTATION_COUNT outcome=$TIKPAL_GUARD_TICK_OUTCOME stack=$TIKPAL_GUARD_STACK_STATE"
  return "$status"
}

guard_close_web_mode() {
  local lock_path="$TIKPAL_WEB_MODE_PROFILE_ROOT/web-mode.lock"
  local provider_window panel_window guard_close_fd=""
  local TIKPAL_WEB_MODE_GUARD_LOCKED=0
  mkdir -p "$TIKPAL_WEB_MODE_PROFILE_ROOT"
  if command -v flock >/dev/null 2>&1; then
    exec {guard_close_fd}>"$lock_path"
    if ! flock -x -w "$TIKPAL_WEB_MODE_LOCK_TIMEOUT_SECONDS" "$guard_close_fd"; then
      exec {guard_close_fd}>&-
      return 0
    fi
    TIKPAL_WEB_MODE_GUARD_LOCKED=1
  fi
  provider_window="$(read_guard_window provider || true)"
  panel_window="$(read_guard_window panel || true)"
  if x11_helper_guard_may_write "$provider_window" "$panel_window"; then
    close_web_mode_from_guard
  else
    record_x11_helper_guard_skip || true
  fi
  if [[ -n "${guard_close_fd:-}" ]]; then
    flock -u "$guard_close_fd" >/dev/null 2>&1 || true
    exec {guard_close_fd}>&-
  fi
}

start_window_guard() {
  is_enabled "$TIKPAL_WEB_MODE_WINDOW_GUARD" || return 0
  command -v xdotool >/dev/null 2>&1 || return 0

  local provider_profile="$1"
  local panel_profile="$2"
  local provider_window="${3:-}"
  local panel_window="${4:-}"
  [[ -n "$provider_profile" ]] || is_enabled "$TIKPAL_WEB_MODE_PROVIDER_POOL" || return 0

  mkdir -p "$TIKPAL_WEB_MODE_PROFILE_ROOT"
  if [[ -z "$provider_window" ]]; then
    provider_window="$(first_window_for_profile "$provider_profile" || true)"
  fi
  if [[ -z "$panel_window" ]]; then
    panel_window="$(first_window_for_profile "$panel_profile" || true)"
  fi
  if ! write_guard_window_list "$provider_profile" "$provider_window" "$panel_profile" "$panel_window"; then
    log "WARN: rebuilding Explore guard window list"
    recover_guard_window_list "$provider_profile" "$panel_profile" || return 1
  fi
  window_guard_ensure_process "$provider_profile" "$panel_profile"
}

reload_window_guard() {
  local provider_profile="$1" panel_profile="$2"
  local lock_path lifecycle_fd="" old_guard="" old_starttime=""
  local new_guard="" new_starttime="" attempt
  command -v flock >/dev/null 2>&1 || return 78
  lock_path="$(window_guard_lifecycle_lock_file)"
  mkdir -p "$(dirname "$lock_path")"
  exec {lifecycle_fd}>"$lock_path"
  if ! flock -x -w "$TIKPAL_WEB_MODE_LOCK_TIMEOUT_SECONDS" "$lifecycle_fd"; then
    exec {lifecycle_fd}>&-
    return 75
  fi
  window_guard_collect_matching_pids
  if [[ "${#TIKPAL_WINDOW_GUARD_MATCHING_PIDS[@]}" -gt 1 ]]; then
    log "ERROR: refusing to reload multiple Explore window guards: ${TIKPAL_WINDOW_GUARD_MATCHING_PIDS[*]}"
    flock -u "$lifecycle_fd" >/dev/null 2>&1 || true
    exec {lifecycle_fd}>&-
    return 72
  fi
  if [[ "${#TIKPAL_WINDOW_GUARD_MATCHING_PIDS[@]}" == 1 ]]; then
    old_guard="${TIKPAL_WINDOW_GUARD_MATCHING_PIDS[0]}"
    old_starttime="$(window_guard_process_starttime "$old_guard" || true)"
    [[ -n "$old_starttime" ]] || {
      flock -u "$lifecycle_fd" >/dev/null 2>&1 || true
      exec {lifecycle_fd}>&-
      return 73
    }
    window_guard_write_pid_file "$old_guard" || {
      flock -u "$lifecycle_fd" >/dev/null 2>&1 || true
      exec {lifecycle_fd}>&-
      return 1
    }
    if ! window_guard_terminate_process "$old_guard" "$old_starttime" ||
       window_guard_process_matches "$old_guard" "$old_starttime"; then
      log "ERROR: Explore window guard $old_guard did not exit; refusing to launch a replacement"
      flock -u "$lifecycle_fd" >/dev/null 2>&1 || true
      exec {lifecycle_fd}>&-
      return 73
    fi
    window_guard_remove_pid_file_if_owned "$old_guard" "$old_starttime" || true
  fi
  new_guard="$(TIKPAL_WINDOW_GUARD_LIFECYCLE_FD="$lifecycle_fd" \
    window_guard_launch_process "$provider_profile" "$panel_profile")"
  if [[ ! "$new_guard" =~ ^[1-9][0-9]*$ ]]; then
    log "ERROR: Explore window guard replacement did not return a valid PID"
    flock -u "$lifecycle_fd" >/dev/null 2>&1 || true
    exec {lifecycle_fd}>&-
    return 1
  fi
  for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    new_starttime="$(window_guard_process_starttime "$new_guard" || true)"
    if [[ -n "$new_starttime" ]] && window_guard_process_matches "$new_guard" "$new_starttime"; then
      break
    fi
    new_starttime=""
    sleep 0.02
  done
  window_guard_collect_matching_pids
  if [[ "${#TIKPAL_WINDOW_GUARD_MATCHING_PIDS[@]}" != 1 ||
        "${TIKPAL_WINDOW_GUARD_MATCHING_PIDS[0]:-}" != "$new_guard" ]] ||
     ! window_guard_process_matches "$new_guard" "$new_starttime"; then
    log "ERROR: Explore window guard replacement identity could not be proven for PID $new_guard"
    flock -u "$lifecycle_fd" >/dev/null 2>&1 || true
    exec {lifecycle_fd}>&-
    return 73
  fi
  if ! window_guard_write_pid_file "$new_guard" "$new_starttime"; then
    log "ERROR: Explore window guard replacement identity changed before PID publication"
    flock -u "$lifecycle_fd" >/dev/null 2>&1 || true
    exec {lifecycle_fd}>&-
    return 73
  fi
  TIKPAL_WINDOW_GUARD_CREATED_PID="$new_guard"
  log_stage "window_guard_reloaded old_pid=${old_guard:-missing} new_pid=$new_guard"
  flock -u "$lifecycle_fd" >/dev/null 2>&1 || true
  exec {lifecycle_fd}>&-
}

stop_window_guard_owned() {
  local created_pid="$1" created_starttime="$2" lock_path lifecycle_fd=""
  local status=0 pid unknown_found=0
  [[ "$created_pid" =~ ^[1-9][0-9]*$ && -n "$created_starttime" ]] || return 64
  command -v flock >/dev/null 2>&1 || return 78
  lock_path="$(window_guard_lifecycle_lock_file)"
  mkdir -p "$(dirname "$lock_path")"
  exec {lifecycle_fd}>"$lock_path"
  if ! flock -x -w "$TIKPAL_WEB_MODE_LOCK_TIMEOUT_SECONDS" "$lifecycle_fd"; then
    exec {lifecycle_fd}>&-
    return 75
  fi
  window_guard_collect_matching_pids
  for pid in "${TIKPAL_WINDOW_GUARD_MATCHING_PIDS[@]}"; do
    if [[ "$pid" != "$created_pid" ]] ||
       ! window_guard_process_matches "$pid" "$created_starttime"; then
      unknown_found=1
    fi
  done
  if window_guard_process_matches "$created_pid" "$created_starttime"; then
    window_guard_terminate_process "$created_pid" "$created_starttime" || status=73
    [[ "$status" != 0 ]] ||
      window_guard_remove_pid_file_if_owned "$created_pid" "$created_starttime" || true
  else
    window_guard_remove_pid_file_if_owned "$created_pid" "$created_starttime" || true
  fi
  window_guard_collect_matching_pids
  if [[ "$unknown_found" == 1 || "${#TIKPAL_WINDOW_GUARD_MATCHING_PIDS[@]}" -gt 1 ]]; then
    status=72
  fi
  flock -u "$lifecycle_fd" >/dev/null 2>&1 || true
  exec {lifecycle_fd}>&-
  return "$status"
}

window_guard_cleanup_pid_on_exit() {
  local pid="${BASHPID:-$$}" starttime lock_path lifecycle_fd=""
  command -v flock >/dev/null 2>&1 || return 0
  lock_path="$(window_guard_lifecycle_lock_file)"
  starttime="$(window_guard_process_starttime "$pid" || true)"
  [[ -n "$starttime" ]] || return 0
  mkdir -p "$(dirname "$lock_path")"
  exec {lifecycle_fd}>"$lock_path"
  # A stop/reload controller holds this lock while it waits for the Guard to
  # exit and removes the owned PID file itself. Do not make the EXIT trap wait
  # on that controller; spontaneous exits can still claim the lock and clean up.
  if flock -x -w 0 "$lifecycle_fd"; then
    window_guard_remove_pid_file_if_owned "$pid" "$starttime" || true
    flock -u "$lifecycle_fd" >/dev/null 2>&1 || true
  fi
  exec {lifecycle_fd}>&-
}

run_window_guard() {
  local provider_profile="$1"
  local panel_profile="$2"
  local fast_ticks_remaining=4
  local active_provider active_profile guard_pid guard_starttime
  [[ -n "$provider_profile" ]] || is_enabled "$TIKPAL_WEB_MODE_PROVIDER_POOL" || return 0
  guard_pid="${BASHPID:-$$}"
  guard_starttime="$(window_guard_process_starttime "$guard_pid" || true)"
  x11_trace_control_event guard_started 0 \
    "pid=$guard_pid provider_profile=$provider_profile panel_profile=$panel_profile"

  if is_enabled "$TIKPAL_WEB_MODE_PROVIDER_POOL"; then
    while true; do
      active_provider="$(read_runtime_active_provider)"
      if [[ -z "$active_provider" ]]; then
        # Guard was told to stop (PID file removed) — exit without parking
        if ! window_guard_pid_record_matches "$guard_pid" "$guard_starttime"; then
          return 0
        fi
        guard_close_web_mode
        return 0
      fi
      # A foreground resident switch has already captured the current Guard
      # window list.  Keep this one process alive, but do not let an in-flight
      # tick raise the old provider between the switch marker and the atomic
      # registry handoff to the newly visible provider.
      if provider_switch_in_progress; then
        sleep 0.05
        continue
      fi
      active_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$active_provider"
      if ! guard_run_tick "$active_profile" "$panel_profile"; then
        {
          profile_process_exists "$active_profile" || return 0
          fast_ticks_remaining=4
          sleep 0.25
          continue
        }
        fast_ticks_remaining=4
      fi
      provider_profile="$active_profile"
      if [[ "$fast_ticks_remaining" -gt 0 ]]; then
        fast_ticks_remaining=$((fast_ticks_remaining - 1))
        sleep 0.25
      else
        sleep 1
      fi
    done
    return 0
  fi

  while true; do
    if ! guard_run_tick "$provider_profile" "$panel_profile"; then
      {
        profile_process_exists "$provider_profile" || return 0
        fast_ticks_remaining=4
        sleep 0.25
        continue
      }
      fast_ticks_remaining=4
    fi
    if [[ "$fast_ticks_remaining" -gt 0 ]]; then
      fast_ticks_remaining=$((fast_ticks_remaining - 1))
      sleep 0.25
    else
      sleep 1
    fi
  done
}

provider_guard_process_identity_matches() {
  local pid="$1"
  local provider="$2"
  local provider_profile="$3"
  local proxy_enabled="$4"
  local provider_port="$5"
  local proc_root="${TIKPAL_WEB_MODE_PROC_ROOT:-/proc}"
  local proc_path="$proc_root/$pid"
  local helper="$SCRIPT_DIR/tikpal-web-mode-guard.mjs"
  local proxy_mode="direct" argument environment_entry
  local helper_matched=0 provider_matched=0 profile_matched=0 port_matched=0 proxy_matched=0
  [[ "$proxy_enabled" == "1" ]] && proxy_mode="proxy"
  [[ "$pid" =~ ^[1-9][0-9]*$ && -r "$proc_path/cmdline" && -r "$proc_path/environ" ]] || return 1
  kill -0 "$pid" >/dev/null 2>&1 || return 1
  while IFS= read -r -d '' argument; do
    [[ "$argument" == "$helper" ]] && helper_matched=1
  done 2>/dev/null < "$proc_path/cmdline" || return 1
  [[ "$helper_matched" == "1" ]] || return 1
  while IFS= read -r -d '' environment_entry; do
    case "$environment_entry" in
      "TIKPAL_WEB_MODE_PROVIDER_ID=$provider") provider_matched=1 ;;
      "TIKPAL_WEB_MODE_PROVIDER_PROFILE=$provider_profile") profile_matched=1 ;;
      "TIKPAL_WEB_MODE_PROVIDER_DEBUG_PORT=$provider_port") port_matched=1 ;;
      "TIKPAL_WEB_MODE_PROXY_MODE=$proxy_mode") proxy_matched=1 ;;
    esac
  done 2>/dev/null < "$proc_path/environ" || return 1
  [[ "$provider_matched" == "1" && "$profile_matched" == "1" &&
     "$port_matched" == "1" && "$proxy_matched" == "1" ]]
}

provider_guard_matching_pids() {
  local provider="$1"
  local provider_profile="$2"
  local proxy_enabled="$3"
  local provider_port="$4"
  local proc_root="${TIKPAL_WEB_MODE_PROC_ROOT:-/proc}" proc_path pid
  for proc_path in "$proc_root"/[1-9]*; do
    [[ -d "$proc_path" ]] || continue
    pid="${proc_path##*/}"
    provider_guard_process_identity_matches \
      "$pid" "$provider" "$provider_profile" "$proxy_enabled" "$provider_port" &&
      printf '%s\n' "$pid"
  done
}

stop_provider_guard_instances() {
  local provider="$1"
  local provider_profile="$2"
  local proxy_enabled="$3"
  local provider_port="$4"
  local pid_file pid
  local pids=()
  pid_file="$(provider_guard_pid_file "$provider")"
  while IFS= read -r pid; do
    [[ "$pid" =~ ^[1-9][0-9]*$ ]] || continue
    kill -TERM "$pid" >/dev/null 2>&1 || true
    pids+=("$pid")
  done < <(provider_guard_matching_pids "$provider" "$provider_profile" "$proxy_enabled" "$provider_port")
  rm -f "$pid_file"
  [[ "${#pids[@]}" -gt 0 ]] || return 0
  sleep 0.2
  for pid in "${pids[@]}"; do
    if provider_guard_process_identity_matches \
      "$pid" "$provider" "$provider_profile" "$proxy_enabled" "$provider_port"; then
      kill -KILL "$pid" >/dev/null 2>&1 || true
    fi
  done
}

start_provider_guard() {
  local provider="$1"
  local provider_profile="$2"
  local provider_url_value="$3"
  local proxy_enabled="$4"
  local provider_port="${5:-$TIKPAL_WEB_MODE_PROVIDER_DEBUG_PORT}"
  local helper="$SCRIPT_DIR/tikpal-web-mode-guard.mjs"
  local proxy_mode="direct"
  is_enabled "$TIKPAL_WEB_MODE_PROVIDER_GUARD" || return 0
  [[ -f "$helper" ]] || {
    log "WARN: Explore provider guard missing: $helper"
    return 0
  }
  command -v node >/dev/null 2>&1 || {
    log "WARN: node not found; Explore provider guard disabled"
    return 0
  }
  [[ "$proxy_enabled" == "1" ]] && proxy_mode="proxy"

  if is_enabled "$TIKPAL_WEB_MODE_PROVIDER_POOL"; then
    stop_provider_guard_instances "$provider" "$provider_profile" "$proxy_enabled" "$provider_port"
  else
    stop_provider_guard
  fi
  mkdir -p "$TIKPAL_WEB_MODE_PROFILE_ROOT"
  TIKPAL_WEB_MODE_PROVIDER_ID="$provider" \
  TIKPAL_WEB_MODE_PROVIDER_LABEL="$(provider_label "$provider")" \
  TIKPAL_WEB_MODE_PROVIDER_PROFILE="$provider_profile" \
  TIKPAL_WEB_MODE_PROVIDER_URL="$provider_url_value" \
  TIKPAL_WEB_MODE_STATE_PATH="$TIKPAL_WEB_MODE_STATE_PATH" \
  TIKPAL_WEB_MODE_PROXY_MODE="$proxy_mode" \
  TIKPAL_WEB_MODE_ERROR_PAGE_URL="$TIKPAL_WEB_MODE_ERROR_PAGE_URL" \
  TIKPAL_WEB_MODE_PROVIDER_DEBUG_PORT="$provider_port" \
  TIKPAL_WEB_MODE_QQ_AUTO_CONFIRM="$TIKPAL_WEB_MODE_QQ_AUTO_CONFIRM" \
  TIKPAL_WEB_MODE_QQ_AUDIO_PRIME="$TIKPAL_WEB_MODE_QQ_AUDIO_PRIME" \
  TIKPAL_WEB_MODE_QQ_MUSIC_AUTO_PLAY="$TIKPAL_WEB_MODE_QQ_MUSIC_AUTO_PLAY" \
  TIKPAL_WEB_MODE_QQ_MV_AUTO_FULLSCREEN="$TIKPAL_WEB_MODE_QQ_MV_AUTO_FULLSCREEN" \
  TIKPAL_WEB_MODE_QQ_MV_CINEMA_MODE="$TIKPAL_WEB_MODE_QQ_MV_CINEMA_MODE" \
  TIKPAL_WEB_MODE_QQ_MV_AUTO_PLAY="$TIKPAL_WEB_MODE_QQ_MV_AUTO_PLAY" \
  TIKPAL_WEB_MODE_NETEASE_AUTO_PLAY="$TIKPAL_WEB_MODE_NETEASE_AUTO_PLAY" \
  TIKPAL_WEB_MODE_ONBOARD_AUTO_FOCUS="$TIKPAL_WEB_MODE_ONBOARD_AUTO_FOCUS" \
  TIKPAL_WEB_MODE_PROVIDER_GUARD_IDLE_POLL_MS="$TIKPAL_WEB_MODE_PROVIDER_GUARD_IDLE_POLL_MS" \
  TIKPAL_KIOSK_DISPLAY="$TIKPAL_KIOSK_DISPLAY" \
    node --experimental-websocket "$helper" >/dev/null 2>&1 7>&- 9>&- &
  if is_enabled "$TIKPAL_WEB_MODE_PROVIDER_POOL"; then
    printf '%s\n' "$!" > "$(provider_guard_pid_file "$provider")"
  else
    printf '%s\n' "$!" > "$(provider_guard_pid_file)"
  fi
}

provider_guard_process_matches() {
  local provider="$1"
  local provider_profile="$2"
  local proxy_enabled="$3"
  local provider_port="$4"
  local pid_file pid
  pid_file="$(provider_guard_pid_file "$provider")"
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  provider_guard_process_identity_matches \
    "$pid" "$provider" "$provider_profile" "$proxy_enabled" "$provider_port"
}

ensure_provider_guard() {
  local provider="$1"
  local provider_profile="$2"
  local provider_url_value="$3"
  local proxy_enabled="$4"
  local provider_port="$5"
  local pid
  if provider_guard_process_matches "$provider" "$provider_profile" "$proxy_enabled" "$provider_port"; then
    pid="$(cat "$(provider_guard_pid_file "$provider")" 2>/dev/null || true)"
    log_stage "provider_guard_reused provider=$provider pid=$pid"
    return 0
  fi
  start_provider_guard "$provider" "$provider_profile" "$provider_url_value" "$proxy_enabled" "$provider_port"
}

refresh_provider_pool_guards() {
  local provider provider_profile provider_port proxy_line proxy_enabled
  is_enabled "$TIKPAL_WEB_MODE_PROVIDER_POOL" || return 0
  proxy_line="$(read_proxy_settings)"
  while IFS= read -r provider; do
    [[ -n "$provider" ]] || continue
    provider_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$provider"
    profile_process_exists "$provider_profile" || continue
    provider_port="$(provider_debug_port "$provider")"
    proxy_enabled="$(effective_provider_proxy_enabled "$provider" "${proxy_line%%$'\t'*}")"
    start_provider_guard "$provider" "$provider_profile" "$(provider_url "$provider")" "$proxy_enabled" "$provider_port"
  done < <(provider_ids)
  log "refreshed provider guards"
}

close_legacy_exit_stage() {
  # Older builds could leave this full-screen Chromium profile above the room.
  # It is cleanup-only now: closing Explore must never create or raise it.
  pkill -f -- "--user-data-dir=$TIKPAL_WEB_MODE_PROFILE_ROOT/exit-stage" >/dev/null 2>&1 || true
}

fade_profile_window_for_provider_switch() {
  local profile="$1"
  local window="${2:-}"
  local duration step opacity
  if [[ -z "$window" ]]; then
    window="$(first_window_for_profile "$profile" || true)"
  fi
  [[ -n "$window" ]] || return 0
  duration="$TIKPAL_WEB_MODE_PROVIDER_SWITCH_FADE_SECONDS"
  [[ "$duration" =~ ^[0-9]+([.][0-9]+)?$ ]] || duration=0.10
  [[ "$duration" != "0" ]] || return 0
  step="$(awk -v duration="$duration" 'BEGIN { printf "%.3f", duration / 3 }')"

  # A stale opacity from an interrupted switch must not carry into this one.
  restore_window_opacity "$window"
  for opacity in 0.70 0.30 0.04; do
    set_window_opacity "$window" "$opacity" >/dev/null 2>&1 || {
      sleep "$duration"
      return 0
    }
    sleep "$step"
  done
}

begin_provider_switch_transition() {
  local current_profile="$1"
  local provider="$2"
  local current_window="${3:-}"
  local started_ms
  started_ms="$(now_ms)"
  TIKPAL_WEB_MODE_TRANSITION_SHOWN_MS=0

  if [[ -z "$current_window" ]]; then
    invalidate_chromium_window_cache
    current_window="$(first_window_for_profile "$current_profile" || true)"
  fi
  if [[ -n "$current_window" ]]; then
    fade_profile_window_for_provider_switch "$current_profile" "$current_window"
    TIKPAL_WEB_MODE_TRANSITION_SHOWN_MS="$(now_ms)"
    log_stage "transition_fade provider=$provider ms=$(( TIKPAL_WEB_MODE_TRANSITION_SHOWN_MS - started_ms ))"
  else
    log_stage "transition_skip provider=$provider reason=no-current-window ms=$(( $(now_ms) - started_ms ))"
  fi
  return 0
}

recover_or_cover_provider_failure() {
  local current_provider="${1:-}"
  local current_profile="${2:-}"
  local failed_provider="${3:-}"
  local status="${4:-check_setup}"
  local message="${5:-}"
  local current_window failed_profile proxy_line proxy_enabled
  proxy_line="$(read_proxy_settings)"
  proxy_enabled="$(effective_provider_proxy_enabled "$current_provider" "${proxy_line%%$'\t'*}")"

  # A failed target can still finish its extension navigation after the API has
  # restored the previous provider. Keep that stale target and its guard off
  # the left surface so runtime state and the visible page cannot diverge.
  if [[ -n "$failed_provider" && "$failed_provider" != "$current_provider" ]]; then
    failed_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$failed_provider"
    stop_provider_guard "$failed_provider"
    park_profile_windows_for_reopen "$failed_profile" "$TIKPAL_WEB_MODE_LEFT_WINDOW" || true
  fi
  clear_provider_switch_guard

  if [[ -n "$current_provider" && "$current_provider" != "$failed_provider" && -n "$current_profile" ]] \
    && profile_process_exists "$current_profile"; then
    current_window="$(wait_for_profile_window "$current_profile" 8 || true)"
    if [[ -n "$current_window" ]]; then
      write_runtime_provider_state "$current_provider"
      [[ -n "$failed_provider" ]] && write_runtime_provider_status "$failed_provider" "$status" "$message"
      tile_visible_web_mode_windows "$current_profile" "$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel" 1
      tile_window "$current_window" "$TIKPAL_WEB_MODE_LEFT_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW"
      restore_window_opacity "$current_window"
      raise_window "$current_window"
      start_provider_guard "$current_provider" "$current_profile" "$(provider_url "$current_provider")" "$proxy_enabled" "$(provider_debug_port "$current_provider")"
      start_window_guard "$current_profile" "$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel"
      return 0
    fi
  fi

  write_runtime_provider_state ""
  [[ -n "$failed_provider" ]] && write_runtime_provider_status "$failed_provider" "$status" "$message"
  close_web_mode
  return 1
}

launch_side_panel() {
  local opening_provider="${1:-}"
  local hidden="${2:-0}"
  local panel_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel"
  local panel_url="$TIKPAL_WEB_MODE_SIDE_PANEL_URL"
  local panel_position="$TIKPAL_WEB_MODE_PANEL_POSITION"
  local window
  [[ -n "$opening_provider" ]] && panel_url="$panel_url?opening=$opening_provider"
  [[ "$hidden" == "1" ]] && panel_position="$TIKPAL_WEB_MODE_STAGE_POSITION"
  mkdir -p "$panel_profile"
  ensure_chromium_profile_prefs "$panel_profile"
  cleanup_stale_profile_singletons "$panel_profile"
  mapfile -t flags < <(read_flags)
  mapfile -t base_args < <(chromium_base_args)
  DISPLAY="$TIKPAL_KIOSK_DISPLAY" "$TIKPAL_CHROMIUM_BIN" \
    "${flags[@]}" \
    "${base_args[@]}" \
    "--app=$panel_url" \
    "--user-data-dir=$panel_profile" \
    "--window-position=$panel_position" \
    "--window-size=$(normalize_window_size "$TIKPAL_WEB_MODE_PANEL_WINDOW")" \
    >/dev/null 2>&1 9>&- &
  window="$(wait_for_profile_window "$panel_profile" 20 || true)"
  if [[ -n "$window" ]]; then
    tile_window "$window" "$panel_position" "$TIKPAL_WEB_MODE_PANEL_WINDOW"
    [[ "$hidden" == "1" ]] || raise_window "$window"
    return 0
  fi
  return 1
}

ensure_side_panel() {
  local opening_provider="${1:-}"
  local hidden="${2:-0}"
  local panel_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel"
  local panel_window
  # Clear stale cache to prevent window ID reuse from hiding a missing panel.
  rm -f "$(profile_window_cache_path "$panel_profile")" 2>/dev/null || true
  panel_window="$(first_window_for_profile "$panel_profile" || true)"
  # Double-check with full validation — fast check may match a reused window ID.
  if [[ -n "$panel_window" ]] && ! validate_profile_window "$panel_window" "$panel_profile"; then
    rm -f "$(profile_window_cache_path "$panel_profile")" 2>/dev/null || true
    panel_window=""
  fi
  if [[ "$hidden" == "1" ]]; then
    if [[ -n "$panel_window" ]]; then
      tile_window_fast "$panel_window" "$TIKPAL_WEB_MODE_STAGE_POSITION" "$TIKPAL_WEB_MODE_PANEL_WINDOW"
      clear_window_above "$panel_window"
      return 0
    fi
    close_side_panel
    launch_side_panel "$opening_provider" 1 >/dev/null 2>&1 9>&- &
    return 0
  fi
  if [[ -n "$panel_window" ]]; then
    # Re-tile to final position — the panel may have been staged off-screen
    # by a previous hidden-mode launch (prewarm, prepare-entry).
    tile_window_fast "$panel_window" "$TIKPAL_WEB_MODE_PANEL_POSITION" "$TIKPAL_WEB_MODE_PANEL_WINDOW"
    return 0
  fi
  if side_panel_window_visible "$panel_profile"; then
    return 0
  fi
  close_side_panel
  launch_side_panel "$opening_provider" >/dev/null 2>&1 9>&- &
  return 0
}

keep_side_panel_visible_during_switch() {
  local opening_provider="${1:-}"
  local known_window="${2:-}"
  local timing_enabled="${3:-0}"
  local panel_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel"
  local panel_window="$known_window"
  local started_ms=0 segment_started_ms=0 geometry_read_ms=-1 mutation_ms=-1 total_ms=-1 before_geometry=not_read
  local expected_geometry="${TIKPAL_WEB_MODE_PANEL_POSITION}_${TIKPAL_WEB_MODE_PANEL_WINDOW}" panel_mutation=not_run

  [[ "$timing_enabled" != "1" ]] || started_ms="$(now_ms)"

  if [[ "$panel_window" =~ ^[0-9]+$ ]]; then
    [[ "$timing_enabled" != "1" ]] || segment_started_ms="$(now_ms)"
    before_geometry="$(window_geometry_compact "$panel_window" || printf unreadable)"
    if [[ "$timing_enabled" == "1" ]]; then
      geometry_read_ms="$(( $(now_ms) - segment_started_ms ))"
    fi
    if [[ "$before_geometry" == "$expected_geometry" ]]; then
      mutation_ms=0
      panel_mutation=skipped
    else
      if [[ "$timing_enabled" == "1" ]]; then
        segment_started_ms="$(now_ms)"
      fi
      tile_window_fast "$panel_window" "$TIKPAL_WEB_MODE_PANEL_POSITION" "$TIKPAL_WEB_MODE_PANEL_WINDOW"
      if [[ "$timing_enabled" == "1" ]]; then
        mutation_ms="$(( $(now_ms) - segment_started_ms ))"
      fi
      panel_mutation=applied
    fi
    if [[ "$timing_enabled" == "1" ]]; then
      total_ms="$(( $(now_ms) - started_ms ))"
      record_switch_detail_timing "$timing_enabled" \
        "switch_detail panel known=1 xid=$panel_window before=$before_geometry geometry_read_ms=$geometry_read_ms mutation_ms=$mutation_ms mutation=$panel_mutation total_ms=$total_ms"
    fi
    printf '%s\n' "$panel_window"
    return 0
  fi
  if [[ -z "$panel_window" ]]; then
    panel_window="$(first_window_for_profile "$panel_profile" || true)"
  fi
  if [[ -z "$panel_window" ]]; then
    ensure_side_panel "$opening_provider" 0 || return 1
    panel_window="$(wait_for_profile_window "$panel_profile" 8 || true)"
  fi
  [[ -n "$panel_window" ]] || return 1

  restore_window_opacity "$panel_window"
  tile_window_fast "$panel_window" "$TIKPAL_WEB_MODE_PANEL_POSITION" "$TIKPAL_WEB_MODE_PANEL_WINDOW"
  panel_mutation=recovery
  wait_for_window_position "$panel_window" "$TIKPAL_WEB_MODE_PANEL_POSITION" "$TIKPAL_WEB_MODE_PANEL_WINDOW" 1 || return 1
  mark_window_above "$panel_window"
  raise_window_without_focus "$panel_window"
  if [[ "$timing_enabled" == "1" ]]; then
    total_ms="$(( $(now_ms) - started_ms ))"
    record_switch_detail_timing "$timing_enabled" \
      "switch_detail panel known=0 xid=$panel_window before=$before_geometry geometry_read_ms=$geometry_read_ms mutation_ms=$mutation_ms mutation=$panel_mutation total_ms=$total_ms"
  fi
  printf '%s\n' "$panel_window"
}

prepare_entry_surfaces() {
  local provider="${1:-qq_music}"

  runtime_open_request_is_current_or_log prepare-entry-start || return 0
  # This is deliberately only an initial-entry stage. It never launches or
  # reveals a provider, so the API can run it alongside the local-audio gate.
  # Use non-hidden mode so the panel appears at its final position (PANEL_POSITION)
  # immediately, making it visible during the audio gate and CDP wait.
  [[ -z "$(read_runtime_active_provider)" ]] || return 0
  hide_onboard
  initial_entry_prepare_side_panel "$provider" 0 || true
}

park_prepared_entry_surfaces() {
  # Audio release can fail after preparation has started. Restore the staged
  # surfaces off-screen so a failed Explore entry never leaves a visible veil.
  runtime_open_request_is_current_or_log park-entry-start || return 0
  [[ -z "$(read_runtime_active_provider)" ]] || return 0
  park_side_panel_for_reopen
}

initial_entry_window_map_state() {
  local window="$1" state window_id
  [[ "$window" =~ ^[1-9][0-9]*$ ]] || return 1
  state="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_probe getwindowmapstate "$window" 2>/dev/null || true)"
  case "$state" in
    *IsViewable*) printf 'viewable\n' ;;
    *IsUnMapped*) printf 'unmapped\n' ;;
    *IsUnviewable*) printf 'unviewable\n' ;;
    *)
      command -v xwininfo >/dev/null 2>&1 || return 1
      window_id="$(printf '0x%x' "$window")"
      state="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" timeout 3 xwininfo -id "$window_id" 2>/dev/null || true)"
      case "$state" in
        *'Map State: IsViewable'*) printf 'viewable\n' ;;
        *'Map State: IsUnMapped'*) printf 'unmapped\n' ;;
        *'Map State: IsUnviewable'*) printf 'unviewable\n' ;;
        *) return 1 ;;
      esac
      ;;
  esac
}

initial_entry_ensure_mapped() {
  local window="$1" state
  state="$(initial_entry_window_map_state "$window")" || return 1
  xdotool_mutate windowmap --sync "$window" || return $?
  [[ "$(initial_entry_window_map_state "$window")" == "viewable" ]]
}

initial_entry_set_geometry() {
  local window="$1" position="$2" size="$3" x y width height
  x="$(position_x "$position")"
  y="$(position_y "$position")"
  width="$(window_width "$size")"
  height="$(window_height "$size")"
  xdotool_mutate \
    windowmove --sync "$window" "$x" "$y" \
    windowsize --sync "$window" "$width" "$height" \
    windowmove "$window" "$x" "$y"
}

initial_entry_move_window() {
  local window="$1" position="$2"
  xdotool_mutate windowmove --sync "$window" \
    "$(position_x "$position")" "$(position_y "$position")"
}

initial_entry_resize_window() {
  local window="$1" size="$2"
  xdotool_mutate windowsize --sync "$window" \
    "$(window_width "$size")" "$(window_height "$size")"
}

initial_entry_restore_opacity() {
  set_window_opacity "$1" 1
}

initial_entry_raise_window() {
  xdotool_mutate windowraise "$1"
}

initial_entry_lower_window() {
  [[ -n "${1:-}" ]] || return 0
  xdotool_mutate windowlower "$1"
}

initial_entry_resolve_surfaces() {
  local target_window="$1" provider_profile="$2" panel_profile="$3"
  local panel_window kiosk_window
  validate_profile_window_fast "$target_window" "$provider_profile" || return 1
  panel_window="$(wait_for_profile_window "$panel_profile" 8 || true)"
  [[ "$panel_window" =~ ^[1-9][0-9]*$ ]] || return 1
  validate_profile_window_fast "$panel_window" "$panel_profile" || return 1
  kiosk_window="$(first_window_for_profile "$TIKPAL_CHROMIUM_PROFILE_DIR" || true)"
  if [[ -n "$kiosk_window" ]]; then
    validate_profile_window_fast "$kiosk_window" "$TIKPAL_CHROMIUM_PROFILE_DIR" || return 1
  fi
  TIKPAL_INITIAL_ENTRY_PANEL_WINDOW="$panel_window"
  TIKPAL_INITIAL_ENTRY_KIOSK_WINDOW="$kiosk_window"
  printf 'target=%s panel=%s kiosk=%s\n' \
    "$target_window" "$panel_window" "${kiosk_window:-missing}"
}

initial_entry_reassert_foreground() {
  local target_window="$1" panel_window="$2" inspect_response
  if inspect_response="$(initial_entry_inspect_surfaces "$target_window,$panel_window")"; then
    printf 'inspect=helper\n'
    initial_entry_reassert_surface_from_inspect "$inspect_response" "$panel_window" \
      "$TIKPAL_WEB_MODE_PANEL_POSITION" "$TIKPAL_WEB_MODE_PANEL_WINDOW" || return $?
    initial_entry_reassert_surface_from_inspect "$inspect_response" "$target_window" \
      "$TIKPAL_WEB_MODE_LEFT_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW"
    return
  fi
  initial_entry_reassert_surface "$panel_window" \
    "$TIKPAL_WEB_MODE_PANEL_POSITION" "$TIKPAL_WEB_MODE_PANEL_WINDOW" || return $?
  initial_entry_reassert_surface "$target_window" \
    "$TIKPAL_WEB_MODE_LEFT_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW"
}

initial_entry_reassert_surface_from_inspect() {
  local response="$1" window="$2" position="$3" size="$4"
  local expected_geometry map_state geometry opacity mutated=0 corrections=""
  expected_geometry="$(initial_entry_expected_geometry "$position" "$size")" || return 1
  IFS=$'\t' read -r map_state geometry opacity < <(
    initial_entry_inspected_surface_state "$response" "$window"
  )
  [[ -n "$map_state" && -n "$geometry" && -n "$opacity" ]] || return 1
  if [[ "$map_state" != "viewable" ]]; then
    initial_entry_ensure_mapped "$window" || return $?
    mutated=1
    corrections="${corrections:+$corrections,}map"
  fi
  if [[ "$geometry" != "$expected_geometry" ]]; then
    initial_entry_set_geometry "$window" "$position" "$size" || return $?
    mutated=1
    corrections="${corrections:+$corrections,}geometry"
  fi
  if ! window_opacity_is_full "$opacity"; then
    initial_entry_restore_opacity "$window" || return $?
    mutated=1
    corrections="${corrections:+$corrections,}opacity"
  fi

  # Step 9 has already raised the target and step 10 has lowered kiosk.  A
  # second synchronous raise is only needed after correcting a drift seen in
  # this reassert snapshot; otherwise it can block physical reveal on X11.
  if ((mutated)); then
    initial_entry_raise_window "$window" || return $?
  fi
  printf 'xid=%s map=%s geometry=%s opacity=%s corrections=%s\n' \
    "$window" "$map_state" "$geometry" "$opacity" "${corrections:-none}"
  return 0
}

initial_entry_reassert_surface() {
  local window="$1" position="$2" size="$3" expected_geometry geometry opacity
  expected_geometry="$(initial_entry_expected_geometry "$position" "$size")" || return 1

  # The first nine steps already establish map state, geometry, and opacity.
  # Repeating synchronous map/resize requests here can stall an otherwise
  # visible initial entry. Reassert only a surface that drifted while the short
  # paint settle elapsed; the following strict snapshot remains the gate.
  [[ "$(initial_entry_window_map_state "$window")" == "viewable" ]] ||
    initial_entry_ensure_mapped "$window" || return $?
  geometry="$(window_geometry_compact "$window")" || return $?
  [[ "$geometry" == "$expected_geometry" ]] ||
    initial_entry_set_geometry "$window" "$position" "$size" || return $?
  opacity="$(window_opacity_value "$window")" || return $?
  window_opacity_is_full "$opacity" || initial_entry_restore_opacity "$window" || return $?
  initial_entry_raise_window "$window"
}

initial_entry_verify_final_surfaces() {
  local target_window="$1" panel_window="$2"
  local target_geometry panel_geometry target_map panel_map target_opacity panel_opacity
  local inspect_response
  if inspect_response="$(initial_entry_inspect_surfaces "$target_window,$panel_window")"; then
    IFS=$'\t' read -r target_map target_geometry target_opacity < <(
      initial_entry_inspected_surface_state "$inspect_response" "$target_window"
    )
    IFS=$'\t' read -r panel_map panel_geometry panel_opacity < <(
      initial_entry_inspected_surface_state "$inspect_response" "$panel_window"
    )
    [[ -n "$target_geometry" && -n "$panel_geometry" ]] || return 1
    printf 'target=%s/%s/%s panel=%s/%s/%s inspect=helper\n' \
      "$target_geometry" "$target_map" "$target_opacity" \
      "$panel_geometry" "$panel_map" "$panel_opacity"
    [[ "$target_geometry" == "${TIKPAL_WEB_MODE_LEFT_POSITION}_${TIKPAL_WEB_MODE_LEFT_WINDOW}" &&
       "$panel_geometry" == "${TIKPAL_WEB_MODE_PANEL_POSITION}_${TIKPAL_WEB_MODE_PANEL_WINDOW}" &&
       "$target_map" == "viewable" && "$panel_map" == "viewable" ]] || return 1
    window_opacity_is_full "$target_opacity" && window_opacity_is_full "$panel_opacity"
    return
  fi
  target_geometry="$(window_geometry_compact "$target_window")" || return 1
  panel_geometry="$(window_geometry_compact "$panel_window")" || return 1
  target_map="$(initial_entry_window_map_state "$target_window")" || return 1
  panel_map="$(initial_entry_window_map_state "$panel_window")" || return 1
  target_opacity="$(window_opacity_value "$target_window")" || return 1
  panel_opacity="$(window_opacity_value "$panel_window")" || return 1
  printf 'target=%s/%s/%s panel=%s/%s/%s\n' \
    "$target_geometry" "$target_map" "$target_opacity" \
    "$panel_geometry" "$panel_map" "$panel_opacity"
  [[ "$target_geometry" == "${TIKPAL_WEB_MODE_LEFT_POSITION}_${TIKPAL_WEB_MODE_LEFT_WINDOW}" &&
     "$panel_geometry" == "${TIKPAL_WEB_MODE_PANEL_POSITION}_${TIKPAL_WEB_MODE_PANEL_WINDOW}" &&
     "$target_map" == "viewable" && "$panel_map" == "viewable" ]] || return 1
  window_opacity_is_full "$target_opacity" && window_opacity_is_full "$panel_opacity"
}

initial_entry_cleanup_surfaces() {
  local target_window="$1" panel_window="$2" cleanup_status=0
  if [[ "$target_window" =~ ^[1-9][0-9]*$ ]]; then
    set_window_opacity "$target_window" 0 >/dev/null 2>&1 || cleanup_status=1
    initial_entry_set_geometry "$target_window" "$TIKPAL_WEB_MODE_STAGE_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW" >/dev/null 2>&1 || cleanup_status=1
    initial_entry_lower_window "$target_window" >/dev/null 2>&1 || cleanup_status=1
  fi
  if [[ "$panel_window" =~ ^[1-9][0-9]*$ ]]; then
    set_window_opacity "$panel_window" 0 >/dev/null 2>&1 || cleanup_status=1
    initial_entry_set_geometry "$panel_window" "$TIKPAL_WEB_MODE_STAGE_POSITION" "$TIKPAL_WEB_MODE_PANEL_WINDOW" >/dev/null 2>&1 || cleanup_status=1
    initial_entry_lower_window "$panel_window" >/dev/null 2>&1 || cleanup_status=1
  fi
  return "$cleanup_status"
}

initial_entry_abort() {
  local provider="$1" phase="$2" target_window="$3" status="$4"
  local panel_window="$TIKPAL_INITIAL_ENTRY_PANEL_WINDOW" mutation_started=false
  local before_snapshot after_snapshot cleanup_status=0 timestamp
  [[ "$TIKPAL_INITIAL_ENTRY_MUTATION_STARTED" == "1" ]] && mutation_started=true
  before_snapshot="$(initial_entry_window_snapshot "$target_window${panel_window:+,$panel_window}" || true)"
  initial_entry_cleanup_surfaces "$target_window" "$panel_window" || cleanup_status=$?
  after_snapshot="$(initial_entry_window_snapshot "$target_window${panel_window:+,$panel_window}" || true)"
  timestamp="$(x11_monotonic_ns)"
  if ! initial_entry_trace_event initial_entry_aborted "$provider" "$phase" 0 \
      "${TIKPAL_INITIAL_ENTRY_FAILED_STEP:-unknown}" "$target_window${panel_window:+,$panel_window}" \
      cleanup offscreen "$timestamp" "$timestamp" "$status" \
      "cleanup_status=$cleanup_status" "" "$mutation_started" "$before_snapshot" "$after_snapshot"; then
    initial_entry_trace_warn aborted_append_failed
  fi
  log_open_stage initial_entry_aborted \
    "provider=$provider phase=$phase step=${TIKPAL_INITIAL_ENTRY_FAILED_STEP:-unknown} status=$status mutation_started=$mutation_started cleanup_status=$cleanup_status"
  return "$status"
}

initial_entry_require_step() {
  local step_number="$1" provider="$2" phase="$3" step="$4" xids="$5"
  local command_type="$6" expected_geometry="$7" mutation_expected="$8"
  local target_window="$9" status
  shift 9
  if initial_entry_step_run "$step_number" "$provider" "$phase" "$step" "$xids" \
      "$command_type" "$expected_geometry" "$mutation_expected" "$@"; then
    return 0
  else
    status=$?
  fi
  initial_entry_abort "$provider" "$phase" "$target_window" "$status"
}

initial_entry_prepare_context() {
  local provider="$1" phase="$2" target_window="${3:-}" context_key
  context_key="$provider:$phase:${TIKPAL_WEB_MODE_OPEN_REQUEST_ID:-legacy}"
  if [[ "$TIKPAL_INITIAL_ENTRY_TRACE_CONTEXT_KEY" == "$context_key" ]]; then
    TIKPAL_INITIAL_ENTRY_PROVIDER="$provider"
    [[ -n "$target_window" ]] && TIKPAL_INITIAL_ENTRY_TARGET_WINDOW="$target_window"
    return 0
  fi

  TIKPAL_INITIAL_ENTRY_MUTATION_STARTED=0
  TIKPAL_INITIAL_ENTRY_FAILED_STEP=""
  TIKPAL_INITIAL_ENTRY_FAILED_STATUS=0
  TIKPAL_INITIAL_ENTRY_PANEL_WINDOW=""
  TIKPAL_INITIAL_ENTRY_KIOSK_WINDOW=""
  TIKPAL_INITIAL_ENTRY_TARGET_WINDOW="$target_window"
  TIKPAL_INITIAL_ENTRY_PROVIDER="$provider"
  TIKPAL_INITIAL_ENTRY_PROXY_LINE=""
  TIKPAL_INITIAL_ENTRY_PROXY_ENABLED=""
  TIKPAL_INITIAL_ENTRY_TRACE_CONTEXT_KEY="$context_key"
  if initial_entry_trace_require_writable; then
    return 0
  fi
  TIKPAL_INITIAL_ENTRY_FAILED_STEP=trace_preflight
  TIKPAL_INITIAL_ENTRY_FAILED_STATUS=90
  log_open_stage initial_entry_aborted \
    "provider=$provider phase=$phase step=trace_preflight status=90 mutation_started=false cleanup_status=0"
  return 90
}

initial_entry_pre_reveal_step() {
  local step_number="$1" provider="$2" phase="$3" step="$4" xids="$5"
  local command_type="$6" expected_geometry="$7" mutation_expected="$8"
  local target_window="$9" status
  shift 9
  if initial_entry_step_run "$step_number" "$provider" "$phase" "$step" "$xids" \
      "$command_type" "$expected_geometry" "$mutation_expected" "$@"; then
    return 0
  else
    status=$?
  fi
  initial_entry_abort "$provider" "$phase" "$target_window" "$status" || true
  return "$status"
}

initial_entry_probe_request_ownership() {
  if runtime_open_request_is_current_or_log resident-reveal-start; then
    printf 'current\n'
  else
    printf 'superseded\n'
  fi
}

initial_entry_load_proxy_settings() {
  TIKPAL_INITIAL_ENTRY_PROXY_LINE="$(read_proxy_settings)"
}

initial_entry_resolve_proxy_enabled() {
  TIKPAL_INITIAL_ENTRY_PROXY_ENABLED="$(effective_provider_proxy_enabled "$1" "${TIKPAL_INITIAL_ENTRY_PROXY_LINE%%$'\t'*}")"
}

initial_entry_proxy_is_available() {
  local provider="$1" proxy_enabled="$2"
  [[ "$proxy_enabled" == "1" ]] || provider_prefers_direct_proxy "$provider" || provider_direct_reachable "$provider"
}

initial_entry_prepare_side_panel() {
  local opening_provider="${1:-}" hidden="${2:-0}"
  local panel_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel"
  local panel_window inspect_response map_state geometry opacity expected_geometry
  expected_geometry="$(initial_entry_expected_geometry "$TIKPAL_WEB_MODE_PANEL_POSITION" "$TIKPAL_WEB_MODE_PANEL_WINDOW")" || return 1

  # prepare-entry has already created the panel in parallel with the audio
  # gate. Reusing its cached XID through the native Helper avoids clearing the
  # cache and scanning every Chromium process a second time. A failed identity
  # check deliberately falls through to the established full recovery path.
  panel_window="$(read_profile_window_cache_raw "$panel_profile" || true)"
  if [[ "$panel_window" =~ ^[1-9][0-9]*$ ]]; then
    TIKPAL_INITIAL_ENTRY_PANEL_WINDOW="$panel_window"
    if inspect_response="$(initial_entry_inspect_surfaces "$panel_window")"; then
      IFS=$'\t' read -r map_state geometry opacity < <(
        initial_entry_inspected_surface_state "$inspect_response" "$panel_window"
      )
      if [[ -n "$map_state" && -n "$geometry" && -n "$opacity" ]]; then
        if [[ "$map_state" != "viewable" ]]; then
          initial_entry_ensure_mapped "$panel_window" || return $?
        fi
        if [[ "$geometry" != "$expected_geometry" ]]; then
          initial_entry_set_geometry "$panel_window" "$TIKPAL_WEB_MODE_PANEL_POSITION" \
            "$TIKPAL_WEB_MODE_PANEL_WINDOW" || return $?
        fi
        if ! window_opacity_is_full "$opacity"; then
          initial_entry_restore_opacity "$panel_window" || return $?
        fi
        printf 'reuse=helper xid=%s map=%s geometry=%s opacity=%s\n' \
          "$panel_window" "$map_state" "$geometry" "$opacity"
        return 0
      fi
    fi
  fi

  # The legacy panel helper may still call exit under its inherited set -e
  # context. Keep that exit inside a child so the step wrapper records it and
  # can restore the staged surfaces before returning the original failure.
  (
    set +e
    ensure_side_panel "$opening_provider" "$hidden"
  )
}

initial_entry_wait_for_target_window() {
  TIKPAL_INITIAL_ENTRY_TARGET_WINDOW="$(wait_for_profile_window "$1" "$2")"
}

initial_entry_wait_for_entry_paint_optional() {
  if wait_for_entry_provider_paint "$1" "$2" "$3"; then
    printf 'ready\n'
  else
    log "WARN: $(provider_label "$2") did not complete DOM/X11 paint checks before entry reveal"
    printf 'warning\n'
  fi
}

initial_entry_surface_plan() {
  local target_window="$1" provider_profile="$2" panel_profile="$3" phase="$4"
  local provider="${provider_profile##*/}" panel_window kiosk_window physical_ms
  local settle paint_settle kiosk_mutation=0
  initial_entry_prepare_context "$provider" "$phase" "$target_window" || return $?
  initial_entry_require_step 1 "$provider" "$phase" resolve_and_validate "$target_window" \
    xid_validation identity false "$target_window" \
    initial_entry_resolve_surfaces "$target_window" "$provider_profile" "$panel_profile" || return $?
  panel_window="$TIKPAL_INITIAL_ENTRY_PANEL_WINDOW"
  kiosk_window="$TIKPAL_INITIAL_ENTRY_KIOSK_WINDOW"
  [[ -z "$kiosk_window" ]] || kiosk_mutation=1
  initial_entry_require_step 2 "$provider" "$phase" panel_map "$panel_window" \
    map viewable 1 "$target_window" initial_entry_ensure_mapped "$panel_window" || return $?
  initial_entry_require_step 3 "$provider" "$phase" panel_geometry "$panel_window" \
    move_resize "${TIKPAL_WEB_MODE_PANEL_POSITION}_${TIKPAL_WEB_MODE_PANEL_WINDOW}" 1 "$target_window" \
    initial_entry_set_geometry "$panel_window" "$TIKPAL_WEB_MODE_PANEL_POSITION" "$TIKPAL_WEB_MODE_PANEL_WINDOW" || return $?
  initial_entry_require_step 4 "$provider" "$phase" panel_opacity "$panel_window" \
    opacity full 1 "$target_window" initial_entry_restore_opacity "$panel_window" || return $?
  initial_entry_require_step 5 "$provider" "$phase" target_map "$target_window" \
    map viewable 1 "$target_window" initial_entry_ensure_mapped "$target_window" || return $?
  initial_entry_require_step 6 "$provider" "$phase" target_opacity "$target_window" \
    opacity full 1 "$target_window" initial_entry_restore_opacity "$target_window" || return $?
  initial_entry_require_step 7 "$provider" "$phase" target_move "$target_window" \
    move "$TIKPAL_WEB_MODE_LEFT_POSITION" 1 "$target_window" \
    initial_entry_move_window "$target_window" "$TIKPAL_WEB_MODE_LEFT_POSITION" || return $?
  initial_entry_require_step 8 "$provider" "$phase" target_resize "$target_window" \
    resize "$TIKPAL_WEB_MODE_LEFT_WINDOW" 1 "$target_window" \
    initial_entry_resize_window "$target_window" "$TIKPAL_WEB_MODE_LEFT_WINDOW" || return $?
  initial_entry_require_step 9 "$provider" "$phase" target_raise "$target_window" \
    raise foreground 1 "$target_window" initial_entry_raise_window "$target_window" || return $?
  initial_entry_require_step 10 "$provider" "$phase" kiosk_lower "$kiosk_window" \
    lower background "$kiosk_mutation" "$target_window" initial_entry_lower_window "$kiosk_window" || return $?

  if [[ "$phase" == "resident_initial_entry" ]]; then
    settle="$TIKPAL_WEB_MODE_RESIDENT_ENTRY_SETTLE_SECONDS"
    paint_settle="$TIKPAL_WEB_MODE_RESIDENT_ENTRY_PAINT_SETTLE_SECONDS"
    [[ "$settle" =~ ^[0-9]+([.][0-9]+)?$ ]] || settle=0.16
    [[ "$paint_settle" =~ ^[0-9]+([.][0-9]+)?$ ]] || paint_settle=0.5
    sleep "$settle"
    sleep "$paint_settle"
  else
    settle="$TIKPAL_WEB_MODE_ENTRY_REVEAL_SETTLE_SECONDS"
    [[ "$settle" =~ ^[0-9]+([.][0-9]+)?$ ]] || settle=0.45
    sleep "$settle"
  fi
  initial_entry_require_step 11 "$provider" "$phase" foreground_reassert "$target_window,$panel_window" \
    reassert visible 1 "$target_window" initial_entry_reassert_foreground "$target_window" "$panel_window" || return $?
  initial_entry_require_step 12 "$provider" "$phase" final_surface_snapshot "$target_window,$panel_window" \
    geometry_verify "${TIKPAL_WEB_MODE_LEFT_POSITION}_${TIKPAL_WEB_MODE_LEFT_WINDOW};${TIKPAL_WEB_MODE_PANEL_POSITION}_${TIKPAL_WEB_MODE_PANEL_WINDOW}" \
    0 "$target_window" initial_entry_verify_final_surfaces "$target_window" "$panel_window" || return $?
  physical_ms="$(now_ms)"
  initial_entry_require_step 13 "$provider" "$phase" physical_stamp "$target_window,$panel_window" \
    stamp "$TIKPAL_WEB_MODE_PHYSICAL_REVEAL_STAMP_PATH" 0 "$target_window" \
    write_physical_reveal_stamp "$provider_profile" "$target_window" "" "$physical_ms" || return $?
  log_stage "reveal_physical target=$target_window mode=initial-entry physical_ms=$physical_ms"
  log_open_stage reveal \
    "provider=$provider result=success route=initial-entry phase=$phase target_window=$target_window panel_window=$panel_window physical_ms=$physical_ms"
}

reveal_initial_entry_surfaces() {
  initial_entry_surface_plan "$1" "$2" "$3" cold_initial_entry
}

reveal_resident_initial_entry_surfaces() {
  initial_entry_surface_plan "$1" "$2" "$3" resident_initial_entry
}

reveal_resident_provider_surfaces() {
  local target_window="$1"
  local provider_profile="$2"
  local panel_profile="$3"
  local previous_profile="${4:-}"
  local transition_shown_ms="${5:-0}"
  local provider_port="${6:-}"
  local panel_window
  panel_window="$(wait_for_profile_window "$panel_profile" 8 || true)"
  if [[ -n "$panel_window" ]]; then
    restore_window_opacity "$panel_window"
    tile_window_fast "$panel_window" "$TIKPAL_WEB_MODE_PANEL_POSITION" "$TIKPAL_WEB_MODE_PANEL_WINDOW"
    mark_window_above "$panel_window"
    raise_window_without_focus "$panel_window"
  fi
  reveal_resident_provider_window "$target_window" "$previous_profile" "$provider_profile" "$transition_shown_ms" "$provider_port"
  raise_onboard
}

position_resident_switch_windows_fast() {
  local target_window="$1"
  local previous_window="${2:-}"
  local timing_enabled="${3:-0}"
  local target_x target_y target_width target_height normalized_size
  local previous_x previous_y
  local probe geometries segment_started_ms=0 result=not_run
  local -a xdotool_args=()
  local -a geometry_args=()

  if [[ "$timing_enabled" == "1" ]]; then
    TIKPAL_POSITION_RESIDENT_PRE_GEOMETRY_MS=-1
    TIKPAL_POSITION_RESIDENT_TARGET_BEFORE=not_read
    TIKPAL_POSITION_RESIDENT_PREVIOUS_BEFORE=not_read
    TIKPAL_POSITION_RESIDENT_MUTATION_MS=-1
    TIKPAL_POSITION_RESIDENT_RESULT=not_run
  fi

  [[ "$target_window" =~ ^[0-9]+$ ]] || return 1
  command -v xdotool >/dev/null 2>&1 || return 1
  is_enabled "$TIKPAL_WEB_MODE_X11_SYNC_WINDOW_OPS" && return 1

  target_x="${TIKPAL_WEB_MODE_LEFT_POSITION%,*}"
  target_y="${TIKPAL_WEB_MODE_LEFT_POSITION#*,}"
  normalized_size="$(normalize_window_size "$TIKPAL_WEB_MODE_LEFT_WINDOW")"
  target_width="${normalized_size%,*}"
  target_height="${normalized_size#*,}"
  xdotool_args=(
    windowmove "$target_window" "$target_x" "$target_y"
    windowsize "$target_window" "$target_width" "$target_height"
    windowmove "$target_window" "$target_x" "$target_y"
    windowraise "$target_window"
  )

  if [[ "$previous_window" =~ ^[0-9]+$ && "$previous_window" != "$target_window" ]]; then
    previous_x="${TIKPAL_WEB_MODE_STAGE_POSITION%,*}"
    previous_y="${TIKPAL_WEB_MODE_STAGE_POSITION#*,}"
    xdotool_args+=(
      windowmove "$previous_window" "$previous_x" "$previous_y"
      windowsize "$previous_window" "$target_width" "$target_height"
      windowmove "$previous_window" "$previous_x" "$previous_y"
    )
  fi

  if [[ "$timing_enabled" == "1" ]]; then
    geometry_args=(getwindowgeometry --shell "$target_window")
    if [[ "$previous_window" =~ ^[0-9]+$ && "$previous_window" != "$target_window" ]]; then
      geometry_args+=(getwindowgeometry --shell "$previous_window")
    fi
    segment_started_ms="$(now_ms)"
    if probe="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_probe "${geometry_args[@]}")"; then
      geometries="$(printf '%s\n' "$probe" | awk -F= -v target="$target_window" -v previous="$previous_window" '
        $1=="WINDOW" { window=$2 }
        $1=="X" { x[window]=$2 }
        $1=="Y" { y[window]=$2 }
        $1=="WIDTH" { width[window]=$2 }
        $1=="HEIGHT" { height[window]=$2 }
        END {
          printf "%s,%s_%sx%s\t%s,%s_%sx%s\n",
            x[target], y[target], width[target], height[target],
            x[previous], y[previous], width[previous], height[previous]
        }')"
      IFS=$'\t' read -r TIKPAL_POSITION_RESIDENT_TARGET_BEFORE TIKPAL_POSITION_RESIDENT_PREVIOUS_BEFORE <<< "$geometries"
      [[ -n "$TIKPAL_POSITION_RESIDENT_TARGET_BEFORE" ]] || TIKPAL_POSITION_RESIDENT_TARGET_BEFORE=unreadable
      if [[ -z "$previous_window" ]]; then
        TIKPAL_POSITION_RESIDENT_PREVIOUS_BEFORE=none
      elif [[ -z "$TIKPAL_POSITION_RESIDENT_PREVIOUS_BEFORE" ]]; then
        TIKPAL_POSITION_RESIDENT_PREVIOUS_BEFORE=unreadable
      fi
    else
      TIKPAL_POSITION_RESIDENT_TARGET_BEFORE=unreadable
      [[ -z "$previous_window" ]] \
        && TIKPAL_POSITION_RESIDENT_PREVIOUS_BEFORE=none \
        || TIKPAL_POSITION_RESIDENT_PREVIOUS_BEFORE=unreadable
    fi
    TIKPAL_POSITION_RESIDENT_PRE_GEOMETRY_MS="$(( $(now_ms) - segment_started_ms ))"
    segment_started_ms="$(now_ms)"
  fi

  if DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_mutate "${xdotool_args[@]}" >/dev/null 2>&1; then
    result=ok
  else
    result=failed
  fi
  if [[ "$timing_enabled" == "1" ]]; then
    TIKPAL_POSITION_RESIDENT_MUTATION_MS="$(( $(now_ms) - segment_started_ms ))"
    TIKPAL_POSITION_RESIDENT_RESULT="$result"
  fi
  [[ "$result" == "ok" ]]
}

resident_switch_windows_at_geometry() {
  local target_window="$1"
  local previous_window="${2:-}"
  local probe geometries target_geometry previous_geometry
  local -a xdotool_args=(getwindowgeometry --shell "$target_window")
  [[ "$target_window" =~ ^[0-9]+$ ]] || return 1
  if [[ "$previous_window" =~ ^[0-9]+$ && "$previous_window" != "$target_window" ]]; then
    xdotool_args+=(getwindowgeometry --shell "$previous_window")
  fi
  probe="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_probe "${xdotool_args[@]}")" || return 1
  geometries="$(printf '%s\n' "$probe" | awk -F= -v target="$target_window" -v previous="$previous_window" '
    $1=="WINDOW" { window=$2 }
    $1=="X" { x[window]=$2 }
    $1=="Y" { y[window]=$2 }
    $1=="WIDTH" { width[window]=$2 }
    $1=="HEIGHT" { height[window]=$2 }
    END {
      printf "%s,%s %sx%s\t%s,%s %sx%s\n",
        x[target], y[target], width[target], height[target],
        x[previous], y[previous], width[previous], height[previous]
    }')"
  IFS=$'\t' read -r target_geometry previous_geometry <<< "$geometries"
  [[ "$target_geometry" == "0,0 1920x720" ]] || return 1
  [[ -z "$previous_window" || "$previous_geometry" == "2560,0 1920x720" ]]
}

persist_resident_window_above() {
  mark_window_above "$1"
}

write_physical_reveal_stamp() {
  local provider_profile="$1"
  local target_window="$2"
  local previous_window="${3:-}"
  local physical_ms="$4"
  local provider stamp_path temporary_path
  provider="${provider_profile##*/}"
  stamp_path="$TIKPAL_WEB_MODE_PHYSICAL_REVEAL_STAMP_PATH"
  temporary_path="$stamp_path.$$.$RANDOM.tmp"
  if ! printf '%s\t%s\t%s\t%s\n' "$provider" "$target_window" "$previous_window" "$physical_ms" > "$temporary_path" \
    || ! mv -f "$temporary_path" "$stamp_path"; then
    rm -f "$temporary_path" 2>/dev/null || true
    return 1
  fi
}

log_switch_segment_summary_once() {
  local enabled="$1"
  local provider_profile="$2"
  local cached_xid_ms="$3"
  local first_cdp_ms="$4"
  local guard_stop_ms="$5"
  local panel_retile_ms="$6"
  local target_opacity_ms="$7"
  local combined_x11_ms="$8"
  local provider detail detail_path
  [[ "$enabled" == "1" && -e "$TIKPAL_WEB_MODE_SWITCH_SEGMENT_TIMING_ONCE_PATH" ]] || return 0
  provider="${provider_profile##*/}"
  detail_path="$(switch_detail_timing_path)"
  if [[ -r "$detail_path" ]]; then
    while IFS= read -r detail; do
      [[ -n "$detail" ]] && log_stage "$detail"
    done < "$detail_path"
  fi
  log_stage "switch_segments provider=$provider cached_xid_ms=$cached_xid_ms first_cdp_ms=$first_cdp_ms guard_stop_ms=$guard_stop_ms panel_retile_ms=$panel_retile_ms target_opacity_ms=$target_opacity_ms combined_x11_ms=$combined_x11_ms"
  rm -f "$detail_path" "$TIKPAL_WEB_MODE_SWITCH_SEGMENT_TIMING_ONCE_PATH"
}

reveal_resident_provider_window() {
  local target_window="$1"
  local previous_profile="${2:-}"
  local provider_profile="${3:-}"
  local transition_shown_ms="${4:-0}"
  local provider_port="${5:-}"
  local previous_window="${6:-}"
  local resident_page_ready="${7:-0}"
  local segment_timing_once="${8:-0}"
  local cached_xid_ms="${9:--1}"
  local first_cdp_ms="${10:--1}"
  local guard_stop_ms="${11:--1}"
  local panel_retile_ms="${12:--1}"
  local helper_candidate="${13:-0}"
  local panel_window="${14:-}"
  local panel_profile="${15:-$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel}"
  local TIKPAL_WEB_MODE_TRUSTED_PROVIDER_PAGE_PORT=""
  local physical_ms segment_started_ms=0 target_opacity_ms=-1 combined_x11_ms=-1 started_ms="$(now_ms)"
  local opacity_read_ms=-1 opacity_before=not_read opacity_mutation=not_run
  local combined_pre_geometry_ms=-1 target_before=not_read previous_before=not_read combined_result=not_run
  local stamp_write_ms=-1 stamp_result=not_run
  local trace_foreground_started_ms=0 trace_foreground_finished_ms=0 trace_foreground_elapsed_ms=0
  local helper_paint_started_ms=0 helper_paint_elapsed_ms=0
  if switch_trace_enabled; then
    switch_trace_now_ms trace_foreground_started_ms
    record_switch_trace_event foreground_switch_started
  fi
  if [[ "$helper_candidate" == "1" ]]; then
    local helper_status=0
    if x11_helper_begin_switch "$target_window" "$provider_profile" \
      "$previous_window" "$previous_profile" "$panel_window" "$panel_profile"; then
      helper_status=0
    else
      helper_status=$?
    fi
    log_open_stage helper_call "provider=${provider_profile##*/} result=$([[ "$helper_status" == "0" ]] && printf success || printf failed) status=$helper_status response=${TIKPAL_X11_HELPER_LAST_RESPONSE:-none}"
    if [[ "$helper_status" == "0" ]]; then
      # The Helper has fenced and verified the X11 transaction, but that does
      # not prove Chromium has produced a nonblank compositor frame.  Keep
      # the Helper lease until this read-only physical gate passes so a stamp
      # cannot make a white first paint look like a successful reveal.
      helper_paint_started_ms="$(now_ms)"
      if ! wait_for_provider_window_nonblank_x11_frame "$target_window"; then
        helper_paint_elapsed_ms="$(( $(now_ms) - helper_paint_started_ms ))"
        if switch_trace_enabled; then
          record_switch_trace_event helper_paint_gate failed paint_timeout "$helper_paint_elapsed_ms"
        fi
        log_stage "reveal_paint_failed target=$target_window port=$provider_port mode=helper elapsed_ms=$helper_paint_elapsed_ms"
        log_open_stage reveal "provider=${provider_profile##*/} result=failed route=helper reason=paint_timeout target_window=$target_window"
        return 1
      fi
      helper_paint_elapsed_ms="$(( $(now_ms) - helper_paint_started_ms ))"
      if switch_trace_enabled; then
        record_switch_trace_event helper_paint_gate completed nonblank "$helper_paint_elapsed_ms"
      fi
      physical_ms="$(now_ms)"
      write_physical_reveal_stamp "$provider_profile" "$target_window" "$previous_window" "$physical_ms" \
        || log_stage "reveal_physical_stamp_failed target=$target_window physical_ms=$physical_ms"
      if switch_trace_enabled; then
        switch_trace_now_ms trace_foreground_finished_ms
        trace_foreground_elapsed_ms=$((trace_foreground_finished_ms - trace_foreground_started_ms))
        record_switch_trace_event foreground_switch_completed helper "" "$trace_foreground_elapsed_ms"
        record_switch_trace_event runtime_geometry_verified helper_final_snapshot
      fi
      log_stage "reveal_physical target=$target_window provider_port=$provider_port mode=helper generation=$TIKPAL_X11_HELPER_GENERATION physical_ms=$physical_ms ms=$(( physical_ms - started_ms ))"
      log_open_stage reveal "provider=${provider_profile##*/} result=success route=helper target_window=$target_window physical_ms=$physical_ms"
      log_switch_segment_summary_once "$segment_timing_once" "$provider_profile" "$cached_xid_ms" "$first_cdp_ms" 0 0 0 0
      return 0
    elif [[ "$helper_status" == "70" ]]; then
      log_open_stage reveal "provider=${provider_profile##*/} result=failed route=helper reason=unknown_outcome status=$helper_status"
      fail "X11 helper switch outcome is unknown; leaving helper ownership fail-closed"
    else
      x11_helper_enter_fallback "$helper_status" ||
        fail "X11 helper failed and ownership could not be safely returned to Shell"
      log_open_stage helper_route "provider=${provider_profile##*/} result=legacy_selected reason=helper_call_failed status=$helper_status"
      helper_candidate=0
    fi
    if [[ "$helper_candidate" != "1" ]]; then
      local fallback_started_ms
      fallback_started_ms="$(now_ms)"
      stop_window_guard
      target_window="$(first_window_for_profile "$provider_profile" "$segment_timing_once" helper_fallback_target || true)"
      previous_window="$(first_window_for_profile "$previous_profile" "$segment_timing_once" helper_fallback_previous || true)"
      panel_window="$(keep_side_panel_visible_during_switch "${provider_profile##*/}" "$panel_window" "$segment_timing_once" || true)"
      [[ "$target_window" =~ ^[1-9][0-9]*$ && "$previous_window" =~ ^[1-9][0-9]*$ &&
         "$panel_window" =~ ^[1-9][0-9]*$ ]] || return 1
      guard_stop_ms="$(( $(now_ms) - fallback_started_ms ))"
    fi
  fi
  # Restore opacity before reveal — park_profile_windows_for_reopen sets 0
  # to avoid white flash during the async off-screen move.
  [[ "$segment_timing_once" != "1" ]] || segment_started_ms="$(now_ms)"
  opacity_before="$(window_opacity_value "$target_window" || printf unreadable)"
  if [[ "$segment_timing_once" == "1" ]]; then
    opacity_read_ms="$(( $(now_ms) - segment_started_ms ))"
  fi
  if window_opacity_is_full "$opacity_before"; then
    target_opacity_ms=0
    opacity_mutation=skipped
  else
    [[ "$segment_timing_once" != "1" ]] || segment_started_ms="$(now_ms)"
    restore_window_opacity "$target_window"
    [[ "$segment_timing_once" != "1" ]] || target_opacity_ms="$(( $(now_ms) - segment_started_ms ))"
    opacity_mutation=applied
  fi
  # If CDP already proves the provider has a real HTTPS page, the compositor
  # has rendered meaningful content.  Skip the slow X11 paint check and settle
  # delay entirely — the 3 s timeout on 115 always fails even when the window
  # has visible content.
  [[ "$resident_page_ready" == "1" ]] && TIKPAL_WEB_MODE_TRUSTED_PROVIDER_PAGE_PORT="$provider_port"
  if [[ -n "$provider_port" ]] && provider_has_real_provider_page "$provider_port"; then
    log_stage "reveal_cdp_skip_paint target=$target_window port=$provider_port ms=$(( $(now_ms) - started_ms ))"
    # One xdotool connection keeps the move/size/raise ordering on the X
    # server without paying one process and one round trip per operation. The
    # device has no _NET_ACTIVE_WINDOW support, so activation is deliberately
    # excluded from this first-visible transaction. Geometry is still checked
    # before the visible owner can commit; the existing staged path remains
    # the fallback for any command or confirmation failure.
    if position_resident_switch_windows_fast "$target_window" "$previous_window" "$segment_timing_once"; then
      if [[ "$segment_timing_once" == "1" ]]; then
        combined_pre_geometry_ms="${TIKPAL_POSITION_RESIDENT_PRE_GEOMETRY_MS:--1}"
        target_before="${TIKPAL_POSITION_RESIDENT_TARGET_BEFORE:-unreadable}"
        previous_before="${TIKPAL_POSITION_RESIDENT_PREVIOUS_BEFORE:-unreadable}"
        combined_x11_ms="${TIKPAL_POSITION_RESIDENT_MUTATION_MS:--1}"
        combined_result="${TIKPAL_POSITION_RESIDENT_RESULT:-ok}"
      fi
      physical_ms="$(now_ms)"
      [[ "$segment_timing_once" != "1" ]] || segment_started_ms="$(now_ms)"
      if ! write_physical_reveal_stamp "$provider_profile" "$target_window" "$previous_window" "$physical_ms"; then
        stamp_result=failed
        log_stage "reveal_physical_stamp_failed target=$target_window physical_ms=$physical_ms"
      else
        stamp_result=ok
      fi
      if switch_trace_enabled; then
        switch_trace_now_ms trace_foreground_finished_ms
        trace_foreground_elapsed_ms=$((trace_foreground_finished_ms - trace_foreground_started_ms))
        record_switch_trace_event foreground_switch_completed "$stamp_result" "" "$trace_foreground_elapsed_ms"
      fi
      if [[ "$segment_timing_once" == "1" ]]; then
        stamp_write_ms="$(( $(now_ms) - segment_started_ms ))"
        record_switch_detail_timing "$segment_timing_once" \
          "switch_detail reveal target=$target_window previous=${previous_window:-none} opacity_read_ms=$opacity_read_ms opacity_before=$opacity_before opacity_mutation_ms=$target_opacity_ms opacity_mutation=$opacity_mutation pre_geometry_ms=$combined_pre_geometry_ms target_before=$target_before previous_before=$previous_before combined_mutation_ms=$combined_x11_ms combined_result=$combined_result target_ops=move,size,move,raise previous_ops=move,size,move stamp_write_ms=$stamp_write_ms stamp_result=$stamp_result"
      fi
      log_stage "reveal_physical target=$target_window provider_port=$provider_port mode=combined physical_ms=$physical_ms ms=$(( physical_ms - started_ms ))"
      log_switch_segment_summary_once "$segment_timing_once" "$provider_profile" "$cached_xid_ms" "$first_cdp_ms" "$guard_stop_ms" "$panel_retile_ms" "$target_opacity_ms" "$combined_x11_ms"
      if resident_switch_windows_at_geometry "$target_window" "$previous_window"; then
        persist_resident_window_above "$target_window"
        record_switch_trace_event runtime_geometry_verified
        log_stage "reveal_geometry_verified target=$target_window mode=combined ms=$(( $(now_ms) - started_ms ))"
        return 0
      fi
      log_stage "reveal_combined_fallback target=$target_window ms=$(( $(now_ms) - started_ms ))"
    elif [[ "$segment_timing_once" == "1" ]]; then
      combined_pre_geometry_ms="${TIKPAL_POSITION_RESIDENT_PRE_GEOMETRY_MS:--1}"
      target_before="${TIKPAL_POSITION_RESIDENT_TARGET_BEFORE:-unreadable}"
      previous_before="${TIKPAL_POSITION_RESIDENT_PREVIOUS_BEFORE:-unreadable}"
      combined_x11_ms="${TIKPAL_POSITION_RESIDENT_MUTATION_MS:--1}"
      combined_result="${TIKPAL_POSITION_RESIDENT_RESULT:-failed}"
      record_switch_detail_timing "$segment_timing_once" \
        "switch_detail reveal target=$target_window previous=${previous_window:-none} opacity_read_ms=$opacity_read_ms opacity_before=$opacity_before opacity_mutation_ms=$target_opacity_ms opacity_mutation=$opacity_mutation pre_geometry_ms=$combined_pre_geometry_ms target_before=$target_before previous_before=$previous_before combined_mutation_ms=$combined_x11_ms combined_result=$combined_result target_ops=move,size,move,raise previous_ops=move,size,move stamp_write_ms=not_measured stamp_result=not_measured"
    fi
    # A resident starts at the off-screen stage. Raising it is not enough: the
    # foreground switch owns the complete physical geometry transaction.
    tile_window_fast "$target_window" "$TIKPAL_WEB_MODE_LEFT_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW"
    wait_for_window_position "$target_window" "$TIKPAL_WEB_MODE_LEFT_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW" 1 || return 1
    mark_window_above "$target_window"
    log_stage "reveal_mark_above target=$target_window ms=$(( $(now_ms) - started_ms ))"
    raise_window "$target_window"
    if [[ -n "$previous_profile" && "$previous_profile" != "$provider_profile" && -n "$previous_window" ]]; then
      tile_window_fast "$previous_window" "$TIKPAL_WEB_MODE_STAGE_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW"
      wait_for_window_position "$previous_window" "$TIKPAL_WEB_MODE_STAGE_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW" 1 || return 1
    fi
    physical_ms="$(now_ms)"
    write_physical_reveal_stamp "$provider_profile" "$target_window" "$previous_window" "$physical_ms" \
      || log_stage "reveal_physical_stamp_failed target=$target_window physical_ms=$physical_ms"
    if switch_trace_enabled; then
      switch_trace_now_ms trace_foreground_finished_ms
      trace_foreground_elapsed_ms=$((trace_foreground_finished_ms - trace_foreground_started_ms))
      record_switch_trace_event foreground_switch_completed fallback "" "$trace_foreground_elapsed_ms"
      record_switch_trace_event runtime_geometry_verified fallback
    fi
    log_stage "reveal_physical target=$target_window provider_port=$provider_port physical_ms=$physical_ms ms=$(( physical_ms - started_ms ))"
    log_switch_segment_summary_once "$segment_timing_once" "$provider_profile" "$cached_xid_ms" "$first_cdp_ms" "$guard_stop_ms" "$panel_retile_ms" "$target_opacity_ms" "$combined_x11_ms"
    return 0
  fi
  # Tile and lower only if not already pre-positioned by the caller.
  if ! check_target_window_probe "$target_window" 2>/dev/null; then
    tile_window_fast "$target_window" "$TIKPAL_WEB_MODE_LEFT_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW"
    clear_window_above "$target_window"
    DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowlower "$target_window" >/dev/null 2>&1 || true
  fi
  if [[ "$TIKPAL_WEB_MODE_RESIDENT_SWITCH_SETTLE_SECONDS" =~ ^[0-9]+([.][0-9]+)?$ ]] \
    && [[ "$TIKPAL_WEB_MODE_RESIDENT_SWITCH_SETTLE_SECONDS" != "0" ]]; then
    sleep "$TIKPAL_WEB_MODE_RESIDENT_SWITCH_SETTLE_SECONDS"
  fi
  log_stage "reveal_paint_check target=$target_window port=$provider_port ms=$(( $(now_ms) - started_ms ))"
  # Verify the target window itself before letting it rise above the shared
  # transition.  This keeps Chromium's blank first compositor frame and the
  # kiosk underneath from becoming visible during a resident switch.
  # A background probe may have already confirmed the frame; skip the
  # synchronous wait when it has.  CDP proves that the provider loaded, but
  # cannot prove the compositor has painted its visible X11 surface.
  local _paint_check_ms=$(( $(now_ms) ))
  if ! check_target_window_probe "$target_window" && ! wait_for_provider_window_nonblank_x11_frame "$target_window"; then
    cleanup_target_window_probe "$target_window"
    clear_window_above "$target_window"
    DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowlower "$target_window" >/dev/null 2>&1 || true
    log_stage "reveal_paint_failed target=$target_window port=$provider_port elapsed_ms=$(( $(now_ms) - _paint_check_ms ))"
    return 1
  fi
  cleanup_target_window_probe "$target_window"
  log_stage "reveal_paint_ok target=$target_window elapsed_ms=$(( $(now_ms) - _paint_check_ms ))"
  if [[ -n "$previous_profile" && "$previous_profile" != "$provider_profile" ]]; then
    park_profile_windows_for_reopen "$previous_profile" "$TIKPAL_WEB_MODE_LEFT_WINDOW" || true
  fi
  mark_window_above "$target_window"
  raise_window "$target_window"
  physical_ms="$(now_ms)"
  write_physical_reveal_stamp "$provider_profile" "$target_window" "$previous_window" "$physical_ms" \
    || log_stage "reveal_physical_stamp_failed target=$target_window physical_ms=$physical_ms"
  if switch_trace_enabled; then
    switch_trace_now_ms trace_foreground_finished_ms
    trace_foreground_elapsed_ms=$((trace_foreground_finished_ms - trace_foreground_started_ms))
    record_switch_trace_event foreground_switch_completed staged "" "$trace_foreground_elapsed_ms"
    record_switch_trace_event runtime_geometry_verified staged
  fi
  log_stage "reveal_physical target=$target_window provider_port=$provider_port physical_ms=$physical_ms ms=$(( physical_ms - started_ms ))"
  log_switch_segment_summary_once "$segment_timing_once" "$provider_profile" "$cached_xid_ms" "$first_cdp_ms" "$guard_stop_ms" "$panel_retile_ms" "$target_opacity_ms" "$combined_x11_ms"
  # The transition profile is kept alive and off-screen for the next switch;
  # do not tear it down after a successful reveal.
}

reassert_visible_provider_surfaces() {
  local target_window="$1"
  local provider_profile="$2"
  local panel_profile="$3"
  local panel_window
  panel_window="$(wait_for_profile_window "$panel_profile" 4 || true)"
  if [[ -n "$panel_window" ]]; then
    tile_window_fast "$panel_window" "$TIKPAL_WEB_MODE_PANEL_POSITION" "$TIKPAL_WEB_MODE_PANEL_WINDOW"
    mark_window_above "$panel_window"
    raise_window_without_focus "$panel_window"
  fi
  tile_window_fast "$target_window" "$TIKPAL_WEB_MODE_LEFT_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW"
  mark_window_above "$target_window"
  raise_window "$target_window"
}

launch_provider_for_pool() {
  local provider="$1"
  local wait_ready="${2:-1}"
  local launch_role="${3:-active}"
  local force_existing="${4:-0}"
  local url provider_profile provider_port launch_url extension_enabled=0
  local target_window proxy_line proxy_enabled proxy_url target_audio_device lock_timeout window_position launch_started_ms
  local wait_for_entry=0 wait_for_full_ready=0
  case "$wait_ready" in
    1|ready)
      wait_for_entry=1
      wait_for_full_ready=1
      ;;
    entry)
      wait_for_entry=1
      ;;
  esac
  if command -v flock >/dev/null 2>&1 && [[ "${TIKPAL_WEB_MODE_PROVIDER_LAUNCH_LOCKED:-0}" != "1" ]]; then
    lock_timeout="$TIKPAL_WEB_MODE_PROVIDER_WINDOW_TIMEOUT_SECONDS"
    [[ "$launch_role" == "prewarm" ]] && lock_timeout="$TIKPAL_WEB_MODE_PROVIDER_PREWARM_LOCK_TIMEOUT_SECONDS"
    mkdir -p "$TIKPAL_WEB_MODE_PROFILE_ROOT"
    (
      flock -x -w "$lock_timeout" 7 || exit 75
      TIKPAL_WEB_MODE_PROVIDER_LAUNCH_LOCKED=1 launch_provider_for_pool "$provider" "$wait_ready" "$launch_role" "$force_existing"
    ) 7>"$TIKPAL_WEB_MODE_PROFILE_ROOT/provider-$provider.launch.lock"
    local lock_status=$?
    if [[ "$lock_status" == "75" ]]; then
      rm -f "$TIKPAL_WEB_MODE_PROFILE_ROOT/provider-$provider.launch.lock"
      return 1
    fi
    return "$lock_status"
  fi

  url="$(provider_url "$provider")"
  provider_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$provider"
  provider_port="$(provider_debug_port "$provider")"
  window_position="$(provider_launch_position "$launch_role")"
  launch_started_ms="$(now_ms)"
  log_stage "provider_launch provider=$provider role=$launch_role force=$force_existing"
  if [[ "$launch_role" == "prewarm" && -z "$(read_runtime_active_provider)" ]] && ! is_enabled "${TIKPAL_WEB_MODE_IDLE_POOL_WARMUP:-0}"; then
    return 0
  fi
  proxy_line="$(read_proxy_settings)"
  proxy_enabled="$(effective_provider_proxy_enabled "$provider" "${proxy_line%%$'\t'*}")"
  proxy_url="${proxy_line#*$'\t'}"
  launch_url="$url"
  if [[ "$proxy_enabled" != "1" ]] && ! provider_prefers_direct_proxy "$provider" && ! provider_direct_reachable "$provider"; then
    write_runtime_provider_status "$provider" "check_proxy" "$(provider_needs_proxy_message "$provider")"
    [[ "$launch_role" == "prewarm" ]] && return 0
    return 1
  fi

  if is_enabled "$TIKPAL_WEB_MODE_EXTENSION_ENABLED" && [[ -f "$TIKPAL_WEB_MODE_EXTENSION_DIR/manifest.json" ]]; then
    extension_enabled=1
  fi

  if profile_process_exists "$provider_profile"; then
    if ! provider_has_real_provider_page "$provider_port"; then
      if [[ "$launch_role" == "prewarm" && "$force_existing" == "1" ]]; then
        write_runtime_provider_status "$provider" "prewarming"
        if ! navigate_provider_target "$provider_port" "$url" || ! wait_for_real_provider_url "$provider_port"; then
          write_runtime_provider_status "$provider" "check_setup" "$(provider_label "$provider") did not enter the provider page"
          return 0
        fi
      else
        write_runtime_provider_status "$provider" "check_setup" "$(provider_label "$provider") did not enter the provider page"
        [[ "$launch_role" == "prewarm" ]] && return 0
        return 1
      fi
    elif [[ "$launch_role" == "prewarm" && "$force_existing" == "1" ]]; then
      write_runtime_provider_status "$provider" "prewarming"
      if ! navigate_provider_target "$provider_port" "$url" || ! wait_for_real_provider_url "$provider_port"; then
        write_runtime_provider_status "$provider" "check_setup" "$(provider_label "$provider") could not reopen"
        return 0
      fi
    fi
    start_provider_guard "$provider" "$provider_profile" "$url" "$proxy_enabled" "$provider_port"
    log_stage "provider_https_ready provider=$provider role=$launch_role reused=1 ms=$(( $(now_ms) - launch_started_ms ))"
    if [[ "$launch_role" == "prewarm" && -z "$(read_runtime_active_provider)" ]] && ! is_enabled "${TIKPAL_WEB_MODE_IDLE_POOL_WARMUP:-0}"; then
      return 0
    fi
    if [[ "$launch_role" == "prewarm" ]]; then
      if provider_has_real_provider_page "$provider_port"; then
        write_runtime_provider_status "$provider" "ready"
        return 0
      fi
      write_runtime_provider_status "$provider" "check_setup" "$(provider_label "$provider") did not enter the provider page"
      return 0
    fi
    if ! wait_for_provider_ready "$provider_port" "$provider"; then
      write_runtime_provider_status "$provider" "check_setup" "$(provider_label "$provider") did not become ready"
      return 1
    fi
    write_runtime_provider_status "$provider" "ready"
    return 0
  fi

  if [[ "$launch_role" == "prewarm" ]]; then
    write_runtime_provider_status "$provider" "prewarming"
  else
    write_runtime_provider_status "$provider" "opening"
  fi
  resolve_web_mode_audio_devices
  target_audio_device="$TIKPAL_WEB_MODE_ALSA_OUTPUT_DEVICE"
  mkdir -p "$provider_profile"
  ensure_chromium_profile_prefs "$provider_profile"
  seed_profile_widevine_cdm "$provider_profile"
  cleanup_stale_profile_singletons "$provider_profile"
  refresh_extension_script_cache "$provider_profile"
  mapfile -t flags < <(read_flags)
  mapfile -t base_args < <(chromium_base_args)

  local args=(
    "${flags[@]}"
    "${base_args[@]}"
    "--app=$launch_url"
    "--user-data-dir=$provider_profile"
    "--remote-debugging-address=127.0.0.1"
    "--remote-debugging-port=$provider_port"
    "--window-position=$window_position"
    "--window-size=$(normalize_window_size "$TIKPAL_WEB_MODE_LEFT_WINDOW")"
  )

  if is_enabled "$TIKPAL_WEB_MODE_DISABLE_HANG_MONITOR"; then
    args+=("--disable-hang-monitor")
  fi
  if [[ "$extension_enabled" == "1" ]]; then
    args+=("--load-extension=$TIKPAL_WEB_MODE_EXTENSION_DIR")
  fi
  if [[ -n "$target_audio_device" ]]; then
    args+=("--alsa-output-device=$target_audio_device")
  fi
  if [[ "$proxy_enabled" == "1" && -n "$proxy_url" ]]; then
    args+=("--proxy-server=$proxy_url")
    args+=("--proxy-bypass-list=localhost;127.0.0.1;<local>")
  fi

  DISPLAY="$TIKPAL_KIOSK_DISPLAY" "$TIKPAL_CHROMIUM_BIN" "${args[@]}" >/dev/null 2>&1 7>&- 9>&- &
  target_window="$(wait_for_profile_window "$provider_profile" "$(profile_window_timeout_attempts "$TIKPAL_WEB_MODE_PROVIDER_WINDOW_TIMEOUT_SECONDS")" || true)"
  if [[ -z "$target_window" ]]; then
    close_provider_profile "$provider_profile"
    if [[ "$launch_role" == "prewarm" && -z "$(read_runtime_active_provider)" ]] && ! is_enabled "${TIKPAL_WEB_MODE_IDLE_POOL_WARMUP:-0}"; then
      return 1
    fi
    write_runtime_provider_status "$provider" "check_setup" "$(provider_label "$provider") did not open"
    return 1
  fi
  tile_window "$target_window" "$window_position" "$TIKPAL_WEB_MODE_LEFT_WINDOW"
  start_provider_guard "$provider" "$provider_profile" "$url" "$proxy_enabled" "$provider_port"

  if [[ "$wait_for_entry" == "1" ]]; then
    if ! wait_for_real_provider_url "$provider_port"; then
      if [[ "$launch_role" == "prewarm" && -z "$(read_runtime_active_provider)" ]] && ! is_enabled "${TIKPAL_WEB_MODE_IDLE_POOL_WARMUP:-0}"; then
        return 1
      fi
      write_runtime_provider_status "$provider" "check_setup" "$(provider_label "$provider") did not enter the provider page"
      return 1
    fi
    log_stage "provider_https_ready provider=$provider role=$launch_role reused=0 ms=$(( $(now_ms) - launch_started_ms ))"
  fi
  if [[ "$wait_for_full_ready" == "1" ]]; then
    if ! wait_for_provider_ready "$provider_port" "$provider"; then
      if [[ "$launch_role" == "prewarm" && -z "$(read_runtime_active_provider)" ]] && ! is_enabled "${TIKPAL_WEB_MODE_IDLE_POOL_WARMUP:-0}"; then
        return 1
      fi
      write_runtime_provider_status "$provider" "check_setup" "$(provider_label "$provider") did not become ready"
      return 1
    fi
  fi
  if [[ "$launch_role" == "prewarm" && -z "$(read_runtime_active_provider)" ]] && ! is_enabled "${TIKPAL_WEB_MODE_IDLE_POOL_WARMUP:-0}"; then
    return 0
  fi
  if [[ "$wait_for_full_ready" != "1" ]]; then
    if [[ "$launch_role" == "prewarm" ]]; then
      # Prewarm is complete as soon as a real HTTPS provider page exists. The
      # slower DOM probe remains reserved for foreground cold starts.
      write_runtime_provider_status "$provider" "ready"
    fi
    return 0
  fi
  write_runtime_provider_status "$provider" "ready"
}

provider_prewarm_max_concurrent_launches() {
  local maximum="${TIKPAL_WEB_MODE_PROVIDER_PREWARM_MAX_CONCURRENT_LAUNCHES:-2}"
  [[ "$maximum" =~ ^[0-9]+$ ]] || maximum=2
  [[ "$maximum" -gt 0 ]] || maximum=1
  [[ "$maximum" -le 10 ]] || maximum=10
  printf '%s\n' "$maximum"
}

provider_prewarm_queue_can_continue() {
  local active_provider="$1"
  local queue_mode="$2"
  local current_active
  current_active="$(read_runtime_active_provider)"

  if [[ "$queue_mode" == "idle" ]]; then
    if [[ -n "$current_active" ]]; then
      log "idle provider pool warmup paused because Explore is active"
      return 1
    fi
    return 0
  fi

  if [[ -n "$active_provider" && "$current_active" != "$active_provider" ]]; then
    log "provider prewarm abandoned: active provider changed from $active_provider"
    return 1
  fi
  if [[ -z "$current_active" ]] && ! is_enabled "$TIKPAL_WEB_MODE_PROVIDER_PREWARM_CONTINUE_AFTER_CLOSE"; then
    log "provider prewarm paused because Explore closed"
    return 1
  fi
  return 0
}

launch_provider_prewarm_worker() {
  local provider="$1"
  local active_provider="$2"
  local force_existing="$3"
  local queue_mode="$4"
  local current_active started_ms elapsed_ms status
  provider_prewarm_queue_can_continue "$active_provider" "$queue_mode" || return 0
  started_ms="$(now_ms)"
  log_stage "prewarm_launch provider=$provider mode=$queue_mode"
  current_active="$(read_runtime_active_provider)"
  if [[ "$queue_mode" == "idle" || -z "$current_active" ]]; then
    TIKPAL_WEB_MODE_IDLE_POOL_WARMUP=1 launch_provider_for_pool "$provider" entry prewarm "$force_existing" || true
  else
    launch_provider_for_pool "$provider" entry prewarm "$force_existing" || true
  fi
  elapsed_ms="$(( $(now_ms) - started_ms ))"
  status="$(read_runtime_provider_status "$provider")"
  log_stage "prewarm_page_ready provider=$provider status=$status ms=$elapsed_ms"
}

# After the main prewarm queue completes, retry providers that ended up in
# check_setup but still have a live Chromium process.  One retry with the
# normal bootstrap timeout is enough; a second failure leaves the provider
# marked for manual inspection.
retry_failed_prewarm_providers() {
  local active_provider="$1"
  local queue_mode="$2"
  local provider profile provider_port status retried=0
  while IFS= read -r provider; do
    [[ -n "$provider" && "$provider" != "$active_provider" ]] || continue
    provider_prewarm_queue_can_continue "$active_provider" "$queue_mode" || return 0
    status="$(read_runtime_provider_status "$provider")"
    [[ "$status" == "check_setup" ]] || continue
    profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$provider"
    profile_process_exists "$profile" || continue
    provider_port="$(provider_debug_port "$provider")"
    log "retrying prewarm for $provider (was check_setup)"
    write_runtime_provider_status "$provider" "prewarming"
    launch_provider_for_pool "$provider" entry prewarm 1 || true
    retried=$((retried + 1))
  done < <(provider_prewarm_order)
  [[ "$retried" -eq 0 ]] || log "retried $retried failed prewarm providers"
}

provider_prewarm_queue_is_complete() {
  node - "$TIKPAL_WEB_MODE_STATE_PATH" "$(provider_ids | tr '\n' ',' | sed 's/,$//')" <<'NODE'
const fs = require("node:fs");
const [statePath, providerList] = process.argv.slice(2);
const completeStatuses = new Set(["ready", "active", "check_setup", "check_proxy", "region_unavailable"]);
try {
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const providers = state.residentProviders && typeof state.residentProviders === "object" ? state.residentProviders : {};
  const ids = String(providerList || "").split(",").filter(Boolean);
  process.exit(ids.every((id) => { const s = String(providers[id]?.status || ""); return !s || completeStatuses.has(s); }) ? 0 : 1);
} catch {
  process.exit(1);
}
NODE
}

run_provider_prewarm_queue() {
  local active_provider="$1"
  local force_existing="$2"
  local queue_mode="$3"
  local provider worker_pid current_active
  local maximum delay interrupted=0
  local -a worker_pids=()
  local -a remaining_pids=()

  maximum="$(provider_prewarm_max_concurrent_launches)"
  delay="$TIKPAL_WEB_MODE_PROVIDER_PREWARM_DELAY_SECONDS"
  [[ "$delay" =~ ^[0-9]+([.][0-9]+)?$ ]] || delay=0.75

  while IFS= read -r provider; do
    [[ -n "$provider" && "$provider" != "$active_provider" ]] || continue
    provider_prewarm_queue_can_continue "$active_provider" "$queue_mode" || {
      interrupted=1
      break
    }
    while [[ "${#worker_pids[@]}" -ge "$maximum" ]]; do
      remaining_pids=()
      for worker_pid in "${worker_pids[@]}"; do
        if kill -0 "$worker_pid" >/dev/null 2>&1; then
          remaining_pids+=("$worker_pid")
        else
          wait "$worker_pid" >/dev/null 2>&1 || true
        fi
      done
      worker_pids=("${remaining_pids[@]}")
      [[ "${#worker_pids[@]}" -lt "$maximum" ]] && break
      provider_prewarm_queue_can_continue "$active_provider" "$queue_mode" || {
        interrupted=1
        break 2
      }
      sleep 0.05
    done
    (
      launch_provider_prewarm_worker "$provider" "$active_provider" "$force_existing" "$queue_mode"
    ) &
    worker_pids+=("$!")
    sleep "$delay"
  done < <(provider_prewarm_order)

  for worker_pid in "${worker_pids[@]}"; do
    wait "$worker_pid" >/dev/null 2>&1 || true
  done

  provider_prewarm_queue_can_continue "$active_provider" "$queue_mode" || interrupted=1
  if [[ "$interrupted" == "1" ]]; then
    current_active="$(read_runtime_active_provider)"
    sync_runtime_provider_pool_process_statuses "$current_active"
    if provider_prewarm_queue_is_complete; then
      write_runtime_prewarm_complete 1
      log "provider prewarm queue completed after settling interrupted queue"
    fi
    return 0
  fi
  current_active="$(read_runtime_active_provider)"
  sync_runtime_provider_pool_process_statuses "$current_active"
  if provider_prewarm_queue_is_complete; then
    write_runtime_prewarm_complete 1
    log "provider prewarm queue completed: max-concurrent=$maximum"
  else
    log "provider prewarm queue incomplete: max-concurrent=$maximum"
  fi
}

prewarm_provider_pool() {
  local active_provider="${1:-}"
  local current_active force_existing pid_file active_file
  is_enabled "$TIKPAL_WEB_MODE_PROVIDER_PREWARM_ENABLED" || return 0
  pid_file="$(prewarm_pid_file)"
  active_file="$(prewarm_active_provider_file)"
  mkdir -p "$(dirname "$pid_file")"
  printf '%s\n' "$BASHPID" > "$pid_file"
  printf '%s\n' "$active_provider" > "$active_file"
  prewarm_provider_pool_cleanup() {
    local pf af
    pf="$(prewarm_pid_file)" || return 0
    af="$(prewarm_active_provider_file)" || return 0
    [[ "$(cat "$pf" 2>/dev/null || true)" == "$BASHPID" ]] || return 0
    rm -f "$pf" "$af"
  }
  trap prewarm_provider_pool_cleanup EXIT
  current_active="$(read_runtime_active_provider)"
  [[ -z "$active_provider" || "$current_active" == "$active_provider" ]] || {
    log "provider prewarm abandoned: active provider changed from $active_provider"
    return 0
  }
  seed_runtime_provider_pool_statuses "$active_provider"
  force_existing="${TIKPAL_WEB_MODE_PROVIDER_PREWARM_FORCE:-0}"
  run_provider_prewarm_queue "$active_provider" "$force_existing" active
}

start_provider_pool_prewarm() {
  local active_provider="$1"
  local seed_mode="${2:-preserve}"
  local allow_active_clear="${3:-1}"
  local force_env=() running_active_provider
  is_enabled "$TIKPAL_WEB_MODE_PROVIDER_POOL" || return 0
  is_enabled "$TIKPAL_WEB_MODE_PROVIDER_PREWARM_ENABLED" || return 0
  if [[ "$seed_mode" != "force" ]] && provider_prewarm_queue_running; then
    running_active_provider="$(cat "$(prewarm_active_provider_file)" 2>/dev/null || true)"
    if [[ "$running_active_provider" == "$active_provider" ]]; then
      log "provider pool prewarm already running"
      return 0
    fi
    log "replacing stale provider prewarm for $running_active_provider"
  fi
  stop_provider_pool_prewarm
  if [[ "$seed_mode" != "force" ]] && ! provider_pool_needs_prewarm "$active_provider"; then
    sync_runtime_provider_pool_process_statuses "$active_provider" "$allow_active_clear"
    write_runtime_prewarm_complete 1
    log "provider pool already resident; prewarm skipped"
    return 0
  fi
  mkdir -p "$TIKPAL_WEB_MODE_PROFILE_ROOT"
  seed_runtime_provider_pool_statuses "$active_provider" "$seed_mode"
  if [[ "$seed_mode" == "force" ]]; then
    force_env=(env TIKPAL_WEB_MODE_PROVIDER_PREWARM_FORCE=1)
  fi
  if command -v setsid >/dev/null 2>&1; then
    "${force_env[@]}" setsid "$SCRIPT_DIR/tikpal-web-mode.sh" prewarm "$active_provider" </dev/null >/dev/null 2>&1 9>&- &
  else
    "${force_env[@]}" nohup "$SCRIPT_DIR/tikpal-web-mode.sh" prewarm "$active_provider" </dev/null >/dev/null 2>&1 9>&- &
  fi
  printf '%s\n' "$!" > "$(prewarm_pid_file)"
  printf '%s\n' "$active_provider" > "$(prewarm_active_provider_file)"
}

warm_provider_pool() {
  local pid_file
  is_enabled "$TIKPAL_WEB_MODE_PROVIDER_POOL" || return 0
  is_enabled "$TIKPAL_WEB_MODE_PROVIDER_IDLE_POOL_ENABLED" || return 0
  is_enabled "$TIKPAL_WEB_MODE_PROVIDER_PREWARM_ENABLED" || return 0
  stop_provider_pool_prewarm
  pid_file="$(prewarm_pid_file)"
  mkdir -p "$(dirname "$pid_file")"
  printf '%s\n' "$BASHPID" > "$pid_file"
  warm_provider_pool_cleanup() {
    local pf
    pf="$(prewarm_pid_file)" || return 0
    [[ "$(cat "$pf" 2>/dev/null || true)" == "$BASHPID" ]] && rm -f "$pf"
  }
  trap warm_provider_pool_cleanup EXIT
  hide_onboard
  # Clear stale state from previous session so idle queue always runs.
  write_runtime_provider_state ""
  rm -f "$(pool_warm_stamp_file)"
  seed_runtime_provider_pool_statuses "" force
  if [[ -z "$(read_runtime_active_provider)" ]]; then
    ensure_side_panel "" 1
  fi
  run_provider_prewarm_queue "" force idle
  if ! provider_prewarm_queue_is_complete; then
    local current_active
    current_active="$(read_runtime_active_provider)"
    sync_runtime_provider_pool_process_statuses "$current_active" 0
  fi
  if provider_prewarm_queue_is_complete; then
    write_runtime_prewarm_complete 1
    touch "$(pool_warm_stamp_file)"
    log "warmed provider pool"
  else
    log "warm provider pool incomplete; providers will reconcile on next open"
  fi
}

open_provider_pool() {
  local provider="$1"
  local provider_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$provider"
  local current_provider current_profile target_window="" previous_window="" panel_window="" known_panel_window="" proxy_line proxy_enabled message extension_enabled=0 entry_stage=0
  local panel_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel"
  local resident_status resident_page_ready=0 fast_resident=0 switching_provider=0 current_port provider_port
  local helper_candidate=0 helper_target_raw=0
  local started_ms reveal_ms command_return_ms transition_shown_ms=0 initial_entry_status=0
  local initial_entry_phase=""
  local segment_timing_once=0 segment_started_ms=0 cached_xid_ms=-1 first_cdp_ms=-1 guard_stop_ms=-1 panel_retile_ms=-1
  local trace_started_ms=0 trace_finished_ms=0 trace_elapsed_ms=0 trace_cdp_started_ms=0 trace_cdp_elapsed_ms=0
  if ! runtime_open_request_is_current_or_log open-pool-start; then
    log "open abandoned: active provider no longer ${TIKPAL_WEB_MODE_OPEN_EXPECTED_ACTIVE_PROVIDER}"
    return 0
  fi
  started_ms="$(now_ms)"
  current_provider="$(read_runtime_active_provider)"
  current_profile=""
  if [[ -n "$current_provider" ]]; then
    current_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$current_provider"
  fi
  [[ -z "$current_provider" ]] && entry_stage=1
  [[ "$entry_stage" != "1" && "$current_provider" != "$provider" ]] && switching_provider=1
  if [[ "$switching_provider" == "1" && -e "$TIKPAL_WEB_MODE_SWITCH_SEGMENT_TIMING_ONCE_PATH" ]]; then
    segment_timing_once=1
    rm -f "$(switch_detail_timing_path)"
  fi
  resident_status="$(read_runtime_provider_status "$provider")"
  provider_port="$(provider_debug_port "$provider")"
  if switch_trace_enabled; then
    switch_trace_now_ms trace_started_ms
    record_switch_trace_event target_resolve_started
  fi
  [[ "$segment_timing_once" != "1" ]] || segment_started_ms="$(now_ms)"
  if [[ "$switching_provider" == "1" ]] && x11_helper_switch_enabled; then
    target_window="$(read_profile_window_cache_raw "$provider_profile" || true)"
    [[ -z "$target_window" ]] || helper_target_raw=1
  fi
  if [[ -z "$target_window" ]]; then
    target_window="$(first_window_for_profile "$provider_profile" "$segment_timing_once" target || true)"
  fi
  [[ "$segment_timing_once" != "1" ]] || cached_xid_ms="$(( $(now_ms) - segment_started_ms ))"
  if [[ -n "$target_window" || "$resident_status" == "ready" || "$resident_status" == "active" ]]; then
    [[ "$segment_timing_once" != "1" ]] || segment_started_ms="$(now_ms)"
    switch_trace_enabled && switch_trace_now_ms trace_cdp_started_ms
    if provider_has_real_provider_page "$provider_port"; then
      resident_page_ready=1
      [[ -n "$target_window" ]] && fast_resident=1
    fi
    [[ "$segment_timing_once" != "1" ]] || first_cdp_ms="$(( $(now_ms) - segment_started_ms ))"
    if switch_trace_enabled; then
      switch_trace_now_ms trace_finished_ms
      trace_cdp_elapsed_ms=$((trace_finished_ms - trace_cdp_started_ms))
      if [[ "$resident_page_ready" == "1" ]]; then
        record_switch_trace_event cdp_target_resolved ready "" "$trace_cdp_elapsed_ms"
      else
        record_switch_trace_event cdp_target_resolved not_ready cdp_not_ready "$trace_cdp_elapsed_ms"
      fi
    fi
  fi
  if switch_trace_enabled; then
    switch_trace_now_ms trace_finished_ms
    trace_elapsed_ms=$((trace_finished_ms - trace_started_ms))
    if [[ "$fast_resident" == "1" ]]; then
      record_switch_trace_event target_resolve_completed fast_resident "" "$trace_elapsed_ms"
    elif [[ -n "$target_window" ]]; then
      record_switch_trace_event target_resolve_completed xid_only cdp_not_ready "$trace_elapsed_ms"
    else
      record_switch_trace_event target_resolve_completed unresolved target_window_missing "$trace_elapsed_ms"
    fi
  fi
  log_stage "open_pool_init provider=$provider target=$target_window resident_page_ready=$resident_page_ready fast_resident=$fast_resident switching=$switching_provider entry=$entry_stage ms=$(( $(now_ms) - started_ms ))"
  log_open_stage resident_page_ready "provider=$provider ready=$resident_page_ready target_window=${target_window:-missing} resident_status=${resident_status:-missing}"
  if [[ "$entry_stage" == "1" && initial_entry_trace_enabled ]]; then
    if [[ "$fast_resident" == "1" ]]; then
      initial_entry_phase=resident_initial_entry
    else
      initial_entry_phase=cold_initial_entry
    fi
    initial_entry_prepare_context "$provider" "$initial_entry_phase" "$target_window" || return $?
  fi
  # A foreground choice owns the pool from this point.  The switch marker
  # pauses the existing Guard before a hot reveal, so it cannot raise the old
  # provider while the foreground transaction owns both resident surfaces.
  if [[ "$switching_provider" == "1" ]]; then
    if switch_trace_enabled; then
      switch_trace_now_ms trace_started_ms
      record_switch_trace_event guard_prepare_started
    fi
    begin_provider_switch_guard
    previous_window="$(read_guard_window provider "$current_profile" || true)"
    known_panel_window="$(read_guard_window panel "$panel_profile" || true)"
    if ! x11_helper_switch_enabled; then
      log_open_stage helper_route "provider=$provider result=legacy_selected reason=helper_mode_$TIKPAL_WEB_MODE_X11_HELPER_MODE"
    fi
    if [[ "$helper_target_raw" == "1" && "$previous_window" =~ ^[1-9][0-9]*$ &&
       "$known_panel_window" =~ ^[1-9][0-9]*$ ]] && x11_helper_prepare_switch; then
      helper_candidate=1
      panel_window="$known_panel_window"
      guard_stop_ms=0
      panel_retile_ms=0
      log_stage "x11_helper_prepared generation=$TIKPAL_X11_HELPER_GENERATION epoch=$TIKPAL_X11_HELPER_CONNECTION_EPOCH target=$target_window previous=$previous_window panel=$panel_window"
      log_open_stage helper_route "provider=$provider result=prepared generation=$TIKPAL_X11_HELPER_GENERATION target_window=$target_window previous_window=$previous_window panel_window=$panel_window"
    else
      if x11_helper_switch_enabled; then
        log_open_stage helper_route "provider=$provider result=legacy_selected reason=helper_prepare_unavailable"
      fi
      if [[ "$helper_target_raw" == "1" ]]; then
        target_window="$(first_window_for_profile "$provider_profile" "$segment_timing_once" target || true)"
        [[ -n "$target_window" && "$resident_page_ready" == "1" ]] && fast_resident=1 || fast_resident=0
      fi
      # Reuse the one live Guard after commit.  Its switch-marker pause is
      # sufficient to prevent foreground interference and avoids a synchronous
      # SIGTERM/wait/relaunch cycle on the physical reveal path.
      guard_stop_ms=0
      if [[ -z "$previous_window" ]]; then
        previous_window="$(first_window_for_profile "$current_profile" "$segment_timing_once" previous || true)"
      fi
      [[ "$segment_timing_once" != "1" ]] || segment_started_ms="$(now_ms)"
      panel_window="$(keep_side_panel_visible_during_switch "$provider" "$known_panel_window" "$segment_timing_once" || true)"
      [[ "$segment_timing_once" != "1" ]] || panel_retile_ms="$(( $(now_ms) - segment_started_ms ))"
    fi
    if [[ -z "$previous_window" ]]; then
      message="Current Explore provider window is unavailable"
      recover_or_cover_provider_failure "$current_provider" "$current_profile" "$provider" "check_setup" "$message" || true
      fail "$message"
    fi
    if [[ -z "$panel_window" ]]; then
      message="Explore side panel is unavailable"
      recover_or_cover_provider_failure "$current_provider" "$current_profile" "$provider" "check_setup" "$message" || true
      fail "$message"
    fi
    if switch_trace_enabled; then
      switch_trace_now_ms trace_finished_ms
      trace_elapsed_ms=$((trace_finished_ms - trace_started_ms))
      record_switch_trace_event guard_prepare_completed ok "" "$trace_elapsed_ms"
    fi
    if [[ -z "$target_window" && "$resident_page_ready" == "1" ]]; then
      target_window="$(first_window_for_profile "$provider_profile" "$segment_timing_once" target_retry || true)"
      if [[ -n "$target_window" ]]; then
        fast_resident=1
        log_stage "open_pool_resident_window_recovered provider=$provider target=$target_window ms=$(( $(now_ms) - started_ms ))"
      else
        clear_provider_switch_guard
        message="$(provider_label "$provider") resident window is unavailable"
        recover_or_cover_provider_failure "$current_provider" "$current_profile" "$provider" "check_setup" "$message" || true
        fail "$message"
      fi
    fi
    # Pause old provider's media — fire-and-forget so it does not block the reveal.
    # The transition veil covers the old page; the 2 s audio crossfade masks any
    # brief overlap while the WebSocket round-trip completes in the background.
    if [[ -n "$current_provider" ]]; then
      ( pause_provider_media_via_cdp "$(provider_debug_port "$current_provider")" || true ) &
    fi
    if [[ "$fast_resident" == "1" ]]; then
      # CDP fast path: skip the fade animation.  The new window will be
      # raised on top of the old one instantly.  The fade's xprop calls
      # take 1+ seconds when the X server is busy rendering the kiosk UI.
      transition_shown_ms="$(now_ms)"
      log_stage "open_pool_transition provider=$provider transition_shown=$transition_shown_ms ms=$(( $(now_ms) - started_ms )) cdp_skip_fade=1"
    else
      if ! begin_provider_switch_transition "$current_profile" "$provider" "$target_window"; then
        message="Explore transition cover is unavailable"
        recover_or_cover_provider_failure "$current_provider" "$current_profile" "$provider" "check_setup" "$message" || true
        fail "$message"
      fi
      transition_shown_ms="$TIKPAL_WEB_MODE_TRANSITION_SHOWN_MS"
      log_stage "open_pool_transition provider=$provider transition_shown=$transition_shown_ms ms=$(( $(now_ms) - started_ms ))"
    fi
  fi
  if [[ -f "$(pool_warm_stamp_file)" ]]; then
    if provider_prewarm_queue_running; then
      if [[ "$entry_stage" == "1" && initial_entry_trace_enabled ]]; then
        initial_entry_pre_reveal_step 50 "$provider" "$initial_entry_phase" prewarm_queue_stop "$target_window" \
          queue_stop stopped_or_idle 1 "$target_window" stop_provider_pool_prewarm || return $?
      else
        stop_provider_pool_prewarm
      fi
    fi
  fi
  # A newer sidebar choice owns the pending request. Do not carry this stale
  # foreground command through another resident reveal while it holds the
  # shared web-mode lock; the server will run the newest request next.
  if [[ "$entry_stage" == "1" && initial_entry_trace_enabled ]]; then
    initial_entry_pre_reveal_step 51 "$provider" "$initial_entry_phase" request_ownership "$target_window" \
      state_check current 0 "$target_window" initial_entry_probe_request_ownership || return $?
  fi
  if ! runtime_open_request_is_current_or_log resident-reveal-start; then
    clear_provider_switch_guard
    log "open abandoned before resident reveal: $provider"
    return 0
  fi
  # A single bounded CDP read can lose a just-woken resident renderer. Retry
  # only after the shared transition has covered the old page, with the normal
  # bootstrap deadline; do not cold-restart a profile that then proves to have
  # a real provider page.
  if [[ "$fast_resident" != "1" && "$entry_stage" != "1" && -n "$target_window" ]] \
    && profile_process_exists "$provider_profile"; then
    if wait_for_real_provider_url "$provider_port"; then
      log_stage "open_pool_bootstrap provider=$provider result=ok ms=$(( $(now_ms) - started_ms ))"
      record_switch_trace_event cdp_fallback_completed recovered
      fast_resident=1
    elif [[ "$resident_status" == "ready" || "$resident_status" == "active" ]]; then
      record_switch_trace_event cdp_fallback_completed failed cdp_not_ready
      write_runtime_provider_status "$provider" "check_setup" "$(provider_label "$provider") did not enter the provider page"
      log_stage "open_pool_bootstrap provider=$provider result=fail ms=$(( $(now_ms) - started_ms ))"
    else
      record_switch_trace_event cdp_fallback_completed failed cdp_not_ready
      log_stage "open_pool_bootstrap provider=$provider result=fail ms=$(( $(now_ms) - started_ms ))"
    fi
  fi
  if [[ "$fast_resident" == "1" && "$entry_stage" != "1" ]]; then
    if [[ "$helper_candidate" != "1" && "$switching_provider" != "1" ]]; then
      stop_window_guard
    fi
    if ! runtime_open_request_is_current_or_log hot-reveal-start; then
      clear_provider_switch_guard
      log "open abandoned before resident reveal: $provider"
      return 0
    fi
    log_open_stage surface_plan_begin "provider=$provider route=$([[ "$helper_candidate" == "1" ]] && printf helper || printf legacy) operations=layout,map,raise target_window=$target_window previous_window=$previous_window panel_window=$panel_window"
    if reveal_resident_provider_window "$target_window" "$current_profile" "$provider_profile" "$transition_shown_ms" "$provider_port" "$previous_window" "$resident_page_ready" \
      "$segment_timing_once" "$cached_xid_ms" "$first_cdp_ms" "$guard_stop_ms" "$panel_retile_ms" \
      "$helper_candidate" "$panel_window" "$panel_profile"; then
      invalidate_chromium_window_cache
      reveal_ms="$(( $(now_ms) - started_ms ))"
      log_stage "reveal_ms=$reveal_ms provider=$provider resident=1"
      log_open_stage surface_plan_end "provider=$provider result=revealed target_window=$target_window reveal_ms=$reveal_ms"
      if ! runtime_open_request_is_current_or_log hot-commit-start; then
        if [[ "$TIKPAL_X11_HELPER_ACTIVE" == "1" ]]; then
          x11_helper_finish_success || fail "X11 helper ownership could not be released after an abandoned switch"
        fi
        log "open abandoned before resident commit: $provider"
        return 0
      fi
      activate_target_provider_audio_gate "$provider" "$provider_port" || true
      commit_visible_provider_state "$provider"
      write_audio_bus_state ""
      record_switch_trace_event runtime_state_committed
      if [[ "$TIKPAL_X11_HELPER_ACTIVE" == "1" ]]; then
        write_guard_window_list "$provider_profile" "$target_window" "$panel_profile" "$panel_window" ||
          fail "Explore guard registry could not be updated before releasing Helper ownership"
        x11_helper_finish_success || fail "X11 helper ownership could not be safely returned to Shell"
        window_guard_running || start_window_guard "$provider_profile" "$panel_profile" "$target_window" "$panel_window"
      else
        start_window_guard "$provider_profile" "$panel_profile" "$target_window" "$panel_window"
      fi
      # The active-provider state and Guard registry now name the new surface;
      # only now may the retained Guard resume its inspect/plan/apply loop.
      clear_provider_switch_guard
      reconcile_provider_pool_in_background "$provider"
      command_return_ms="$(( $(now_ms) - started_ms ))"
      log_stage "command_return_ms=$command_return_ms provider=$provider resident=1"
      log_open_stage opened "provider=$provider target_window=$target_window command_return_ms=$command_return_ms"
      return 0
    fi
    log_open_stage surface_plan_end "provider=$provider result=failed reason=resident_reveal_failed target_window=$target_window"
    # A real CDP page is not permission to commit failed X11 geometry. Restore
    # the old visible owner and leave the resident target available for retry.
    # A failed Helper paint gate intentionally retains its lease. Release it
    # before invoking the Shell-owned recovery mutations below.
    if [[ "$TIKPAL_X11_HELPER_ACTIVE" == "1" ]]; then
      x11_helper_cleanup_active_transaction ||
        fail "X11 helper ownership could not be returned before failed reveal recovery"
    fi
    if provider_has_real_provider_page "$provider_port"; then
      clear_provider_switch_guard
      message="$(provider_label "$provider") window did not reach its physical geometry"
      recover_or_cover_provider_failure "$current_provider" "$current_profile" "$provider" "check_setup" "$message" || true
      fail "$message"
    fi
    log "resident $provider did not paint and CDP confirms no real page; reopening"
    close_provider_profile "$provider_profile"
    fast_resident=0
  fi
  if is_enabled "$TIKPAL_WEB_MODE_EXTENSION_ENABLED" && [[ -f "$TIKPAL_WEB_MODE_EXTENSION_DIR/manifest.json" ]]; then
    extension_enabled=1
  fi

  if [[ "$entry_stage" == "1" && initial_entry_trace_enabled ]]; then
    initial_entry_pre_reveal_step 52 "$provider" "$initial_entry_phase" onboard_hide "$target_window" \
      onboard_hide hidden_or_absent 1 "$target_window" hide_onboard || return $?
  else
    hide_onboard
  fi
  # Use non-hidden mode so the panel is placed at its final position
  # immediately, rather than being staged off-screen and re-tiled later.
  # This makes the side panel visible during the long CDP/provider wait.
  if [[ "$switching_provider" != "1" && "$entry_stage" == "1" && initial_entry_trace_enabled ]]; then
    if initial_entry_pre_reveal_step 53 "$provider" "$initial_entry_phase" side_panel_prepare "$target_window" \
        panel_place "${TIKPAL_WEB_MODE_PANEL_POSITION}_${TIKPAL_WEB_MODE_PANEL_WINDOW}" 1 "$target_window" \
        initial_entry_prepare_side_panel "$provider" 0; then
      TIKPAL_INITIAL_ENTRY_PANEL_WINDOW="$(first_window_for_profile "$panel_profile" || true)"
    else
      close_web_mode
      fail "Explore side panel did not open"
    fi
  elif [[ "$switching_provider" != "1" ]] && ! ensure_side_panel "$provider" 0; then
    close_web_mode
    fail "Explore side panel did not open"
  fi
  if [[ "$entry_stage" == "1" && initial_entry_trace_enabled ]]; then
    initial_entry_pre_reveal_step 54 "$provider" "$initial_entry_phase" proxy_settings "$target_window" \
      settings_read configured 0 "$target_window" initial_entry_load_proxy_settings || return $?
    proxy_line="$TIKPAL_INITIAL_ENTRY_PROXY_LINE"
    initial_entry_pre_reveal_step 55 "$provider" "$initial_entry_phase" proxy_mode "$target_window" \
      proxy_resolve enabled_or_direct 0 "$target_window" initial_entry_resolve_proxy_enabled "$provider" || return $?
    proxy_enabled="$TIKPAL_INITIAL_ENTRY_PROXY_ENABLED"
    if ! initial_entry_pre_reveal_step 56 "$provider" "$initial_entry_phase" proxy_reachability "$target_window" \
        reachability proxy_or_direct 0 "$target_window" initial_entry_proxy_is_available "$provider" "$proxy_enabled"; then
      message="$(provider_needs_proxy_message "$provider")"
      recover_or_cover_provider_failure "$current_provider" "$current_profile" "$provider" "check_proxy" "$message" || true
      fail "$message"
    fi
  else
    proxy_line="$(read_proxy_settings)"
    proxy_enabled="$(effective_provider_proxy_enabled "$provider" "${proxy_line%%$'\t'*}")"
  fi
  if [[ "$entry_stage" != "1" || ! initial_entry_trace_enabled ]] && [[ "$proxy_enabled" != "1" ]] && ! provider_prefers_direct_proxy "$provider" && ! provider_direct_reachable "$provider"; then
    message="$(provider_needs_proxy_message "$provider")"
    recover_or_cover_provider_failure "$current_provider" "$current_profile" "$provider" "check_proxy" "$message" || true
    fail "$message"
  fi
  if [[ "$entry_stage" == "1" && initial_entry_trace_enabled ]]; then
    initial_entry_pre_reveal_step 57 "$provider" "$initial_entry_phase" window_guard_stop \
      "$target_window${TIKPAL_INITIAL_ENTRY_PANEL_WINDOW:+,$TIKPAL_INITIAL_ENTRY_PANEL_WINDOW}" \
      guard_stop stopped 1 "$target_window" stop_window_guard || return $?
  else
    stop_window_guard
  fi
  if [[ "$fast_resident" != "1" ]] && profile_process_exists "$provider_profile"; then
    if [[ "$entry_stage" == "1" && initial_entry_trace_enabled ]]; then
      initial_entry_pre_reveal_step 58 "$provider" "$initial_entry_phase" provider_profile_close "$target_window" \
        profile_close stopped 1 "$target_window" close_provider_profile "$provider_profile" || return $?
    else
      close_provider_profile "$provider_profile"
    fi
  fi

  if profile_process_exists "$provider_profile"; then
    if [[ "$fast_resident" != "1" ]]; then
      if [[ "$entry_stage" == "1" && initial_entry_trace_enabled ]]; then
        initial_entry_pre_reveal_step 59 "$provider" "$initial_entry_phase" provider_guard_start "$target_window" \
          provider_guard started 1 "$target_window" start_provider_guard "$provider" "$provider_profile" \
          "$(provider_url "$provider")" "$proxy_enabled" "$(provider_debug_port "$provider")" || return $?
      else
        start_provider_guard "$provider" "$provider_profile" "$(provider_url "$provider")" "$proxy_enabled" "$(provider_debug_port "$provider")"
      fi
      if [[ "$extension_enabled" == "1" ]] && ! provider_uses_direct_bootstrap "$provider" && ! wait_for_real_provider_url "$(provider_debug_port "$provider")"; then
        message="$(provider_label "$provider") did not enter the provider page"
        recover_or_cover_provider_failure "$current_provider" "$current_profile" "$provider" "check_setup" "$message" || true
        fail "$message"
      fi
    fi
  elif [[ "$entry_stage" == "1" && initial_entry_trace_enabled ]]; then
    if ! initial_entry_pre_reveal_step 60 "$provider" "$initial_entry_phase" provider_launch "$target_window" \
        provider_launch launched 1 "$target_window" launch_provider_for_pool "$provider" entry; then
      message="$(provider_label "$provider") did not enter the provider page"
      recover_or_cover_provider_failure "$current_provider" "$current_profile" "$provider" "check_setup" "$message" || true
      fail "$message"
    fi
  elif ! launch_provider_for_pool "$provider" entry; then
    message="$(provider_label "$provider") did not enter the provider page"
    recover_or_cover_provider_failure "$current_provider" "$current_profile" "$provider" "check_setup" "$message" || true
    fail "$message"
  fi

  if [[ "$entry_stage" == "1" && initial_entry_trace_enabled ]]; then
    if initial_entry_pre_reveal_step 61 "$provider" "$initial_entry_phase" target_window_wait "$target_window" \
        window_wait available 0 "$target_window" initial_entry_wait_for_target_window "$provider_profile" \
        "$(profile_window_timeout_attempts "$TIKPAL_WEB_MODE_PROVIDER_WINDOW_TIMEOUT_SECONDS")"; then
      target_window="$TIKPAL_INITIAL_ENTRY_TARGET_WINDOW"
    else
      target_window=""
    fi
  else
    target_window="$(wait_for_profile_window "$provider_profile" "$(profile_window_timeout_attempts "$TIKPAL_WEB_MODE_PROVIDER_WINDOW_TIMEOUT_SECONDS")" || true)"
  fi
  if [[ -z "$target_window" ]]; then
    message="$(provider_label "$provider") window is unavailable"
    recover_or_cover_provider_failure "$current_provider" "$current_profile" "$provider" "check_setup" "$message" || true
    fail "$(provider_label "$provider") did not open"
  fi
  if [[ "$fast_resident" != "1" && "$entry_stage" == "1" ]]; then
    if [[ "$entry_stage" == "1" && initial_entry_trace_enabled ]]; then
      initial_entry_pre_reveal_step 62 "$provider" "$initial_entry_phase" entry_paint_check "$target_window" \
        paint_check ready_or_warning 0 "$target_window" initial_entry_wait_for_entry_paint_optional || return $?
    else
      wait_for_entry_provider_paint "$(provider_debug_port "$provider")" "$provider" "$target_window" || log "WARN: $(provider_label "$provider") did not complete DOM/X11 paint checks before entry reveal"
    fi
  elif [[ "$fast_resident" != "1" ]]; then
    if ! wait_for_provider_ready "$(provider_debug_port "$provider")" "$provider"; then
      message="$(provider_label "$provider") did not become ready"
      recover_or_cover_provider_failure "$current_provider" "$current_profile" "$provider" "check_setup" "$message" || true
      fail "$message"
    fi
  fi
  log_open_stage target_window_found "provider=$provider target_window=$target_window resident_page_ready=$resident_page_ready"
  log_open_stage surface_plan_begin "provider=$provider route=$([[ "$entry_stage" == "1" ]] && printf initial || printf legacy) operations=layout,map,raise target_window=$target_window"
  if [[ "$entry_stage" == "1" ]]; then
    if [[ "$fast_resident" == "1" ]]; then
      if reveal_resident_initial_entry_surfaces "$target_window" "$provider_profile" "$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel"; then
        :
      else
        initial_entry_status=$?
        log_open_stage surface_plan_end "provider=$provider result=failed reason=initial_entry_reveal_failed target_window=$target_window"
        return "$initial_entry_status"
      fi
    else
      if reveal_initial_entry_surfaces "$target_window" "$provider_profile" "$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel"; then
        :
      else
        initial_entry_status=$?
        log_open_stage surface_plan_end "provider=$provider result=failed reason=initial_entry_reveal_failed target_window=$target_window"
        return "$initial_entry_status"
      fi
    fi
  else
    # Pause old provider media before reveal to prevent audio mixing.
    if [[ "$switching_provider" == "1" && -n "$current_provider" ]]; then
      local _slow_cdp_json="$(timeout 0.8 curl --noproxy '*' -sf --connect-timeout 1 --max-time 1 "http://127.0.0.1:$(provider_debug_port "$current_provider")/json/list" 2>/dev/null || true)"
      pause_provider_media_via_cdp "$(provider_debug_port "$current_provider")" "$_slow_cdp_json" || true
    fi
    if ! reveal_resident_provider_surfaces "$target_window" "$provider_profile" "$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel" "$current_profile" "$transition_shown_ms" "$provider_port"; then
      log_open_stage surface_plan_end "provider=$provider result=failed reason=legacy_reveal_failed target_window=$target_window"
      return 1
    fi
  fi
  log_open_stage surface_plan_end "provider=$provider result=revealed target_window=$target_window"
  if ! runtime_open_request_is_current_or_log provider-commit-start; then
    log "open abandoned before provider commit: $provider"
    return 0
  fi
  activate_target_provider_audio_gate "$provider" "$provider_port" || true
  commit_visible_provider_state "$provider"
  reveal_ms="$(( $(now_ms) - started_ms ))"
  log_stage "reveal_ms=$reveal_ms provider=$provider resident=$fast_resident"
  clear_provider_switch_guard
  write_audio_bus_state ""
  record_switch_trace_event runtime_state_committed
  start_window_guard "$provider_profile" "$panel_profile" "$target_window" "$panel_window"
  reconcile_provider_pool_in_background "$provider"
  command_return_ms="$(( $(now_ms) - started_ms ))"
  log_stage "command_return_ms=$command_return_ms provider=$provider resident=$fast_resident"
  log_open_stage opened "provider=$provider target_window=$target_window command_return_ms=$command_return_ms"
}

open_provider() {
  local provider="$1"
  runtime_open_request_is_current_or_log open-start || return 0
  if is_enabled "$TIKPAL_WEB_MODE_PROVIDER_POOL"; then
    open_provider_pool "$provider"
    return
  fi

  local url
  local provider_profile
  local provider_port
  local current_provider
  local current_profile
  local target_window launch_url extension_enabled=0
  local current_audio_bus="" target_audio_bus="" target_audio_device="" crossfade_switch=0
  local proxy_line proxy_enabled proxy_url
  local message
  local entry_stage=0 switching_provider=0 transition_shown_ms=0 initial_entry_status=0
  url="$(provider_url "$provider")"
  provider_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$provider"
  provider_port="$(provider_debug_port "$provider")"
  current_provider="$(read_runtime_active_provider)"
  current_profile=""
  if [[ -n "$current_provider" ]]; then
    current_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$current_provider"
  else
    entry_stage=1
  fi
  [[ "$entry_stage" != "1" && "$current_provider" != "$provider" ]] && switching_provider=1
  proxy_line="$(read_proxy_settings)"
  proxy_enabled="$(effective_provider_proxy_enabled "$provider" "${proxy_line%%$'\t'*}")"
  proxy_url="${proxy_line#*$'\t'}"
  launch_url="$url"
  if [[ "$proxy_enabled" != "1" ]] && ! provider_prefers_direct_proxy "$provider" && ! provider_direct_reachable "$provider"; then
    message="$(provider_needs_proxy_message "$provider")"
    ensure_side_panel "$provider"
    write_runtime_provider_status "$provider" "check_proxy" "$message"
    recover_or_cover_provider_failure "$current_provider" "$current_profile" "$provider" "check_proxy" "$message" || true
    fail "$message"
  fi
  if is_enabled "$TIKPAL_WEB_MODE_EXTENSION_ENABLED" && [[ -f "$TIKPAL_WEB_MODE_EXTENSION_DIR/manifest.json" ]]; then
    extension_enabled=1
  fi

  resolve_web_mode_audio_devices
  target_audio_device="$TIKPAL_WEB_MODE_ALSA_OUTPUT_DEVICE"

  if crossfade_available; then
    if [[ -n "$current_profile" && "$current_profile" != "$provider_profile" ]] && profile_process_exists "$current_profile"; then
      current_audio_bus="$(profile_audio_bus "$current_profile" || true)"
    fi
    if [[ "$current_audio_bus" == "a" ]]; then
      target_audio_bus="b"
      crossfade_switch=1
    elif [[ "$current_audio_bus" == "b" ]]; then
      target_audio_bus="a"
      crossfade_switch=1
    else
      target_audio_bus="a"
    fi
    if [[ "$crossfade_switch" == "1" ]]; then
      if ! crossfade_helper set "$target_audio_bus" 0 >/dev/null 2>&1; then
        log "WARN: Explore crossfade bus could not be muted; using direct provider audio"
        current_audio_bus=""
        target_audio_bus=""
        target_audio_device="$TIKPAL_WEB_MODE_ALSA_OUTPUT_DEVICE"
        crossfade_switch=0
      else
        target_audio_device="$(crossfade_helper device "$target_audio_bus")"
      fi
    elif crossfade_helper set "$target_audio_bus" 100 >/dev/null 2>&1; then
      target_audio_device="$(crossfade_helper device "$target_audio_bus")"
    else
      log "WARN: Explore crossfade bus could not be initialized; using direct provider audio"
      target_audio_bus=""
    fi
  elif is_enabled "$TIKPAL_WEB_MODE_AUDIO_CROSSFADE_ENABLED"; then
    log "WARN: Explore crossfade is unavailable; using direct provider audio"
  fi

  mkdir -p "$provider_profile"
  ensure_chromium_profile_prefs "$provider_profile"
  hide_onboard
  stop_window_guard
  close_provider_profile "$provider_profile"
  sleep 0.2
  ensure_chromium_profile_prefs "$provider_profile"
  seed_profile_widevine_cdm "$provider_profile"
  refresh_extension_script_cache "$provider_profile"
  if ! ensure_side_panel "$provider" "$entry_stage"; then
    [[ -n "$target_audio_bus" ]] && crossfade_helper set "$target_audio_bus" 0 >/dev/null 2>&1 || true
    close_web_mode
    fail "Explore side panel did not open"
  fi
  if [[ "$switching_provider" == "1" ]]; then
    if ! begin_provider_switch_transition "$current_profile" "$provider"; then
      [[ -n "$target_audio_bus" ]] && crossfade_helper set "$target_audio_bus" 0 >/dev/null 2>&1 || true
      message="Explore transition cover is unavailable"
      recover_or_cover_provider_failure "$current_provider" "$current_profile" "$provider" "check_setup" "$message" || true
      fail "$message"
    fi
    transition_shown_ms="$TIKPAL_WEB_MODE_TRANSITION_SHOWN_MS"
  fi
  mapfile -t flags < <(read_flags)
  mapfile -t base_args < <(chromium_base_args)

  local args=(
    "${flags[@]}"
    "${base_args[@]}"
    "--app=$launch_url"
    "--user-data-dir=$provider_profile"
    "--remote-debugging-address=127.0.0.1"
    "--remote-debugging-port=$provider_port"
    "--window-position=$TIKPAL_WEB_MODE_LEFT_POSITION"
    "--window-size=$(normalize_window_size "$TIKPAL_WEB_MODE_LEFT_WINDOW")"
  )

  if is_enabled "$TIKPAL_WEB_MODE_DISABLE_HANG_MONITOR"; then
    args+=("--disable-hang-monitor")
  fi

  if [[ "$extension_enabled" == "1" ]]; then
    args+=("--load-extension=$TIKPAL_WEB_MODE_EXTENSION_DIR")
  fi
  if [[ -n "$target_audio_device" ]]; then
    args+=("--alsa-output-device=$target_audio_device")
  fi
  if [[ "$proxy_enabled" == "1" && -n "$proxy_url" ]]; then
    args+=("--proxy-server=$proxy_url")
    args+=("--proxy-bypass-list=localhost;127.0.0.1;<local>")
  fi

  DISPLAY="$TIKPAL_KIOSK_DISPLAY" "$TIKPAL_CHROMIUM_BIN" "${args[@]}" >/dev/null 2>&1 9>&- &
  target_window="$(wait_for_profile_window "$provider_profile" "$(profile_window_timeout_attempts "$TIKPAL_WEB_MODE_PROVIDER_WINDOW_TIMEOUT_SECONDS")" || true)"
  if [[ -z "$target_window" ]]; then
    [[ -n "$target_audio_bus" ]] && crossfade_helper set "$target_audio_bus" 0 >/dev/null 2>&1 || true
    close_provider_profile "$provider_profile"
    message="$(provider_label "$provider") did not open"
    recover_or_cover_provider_failure "$current_provider" "$current_profile" "$provider" "check_setup" "$message" || true
    fail "$message"
  fi
  start_provider_guard "$provider" "$provider_profile" "$url" "$proxy_enabled" "$provider_port"
  if [[ "$extension_enabled" == "1" ]] && ! provider_uses_direct_bootstrap "$provider" && ! wait_for_real_provider_url "$provider_port"; then
    [[ -n "$target_audio_bus" ]] && crossfade_helper set "$target_audio_bus" 0 >/dev/null 2>&1 || true
    close_provider_profile "$provider_profile"
    message="$(provider_label "$provider") did not enter the provider page within ${TIKPAL_WEB_MODE_PROVIDER_BOOTSTRAP_TIMEOUT_SECONDS}s"
    recover_or_cover_provider_failure "$current_provider" "$current_profile" "$provider" "check_setup" "$message" || true
    fail "$message"
  fi
  if ! wait_for_provider_ready "$provider_port" "$provider"; then
    [[ -n "$target_audio_bus" ]] && crossfade_helper set "$target_audio_bus" 0 >/dev/null 2>&1 || true
    close_provider_profile "$provider_profile"
    message="$(provider_label "$provider") did not become ready within ${TIKPAL_WEB_MODE_PROVIDER_READY_TIMEOUT_SECONDS}s"
    recover_or_cover_provider_failure "$current_provider" "$current_profile" "$provider" "check_setup" "$message" || true
    fail "$message"
  fi
  if ! runtime_open_request_is_current_or_log provider-reveal-start; then
    log "open abandoned before provider reveal: $provider"
    return 0
  fi
  log_open_stage target_window_found "provider=$provider target_window=$target_window resident_page_ready=1"
  log_open_stage helper_route "provider=$provider result=legacy_selected reason=provider_pool_disabled"
  log_open_stage surface_plan_begin "provider=$provider route=legacy operations=layout,map,raise target_window=$target_window"
  if [[ "$entry_stage" == "1" ]]; then
    if reveal_initial_entry_surfaces "$target_window" "$provider_profile" "$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel"; then
      :
    else
      initial_entry_status=$?
      log_open_stage surface_plan_end "provider=$provider result=failed reason=initial_entry_reveal_failed target_window=$target_window"
      return "$initial_entry_status"
    fi
  else
    if ! reveal_resident_provider_window "$target_window" "$current_profile" "$provider_profile" "$transition_shown_ms" "$provider_port"; then
      log_open_stage surface_plan_end "provider=$provider result=failed reason=legacy_reveal_failed target_window=$target_window"
      return 1
    fi
    reassert_visible_provider_surfaces "$target_window" "$provider_profile" "$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel"
    sleep 0.05
    if [[ "$crossfade_switch" == "1" ]]; then
      if ! crossfade_helper fade "$current_audio_bus" "$target_audio_bus" "$TIKPAL_WEB_MODE_AUDIO_CROSSFADE_MS"; then
        log "WARN: Explore crossfade failed; completing the provider switch at full target gain"
        crossfade_helper set "$target_audio_bus" 100 >/dev/null 2>&1 || true
        crossfade_helper set "$current_audio_bus" 0 >/dev/null 2>&1 || true
      fi
    else
      sleep "$(awk "BEGIN { printf \"%.3f\", $TIKPAL_WEB_MODE_STAGE_REVEAL_MS / 1000 }")"
    fi
    close_other_provider_profiles "$provider_profile"
  fi
  log_open_stage surface_plan_end "provider=$provider result=revealed target_window=$target_window"
  if ! runtime_open_request_is_current_or_log provider-commit-start; then
    log "open abandoned before provider commit: $provider"
    return 0
  fi
  activate_target_provider_audio_gate "$provider" "$provider_port" || true
  write_audio_bus_state "$target_audio_bus"
  commit_visible_provider_state "$provider"
  start_window_guard "$provider_profile" "$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel"
  log_open_stage opened "provider=$provider target_window=$target_window"
}

apply_proxy_settings() {
  local provider="$1"
  local provider_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$provider"
  local proxy_line proxy_enabled message
  if is_enabled "$TIKPAL_WEB_MODE_EXTENSION_ENABLED" && [[ -f "$TIKPAL_WEB_MODE_EXTENSION_DIR/manifest.json" ]]; then
    if ! profile_process_exists "$provider_profile"; then
      message="$(provider_label "$provider") did not open"
      recover_or_cover_provider_failure "" "" "$provider" "check_setup" "$message" || true
      fail "$message"
    fi
    if ! wait_for_proxy_applied; then
      message="$TIKPAL_WEB_MODE_PROXY_CONNECT_ERROR"
      recover_or_cover_provider_failure "" "" "$provider" "check_setup" "$message" || true
      fail "$message"
    fi
    proxy_line="$(read_proxy_settings)"
    proxy_enabled="$(effective_provider_proxy_enabled "$provider" "${proxy_line%%$'\t'*}")"
    if [[ "$proxy_enabled" != "1" ]] && ! provider_prefers_direct_proxy "$provider" && ! provider_direct_reachable "$provider"; then
      message="$(provider_needs_proxy_message "$provider")"
      recover_or_cover_provider_failure "" "" "$provider" "check_proxy" "$message" || true
      [[ -n "$(read_runtime_active_provider)" ]] && start_provider_pool_prewarm "$provider" force
      log "proxy disabled for $provider; marked check_proxy"
      return
    fi
    start_provider_guard "$provider" "$provider_profile" "$(provider_url "$provider")" "$proxy_enabled" "$(provider_debug_port "$provider")"
    if ! wait_for_real_provider_url "$(provider_debug_port "$provider")"; then
      message="$TIKPAL_WEB_MODE_PROXY_CONNECT_ERROR"
      recover_or_cover_provider_failure "" "" "$provider" "check_setup" "$message" || true
      fail "$message"
    fi
    if ! wait_for_provider_ready "$(provider_debug_port "$provider")" "$provider"; then
      message="$TIKPAL_WEB_MODE_PROXY_CONNECT_ERROR"
      recover_or_cover_provider_failure "" "" "$provider" "check_setup" "$message" || true
      fail "$message"
    fi
    start_provider_pool_prewarm "$provider" force
    log "proxy applied without restarting $provider; provider pool prewarm restarted"
    return
  fi
  open_provider "$provider"
}

check_runtime() {
  local xdotool_bin
  resolve_web_mode_audio_devices
  log "app dir: $APP_DIR"
  log "display: $TIKPAL_KIOSK_DISPLAY"
  log "chromium: $TIKPAL_CHROMIUM_BIN"
  log "left: $TIKPAL_WEB_MODE_LEFT_POSITION $(normalize_window_size "$TIKPAL_WEB_MODE_LEFT_WINDOW")"
  log "stage: $TIKPAL_WEB_MODE_STAGE_POSITION"
  log "panel: $TIKPAL_WEB_MODE_PANEL_POSITION $(normalize_window_size "$TIKPAL_WEB_MODE_PANEL_WINDOW")"
  log "audio: ${TIKPAL_WEB_MODE_ALSA_OUTPUT_DEVICE:-default}"
  log "provider ready timeout: ${TIKPAL_WEB_MODE_PROVIDER_READY_TIMEOUT_SECONDS}s"
  log "audio crossfade: $TIKPAL_WEB_MODE_AUDIO_CROSSFADE_ENABLED ${TIKPAL_WEB_MODE_AUDIO_CROSSFADE_MS}ms"
  log "window guard: $TIKPAL_WEB_MODE_WINDOW_GUARD"
  log "single provider window: $TIKPAL_WEB_MODE_SINGLE_PROVIDER_WINDOW"
  log "provider pool: $TIKPAL_WEB_MODE_PROVIDER_POOL"
  log "provider idle pool: $TIKPAL_WEB_MODE_PROVIDER_IDLE_POOL_ENABLED"
  log "provider prewarm: $TIKPAL_WEB_MODE_PROVIDER_PREWARM_ENABLED delay=${TIKPAL_WEB_MODE_PROVIDER_PREWARM_DELAY_SECONDS}s"
  log "provider guard idle poll: ${TIKPAL_WEB_MODE_PROVIDER_GUARD_IDLE_POLL_MS}ms"
  log "popup blocking: $TIKPAL_WEB_MODE_POPUP_BLOCKING"
  log "extension: $TIKPAL_WEB_MODE_EXTENSION_ENABLED $TIKPAL_WEB_MODE_EXTENSION_DIR"
  log "provider text scale: $(read_provider_text_scale)"
  log "proxy apply timeout: ${TIKPAL_WEB_MODE_PROXY_APPLY_TIMEOUT_SECONDS}s"
  log "provider bootstrap timeout: ${TIKPAL_WEB_MODE_PROVIDER_BOOTSTRAP_TIMEOUT_SECONDS}s"
  log "entry provider paint timeout: ${TIKPAL_WEB_MODE_ENTRY_PROVIDER_PAINT_TIMEOUT_SECONDS}s"
  log "provider window timeout: ${TIKPAL_WEB_MODE_PROVIDER_WINDOW_TIMEOUT_SECONDS}s"
  log "provider debug: 127.0.0.1:$TIKPAL_WEB_MODE_PROVIDER_DEBUG_PORT"
  log "provider debug stride: per-provider"
  log "provider guard: $TIKPAL_WEB_MODE_PROVIDER_GUARD"
  log "provider hang monitor: $TIKPAL_WEB_MODE_DISABLE_HANG_MONITOR"
  log "switch lock timeout: ${TIKPAL_WEB_MODE_LOCK_TIMEOUT_SECONDS}s"
  log "warm close: $TIKPAL_WEB_MODE_CLOSE_WARM_ENABLED keep-resident=$TIKPAL_WEB_MODE_CLOSE_KEEP_RESIDENT ttl=${TIKPAL_WEB_MODE_CLOSE_WARM_TTL_SECONDS}s"
  log "error page: $TIKPAL_WEB_MODE_ERROR_PAGE_URL"
  log "onboard: $TIKPAL_WEB_MODE_ONBOARD_POSITION $(normalize_window_size "$TIKPAL_WEB_MODE_ONBOARD_WINDOW")"
  log "onboard input focus: $TIKPAL_WEB_MODE_ONBOARD_AUTO_FOCUS"
  log "qq scoped auto confirm: $TIKPAL_WEB_MODE_QQ_AUTO_CONFIRM"
  log "qq audio prime: $TIKPAL_WEB_MODE_QQ_AUDIO_PRIME"
  log "qq music auto play: $TIKPAL_WEB_MODE_QQ_MUSIC_AUTO_PLAY"
  log "settings: $TIKPAL_WEB_MODE_SETTINGS_PATH"
  read_proxy_settings | awk -F '\t' '{ printf("[tikpal-web-mode] proxy: %s %s\n", $1 == "1" ? "enabled" : "disabled", $2) }'
  [[ -x "$TIKPAL_CHROMIUM_BIN" ]] || fail "Chromium binary is missing or not executable"
  xdotool_bin="$(command -v xdotool || true)"
  [[ -n "$xdotool_bin" ]] || fail "xdotool is required for Explore provider window detection; install with: sudo apt-get install -y xdotool"
  log "xdotool: $xdotool_bin"
  log "check passed"
}

check_runtime_quiet() {
  resolve_web_mode_audio_devices
  [[ -x "$TIKPAL_CHROMIUM_BIN" ]] || fail "Chromium binary is missing or not executable"
  command -v xdotool >/dev/null 2>&1 || fail "xdotool is required for Explore provider window detection"
}

if [[ "${TIKPAL_WEB_MODE_SOURCE_ONLY:-0}" == "1" ]]; then
  [[ "${BASH_SOURCE[0]}" != "$0" ]] || fail "TIKPAL_WEB_MODE_SOURCE_ONLY requires sourcing"
  return 0
fi

x11_trace_require_writable ||
  fail "TRACE_NOT_WRITABLE: $TIKPAL_WEB_MODE_X11_MUTATION_TRACE_PATH"

trap x11_helper_cleanup_on_exit EXIT

case "${1:-open}" in
  --check)
    check_runtime
    ;;
  open)
    check_runtime_quiet
    with_web_mode_lock open_provider "${2:-qq_music}"
    ;;
  prepare-entry)
    check_runtime_quiet
    with_web_mode_lock prepare_entry_surfaces "${2:-qq_music}"
    ;;
  park-entry)
    with_web_mode_lock park_prepared_entry_surfaces
    ;;
  close)
    with_web_mode_lock close_web_mode
    log "closed"
    ;;
  close-full)
    with_web_mode_lock close_web_mode_full
    log "closed full"
    ;;
  cleanup-warm)
    cleanup_ttl="$TIKPAL_WEB_MODE_CLOSE_WARM_TTL_SECONDS"
    [[ "$cleanup_ttl" =~ ^[0-9]+([.][0-9]+)?$ ]] || cleanup_ttl=45
    sleep "$cleanup_ttl"
    with_web_mode_lock cleanup_warm_web_mode
    log "warm cleanup checked"
    ;;
  warm-pool)
    warm_provider_pool
    ;;
  guard)
    run_window_guard "${2:-}" "${3:-}"
    ;;
  guard-state)
    window_guard_state
    ;;
  reload-guard)
    provider_id="${2:-$(read_runtime_active_provider)}"
    provider_ids | grep -Fx -- "$provider_id" >/dev/null || fail "Unknown provider: $provider_id"
    with_web_mode_lock reload_window_guard \
      "$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$provider_id" \
      "$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel"
    ;;
  stop-owned-guard)
    stop_window_guard_owned "${2:-}" "${3:-}"
    ;;
  restore-helper-owner)
    with_web_mode_lock x11_helper_restore_shell_owner
    ;;
  prewarm)
    prewarm_provider_pool "${2:-}"
    ;;
  reconcile)
    reconcile_provider_pool "${2:-}" "${3:-}"
    ;;
  sync-status)
    sync_runtime_provider_pool_process_statuses "$(read_runtime_active_provider)"
    ;;
  provider-status)
    provider_id="${2:-}"
    provider_status="${3:-}"
    if ! provider_ids | grep -Fx -- "$provider_id" >/dev/null; then
      fail "Unknown provider: $provider_id"
    fi
    case "$provider_status" in
      ready|active)
        if provider_has_real_provider_page "$(provider_debug_port "$provider_id")"; then
          write_runtime_provider_status "$provider_id" "$provider_status"
        elif [[ "$provider_status" == "active" && "$(read_runtime_active_provider)" != "$provider_id" ]]; then
          # A stale guard must not overwrite a confirmed Ready card while its
          # asynchronous diagnostics decide whether this is terminal.
          log "ignored stale provider-status active for $provider_id without a real HTTPS page"
        fi
        ;;
      *) fail "Provider status must be ready or active" ;;
    esac
    ;;
  refresh-guards)
    refresh_provider_pool_guards
    ;;
  keyboard)
    case "${2:-toggle}" in
      preload) with_onboard_lock preload_onboard ;;
      show) with_onboard_lock ensure_onboard ;;
      show-force) with_onboard_lock force_onboard ;;
      keepalive) with_onboard_lock keepalive_onboard ;;
      hide) with_onboard_lock hide_onboard ;;
      toggle) with_onboard_lock toggle_onboard ;;
      *) fail "Keyboard mode must be preload, show, show-force, keepalive, hide, or toggle" ;;
    esac
    log "keyboard ${2:-toggle} ready"
    ;;
  proxy)
    check_runtime_quiet
    with_web_mode_lock apply_proxy_settings "${2:-spotify}"
    ;;
  *)
    fail "Usage: $0 open <provider>|prepare-entry <provider>|park-entry|close|close-full|cleanup-warm|warm-pool|prewarm <provider>|reconcile <provider> [started-ms]|sync-status|refresh-guards|guard-state|reload-guard [provider]|stop-owned-guard <pid> <starttime>|restore-helper-owner|keyboard [show|hide|toggle]|proxy <provider>|--check"
    ;;
esac

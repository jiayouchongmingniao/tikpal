#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="${TIKPAL_KIOSK_ENV_FILE:-$APP_DIR/.env.kiosk}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

: "${TIKPAL_KIOSK_WATCHDOG_ENABLED:=1}"
: "${TIKPAL_KIOSK_WATCHDOG_STATE_DIR:=/run/tikpal-kiosk-watchdog}"
: "${TIKPAL_KIOSK_WATCHDOG_FAILURE_THRESHOLD:=1}"
: "${TIKPAL_KIOSK_WATCHDOG_RESTART_COOLDOWN_SECONDS:=120}"
: "${TIKPAL_KIOSK_WATCHDOG_REBOOT_AFTER_RESTARTS:=3}"
: "${TIKPAL_KIOSK_WATCHDOG_REBOOT_WINDOW_SECONDS:=900}"
: "${TIKPAL_KIOSK_WATCHDOG_REBOOT_COMMAND:=systemctl reboot}"
: "${TIKPAL_KIOSK_WATCHDOG_X_TIMEOUT_SECONDS:=5}"
: "${TIKPAL_KIOSK_WATCHDOG_WEB_TIMEOUT_SECONDS:=3}"
: "${TIKPAL_KIOSK_WATCHDOG_LOG_TIMEOUT_SECONDS:=3}"
: "${TIKPAL_KIOSK_WATCHDOG_RESTART_TIMEOUT_SECONDS:=20}"
: "${TIKPAL_KIOSK_WATCHDOG_GPU_LOG_SCAN:=1}"
: "${TIKPAL_KIOSK_WATCHDOG_X_DISPLAY_SCAN:=1}"
: "${TIKPAL_KIOSK_WATCHDOG_CHROMIUM_PROCESS_SCAN:=1}"
: "${TIKPAL_KIOSK_WATCHDOG_WEB_URL_SCAN:=1}"
: "${TIKPAL_KIOSK_WATCHDOG_API_URL_SCAN:=1}"
: "${TIKPAL_KIOSK_WATCHDOG_PAGE_HEARTBEAT_ENABLED:=1}"
: "${TIKPAL_KIOSK_WATCHDOG_PAGE_HEARTBEAT_URL:=http://127.0.0.1:8787/api/v1/kiosk/heartbeat}"
: "${TIKPAL_KIOSK_WATCHDOG_WEB_MODE_HEARTBEAT_BYPASS:=1}"
: "${TIKPAL_KIOSK_WATCHDOG_DRY_RUN:=0}"
: "${TIKPAL_KIOSK_WATCHDOG_SERVICE:=tikpal-kiosk.service}"
: "${TIKPAL_KIOSK_PHYSICAL_DISPLAY_CHECK_ENABLED:=0}"
: "${TIKPAL_KIOSK_PHYSICAL_DISPLAY_PREPARE_COMMAND:=/usr/local/sbin/tikpal-physical-display-prepare}"
: "${TIKPAL_KIOSK_PHYSICAL_DISPLAY_SOFT_KICK_BEFORE_RESTART:=1}"
: "${TIKPAL_KIOSK_PHYSICAL_DISPLAY_GPU_REBIND_BEFORE_RESTART:=0}"
: "${TIKPAL_KIOSK_WATCHDOG_API_URL:=http://127.0.0.1:8787/api/v1/health}"
: "${TIKPAL_KIOSK_URL:=http://localhost:4173/}"
: "${TIKPAL_KIOSK_DISPLAY:=:0}"
: "${TIKPAL_KIOSK_SERVICE_USER:=moode}"
: "${TIKPAL_WEB_MODE_PROFILE_ROOT:=$HOME/.config/tikpal-web-mode}"
: "${TIKPAL_WEB_MODE_STATE_PATH:=$APP_DIR/.tikpal/web-mode-state.json}"
: "${TIKPAL_KIOSK_X_SESSION_GENERATION_PATH:=$APP_DIR/.tikpal/kiosk-x-session-generation}"

MODE="run"
if [[ "${1:-}" == "--check" ]]; then
  MODE="check"
fi

log() {
  printf '[tikpal-kiosk-watchdog] %s\n' "$*"
}

is_enabled() {
  local value
  value="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "$value" in
    1|true|yes|on|enabled)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

run_with_timeout() {
  local seconds="$1"
  shift
  if command -v timeout >/dev/null 2>&1; then
    timeout -k 2s "${seconds}s" "$@"
    return
  fi
  "$@"
}

print_check() {
  log "app dir: $APP_DIR"
  log "env file: $ENV_FILE"
  log "watchdog enabled: $TIKPAL_KIOSK_WATCHDOG_ENABLED"
  log "state dir: $TIKPAL_KIOSK_WATCHDOG_STATE_DIR"
  log "kiosk service: $TIKPAL_KIOSK_WATCHDOG_SERVICE"
  log "display: $TIKPAL_KIOSK_DISPLAY"
  log "kiosk url: $TIKPAL_KIOSK_URL"
  log "api url: $TIKPAL_KIOSK_WATCHDOG_API_URL"
  log "failure threshold: $TIKPAL_KIOSK_WATCHDOG_FAILURE_THRESHOLD"
  log "restart cooldown: ${TIKPAL_KIOSK_WATCHDOG_RESTART_COOLDOWN_SECONDS}s"
  log "reboot after restarts: $TIKPAL_KIOSK_WATCHDOG_REBOOT_AFTER_RESTARTS"
  log "reboot window: ${TIKPAL_KIOSK_WATCHDOG_REBOOT_WINDOW_SECONDS}s"
  log "gpu log scan: $TIKPAL_KIOSK_WATCHDOG_GPU_LOG_SCAN"
  log "x display scan: $TIKPAL_KIOSK_WATCHDOG_X_DISPLAY_SCAN"
  log "chromium process scan: $TIKPAL_KIOSK_WATCHDOG_CHROMIUM_PROCESS_SCAN"
  log "web url scan: $TIKPAL_KIOSK_WATCHDOG_WEB_URL_SCAN"
  log "api url scan: $TIKPAL_KIOSK_WATCHDOG_API_URL_SCAN"
  log "page heartbeat enabled: $TIKPAL_KIOSK_WATCHDOG_PAGE_HEARTBEAT_ENABLED"
  log "page heartbeat url: $TIKPAL_KIOSK_WATCHDOG_PAGE_HEARTBEAT_URL"
  log "web mode heartbeat bypass: $TIKPAL_KIOSK_WATCHDOG_WEB_MODE_HEARTBEAT_BYPASS"
  log "web mode profile root: $TIKPAL_WEB_MODE_PROFILE_ROOT"
  log "web mode state path: $TIKPAL_WEB_MODE_STATE_PATH"
  log "X session generation path: $TIKPAL_KIOSK_X_SESSION_GENERATION_PATH"
  log "physical display check: $TIKPAL_KIOSK_PHYSICAL_DISPLAY_CHECK_ENABLED"
  log "physical display prepare: $TIKPAL_KIOSK_PHYSICAL_DISPLAY_PREPARE_COMMAND"
  log "physical display soft-kick before restart: $TIKPAL_KIOSK_PHYSICAL_DISPLAY_SOFT_KICK_BEFORE_RESTART"
  log "physical display GPU rebind before restart: $TIKPAL_KIOSK_PHYSICAL_DISPLAY_GPU_REBIND_BEFORE_RESTART"
  log "dry run: $TIKPAL_KIOSK_WATCHDOG_DRY_RUN"

  [[ -d "$APP_DIR/deploy/chromium" ]] || {
    log "ERROR: missing deploy/chromium under $APP_DIR"
    exit 1
  }

  command -v curl >/dev/null 2>&1 || log "WARN: curl is missing; web/API probes will be skipped"
  command -v pgrep >/dev/null 2>&1 || log "WARN: pgrep is missing; Chromium process probe will be skipped"
  command -v timeout >/dev/null 2>&1 || log "WARN: timeout is missing; probes will not be bounded"
  command -v systemctl >/dev/null 2>&1 || log "WARN: systemctl is missing; restart recovery is unavailable"
  log "check passed"
}

if [[ "$MODE" == "check" ]]; then
  print_check
  exit 0
fi

if ! is_enabled "$TIKPAL_KIOSK_WATCHDOG_ENABLED"; then
  exit 0
fi

mkdir -p "$TIKPAL_KIOSK_WATCHDOG_STATE_DIR"

if command -v flock >/dev/null 2>&1; then
  exec 9>"$TIKPAL_KIOSK_WATCHDOG_STATE_DIR/healthcheck.lock"
  if ! flock -n 9; then
    log "another healthcheck is still running; skipping"
    exit 0
  fi
fi

read_state_number() {
  local file="$1"
  local fallback="$2"
  local raw
  raw="$(cat "$file" 2>/dev/null || true)"
  if [[ "$raw" =~ ^[0-9]+$ ]]; then
    printf '%s\n' "$raw"
  else
    printf '%s\n' "$fallback"
  fi
}

write_state_number() {
  local file="$1"
  local value="$2"
  printf '%s\n' "$value" > "$file"
}

find_xauthority() {
  if [[ -n "${XAUTHORITY:-}" && -r "$XAUTHORITY" ]]; then
    printf '%s\n' "$XAUTHORITY"
    return 0
  fi

  local xorg_auth
  xorg_auth="$(
    ps -eo args= 2>/dev/null \
      | awk '
        /(^|[\/ ])X(org)?([[:space:]]|$)/ {
          for (i = 1; i <= NF; i++) {
            if ($i == "-auth" && i + 1 <= NF) {
              print $(i + 1)
            }
          }
        }
      ' \
      | tail -1
  )"
  if [[ -n "$xorg_auth" && -r "$xorg_auth" ]]; then
    printf '%s\n' "$xorg_auth"
    return 0
  fi

  local candidate
  for candidate in "/home/$TIKPAL_KIOSK_SERVICE_USER/.Xauthority" "$HOME/.Xauthority"; do
    if [[ -r "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

check_x_display() {
  local xauth
  xauth="$(find_xauthority || true)"
  local env_args=(env "DISPLAY=$TIKPAL_KIOSK_DISPLAY")
  if [[ -n "$xauth" ]]; then
    env_args+=("XAUTHORITY=$xauth")
  fi

  if command -v xdpyinfo >/dev/null 2>&1; then
    run_with_timeout "$TIKPAL_KIOSK_WATCHDOG_X_TIMEOUT_SECONDS" "${env_args[@]}" xdpyinfo -display "$TIKPAL_KIOSK_DISPLAY" >/dev/null 2>&1
    return
  fi

  if command -v xset >/dev/null 2>&1; then
    run_with_timeout "$TIKPAL_KIOSK_WATCHDOG_X_TIMEOUT_SECONDS" "${env_args[@]}" xset q >/dev/null 2>&1
    return
  fi

  return 0
}

check_chromium_process() {
  command -v pgrep >/dev/null 2>&1 || return 0
  pgrep -af 'chrom(e|ium)' 2>/dev/null | grep -F -- "$TIKPAL_KIOSK_URL" >/dev/null 2>&1
}

check_physical_display() {
  is_enabled "$TIKPAL_KIOSK_PHYSICAL_DISPLAY_CHECK_ENABLED" || return 0
  [[ -x "$TIKPAL_KIOSK_PHYSICAL_DISPLAY_PREPARE_COMMAND" ]] || return 0
  run_with_timeout "$TIKPAL_KIOSK_WATCHDOG_X_TIMEOUT_SECONDS" \
    "$TIKPAL_KIOSK_PHYSICAL_DISPLAY_PREPARE_COMMAND" --check >/dev/null 2>&1
}

check_http_url() {
  local url="$1"
  command -v curl >/dev/null 2>&1 || return 0
  run_with_timeout "$TIKPAL_KIOSK_WATCHDOG_WEB_TIMEOUT_SECONDS" \
    curl -fsS --max-time "$TIKPAL_KIOSK_WATCHDOG_WEB_TIMEOUT_SECONDS" "$url" >/dev/null 2>&1
}

sanitize_reason_detail() {
  printf '%s' "$1" | tr -c 'A-Za-z0-9_.:-' '_' | cut -c 1-120
}

page_heartbeat_detail=""
web_mode_bypass_reason="none"
web_mode_active_provider="none"
web_mode_opening_provider="none"
web_mode_open_request_id="none"
web_mode_open_started_at="none"
web_mode_x_session_generation="none"
web_mode_current_x_session_generation="none"
web_mode_provider_active() {
  is_enabled "$TIKPAL_KIOSK_WATCHDOG_WEB_MODE_HEARTBEAT_BYPASS" || return 1
  [[ -r "$TIKPAL_WEB_MODE_STATE_PATH" ]] || return 1
  if command -v node >/dev/null 2>&1; then
    local result status
    set +e
    result="$(node -e '
      const fs = require("node:fs");
      try {
        const state = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        const activeProvider = typeof state.activeProvider === "string" && state.activeProvider.trim();
        const openingProvider = typeof state.openingProvider === "string" && state.openingProvider.trim();
        const openRequestId = typeof state.openRequestId === "string" && state.openRequestId.trim();
        const openStartedAt = typeof state.openStartedAt === "string" && state.openStartedAt.trim();
        const xSessionGeneration = typeof state.openXSessionGeneration === "string" && state.openXSessionGeneration.trim();
        const closeRequestId = typeof state.closeRequestId === "string" && state.closeRequestId.trim();
        let currentXSessionGeneration = "";
        try {
          currentXSessionGeneration = fs.readFileSync(process.argv[2], "utf8").trim();
        } catch {}
        const openingRequestCurrent = openingProvider && openRequestId && xSessionGeneration
          && xSessionGeneration === currentXSessionGeneration;
        const reason = activeProvider
          ? "active-provider"
          : openingRequestCurrent
            ? "opening-request"
            : openingProvider && openRequestId && xSessionGeneration
              ? "stale-opening-request"
            : closeRequestId
              ? "close-request"
              : "none";
        console.log([reason, activeProvider || "none", openingProvider || "none", openRequestId || "none", openStartedAt || "none", xSessionGeneration || "none", currentXSessionGeneration || "none"].join("\t"));
        process.exit(reason === "active-provider" || reason === "opening-request" || reason === "close-request" ? 0 : 1);
      } catch {
        process.exit(1);
      }
    ' "$TIKPAL_WEB_MODE_STATE_PATH" "$TIKPAL_KIOSK_X_SESSION_GENERATION_PATH" 2>/dev/null)"
    status="$?"
    set -e
    if [[ -n "$result" ]]; then
      IFS=$'\t' read -r web_mode_bypass_reason web_mode_active_provider web_mode_opening_provider \
        web_mode_open_request_id web_mode_open_started_at web_mode_x_session_generation \
        web_mode_current_x_session_generation <<< "$result"
    fi
    return "$status"
  fi
  if grep -Eq '"(activeProvider|closeRequestId)"[[:space:]]*:[[:space:]]*"[^\"]+"' "$TIKPAL_WEB_MODE_STATE_PATH"; then
    web_mode_bypass_reason="legacy-state"
    return 0
  fi
  return 1
}

log_page_heartbeat_decision() {
  local decision="$1" reason="$2" ready_state="$3" current_time="$4" health="$5" stalled="$6" not_ready="$7"
  log "heartbeat decision=$decision reason=$(sanitize_reason_detail "$reason") bypass_reason=$web_mode_bypass_reason active_provider=$web_mode_active_provider opening_provider=$web_mode_opening_provider open_request_id=$web_mode_open_request_id open_started_at=$web_mode_open_started_at x_session_generation=$web_mode_x_session_generation current_x_session_generation=$web_mode_current_x_session_generation scene_ready_state=$ready_state scene_current_time=$current_time scene_health=$health scene_stalled=$stalled scene_not_ready=$not_ready"
}

check_page_heartbeat() {
  page_heartbeat_detail=""
  is_enabled "$TIKPAL_KIOSK_WATCHDOG_PAGE_HEARTBEAT_ENABLED" || return 0
  command -v curl >/dev/null 2>&1 || return 0
  local bypass=0
  web_mode_provider_active && bypass=1

  local body
  if ! body="$(
    run_with_timeout "$TIKPAL_KIOSK_WATCHDOG_WEB_TIMEOUT_SECONDS" \
      curl -fsS --max-time "$TIKPAL_KIOSK_WATCHDOG_WEB_TIMEOUT_SECONDS" \
      "$TIKPAL_KIOSK_WATCHDOG_PAGE_HEARTBEAT_URL" 2>/dev/null
  )"; then
    if [[ "$bypass" == "1" ]]; then
      log_page_heartbeat_decision bypass heartbeat-request-failed unknown unknown unknown unknown unknown
      return 0
    fi
    page_heartbeat_detail="heartbeat-request-failed"
    log_page_heartbeat_decision restart "$page_heartbeat_detail" unknown unknown unknown unknown unknown
    return 1
  fi

  if command -v node >/dev/null 2>&1; then
    local result
    local heartbeat_status heartbeat_reason ready_state current_time scene_health scene_stalled scene_not_ready
    result="$(
      PAGE_HEARTBEAT_BODY="$body" node -e '
        let data;
        try {
          data = JSON.parse(process.env.PAGE_HEARTBEAT_BODY || "{}");
        } catch {
          console.log(["unhealthy", "heartbeat-invalid-json", "unknown", "unknown", "unknown", "0", "0"].join("\t"));
          process.exit(0);
        }
        const reasons = Array.isArray(data.reasons) ? data.reasons.join("+") : "";
        const video = data.heartbeat && typeof data.heartbeat.activeSceneVideo === "object" ? data.heartbeat.activeSceneVideo : {};
        const reason = data.healthy === true ? "healthy" : reasons || data.status || "heartbeat-unhealthy";
        const stalled = video.health === "stalled" || reasons.includes("scene-video-stalled");
        const notReady = reasons.includes("scene-video-not-ready");
        console.log([
          data.healthy === true ? "healthy" : "unhealthy",
          reason,
          Number.isFinite(Number(video.readyState)) ? String(video.readyState) : "unknown",
          Number.isFinite(Number(video.currentTime)) ? String(video.currentTime) : "unknown",
          String(video.health || "unknown"),
          stalled ? "1" : "0",
          notReady ? "1" : "0"
        ].join("\t"));
      ' 2>/dev/null
    )"
    IFS=$'\t' read -r heartbeat_status heartbeat_reason ready_state current_time scene_health scene_stalled scene_not_ready <<< "$result"
    if [[ "$bypass" == "1" ]]; then
      log_page_heartbeat_decision bypass "$heartbeat_reason" "$ready_state" "$current_time" "$scene_health" "$scene_stalled" "$scene_not_ready"
      return 0
    fi
    if [[ "$heartbeat_status" == "healthy" ]]; then
      log_page_heartbeat_decision healthy "$heartbeat_reason" "$ready_state" "$current_time" "$scene_health" "$scene_stalled" "$scene_not_ready"
      return 0
    fi
    page_heartbeat_detail="$(sanitize_reason_detail "$heartbeat_reason")"
    log_page_heartbeat_decision restart "$page_heartbeat_detail" "$ready_state" "$current_time" "$scene_health" "$scene_stalled" "$scene_not_ready"
    return 1
  fi

  if [[ "$bypass" == "1" ]]; then
    log_page_heartbeat_decision bypass legacy-parser unknown unknown unknown unknown unknown
    return 0
  fi
  if printf '%s\n' "$body" | grep -Eq '"healthy"[[:space:]]*:[[:space:]]*true'; then
    log_page_heartbeat_decision healthy legacy-parser unknown unknown unknown unknown unknown
    return 0
  fi

  page_heartbeat_detail="heartbeat-unhealthy"
  log_page_heartbeat_decision restart "$page_heartbeat_detail" unknown unknown unknown unknown unknown
  return 1
}

check_gpu_log() {
  is_enabled "$TIKPAL_KIOSK_WATCHDOG_GPU_LOG_SCAN" || return 0
  command -v journalctl >/dev/null 2>&1 || return 0

  local marker_file="$TIKPAL_KIOSK_WATCHDOG_STATE_DIR/last-gpu-scan-epoch"
  local now
  now="$(date +%s)"
  if [[ ! -f "$marker_file" ]]; then
    write_state_number "$marker_file" "$now"
    return 0
  fi

  local since
  since="$(read_state_number "$marker_file" "$now")"
  local kernel_log
  kernel_log="$(
    run_with_timeout "$TIKPAL_KIOSK_WATCHDOG_LOG_TIMEOUT_SECONDS" \
      journalctl -k --since "@$since" --no-pager -n 200 2>/dev/null || true
  )"
  write_state_number "$marker_file" "$now"

  if printf '%s\n' "$kernel_log" \
    | grep -Eiq 'v3d.*(MMU error|Resetting GPU|timedout|hang)|drm_sched_job_timedout|v3d_(render|bin)_job_timedout'; then
    return 1
  fi

  return 0
}

restart_kiosk() {
  local reason="$1"
  local service="$TIKPAL_KIOSK_WATCHDOG_SERVICE"
  local now
  now="$(date +%s)"

  write_state_number "$TIKPAL_KIOSK_WATCHDOG_STATE_DIR/last-restart-epoch" "$now"
  if is_enabled "$TIKPAL_KIOSK_WATCHDOG_DRY_RUN"; then
    log "dry-run restart suppressed for $service: $reason"
    return 0
  fi

  if ! command -v systemctl >/dev/null 2>&1; then
    log "unhealthy: $reason; systemctl is unavailable"
    return 1
  fi

  log "restarting $service: $reason"

  if run_with_timeout "$TIKPAL_KIOSK_WATCHDOG_RESTART_TIMEOUT_SECONDS" systemctl restart "$service"; then
    log "restart requested for $service"
    return 0
  fi

  log "normal restart failed or timed out; killing $service cgroup"
  systemctl kill -s SIGKILL "$service" >/dev/null 2>&1 || true
  systemctl reset-failed "$service" >/dev/null 2>&1 || true
  run_with_timeout "$TIKPAL_KIOSK_WATCHDOG_RESTART_TIMEOUT_SECONDS" systemctl start "$service"
}

has_display_stack_reason() {
  local reason="$1"
  [[ "$reason" == *"x-unresponsive"* || "$reason" == *"v3d-reset"* || "$reason" == *"physical-display-unhealthy"* ]]
}

try_physical_display_soft_recover() {
  local reason="$1"
  is_enabled "$TIKPAL_KIOSK_PHYSICAL_DISPLAY_SOFT_KICK_BEFORE_RESTART" || return 1
  [[ "$reason" == *"physical-display-unhealthy"* || "$reason" == *"x-unresponsive"* || "$reason" == *"v3d-reset"* ]] || return 1
  [[ -x "$TIKPAL_KIOSK_PHYSICAL_DISPLAY_PREPARE_COMMAND" ]] || return 1

  log "trying physical display soft-kick before kiosk restart: $reason"
  if is_enabled "$TIKPAL_KIOSK_WATCHDOG_DRY_RUN"; then
    log "dry-run physical display soft-kick suppressed"
    return 1
  fi

  run_with_timeout "$TIKPAL_KIOSK_WATCHDOG_RESTART_TIMEOUT_SECONDS" \
    "$TIKPAL_KIOSK_PHYSICAL_DISPLAY_PREPARE_COMMAND" soft-kick >/dev/null 2>&1 || return 1
  check_physical_display || return 1
  check_x_display || return 1
  log "physical display recovered without restarting $TIKPAL_KIOSK_WATCHDOG_SERVICE"
  return 0
}

try_physical_display_gpu_rebind_recover() {
  local reason="$1"
  is_enabled "$TIKPAL_KIOSK_PHYSICAL_DISPLAY_GPU_REBIND_BEFORE_RESTART" || return 1
  has_display_stack_reason "$reason" || return 1
  [[ -x "$TIKPAL_KIOSK_PHYSICAL_DISPLAY_PREPARE_COMMAND" ]] || return 1

  log "trying physical display GPU rebind before kiosk restart: $reason"
  if is_enabled "$TIKPAL_KIOSK_WATCHDOG_DRY_RUN"; then
    log "dry-run physical display GPU rebind suppressed"
    return 1
  fi
  command -v systemctl >/dev/null 2>&1 || return 1

  systemctl stop "$TIKPAL_KIOSK_WATCHDOG_SERVICE" >/dev/null 2>&1 || true
  run_with_timeout "$TIKPAL_KIOSK_WATCHDOG_RESTART_TIMEOUT_SECONDS" \
    "$TIKPAL_KIOSK_PHYSICAL_DISPLAY_PREPARE_COMMAND" nouveau-rebind >/dev/null 2>&1 || return 1
  run_with_timeout "$TIKPAL_KIOSK_WATCHDOG_RESTART_TIMEOUT_SECONDS" \
    systemctl start "$TIKPAL_KIOSK_WATCHDOG_SERVICE" || return 1
  sleep 8
  run_with_timeout "$TIKPAL_KIOSK_WATCHDOG_RESTART_TIMEOUT_SECONDS" \
    "$TIKPAL_KIOSK_PHYSICAL_DISPLAY_PREPARE_COMMAND" soft-kick >/dev/null 2>&1 || true
  check_physical_display || return 1
  check_x_display || return 1
  check_chromium_process || return 1
  log "physical display recovered with GPU rebind"
  return 0
}

next_restart_count() {
  local now="$1"
  local window_file="$TIKPAL_KIOSK_WATCHDOG_STATE_DIR/restart-window-epoch"
  local count_file="$TIKPAL_KIOSK_WATCHDOG_STATE_DIR/restart-count"
  local window_start
  local count
  local window_seconds="$TIKPAL_KIOSK_WATCHDOG_REBOOT_WINDOW_SECONDS"

  if ! [[ "$window_seconds" =~ ^[0-9]+$ ]] || [[ "$window_seconds" -lt 60 ]]; then
    window_seconds=900
  fi

  window_start="$(read_state_number "$window_file" 0)"
  if [[ "$window_start" -eq 0 || $((now - window_start)) -gt "$window_seconds" ]]; then
    write_state_number "$window_file" "$now"
    write_state_number "$count_file" "1"
    printf '1\n'
    return
  fi

  count="$(read_state_number "$count_file" 0)"
  count=$((count + 1))
  write_state_number "$count_file" "$count"
  printf '%s\n' "$count"
}

maybe_reboot_for_persistent_display_failure() {
  local reason="$1"
  local now="$2"
  local limit="$TIKPAL_KIOSK_WATCHDOG_REBOOT_AFTER_RESTARTS"

  has_display_stack_reason "$reason" || return 1
  if ! [[ "$limit" =~ ^[0-9]+$ ]] || [[ "$limit" -lt 1 ]]; then
    return 1
  fi

  local count
  count="$(next_restart_count "$now")"
  if [[ "$count" -lt "$limit" ]]; then
    return 1
  fi

  log "persistent display failure after $count restart attempts; rebooting: $reason"
  run_with_timeout "$TIKPAL_KIOSK_WATCHDOG_RESTART_TIMEOUT_SECONDS" sh -lc "$TIKPAL_KIOSK_WATCHDOG_REBOOT_COMMAND"
}

reasons=()

if is_enabled "$TIKPAL_KIOSK_WATCHDOG_X_DISPLAY_SCAN"; then
  check_x_display || reasons+=("x-unresponsive")
fi
if is_enabled "$TIKPAL_KIOSK_WATCHDOG_CHROMIUM_PROCESS_SCAN"; then
  check_chromium_process || reasons+=("chromium-missing")
fi
check_physical_display || reasons+=("physical-display-unhealthy")
if is_enabled "$TIKPAL_KIOSK_WATCHDOG_WEB_URL_SCAN"; then
  check_http_url "$TIKPAL_KIOSK_URL" || reasons+=("web-unhealthy")
fi
if is_enabled "$TIKPAL_KIOSK_WATCHDOG_API_URL_SCAN"; then
  check_http_url "$TIKPAL_KIOSK_WATCHDOG_API_URL" || reasons+=("api-unhealthy")
fi
check_page_heartbeat || reasons+=("page-unhealthy${page_heartbeat_detail:+:$page_heartbeat_detail}")
check_gpu_log || reasons+=("v3d-reset")

failure_file="$TIKPAL_KIOSK_WATCHDOG_STATE_DIR/failure-count"
restart_file="$TIKPAL_KIOSK_WATCHDOG_STATE_DIR/last-restart-epoch"

if [[ "${#reasons[@]}" -eq 0 ]]; then
  write_state_number "$failure_file" "0"
  write_state_number "$TIKPAL_KIOSK_WATCHDOG_STATE_DIR/restart-count" "0"
  write_state_number "$TIKPAL_KIOSK_WATCHDOG_STATE_DIR/restart-window-epoch" "0"
  if is_enabled "${TIKPAL_KIOSK_WATCHDOG_LOG_HEALTHY:-0}"; then
    log "healthy"
  fi
  exit 0
fi

failure_count="$(read_state_number "$failure_file" 0)"
failure_count=$((failure_count + 1))
write_state_number "$failure_file" "$failure_count"

reason="$(IFS=,; printf '%s' "${reasons[*]}")"
threshold="$TIKPAL_KIOSK_WATCHDOG_FAILURE_THRESHOLD"
if ! [[ "$threshold" =~ ^[0-9]+$ ]] || [[ "$threshold" -lt 1 ]]; then
  threshold=1
fi

if [[ "$failure_count" -lt "$threshold" ]]; then
  log "unhealthy: $reason; waiting for threshold $failure_count/$threshold"
  exit 0
fi

now="$(date +%s)"
last_restart="$(read_state_number "$restart_file" 0)"
cooldown="$TIKPAL_KIOSK_WATCHDOG_RESTART_COOLDOWN_SECONDS"
if [[ "$last_restart" -gt 0 && "$cooldown" =~ ^[0-9]+$ && $((now - last_restart)) -lt "$cooldown" ]]; then
  log "unhealthy: $reason; restart suppressed by cooldown"
  exit 0
fi

if maybe_reboot_for_persistent_display_failure "$reason" "$now"; then
  exit 0
fi

if try_physical_display_soft_recover "$reason"; then
  write_state_number "$failure_file" "0"
  exit 0
fi

if try_physical_display_gpu_rebind_recover "$reason"; then
  write_state_number "$failure_file" "0"
  exit 0
fi

restart_kiosk "$reason"
write_state_number "$failure_file" "0"

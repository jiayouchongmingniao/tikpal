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
: "${TIKPAL_KIOSK_WATCHDOG_DRY_RUN:=0}"
: "${TIKPAL_KIOSK_WATCHDOG_SERVICE:=tikpal-kiosk.service}"
: "${TIKPAL_KIOSK_WATCHDOG_API_URL:=http://127.0.0.1:8787/api/v1/health}"
: "${TIKPAL_KIOSK_URL:=http://localhost:4173/}"
: "${TIKPAL_KIOSK_DISPLAY:=:0}"
: "${TIKPAL_KIOSK_SERVICE_USER:=moode}"

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
check_page_heartbeat() {
  page_heartbeat_detail=""
  is_enabled "$TIKPAL_KIOSK_WATCHDOG_PAGE_HEARTBEAT_ENABLED" || return 0
  command -v curl >/dev/null 2>&1 || return 0

  local body
  if ! body="$(
    run_with_timeout "$TIKPAL_KIOSK_WATCHDOG_WEB_TIMEOUT_SECONDS" \
      curl -fsS --max-time "$TIKPAL_KIOSK_WATCHDOG_WEB_TIMEOUT_SECONDS" \
      "$TIKPAL_KIOSK_WATCHDOG_PAGE_HEARTBEAT_URL" 2>/dev/null
  )"; then
    page_heartbeat_detail="heartbeat-request-failed"
    return 1
  fi

  if command -v node >/dev/null 2>&1; then
    local result
    local status
    set +e
    result="$(
      PAGE_HEARTBEAT_BODY="$body" node -e '
        const data = JSON.parse(process.env.PAGE_HEARTBEAT_BODY || "{}");
        if (data.healthy === true) {
          console.log("healthy");
          process.exit(0);
        }
        const reasons = Array.isArray(data.reasons) ? data.reasons.join("+") : "";
        console.log(reasons || data.status || "heartbeat-unhealthy");
        process.exit(1);
      ' 2>/dev/null
    )"
    status="$?"
    set -e
    if [[ "$status" -eq 0 ]]; then
      return 0
    fi
    page_heartbeat_detail="$(sanitize_reason_detail "$result")"
    return 1
  fi

  if printf '%s\n' "$body" | grep -Eq '"healthy"[[:space:]]*:[[:space:]]*true'; then
    return 0
  fi

  page_heartbeat_detail="heartbeat-unhealthy"
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
  [[ "$reason" == *"x-unresponsive"* || "$reason" == *"v3d-reset"* ]]
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

restart_kiosk "$reason"
write_state_number "$failure_file" "0"

#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="${TIKPAL_KIOSK_ENV_FILE:-$APP_DIR/.env.kiosk}"

should_source_env_file() {
  local value
  value="$(printf '%s' "${TIKPAL_KIOSK_SKIP_ENV_SOURCE:-0}" | tr '[:upper:]' '[:lower:]')"
  case "$value" in
    1|true|yes|on) return 1 ;;
    *) return 0 ;;
  esac
}

if should_source_env_file && [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

: "${TIKPAL_KIOSK_CPU_GOVERNOR:=preserve}"
: "${TIKPAL_KIOSK_CPU_GOVERNOR_STATE_PATH:=/run/tikpal/kiosk-cpu-governor.tsv}"

MODE="${1:-check}"

log() {
  printf '[tikpal-kiosk-performance] %s\n' "$*"
}

performance_requested() {
  [[ "$(printf '%s' "$TIKPAL_KIOSK_CPU_GOVERNOR" | tr '[:upper:]' '[:lower:]')" == "performance" ]]
}

policy_paths() {
  local policy
  for policy in /sys/devices/system/cpu/cpufreq/policy*/scaling_governor; do
    [[ -f "$policy" ]] || continue
    printf '%s\n' "$policy"
  done
}

safe_policy_record() {
  local policy="$1" governor="$2"
  [[ "$policy" =~ ^/sys/devices/system/cpu/cpufreq/policy[0-9]+/scaling_governor$ ]] || return 1
  [[ "$governor" =~ ^[A-Za-z0-9_-]+$ ]]
}

apply() {
  if ! performance_requested; then
    log "governor=$TIKPAL_KIOSK_CPU_GOVERNOR; preserving current policies"
    return 0
  fi

  local state_dir temporary policy original applied=0
  state_dir="$(dirname "$TIKPAL_KIOSK_CPU_GOVERNOR_STATE_PATH")"
  mkdir -p "$state_dir"
  temporary="$TIKPAL_KIOSK_CPU_GOVERNOR_STATE_PATH.$$.tmp"
  : > "$temporary"

  while IFS= read -r policy; do
    original="$(cat "$policy" 2>/dev/null || true)"
    safe_policy_record "$policy" "$original" || {
      log "skipping invalid policy record: $policy"
      continue
    }
    if printf '%s' performance > "$policy"; then
      printf '%s\t%s\n' "$policy" "$original" >> "$temporary"
      log "policy=${policy%/scaling_governor} governor=$original->performance"
      applied=$((applied + 1))
    else
      log "WARN: could not set ${policy%/scaling_governor} to performance"
    fi
  done < <(policy_paths)

  if [[ "$applied" -gt 0 ]]; then
    chmod 0600 "$temporary"
    mv -f "$temporary" "$TIKPAL_KIOSK_CPU_GOVERNOR_STATE_PATH"
  else
    rm -f "$temporary"
    log "no CPU frequency policies changed"
  fi
}

restore() {
  [[ -f "$TIKPAL_KIOSK_CPU_GOVERNOR_STATE_PATH" ]] || return 0

  local temporary policy original remaining=0
  temporary="$TIKPAL_KIOSK_CPU_GOVERNOR_STATE_PATH.$$.restore"
  : > "$temporary"
  while IFS=$'\t' read -r policy original; do
    safe_policy_record "$policy" "$original" || continue
    if [[ -w "$policy" ]] && printf '%s' "$original" > "$policy"; then
      log "policy=${policy%/scaling_governor} restored=$original"
    else
      printf '%s\t%s\n' "$policy" "$original" >> "$temporary"
      remaining=$((remaining + 1))
      log "WARN: could not restore ${policy%/scaling_governor} to $original"
    fi
  done < "$TIKPAL_KIOSK_CPU_GOVERNOR_STATE_PATH"

  if [[ "$remaining" -eq 0 ]]; then
    rm -f "$temporary" "$TIKPAL_KIOSK_CPU_GOVERNOR_STATE_PATH"
  else
    chmod 0600 "$temporary"
    mv -f "$temporary" "$TIKPAL_KIOSK_CPU_GOVERNOR_STATE_PATH"
  fi
}

check() {
  local policy governor
  log "requested governor=$TIKPAL_KIOSK_CPU_GOVERNOR"
  while IFS= read -r policy; do
    governor="$(cat "$policy" 2>/dev/null || true)"
    log "policy=${policy%/scaling_governor} governor=${governor:-unavailable}"
  done < <(policy_paths)
  [[ -f "$TIKPAL_KIOSK_CPU_GOVERNOR_STATE_PATH" ]] && log "restore state present=$TIKPAL_KIOSK_CPU_GOVERNOR_STATE_PATH"
}

case "$MODE" in
  apply) apply ;;
  restore) restore ;;
  check) check ;;
  *)
    printf 'Usage: %s {apply|restore|check}\n' "$0" >&2
    exit 2
    ;;
esac

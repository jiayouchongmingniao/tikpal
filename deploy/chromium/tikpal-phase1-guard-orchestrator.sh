#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${TIKPAL_PHASE1_APP_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
WEB_MODE_SCRIPT="${TIKPAL_PHASE1_WEB_MODE_SCRIPT:-$SCRIPT_DIR/tikpal-web-mode.sh}"
ENV_FILE="${TIKPAL_KIOSK_ENV_FILE:-$APP_DIR/.env.kiosk}"
STATE_PATH="${TIKPAL_WEB_MODE_STATE_PATH:-$APP_DIR/.tikpal/web-mode-state.json}"

usage() {
  printf '%s\n' \
    "Usage: $0 snapshot OUTPUT_DIR LABEL [CREATED_PID]" \
    "       $0 cleanup OUTPUT_DIR CREATED_PID"
}

write_guard_identity() {
  local target_path="$1" pid="$2" starttime="$3" temporary_path
  [[ "$pid" =~ ^[1-9][0-9]*$ && -n "$starttime" ]] || return 64
  temporary_path="$target_path.$$.$RANDOM.tmp"
  printf 'pid\t%s\nstarttime\t%s\n' "$pid" "$starttime" > "$temporary_path"
  mv -f "$temporary_path" "$target_path"
}

guard_state_value() {
  local state_path="$1" key="$2"
  awk -F '\t' -v key="$key" '$1 == key { print $2; exit }' "$state_path"
}

atomic_write_disabled_env() {
  local temporary_path="$ENV_FILE.$$.$RANDOM.tmp"
  awk '
    BEGIN { mode_seen=0 }
    /^TIKPAL_WEB_MODE_X11_HELPER_MODE=/ {
      if (!mode_seen) print "TIKPAL_WEB_MODE_X11_HELPER_MODE=disabled"
      mode_seen=1
      next
    }
    /^TIKPAL_WEB_MODE_X11_MUTATION_TRACE_PATH=/ { next }
    { print }
    END { if (!mode_seen) print "TIKPAL_WEB_MODE_X11_HELPER_MODE=disabled" }
  ' "$ENV_FILE" > "$temporary_path"
  chown --reference="$ENV_FILE" "$temporary_path" 2>/dev/null || true
  chmod --reference="$ENV_FILE" "$temporary_path" 2>/dev/null || true
  mv -f "$temporary_path" "$ENV_FILE"
}

capture_guard_state() {
  local output_dir="$1" label="$2" created_pid="${3:-}" created_starttime="${4:-}"
  local canonical_pid canonical_starttime temporary_path
  [[ "$label" =~ ^[A-Za-z0-9._-]+$ && "$label" != *-identity ]] || return 64
  mkdir -p "$output_dir"
  temporary_path="$output_dir/window-guard.$label.tsv.$$.$RANDOM.tmp"
  "$WEB_MODE_SCRIPT" guard-state > "$temporary_path"
  if [[ -n "$created_pid" ]]; then
    [[ "$created_pid" =~ ^[1-9][0-9]*$ ]] || return 64
    if [[ -z "$created_starttime" ]]; then
      canonical_pid="$(guard_state_value "$temporary_path" canonical_pid)"
      canonical_starttime="$(guard_state_value "$temporary_path" canonical_starttime)"
      [[ "$canonical_pid" == "$created_pid" && -n "$canonical_starttime" &&
         "$canonical_starttime" != missing ]] || return 73
      created_starttime="$canonical_starttime"
      write_guard_identity "$output_dir/window-guard.created-identity.tsv" \
        "$created_pid" "$created_starttime"
    fi
    printf 'created_pid\t%s\ncreated_starttime\t%s\n' \
      "$created_pid" "$created_starttime" >> "$temporary_path"
  fi
  mv -f "$temporary_path" "$output_dir/window-guard.$label.tsv"
}

cleanup_guard() {
  local output_dir="$1" created_pid="$2" created_starttime="" recorded_created_pid=""
  local active_provider="" helper_status=0 identity_status=0
  local owned_stop_status=0 final_status=0 matching_count=0 restore_pid="" restore_starttime=""
  [[ "$created_pid" =~ ^[1-9][0-9]*$ ]] || return 64
  mkdir -p "$output_dir"
  recorded_created_pid="$(guard_state_value "$output_dir/window-guard.created-identity.tsv" pid 2>/dev/null || true)"
  created_starttime="$(guard_state_value "$output_dir/window-guard.created-identity.tsv" starttime 2>/dev/null || true)"
  if [[ "$recorded_created_pid" != "$created_pid" || -z "$created_starttime" ]]; then
    identity_status=74
    final_status=74
  fi
  if [[ "$identity_status" == 0 ]]; then
    capture_guard_state "$output_dir" pre-cleanup \
      "$created_pid" "$created_starttime" || true
  else
    capture_guard_state "$output_dir" pre-cleanup || true
  fi

  atomic_write_disabled_env || final_status=1
  if "$WEB_MODE_SCRIPT" restore-helper-owner; then
    helper_status=0
  else
    helper_status=$?
    final_status="$helper_status"
  fi
  if [[ "$identity_status" != 0 ]]; then
    owned_stop_status="$identity_status"
  elif "$WEB_MODE_SCRIPT" stop-owned-guard "$created_pid" "$created_starttime"; then
    owned_stop_status=0
  else
    owned_stop_status=$?
  fi
  if [[ "$identity_status" == 0 ]]; then
    capture_guard_state "$output_dir" post-owned-stop \
      "$created_pid" "$created_starttime" || true
  else
    capture_guard_state "$output_dir" post-owned-stop || true
  fi
  matching_count="$(awk -F '\t' '$1 == "matching_count" { print $2 }' \
    "$output_dir/window-guard.post-owned-stop.tsv" 2>/dev/null || true)"
  [[ "$matching_count" =~ ^[0-9]+$ ]] || matching_count=99

  if [[ "$owned_stop_status" == 72 || "$matching_count" != 0 ]]; then
    final_status=72
  elif [[ "$owned_stop_status" != 0 ]]; then
    final_status="$owned_stop_status"
  else
    active_provider="$(jq -r '.activeProvider // empty' "$STATE_PATH" 2>/dev/null || true)"
    if [[ -z "$active_provider" ]]; then
      final_status=74
    elif "$WEB_MODE_SCRIPT" reload-guard "$active_provider"; then
      restore_pid="$("$WEB_MODE_SCRIPT" guard-state | awk -F '\t' '$1 == "canonical_pid" { print $2 }')"
      restore_starttime="$("$WEB_MODE_SCRIPT" guard-state | awk -F '\t' '$1 == "canonical_starttime" { print $2 }')"
      [[ "$restore_pid" =~ ^[1-9][0-9]*$ ]] || final_status=73
      [[ -n "$restore_starttime" && "$restore_starttime" != missing ]] || final_status=73
      write_guard_identity "$output_dir/window-guard.final-disabled-identity.tsv" \
        "$restore_pid" "$restore_starttime" || final_status=73
    else
      final_status=$?
    fi
  fi

  if [[ "$identity_status" == 0 ]]; then
    capture_guard_state "$output_dir" final "$created_pid" "$created_starttime" || true
  else
    capture_guard_state "$output_dir" final || true
  fi
  printf 'helper_restore_status\t%s\nowned_stop_status\t%s\nfinal_status\t%s\n' \
    "$helper_status" "$owned_stop_status" "$final_status" \
    > "$output_dir/window-guard.cleanup-status.tsv"
  return "$final_status"
}

case "${1:-}" in
  snapshot)
    [[ "$#" -ge 3 && "$#" -le 4 ]] || { usage >&2; exit 64; }
    capture_guard_state "$2" "$3" "${4:-}"
    if [[ -z "${4:-}" ]]; then
      state_path="$2/window-guard.$3.tsv"
      original_pid="$(guard_state_value "$state_path" canonical_pid)"
      original_starttime="$(guard_state_value "$state_path" canonical_starttime)"
      if [[ "$original_pid" =~ ^[1-9][0-9]*$ &&
            -n "$original_starttime" && "$original_starttime" != missing ]]; then
        write_guard_identity "$2/window-guard.original-identity.tsv" \
          "$original_pid" "$original_starttime"
      fi
    fi
    ;;
  cleanup)
    [[ "$#" == 3 ]] || { usage >&2; exit 64; }
    cleanup_guard "$2" "$3"
    ;;
  *)
    usage >&2
    exit 64
    ;;
esac

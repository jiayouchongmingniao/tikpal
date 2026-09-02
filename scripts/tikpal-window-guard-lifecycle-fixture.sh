#!/usr/bin/env bash
set -euo pipefail

if [[ "${TIKPAL_WINDOW_GUARD_ORCHESTRATOR_MOCK:-0}" == 1 ]]; then
  mock_state_value() {
    awk -F '\t' -v key="$1" '$1 == key { print $2; exit }' \
      "$TIKPAL_WINDOW_GUARD_MOCK_STATE"
  }
  mock_write_state() {
    printf 'pid\t%s\nstarttime\t%s\ncount\t%s\n' "$1" "$2" "$3" \
      > "$TIKPAL_WINDOW_GUARD_MOCK_STATE"
  }
  case "${1:-}" in
    guard-state)
      mock_pid="$(mock_state_value pid)"
      mock_starttime="$(mock_state_value starttime)"
      mock_count="$(mock_state_value count)"
      printf 'canonical_pid\t%s\ncanonical_starttime\t%s\nmatching_pids\t%s\nmatching_count\t%s\n' \
        "$mock_pid" "$mock_starttime" \
        "$([[ "$mock_count" == 0 ]] && printf none || printf '%s' "$mock_pid")" \
        "$mock_count"
      ;;
    restore-helper-owner)
      printf 'restore-helper-owner\n' >> "$TIKPAL_WINDOW_GUARD_MOCK_LOG"
      ;;
    stop-owned-guard)
      printf 'stop-owned-guard\t%s\t%s\n' "${2:-}" "${3:-}" \
        >> "$TIKPAL_WINDOW_GUARD_MOCK_LOG"
      [[ "${2:-}" == "$(mock_state_value pid)" &&
         "${3:-}" == "$(mock_state_value starttime)" &&
         "$(mock_state_value count)" == 1 ]] || exit 72
      mock_write_state missing missing 0
      ;;
    reload-guard)
      printf 'reload-guard\t%s\n' "${2:-}" >> "$TIKPAL_WINDOW_GUARD_MOCK_LOG"
      mock_write_state "$TIKPAL_WINDOW_GUARD_MOCK_RESTORE_PID" \
        "$TIKPAL_WINDOW_GUARD_MOCK_RESTORE_STARTTIME" 1
      ;;
    *) exit 64 ;;
  esac
  exit 0
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURE_SCRIPT="$ROOT_DIR/scripts/$(basename "${BASH_SOURCE[0]}")"
WEB_MODE_SCRIPT="$ROOT_DIR/deploy/chromium/tikpal-web-mode.sh"
ORCHESTRATOR="$ROOT_DIR/deploy/chromium/tikpal-phase1-guard-orchestrator.sh"
FIXTURE_DIR="$(mktemp -d /tmp/tikpal-window-guard-lifecycle.XXXXXX)"
GUARD_PID=""

fail_fixture() {
  printf 'window guard lifecycle fixture failed: %s\n' "$*" >&2
  exit 1
}

cleanup_fixture() {
  trap - EXIT
  if [[ "$GUARD_PID" =~ ^[1-9][0-9]*$ ]] && kill -0 "$GUARD_PID" 2>/dev/null; then
    kill -TERM "$GUARD_PID" 2>/dev/null || true
    sleep 0.05
    kill -KILL "$GUARD_PID" 2>/dev/null || true
    wait "$GUARD_PID" 2>/dev/null || true
  fi
  case "$FIXTURE_DIR" in
    /tmp/tikpal-window-guard-lifecycle.*) rm -rf -- "$FIXTURE_DIR" ;;
  esac
}
trap cleanup_fixture EXIT

if ! command -v flock >/dev/null 2>&1; then
  export TIKPAL_FIXTURE_FLOCK="$ROOT_DIR/scripts/fixtures/flock.py"
  flock() {
    python3 "$TIKPAL_FIXTURE_FLOCK" "$@"
  }
  export -f flock
fi

export TIKPAL_KIOSK_SKIP_ENV_SOURCE=1
export TIKPAL_WEB_MODE_SOURCE_ONLY=1
export TIKPAL_WEB_MODE_PROFILE_ROOT="$FIXTURE_DIR/profile"
export TIKPAL_WEB_MODE_LOCK_TIMEOUT_SECONDS=1
export TIKPAL_WEB_MODE_X11_HELPER_MODE=disabled
export TIKPAL_WEB_MODE_X11_MUTATION_TRACE_PATH=""
mkdir -p "$TIKPAL_WEB_MODE_PROFILE_ROOT"

# shellcheck disable=SC1090
source "$WEB_MODE_SCRIPT"

provider_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/qobuz"
panel_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel"
mkdir -p "$provider_profile" "$panel_profile"

export TIKPAL_FIXTURE_WEB_MODE_SCRIPT="$WEB_MODE_SCRIPT"
bash -c '
  set -euo pipefail
  source "$TIKPAL_FIXTURE_WEB_MODE_SCRIPT"
  WEB_MODE_COMMAND_ARGS=(guard)
  trap x11_helper_cleanup_on_exit EXIT
  while true; do sleep 10; done
' tikpal-window-guard-fixture-child "$WEB_MODE_SCRIPT" guard \
  "$provider_profile" "$panel_profile" &
GUARD_PID=$!

guard_ready=0
for _attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  if window_guard_process_matches "$GUARD_PID"; then
    guard_ready=1
    break
  fi
  sleep 0.02
done
if [[ "$guard_ready" != 1 ]]; then
  child_state=exited
  child_wait_status=not_waited
  if kill -0 "$GUARD_PID" 2>/dev/null; then
    child_state=alive
  else
    set +e
    wait "$GUARD_PID"
    child_wait_status=$?
    set -e
    GUARD_PID=""
  fi
  child_command="$(ps -p "${GUARD_PID:-0}" -o command= 2>/dev/null || true)"
  printf 'guard identity diagnostic: state=%s wait_status=%s command=%q\n' \
    "$child_state" "$child_wait_status" "$child_command" >&2
  fail_fixture "Guard process identity was not observable"
fi

window_guard_ensure_process "$provider_profile" "$panel_profile" ||
  fail_fixture "could not claim the unique Guard with a missing PID file"
recorded_pid="$(window_guard_read_pid_file || true)"
recorded_starttime="$(window_guard_read_recorded_starttime || true)"
[[ "$recorded_pid" == "$GUARD_PID" && -n "$recorded_starttime" ]] ||
  fail_fixture "claimed Guard identity was incomplete"

window_guard_ensure_process "$provider_profile" "$panel_profile" ||
  fail_fixture "could not reuse a valid Guard identity"
[[ "$(window_guard_read_pid_file || true)" == "$GUARD_PID" &&
   "$(window_guard_read_recorded_starttime || true)" == "$recorded_starttime" ]] ||
  fail_fixture "valid Guard identity changed during reuse"

rm -f "$(window_guard_starttime_file)"
window_guard_ensure_process "$provider_profile" "$panel_profile" ||
  fail_fixture "could not upgrade a legacy PID-only record"
[[ "$(window_guard_read_recorded_starttime || true)" == "$recorded_starttime" ]] ||
  fail_fixture "legacy PID-only record did not gain starttime"

set +e
stop_window_guard_owned "$GUARD_PID" "replacement-starttime"
mismatch_status=$?
set -e
[[ "$mismatch_status" == 72 ]] ||
  fail_fixture "wrong starttime did not fail closed"
kill -0 "$GUARD_PID" 2>/dev/null ||
  fail_fixture "wrong starttime stopped the Guard"

printf '%s\n' replacement-starttime > "$(window_guard_starttime_file)"
window_guard_remove_pid_file_if_owned "$GUARD_PID" "$recorded_starttime" || true
[[ "$(window_guard_read_pid_file || true)" == "$GUARD_PID" &&
   "$(window_guard_read_recorded_starttime || true)" == replacement-starttime ]] ||
  fail_fixture "old identity removed a replacement PID record"
printf '%s\n' "$recorded_starttime" > "$(window_guard_starttime_file)"

stop_window_guard || fail_fixture "stop_window_guard returned nonzero"
set +e
wait "$GUARD_PID"
wait_status=$?
set -e
GUARD_PID=""

[[ "$wait_status" != 137 ]] || fail_fixture "Guard required SIGKILL while EXIT cleanup contended"
[[ ! -e "$(window_guard_pid_file)" ]] || fail_fixture "owned PID file survived controlled stop"
window_guard_collect_matching_pids
[[ "${#TIKPAL_WINDOW_GUARD_MATCHING_PIDS[@]}" == 0 ]] ||
  fail_fixture "Guard process survived controlled stop"

mock_guard_pids_file="$FIXTURE_DIR/mock-guard-pids"
mock_guard_starttimes_dir="$FIXTURE_DIR/mock-guard-starttimes"
mock_guard_launch_count_file="$FIXTURE_DIR/mock-guard-launch-count"
mock_guard_event_log="$FIXTURE_DIR/mock-guard-events"
mkdir -p "$mock_guard_starttimes_dir"

mock_guard_reset() {
  : > "$mock_guard_pids_file"
  : > "$mock_guard_event_log"
  printf '0\n' > "$mock_guard_launch_count_file"
  rm -f "$mock_guard_starttimes_dir"/* \
    "$(window_guard_pid_file)" "$(window_guard_starttime_file)"
}

mock_guard_add() {
  local pid="$1" starttime="$2"
  printf '%s\n' "$pid" >> "$mock_guard_pids_file"
  printf '%s\n' "$starttime" > "$mock_guard_starttimes_dir/$pid"
}

window_guard_process_starttime() {
  local pid="$1"
  head -n 1 "$mock_guard_starttimes_dir/$pid" 2>/dev/null
}

window_guard_process_matches() {
  local pid="$1" expected_starttime="${2:-}" current_starttime
  grep -Fx "$pid" "$mock_guard_pids_file" >/dev/null 2>&1 || return 1
  if [[ -n "$expected_starttime" ]]; then
    current_starttime="$(window_guard_process_starttime "$pid" || true)"
    [[ "$current_starttime" == "$expected_starttime" ]] || return 1
    if [[ "${mock_guard_log_identity_checks:-0}" == 1 ]]; then
      printf 'validate\t%s\t%s\n' "$pid" "$expected_starttime" >> "$mock_guard_event_log"
    fi
  fi
}

window_guard_matching_pids() {
  awk 'NF && !seen[$0]++' "$mock_guard_pids_file"
}

window_guard_launch_process() {
  local launch_count pid
  launch_count="$(head -n 1 "$mock_guard_launch_count_file")"
  launch_count=$((launch_count + 1))
  printf '%s\n' "$launch_count" > "$mock_guard_launch_count_file"
  pid=$((9000 + launch_count))
  mock_guard_add "$pid" "mock-start-$launch_count"
  printf 'launch\t%s\n' "$pid" >> "$mock_guard_event_log"
  TIKPAL_WINDOW_GUARD_LAUNCHED_PID="$pid"
}

window_guard_write_pid_file() {
  local pid="$1" expected_starttime="${2:-}" starttime
  starttime="$(window_guard_process_starttime "$pid" || true)"
  [[ -n "$starttime" && ( -z "$expected_starttime" || "$starttime" == "$expected_starttime" ) ]] ||
    return 1
  printf '%s\n' "$pid" > "$(window_guard_pid_file)"
  printf '%s\n' "$starttime" > "$(window_guard_starttime_file)"
  printf 'publish\t%s\t%s\n' "$pid" "$starttime" >> "$mock_guard_event_log"
}

window_guard_terminate_process() {
  local pid="$1" expected_starttime="$2" temporary_path
  window_guard_process_matches "$pid" "$expected_starttime" || return 0
  if [[ "${mock_guard_refuse_terminate:-0}" == 1 ]]; then
    printf 'terminate-refused\t%s\n' "$pid" >> "$mock_guard_event_log"
    return 73
  fi
  printf 'terminate\t%s\n' "$pid" >> "$mock_guard_event_log"
  temporary_path="$mock_guard_pids_file.$$.$RANDOM.tmp"
  awk -v pid="$pid" '$0 != pid' "$mock_guard_pids_file" > "$temporary_path"
  mv -f "$temporary_path" "$mock_guard_pids_file"
  rm -f "$mock_guard_starttimes_dir/$pid"
}

mock_guard_reset
printf '777\n' > "$(window_guard_pid_file)"
printf 'stale-start\n' > "$(window_guard_starttime_file)"
window_guard_ensure_process "$provider_profile" "$panel_profile" ||
  fail_fixture "stale PID record did not create one Guard"
[[ "$(head -n 1 "$mock_guard_launch_count_file")" == 1 &&
   "$(window_guard_read_pid_file || true)" == 9001 &&
   "$(wc -l < "$mock_guard_pids_file" | tr -d ' ')" == 1 ]] ||
  fail_fixture "stale PID record created an invalid Guard set"

mock_guard_reset
mock_guard_add 8101 actual-start
printf '9999\n' > "$(window_guard_pid_file)"
printf 'wrong-start\n' > "$(window_guard_starttime_file)"
window_guard_ensure_process "$provider_profile" "$panel_profile" ||
  fail_fixture "identity mismatch did not claim the unique Guard"
[[ "$(window_guard_read_pid_file || true)" == 8101 &&
   "$(window_guard_read_recorded_starttime || true)" == actual-start &&
   "$(head -n 1 "$mock_guard_launch_count_file")" == 0 ]] ||
  fail_fixture "identity mismatch launched instead of claiming"

mock_guard_reset
( window_guard_ensure_process "$provider_profile" "$panel_profile" ) &
starter_one=$!
( window_guard_ensure_process "$provider_profile" "$panel_profile" ) &
starter_two=$!
wait "$starter_one" || fail_fixture "first concurrent starter failed"
wait "$starter_two" || fail_fixture "second concurrent starter failed"
[[ "$(head -n 1 "$mock_guard_launch_count_file")" == 1 &&
   "$(wc -l < "$mock_guard_pids_file" | tr -d ' ')" == 1 ]] ||
  fail_fixture "concurrent starters created more than one Guard"
concurrent_pid="$(window_guard_read_pid_file || true)"
export TIKPAL_WEB_MODE_X11_PROCESS_GENERATION=fixture-next-generation
window_guard_ensure_process "$provider_profile" "$panel_profile" ||
  fail_fixture "generation change could not reuse the Guard"
[[ "$(window_guard_read_pid_file || true)" == "$concurrent_pid" &&
   "$(head -n 1 "$mock_guard_launch_count_file")" == 1 ]] ||
  fail_fixture "generation change rebuilt the Guard"

mock_guard_reset
mock_guard_add 8201 first-start
mock_guard_add 8202 second-start
set +e
window_guard_ensure_process "$provider_profile" "$panel_profile"
multiple_status=$?
set -e
[[ "$multiple_status" == 72 &&
   "$(head -n 1 "$mock_guard_launch_count_file")" == 0 &&
   "$(wc -l < "$mock_guard_pids_file" | tr -d ' ')" == 2 ]] ||
  fail_fixture "multiple Guards did not fail closed without a third launch"

mock_guard_reset
mock_guard_add 8301 reload-old-start
window_guard_write_pid_file 8301 || fail_fixture "could not publish reload source identity"
: > "$mock_guard_event_log"
mock_guard_log_identity_checks=1
reload_window_guard "$provider_profile" "$panel_profile" ||
  fail_fixture "reload did not replace the old Guard"
mock_guard_log_identity_checks=0
terminate_line="$(grep -n $'^terminate\t8301$' "$mock_guard_event_log" | cut -d: -f1)"
launch_line="$(grep -n $'^launch\t9001$' "$mock_guard_event_log" | cut -d: -f1)"
validate_line="$(grep -n $'^validate\t9001\tmock-start-1$' "$mock_guard_event_log" | head -1 | cut -d: -f1)"
publish_line="$(grep -n $'^publish\t9001\tmock-start-1$' "$mock_guard_event_log" | cut -d: -f1)"
[[ "$terminate_line" =~ ^[1-9][0-9]*$ && "$launch_line" =~ ^[1-9][0-9]*$ &&
   "$validate_line" =~ ^[1-9][0-9]*$ && "$publish_line" =~ ^[1-9][0-9]*$ &&
   "$terminate_line" -lt "$launch_line" && "$launch_line" -lt "$validate_line" &&
   "$validate_line" -lt "$publish_line" && "$(window_guard_read_pid_file || true)" == 9001 &&
   "$(wc -l < "$mock_guard_pids_file" | tr -d ' ')" == 1 ]] ||
  fail_fixture "reload did not validate stop, launch, identity, then PID publication in order"

mock_guard_reset
mock_guard_add 8401 stuck-old-start
window_guard_write_pid_file 8401 || fail_fixture "could not publish stuck reload identity"
mock_guard_refuse_terminate=1
set +e
reload_window_guard "$provider_profile" "$panel_profile"
stuck_reload_status=$?
set -e
mock_guard_refuse_terminate=0
[[ "$stuck_reload_status" == 73 &&
   "$(head -n 1 "$mock_guard_launch_count_file")" == 0 &&
   "$(window_guard_read_pid_file || true)" == 8401 &&
   "$(wc -l < "$mock_guard_pids_file" | tr -d ' ')" == 1 ]] ||
  fail_fixture "reload launched after the old Guard failed to exit"

mock_state="$FIXTURE_DIR/orchestrator-state.tsv"
mock_log="$FIXTURE_DIR/orchestrator.log"
orchestrator_output="$FIXTURE_DIR/orchestrator-output"
mock_env="$FIXTURE_DIR/kiosk.env"
mock_runtime_state="$FIXTURE_DIR/web-mode-state.json"
mkdir -p "$orchestrator_output"
printf 'TIKPAL_WEB_MODE_X11_HELPER_MODE=switch\nTIKPAL_WEB_MODE_X11_MUTATION_TRACE_PATH=/tmp/trace\n' \
  > "$mock_env"
printf '{"activeProvider":"qobuz"}\n' > "$mock_runtime_state"
: > "$mock_log"

export TIKPAL_WINDOW_GUARD_ORCHESTRATOR_MOCK=1
export TIKPAL_WINDOW_GUARD_MOCK_STATE="$mock_state"
export TIKPAL_WINDOW_GUARD_MOCK_LOG="$mock_log"
export TIKPAL_WINDOW_GUARD_MOCK_RESTORE_PID=333
export TIKPAL_WINDOW_GUARD_MOCK_RESTORE_STARTTIME=restored-starttime
export TIKPAL_PHASE1_WEB_MODE_SCRIPT="$FIXTURE_SCRIPT"
export TIKPAL_KIOSK_ENV_FILE="$mock_env"
export TIKPAL_WEB_MODE_STATE_PATH="$mock_runtime_state"

printf 'pid\t111\nstarttime\toriginal-starttime\ncount\t1\n' > "$mock_state"
"$ORCHESTRATOR" snapshot "$orchestrator_output" initial
printf 'pid\t222\nstarttime\tcreated-starttime\ncount\t1\n' > "$mock_state"
"$ORCHESTRATOR" snapshot "$orchestrator_output" created 222
created_identity_before="$(cksum "$orchestrator_output/window-guard.created-identity.tsv")"
set +e
"$ORCHESTRATOR" snapshot "$orchestrator_output" created-identity
reserved_label_status=$?
set -e
[[ "$reserved_label_status" == 64 &&
   "$(cksum "$orchestrator_output/window-guard.created-identity.tsv")" == "$created_identity_before" ]] ||
  fail_fixture "Orchestrator snapshot label overwrote a reserved identity file"
set +e
"$ORCHESTRATOR" cleanup "$orchestrator_output" 222
orchestrator_cleanup_status=$?
set -e
if [[ "$orchestrator_cleanup_status" != 0 ]]; then
  printf 'orchestrator cleanup diagnostic: status=%s\n' \
    "$orchestrator_cleanup_status" >&2
  for diagnostic_path in \
    "$mock_log" \
    "$orchestrator_output/window-guard.post-owned-stop.tsv" \
    "$orchestrator_output/window-guard.cleanup-status.tsv"; do
    printf 'diagnostic file: %s\n' "${diagnostic_path##*/}" >&2
    sed -n '1,120p' "$diagnostic_path" >&2 2>/dev/null || true
  done
  exit "$orchestrator_cleanup_status"
fi

[[ "$(awk -F '\t' '$1 == "pid" { print $2 }' "$orchestrator_output/window-guard.original-identity.tsv")" == 111 &&
   "$(awk -F '\t' '$1 == "starttime" { print $2 }' "$orchestrator_output/window-guard.original-identity.tsv")" == original-starttime ]] ||
  fail_fixture "Orchestrator did not preserve the original Guard identity"
[[ "$(awk -F '\t' '$1 == "pid" { print $2 }' "$orchestrator_output/window-guard.created-identity.tsv")" == 222 &&
   "$(awk -F '\t' '$1 == "starttime" { print $2 }' "$orchestrator_output/window-guard.created-identity.tsv")" == created-starttime ]] ||
  fail_fixture "Orchestrator did not preserve the created Guard identity"
grep -Fx $'stop-owned-guard\t222\tcreated-starttime' "$mock_log" >/dev/null ||
  fail_fixture "Orchestrator cleanup did not pass the created starttime"
[[ "$(awk -F '\t' '$1 == "pid" { print $2 }' "$orchestrator_output/window-guard.final-disabled-identity.tsv")" == 333 &&
   "$(awk -F '\t' '$1 == "starttime" { print $2 }' "$orchestrator_output/window-guard.final-disabled-identity.tsv")" == restored-starttime ]] ||
  fail_fixture "Orchestrator did not record the restored Guard identity"
grep -Fx 'TIKPAL_WEB_MODE_X11_HELPER_MODE=disabled' "$mock_env" >/dev/null ||
  fail_fixture "Orchestrator did not restore disabled mode"
if grep -q '^TIKPAL_WEB_MODE_X11_MUTATION_TRACE_PATH=' "$mock_env"; then
  fail_fixture "Orchestrator left the mutation trace override enabled"
fi
grep -Fx $'final_status\t0' "$orchestrator_output/window-guard.cleanup-status.tsv" >/dev/null ||
  fail_fixture "Orchestrator cleanup did not finish successfully"

unknown_output="$FIXTURE_DIR/orchestrator-unknown-output"
unknown_env="$FIXTURE_DIR/kiosk-unknown.env"
mkdir -p "$unknown_output"
printf 'TIKPAL_WEB_MODE_X11_HELPER_MODE=switch\nTIKPAL_WEB_MODE_X11_MUTATION_TRACE_PATH=/tmp/trace\n' \
  > "$unknown_env"
: > "$mock_log"
export TIKPAL_KIOSK_ENV_FILE="$unknown_env"
printf 'pid\t444\nstarttime\tcreated-unknown-starttime\ncount\t1\n' > "$mock_state"
"$ORCHESTRATOR" snapshot "$unknown_output" created 444
printf 'pid\t444\nstarttime\tcreated-unknown-starttime\ncount\t2\n' > "$mock_state"
set +e
"$ORCHESTRATOR" cleanup "$unknown_output" 444
unknown_cleanup_status=$?
set -e
[[ "$unknown_cleanup_status" == 72 ]] ||
  fail_fixture "Orchestrator unknown duplicate cleanup did not fail closed"
[[ "$(awk -F '\t' '$1 == "pid" { print $2 }' "$mock_state")" == 444 &&
   "$(awk -F '\t' '$1 == "starttime" { print $2 }' "$mock_state")" == created-unknown-starttime &&
   "$(awk -F '\t' '$1 == "count" { print $2 }' "$mock_state")" == 2 ]] ||
  fail_fixture "Orchestrator unknown duplicate cleanup changed an unowned Guard set"
[[ "$(grep -c '^restore-helper-owner$' "$mock_log" || true)" == 1 &&
   "$(grep -c $'^stop-owned-guard\t444\tcreated-unknown-starttime$' "$mock_log" || true)" == 1 &&
   "$(grep -c '^reload-guard' "$mock_log" || true)" == 0 ]] ||
  fail_fixture "Orchestrator unknown duplicate cleanup did not arbitrate once without reload"
grep -Fx 'TIKPAL_WEB_MODE_X11_HELPER_MODE=disabled' "$unknown_env" >/dev/null ||
  fail_fixture "Orchestrator unknown duplicate cleanup did not restore disabled mode"
grep -Fx $'owned_stop_status\t72' "$unknown_output/window-guard.cleanup-status.tsv" >/dev/null ||
  fail_fixture "Orchestrator unknown duplicate cleanup hid the owned-stop failure"
grep -Fx $'final_status\t72' "$unknown_output/window-guard.cleanup-status.tsv" >/dev/null ||
  fail_fixture "Orchestrator unknown duplicate cleanup reported success"

printf 'window guard lifecycle fixture passed: PID/starttime and cleanup contracts held\n'

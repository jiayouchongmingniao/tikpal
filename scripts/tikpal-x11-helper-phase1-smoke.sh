#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FIXTURE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/tikpal-x11-helper-phase1.XXXXXX")"
X11_HELPER="$FIXTURE_DIR/tikpal-x11-helper"
X11_HELPER_TEST="$FIXTURE_DIR/tikpal-x11-helper-test"
XSERVER_PID=""
HELPER_PID=""
LOG_READER_PID=""

cleanup() {
  if [[ -n "$LOG_READER_PID" ]]; then
    kill "$LOG_READER_PID" >/dev/null 2>&1 || true
    wait "$LOG_READER_PID" 2>/dev/null || true
  fi
  if [[ -n "$HELPER_PID" ]]; then
    kill "$HELPER_PID" >/dev/null 2>&1 || true
    wait "$HELPER_PID" 2>/dev/null || true
  fi
  if [[ -n "$XSERVER_PID" ]]; then
    kill -CONT "$XSERVER_PID" >/dev/null 2>&1 || true
    kill "$XSERVER_PID" >/dev/null 2>&1 || true
    wait "$XSERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$FIXTURE_DIR"
}
trap cleanup EXIT

fail_fixture() {
  printf 'tikpal X11 Helper Phase 1 fixture failed: %s\n' "$*" >&2
  exit 1
}

assert_file_json() {
  local expression="$1"
  local path="$2"
  jq -e "$expression" "$path" >/dev/null ||
    fail_fixture "JSON assertion failed: $expression in $path"
}

command -v cc >/dev/null 2>&1 || fail_fixture "cc is required"
command -v pkg-config >/dev/null 2>&1 || fail_fixture "pkg-config is required"
command -v jq >/dev/null 2>&1 || fail_fixture "jq is required"
command -v Xvfb >/dev/null 2>&1 || fail_fixture "Xvfb is required"
pkg-config --exists xcb json-c || fail_fixture "xcb and json-c development packages are required"

cc -std=c11 -Wall -Wextra -Werror \
  $(pkg-config --cflags xcb json-c) \
  "$ROOT_DIR/deploy/chromium/tikpal-x11-helper.c" \
  -o "$X11_HELPER" \
  $(pkg-config --libs xcb json-c)
cc -std=c11 -Wall -Wextra -Werror -DTIKPAL_X11_HELPER_SELF_TEST_SEAMS \
  $(pkg-config --cflags xcb json-c) \
  "$ROOT_DIR/deploy/chromium/tikpal-x11-helper.c" \
  -o "$X11_HELPER_TEST" \
  $(pkg-config --libs xcb json-c)
"$X11_HELPER" self-test

DISPLAY_NUMBER=""
for candidate in {91..110}; do
  if [[ ! -S "/tmp/.X11-unix/X$candidate" ]]; then
    DISPLAY_NUMBER="$candidate"
    break
  fi
done
[[ -n "$DISPLAY_NUMBER" ]] || fail_fixture "no free local X display number"
DISPLAY_VALUE=":$DISPLAY_NUMBER"
Xvfb "$DISPLAY_VALUE" -screen 0 2560x720x24 -nolisten tcp \
  >"$FIXTURE_DIR/xvfb.log" 2>&1 &
XSERVER_PID=$!
for attempt in {1..100}; do
  [[ -S "/tmp/.X11-unix/X$DISPLAY_NUMBER" ]] && break
  kill -0 "$XSERVER_PID" >/dev/null 2>&1 ||
    fail_fixture "Xvfb exited early: $(tr '\n' ' ' < "$FIXTURE_DIR/xvfb.log")"
  sleep 0.05
done
[[ -S "/tmp/.X11-unix/X$DISPLAY_NUMBER" ]] || fail_fixture "Xvfb socket did not appear"
sleep 0.5

DISPLAY="$DISPLAY_VALUE" "$X11_HELPER_TEST" self-test \
  --x11-transaction \
  --display "$DISPLAY_VALUE" \
  --xserver-pid "$XSERVER_PID" \
  --user-data-dir="$FIXTURE_DIR/chromium-profile"
kill -0 "$XSERVER_PID" >/dev/null 2>&1 || fail_fixture "Xvfb did not survive timeout recovery"
DISPLAY="$DISPLAY_VALUE" "$X11_HELPER_TEST" self-test \
  --x11-sequence \
  --display "$DISPLAY_VALUE"

MOCK_LOG="$FIXTURE_DIR/mock-helper.log"
MOCK_SWITCH_STATUS_FILE="$FIXTURE_DIR/mock-switch-status"
MOCK_REVOKE_STATUS_FILE="$FIXTURE_DIR/mock-revoke-status"
MOCK_MUTATION_STARTED_FILE="$FIXTURE_DIR/mock-mutation-started"
MOCK_EPOCH_FILE="$FIXTURE_DIR/mock-epoch"
MOCK_HELPER="$FIXTURE_DIR/mock-helper"
printf '0\n' > "$MOCK_SWITCH_STATUS_FILE"
printf '0\n' > "$MOCK_REVOKE_STATUS_FILE"
printf '0\n' > "$MOCK_MUTATION_STARTED_FILE"
printf '1\n' > "$MOCK_EPOCH_FILE"
: > "$MOCK_LOG"

cat > "$MOCK_HELPER" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
command_name="${2:-}"
case "$command_name" in
  health)
    printf 'health\n' >> "$MOCK_LOG"
    printf 'fixture-daemon\t%s\t0\tok\n' "$(cat "$MOCK_EPOCH_FILE")"
    ;;
  switch)
    status="$(cat "$MOCK_SWITCH_STATUS_FILE")"
    printf 'switch status=%s\n' "$status" >> "$MOCK_LOG"
    if [[ "$status" == "0" ]]; then
      printf '{"ok":true,"code":"OK","mutationStarted":true}\n'
    else
      printf '{"ok":false,"code":"FIXTURE_FAILURE","mutationStarted":%s}\n' \
        "$(cat "$MOCK_MUTATION_STARTED_FILE")"
    fi
    exit "$status"
    ;;
  revoke)
    status="$(cat "$MOCK_REVOKE_STATUS_FILE")"
    printf 'revoke status=%s\n' "$status" >> "$MOCK_LOG"
    [[ "$status" == "0" ]] && printf '{"ok":true,"code":"REVOKED"}\n'
    exit "$status"
    ;;
  owner-allows)
    printf 'owner-allows %s\n' "$*" >> "$MOCK_LOG"
    exec "$FIXTURE_REAL_HELPER" "$@"
    ;;
  *)
    exit 64
    ;;
esac
MOCK
chmod +x "$MOCK_HELPER"

FLOCK_FIXTURE_AVAILABLE=0
if command -v flock >/dev/null 2>&1; then
  FLOCK_FIXTURE_AVAILABLE=1
elif (( BASH_VERSINFO[0] >= 4 )); then
  command -v python3 >/dev/null 2>&1 ||
    fail_fixture "python3 is required for the local flock fixture"
  cat > "$FIXTURE_DIR/flock" <<'PYTHON'
#!/usr/bin/env python3
import fcntl
import os
import subprocess
import sys
import time

arguments = sys.argv[1:]
unlock = False
timeout = None
failure_status = 1
index = 0
while index < len(arguments) and arguments[index].startswith("-"):
    option = arguments[index]
    if option == "-u":
        unlock = True
        index += 1
    elif option in ("-x", "-o"):
        index += 1
    elif option in ("-w", "-E") and index + 1 < len(arguments):
        if option == "-w":
            timeout = float(arguments[index + 1])
        else:
            failure_status = int(arguments[index + 1])
        index += 2
    else:
        sys.exit(64)
if index >= len(arguments):
    sys.exit(64)
target = arguments[index]
command = arguments[index + 1:]
owns_descriptor = not target.isdigit()
descriptor = os.open(target, os.O_CREAT | os.O_RDWR, 0o600) if owns_descriptor else int(target)
if unlock:
    fcntl.flock(descriptor, fcntl.LOCK_UN)
    if owns_descriptor:
        os.close(descriptor)
    sys.exit(0)
deadline = None if timeout is None else time.monotonic() + timeout
while True:
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        break
    except BlockingIOError:
        if deadline is not None and time.monotonic() >= deadline:
            if owns_descriptor:
                os.close(descriptor)
            sys.exit(failure_status)
        time.sleep(0.01)
status = subprocess.run(command).returncode if command else 0
if owns_descriptor:
    os.close(descriptor)
sys.exit(status)
PYTHON
  chmod +x "$FIXTURE_DIR/flock"
  export PATH="$FIXTURE_DIR:$PATH"
  FLOCK_FIXTURE_AVAILABLE=1
fi

export FIXTURE_REAL_HELPER="$X11_HELPER"
export MOCK_LOG MOCK_SWITCH_STATUS_FILE MOCK_REVOKE_STATUS_FILE
export MOCK_MUTATION_STARTED_FILE MOCK_EPOCH_FILE
export TIKPAL_WEB_MODE_SOURCE_ONLY=1
export TIKPAL_WEB_MODE_PROFILE_ROOT="$FIXTURE_DIR/web-mode"
export TIKPAL_WEB_MODE_X11_HELPER_MODE=disabled
export TIKPAL_WEB_MODE_X11_HELPER_BINARY="$MOCK_HELPER"
export TIKPAL_WEB_MODE_X11_HELPER_SOCKET="$FIXTURE_DIR/helper.sock"
export TIKPAL_WEB_MODE_X11_HELPER_GENERATION_PATH="$FIXTURE_DIR/web-mode/generation"
export TIKPAL_WEB_MODE_X11_HELPER_OWNER_PATH="$FIXTURE_DIR/web-mode/owner.json"
export TIKPAL_WEB_MODE_LOG="$FIXTURE_DIR/web-mode.log"
export TIKPAL_WEB_MODE_STATE_PATH="$FIXTURE_DIR/web-mode-state.json"
export TIKPAL_WEB_MODE_LOCK_TIMEOUT_SECONDS=1
export TIKPAL_WEB_MODE_LOCKED=1
export BASHPID="${BASHPID:-$$}"
mkdir -p "$TIKPAL_WEB_MODE_PROFILE_ROOT"
source "$ROOT_DIR/deploy/chromium/tikpal-web-mode.sh"

TRACE_PATH="$FIXTURE_DIR/x11-writers.jsonl"
printf 'trace-sentinel\n' > "$TRACE_PATH"
printf '{"activeProvider":"fixture"}\n' > "$TIKPAL_WEB_MODE_STATE_PATH"
chmod 0444 "$TRACE_PATH"
export TIKPAL_WEB_MODE_X11_MUTATION_TRACE_PATH="$TRACE_PATH"
if x11_trace_require_writable; then
  fail_fixture "permission-denied trace passed the entry gate"
fi
[[ "$(<"$TRACE_PATH")" == "trace-sentinel" ]] ||
  fail_fixture "entry trace probe truncated the trace"
[[ ! -e "$TIKPAL_WEB_MODE_X11_HELPER_GENERATION_PATH" &&
   ! -e "$TIKPAL_WEB_MODE_X11_HELPER_OWNER_PATH" &&
   "$(<"$MOCK_MUTATION_STARTED_FILE")" == "0" &&
   "$(<"$TIKPAL_WEB_MODE_STATE_PATH")" == '{"activeProvider":"fixture"}' ]] ||
  fail_fixture "rejected trace entry changed Helper or runtime state"

chmod 0660 "$TRACE_PATH"
x11_trace_require_writable || fail_fixture "shared-group trace failed the entry gate"
[[ "$(<"$TRACE_PATH")" == "trace-sentinel" ]] ||
  fail_fixture "successful trace probe truncated the trace"
TIKPAL_WEB_MODE_X11_WRITER_ROLE=root_guard_fixture
x11_trace_control_event guard_started 0
TIKPAL_WEB_MODE_X11_WRITER_ROLE=moode_api_fixture
x11_trace_control_event api_append_probe 0
unset TIKPAL_WEB_MODE_X11_WRITER_ROLE
[[ "$(grep -c 'root_guard_fixture' "$TRACE_PATH" || true)" == "1" &&
   "$(grep -c 'moode_api_fixture' "$TRACE_PATH" || true)" == "1" ]] ||
  fail_fixture "shared-group trace did not accept Guard and API appends"

chmod 0600 "$FIXTURE_DIR"
if x11_trace_require_writable; then
  chmod 0700 "$FIXTURE_DIR"
  fail_fixture "non-searchable trace parent passed the entry gate"
fi
chmod 0700 "$FIXTURE_DIR"
x11_trace_require_writable || fail_fixture "trace did not recover after parent access restore"

reset_helper_shell_state() {
  TIKPAL_X11_HELPER_PREPARED=0
  TIKPAL_X11_HELPER_ACTIVE=0
  TIKPAL_X11_HELPER_UNKNOWN=0
  TIKPAL_X11_HELPER_DAEMON_INSTANCE_ID=""
  TIKPAL_X11_HELPER_CONNECTION_EPOCH=""
  TIKPAL_X11_HELPER_GENERATION=""
  TIKPAL_X11_HELPER_LEASE_ID=""
  TIKPAL_X11_HELPER_LAST_RESPONSE=""
}

begin_fixture_switch() {
  x11_helper_prepare_switch || fail_fixture "Helper prepare failed"
  x11_helper_begin_switch \
    101 "$FIXTURE_DIR/target-profile" \
    202 "$FIXTURE_DIR/previous-profile" \
    303 "$FIXTURE_DIR/panel-profile"
}

rm -f "$TIKPAL_WEB_MODE_X11_HELPER_GENERATION_PATH" "$TIKPAL_WEB_MODE_X11_HELPER_OWNER_PATH"
if x11_helper_prepare_switch; then
  fail_fixture "disabled mode prepared a Helper transaction"
fi
[[ ! -e "$TIKPAL_WEB_MODE_X11_HELPER_GENERATION_PATH" &&
   ! -e "$TIKPAL_WEB_MODE_X11_HELPER_OWNER_PATH" ]] ||
  fail_fixture "disabled mode created Helper ownership state"
x11_helper_guard_may_recover_all ||
  fail_fixture "disabled mode without owner blocked full recovery"

TIKPAL_WEB_MODE_X11_HELPER_MODE=switch
if x11_helper_guard_may_recover_all; then
  fail_fixture "enabled Helper mode allowed full recovery without owner state"
fi
reset_helper_shell_state
begin_fixture_switch || fail_fixture "successful Helper switch failed"
assert_file_json '.owner == "helper" and .generation == 1 and
  ([.surfaces[].xid] == [101,202,303])' "$TIKPAL_WEB_MODE_X11_HELPER_OWNER_PATH"
if x11_helper_guard_may_write 101; then
  fail_fixture "Guard was allowed to write a leased XID"
fi
x11_helper_guard_may_write 999 || fail_fixture "Guard could not write an unrelated XID"
if x11_helper_guard_may_recover_all; then
  fail_fixture "Guard was allowed full recovery while Helper owned surfaces"
fi
sleep 0.4
if x11_helper_guard_may_recover_all; then
  fail_fixture "expired lease without revoke allowed full recovery"
fi
printf 'runtime\nregistry\n' >> "$MOCK_LOG"
x11_helper_finish_success || fail_fixture "successful Helper ownership release failed"
assert_file_json '.owner == "shell" and .generation == 1 and (.surfaces | length) == 0' \
  "$TIKPAL_WEB_MODE_X11_HELPER_OWNER_PATH"
[[ "$TIKPAL_X11_HELPER_ACTIVE" == "0" ]] || fail_fixture "revoke did not clear active state"
x11_helper_guard_may_recover_all ||
  fail_fixture "Shell owner blocked full recovery after revoke"
switch_line="$(grep -n '^switch ' "$MOCK_LOG" | head -1 | cut -d: -f1)"
runtime_line="$(grep -n '^runtime$' "$MOCK_LOG" | head -1 | cut -d: -f1)"
registry_line="$(grep -n '^registry$' "$MOCK_LOG" | head -1 | cut -d: -f1)"
revoke_line="$(grep -n '^revoke ' "$MOCK_LOG" | head -1 | cut -d: -f1)"
(( switch_line < runtime_line && runtime_line < registry_line && registry_line < revoke_line )) ||
  fail_fixture "runtime/registry/revoke order is wrong"

printf '0\n' > "$MOCK_SWITCH_STATUS_FILE"
printf '0\n' > "$MOCK_REVOKE_STATUS_FILE"
reset_helper_shell_state
revoke_count_before="$(grep -c '^revoke ' "$MOCK_LOG" || true)"
if ROOT_DIR="$ROOT_DIR" FIXTURE_DIR="$FIXTURE_DIR" TRACE_PATH="$TRACE_PATH" bash -c '
  source "$ROOT_DIR/deploy/chromium/tikpal-web-mode.sh"
  trap x11_helper_cleanup_on_exit EXIT
  x11_helper_prepare_switch
  x11_helper_begin_switch \
    101 "$FIXTURE_DIR/target-profile" \
    202 "$FIXTURE_DIR/previous-profile" \
    303 "$FIXTURE_DIR/panel-profile"
  chmod 0444 "$TRACE_PATH"
  exit 23
'; then
  fail_fixture "mid-transaction failure unexpectedly succeeded"
else
  cleanup_runner_status=$?
fi
chmod 0660 "$TRACE_PATH"
[[ "$cleanup_runner_status" == "23" ]] ||
  fail_fixture "mid-transaction runner status was not preserved"
assert_file_json '.owner == "shell" and (.surfaces | length) == 0' \
  "$TIKPAL_WEB_MODE_X11_HELPER_OWNER_PATH"
revoke_count_after="$(grep -c '^revoke ' "$MOCK_LOG" || true)"
(( revoke_count_after == revoke_count_before + 1 )) ||
  fail_fixture "mid-transaction trace failure did not revoke exactly once"

printf '20\n' > "$MOCK_SWITCH_STATUS_FILE"
printf '0\n' > "$MOCK_MUTATION_STARTED_FILE"
reset_helper_shell_state
if begin_fixture_switch; then
  fail_fixture "known pre-mutation failure unexpectedly succeeded"
else
  switch_status=$?
fi
[[ "$switch_status" == "20" ]] || fail_fixture "known failure status was not preserved"
failed_generation="$TIKPAL_X11_HELPER_GENERATION"
x11_helper_enter_fallback "$switch_status" || fail_fixture "known pre-mutation fallback failed"
jq -e --argjson previous "$failed_generation" \
  '.owner == "shell" and .generation == ($previous + 1)' \
  "$TIKPAL_WEB_MODE_X11_HELPER_OWNER_PATH" >/dev/null ||
  fail_fixture "fallback did not advance to a new Shell generation"

printf '1\n' > "$MOCK_MUTATION_STARTED_FILE"
reset_helper_shell_state
if begin_fixture_switch; then
  fail_fixture "known post-mutation failure unexpectedly succeeded"
else
  switch_status=$?
fi
printf '1\n' > "$MOCK_REVOKE_STATUS_FILE"
if x11_helper_enter_fallback "$switch_status"; then
  fail_fixture "fallback restored Shell ownership without revoke ACK"
fi
assert_file_json '.owner == "helper"' "$TIKPAL_WEB_MODE_X11_HELPER_OWNER_PATH"
[[ "$TIKPAL_X11_HELPER_ACTIVE" == "1" ]] ||
  fail_fixture "failed revoke cleared active Helper ownership"
printf '0\n' > "$MOCK_REVOKE_STATUS_FILE"
x11_helper_enter_fallback "$switch_status" || fail_fixture "fallback did not recover after revoke ACK"

printf '70\n' > "$MOCK_SWITCH_STATUS_FILE"
reset_helper_shell_state
if begin_fixture_switch; then
  fail_fixture "unknown Helper response unexpectedly succeeded"
else
  switch_status=$?
fi
[[ "$switch_status" == "70" && "$TIKPAL_X11_HELPER_UNKNOWN" == "1" ]] ||
  fail_fixture "unknown Helper response was not retained"
if x11_helper_enter_fallback "$switch_status"; then
  fail_fixture "unknown Helper response entered a second-writer fallback"
fi
assert_file_json '.owner == "helper"' "$TIKPAL_WEB_MODE_X11_HELPER_OWNER_PATH"
if x11_helper_guard_may_write 101 202 303; then
  fail_fixture "Guard wrote leased XIDs after an unknown response"
fi
if x11_helper_guard_may_recover_all; then
  fail_fixture "unknown Helper response allowed full recovery"
fi

TIKPAL_X11_HELPER_UNKNOWN=0
printf '0\n' > "$MOCK_REVOKE_STATUS_FILE"
x11_helper_revoke || fail_fixture "unknown-response fixture cleanup revoke failed"
x11_helper_increment_generation cleanup_generation ||
  fail_fixture "unknown-response fixture cleanup generation failed"
TIKPAL_X11_HELPER_GENERATION="$cleanup_generation"
x11_helper_publish_owner shell "$cleanup_generation" ||
  fail_fixture "unknown-response fixture cleanup ownership failed"
x11_helper_guard_may_recover_all ||
  fail_fixture "revoke with no in-flight transaction did not restore full recovery"

printf '{\n' > "$TIKPAL_WEB_MODE_X11_HELPER_OWNER_PATH"
if x11_helper_guard_may_recover_all; then
  fail_fixture "malformed owner state allowed full recovery"
fi
printf '{"owner":"none","generation":%s,"surfaces":[]}\n' "$cleanup_generation" \
  > "$TIKPAL_WEB_MODE_X11_HELPER_OWNER_PATH"
x11_helper_guard_may_recover_all || fail_fixture "none owner blocked full recovery"
x11_helper_publish_owner shell "$cleanup_generation" ||
  fail_fixture "Shell owner restore after malformed fixture failed"
x11_helper_increment_generation changed_generation ||
  fail_fixture "generation-change fixture could not advance generation"
if x11_helper_guard_may_recover_all; then
  fail_fixture "stale recovery owner survived a generation change"
fi
cleanup_generation="$changed_generation"
TIKPAL_X11_HELPER_GENERATION="$cleanup_generation"
x11_helper_publish_owner shell "$cleanup_generation" ||
  fail_fixture "generation-change fixture could not restore arbitration"
x11_helper_guard_may_recover_all ||
  fail_fixture "current generation blocked full recovery"

TIMEOUT_SOCKET="$FIXTURE_DIR/timeout-helper.sock"
TIMEOUT_DAEMON_LOG="$FIXTURE_DIR/timeout-helper.jsonl"
TIMEOUT_DAEMON_STDOUT="$FIXTURE_DIR/timeout-helper.stdout"
TIMEOUT_TRACE="$FIXTURE_DIR/timeout-guard-trace.jsonl"
TIMEOUT_HEALTH_REQUEST_ID=timeout-reconnect-health
timeout_provider_profile="$FIXTURE_DIR/timeout-provider-profile"
timeout_panel_profile="$FIXTURE_DIR/timeout-panel-profile"
timeout_provider_cache="$(profile_window_cache_path "$timeout_provider_profile")"
timeout_panel_cache="$(profile_window_cache_path "$timeout_panel_profile")"
mkdir -p "$timeout_provider_profile" "$timeout_panel_profile"
printf 'generation\t%s\t0\nprovider\t%s\t101\npanel\t%s\t202\n' \
  "$cleanup_generation" "$timeout_provider_profile" "$timeout_panel_profile" \
  > "$(guard_window_list_file)"
printf '101\n' > "$timeout_provider_cache"
printf '202\n' > "$timeout_panel_cache"
timeout_registry_before="$(cksum "$(guard_window_list_file)")"
timeout_provider_cache_before="$(cksum "$timeout_provider_cache")"
timeout_panel_cache_before="$(cksum "$timeout_panel_cache")"
_CHROMIUM_WINDOW_CACHE=timeout-cache-sentinel
TIKPAL_WEB_MODE_X11_PROCESS_GENERATION="$cleanup_generation"
x11_helper_publish_owner shell "$cleanup_generation" ||
  fail_fixture "timeout fixture could not publish Shell ownership"

DISPLAY="$DISPLAY_VALUE" "$X11_HELPER" daemon \
  --socket "$TIMEOUT_SOCKET" \
  --display "$DISPLAY_VALUE" \
  --generation-file "$TIKPAL_WEB_MODE_X11_HELPER_GENERATION_PATH" \
  --transaction-timeout-ms 250 \
  > "$TIMEOUT_DAEMON_STDOUT" 2> "$TIMEOUT_DAEMON_LOG" &
HELPER_PID=$!
for attempt in {1..100}; do
  [[ -S "$TIMEOUT_SOCKET" ]] && break
  kill -0 "$HELPER_PID" >/dev/null 2>&1 ||
    fail_fixture "timeout Helper daemon exited before creating its socket"
  sleep 0.02
done
[[ -S "$TIMEOUT_SOCKET" ]] || fail_fixture "timeout Helper socket did not appear"

fixture_previous_helper_binary="$TIKPAL_WEB_MODE_X11_HELPER_BINARY"
fixture_previous_helper_socket="$TIKPAL_WEB_MODE_X11_HELPER_SOCKET"
fixture_previous_response_timeout="$TIKPAL_WEB_MODE_X11_HELPER_RESPONSE_TIMEOUT_MS"
TIKPAL_WEB_MODE_X11_HELPER_BINARY="$X11_HELPER"
TIKPAL_WEB_MODE_X11_HELPER_SOCKET="$TIMEOUT_SOCKET"
TIKPAL_WEB_MODE_X11_HELPER_RESPONSE_TIMEOUT_MS=1000
timeout_trace_start="$(wc -l < "$TRACE_PATH" | tr -d ' ')"
kill -STOP "$XSERVER_PID"
set +e
guard_run_tick "$timeout_provider_profile" "$timeout_panel_profile"
timeout_guard_status=$?
kill -CONT "$XSERVER_PID" >/dev/null 2>&1
set -e
[[ "$timeout_guard_status" == 0 ]] ||
  fail_fixture "Guard timeout tick did not fail closed as a nonfatal tick"

timeout_health_response="$(
  TIKPAL_X11_HELPER_CALLER_ROLE=timeout_reconnect_fixture \
    "$X11_HELPER" client health \
      --socket "$TIMEOUT_SOCKET" \
      --connect-timeout-ms 100 \
      --response-timeout-ms 1000 \
      --request-id "$TIMEOUT_HEALTH_REQUEST_ID"
)" || fail_fixture "timeout Helper did not reconnect on the next request"
TIKPAL_WEB_MODE_X11_HELPER_BINARY="$fixture_previous_helper_binary"
TIKPAL_WEB_MODE_X11_HELPER_SOCKET="$fixture_previous_helper_socket"
TIKPAL_WEB_MODE_X11_HELPER_RESPONSE_TIMEOUT_MS="$fixture_previous_response_timeout"
kill "$HELPER_PID" >/dev/null 2>&1 || true
wait "$HELPER_PID" 2>/dev/null || true
HELPER_PID=""

tail -n "+$((timeout_trace_start + 1))" "$TRACE_PATH" > "$TIMEOUT_TRACE"
timeout_request_id="$(
  jq -r 'select(.operation == "inspect_failed") |
    (.detail | try capture("request_id=(?<id>[^ ]+)").id catch empty)' \
    "$TIMEOUT_TRACE" | tail -1
)"
[[ "$timeout_request_id" =~ ^guard-[A-Za-z0-9._:-]+$ ]] ||
  fail_fixture "Guard timeout trace did not expose its request ID"
jq -s -e --arg request_id "$timeout_request_id" \
  --arg health_id "$TIMEOUT_HEALTH_REQUEST_ID" \
  --argjson generation "$cleanup_generation" '
  def event_index($event; $id):
    first(to_entries[] | select(.value.event == $event and .value.requestId == $id) | .key);
  (event_index("request_started"; $request_id)) as $started |
  (event_index("x11_reply_timeout"; $request_id)) as $timeout |
  (event_index("connection_reset"; $request_id)) as $reset |
  (event_index("request_failed"; $request_id)) as $failed |
  (event_index("request_started"; $health_id)) as $health_started |
  (event_index("reconnect"; $health_id)) as $reconnect |
  (event_index("request_completed"; $health_id)) as $completed |
  ($started < $timeout and $timeout < $reset and $reset < $failed and
   $failed < $health_started and $health_started < $reconnect and $reconnect < $completed) and
  ([.[] | select(.event == "request_started" and .requestId == $request_id)][0] |
    .operation == "inspect" and .callerRole == "window_guard" and
    .generation == $generation and .surfaceXids == {provider:101, panel:202}) and
  ([.[] | select(.event == "connection_reset" and .requestId == $request_id)][0] |
    .connectionEpoch == (.connectionEpochBefore + 1) and
    .result == "disconnected" and .leaseReleased == true and .inFlight == false) and
  ([.[] | select(.event == "request_failed" and .requestId == $request_id)][0] |
    .code == "X11_REPLY_TIMEOUT" and .timeout == true and .connectionReset == true and
    .reconnectResult == "deferred" and .leaseReleased == true and .inFlight == false and
    .mutationStarted == false and (.queueMs | type) == "number" and
    (.batchSendMs | type) == "number" and (.replyWaitMs | type) == "number" and
    .batchReadMs == null and (.totalMs | type) == "number") and
  ([.[] | select(.event == "reconnect" and .requestId == $health_id)][0] |
    .connectionEpoch == (.connectionEpochBefore + 1) and .result == "connected") and
  ([.[] | select(.event == "request_completed" and .requestId == $health_id)][0] |
    .code == "OK" and .result == "ok" and .connectionAvailable == true)
  ' "$TIMEOUT_DAEMON_LOG" >/dev/null ||
  fail_fixture "Helper timeout request log chain was incomplete or misattributed"
jq -s -e --arg request_id "$timeout_request_id" '
  ([.[] | select(.operation == "inspect_failed" and
    (.detail | contains("request_id=" + $request_id + " ")))] | length) == 1 and
  ([.[] | select(.operation == "guard_tick_completed" and
    (.detail | contains("repair_required=false mutation_count=0 outcome=inspect_failed")))] |
    length) == 1 and
  ([.[] | select(.requested_geometry != "control")] | length) == 0 and
  ([.[] | select(.operation == "guard_registry_published")] | length) == 0
  ' "$TIMEOUT_TRACE" >/dev/null ||
  fail_fixture "Guard timeout trace did not preserve zero-mutation fail-closed state"
[[ "$(cksum "$(guard_window_list_file)")" == "$timeout_registry_before" &&
   "$(cksum "$timeout_provider_cache")" == "$timeout_provider_cache_before" &&
   "$(cksum "$timeout_panel_cache")" == "$timeout_panel_cache_before" &&
   "$_CHROMIUM_WINDOW_CACHE" == timeout-cache-sentinel ]] ||
  fail_fixture "Guard timeout changed registry or window cache state"
jq -e '.ok == true and .leaseReleased == true and .inFlight == false and
  .connectionEpoch >= 3 and .counters.xcbTimeouts >= 1 and .counters.reconnects >= 1' \
  <<< "$timeout_health_response" >/dev/null ||
  fail_fixture "Helper timeout cleanup/reconnect health was incomplete"

LOG_FAILURE_SOCKET="$FIXTURE_DIR/l.sock"
LOG_FAILURE_FIFO="$FIXTURE_DIR/log-failure.fifo"
LOG_FAILURE_FIRST_LINE="$FIXTURE_DIR/log-failure-first-line"
mkfifo "$LOG_FAILURE_FIFO"
(
  IFS= read -r first_log_line < "$LOG_FAILURE_FIFO"
  printf '%s\n' "$first_log_line" > "$LOG_FAILURE_FIRST_LINE"
) &
LOG_READER_PID=$!
DISPLAY="$DISPLAY_VALUE" "$X11_HELPER" daemon \
  --socket "$LOG_FAILURE_SOCKET" \
  --display "$DISPLAY_VALUE" \
  --generation-file "$TIKPAL_WEB_MODE_X11_HELPER_GENERATION_PATH" \
  --transaction-timeout-ms 250 \
  > /dev/null 2> "$LOG_FAILURE_FIFO" &
HELPER_PID=$!
for attempt in {1..100}; do
  [[ -S "$LOG_FAILURE_SOCKET" ]] && break
  kill -0 "$HELPER_PID" >/dev/null 2>&1 ||
    fail_fixture "closed-log Helper daemon exited before creating its socket: $(tr '\n' ' ' < "$LOG_FAILURE_FIRST_LINE" 2>/dev/null || true)"
  sleep 0.02
done
[[ -S "$LOG_FAILURE_SOCKET" ]] || fail_fixture "closed-log Helper socket did not appear"
kill -STOP "$XSERVER_PID"
set +e
log_failure_timeout_response="$(
  TIKPAL_X11_HELPER_CALLER_ROLE=closed_log_fixture \
    "$X11_HELPER" client inspect \
      --socket "$LOG_FAILURE_SOCKET" \
      --connect-timeout-ms 100 \
      --response-timeout-ms 1000 \
      --request-id closed-log-timeout \
      --generation "$cleanup_generation" \
      --surface provider 101 "$timeout_provider_profile"
)"
log_failure_timeout_status=$?
kill -CONT "$XSERVER_PID" >/dev/null 2>&1
set -e
wait "$LOG_READER_PID" 2>/dev/null || true
LOG_READER_PID=""
[[ "$log_failure_timeout_status" == 20 ]] ||
  fail_fixture "closed-log timeout did not return a known pre-mutation failure"
log_failure_health="$(
  "$X11_HELPER" client health \
    --socket "$LOG_FAILURE_SOCKET" \
    --connect-timeout-ms 100 \
    --response-timeout-ms 1000 \
    --request-id closed-log-health
)" || fail_fixture "closed-log Helper did not survive timeout logging failure"
jq -e '.code == "X11_REPLY_TIMEOUT" and .leaseReleased == true and
  .inFlight == false and .mutationStarted == false' \
  <<< "$log_failure_timeout_response" >/dev/null ||
  fail_fixture "closed-log timeout did not release its transaction state"
jq -e '.ok == true and .leaseReleased == true and .inFlight == false and
  .counters.xcbTimeouts >= 1 and .counters.reconnects >= 1' \
  <<< "$log_failure_health" >/dev/null ||
  fail_fixture "closed-log Helper cleanup/reconnect state was not healthy"
kill "$HELPER_PID" >/dev/null 2>&1 || true
wait "$HELPER_PID" 2>/dev/null || true
HELPER_PID=""
rm -f "$(guard_window_list_file)" "$timeout_provider_cache" "$timeout_panel_cache"
_CHROMIUM_WINDOW_CACHE=""

printf '20\n' > "$MOCK_SWITCH_STATUS_FILE"
reset_helper_shell_state
switch_count_before="$(grep -c '^switch ' "$MOCK_LOG" || true)"
if begin_fixture_switch; then
  fail_fixture "BUSY fixture unexpectedly succeeded"
else
  switch_status=$?
fi
switch_count_after="$(grep -c '^switch ' "$MOCK_LOG" || true)"
(( switch_count_after == switch_count_before + 1 )) ||
  fail_fixture "BUSY caused more than one Helper transaction"
x11_helper_enter_fallback "$switch_status" || fail_fixture "BUSY fixture cleanup failed"
cleanup_generation="$TIKPAL_X11_HELPER_GENERATION"

GUARD_WRITE_LOG="$FIXTURE_DIR/guard-writes.log"
GUARD_REGISTRY_FILE="$FIXTURE_DIR/guard-registry"
: > "$GUARD_WRITE_LOG"
printf '101\n202\n303\n' > "$GUARD_REGISTRY_FILE"
GUARD_FAST_RESULT=0
GUARD_FAST_SLEEP=0
read_guard_window() {
  case "$1" in
    provider) sed -n '1p' "$GUARD_REGISTRY_FILE" ;;
    panel) sed -n '2p' "$GUARD_REGISTRY_FILE" ;;
    kiosk) sed -n '3p' "$GUARD_REGISTRY_FILE" ;;
    *) return 1 ;;
  esac
}
tile_guard_windows_fast() {
  local provider_window panel_window kiosk_window
  if [[ "$GUARD_FAST_SLEEP" != "0" ]]; then
    printf 'guard-locked\n' >> "$GUARD_WRITE_LOG"
    sleep "$GUARD_FAST_SLEEP"
  fi
  if [[ "$GUARD_FAST_RESULT" != "0" ]]; then
    [[ "$GUARD_FAST_RESULT" != "1" ]] || TIKPAL_GUARD_RECOVERY_REQUIRED=true
    [[ "$GUARD_FAST_RESULT" != "75" ]] || TIKPAL_GUARD_TICK_OUTCOME=inspect_failed
    return "$GUARD_FAST_RESULT"
  fi
  provider_window="$(read_guard_window provider)"
  panel_window="$(read_guard_window panel)"
  kiosk_window="$(read_guard_window kiosk)"
  printf 'maintain\n' >> "$GUARD_WRITE_LOG"
  printf 'maintain-state %s %s %s\n' "$provider_window" "$panel_window" "$kiosk_window" \
    >> "$GUARD_WRITE_LOG"
}
visible_chromium_windows() {
  printf 'enumerate\n' >> "$GUARD_WRITE_LOG"
  printf '101\n202\n303\n'
}
tile_visible_web_mode_windows() {
  [[ -r "${4:-}" ]] || fail_fixture "recovery mutation did not use the locked enumeration"
  printf 'recover\n' >> "$GUARD_WRITE_LOG"
}
first_window_for_profile() {
  case "$1" in
    *target-profile) printf '101\n' ;;
    *panel-profile) printf '202\n' ;;
    *) return 1 ;;
  esac
}
write_guard_window_list() {
  printf '%s\n%s\n%s\n' "$2" "$4" "$(read_guard_window kiosk)" > "$GUARD_REGISTRY_FILE"
  printf 'registry\n' >> "$GUARD_WRITE_LOG"
}
close_web_mode_from_guard() {
  printf 'close\n' >> "$GUARD_WRITE_LOG"
}
record_x11_helper_guard_skip() {
  printf 'skip\n' >> "$GUARD_WRITE_LOG"
}

TIKPAL_X11_HELPER_DAEMON_INSTANCE_ID=fixture-daemon
TIKPAL_X11_HELPER_CONNECTION_EPOCH=1
TIKPAL_X11_HELPER_GENERATION="$cleanup_generation"
TIKPAL_X11_HELPER_LEASE_ID=guard-lease
x11_helper_publish_owner helper "$cleanup_generation" 101 202 303 ||
  fail_fixture "Guard Helper owner publish failed"
guard_maintain_windows "$FIXTURE_DIR/target-profile" "$FIXTURE_DIR/panel-profile" 1 0
guard_close_web_mode
[[ "$(grep -c '^skip$' "$GUARD_WRITE_LOG" || true)" == "2" &&
   "$(grep -Ec '^(maintain|recover|close)$' "$GUARD_WRITE_LOG" || true)" == "0" ]] ||
  fail_fixture "Guard wrote while Helper owned an exact surface"
x11_helper_publish_owner shell "$cleanup_generation" ||
  fail_fixture "Guard Shell owner publish failed"
guard_maintain_windows "$FIXTURE_DIR/target-profile" "$FIXTURE_DIR/panel-profile" 1 0
guard_close_web_mode
[[ "$(grep -c '^maintain$' "$GUARD_WRITE_LOG" || true)" == "1" &&
   "$(grep -c '^close$' "$GUARD_WRITE_LOG" || true)" == "1" ]] ||
  fail_fixture "Guard did not resume after Shell ownership"

: > "$GUARD_WRITE_LOG"
GUARD_FAST_RESULT=1
x11_helper_publish_owner helper "$cleanup_generation" 404 505 606 ||
  fail_fixture "stale-registry Helper owner publish failed"
guard_maintain_windows "$FIXTURE_DIR/target-profile" "$FIXTURE_DIR/panel-profile" 1 0
[[ "$(grep -c '^skip$' "$GUARD_WRITE_LOG" || true)" == "1" &&
   "$(grep -Ec '^(enumerate|recover|registry)$' "$GUARD_WRITE_LOG" || true)" == "0" ]] ||
  fail_fixture "stale registry bypassed Helper full-recovery ownership"
x11_helper_publish_owner shell "$cleanup_generation" ||
  fail_fixture "recovery Shell owner publish failed"
: > "$GUARD_WRITE_LOG"
GUARD_FAST_RESULT=75
TIKPAL_GUARD_RECOVERY_REQUIRED=false
TIKPAL_GUARD_TICK_OUTCOME=steady
guard_maintain_windows "$FIXTURE_DIR/target-profile" "$FIXTURE_DIR/panel-profile" 1 0
[[ "$TIKPAL_GUARD_TICK_OUTCOME" == "inspect_failed" &&
   "$(grep -Ec '^(enumerate|recover|registry|maintain)$' "$GUARD_WRITE_LOG" || true)" == "0" ]] ||
  fail_fixture "transient Guard inspect failure entered full recovery"

: > "$GUARD_WRITE_LOG"
GUARD_FAST_RESULT=1
TIKPAL_GUARD_RECOVERY_REQUIRED=true
all_checks_before="$(grep -c 'owner-allows .* --all' "$MOCK_LOG" || true)"
guard_maintain_windows "$FIXTURE_DIR/target-profile" "$FIXTURE_DIR/panel-profile" 1 0
all_checks_after="$(grep -c 'owner-allows .* --all' "$MOCK_LOG" || true)"
[[ "$((all_checks_after - all_checks_before))" == "2" &&
   "$(tail -3 "$GUARD_WRITE_LOG" | tr '\n' ' ')" == "enumerate recover registry " ]] ||
  fail_fixture "Shell recovery did not enumerate, recheck owner, then mutate"
GUARD_FAST_RESULT=0

if [[ "$FLOCK_FIXTURE_AVAILABLE" == "1" ]]; then
  LOCK_PATH="$TIKPAL_WEB_MODE_PROFILE_ROOT/web-mode.lock"

  LOCK_EVENTS="$FIXTURE_DIR/lock-events.jsonl"
  LOCK_RUNNER="$FIXTURE_DIR/lock-runner"
  : > "$LOCK_EVENTS"
  cat > "$LOCK_RUNNER" <<'LOCK_RUNNER_SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
source "$ROOT_DIR/deploy/chromium/tikpal-web-mode.sh"
WEB_MODE_COMMAND_ARGS=(child)
if [[ "${TIKPAL_WEB_MODE_LOCKED:-0}" == "1" ]]; then
  with_web_mode_lock false
else
  with_web_mode_lock true
fi
LOCK_RUNNER_SCRIPT
  chmod +x "$LOCK_RUNNER"
  if env \
    ROOT_DIR="$ROOT_DIR" \
    TIKPAL_WEB_MODE_SOURCE_ONLY=1 \
    TIKPAL_KIOSK_SKIP_ENV_SOURCE=1 \
    TIKPAL_WEB_MODE_PROFILE_ROOT="$TIKPAL_WEB_MODE_PROFILE_ROOT" \
    TIKPAL_WEB_MODE_X11_MUTATION_TRACE_PATH="$TRACE_PATH" \
    TIKPAL_WEB_MODE_SWITCH_TRACE_EVENTS_PATH="$LOCK_EVENTS" \
    TIKPAL_WEB_MODE_SWITCH_TRACE_RUN_ID=lock-cleanup-fixture \
    TIKPAL_WEB_MODE_SWITCH_TRACE_ROUND_ID=1 \
    TIKPAL_WEB_MODE_SWITCH_TRACE_PASS_INDEX=1 \
    TIKPAL_WEB_MODE_SWITCH_TRACE_FROM_PROVIDER=fixture_from \
    TIKPAL_WEB_MODE_SWITCH_TRACE_TO_PROVIDER=fixture_to \
    TIKPAL_WEB_MODE_SWITCH_TRACE_REQUEST_ID=lock-cleanup-request \
    TIKPAL_WEB_MODE_SWITCH_TRACE_MONOTONIC_OFFSET_MS=0 \
    TIKPAL_WEB_MODE_LOCKED=0 \
    "$LOCK_RUNNER"
  then
    fail_fixture "failing locked runner unexpectedly succeeded"
  else
    lock_runner_status=$?
  fi
  [[ "$lock_runner_status" == "1" ]] ||
    fail_fixture "failing locked runner status was not preserved"
  jq -s -e '
    ([.[] | select(.event == "lock_acquired")] | length) == 1 and
    ([.[] | select(.event == "lock_released" and .result == "ok" and .error_code == "")] | length) == 1
  ' "$LOCK_EVENTS" >/dev/null ||
    fail_fixture "failing runner did not emit one successful ordered lock release"
  flock -x -w 0.2 "$LOCK_PATH" true ||
    fail_fixture "failing runner left the web-mode lock held"

  # Guard owns the production lock first; a Shell ownership publication must
  # wait until the Guard mutation has completed.
  : > "$GUARD_WRITE_LOG"
  x11_helper_publish_owner shell "$cleanup_generation" ||
    fail_fixture "Guard-first Shell owner publish failed"
  GUARD_FAST_SLEEP=0.3
  GUARD_FAST_RESULT=0
  guard_maintain_windows "$FIXTURE_DIR/target-profile" "$FIXTURE_DIR/panel-profile" 1 0 &
  guard_lock_pid=$!
  for attempt in {1..100}; do
    grep -q '^guard-locked$' "$GUARD_WRITE_LOG" && break
    sleep 0.01
  done
  grep -q '^guard-locked$' "$GUARD_WRITE_LOG" ||
    fail_fixture "Guard-first fixture did not acquire the shared lock"
  (
    exec {shell_wait_fd}>"$LOCK_PATH"
    flock -x -w 1 "$shell_wait_fd" || exit 75
    x11_helper_publish_owner helper "$cleanup_generation" 404 505 606 || exit 1
    printf 'shell-owner\n' >> "$GUARD_WRITE_LOG"
    flock -u "$shell_wait_fd"
    exec {shell_wait_fd}>&-
  ) &
  shell_lock_pid=$!
  sleep 0.1
  kill -0 "$shell_lock_pid" >/dev/null 2>&1 ||
    fail_fixture "Shell did not wait while Guard held the shared lock"
  wait "$guard_lock_pid"
  wait "$shell_lock_pid"
  maintain_state_line="$(grep -n '^maintain-state ' "$GUARD_WRITE_LOG" | tail -1 | cut -d: -f1)"
  shell_owner_line="$(grep -n '^shell-owner$' "$GUARD_WRITE_LOG" | tail -1 | cut -d: -f1)"
  (( maintain_state_line < shell_owner_line )) ||
    fail_fixture "Shell published Helper ownership before the Guard mutation completed"
  GUARD_FAST_SLEEP=0

  # Shell owns the lock first, publishes Helper ownership, commits the new
  # registry, revokes, and restores Shell ownership before Guard can proceed.
  : > "$GUARD_WRITE_LOG"
  printf '101\n202\n303\n' > "$GUARD_REGISTRY_FILE"
  exec {held_lock_fd}>"$LOCK_PATH"
  flock -x -w 1 "$held_lock_fd" || fail_fixture "could not acquire the Shell fixture lock"
  printf '0\n' > "$MOCK_SWITCH_STATUS_FILE"
  reset_helper_shell_state
  x11_helper_prepare_switch || fail_fixture "Shell-first Helper prepare failed"
  x11_helper_begin_switch \
    707 "$FIXTURE_DIR/target-profile" \
    101 "$FIXTURE_DIR/previous-profile" \
    808 "$FIXTURE_DIR/panel-profile" ||
    fail_fixture "Shell-first Helper transaction failed"
  guard_maintain_windows "$FIXTURE_DIR/target-profile" "$FIXTURE_DIR/panel-profile" 1 0 &
  blocked_guard_pid=$!
  sleep 0.1
  kill -0 "$blocked_guard_pid" >/dev/null 2>&1 ||
    fail_fixture "Guard did not block behind the Shell lock"
  printf 'runtime\n' >> "$GUARD_WRITE_LOG"
  printf '707\n808\n909\n' > "$GUARD_REGISTRY_FILE"
  printf 'registry\n' >> "$GUARD_WRITE_LOG"
  x11_helper_finish_success || fail_fixture "Shell-first Helper revoke failed"
  cleanup_generation="$TIKPAL_X11_HELPER_GENERATION"
  flock -u "$held_lock_fd"
  wait "$blocked_guard_pid"
  exec {held_lock_fd}>&-
  assert_file_json '.owner == "shell"' "$TIKPAL_WEB_MODE_X11_HELPER_OWNER_PATH"
  grep -q '^maintain-state 707 808 909$' "$GUARD_WRITE_LOG" ||
    fail_fixture "Guard used the stale registry after the Shell-first transaction"

  # Unknown outcome keeps Helper ownership after Shell releases the lock. Both
  # exact Guard writes and full recovery remain blocked until explicit revoke
  # and a new generation/connection epoch are published.
  : > "$GUARD_WRITE_LOG"
  printf '101\n202\n303\n' > "$GUARD_REGISTRY_FILE"
  GUARD_FAST_RESULT=1
  exec {held_lock_fd}>"$LOCK_PATH"
  flock -x -w 1 "$held_lock_fd" || fail_fixture "could not acquire unknown-timeout lock"
  TIKPAL_X11_HELPER_DAEMON_INSTANCE_ID=fixture-daemon
  TIKPAL_X11_HELPER_CONNECTION_EPOCH=1
  TIKPAL_X11_HELPER_GENERATION="$cleanup_generation"
  TIKPAL_X11_HELPER_LEASE_ID=unknown-lease
  TIKPAL_X11_HELPER_ACTIVE=1
  x11_helper_publish_owner helper "$cleanup_generation" 404 505 606 ||
    fail_fixture "unknown-timeout owner publish failed"
  guard_maintain_windows "$FIXTURE_DIR/target-profile" "$FIXTURE_DIR/panel-profile" 1 0 &
  blocked_guard_pid=$!
  sleep 0.1
  kill -0 "$blocked_guard_pid" >/dev/null 2>&1 ||
    fail_fixture "unknown-timeout Guard did not wait for the Shell lock"
  flock -u "$held_lock_fd"
  wait "$blocked_guard_pid"
  exec {held_lock_fd}>&-
  [[ "$(grep -c '^skip$' "$GUARD_WRITE_LOG" || true)" == "1" &&
     "$(grep -Ec '^(enumerate|recover|registry|maintain)$' "$GUARD_WRITE_LOG" || true)" == "0" ]] ||
    fail_fixture "unknown timeout allowed Guard or recovery X11 writes"

  exec {held_lock_fd}>"$LOCK_PATH"
  flock -x -w 1 "$held_lock_fd" || fail_fixture "manual recovery could not acquire the shared lock"
  printf '2\n' > "$MOCK_EPOCH_FILE"
  x11_helper_revoke || fail_fixture "manual recovery revoke failed"
  x11_helper_increment_generation manual_generation ||
    fail_fixture "manual recovery generation advance failed"
  cleanup_generation="$manual_generation"
  TIKPAL_X11_HELPER_CONNECTION_EPOCH=2
  TIKPAL_X11_HELPER_GENERATION="$cleanup_generation"
  x11_helper_publish_owner shell "$cleanup_generation" ||
    fail_fixture "manual recovery Shell owner publish failed"
  flock -u "$held_lock_fd"
  exec {held_lock_fd}>&-
  : > "$GUARD_WRITE_LOG"
  TIKPAL_GUARD_RECOVERY_REQUIRED=true
  guard_maintain_windows "$FIXTURE_DIR/target-profile" "$FIXTURE_DIR/panel-profile" 1 0
  [[ "$(tail -3 "$GUARD_WRITE_LOG" | tr '\n' ' ')" == "enumerate recover registry " ]] ||
    fail_fixture "manual revoke/new-epoch recovery did not restore full recovery"
  GUARD_FAST_RESULT=0
fi

printf 'tikpal X11 Helper Phase 1 smoke passed\n'

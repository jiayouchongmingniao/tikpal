#!/usr/bin/env bash
set -euo pipefail

# Observe one already-authorized resident Provider switch without participating
# in it.  This is a Phase 0 gate: it only calls the Helper's read-only inspect
# operation and refuses to run unless the daemon advertises Phase 0.

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
: "${TIKPAL_WEB_MODE_PROFILE_ROOT:=$HOME/.config/tikpal-web-mode}"
: "${TIKPAL_WEB_MODE_STATE_PATH:=$APP_DIR/.tikpal/web-mode-state.json}"
: "${TIKPAL_WEB_MODE_X11_HELPER_BINARY:=/usr/local/libexec/tikpal-x11-helper}"
: "${TIKPAL_WEB_MODE_X11_HELPER_SOCKET:=/run/tikpal/x11-helper.sock}"
: "${TIKPAL_WEB_MODE_X11_HELPER_GENERATION_PATH:=$TIKPAL_WEB_MODE_PROFILE_ROOT/x11-helper-generation}"
: "${TIKPAL_WEB_MODE_X11_HELPER_CONNECT_TIMEOUT_MS:=100}"
: "${TIKPAL_WEB_MODE_X11_HELPER_INSPECT_RESPONSE_TIMEOUT_MS:=1000}"

SAMPLE_COUNT=20
WAIT_TIMEOUT_MS=300000
POLL_INTERVAL_MS=20
OUTPUT_DIR=""

usage() {
  cat <<'USAGE'
Usage: tikpal-x11-helper-phase0-competition.sh --output-dir PATH [options]

Wait for one existing resident Provider switch, then capture read-only Helper
batch inspections of target, previous, and Side Panel surfaces.

Options:
  --samples N                 Batch samples to collect (default: 20)
  --wait-timeout-ms N         Maximum time to wait for openingProvider (default: 300000)
  --poll-interval-ms N        State polling interval (default: 20)
  --output-dir PATH           A new evidence directory (required)
USAGE
}

fail() {
  local message="$1"
  printf '%s\n' "$message" >&2
  if [[ -n "$OUTPUT_DIR" && -d "$OUTPUT_DIR" ]]; then
    printf '%s\n' "$message" > "$OUTPUT_DIR/failure.txt" 2>/dev/null || true
  fi
  exit 1
}

positive_integer() {
  [[ "$1" =~ ^[1-9][0-9]*$ ]]
}

sleep_ms() {
  local milliseconds="$1" seconds remainder
  seconds=$((milliseconds / 1000))
  remainder=$((milliseconds % 1000))
  sleep "${seconds}.$(printf '%03d' "$remainder")"
}

profile_window_cache_path() {
  local profile="$1" key
  key="$(printf '%s' "$profile" | cksum | awk '{print $1 "-" $2}')"
  printf '%s/window-%s.id\n' "$TIKPAL_WEB_MODE_PROFILE_ROOT" "$key"
}

read_cached_xid() {
  local profile="$1" cache_path xid
  cache_path="$(profile_window_cache_path "$profile")"
  [[ -r "$cache_path" ]] || return 1
  xid="$(<"$cache_path")"
  [[ "$xid" =~ ^[1-9][0-9]*$ ]] || return 1
  printf '%s\n' "$xid"
}

read_state_tsv() {
  jq -r '[
    (.activeProvider // ""),
    (.openingProvider // ""),
    (.openRequestId // ""),
    (.openXSessionGeneration // "")
  ] | @tsv' "$TIKPAL_WEB_MODE_STATE_PATH" 2>/dev/null
}

read_generation() {
  local generation="0"
  if [[ -r "$TIKPAL_WEB_MODE_X11_HELPER_GENERATION_PATH" ]]; then
    generation="$(<"$TIKPAL_WEB_MODE_X11_HELPER_GENERATION_PATH")"
  fi
  [[ "$generation" =~ ^[0-9]+$ ]] || generation=0
  printf '%s\n' "$generation"
}

health() {
  TIKPAL_X11_HELPER_CALLER_ROLE=phase0_competition \
    "$TIKPAL_WEB_MODE_X11_HELPER_BINARY" client health \
      --socket "$TIKPAL_WEB_MODE_X11_HELPER_SOCKET" \
      --connect-timeout-ms "$TIKPAL_WEB_MODE_X11_HELPER_CONNECT_TIMEOUT_MS" \
      --response-timeout-ms "$TIKPAL_WEB_MODE_X11_HELPER_INSPECT_RESPONSE_TIMEOUT_MS" \
      --request-id "phase0-competition-health-$$-$1"
}

phase0_health_valid() {
  jq -e '
    .ok == true and .phase == 0 and .readOnly == true and .mutationsAllowed == false and
    .supportedOperations == ["health", "inspect"] and
    .mutationStarted == false and .inFlight == false and
    .counters.switchRequests == 0 and .counters.mutationRequests == 0 and
    .counters.revokeRequests == 0 and .counters.inspectFailures == 0 and
    .counters.xcbTimeouts == 0 and .counters.reconnects == 0
  ' >/dev/null
}

validate_sample() {
  local response_path="$1" target_xid="$2" target_profile="$3"
  local previous_xid="$4" previous_profile="$5" panel_xid="$6" panel_profile="$7"
  local expected_epoch="$8" expected_identities_path="$9"
  jq -e \
    --argjson target_xid "$target_xid" --arg target_profile "$target_profile" \
    --argjson previous_xid "$previous_xid" --arg previous_profile "$previous_profile" \
    --argjson panel_xid "$panel_xid" --arg panel_profile "$panel_profile" \
    --argjson expected_epoch "$expected_epoch" \
    --slurpfile expected_identities "$expected_identities_path" '
      .ok == true and .operation == "inspect" and .readOnly == true and
      .mutationStarted == false and .connectionEpoch == $expected_epoch and
      (.asyncError? == null) and
      (.surfaces | length == 3) and
      (.surfaces[0] | .role == "target" and .xid == $target_xid and .profile == $target_profile) and
      (.surfaces[1] | .role == "previous" and .xid == $previous_xid and .profile == $previous_profile) and
      (.surfaces[2] | .role == "panel" and .xid == $panel_xid and .profile == $panel_profile) and
      all(.surfaces[]; .ok == true and .code == "OK" and .profileMatched == true and
        .mapState == "viewable" and (.pid | type == "number" and . > 0) and
        (.pidStarttime | type == "number" and . > 0) and
        (.geometry.parentIsRoot == true) and (.xcbError? == null)) and
      (if ($expected_identities[0] | length) == 0 then true else
        [.surfaces[] | {role, xid, profile, pid, pidStarttime}] == $expected_identities[0]
      end)
    ' "$response_path" >/dev/null
}

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --samples)
      [[ "$#" -ge 2 ]] || { usage >&2; exit 64; }
      SAMPLE_COUNT="$2"
      shift 2
      ;;
    --wait-timeout-ms)
      [[ "$#" -ge 2 ]] || { usage >&2; exit 64; }
      WAIT_TIMEOUT_MS="$2"
      shift 2
      ;;
    --poll-interval-ms)
      [[ "$#" -ge 2 ]] || { usage >&2; exit 64; }
      POLL_INTERVAL_MS="$2"
      shift 2
      ;;
    --output-dir)
      [[ "$#" -ge 2 ]] || { usage >&2; exit 64; }
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit 64
      ;;
  esac
done

positive_integer "$SAMPLE_COUNT" || fail "samples must be a positive integer"
[[ "$SAMPLE_COUNT" -ge 20 ]] || fail "Phase 0 competition requires at least 20 samples"
positive_integer "$WAIT_TIMEOUT_MS" || fail "wait timeout must be a positive integer"
positive_integer "$POLL_INTERVAL_MS" || fail "poll interval must be a positive integer"
[[ -n "$OUTPUT_DIR" ]] || { usage >&2; exit 64; }
[[ ! -e "$OUTPUT_DIR" ]] || fail "output directory already exists: $OUTPUT_DIR"
command -v jq >/dev/null 2>&1 || fail "jq is required"
[[ -x "$TIKPAL_WEB_MODE_X11_HELPER_BINARY" ]] || fail "Helper binary is unavailable"
[[ -S "$TIKPAL_WEB_MODE_X11_HELPER_SOCKET" ]] || fail "Helper socket is unavailable"
[[ -r "$TIKPAL_WEB_MODE_STATE_PATH" ]] || fail "runtime state is unavailable"

umask 077
mkdir -p "$OUTPUT_DIR" || fail "cannot create output directory"

health_before="$(health before)" || fail "Phase 0 Helper health failed before arming"
printf '%s\n' "$health_before" > "$OUTPUT_DIR/health-before.json" || fail "cannot write health evidence"
phase0_health_valid <<< "$health_before" || fail "Helper is not a clean read-only Phase 0 daemon"

IFS=$'\t' read -r previous_provider opening_provider _ _ <<< "$(read_state_tsv || true)"
[[ -n "$previous_provider" && -z "$opening_provider" ]] ||
  fail "sampler must arm while one Provider is active and no open request is in flight"
[[ "$previous_provider" =~ ^[a-z0-9_]+$ ]] || fail "active Provider ID is invalid"

jq -n \
  --arg previousProvider "$previous_provider" \
  --arg daemonInstanceId "$(jq -r '.daemonInstanceId' <<< "$health_before")" \
  --argjson connectionEpoch "$(jq -r '.connectionEpoch' <<< "$health_before")" \
  --argjson samples "$SAMPLE_COUNT" \
  --argjson waitTimeoutMs "$WAIT_TIMEOUT_MS" \
  '{status:"armed", previousProvider:$previousProvider, daemonInstanceId:$daemonInstanceId,
    connectionEpoch:$connectionEpoch, samples:$samples, waitTimeoutMs:$waitTimeoutMs}' \
  > "$OUTPUT_DIR/armed.json" || fail "cannot write armed evidence"
printf 'phase0 competition sampler armed: previous=%s samples=%s output=%s\n' \
  "$previous_provider" "$SAMPLE_COUNT" "$OUTPUT_DIR"

max_polls=$(( (WAIT_TIMEOUT_MS + POLL_INTERVAL_MS - 1) / POLL_INTERVAL_MS ))
target_provider=""
open_request_id=""
open_generation=""
for ((poll=1; poll<=max_polls; poll++)); do
  state_tsv="$(read_state_tsv || true)"
  IFS=$'\t' read -r state_active state_opening state_request state_generation <<< "$state_tsv"
  if [[ -n "$state_opening" ]]; then
    [[ "$state_active" == "$previous_provider" ]] ||
      fail "opening request is not a resident switch from the armed Provider"
    target_provider="$state_opening"
    open_request_id="$state_request"
    open_generation="$state_generation"
    break
  fi
  sleep_ms "$POLL_INTERVAL_MS"
done
[[ -n "$target_provider" && "$target_provider" != "$previous_provider" ]] ||
  fail "no resident Provider switch was observed before timeout"
[[ "$target_provider" =~ ^[a-z0-9_]+$ && -n "$open_request_id" && -n "$open_generation" ]] ||
  fail "opening request is incomplete or invalid"

target_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$target_provider"
previous_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$previous_provider"
panel_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel"
[[ -d "$target_profile" && -d "$previous_profile" && -d "$panel_profile" ]] ||
  fail "one or more switch profiles are unavailable"

for ((attempt=1; attempt<=50; attempt++)); do
  target_xid="$(read_cached_xid "$target_profile" || true)"
  previous_xid="$(read_cached_xid "$previous_profile" || true)"
  panel_xid="$(read_cached_xid "$panel_profile" || true)"
  [[ -n "$target_xid" && -n "$previous_xid" && -n "$panel_xid" ]] && break
  sleep 0.02
done
[[ -n "${target_xid:-}" && -n "${previous_xid:-}" && -n "${panel_xid:-}" ]] ||
  fail "target, previous, or Panel cached XID is unavailable"

expected_instance="$(jq -r '.daemonInstanceId' <<< "$health_before")"
expected_epoch="$(jq -r '.connectionEpoch' <<< "$health_before")"
generation="$(read_generation)"
jq -n \
  --arg previousProvider "$previous_provider" --arg targetProvider "$target_provider" \
  --arg openRequestId "$open_request_id" --arg openXSessionGeneration "$open_generation" \
  --arg targetProfile "$target_profile" --arg previousProfile "$previous_profile" --arg panelProfile "$panel_profile" \
  --argjson targetXid "$target_xid" --argjson previousXid "$previous_xid" --argjson panelXid "$panel_xid" \
  --arg daemonInstanceId "$expected_instance" --argjson connectionEpoch "$expected_epoch" \
  --argjson generation "$generation" \
  '{previousProvider:$previousProvider, targetProvider:$targetProvider, openRequestId:$openRequestId,
    openXSessionGeneration:$openXSessionGeneration, target:{profile:$targetProfile,xid:$targetXid},
    previous:{profile:$previousProfile,xid:$previousXid}, panel:{profile:$panelProfile,xid:$panelXid},
    daemonInstanceId:$daemonInstanceId, connectionEpoch:$connectionEpoch, generation:$generation}' \
  > "$OUTPUT_DIR/switch-context.json" || fail "cannot write switch context"

identities_path="$OUTPUT_DIR/identities.json"
printf '[]\n' > "$identities_path" || fail "cannot initialize identity evidence"
for ((sample=1; sample<=SAMPLE_COUNT; sample++)); do
  request_id="phase0-competition-${open_request_id:0:48}-$sample"
  response_path="$OUTPUT_DIR/sample-$(printf '%02d' "$sample").json"
  set +e
  response="$(
    TIKPAL_X11_HELPER_CALLER_ROLE=phase0_competition \
      "$TIKPAL_WEB_MODE_X11_HELPER_BINARY" client inspect \
        --socket "$TIKPAL_WEB_MODE_X11_HELPER_SOCKET" \
        --connect-timeout-ms "$TIKPAL_WEB_MODE_X11_HELPER_CONNECT_TIMEOUT_MS" \
        --response-timeout-ms "$TIKPAL_WEB_MODE_X11_HELPER_INSPECT_RESPONSE_TIMEOUT_MS" \
        --request-id "$request_id" --generation "$generation" \
        --surface target "$target_xid" "$target_profile" \
        --surface previous "$previous_xid" "$previous_profile" \
        --surface panel "$panel_xid" "$panel_profile"
  )"
  status=$?
  set -e
  printf '%s\n' "$response" > "$response_path" || fail "cannot write sample evidence"
  [[ "$status" == 0 ]] || fail "sample $sample Helper inspect failed with status $status"
  validate_sample "$response_path" "$target_xid" "$target_profile" \
    "$previous_xid" "$previous_profile" "$panel_xid" "$panel_profile" \
    "$expected_epoch" "$identities_path" || fail "sample $sample violated Phase 0 assertions"
  if [[ "$sample" == 1 ]]; then
    jq '[.surfaces[] | {role, xid, profile, pid, pidStarttime}]' "$response_path" > "$identities_path" ||
      fail "cannot record process identity evidence"
  fi
done

health_after="$(health after)" || fail "Phase 0 Helper health failed after samples"
printf '%s\n' "$health_after" > "$OUTPUT_DIR/health-after.json" || fail "cannot write final health evidence"
phase0_health_valid <<< "$health_after" || fail "Helper no longer satisfies clean Phase 0 assertions"
jq -e --arg instance "$expected_instance" --argjson epoch "$expected_epoch" \
  --argjson samples "$SAMPLE_COUNT" \
  --slurpfile before "$OUTPUT_DIR/health-before.json" '
    .daemonInstanceId == $instance and .connectionEpoch == $epoch and
    .counters.switchRequests == $before[0].counters.switchRequests and
    .counters.mutationRequests == $before[0].counters.mutationRequests and
    .counters.revokeRequests == $before[0].counters.revokeRequests and
    .counters.inspectFailures == $before[0].counters.inspectFailures and
    .counters.xcbTimeouts == $before[0].counters.xcbTimeouts and
    .counters.reconnects == $before[0].counters.reconnects and
    (.counters.inspectRequests >= ($before[0].counters.inspectRequests + $samples))
  ' <<< "$health_after" >/dev/null ||
  fail "Helper counters, epoch, or daemon identity drifted during competition sampling"

jq -s \
  --slurpfile context "$OUTPUT_DIR/switch-context.json" \
  --slurpfile before "$OUTPUT_DIR/health-before.json" \
  --slurpfile after "$OUTPUT_DIR/health-after.json" '
    def p95: sort | .[((length * 0.95 | ceil) - 1)];
    def numbers(filter): [ .[] | filter | select(type == "number") ];
    {
      status:"passed",
      samples:length,
      context:$context[0],
      p95Ms:{
        clientSocket:(numbers(.clientTimings.socketTotalMs) | p95),
        clientConnect:(numbers(.clientTimings.connectMs) | p95),
        clientResponseWait:(numbers(.clientTimings.responseWaitMs) | p95),
        daemonQueue:(numbers(.timings.daemonQueueMs) | p95),
        batchSend:(numbers(.timings.batchSendMs) | p95),
        replyWait:(numbers(.timings.replyWaitMs) | p95),
        procIdentity:(numbers(.timings.procIdentityMs) | p95),
        daemonTotal:(numbers(.timings.totalMs) | p95)
      },
      healthBefore:$before[0],
      healthAfter:$after[0],
      inspectDelta:($after[0].counters.inspectRequests - $before[0].counters.inspectRequests),
      mutationDelta:($after[0].counters.mutationRequests - $before[0].counters.mutationRequests),
      timeoutDelta:($after[0].counters.xcbTimeouts - $before[0].counters.xcbTimeouts),
      reconnectDelta:($after[0].counters.reconnects - $before[0].counters.reconnects)
    }
  ' "$OUTPUT_DIR"/sample-*.json > "$OUTPUT_DIR/summary.json" || fail "cannot write summary"
jq -e '
  .status == "passed" and .samples >= 20 and .inspectDelta >= .samples and
  .mutationDelta == 0 and .timeoutDelta == 0 and .reconnectDelta == 0 and
  .p95Ms.clientSocket < 100 and .p95Ms.daemonQueue < 100 and .p95Ms.batchSend < 100 and
  .p95Ms.replyWait < 100 and .p95Ms.procIdentity < 100 and .p95Ms.daemonTotal < 100
' "$OUTPUT_DIR/summary.json" >/dev/null || fail "competition p95 or Phase 0 gate failed"

printf 'phase0 competition sampler passed: samples=%s output=%s\n' "$SAMPLE_COUNT" "$OUTPUT_DIR"

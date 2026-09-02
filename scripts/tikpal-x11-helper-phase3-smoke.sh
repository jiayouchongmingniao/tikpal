#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FIXTURE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/tikpal-x11-helper-phase3.XXXXXX")"
HELPER="$FIXTURE_DIR/tikpal-x11-helper"
FIXTURE_CLIENT="$FIXTURE_DIR/tikpal-x11-fixture-client"
XSERVER_PID=""
HELPER_PID=""
SURFACE_PID=""
EXTRA_SURFACE_PIDS=()

cleanup() {
  for pid in "$HELPER_PID" "$SURFACE_PID" "${EXTRA_SURFACE_PIDS[@]}" "$XSERVER_PID"; do
    [[ -n "$pid" ]] || continue
    kill "$pid" >/dev/null 2>&1 || true
    wait "$pid" 2>/dev/null || true
  done
  rm -rf "$FIXTURE_DIR"
}
trap cleanup EXIT

fail_fixture() {
  printf 'tikpal X11 Helper Phase 3 fixture failed: %s\n' "$*" >&2
  exit 1
}

command -v cc >/dev/null 2>&1 || fail_fixture "cc is required"
command -v jq >/dev/null 2>&1 || fail_fixture "jq is required"
command -v Xvfb >/dev/null 2>&1 || fail_fixture "Xvfb is required"
pkg-config --exists xcb json-c || fail_fixture "xcb and json-c development packages are required"

cc -std=c11 -Wall -Wextra -Werror -DTIKPAL_X11_HELPER_LOCAL_FIXTURE \
  $(pkg-config --cflags xcb json-c) \
  "$ROOT_DIR/deploy/chromium/tikpal-x11-helper.c" \
  -o "$HELPER" \
  $(pkg-config --libs xcb json-c)
cc -std=c11 -Wall -Wextra -Werror \
  $(pkg-config --cflags xcb) \
  "$ROOT_DIR/scripts/fixtures/tikpal-x11-late-writer-client.c" \
  -o "$FIXTURE_CLIENT" \
  $(pkg-config --libs xcb)

DISPLAY_NUMBER=""
for candidate in {111..130}; do
  if [[ ! -S "/tmp/.X11-unix/X$candidate" ]]; then
    DISPLAY_NUMBER="$candidate"
    break
  fi
done
[[ -n "$DISPLAY_NUMBER" ]] || fail_fixture "no free local X display number"
DISPLAY_VALUE=":$DISPLAY_NUMBER"
Xvfb "$DISPLAY_VALUE" -screen 0 2560x720x24 -nolisten tcp >"$FIXTURE_DIR/xvfb.log" 2>&1 &
XSERVER_PID=$!
for attempt in {1..100}; do
  [[ -S "/tmp/.X11-unix/X$DISPLAY_NUMBER" ]] && break
  kill -0 "$XSERVER_PID" >/dev/null 2>&1 ||
    fail_fixture "Xvfb exited early: $(tr '\n' ' ' < "$FIXTURE_DIR/xvfb.log")"
  sleep 0.02
done
[[ -S "/tmp/.X11-unix/X$DISPLAY_NUMBER" ]] || fail_fixture "Xvfb socket did not appear"

GENERATION_PATH="$FIXTURE_DIR/generation"
SOCKET_PATH="$FIXTURE_DIR/helper.sock"
XID_PATH="$FIXTURE_DIR/provider.xid"
PROFILE_PATH="$FIXTURE_DIR/profile"
printf '1\n' > "$GENERATION_PATH"
mkdir -p "$PROFILE_PATH"
"$FIXTURE_CLIENT" surface --display "$DISPLAY_VALUE" --output "$XID_PATH" \
  --user-data-dir="$PROFILE_PATH" &
SURFACE_PID=$!
for attempt in {1..100}; do
  [[ -s "$XID_PATH" ]] && break
  kill -0 "$SURFACE_PID" >/dev/null 2>&1 || fail_fixture "fixture surface exited early"
  sleep 0.02
done
[[ -s "$XID_PATH" ]] || fail_fixture "fixture surface did not publish an XID"
XID="$(<"$XID_PATH")"

DISPLAY="$DISPLAY_VALUE" "$HELPER" daemon --socket "$SOCKET_PATH" --display "$DISPLAY_VALUE" \
  --generation-file "$GENERATION_PATH" --phase 3 > /dev/null 2>"$FIXTURE_DIR/helper.log" &
HELPER_PID=$!
for attempt in {1..100}; do
  [[ -S "$SOCKET_PATH" ]] && break
  kill -0 "$HELPER_PID" >/dev/null 2>&1 ||
    fail_fixture "Helper daemon exited early: $(tr '\n' ' ' < "$FIXTURE_DIR/helper.log")"
  sleep 0.02
done
[[ -S "$SOCKET_PATH" ]] || fail_fixture "Helper socket did not appear"

health="$("$HELPER" client health --socket "$SOCKET_PATH" --request-id phase3-health)"
jq -e '.ok == true and .phase == 3 and .readOnly == true and .mutationsAllowed == false and
  .supportedOperations == ["health", "inspect", "watch", "renew-watch", "unwatch", "revoke"]' \
  <<< "$health" >/dev/null || fail_fixture "Phase 3 health contract"
set +e
switch_response="$(printf '%s' '{"version":1,"requestId":"phase3-switch","operation":"switch"}' |
  "$HELPER" client request --socket "$SOCKET_PATH")"
switch_status=$?
set -e
[[ "$switch_status" == "20" ]] || fail_fixture "Phase 3 switch was not rejected"
jq -e '.ok == false and .errorCode == "OPERATION_DISABLED_PHASE3" and .mutationStarted == false' \
  <<< "$switch_response" >/dev/null || fail_fixture "Phase 3 switch rejection contract"
INSTANCE_ID="$(jq -r .daemonInstanceId <<< "$health")"
EPOCH="$(jq -r .connectionEpoch <<< "$health")"

watch_request="$(jq -cn \
  --arg instance "$INSTANCE_ID" \
  --arg lease phase3-watch-lease \
  --argjson epoch "$EPOCH" \
  --argjson xid "$XID" \
  '{version:1,requestId:"phase3-watch",operation:"watch",daemonInstanceId:$instance,
    connectionEpoch:$epoch,generation:1,leaseId:$lease,leaseDurationMs:3000,
    surfaces:[{role:"provider",xid:$xid}]}')"
watch_response="$(printf '%s' "$watch_request" | "$HELPER" client request --socket "$SOCKET_PATH")"
jq -e '.ok == true and .code == "WATCHING" and .watchValid == true and .readOnly == true and
  .mutationStarted == false and (.surfaces | length == 1) and
  .surfaces[0].role == "provider" and .surfaces[0].xid > 0' \
  <<< "$watch_response" >/dev/null || fail_fixture "watch subscription contract"

"$FIXTURE_CLIENT" window --display "$DISPLAY_VALUE" --action geometry --xid "$XID" \
  --x 120 --y 0 --width 1920 --height 720 || fail_fixture "fixture geometry change"
observed_health=""
for attempt in {1..100}; do
  observed_health="$("$HELPER" client health --socket "$SOCKET_PATH" --request-id "phase3-observed-$attempt")"
  jq -e '.watchValid == true and .counters.watchEventsReported >= 1 and
    .counters.watchEventsWouldRepair >= 1 and .counters.mutationRequests == 0 and
    ([.watchEvents[] | select(.type == "ConfigureNotify" and .wouldRepair == true)] | length) >= 1' \
    <<< "$observed_health" >/dev/null && break
  sleep 0.02
done
jq -e '.watchValid == true and .counters.watchEventsReported >= 1 and
  .counters.watchEventsWouldRepair >= 1 and .counters.mutationRequests == 0 and
  ([.watchEvents[] | select(.type == "ConfigureNotify" and .wouldRepair == true)] | length) >= 1' \
  <<< "$observed_health" >/dev/null || fail_fixture "daemon event loop did not record would-repair"

printf '2\n' > "$GENERATION_PATH"
"$FIXTURE_CLIENT" window --display "$DISPLAY_VALUE" --action geometry --xid "$XID" \
  --x 160 --y 0 --width 1920 --height 720 || fail_fixture "stale fixture geometry change"
stale_health=""
for attempt in {1..100}; do
  stale_health="$("$HELPER" client health --socket "$SOCKET_PATH" --request-id "phase3-stale-$attempt")"
  jq -e '.watchValid == false and .watchInvalidReason == "GENERATION_ADVANCED" and
    .counters.watchEventsStaleDropped >= 1 and .counters.mutationRequests == 0' \
    <<< "$stale_health" >/dev/null && break
  sleep 0.02
done
jq -e '.watchValid == false and .watchInvalidReason == "GENERATION_ADVANCED" and
  .counters.watchEventsStaleDropped >= 1 and .counters.mutationRequests == 0' \
  <<< "$stale_health" >/dev/null || fail_fixture "stale generation was not discarded"

unwatch_request="$(jq -cn \
  --arg instance "$INSTANCE_ID" \
  --arg lease phase3-watch-lease \
  --argjson epoch "$EPOCH" \
  '{version:1,requestId:"phase3-unwatch",operation:"unwatch",daemonInstanceId:$instance,
    connectionEpoch:$epoch,generation:1,leaseId:$lease}')"
unwatch_response="$(printf '%s' "$unwatch_request" | "$HELPER" client request --socket "$SOCKET_PATH")"
jq -e '.ok == true and .code == "UNWATCHED" and .watchValid == false and .leaseReleased == true and
  .mutationStarted == false' <<< "$unwatch_response" >/dev/null || fail_fixture "unwatch contract"

panel_watch_request="$(jq -cn \
  --arg instance "$INSTANCE_ID" --arg lease phase3-panel-lease --arg profile "$PROFILE_PATH" \
  --argjson epoch "$EPOCH" --argjson xid "$XID" \
  '{version:1,requestId:"phase3-panel-watch",operation:"watch",daemonInstanceId:$instance,
    connectionEpoch:$epoch,generation:2,leaseId:$lease,leaseDurationMs:3000,repairScope:"panel",
    surfaces:[{role:"panel",xid:$xid,profile:$profile,
      geometry:{x:1920,y:0,width:640,height:720},targetOpacity:4294967295}]}')"
panel_watch_response="$(printf '%s' "$panel_watch_request" | "$HELPER" client request --socket "$SOCKET_PATH")"
jq -e '.ok == true and .code == "WATCHING" and .repairScope == "panel" and .readOnly == false and
  (.surfaces | length == 1)' <<< "$panel_watch_response" >/dev/null ||
  fail_fixture "3B panel lease contract"
"$FIXTURE_CLIENT" window --display "$DISPLAY_VALUE" --action geometry --xid "$XID" \
  --x 100 --y 20 --width 1200 --height 600 || fail_fixture "3B panel perturbation"
panel_health=""
for attempt in {1..100}; do
  panel_health="$("$HELPER" client health --socket "$SOCKET_PATH" --request-id "phase3-panel-$attempt")"
  jq -e '.watchValid == true and .watchRepairScope == "panel" and .mutationsAllowed == true and
    .counters.watchRepairRequests >= 1 and .counters.watchRepairMutations >= 1 and
    .counters.watchRepairFailures == 0' <<< "$panel_health" >/dev/null &&
    [[ "$(DISPLAY="$DISPLAY_VALUE" "$FIXTURE_CLIENT" geometry "$XID")" == "1920,0_640x720" ]] && break
  sleep 0.02
done
jq -e '.watchValid == true and .watchRepairScope == "panel" and .counters.watchRepairMutations >= 1 and
  .counters.watchRepairFailures == 0' <<< "$panel_health" >/dev/null || fail_fixture "3B Panel repair"
[[ "$(DISPLAY="$DISPLAY_VALUE" "$FIXTURE_CLIENT" geometry "$XID")" == "1920,0_640x720" ]] ||
  fail_fixture "3B Panel geometry was not repaired"

panel_unwatch_request="$(jq -cn \
  --arg instance "$INSTANCE_ID" --arg lease phase3-panel-lease --argjson epoch "$EPOCH" \
  '{version:1,requestId:"phase3-panel-unwatch",operation:"unwatch",daemonInstanceId:$instance,
    connectionEpoch:$epoch,generation:2,leaseId:$lease}')"
printf '%s' "$panel_unwatch_request" | "$HELPER" client request --socket "$SOCKET_PATH" |
  jq -e '.ok == true and .code == "UNWATCHED" and .leaseReleased == true' >/dev/null ||
  fail_fixture "3B Panel release"

ACTIVE_XID_PATH="$FIXTURE_DIR/active.xid"
PREVIOUS_XID_PATH="$FIXTURE_DIR/previous.xid"
ACTIVE_PROFILE="$FIXTURE_DIR/active-profile"
PREVIOUS_PROFILE="$FIXTURE_DIR/previous-profile"
mkdir -p "$ACTIVE_PROFILE" "$PREVIOUS_PROFILE"
"$FIXTURE_CLIENT" surface --display "$DISPLAY_VALUE" --output "$ACTIVE_XID_PATH" \
  --user-data-dir="$ACTIVE_PROFILE" --x 0 --y 0 --width 1920 --height 720 &
EXTRA_SURFACE_PIDS+=("$!")
"$FIXTURE_CLIENT" surface --display "$DISPLAY_VALUE" --output "$PREVIOUS_XID_PATH" \
  --user-data-dir="$PREVIOUS_PROFILE" --x 2560 --y 0 --width 1920 --height 720 &
EXTRA_SURFACE_PIDS+=("$!")
for attempt in {1..100}; do
  [[ -s "$ACTIVE_XID_PATH" && -s "$PREVIOUS_XID_PATH" ]] && break
  sleep 0.02
done
[[ -s "$ACTIVE_XID_PATH" && -s "$PREVIOUS_XID_PATH" ]] || fail_fixture "3C fixture surfaces did not publish"
ACTIVE_XID="$(<"$ACTIVE_XID_PATH")"
PREVIOUS_XID="$(<"$PREVIOUS_XID_PATH")"

provider_watch_request="$(jq -cn \
  --arg instance "$INSTANCE_ID" --arg lease phase3-provider-lease \
  --arg active_profile "$ACTIVE_PROFILE" --arg previous_profile "$PREVIOUS_PROFILE" \
  --arg panel_profile "$PROFILE_PATH" --argjson epoch "$EPOCH" \
  --argjson active "$ACTIVE_XID" --argjson previous "$PREVIOUS_XID" --argjson panel "$XID" \
  '{version:1,requestId:"phase3-provider-watch",operation:"watch",daemonInstanceId:$instance,
    connectionEpoch:$epoch,generation:2,leaseId:$lease,leaseDurationMs:3000,repairScope:"provider",
    surfaces:[
      {role:"active",xid:$active,profile:$active_profile,geometry:{x:0,y:0,width:1920,height:720},targetOpacity:4294967295},
      {role:"previous",xid:$previous,profile:$previous_profile,geometry:{x:2560,y:0,width:1920,height:720}},
      {role:"panel",xid:$panel,profile:$panel_profile,geometry:{x:1920,y:0,width:640,height:720},targetOpacity:4294967295}
    ]}')"
provider_watch_response="$(printf '%s' "$provider_watch_request" | "$HELPER" client request --socket "$SOCKET_PATH")"
jq -e '.ok == true and .repairScope == "provider" and .readOnly == false and
  (.surfaces | length == 3)' <<< "$provider_watch_response" >/dev/null ||
  fail_fixture "3C provider lease contract"
GUARD_ROOT="$FIXTURE_DIR/guard-root"
mkdir -p "$GUARD_ROOT"
printf 'generation\t2\t0\nprovider\t%s\t%s\npanel\t%s\t%s\n' \
  "$ACTIVE_PROFILE" "$ACTIVE_XID" "$PROFILE_PATH" "$XID" > "$GUARD_ROOT/guard-windows.tsv"
TIKPAL_WEB_MODE_SOURCE_ONLY=1 TIKPAL_KIOSK_SKIP_ENV_SOURCE=1 \
TIKPAL_WEB_MODE_PROFILE_ROOT="$GUARD_ROOT" \
TIKPAL_WEB_MODE_X11_HELPER_BINARY="$HELPER" \
TIKPAL_WEB_MODE_X11_HELPER_SOCKET="$SOCKET_PATH" \
TIKPAL_WEB_MODE_X11_HELPER_MODE=watch \
TIKPAL_WEB_MODE_X11_HELPER_WATCH_DOWNSHIFT=1 \
  bash -c 'set -euo pipefail; source "$1"; x11_helper_watch_lease_healthy "$2" "$3"' \
  _ "$ROOT_DIR/deploy/chromium/tikpal-web-mode.sh" "$ACTIVE_PROFILE" "$PROFILE_PATH" ||
  fail_fixture "3D healthy provider lease was not accepted"
"$FIXTURE_CLIENT" window --display "$DISPLAY_VALUE" --action geometry --xid "$ACTIVE_XID" \
  --x 130 --y 10 --width 1500 --height 600 || fail_fixture "3C active perturbation"
"$FIXTURE_CLIENT" window --display "$DISPLAY_VALUE" --action geometry --xid "$PREVIOUS_XID" \
  --x 10 --y 0 --width 1920 --height 720 || fail_fixture "3C previous perturbation"
"$FIXTURE_CLIENT" window --display "$DISPLAY_VALUE" --action opacity --xid "$XID" \
  --opacity 0xffffff00 || fail_fixture "3C panel opacity perturbation"
provider_health=""
for attempt in {1..100}; do
  provider_health="$("$HELPER" client health --socket "$SOCKET_PATH" --request-id "phase3-provider-$attempt")"
  jq -e '.watchValid == true and .watchRepairScope == "provider" and .mutationsAllowed == true and
    .counters.watchRepairRequests >= 1 and .counters.watchRepairMutations >= 3 and
    .counters.watchRepairFailures == 0' <<< "$provider_health" >/dev/null &&
    [[ "$(DISPLAY="$DISPLAY_VALUE" "$FIXTURE_CLIENT" geometry "$ACTIVE_XID")" == "0,0_1920x720" ]] &&
    [[ "$(DISPLAY="$DISPLAY_VALUE" "$FIXTURE_CLIENT" geometry "$PREVIOUS_XID")" == "2560,0_1920x720" ]] && break
  sleep 0.02
done
jq -e '.watchValid == true and .watchRepairScope == "provider" and .counters.watchRepairMutations >= 3 and
  .counters.watchRepairFailures == 0' <<< "$provider_health" >/dev/null || fail_fixture "3C provider repair"
[[ "$(DISPLAY="$DISPLAY_VALUE" "$FIXTURE_CLIENT" geometry "$ACTIVE_XID")" == "0,0_1920x720" ]] ||
  fail_fixture "3C active geometry was not repaired"
[[ "$(DISPLAY="$DISPLAY_VALUE" "$FIXTURE_CLIENT" geometry "$PREVIOUS_XID")" == "2560,0_1920x720" ]] ||
  fail_fixture "3C previous geometry was not repaired"

mutations_before_unmap="$(jq -r '.counters.watchRepairMutations' <<< "$provider_health")"
"$FIXTURE_CLIENT" window --display "$DISPLAY_VALUE" --action unmap --xid "$ACTIVE_XID" ||
  fail_fixture "3C active unmap"
invalid_health=""
for attempt in {1..100}; do
  invalid_health="$("$HELPER" client health --socket "$SOCKET_PATH" --request-id "phase3-invalid-$attempt")"
  jq -e --argjson mutations "$mutations_before_unmap" \
    '.watchValid == false and .watchInvalidReason == "WATCHED_WINDOW_UNMAPPED" and
     .counters.watchRepairMutations == $mutations' <<< "$invalid_health" >/dev/null && break
  sleep 0.02
done
jq -e --argjson mutations "$mutations_before_unmap" \
  '.watchValid == false and .watchInvalidReason == "WATCHED_WINDOW_UNMAPPED" and
   .counters.watchRepairMutations == $mutations' <<< "$invalid_health" >/dev/null ||
  fail_fixture "3C unmap invalidation did not stop repairs"
if TIKPAL_WEB_MODE_SOURCE_ONLY=1 TIKPAL_KIOSK_SKIP_ENV_SOURCE=1 \
  TIKPAL_WEB_MODE_PROFILE_ROOT="$GUARD_ROOT" \
  TIKPAL_WEB_MODE_X11_HELPER_BINARY="$HELPER" \
  TIKPAL_WEB_MODE_X11_HELPER_SOCKET="$SOCKET_PATH" \
  TIKPAL_WEB_MODE_X11_HELPER_MODE=watch \
  TIKPAL_WEB_MODE_X11_HELPER_WATCH_DOWNSHIFT=1 \
    bash -c 'set -euo pipefail; source "$1"; x11_helper_watch_lease_healthy "$2" "$3"' \
    _ "$ROOT_DIR/deploy/chromium/tikpal-web-mode.sh" "$ACTIVE_PROFILE" "$PROFILE_PATH"
then
  fail_fixture "3D accepted an invalid provider lease"
fi

provider_unwatch_request="$(jq -cn \
  --arg instance "$INSTANCE_ID" --arg lease phase3-provider-lease --argjson epoch "$EPOCH" \
  '{version:1,requestId:"phase3-provider-unwatch",operation:"unwatch",daemonInstanceId:$instance,
    connectionEpoch:$epoch,generation:2,leaseId:$lease}')"
printf '%s' "$provider_unwatch_request" | "$HELPER" client request --socket "$SOCKET_PATH" |
  jq -e '.ok == true and .code == "UNWATCHED" and .leaseReleased == true' >/dev/null ||
  fail_fixture "3C provider release"

printf 'tikpal X11 Helper Phase 3A-3D smoke passed\n'

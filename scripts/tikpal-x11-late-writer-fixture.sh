#!/usr/bin/env bash
set -euo pipefail

# This fixture asserts that every stale-writer event is retained. Production
# foreground traces are best-effort so a busy Guard trace cannot delay a live
# switch; keep the stricter append mode here for the audit assertion.
export TIKPAL_WEB_MODE_X11_HOT_TRACE_NONBLOCKING=0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FIXTURE_DIR="$(mktemp -d /tmp/tikpal-x11-late-writer.XXXXXX)"
HELPER="$FIXTURE_DIR/tikpal-x11-helper"
X11_CLIENT="$FIXTURE_DIR/tikpal-x11-fixture-client"
SOCKET_PATH="$FIXTURE_DIR/helper.sock"
TRACE_PATH="$FIXTURE_DIR/x11-mutations.jsonl"
STATE_PATH="$FIXTURE_DIR/web-mode-state.json"
PROFILE_ROOT="$FIXTURE_DIR/web-mode"
GENERATION_PATH="$PROFILE_ROOT/x11-helper-generation"
OWNER_PATH="$PROFILE_ROOT/x11-helper-owner.json"
REGISTRY_PATH="$PROFILE_ROOT/guard-windows.tsv"
BARRIER_FIFO="$FIXTURE_DIR/legacy-writer.fifo"
BARRIER_READY="$FIXTURE_DIR/legacy-writer.ready"
CONTROL_GEOMETRY_CALLS="$FIXTURE_DIR/control-geometry-calls.tsv"
GUARD_MUTATION_LOG="$FIXTURE_DIR/guard-mutations.tsv"
XSERVER_PID=""
HELPER_PID=""
LEGACY_WRITER_PID=""
LEASE_WRITER_PID=""
SURFACE_PIDS=()

cleanup() {
  local pid
  [[ -z "$LEGACY_WRITER_PID" ]] || kill "$LEGACY_WRITER_PID" >/dev/null 2>&1 || true
  [[ -z "$LEASE_WRITER_PID" ]] || kill "$LEASE_WRITER_PID" >/dev/null 2>&1 || true
  [[ -z "$HELPER_PID" ]] || kill "$HELPER_PID" >/dev/null 2>&1 || true
  for pid in "${SURFACE_PIDS[@]:-}"; do
    [[ -z "$pid" ]] || kill "$pid" >/dev/null 2>&1 || true
  done
  [[ -z "$XSERVER_PID" ]] || kill "$XSERVER_PID" >/dev/null 2>&1 || true
  [[ -z "$LEGACY_WRITER_PID" ]] || wait "$LEGACY_WRITER_PID" 2>/dev/null || true
  [[ -z "$LEASE_WRITER_PID" ]] || wait "$LEASE_WRITER_PID" 2>/dev/null || true
  [[ -z "$HELPER_PID" ]] || wait "$HELPER_PID" 2>/dev/null || true
  for pid in "${SURFACE_PIDS[@]:-}"; do
    [[ -z "$pid" ]] || wait "$pid" 2>/dev/null || true
  done
  [[ -z "$XSERVER_PID" ]] || wait "$XSERVER_PID" 2>/dev/null || true
  rm -rf "$FIXTURE_DIR"
}
trap cleanup EXIT

fail_fixture() {
  printf 'tikpal X11 late-writer fixture failed: %s\n' "$*" >&2
  exit 1
}

wait_for_file() {
  local path="$1" description="$2"
  for _ in {1..200}; do
    [[ -s "$path" ]] && return 0
    sleep 0.01
  done
  fail_fixture "$description did not become ready"
}

geometry_of() {
  DISPLAY="$DISPLAY_VALUE" "$X11_CLIENT" geometry "$1"
}

assert_geometry() {
  local xid="$1" expected="$2" label="$3" actual
  actual="$(geometry_of "$xid" || true)"
  [[ "$actual" == "$expected" ]] ||
    fail_fixture "$label geometry is $actual, expected $expected"
}

for tool in cc pkg-config jq Xvfb mkfifo; do
  command -v "$tool" >/dev/null 2>&1 || fail_fixture "$tool is required"
done
pkg-config --exists xcb json-c || fail_fixture "xcb and json-c development packages are required"
if ! command -v flock >/dev/null 2>&1; then
  command -v python3 >/dev/null 2>&1 || fail_fixture "python3 is required for the local flock fixture"
  cp "$ROOT_DIR/scripts/fixtures/flock.py" "$FIXTURE_DIR/flock"
  chmod +x "$FIXTURE_DIR/flock"
  export PATH="$FIXTURE_DIR:$PATH"
fi

cc -std=c11 -Wall -Wextra -Werror -DTIKPAL_X11_HELPER_LOCAL_FIXTURE \
  $(pkg-config --cflags xcb json-c) \
  "$ROOT_DIR/deploy/chromium/tikpal-x11-helper.c" \
  -o "$HELPER" \
  $(pkg-config --libs xcb json-c)
cc -std=c11 -Wall -Wextra -Werror \
  $(pkg-config --cflags xcb) \
  "$ROOT_DIR/scripts/fixtures/tikpal-x11-late-writer-client.c" \
  -o "$X11_CLIENT" \
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
for _ in {1..200}; do
  [[ -S "/tmp/.X11-unix/X$DISPLAY_NUMBER" ]] && break
  kill -0 "$XSERVER_PID" >/dev/null 2>&1 ||
    fail_fixture "Xvfb exited early: $(tr '\n' ' ' < "$FIXTURE_DIR/xvfb.log")"
  sleep 0.01
done
[[ -S "/tmp/.X11-unix/X$DISPLAY_NUMBER" ]] || fail_fixture "Xvfb socket did not appear"

TARGET_PROFILE="$PROFILE_ROOT/providers/qobuz"
PREVIOUS_PROFILE="$PROFILE_ROOT/providers/apple_music"
PANEL_PROFILE="$PROFILE_ROOT/side-panel"
KIOSK_PROFILE="$PROFILE_ROOT/kiosk"
mkdir -p "$TARGET_PROFILE" "$PREVIOUS_PROFILE" "$PANEL_PROFILE" "$KIOSK_PROFILE"

"$X11_CLIENT" surface --display "$DISPLAY_VALUE" --output "$FIXTURE_DIR/target.xid" \
  --user-data-dir="$TARGET_PROFILE" --x 2560 --y 0 --width 1920 --height 720 &
SURFACE_PIDS+=("$!")
"$X11_CLIENT" surface --display "$DISPLAY_VALUE" --output "$FIXTURE_DIR/previous.xid" \
  --user-data-dir="$PREVIOUS_PROFILE" --x 0 --y 0 --width 1920 --height 720 &
SURFACE_PIDS+=("$!")
"$X11_CLIENT" surface --display "$DISPLAY_VALUE" --output "$FIXTURE_DIR/panel.xid" \
  --user-data-dir="$PANEL_PROFILE" --x 1920 --y 0 --width 640 --height 720 &
SURFACE_PIDS+=("$!")
"$X11_CLIENT" surface --display "$DISPLAY_VALUE" --output "$FIXTURE_DIR/kiosk.xid" \
  --user-data-dir="$KIOSK_PROFILE" --x 0 --y 0 --width 2559 --height 719 &
SURFACE_PIDS+=("$!")
wait_for_file "$FIXTURE_DIR/target.xid" "target surface"
wait_for_file "$FIXTURE_DIR/previous.xid" "previous surface"
wait_for_file "$FIXTURE_DIR/panel.xid" "panel surface"
wait_for_file "$FIXTURE_DIR/kiosk.xid" "kiosk surface"
TARGET_XID="$(<"$FIXTURE_DIR/target.xid")"
PREVIOUS_XID="$(<"$FIXTURE_DIR/previous.xid")"
PANEL_XID="$(<"$FIXTURE_DIR/panel.xid")"
KIOSK_XID="$(<"$FIXTURE_DIR/kiosk.xid")"

shell_geometry="$({
  env \
    TIKPAL_WEB_MODE_SOURCE_ONLY=1 \
    TIKPAL_KIOSK_SKIP_ENV_SOURCE=1 \
    TIKPAL_WEB_MODE_X11_TRACE_GEOMETRY_COMMAND=trace_geometry_fixture \
    ROOT_DIR="$ROOT_DIR" TARGET_XID="$TARGET_XID" PANEL_XID="$PANEL_XID" \
    bash -c '
      trace_geometry_fixture() {
        case "$2" in
          "$TARGET_XID") printf "X=2560\nY=0\nWIDTH=1920\nHEIGHT=720\n" ;;
          "$PANEL_XID") printf "X=1920\nY=0\nWIDTH=640\nHEIGHT=720\n" ;;
          *) return 1 ;;
        esac
      }
      source "$ROOT_DIR/deploy/chromium/tikpal-web-mode.sh"
      x11_trace_observed_geometries "$TARGET_XID,$PANEL_XID"
    '
})"
[[ "$shell_geometry" == "$TARGET_XID:2560,0_1920x720;$PANEL_XID:1920,0_640x720" ]] ||
  fail_fixture "Shell-format trace geometry is $shell_geometry"

mkdir -p "$PROFILE_ROOT"
printf '1\n' > "$GENERATION_PATH"
printf '{"owner":"shell","generation":1,"surfaces":[]}\n' > "$OWNER_PATH"
printf '{"activeProvider":"apple_music","openingProvider":"qobuz","residentProviders":{}}\n' > "$STATE_PATH"
{
  printf 'generation\t1\t0\n'
  printf 'provider\t%s\t%s\n' "$PREVIOUS_PROFILE" "$PREVIOUS_XID"
  printf 'panel\t%s\t%s\n' "$PANEL_PROFILE" "$PANEL_XID"
} > "$REGISTRY_PATH"
: > "$TRACE_PATH"
mkfifo "$BARRIER_FIFO"

DISPLAY="$DISPLAY_VALUE" "$HELPER" daemon \
  --socket "$SOCKET_PATH" --display "$DISPLAY_VALUE" \
  --generation-file "$GENERATION_PATH" --phase 1 --transaction-timeout-ms 250 \
  >"$FIXTURE_DIR/helper.log" 2>&1 &
HELPER_PID=$!
for _ in {1..200}; do
  [[ -S "$SOCKET_PATH" ]] && break
  kill -0 "$HELPER_PID" >/dev/null 2>&1 ||
    fail_fixture "Helper exited early: $(tr '\n' ' ' < "$FIXTURE_DIR/helper.log")"
  sleep 0.01
done
[[ -S "$SOCKET_PATH" ]] || fail_fixture "Helper socket did not appear"

env \
  TIKPAL_WEB_MODE_SOURCE_ONLY=1 \
  TIKPAL_KIOSK_SKIP_ENV_SOURCE=1 \
  TIKPAL_KIOSK_DISPLAY="$DISPLAY_VALUE" \
  TIKPAL_WEB_MODE_PROFILE_ROOT="$PROFILE_ROOT" \
  TIKPAL_WEB_MODE_STATE_PATH="$STATE_PATH" \
  TIKPAL_WEB_MODE_X11_HELPER_MODE=disabled \
  TIKPAL_WEB_MODE_X11_HELPER_BINARY="$HELPER" \
  TIKPAL_WEB_MODE_X11_HELPER_SOCKET="$SOCKET_PATH" \
  TIKPAL_WEB_MODE_X11_HELPER_GENERATION_PATH="$GENERATION_PATH" \
  TIKPAL_WEB_MODE_X11_HELPER_OWNER_PATH="$OWNER_PATH" \
  TIKPAL_WEB_MODE_X11_MUTATION_TRACE_PATH="$TRACE_PATH" \
  TIKPAL_WEB_MODE_X11_TRACE_GEOMETRY_COMMAND="$X11_CLIENT" \
  TIKPAL_WEB_MODE_X11_MUTATION_BARRIER_FIFO="$BARRIER_FIFO" \
  TIKPAL_WEB_MODE_X11_MUTATION_BARRIER_READY_PATH="$BARRIER_READY" \
  TIKPAL_WEB_MODE_X11_MUTATION_BARRIER_MATCH=fixture_reverse_geometry \
  TIKPAL_WEB_MODE_X11_WRITER_ROLE=legacy_guard_fixture \
  TIKPAL_WEB_MODE_X11_WRITER_PROVIDER=apple_music \
  ROOT_DIR="$ROOT_DIR" X11_CLIENT="$X11_CLIENT" DISPLAY_VALUE="$DISPLAY_VALUE" \
  TARGET_XID="$TARGET_XID" PREVIOUS_XID="$PREVIOUS_XID" PANEL_XID="$PANEL_XID" \
  bash -c '
    source "$ROOT_DIR/deploy/chromium/tikpal-web-mode.sh"
    x11_helper_guard_may_write "$TARGET_XID" "$PREVIOUS_XID" "$PANEL_XID"
    x11_mutation_run fixture_reverse_geometry "$TARGET_XID,$PREVIOUS_XID" \
      "$TARGET_XID:2560,0_1920x720;$PREVIOUS_XID:0,0_1920x720" \
      "$X11_CLIENT" mutate --display "$DISPLAY_VALUE" --mode reverse \
        --target "$TARGET_XID" --previous "$PREVIOUS_XID"
  ' &
LEGACY_WRITER_PID=$!
wait_for_file "$BARRIER_READY" "legacy writer barrier"

env \
  TIKPAL_WEB_MODE_SOURCE_ONLY=1 \
  TIKPAL_KIOSK_SKIP_ENV_SOURCE=1 \
  TIKPAL_KIOSK_DISPLAY="$DISPLAY_VALUE" \
  TIKPAL_WEB_MODE_PROFILE_ROOT="$PROFILE_ROOT" \
  TIKPAL_WEB_MODE_STATE_PATH="$STATE_PATH" \
  TIKPAL_WEB_MODE_X11_HELPER_MODE=switch \
  TIKPAL_WEB_MODE_X11_HELPER_BINARY="$HELPER" \
  TIKPAL_WEB_MODE_X11_HELPER_SOCKET="$SOCKET_PATH" \
  TIKPAL_WEB_MODE_X11_HELPER_CONNECT_TIMEOUT_MS=100 \
  TIKPAL_WEB_MODE_X11_HELPER_RESPONSE_TIMEOUT_MS=800 \
  TIKPAL_WEB_MODE_X11_HELPER_GENERATION_PATH="$GENERATION_PATH" \
  TIKPAL_WEB_MODE_X11_HELPER_OWNER_PATH="$OWNER_PATH" \
  TIKPAL_WEB_MODE_X11_HELPER_LEASE_MS=350 \
  TIKPAL_WEB_MODE_X11_MUTATION_TRACE_PATH="$TRACE_PATH" \
  TIKPAL_WEB_MODE_X11_TRACE_GEOMETRY_COMMAND="$X11_CLIENT" \
  TIKPAL_WEB_MODE_LOCKED=1 \
  TIKPAL_WEB_MODE_X11_WRITER_ROLE=foreground_shell \
  TIKPAL_WEB_MODE_X11_WRITER_PROVIDER=qobuz \
  ROOT_DIR="$ROOT_DIR" RESPONSE_PATH="$FIXTURE_DIR/helper-response.json" \
  TARGET_XID="$TARGET_XID" PREVIOUS_XID="$PREVIOUS_XID" PANEL_XID="$PANEL_XID" \
  TARGET_PROFILE="$TARGET_PROFILE" PREVIOUS_PROFILE="$PREVIOUS_PROFILE" PANEL_PROFILE="$PANEL_PROFILE" \
  bash -c '
    source "$ROOT_DIR/deploy/chromium/tikpal-web-mode.sh"
    x11_helper_prepare_switch
    x11_helper_begin_switch \
      "$TARGET_XID" "$TARGET_PROFILE" \
      "$PREVIOUS_XID" "$PREVIOUS_PROFILE" \
      "$PANEL_XID" "$PANEL_PROFILE"
    printf "%s\n" "$TIKPAL_X11_HELPER_LAST_RESPONSE" > "$RESPONSE_PATH"
    commit_visible_provider_state qobuz
    write_guard_window_list "$TARGET_PROFILE" "$TARGET_XID" "$PANEL_PROFILE" "$PANEL_XID"
    x11_helper_finish_success
  '

jq -e --argjson target "$TARGET_XID" --argjson previous "$PREVIOUS_XID" \
  '.ok == true and .code == "OK" and
   (.surfaces[] | select(.role == "target") | .xid == $target and .geometry.x == 0) and
   (.surfaces[] | select(.role == "previous") | .xid == $previous and .geometry.x == 2560) and
   (.timings.mutationStartedMonotonicNs > 0) and
   (.timings.fenceCompletedMonotonicNs >= .timings.mutationStartedMonotonicNs) and
   (.timings.finalSnapshotCompletedMonotonicNs >= .timings.fenceCompletedMonotonicNs)' \
  "$FIXTURE_DIR/helper-response.json" >/dev/null || fail_fixture "Helper final snapshot is not the expected geometry"
assert_geometry "$TARGET_XID" "0,0_1920x720" "target after Helper"
assert_geometry "$PREVIOUS_XID" "2560,0_1920x720" "previous after Helper"
jq -e '.owner == "shell" and .generation == 2' "$OWNER_PATH" >/dev/null ||
  fail_fixture "Helper ownership was not safely released"

printf 'continue\n' > "$BARRIER_FIFO"
wait "$LEGACY_WRITER_PID"
LEGACY_WRITER_PID=""
assert_geometry "$TARGET_XID" "2560,0_1920x720" "target after late legacy writer"
assert_geometry "$PREVIOUS_XID" "0,0_1920x720" "previous after late legacy writer"

env \
  TIKPAL_WEB_MODE_SOURCE_ONLY=1 \
  TIKPAL_KIOSK_SKIP_ENV_SOURCE=1 \
  TIKPAL_KIOSK_DISPLAY="$DISPLAY_VALUE" \
  TIKPAL_WEB_MODE_PROFILE_ROOT="$PROFILE_ROOT" \
  TIKPAL_WEB_MODE_STATE_PATH="$STATE_PATH" \
  TIKPAL_WEB_MODE_X11_HELPER_MODE=switch \
  TIKPAL_WEB_MODE_X11_HELPER_BINARY="$HELPER" \
  TIKPAL_WEB_MODE_X11_HELPER_GENERATION_PATH="$GENERATION_PATH" \
  TIKPAL_WEB_MODE_X11_HELPER_OWNER_PATH="$OWNER_PATH" \
  TIKPAL_WEB_MODE_X11_MUTATION_TRACE_PATH="$TRACE_PATH" \
  TIKPAL_WEB_MODE_X11_TRACE_GEOMETRY_COMMAND="$X11_CLIENT" \
  TIKPAL_WEB_MODE_GUARD_LOCKED=1 \
  TIKPAL_WEB_MODE_X11_WRITER_ROLE=current_guard_fixture \
  TIKPAL_WEB_MODE_X11_WRITER_PROVIDER=qobuz \
  ROOT_DIR="$ROOT_DIR" X11_CLIENT="$X11_CLIENT" DISPLAY_VALUE="$DISPLAY_VALUE" \
  TARGET_XID="$TARGET_XID" PREVIOUS_XID="$PREVIOUS_XID" \
  bash -c '
    source "$ROOT_DIR/deploy/chromium/tikpal-web-mode.sh"
    x11_mutation_run fixture_correct_geometry "$TARGET_XID,$PREVIOUS_XID" \
      "$TARGET_XID:0,0_1920x720;$PREVIOUS_XID:2560,0_1920x720" \
      "$X11_CLIENT" mutate --display "$DISPLAY_VALUE" --mode correct \
        --target "$TARGET_XID" --previous "$PREVIOUS_XID"
  '
assert_geometry "$TARGET_XID" "0,0_1920x720" "target after current Guard convergence"
assert_geometry "$PREVIOUS_XID" "2560,0_1920x720" "previous after current Guard convergence"

# Re-run the same barrier with the production lifecycle gate enabled. The
# stale writer must acquire web-mode.lock after the Helper transaction, notice
# that its captured generation is old, and return without issuing X11.
"$X11_CLIENT" mutate --display "$DISPLAY_VALUE" --mode reverse \
  --target "$TARGET_XID" --previous "$PREVIOUS_XID"
printf '{"activeProvider":"apple_music","openingProvider":"qobuz","residentProviders":{}}\n' > "$STATE_PATH"
{
  printf 'generation\t2\t0\n'
  printf 'provider\t%s\t%s\n' "$PREVIOUS_PROFILE" "$PREVIOUS_XID"
  printf 'panel\t%s\t%s\n' "$PANEL_PROFILE" "$PANEL_XID"
} > "$REGISTRY_PATH"
rm -f "$BARRIER_READY"

env \
  TIKPAL_WEB_MODE_SOURCE_ONLY=1 \
  TIKPAL_KIOSK_SKIP_ENV_SOURCE=1 \
  TIKPAL_KIOSK_DISPLAY="$DISPLAY_VALUE" \
  TIKPAL_WEB_MODE_PROFILE_ROOT="$PROFILE_ROOT" \
  TIKPAL_WEB_MODE_STATE_PATH="$STATE_PATH" \
  TIKPAL_WEB_MODE_X11_HELPER_MODE=switch \
  TIKPAL_WEB_MODE_X11_HELPER_BINARY="$HELPER" \
  TIKPAL_WEB_MODE_X11_HELPER_SOCKET="$SOCKET_PATH" \
  TIKPAL_WEB_MODE_X11_HELPER_GENERATION_PATH="$GENERATION_PATH" \
  TIKPAL_WEB_MODE_X11_HELPER_OWNER_PATH="$OWNER_PATH" \
  TIKPAL_WEB_MODE_X11_MUTATION_TRACE_PATH="$TRACE_PATH" \
  TIKPAL_WEB_MODE_X11_TRACE_GEOMETRY_COMMAND="$X11_CLIENT" \
  TIKPAL_WEB_MODE_X11_MUTATION_BARRIER_FIFO="$BARRIER_FIFO" \
  TIKPAL_WEB_MODE_X11_MUTATION_BARRIER_READY_PATH="$BARRIER_READY" \
  TIKPAL_WEB_MODE_X11_MUTATION_BARRIER_MATCH=fixture_reverse_geometry \
  TIKPAL_WEB_MODE_X11_WRITER_ROLE=stale_legacy_writer_fixture \
  TIKPAL_WEB_MODE_X11_WRITER_PROVIDER=apple_music \
  ROOT_DIR="$ROOT_DIR" X11_CLIENT="$X11_CLIENT" DISPLAY_VALUE="$DISPLAY_VALUE" \
  TARGET_XID="$TARGET_XID" PREVIOUS_XID="$PREVIOUS_XID" PANEL_XID="$PANEL_XID" \
  bash -c '
    source "$ROOT_DIR/deploy/chromium/tikpal-web-mode.sh"
    x11_helper_guard_may_write "$TARGET_XID" "$PREVIOUS_XID" "$PANEL_XID"
    x11_mutation_run fixture_reverse_geometry "$TARGET_XID,$PREVIOUS_XID" \
      "$TARGET_XID:2560,0_1920x720;$PREVIOUS_XID:0,0_1920x720" \
      "$X11_CLIENT" mutate --display "$DISPLAY_VALUE" --mode reverse \
        --target "$TARGET_XID" --previous "$PREVIOUS_XID"
  ' &
LEGACY_WRITER_PID=$!
wait_for_file "$BARRIER_READY" "fixed stale-writer barrier"
: > "$CONTROL_GEOMETRY_CALLS"

env \
  TIKPAL_WEB_MODE_SOURCE_ONLY=1 \
  TIKPAL_KIOSK_SKIP_ENV_SOURCE=1 \
  TIKPAL_KIOSK_DISPLAY="$DISPLAY_VALUE" \
  TIKPAL_WEB_MODE_PROFILE_ROOT="$PROFILE_ROOT" \
  TIKPAL_WEB_MODE_STATE_PATH="$STATE_PATH" \
  TIKPAL_WEB_MODE_X11_HELPER_MODE=switch \
  TIKPAL_WEB_MODE_X11_HELPER_BINARY="$HELPER" \
  TIKPAL_WEB_MODE_X11_HELPER_SOCKET="$SOCKET_PATH" \
  TIKPAL_WEB_MODE_X11_HELPER_CONNECT_TIMEOUT_MS=100 \
  TIKPAL_WEB_MODE_X11_HELPER_RESPONSE_TIMEOUT_MS=800 \
  TIKPAL_WEB_MODE_X11_HELPER_GENERATION_PATH="$GENERATION_PATH" \
  TIKPAL_WEB_MODE_X11_HELPER_OWNER_PATH="$OWNER_PATH" \
  TIKPAL_WEB_MODE_X11_HELPER_LEASE_MS=350 \
  TIKPAL_WEB_MODE_X11_MUTATION_TRACE_PATH="$TRACE_PATH" \
  TIKPAL_WEB_MODE_LOCKED=1 \
  TIKPAL_WEB_MODE_X11_WRITER_ROLE=foreground_shell \
  TIKPAL_WEB_MODE_X11_WRITER_PROVIDER=qobuz \
  ROOT_DIR="$ROOT_DIR" RESPONSE_PATH="$FIXTURE_DIR/helper-response-fixed.json" \
  X11_CLIENT="$X11_CLIENT" CONTROL_GEOMETRY_CALLS="$CONTROL_GEOMETRY_CALLS" \
  TARGET_XID="$TARGET_XID" PREVIOUS_XID="$PREVIOUS_XID" PANEL_XID="$PANEL_XID" \
  TARGET_PROFILE="$TARGET_PROFILE" PREVIOUS_PROFILE="$PREVIOUS_PROFILE" PANEL_PROFILE="$PANEL_PROFILE" \
  bash -c '
    source "$ROOT_DIR/deploy/chromium/tikpal-web-mode.sh"
    unexpected_control_geometry() {
      printf "%s\t%s\n" "$1" "$2" >> "$CONTROL_GEOMETRY_CALLS"
      "$X11_CLIENT" "$@"
    }
    TIKPAL_WEB_MODE_X11_TRACE_GEOMETRY_COMMAND=unexpected_control_geometry
    x11_helper_prepare_switch
    x11_helper_begin_switch \
      "$TARGET_XID" "$TARGET_PROFILE" \
      "$PREVIOUS_XID" "$PREVIOUS_PROFILE" \
      "$PANEL_XID" "$PANEL_PROFILE"
    printf "%s\n" "$TIKPAL_X11_HELPER_LAST_RESPONSE" > "$RESPONSE_PATH"
    commit_visible_provider_state qobuz
    write_guard_window_list "$TARGET_PROFILE" "$TARGET_XID" "$PANEL_PROFILE" "$PANEL_XID"
    x11_helper_finish_success
  '

[[ ! -s "$CONTROL_GEOMETRY_CALLS" ]] ||
  fail_fixture "Helper control trace synchronously sampled X11 geometry"

jq -e '.ok == true and .code == "OK" and .generation == 3 and
  (.timings.finalSnapshotCompletedMonotonicNs >= .timings.fenceCompletedMonotonicNs)' \
  "$FIXTURE_DIR/helper-response-fixed.json" >/dev/null ||
  fail_fixture "fixed Helper transaction did not complete at generation 3"
printf 'continue\n' > "$BARRIER_FIFO"
if wait "$LEGACY_WRITER_PID"; then
  fail_fixture "stale generation writer unexpectedly completed after the lifecycle fix"
else
  stale_writer_status=$?
fi
LEGACY_WRITER_PID=""
[[ "$stale_writer_status" == "76" ]] ||
  fail_fixture "stale generation writer returned $stale_writer_status instead of 76"
assert_geometry "$TARGET_XID" "0,0_1920x720" "target after stale writer rejection"
assert_geometry "$PREVIOUS_XID" "2560,0_1920x720" "previous after stale writer rejection"

jq -e --arg target "$TARGET_XID" --arg previous "$PREVIOUS_XID" '
  select(.writer_role == "legacy_guard_fixture" and .operation == "fixture_reverse_geometry") |
  .owner == "shell" and .generation == "1" and .active_provider == "apple_music" and
  .registry_generation == "1" and .lock_acquired == 0 and
  .owner_after == "shell" and .generation_after == "2" and
  .active_provider_after == "qobuz" and .registry_generation_after == "2" and
  (.observed_geometry_after | contains($target + ":2560,0_1920x720")) and
  (.observed_geometry_after | contains($previous + ":0,0_1920x720"))
' "$TRACE_PATH" >/dev/null || fail_fixture "trace did not attribute the stale-generation reverse writer"
jq -e --arg target "$TARGET_XID" --arg previous "$PREVIOUS_XID" '
  select(.writer_role == "current_guard_fixture" and .operation == "fixture_correct_geometry") |
  .generation == "2" and .active_provider == "qobuz" and .registry_generation == "2" and
  .lock_acquired == 1 and
  (.observed_geometry_after | contains($target + ":0,0_1920x720")) and
  (.observed_geometry_after | contains($previous + ":2560,0_1920x720"))
' "$TRACE_PATH" >/dev/null || fail_fixture "trace did not record current-generation Guard convergence"
jq -e --arg target "$TARGET_XID" --arg previous "$PREVIOUS_XID" '
  select(.writer_role == "stale_legacy_writer_fixture" and .operation == "fixture_reverse_geometry") |
  .generation == "2" and .active_provider == "apple_music" and .registry_generation == "2" and
  .lock_acquired == 1 and .command_started == 0 and .exit_status == 76 and
  (.detail | contains("reason=stale_generation")) and
  .generation_after == "3" and .active_provider_after == "qobuz" and
  (.observed_geometry_after | contains($target + ":0,0_1920x720")) and
  (.observed_geometry_after | contains($previous + ":2560,0_1920x720"))
' "$TRACE_PATH" >/dev/null || fail_fixture "fixed trace did not prove the stale writer was blocked before X11"
jq -e --arg xids "$TARGET_XID,$PREVIOUS_XID,$PANEL_XID" 'select(.operation == "helper_switch_finished") |
  .xid == $xids and .observed_geometry_after == "not_sampled_control" and
  (.detail | contains("request_id=")) and
  (.detail | contains("fenceCompletedMonotonicNs")) and
  (.detail | contains("finalSnapshotCompletedMonotonicNs"))' \
  "$TRACE_PATH" >/dev/null || fail_fixture "trace did not retain Helper request/fence/final-snapshot timing"

helper_final_ns="$(jq -r 'select(.operation == "helper_switch_finished") | .monotonic_ns' "$TRACE_PATH" | head -1)"
late_writer_ns="$(jq -r 'select(.writer_role == "legacy_guard_fixture") | .monotonic_ns' "$TRACE_PATH" | tail -1)"
guard_converged_ns="$(jq -r 'select(.operation == "fixture_correct_geometry") | .monotonic_ns' "$TRACE_PATH" | tail -1)"
[[ "$helper_final_ns" =~ ^[0-9]+$ && "$late_writer_ns" =~ ^[0-9]+$ && "$guard_converged_ns" =~ ^[0-9]+$ &&
   "$helper_final_ns" -lt "$late_writer_ns" && "$late_writer_ns" -lt "$guard_converged_ns" ]] ||
  fail_fixture "monotonic timeline does not show Helper -> reverse writer -> Guard convergence"

blocked_writer_ns="$(jq -r 'select(.writer_role == "stale_legacy_writer_fixture") | .monotonic_ns' "$TRACE_PATH" | tail -1)"

window_action() {
  local action="$1" xid="$2"
  shift 2
  "$X11_CLIENT" window --display "$DISPLAY_VALUE" --action "$action" --xid "$xid" "$@"
}

write_guard_registry() {
  local generation="$1"
  {
    printf 'generation\t%s\t0\n' "$generation"
    printf 'provider\t%s\t%s\n' "$TARGET_PROFILE" "$TARGET_XID"
    printf 'panel\t%s\t%s\n' "$PANEL_PROFILE" "$PANEL_XID"
    printf 'kiosk\t%s\t%s\n' "$KIOSK_PROFILE" "$KIOSK_XID"
  } > "$REGISTRY_PATH"
}

arrange_guard_steady_state() {
  window_action map "$TARGET_XID"
  window_action map "$PANEL_XID"
  window_action map "$KIOSK_XID"
  window_action geometry "$TARGET_XID" --x 0 --y 0 --width 1920 --height 720
  window_action geometry "$PANEL_XID" --x 1920 --y 0 --width 640 --height 720
  window_action opacity "$TARGET_XID" --opacity 4294967295
  window_action opacity "$PANEL_XID" --opacity 4294967295
  window_action raise "$KIOSK_XID"
  window_action raise "$TARGET_XID"
  window_action raise "$PANEL_XID"
}

guard_fixture_tick() {
  local process_generation="${1:-}"
  env \
    TIKPAL_WEB_MODE_SOURCE_ONLY=1 \
    TIKPAL_KIOSK_SKIP_ENV_SOURCE=1 \
    TIKPAL_KIOSK_DISPLAY="$DISPLAY_VALUE" \
    TIKPAL_CHROMIUM_PROFILE_DIR="$KIOSK_PROFILE" \
    TIKPAL_WEB_MODE_PROFILE_ROOT="$PROFILE_ROOT" \
    TIKPAL_WEB_MODE_STATE_PATH="$STATE_PATH" \
    TIKPAL_WEB_MODE_X11_HELPER_MODE=switch \
    TIKPAL_WEB_MODE_X11_HELPER_BINARY="$HELPER" \
    TIKPAL_WEB_MODE_X11_HELPER_SOCKET="$SOCKET_PATH" \
    TIKPAL_WEB_MODE_X11_HELPER_CONNECT_TIMEOUT_MS=100 \
    TIKPAL_WEB_MODE_X11_HELPER_RESPONSE_TIMEOUT_MS=800 \
    TIKPAL_WEB_MODE_X11_HELPER_GENERATION_PATH="$GENERATION_PATH" \
    TIKPAL_WEB_MODE_X11_HELPER_OWNER_PATH="$OWNER_PATH" \
    TIKPAL_WEB_MODE_X11_PROCESS_GENERATION="$process_generation" \
    TIKPAL_WEB_MODE_X11_MUTATION_TRACE_PATH="$TRACE_PATH" \
    TIKPAL_WEB_MODE_X11_TRACE_GEOMETRY_COMMAND="$X11_CLIENT" \
    TIKPAL_WEB_MODE_X11_WRITER_ROLE=guard_fixture \
    TIKPAL_WEB_MODE_X11_WRITER_PROVIDER=qobuz \
    ROOT_DIR="$ROOT_DIR" X11_CLIENT="$X11_CLIENT" DISPLAY_VALUE="$DISPLAY_VALUE" \
    TARGET_XID="$TARGET_XID" PANEL_XID="$PANEL_XID" KIOSK_XID="$KIOSK_XID" \
    TARGET_PID="${SURFACE_PIDS[0]}" PANEL_PID="${SURFACE_PIDS[2]}" KIOSK_PID="${SURFACE_PIDS[3]}" \
    TARGET_PROFILE="$TARGET_PROFILE" PANEL_PROFILE="$PANEL_PROFILE" KIOSK_PROFILE="$KIOSK_PROFILE" \
    bash -c '
      source "$ROOT_DIR/deploy/chromium/tikpal-web-mode.sh"
      guard_root_stack_order() {
        DISPLAY="$DISPLAY_VALUE" "$X11_CLIENT" stack "$@"
      }
      process_tree_uses_profile() {
        [[ ( "$1" == "$TARGET_PID" && "$2" == "$TARGET_PROFILE" ) ||
           ( "$1" == "$PANEL_PID" && "$2" == "$PANEL_PROFILE" ) ||
           ( "$1" == "$KIOSK_PID" && "$2" == "$KIOSK_PROFILE" ) ]]
      }
      tile_window_fast() {
        local xid="$1" position="$2" size="$3" x y width height
        x="${position%,*}"
        y="${position#*,}"
        size="$(normalize_window_size "$size")"
        width="${size%,*}"
        height="${size#*,}"
        x11_mutation_run guard_fixture_geometry "$xid" "$x,${y}_${width}x${height}" \
          "$X11_CLIENT" window --display "$DISPLAY_VALUE" --action geometry --xid "$xid" \
            --x "$x" --y "$y" --width "$width" --height "$height"
      }
      restore_window_opacity() {
        local xid="$1"
        x11_mutation_run guard_fixture_opacity "$xid" full \
          "$X11_CLIENT" window --display "$DISPLAY_VALUE" --action opacity --xid "$xid" \
            --opacity 4294967295
      }
      raise_window_without_focus() {
        local xid="$1"
        x11_mutation_run guard_fixture_raise "$xid" above \
          "$X11_CLIENT" window --display "$DISPLAY_VALUE" --action raise --xid "$xid"
      }
      xdotool_safe() {
        local operation="$1" xid="$2" action
        case "$operation" in
          windowmap) action=map ;;
          windowlower) action=lower ;;
          *) return 64 ;;
        esac
        x11_mutation_run "guard_fixture_$action" "$xid" "$action" \
          "$X11_CLIENT" window --display "$DISPLAY_VALUE" --action "$action" --xid "$xid"
      }
      guard_run_tick "$TARGET_PROFILE" "$PANEL_PROFILE"
    '
}

assert_last_guard_tick() {
  local expected_repair="$1" expected_mutations="$2" expected_outcome="$3" detail
  detail="$(jq -r 'select(.operation == "guard_tick_completed") | .detail' "$TRACE_PATH" | tail -1)"
  [[ "$detail" == *"repair_required=$expected_repair"* &&
     "$detail" == *"mutation_count=$expected_mutations"* &&
     "$detail" == *"outcome=$expected_outcome"* ]] || {
    printf 'late-writer Guard diagnostic (Helper log tail):\n' >&2
    tail -20 "$FIXTURE_DIR/helper.log" >&2 2>/dev/null || true
    printf 'late-writer Guard diagnostic (trace tail):\n' >&2
    tail -20 "$TRACE_PATH" >&2 2>/dev/null || true
    fail_fixture "guard tick detail is $detail"
  }
}

assert_guard_mutations() {
  local expected_count="$1" expected_xid="${2:-}" expected_operation="${3:-}"
  local actual_count
  actual_count="$(jq -s '[.[] | select(.writer_role == "guard_fixture" and (.operation | startswith("guard_fixture_")))] | length' "$TRACE_PATH")"
  [[ "$actual_count" == "$expected_count" ]] ||
    fail_fixture "guard wrote $actual_count mutations, expected $expected_count"
  if [[ -n "$expected_xid" ]]; then
    jq -e --arg xid "$expected_xid" --arg operation "$expected_operation" '
      select(.writer_role == "guard_fixture" and .xid == $xid and .operation == $operation)
    ' "$TRACE_PATH" >/dev/null ||
      fail_fixture "guard did not record $expected_operation for $expected_xid"
  fi
}

assert_surface_full_opacity() {
  local xid="$1" profile="$2" role="$3" response
  response="$(
    TIKPAL_WEB_MODE_X11_HELPER_SOCKET="$SOCKET_PATH" \
    TIKPAL_WEB_MODE_X11_HELPER_CONNECT_TIMEOUT_MS=100 \
    TIKPAL_WEB_MODE_X11_HELPER_RESPONSE_TIMEOUT_MS=800 \
      "$HELPER" client inspect --request-id "opacity-$RANDOM-$(date +%s%N)" \
        --generation "$(<"$GENERATION_PATH")" --surface "$role" "$xid" "$profile"
  )"
  jq -e '.ok == true and .surfaces[0].opacity.full == true' <<< "$response" >/dev/null ||
    fail_fixture "$role opacity was not restored"
}

# The real Guard path now runs an inspect -> plan -> apply tick. The fixture
# replaces only the unavailable local xdotool/xwininfo commands with the same
# XCB client used above; Helper inspect, ownership, generation and tracing stay
# production-real.
GUARD_GENERATION="$(<"$GENERATION_PATH")"
printf '{"owner":"shell","generation":%s,"surfaces":[]}\n' "$GUARD_GENERATION" > "$OWNER_PATH"
write_guard_registry "$GUARD_GENERATION"
arrange_guard_steady_state
: > "$TRACE_PATH"
guard_fixture_tick
assert_last_guard_tick false 0 steady
assert_guard_mutations 0
guard_fixture_tick
assert_last_guard_tick false 0 steady
assert_guard_mutations 0

window_action geometry "$TARGET_XID" --x 120 --y 0 --width 1920 --height 720
: > "$TRACE_PATH"
guard_fixture_tick
assert_last_guard_tick true 1 repaired
assert_guard_mutations 1 "$TARGET_XID" guard_fixture_geometry
assert_geometry "$TARGET_XID" "0,0_1920x720" "provider after Guard repair"
: > "$TRACE_PATH"
guard_fixture_tick
assert_last_guard_tick false 0 steady

window_action geometry "$PANEL_XID" --x 1800 --y 0 --width 640 --height 720
window_action opacity "$PANEL_XID" --opacity 2147483647
: > "$TRACE_PATH"
guard_fixture_tick
assert_last_guard_tick true 2 repaired
assert_guard_mutations 2
assert_geometry "$PANEL_XID" "1920,0_640x720" "panel after Guard repair"
assert_surface_full_opacity "$PANEL_XID" "$PANEL_PROFILE" panel
: > "$TRACE_PATH"
guard_fixture_tick
assert_last_guard_tick false 0 steady

arrange_guard_steady_state
window_action raise "$KIOSK_XID"
: > "$TRACE_PATH"
guard_fixture_tick
assert_last_guard_tick true 1 repaired
assert_guard_mutations 1 "$KIOSK_XID" guard_fixture_lower
: > "$TRACE_PATH"
guard_fixture_tick
assert_last_guard_tick false 0 steady

arrange_guard_steady_state
window_action raise "$TARGET_XID"
: > "$TRACE_PATH"
guard_fixture_tick
assert_last_guard_tick true 1 repaired
assert_guard_mutations 1 "$PANEL_XID" guard_fixture_raise
: > "$TRACE_PATH"
guard_fixture_tick
assert_last_guard_tick false 0 steady

arrange_guard_steady_state
window_action unmap "$PANEL_XID"
: > "$TRACE_PATH"
guard_fixture_tick
assert_last_guard_tick true 1 repaired
assert_guard_mutations 1 "$PANEL_XID" guard_fixture_map
: > "$TRACE_PATH"
guard_fixture_tick
assert_last_guard_tick false 0 steady

# Keep a real Helper lease active after its transaction response. Even with a
# deliberately wrong provider geometry, the Guard must stop at owner-allows.
LEASE_FIFO="$FIXTURE_DIR/guard-lease.fifo"
LEASE_READY="$FIXTURE_DIR/guard-lease.ready"
mkfifo "$LEASE_FIFO"
env \
  TIKPAL_WEB_MODE_SOURCE_ONLY=1 \
  TIKPAL_KIOSK_SKIP_ENV_SOURCE=1 \
  TIKPAL_KIOSK_DISPLAY="$DISPLAY_VALUE" \
  TIKPAL_CHROMIUM_PROFILE_DIR="$KIOSK_PROFILE" \
  TIKPAL_WEB_MODE_PROFILE_ROOT="$PROFILE_ROOT" \
  TIKPAL_WEB_MODE_STATE_PATH="$STATE_PATH" \
  TIKPAL_WEB_MODE_X11_HELPER_MODE=switch \
  TIKPAL_WEB_MODE_X11_HELPER_BINARY="$HELPER" \
  TIKPAL_WEB_MODE_X11_HELPER_SOCKET="$SOCKET_PATH" \
  TIKPAL_WEB_MODE_X11_HELPER_CONNECT_TIMEOUT_MS=100 \
  TIKPAL_WEB_MODE_X11_HELPER_RESPONSE_TIMEOUT_MS=800 \
  TIKPAL_WEB_MODE_X11_HELPER_GENERATION_PATH="$GENERATION_PATH" \
  TIKPAL_WEB_MODE_X11_HELPER_OWNER_PATH="$OWNER_PATH" \
  TIKPAL_WEB_MODE_X11_HELPER_LEASE_MS=350 \
  TIKPAL_WEB_MODE_X11_MUTATION_TRACE_PATH="$TRACE_PATH" \
  TIKPAL_WEB_MODE_LOCKED=1 \
  ROOT_DIR="$ROOT_DIR" LEASE_READY="$LEASE_READY" LEASE_FIFO="$LEASE_FIFO" \
  TARGET_XID="$TARGET_XID" PREVIOUS_XID="$PREVIOUS_XID" PANEL_XID="$PANEL_XID" \
  TARGET_PROFILE="$TARGET_PROFILE" PREVIOUS_PROFILE="$PREVIOUS_PROFILE" PANEL_PROFILE="$PANEL_PROFILE" \
  bash -c '
    source "$ROOT_DIR/deploy/chromium/tikpal-web-mode.sh"
    x11_helper_prepare_switch
    x11_helper_begin_switch \
      "$TARGET_XID" "$TARGET_PROFILE" \
      "$PREVIOUS_XID" "$PREVIOUS_PROFILE" \
      "$PANEL_XID" "$PANEL_PROFILE"
    printf "%s\n" "$TIKPAL_X11_HELPER_GENERATION" > "$LEASE_READY"
    IFS= read -r _ < "$LEASE_FIFO"
    x11_helper_finish_success
  ' &
LEASE_WRITER_PID=$!
wait_for_file "$LEASE_READY" "Guard lease fixture"
GUARD_GENERATION="$(<"$LEASE_READY")"
write_guard_registry "$GUARD_GENERATION"
window_action geometry "$TARGET_XID" --x 140 --y 0 --width 1920 --height 720
: > "$TRACE_PATH"
guard_fixture_tick
assert_last_guard_tick false 0 helper_owned
assert_guard_mutations 0
assert_geometry "$TARGET_XID" "140,0_1920x720" "provider while Helper owns lease"
printf 'continue\n' > "$LEASE_FIFO"
wait "$LEASE_WRITER_PID"
LEASE_WRITER_PID=""

# A changed generation is a refresh-only tick even when repair is needed.
# The following tick may repair; the tick after that must be steady again.
GUARD_GENERATION="$(<"$GENERATION_PATH")"
write_guard_registry "$GUARD_GENERATION"
arrange_guard_steady_state
window_action geometry "$TARGET_XID" --x 160 --y 0 --width 1920 --height 720
: > "$TRACE_PATH"
guard_fixture_tick "$((GUARD_GENERATION - 1))"
assert_last_guard_tick false 0 generation_refreshed
assert_guard_mutations 0
assert_geometry "$TARGET_XID" "160,0_1920x720" "provider on generation refresh tick"
: > "$TRACE_PATH"
guard_fixture_tick
assert_last_guard_tick true 1 repaired
assert_geometry "$TARGET_XID" "0,0_1920x720" "provider after refreshed Guard repair"
: > "$TRACE_PATH"
guard_fixture_tick
assert_last_guard_tick false 0 steady

printf 'tikpal X11 late-writer fixture passed: reproduced=%s blocked=%s guard_converged=%s\n' \
  "$late_writer_ns" "$blocked_writer_ns" "$guard_converged_ns"

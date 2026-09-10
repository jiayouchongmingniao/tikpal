#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIXTURE="$(mktemp -d /tmp/tikpal-panel-x11.XXXXXX)"
pids=()
cleanup() { for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; done; rm -rf "$FIXTURE"; }
trap cleanup EXIT
for tool in cc pkg-config Xvfb jq node; do command -v "$tool" >/dev/null || { echo "$tool required"; exit 1; }; done
cc -std=c11 -Wall -Wextra -Werror $(pkg-config --cflags xcb) "$ROOT/scripts/fixtures/tikpal-x11-late-writer-client.c" -o "$FIXTURE/client" $(pkg-config --libs xcb)
cc -std=c11 -Wall -Wextra -Werror -DTIKPAL_X11_HELPER_LOCAL_FIXTURE $(pkg-config --cflags xcb json-c) "$ROOT/deploy/chromium/tikpal-x11-helper.c" -o "$FIXTURE/helper" $(pkg-config --libs xcb json-c)
for number in {151..180}; do [[ -S "/tmp/.X11-unix/X$number" ]] || break; done
export DISPLAY=":$number"
Xvfb "$DISPLAY" -screen 0 2560x720x24 >"$FIXTURE/xvfb.log" 2>&1 & pids+=("$!")
for i in {1..100}; do [[ -S "/tmp/.X11-unix/X$number" ]] && break; sleep 0.02; done
export FIXTURE PANEL_CLIENT="$FIXTURE/client"
mkdir -p "$FIXTURE/profiles/providers/spotify" "$FIXTURE/profiles/providers/qobuz" "$FIXTURE/profiles/side-panel" "$FIXTURE/profiles/kiosk"
for name in provider previous panel kiosk; do
 case "$name" in
  provider) profile="$FIXTURE/profiles/providers/spotify"; x=0; width=1920 ;;
  previous) profile="$FIXTURE/profiles/providers/qobuz"; x=2560; width=1920 ;;
  panel) profile="$FIXTURE/profiles/side-panel"; x=1920; width=640 ;;
  kiosk) profile="$FIXTURE/profiles/kiosk"; x=0; width=2560 ;;
 esac
 "$PANEL_CLIENT" surface --display "$DISPLAY" --output "$FIXTURE/$name.xid" --user-data-dir="$profile" --x "$x" --y 0 --width "$width" --height 720 & pids+=("$!")
done
for i in {1..100}; do [[ -s "$FIXTURE/kiosk.xid" && -s "$FIXTURE/provider.xid" && -s "$FIXTURE/previous.xid" && -s "$FIXTURE/panel.xid" ]] && break; sleep 0.02; done
export PANEL_PROVIDER_XID="$(cat "$FIXTURE/provider.xid")" PANEL_WINDOW_XID="$(cat "$FIXTURE/panel.xid")" PANEL_KIOSK_XID="$(cat "$FIXTURE/kiosk.xid")"
previous="$(cat "$FIXTURE/previous.xid")"
# Adapters use independent XCB queries, rather than mocked geometry. The local
# macOS fixture has Xvfb/libxcb but no xdotool/xprop/xwininfo executables.
cat > "$FIXTURE/xprop" <<'ADAPTER'
#!/usr/bin/env bash
set -e
value="$($PANEL_CLIENT opacity "$2")"
printf '_NET_WM_WINDOW_OPACITY(CARDINAL) = %s\n' "$value"
ADAPTER
cat > "$FIXTURE/xwininfo" <<'ADAPTER'
#!/usr/bin/env bash
set -e
read -r a b c <<< "$($PANEL_CLIENT stack "$PANEL_PROVIDER_XID" "$PANEL_WINDOW_XID" "$PANEL_KIOSK_XID")"
{ printf '%s %s\n' "$a" "$PANEL_PROVIDER_XID"; printf '%s %s\n' "$b" "$PANEL_WINDOW_XID"; printf '%s %s\n' "$c" "$PANEL_KIOSK_XID"; } | sort -n | while read -r rank xid; do printf '  0x%x fixture\n' "$xid"; done
ADAPTER
chmod +x "$FIXTURE/xprop" "$FIXTURE/xwininfo"
if ! command -v flock >/dev/null; then cp "$ROOT/scripts/fixtures/flock.py" "$FIXTURE/flock"; chmod +x "$FIXTURE/flock"; fi
if ! command -v timeout >/dev/null; then
  cat > "$FIXTURE/timeout" <<'ADAPTER'
#!/usr/bin/env python3
import subprocess, sys
try:
    sys.exit(subprocess.run(sys.argv[2:], timeout=float(sys.argv[1])).returncode)
except subprocess.TimeoutExpired:
    sys.exit(124)
ADAPTER
  chmod +x "$FIXTURE/timeout"
fi
export PATH="$FIXTURE:$PATH"
export TIKPAL_WEB_MODE_SOURCE_ONLY=1 TIKPAL_KIOSK_SKIP_ENV_SOURCE=1 TIKPAL_KIOSK_DISPLAY="$DISPLAY"
export TIKPAL_WEB_MODE_PROFILE_ROOT="$FIXTURE/profiles" TIKPAL_CHROMIUM_PROFILE_DIR="$FIXTURE/profiles/kiosk"
export TIKPAL_WEB_MODE_STATE_PATH="$FIXTURE/state.json" TIKPAL_KIOSK_X_SESSION_GENERATION_PATH="$FIXTURE/xsession"
export TIKPAL_WEB_MODE_X11_HELPER_BINARY="$FIXTURE/helper" TIKPAL_WEB_MODE_X11_HELPER_SOCKET="$FIXTURE/helper.sock"
export TIKPAL_WEB_MODE_X11_HELPER_MODE=watch TIKPAL_WEB_MODE_LOCKED=1
printf 'x1\n' > "$FIXTURE/xsession"
printf '1\n' > "$FIXTURE/profiles/x11-helper-generation"
printf '{"activeProvider":"spotify","lastOpenedRequestId":"s1","lastOpenedXSessionGeneration":"x1","panelLayoutSupported":true}\n' > "$FIXTURE/state.json"
source "$ROOT/deploy/chromium/tikpal-web-mode.sh"
"$FIXTURE/helper" daemon --socket "$TIKPAL_WEB_MODE_X11_HELPER_SOCKET" --display "$DISPLAY" --generation-file "$TIKPAL_WEB_MODE_X11_HELPER_GENERATION_PATH" --phase 3 >"$FIXTURE/helper.log" 2>&1 & pids+=("$!")
for i in {1..100}; do [[ -S "$TIKPAL_WEB_MODE_X11_HELPER_SOCKET" ]] && break; sleep 0.02; done
health="$($FIXTURE/helper client health)"
instance="$(jq -r .daemonInstanceId <<< "$health")"; epoch="$(jq -r .connectionEpoch <<< "$health")"
request="$(jq -cn --arg instance "$instance" --argjson epoch "$epoch" --argjson xid "$PANEL_PROVIDER_XID" '{version:1,requestId:"panel-watch",operation:"watch",daemonInstanceId:$instance,connectionEpoch:$epoch,generation:1,leaseId:"panel-lease",leaseDurationMs:3000,surfaces:[{role:"provider",xid:$xid}]}')"
printf '%s' "$request" | "$FIXTURE/helper" client request | jq -e '.watchValid' >/dev/null
TIKPAL_X11_HELPER_DAEMON_INSTANCE_ID="$instance"; TIKPAL_X11_HELPER_CONNECTION_EPOCH="$epoch"; TIKPAL_X11_HELPER_LEASE_ID=panel-lease
x11_helper_publish_owner helper 1 "$PANEL_PROVIDER_XID" "$previous" "$PANEL_WINDOW_XID"
printf 'kiosk\t%s\t%s\n' "$TIKPAL_CHROMIUM_PROFILE_DIR" "$PANEL_KIOSK_XID" > "$TIKPAL_WEB_MODE_GUARD_WINDOW_LIST_PATH"
write_guard_window_list "$FIXTURE/profiles/providers/spotify" "$PANEL_PROVIDER_XID" "$FIXTURE/profiles/side-panel" "$PANEL_WINDOW_XID"
validate_profile_window_fast() { local pid; pid="$($PANEL_CLIENT pid "$1")" || return 1; ps -p "$pid" -o args= | grep -F -- "--user-data-dir=$2" >/dev/null; }
window_geometry_compact() { "$PANEL_CLIENT" geometry "$1"; }
initial_entry_window_map_state() { "$PANEL_CLIENT" map-state "$1"; }
initial_entry_set_geometry() {
 local xid="$1" pos="$2" size="$3"
 if [[ -f "$FIXTURE/fail-once" && "$xid" == "$PANEL_WINDOW_XID" ]]; then rm "$FIXTURE/fail-once"; return 1; fi
 x11_mutation_run panel_geometry "$xid" "${pos}_${size}" "$PANEL_CLIENT" window --display "$DISPLAY" --action geometry --xid "$xid" --x "${pos%,*}" --y "${pos#*,}" --width "${size%x*}" --height "${size#*x}"
}
initial_entry_raise_window() { x11_mutation_run panel_raise "$1" '' "$PANEL_CLIENT" window --display "$DISPLAY" --action raise --xid "$1"; }
panel_detect_support() { return 0; }
export TIKPAL_PANEL_EXPECTED_PROVIDER=spotify TIKPAL_PANEL_EXPECTED_SESSION=s1 TIKPAL_PANEL_EXPECTED_GENERATION=x1
set_panel_mode collapsed
[[ "$($PANEL_CLIENT geometry "$PANEL_PROVIDER_XID")" == '0,0_2504x720' ]]
[[ "$($PANEL_CLIENT geometry "$PANEL_WINDOW_XID")" == '2504,0_640x720' ]]
"$FIXTURE/helper" client health | jq -e '.watchValid == false and .leaseReleased == true' >/dev/null
# Long-lived Guard must adopt the runtime mode, not its original geometry.
panel_use_geometry expanded
panel_refresh_layout
[[ "$TIKPAL_WEB_MODE_LEFT_WINDOW" == 2504x720 ]]
for i in 1 2 3; do
  guard_run_tick "$FIXTURE/profiles/providers/spotify" "$FIXTURE/profiles/side-panel"
  [[ "$($PANEL_CLIENT geometry "$PANEL_PROVIDER_XID")" == '0,0_2504x720' ]]
done
TIKPAL_PANEL_PROCESS_MODE=expanded
if x11_mutation_run stale_panel_geometry "$PANEL_PROVIDER_XID" old true; then echo 'stale writer accepted'; exit 1; fi
panel_refresh_layout
set_panel_mode collapsed
set_panel_mode expanded
[[ "$($PANEL_CLIENT geometry "$PANEL_PROVIDER_XID")" == '0,0_1920x720' ]]
touch "$FIXTURE/fail-once"
if set_panel_mode collapsed; then echo 'partial failure accepted'; exit 1; fi
[[ "$(jq -r .panelMode "$FIXTURE/state.json")" == expanded ]]
[[ "$($PANEL_CLIENT geometry "$PANEL_PROVIDER_XID")" == '0,0_1920x720' ]]
# Simulate a failed atomic state writer after geometry has already changed.
panel_state_operation() {
  if [[ "$1" == commit && -e "$FIXTURE/fail-write" ]]; then return 1; fi
  node "$TIKPAL_PANEL_MODULE" "$1" "$TIKPAL_WEB_MODE_STATE_PATH" "$TIKPAL_KIOSK_X_SESSION_GENERATION_PATH" "${@:2}"
}
touch "$FIXTURE/fail-write"
if set_panel_mode collapsed; then echo 'failed state write accepted'; exit 1; fi
[[ "$(jq -r .panelMode "$FIXTURE/state.json")" == expanded ]]
[[ "$($PANEL_CLIENT geometry "$PANEL_PROVIDER_XID")" == '0,0_1920x720' ]]
rm "$FIXTURE/fail-write"
# Reject a stale session before any window mutation.
TIKPAL_PANEL_EXPECTED_SESSION=old
if set_panel_mode collapsed; then echo 'stale session accepted'; exit 1; fi
TIKPAL_PANEL_EXPECTED_SESSION=s1
# Real destroyed XID must not be treated as a live provider.
kill "${pids[1]}"; wait "${pids[1]}" 2>/dev/null || true
first_window_for_profile() { return 1; }
if set_panel_mode collapsed; then echo 'destroyed provider accepted'; exit 1; fi
printf '%s\n' '[explore-panel-x11-fixture] real geometry, watch revoke, stale writer, rollback, destroyed window passed'

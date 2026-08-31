#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WEB_MODE_SCRIPT="${TIKPAL_WEB_MODE_FIXTURE_SCRIPT:-$ROOT_DIR/deploy/chromium/tikpal-web-mode.sh}"
FIXTURE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/tikpal-initial-entry.XXXXXX")"
X11_CLIENT="$FIXTURE_DIR/tikpal-x11-fixture-client"
PROFILE_ROOT="$FIXTURE_DIR/web-mode"
TARGET_PROFILE="$PROFILE_ROOT/providers/spotify"
PANEL_PROFILE="$PROFILE_ROOT/side-panel"
KIOSK_PROFILE="$PROFILE_ROOT/kiosk"
STATE_PATH="$FIXTURE_DIR/web-mode-state.json"
STAMP_PATH="$FIXTURE_DIR/last-physical-reveal.tsv"
TRACE_PATH="$FIXTURE_DIR/initial-entry.jsonl"
LOCK_PATH="$PROFILE_ROOT/web-mode.lock"
POOL_WARM_STAMP="$FIXTURE_DIR/pool-warm.stamp"
XSERVER_PID=""
TARGET_PID=""
PANEL_PID=""
KIOSK_PID=""

cleanup() {
  local pid
  for pid in "$TARGET_PID" "$PANEL_PID" "$KIOSK_PID" "$XSERVER_PID"; do
    [[ -z "$pid" ]] || kill "$pid" >/dev/null 2>&1 || true
  done
  for pid in "$TARGET_PID" "$PANEL_PID" "$KIOSK_PID" "$XSERVER_PID"; do
    [[ -z "$pid" ]] || wait "$pid" 2>/dev/null || true
  done
  case "$FIXTURE_DIR" in
    "${TMPDIR:-/tmp}"/tikpal-initial-entry.*) rm -rf -- "$FIXTURE_DIR" ;;
  esac
}
trap cleanup EXIT

fail_fixture() {
  printf 'tikpal initial-entry fixture failed: %s\n' "$*" >&2
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

cache_path() {
  local profile="$1" key
  key="$(printf '%s' "$profile" | cksum | awk '{print $1 "-" $2}')"
  printf '%s/window-%s.id\n' "$PROFILE_ROOT" "$key"
}

window_action() {
  local action="$1" xid="$2"
  shift 2
  "$X11_CLIENT" window --display "$DISPLAY_VALUE" --action "$action" --xid "$xid" "$@"
}

geometry_of() {
  DISPLAY="$DISPLAY_VALUE" "$X11_CLIENT" geometry "$1"
}

assert_geometry() {
  local xid="$1" expected="$2" label="$3" actual
  actual="$(geometry_of "$xid" || true)"
  [[ "$actual" == "$expected" ]] ||
    fail_fixture "$label geometry is ${actual:-unreadable}, expected $expected"
}

for tool in cc pkg-config jq Xvfb; do
  command -v "$tool" >/dev/null 2>&1 || fail_fixture "$tool is required"
done
if ! command -v flock >/dev/null 2>&1; then
  command -v python3 >/dev/null 2>&1 || fail_fixture "python3 is required for the local flock fixture"
  cp "$ROOT_DIR/scripts/fixtures/flock.py" "$FIXTURE_DIR/flock"
  chmod +x "$FIXTURE_DIR/flock"
  export PATH="$FIXTURE_DIR:$PATH"
fi
pkg-config --exists xcb || fail_fixture "xcb development files are required"
cc -std=c11 -Wall -Wextra -Werror \
  $(pkg-config --cflags xcb) \
  "$ROOT_DIR/scripts/fixtures/tikpal-x11-late-writer-client.c" \
  -o "$X11_CLIENT" \
  $(pkg-config --libs xcb)

DISPLAY_NUMBER=""
for candidate in {131..150}; do
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

mkdir -p "$TARGET_PROFILE" "$PANEL_PROFILE" "$KIOSK_PROFILE"
"$X11_CLIENT" surface --display "$DISPLAY_VALUE" --output "$FIXTURE_DIR/target.xid" \
  --user-data-dir="$TARGET_PROFILE" --x 2560 --y 0 --width 1920 --height 720 &
TARGET_PID=$!
"$X11_CLIENT" surface --display "$DISPLAY_VALUE" --output "$FIXTURE_DIR/panel.xid" \
  --user-data-dir="$PANEL_PROFILE" --x 2560 --y 0 --width 640 --height 720 &
PANEL_PID=$!
"$X11_CLIENT" surface --display "$DISPLAY_VALUE" --output "$FIXTURE_DIR/kiosk.xid" \
  --user-data-dir="$KIOSK_PROFILE" --x 0 --y 0 --width 2560 --height 720 &
KIOSK_PID=$!
wait_for_file "$FIXTURE_DIR/target.xid" "target surface"
wait_for_file "$FIXTURE_DIR/panel.xid" "panel surface"
wait_for_file "$FIXTURE_DIR/kiosk.xid" "kiosk surface"
TARGET_XID="$(<"$FIXTURE_DIR/target.xid")"
PANEL_XID="$(<"$FIXTURE_DIR/panel.xid")"
KIOSK_XID="$(<"$FIXTURE_DIR/kiosk.xid")"

write_caches() {
  printf '%s\n' "$TARGET_XID" > "$(cache_path "$TARGET_PROFILE")"
  printf '%s\n' "$PANEL_XID" > "$(cache_path "$PANEL_PROFILE")"
  printf '%s\n' "$KIOSK_XID" > "$(cache_path "$KIOSK_PROFILE")"
}

reset_scenario() {
  local trace_path="$1"
  window_action map "$TARGET_XID"
  window_action map "$PANEL_XID"
  window_action map "$KIOSK_XID"
  window_action geometry "$TARGET_XID" --x 2560 --y 0 --width 1920 --height 720
  window_action geometry "$PANEL_XID" --x 2560 --y 0 --width 640 --height 720
  window_action geometry "$KIOSK_XID" --x 0 --y 0 --width 2560 --height 720
  window_action opacity "$TARGET_XID" --opacity 0
  window_action opacity "$PANEL_XID" --opacity 0
  window_action raise "$KIOSK_XID"
  printf '{"activeProvider":null,"openingProvider":"spotify","openRequestId":"fixture-request"}\n' > "$STATE_PATH"
  rm -f "$STAMP_PATH" "$PROFILE_ROOT/guard-windows.tsv" \
    "$PROFILE_ROOT/window-guard.pid" "$PROFILE_ROOT/window-guard.pid.starttime" \
    "$trace_path" "$trace_path.lost" "$POOL_WARM_STAMP"
  : > "$trace_path"
  write_caches
}

run_plan() {
  local scenario="$1" target_xid="$2" trace_path="$3" request_id="$4" output_path="$5"
  set +e
  flock -x "$LOCK_PATH" env \
    TIKPAL_WEB_MODE_SOURCE_ONLY=1 \
    TIKPAL_KIOSK_SKIP_ENV_SOURCE=1 \
    TIKPAL_KIOSK_DISPLAY="$DISPLAY_VALUE" \
    TIKPAL_CHROMIUM_PROFILE_DIR="$KIOSK_PROFILE" \
    TIKPAL_WEB_MODE_PROFILE_ROOT="$PROFILE_ROOT" \
    TIKPAL_WEB_MODE_STATE_PATH="$STATE_PATH" \
    TIKPAL_WEB_MODE_PHYSICAL_REVEAL_STAMP_PATH="$STAMP_PATH" \
    TIKPAL_WEB_MODE_INITIAL_ENTRY_TRACE_PATH="$trace_path" \
    TIKPAL_WEB_MODE_OPEN_REQUEST_ID="$request_id" \
    TIKPAL_WEB_MODE_OPEN_X_SESSION_GENERATION=fixture-session \
    TIKPAL_WEB_MODE_X11_HELPER_MODE=disabled \
    TIKPAL_WEB_MODE_ENTRY_REVEAL_SETTLE_SECONDS=0 \
    TIKPAL_WEB_MODE_RESIDENT_ENTRY_SETTLE_SECONDS=0 \
    TIKPAL_WEB_MODE_RESIDENT_ENTRY_PAINT_SETTLE_SECONDS=0 \
    TIKPAL_WEB_MODE_LOCKED=1 \
    WEB_MODE_SCRIPT="$WEB_MODE_SCRIPT" X11_CLIENT="$X11_CLIENT" DISPLAY_VALUE="$DISPLAY_VALUE" \
    SCENARIO="$scenario" TARGET_XID="$target_xid" TARGET_PID="$TARGET_PID" \
    PANEL_XID="$PANEL_XID" PANEL_PID="$PANEL_PID" KIOSK_XID="$KIOSK_XID" KIOSK_PID="$KIOSK_PID" \
    TARGET_PROFILE="$TARGET_PROFILE" PANEL_PROFILE="$PANEL_PROFILE" KIOSK_PROFILE="$KIOSK_PROFILE" \
    bash -c '
      source "$WEB_MODE_SCRIPT"
      timeout() { shift; "$@"; }
      xwininfo() {
        local window_id="${!#}" map_state
        map_state="$(DISPLAY="$DISPLAY_VALUE" "$X11_CLIENT" map-state "$((window_id))")" || return 1
        case "$map_state" in
          viewable) printf "  Map State: IsViewable\n" ;;
          unmapped) printf "  Map State: IsUnMapped\n" ;;
          unviewable) printf "  Map State: IsUnviewable\n" ;;
          *) return 1 ;;
        esac
      }
      validate_profile_window_fast() {
        local xid="$1" profile="$2" pid
        pid="$(DISPLAY="$DISPLAY_VALUE" "$X11_CLIENT" pid "$xid")" || return 1
        case "$profile:$pid" in
          "$TARGET_PROFILE:$TARGET_PID"|"$PANEL_PROFILE:$PANEL_PID"|"$KIOSK_PROFILE:$KIOSK_PID") ;;
          *) return 1 ;;
        esac
        DISPLAY="$DISPLAY_VALUE" "$X11_CLIENT" geometry "$xid" >/dev/null
      }
      wait_for_profile_window() {
        case "$1" in
          "$TARGET_PROFILE") validate_profile_window_fast "$TARGET_XID" "$TARGET_PROFILE" && printf "%s\n" "$TARGET_XID" ;;
          "$PANEL_PROFILE") validate_profile_window_fast "$PANEL_XID" "$PANEL_PROFILE" && printf "%s\n" "$PANEL_XID" ;;
          "$KIOSK_PROFILE") validate_profile_window_fast "$KIOSK_XID" "$KIOSK_PROFILE" && printf "%s\n" "$KIOSK_XID" ;;
          *) return 1 ;;
        esac
      }
      first_window_for_profile() {
        wait_for_profile_window "$1"
      }
      window_geometry_compact() {
        DISPLAY="$DISPLAY_VALUE" "$X11_CLIENT" geometry "$1"
      }
      window_opacity_value() {
        DISPLAY="$DISPLAY_VALUE" "$X11_CLIENT" opacity "$1"
      }
      initial_entry_ensure_mapped() {
        "$X11_CLIENT" window --display "$DISPLAY_VALUE" --action map --xid "$1" || return $?
        [[ "$(DISPLAY="$DISPLAY_VALUE" "$X11_CLIENT" map-state "$1")" == "viewable" ]]
      }
      initial_entry_set_geometry() {
        local xid="$1" position="$2" size="$3" x y width height
        x="${position%,*}"
        y="${position#*,}"
        size="$(normalize_window_size "$size")"
        width="${size%,*}"
        height="${size#*,}"
        "$X11_CLIENT" window --display "$DISPLAY_VALUE" --action geometry --xid "$xid" \
          --x "$x" --y "$y" --width "$width" --height "$height"
      }
      initial_entry_move_window() {
        local x="${2%,*}" y="${2#*,}"
        "$X11_CLIENT" window --display "$DISPLAY_VALUE" --action geometry --xid "$1" \
          --x "$x" --y "$y" --width 1920 --height 720
      }
      initial_entry_resize_window() {
        local size width height
        size="$(normalize_window_size "$2")"
        width="${size%,*}"
        height="${size#*,}"
        "$X11_CLIENT" window --display "$DISPLAY_VALUE" --action geometry --xid "$1" \
          --x 0 --y 0 --width "$width" --height "$height"
      }
      set_window_opacity() {
        local value=0
        [[ "$2" == "1" || "$2" == "1.0" ]] && value=4294967295
        "$X11_CLIENT" window --display "$DISPLAY_VALUE" --action opacity --xid "$1" --opacity "$value"
      }
      initial_entry_raise_window() {
        "$X11_CLIENT" window --display "$DISPLAY_VALUE" --action raise --xid "$1"
      }
      initial_entry_lower_window() {
        [[ -n "${1:-}" ]] || return 0
        "$X11_CLIENT" window --display "$DISPLAY_VALUE" --action lower --xid "$1"
      }
      rename_function() {
        local name="$1"
        eval "$(declare -f "$name" | sed "1s/^$name /${name}_real /")"
      }
      case "$SCENARIO" in
        panel_geometry_fail)
          rename_function initial_entry_set_geometry
          initial_entry_set_geometry() {
            [[ "$1" != "$PANEL_XID" ]] || { printf "panel geometry injected failure\n" >&2; return 23; }
            initial_entry_set_geometry_real "$@"
          }
          ;;
        destroy_after_validation)
          rename_function initial_entry_ensure_mapped
          DESTROYED=0
          initial_entry_ensure_mapped() {
            local status=0
            initial_entry_ensure_mapped_real "$@" || status=$?
            if [[ "$1" == "$PANEL_XID" && "$DESTROYED" == "0" ]]; then
              DESTROYED=1
              kill "$TARGET_PID" >/dev/null 2>&1 || true
              sleep 0.08
            fi
            return "$status"
          }
          ;;
        target_map_fail)
          rename_function initial_entry_ensure_mapped
          initial_entry_ensure_mapped() {
            [[ "$1" != "$TARGET_XID" ]] || { printf "target map injected failure\n" >&2; return 24; }
            initial_entry_ensure_mapped_real "$@"
          }
          ;;
        target_opacity_fail)
          rename_function initial_entry_restore_opacity
          initial_entry_restore_opacity() {
            [[ "$1" != "$TARGET_XID" ]] || { printf "target opacity injected failure\n" >&2; return 25; }
            initial_entry_restore_opacity_real "$@"
          }
          ;;
        target_move_fail)
          initial_entry_move_window() {
            printf "target move injected failure\n" >&2
            return 26
          }
          ;;
        target_resize_fail)
          initial_entry_resize_window() {
            printf "target resize injected failure\n" >&2
            return 29
          }
          ;;
        target_raise_fail)
          rename_function initial_entry_raise_window
          initial_entry_raise_window() {
            [[ "$1" != "$TARGET_XID" ]] || { printf "target raise injected failure\n" >&2; return 27; }
            initial_entry_raise_window_real "$@"
          }
          ;;
        reassert_fail)
          initial_entry_reassert_foreground() {
            printf "foreground reassert injected failure\n" >&2
            return 28
          }
          ;;
        final_geometry_mismatch)
          rename_function initial_entry_reassert_foreground
          initial_entry_reassert_foreground() {
            initial_entry_reassert_foreground_real "$@" || return $?
            "$X11_CLIENT" window --display "$DISPLAY_VALUE" --action geometry \
              --xid "$TARGET_XID" --x 17 --y 0 --width 1920 --height 720
          }
          ;;
        trace_loss)
          rename_function initial_entry_set_geometry
          TRACE_DROPPED=0
          initial_entry_set_geometry() {
            initial_entry_set_geometry_real "$@" || return $?
            if [[ "$1" == "$PANEL_XID" && "$TRACE_DROPPED" == "0" ]]; then
              TRACE_DROPPED=1
              mv "$TIKPAL_WEB_MODE_INITIAL_ENTRY_TRACE_PATH" "$TIKPAL_WEB_MODE_INITIAL_ENTRY_TRACE_PATH.lost"
            fi
          }
          ;;
      esac
      initial_entry_surface_plan "$TARGET_XID" "$TARGET_PROFILE" "$PANEL_PROFILE" resident_initial_entry
    ' >"$output_path" 2>&1
  RUN_STATUS=$?
  set -e
}

run_pool_pre_reveal() {
  local scenario="$1" trace_path="$2" request_id="$3" output_path="$4"
  set +e
  flock -x "$LOCK_PATH" env \
    TIKPAL_WEB_MODE_SOURCE_ONLY=1 \
    TIKPAL_KIOSK_SKIP_ENV_SOURCE=1 \
    TIKPAL_KIOSK_DISPLAY="$DISPLAY_VALUE" \
    TIKPAL_CHROMIUM_PROFILE_DIR="$KIOSK_PROFILE" \
    TIKPAL_WEB_MODE_PROFILE_ROOT="$PROFILE_ROOT" \
    TIKPAL_WEB_MODE_STATE_PATH="$STATE_PATH" \
    TIKPAL_WEB_MODE_PHYSICAL_REVEAL_STAMP_PATH="$STAMP_PATH" \
    TIKPAL_WEB_MODE_INITIAL_ENTRY_TRACE_PATH="$trace_path" \
    TIKPAL_WEB_MODE_OPEN_REQUEST_ID="$request_id" \
    TIKPAL_WEB_MODE_OPEN_X_SESSION_GENERATION=fixture-session \
    TIKPAL_WEB_MODE_X11_HELPER_MODE=disabled \
    TIKPAL_WEB_MODE_EXTENSION_ENABLED=0 \
    TIKPAL_WEB_MODE_ENTRY_REVEAL_SETTLE_SECONDS=0 \
    TIKPAL_WEB_MODE_RESIDENT_ENTRY_SETTLE_SECONDS=0 \
    TIKPAL_WEB_MODE_RESIDENT_ENTRY_PAINT_SETTLE_SECONDS=0 \
    TIKPAL_WEB_MODE_LOCKED=1 \
    WEB_MODE_SCRIPT="$WEB_MODE_SCRIPT" X11_CLIENT="$X11_CLIENT" DISPLAY_VALUE="$DISPLAY_VALUE" \
    SCENARIO="$scenario" TARGET_XID="$TARGET_XID" TARGET_PID="$TARGET_PID" \
    PANEL_XID="$PANEL_XID" PANEL_PID="$PANEL_PID" KIOSK_XID="$KIOSK_XID" KIOSK_PID="$KIOSK_PID" \
    TARGET_PROFILE="$TARGET_PROFILE" PANEL_PROFILE="$PANEL_PROFILE" KIOSK_PROFILE="$KIOSK_PROFILE" \
    POOL_WARM_STAMP="$POOL_WARM_STAMP" \
    bash -c '
      source "$WEB_MODE_SCRIPT"
      timeout() { shift; "$@"; }
      xwininfo() {
        local window_id="${!#}" map_state
        map_state="$(DISPLAY="$DISPLAY_VALUE" "$X11_CLIENT" map-state "$((window_id))")" || return 1
        case "$map_state" in
          viewable) printf "  Map State: IsViewable\n" ;;
          unmapped) printf "  Map State: IsUnMapped\n" ;;
          unviewable) printf "  Map State: IsUnviewable\n" ;;
          *) return 1 ;;
        esac
      }
      validate_profile_window_fast() {
        local xid="$1" profile="$2" pid
        pid="$(DISPLAY="$DISPLAY_VALUE" "$X11_CLIENT" pid "$xid")" || return 1
        case "$profile:$pid" in
          "$TARGET_PROFILE:$TARGET_PID"|"$PANEL_PROFILE:$PANEL_PID"|"$KIOSK_PROFILE:$KIOSK_PID") ;;
          *) return 1 ;;
        esac
        DISPLAY="$DISPLAY_VALUE" "$X11_CLIENT" geometry "$xid" >/dev/null
      }
      wait_for_profile_window() {
        case "$1" in
          "$TARGET_PROFILE") validate_profile_window_fast "$TARGET_XID" "$TARGET_PROFILE" && printf "%s\n" "$TARGET_XID" ;;
          "$PANEL_PROFILE") validate_profile_window_fast "$PANEL_XID" "$PANEL_PROFILE" && printf "%s\n" "$PANEL_XID" ;;
          "$KIOSK_PROFILE") validate_profile_window_fast "$KIOSK_XID" "$KIOSK_PROFILE" && printf "%s\n" "$KIOSK_XID" ;;
          *) return 1 ;;
        esac
      }
      first_window_for_profile() { wait_for_profile_window "$1"; }
      window_geometry_compact() { DISPLAY="$DISPLAY_VALUE" "$X11_CLIENT" geometry "$1"; }
      window_opacity_value() { DISPLAY="$DISPLAY_VALUE" "$X11_CLIENT" opacity "$1"; }
      initial_entry_ensure_mapped() {
        "$X11_CLIENT" window --display "$DISPLAY_VALUE" --action map --xid "$1" || return $?
        [[ "$(DISPLAY="$DISPLAY_VALUE" "$X11_CLIENT" map-state "$1")" == "viewable" ]]
      }
      initial_entry_set_geometry() {
        local xid="$1" position="$2" size="$3" x y width height
        x="${position%,*}"
        y="${position#*,}"
        size="$(normalize_window_size "$size")"
        width="${size%,*}"
        height="${size#*,}"
        "$X11_CLIENT" window --display "$DISPLAY_VALUE" --action geometry --xid "$xid" \
          --x "$x" --y "$y" --width "$width" --height "$height"
      }
      initial_entry_move_window() {
        local x="${2%,*}" y="${2#*,}"
        "$X11_CLIENT" window --display "$DISPLAY_VALUE" --action geometry --xid "$1" \
          --x "$x" --y "$y" --width 1920 --height 720
      }
      initial_entry_resize_window() {
        local size width height
        size="$(normalize_window_size "$2")"
        width="${size%,*}"
        height="${size#*,}"
        "$X11_CLIENT" window --display "$DISPLAY_VALUE" --action geometry --xid "$1" \
          --x 0 --y 0 --width "$width" --height "$height"
      }
      set_window_opacity() {
        local value=0
        [[ "$2" == "1" || "$2" == "1.0" ]] && value=4294967295
        "$X11_CLIENT" window --display "$DISPLAY_VALUE" --action opacity --xid "$1" --opacity "$value"
      }
      initial_entry_raise_window() { "$X11_CLIENT" window --display "$DISPLAY_VALUE" --action raise --xid "$1"; }
      initial_entry_lower_window() {
        [[ -n "${1:-}" ]] || return 0
        "$X11_CLIENT" window --display "$DISPLAY_VALUE" --action lower --xid "$1"
      }
      runtime_open_request_is_current_or_log() { return 0; }
      runtime_open_request_is_current() { return 0; }
      read_runtime_active_provider() { :; }
      read_runtime_provider_status() { printf "ready\n"; }
      provider_debug_port() { printf "9234\n"; }
      provider_has_real_provider_page() { return 0; }
      pool_warm_stamp_file() { printf "%s\n" "$POOL_WARM_STAMP"; }
      provider_prewarm_queue_running() { [[ "$SCENARIO" == prewarm_stop_fail ]]; }
      stop_provider_pool_prewarm() { :; }
      hide_onboard() { :; }
      ensure_side_panel() { :; }
      read_proxy_settings() { printf "1\thttp://fixture-proxy.invalid:1\n"; }
      effective_provider_proxy_enabled() { printf "1\n"; }
      provider_prefers_direct_proxy() { return 1; }
      provider_direct_reachable() { return 0; }
      stop_window_guard() { :; }
      profile_process_exists() { return 0; }
      close_provider_profile() { :; }
      start_provider_guard() { :; }
      close_web_mode() { :; }
      recover_or_cover_provider_failure() { :; }
      fail() { return 1; }
      activate_target_provider_audio_gate() { :; }
      commit_visible_provider_state() { :; }
      write_audio_bus_state() { :; }
      start_window_guard() { :; }
      reconcile_provider_pool_in_background() { :; }
      invalidate_chromium_window_cache() { :; }
      case "$SCENARIO" in
        prewarm_stop_fail)
          touch "$POOL_WARM_STAMP"
          stop_provider_pool_prewarm() { printf "prewarm stop injected failure\n" >&2; return 41; }
          ;;
        onboard_hide_fail)
          hide_onboard() { printf "onboard hide injected failure\n" >&2; return 42; }
          ;;
        panel_prepare_fail)
          ensure_side_panel() { printf "panel prepare injected failure\n" >&2; return 43; }
          ;;
        panel_prepare_exit)
          ensure_side_panel() { exit 48; }
          ;;
        panel_fast_tile)
          ensure_side_panel() {
            wmctrl() { :; }
            wmctrl_mutation() { return 0; }
            tile_window "$PANEL_XID" "$TIKPAL_WEB_MODE_PANEL_POSITION" "$TIKPAL_WEB_MODE_PANEL_WINDOW"
            tile_window_fast "$PANEL_XID" "$TIKPAL_WEB_MODE_PANEL_POSITION" "$TIKPAL_WEB_MODE_PANEL_WINDOW"
          }
          ;;
        proxy_settings_fail)
          read_proxy_settings() { printf "proxy settings injected failure\n" >&2; return 44; }
          ;;
        proxy_mode_fail)
          effective_provider_proxy_enabled() { printf "proxy mode injected failure\n" >&2; return 45; }
          ;;
        guard_stop_fail)
          stop_window_guard() { printf "guard stop injected failure\n" >&2; return 46; }
          ;;
        target_wait_fail)
          wait_for_profile_window() {
            [[ "$1" != "$TARGET_PROFILE" ]] || { printf "target wait injected failure\n" >&2; return 47; }
            case "$1" in
              "$PANEL_PROFILE") printf "%s\n" "$PANEL_XID" ;;
              "$KIOSK_PROFILE") printf "%s\n" "$KIOSK_XID" ;;
              *) return 1 ;;
            esac
          }
          ;;
        pre_reveal_trace_loss)
          ensure_side_panel() {
            mv "$TIKPAL_WEB_MODE_INITIAL_ENTRY_TRACE_PATH" "$TIKPAL_WEB_MODE_INITIAL_ENTRY_TRACE_PATH.lost"
          }
          ;;
      esac
      open_provider_pool spotify
    ' >"$output_path" 2>&1
  RUN_STATUS=$?
  set -e
}

assert_lock_free() {
  if ! flock -w 0 "$LOCK_PATH" true; then
    fail_fixture "web-mode lock remained held"
  fi
}

assert_failure_contract() {
  local trace_path="$1" expected_step="$2" expected_status="$3" output_path="$4"
  local failed_count actual_step actual_status aborted_count
  failed_count="$(jq -s '[.[] | select(.event == "initial_entry_step_failed")] | length' "$trace_path")"
  actual_step="$(jq -sr '[.[] | select(.event == "initial_entry_step_failed")][-1].step // ""' "$trace_path")"
  actual_status="$(jq -sr '[.[] | select(.event == "initial_entry_step_failed")][-1].exit_status // -1' "$trace_path")"
  aborted_count="$(jq -s '[.[] | select(.event == "initial_entry_aborted")] | length' "$trace_path")"
  [[ "$failed_count" == "1" && "$actual_step" == "$expected_step" &&
     "$actual_status" == "$expected_status" && "$aborted_count" == "1" ]] || {
    tail -30 "$trace_path" >&2 || true
    fail_fixture "failure contract was count=$failed_count step=$actual_step status=$actual_status aborted=$aborted_count"
  }
  [[ "$RUN_STATUS" == "$expected_status" ]] ||
    fail_fixture "$expected_step returned $RUN_STATUS, expected $expected_status"
  [[ ! -e "$STAMP_PATH" ]] || fail_fixture "$expected_step wrote a physical stamp"
  ! grep -q 'stage=opened' "$output_path" || fail_fixture "$expected_step logged opened"
  [[ "$(jq -r '.activeProvider' "$STATE_PATH")" == "null" ]] ||
    fail_fixture "$expected_step changed activeProvider"
  [[ ! -e "$PROFILE_ROOT/guard-windows.tsv" && ! -e "$PROFILE_ROOT/window-guard.pid" ]] ||
    fail_fixture "$expected_step created Guard state"
  assert_lock_free
}

assert_pool_failure_contract() {
  local trace_path="$1" expected_step="$2" expected_step_status="$3" expected_run_status="$4" output_path="$5"
  local failed_count actual_step actual_status aborted_count
  failed_count="$(jq -s '[.[] | select(.event == "initial_entry_step_failed")] | length' "$trace_path")"
  actual_step="$(jq -sr '[.[] | select(.event == "initial_entry_step_failed")][-1].step // ""' "$trace_path")"
  actual_status="$(jq -sr '[.[] | select(.event == "initial_entry_step_failed")][-1].exit_status // -1' "$trace_path")"
  aborted_count="$(jq -s '[.[] | select(.event == "initial_entry_aborted")] | length' "$trace_path")"
  [[ "$failed_count" == "1" && "$actual_step" == "$expected_step" &&
     "$actual_status" == "$expected_step_status" && "$aborted_count" == "1" ]] || {
    tail -30 "$trace_path" >&2 || true
    fail_fixture "pool failure contract was count=$failed_count step=$actual_step status=$actual_status aborted=$aborted_count"
  }
  [[ "$RUN_STATUS" == "$expected_run_status" ]] ||
    fail_fixture "$expected_step returned $RUN_STATUS, expected $expected_run_status"
  [[ ! -e "$STAMP_PATH" ]] || fail_fixture "$expected_step wrote a physical stamp"
  ! grep -q 'stage=opened' "$output_path" || fail_fixture "$expected_step logged opened"
  [[ "$(jq -r '.activeProvider' "$STATE_PATH")" == "null" ]] ||
    fail_fixture "$expected_step changed activeProvider"
  [[ ! -e "$PROFILE_ROOT/guard-windows.tsv" && ! -e "$PROFILE_ROOT/window-guard.pid" ]] ||
    fail_fixture "$expected_step created Guard state"
  assert_geometry "$TARGET_XID" "2560,0_1920x720" "$expected_step target cleanup"
  assert_geometry "$PANEL_XID" "2560,0_640x720" "$expected_step panel cleanup"
  assert_lock_free
}

# Full success path: all thirteen real X11/file steps complete and only then stamp.
reset_scenario "$TRACE_PATH"
run_plan success "$TARGET_XID" "$TRACE_PATH" success-request "$FIXTURE_DIR/success.log"
[[ "$RUN_STATUS" == "0" ]] || { cat "$FIXTURE_DIR/success.log" >&2; fail_fixture "success returned $RUN_STATUS"; }
[[ "$(jq -s '[.[] | select(.event == "initial_entry_step_completed")] | length' "$TRACE_PATH")" == "13" ]] ||
  fail_fixture "success did not complete exactly thirteen steps"
[[ "$(jq -s '[.[] | select(.event == "initial_entry_step_failed" or .event == "initial_entry_aborted")] | length' "$TRACE_PATH")" == "0" ]] ||
  fail_fixture "success emitted failure events"
[[ -s "$STAMP_PATH" ]] || fail_fixture "success did not write the physical stamp"
assert_geometry "$TARGET_XID" "0,0_1920x720" "success target"
assert_geometry "$PANEL_XID" "1920,0_640x720" "success panel"
assert_lock_free

run_pool_failure() {
  local scenario="$1" expected_step="$2" expected_step_status="$3" expected_run_status="$4"
  local trace_path="$FIXTURE_DIR/$scenario.jsonl" output_path="$FIXTURE_DIR/$scenario.log"
  reset_scenario "$trace_path"
  run_pool_pre_reveal "$scenario" "$trace_path" "$scenario-request" "$output_path"
  assert_pool_failure_contract "$trace_path" "$expected_step" "$expected_step_status" "$expected_run_status" "$output_path"
}

# Exercise the actual initial-entry prologue, not just the later surface plan.
# A ready resident target must cross every pre-reveal boundary before X11 step 1.
pool_success_trace="$FIXTURE_DIR/pool-success.jsonl"
reset_scenario "$pool_success_trace"
run_pool_pre_reveal panel_fast_tile "$pool_success_trace" pool-success-request "$FIXTURE_DIR/pool-success.log"
[[ "$RUN_STATUS" == "0" ]] || { cat "$FIXTURE_DIR/pool-success.log" >&2; fail_fixture "pool success returned $RUN_STATUS"; }
[[ "$(jq -s '[.[] | select(.event == "initial_entry_step_completed" and .step_number >= 50)] | length' "$pool_success_trace")" == "8" ]] ||
  fail_fixture "pool success did not complete all eight pre-reveal steps"
[[ "$(jq -s '[.[] | select(.event == "initial_entry_step_failed" or .event == "initial_entry_aborted")] | length' "$pool_success_trace")" == "0" ]] ||
  fail_fixture "pool success emitted failure events"
[[ -s "$STAMP_PATH" ]] || fail_fixture "pool success did not write the physical stamp"
assert_geometry "$TARGET_XID" "0,0_1920x720" "pool success target"
assert_geometry "$PANEL_XID" "1920,0_640x720" "pool success panel"
assert_lock_free

run_pool_failure prewarm_stop_fail prewarm_queue_stop 41 41
run_pool_failure onboard_hide_fail onboard_hide 42 42
run_pool_failure panel_prepare_fail side_panel_prepare 43 1
run_pool_failure panel_prepare_exit side_panel_prepare 48 1
run_pool_failure proxy_settings_fail proxy_settings 44 44
run_pool_failure proxy_mode_fail proxy_mode 45 45
run_pool_failure guard_stop_fail window_guard_stop 46 46
run_pool_failure target_wait_fail target_window_wait 47 1

# Losing trace ownership after a pre-reveal mutation must still clean surfaces
# and release the shared lock before returning the diagnostic status.
pre_reveal_trace_loss="$FIXTURE_DIR/pre-reveal-trace-loss.jsonl"
reset_scenario "$pre_reveal_trace_loss"
run_pool_pre_reveal pre_reveal_trace_loss "$pre_reveal_trace_loss" pre-reveal-trace-loss-request "$FIXTURE_DIR/pre-reveal-trace-loss.log"
[[ "$RUN_STATUS" == "90" ]] || fail_fixture "pre-reveal trace loss returned $RUN_STATUS, expected 90"
[[ -s "$pre_reveal_trace_loss.lost" && ! -e "$pre_reveal_trace_loss" ]] ||
  fail_fixture "pre-reveal trace loss did not preserve evidence before loss"
grep -q 'INITIAL_ENTRY_TRACE_APPEND_FAILED' "$FIXTURE_DIR/pre-reveal-trace-loss.log" ||
  fail_fixture "pre-reveal trace loss warning was not logged"
[[ ! -e "$STAMP_PATH" ]] || fail_fixture "pre-reveal trace loss wrote a physical stamp"
assert_geometry "$TARGET_XID" "2560,0_1920x720" "pre-reveal trace loss target cleanup"
assert_geometry "$PANEL_XID" "2560,0_640x720" "pre-reveal trace loss panel cleanup"
assert_lock_free

run_failure() {
  local scenario="$1" target_xid="$2" expected_step="$3" expected_status="$4"
  local trace_path="$FIXTURE_DIR/$scenario.jsonl" output_path="$FIXTURE_DIR/$scenario.log"
  reset_scenario "$trace_path"
  run_plan "$scenario" "$target_xid" "$trace_path" "$scenario-request" "$output_path"
  assert_failure_contract "$trace_path" "$expected_step" "$expected_status" "$output_path"
  if [[ "$target_xid" == "$TARGET_XID" && "$scenario" != "destroy_after_validation" ]]; then
    assert_geometry "$TARGET_XID" "2560,0_1920x720" "$scenario target cleanup"
  fi
  assert_geometry "$PANEL_XID" "2560,0_640x720" "$scenario panel cleanup"
}

run_failure panel_geometry_fail "$TARGET_XID" panel_geometry 23
run_failure target_map_fail "$TARGET_XID" target_map 24
run_failure target_opacity_fail "$TARGET_XID" target_opacity 25
run_failure target_move_fail "$TARGET_XID" target_move 26
run_failure target_resize_fail "$TARGET_XID" target_resize 29
run_failure target_raise_fail "$TARGET_XID" target_raise 27
run_failure reassert_fail "$TARGET_XID" foreground_reassert 28
run_failure final_geometry_mismatch "$TARGET_XID" final_surface_snapshot 1
run_failure bad_xid 4294967294 resolve_and_validate 1

# Destroy the real target window after identity validation. Step 5 must report the
# resulting BadWindow path, not a later generic geometry mismatch.
destroy_trace="$FIXTURE_DIR/destroy_after_validation.jsonl"
reset_scenario "$destroy_trace"
run_plan destroy_after_validation "$TARGET_XID" "$destroy_trace" destroy-request "$FIXTURE_DIR/destroy.log"
assert_failure_contract "$destroy_trace" target_map 1 "$FIXTURE_DIR/destroy.log"
assert_geometry "$PANEL_XID" "2560,0_640x720" "destroy panel cleanup"

# Recreate the target destroyed above so trace-loss cleanup is exercised against
# live surfaces. Losing the trace after step 3 must not prevent cleanup/unlock.
TARGET_PID=""
rm -f "$FIXTURE_DIR/target.xid"
"$X11_CLIENT" surface --display "$DISPLAY_VALUE" --output "$FIXTURE_DIR/target.xid" \
  --user-data-dir="$TARGET_PROFILE" --x 2560 --y 0 --width 1920 --height 720 &
TARGET_PID=$!
wait_for_file "$FIXTURE_DIR/target.xid" "replacement target surface"
TARGET_XID="$(<"$FIXTURE_DIR/target.xid")"
trace_loss_path="$FIXTURE_DIR/trace_loss.jsonl"
reset_scenario "$trace_loss_path"
run_plan trace_loss "$TARGET_XID" "$trace_loss_path" trace-loss-request "$FIXTURE_DIR/trace-loss.log"
[[ "$RUN_STATUS" == "90" ]] || fail_fixture "trace loss returned $RUN_STATUS, expected 90"
[[ -s "$trace_loss_path.lost" && ! -e "$trace_loss_path" ]] ||
  fail_fixture "trace loss did not preserve the pre-loss evidence"
grep -q 'INITIAL_ENTRY_TRACE_APPEND_FAILED' "$FIXTURE_DIR/trace-loss.log" ||
  fail_fixture "trace loss warning was not logged"
[[ ! -e "$STAMP_PATH" ]] || fail_fixture "trace loss wrote a physical stamp"
assert_geometry "$TARGET_XID" "2560,0_1920x720" "trace-loss target cleanup"
assert_geometry "$PANEL_XID" "2560,0_640x720" "trace-loss panel cleanup"
assert_lock_free

# A missing trace fails before the first X11 mutation.
missing_trace="$FIXTURE_DIR/missing/initial-entry.jsonl"
reset_scenario "$FIXTURE_DIR/preflight.jsonl"
run_plan success "$TARGET_XID" "$missing_trace" preflight-request "$FIXTURE_DIR/preflight.log"
[[ "$RUN_STATUS" == "90" ]] || fail_fixture "trace preflight returned $RUN_STATUS, expected 90"
assert_geometry "$TARGET_XID" "2560,0_1920x720" "trace-preflight target"
assert_geometry "$PANEL_XID" "2560,0_640x720" "trace-preflight panel"
[[ ! -e "$STAMP_PATH" ]] || fail_fixture "trace preflight wrote a physical stamp"
assert_lock_free

printf 'tikpal initial-entry fixture passed: success=2 injected_failures=19 trace_loss_cleanup=2 preflight_fail_closed=1\n'

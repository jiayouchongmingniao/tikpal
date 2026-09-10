# Sourced by tikpal-web-mode.sh. Keep configured geometry distinct from the
# effective geometry inherited by foreground commands and the long-lived Guard.
: "${TIKPAL_PANEL_BASE_LEFT_POSITION:=$TIKPAL_WEB_MODE_LEFT_POSITION}"
: "${TIKPAL_PANEL_BASE_LEFT_WINDOW:=$TIKPAL_WEB_MODE_LEFT_WINDOW}"
: "${TIKPAL_PANEL_BASE_PANEL_POSITION:=$TIKPAL_WEB_MODE_PANEL_POSITION}"
: "${TIKPAL_PANEL_BASE_PANEL_WINDOW:=$TIKPAL_WEB_MODE_PANEL_WINDOW}"
export TIKPAL_PANEL_BASE_LEFT_POSITION TIKPAL_PANEL_BASE_LEFT_WINDOW
export TIKPAL_PANEL_BASE_PANEL_POSITION TIKPAL_PANEL_BASE_PANEL_WINDOW
TIKPAL_PANEL_MODULE="${BASH_SOURCE[0]%/*}/tikpal-web-mode-panel.mjs"

panel_use_geometry() {
  local geometry screen
  TIKPAL_WEB_MODE_LEFT_POSITION="$TIKPAL_PANEL_BASE_LEFT_POSITION"
  TIKPAL_WEB_MODE_LEFT_WINDOW="$TIKPAL_PANEL_BASE_LEFT_WINDOW"
  TIKPAL_WEB_MODE_PANEL_POSITION="$TIKPAL_PANEL_BASE_PANEL_POSITION"
  TIKPAL_WEB_MODE_PANEL_WINDOW="$TIKPAL_PANEL_BASE_PANEL_WINDOW"
  [[ "$1" == collapsed ]] || return 0
  geometry="$(node "$TIKPAL_PANEL_MODULE" geometry "$TIKPAL_PANEL_BASE_LEFT_POSITION" \
    "$TIKPAL_PANEL_BASE_LEFT_WINDOW" "$TIKPAL_PANEL_BASE_PANEL_POSITION" "$TIKPAL_PANEL_BASE_PANEL_WINDOW" collapsed)" || return 1
  IFS=$'\t' read -r TIKPAL_WEB_MODE_LEFT_POSITION TIKPAL_WEB_MODE_LEFT_WINDOW \
    TIKPAL_WEB_MODE_PANEL_POSITION TIKPAL_WEB_MODE_PANEL_WINDOW screen <<< "$geometry"
}

panel_refresh_layout() {
  local mode=expanded generation=""
  [[ ! -r "$TIKPAL_KIOSK_X_SESSION_GENERATION_PATH" ]] || IFS= read -r generation < "$TIKPAL_KIOSK_X_SESSION_GENERATION_PATH" || true
  if [[ -n "$generation" && -r "$TIKPAL_WEB_MODE_STATE_PATH" ]]; then
    mode="$(jq -r --arg generation "$generation" \
      'if .activeProvider and .lastOpenedXSessionGeneration == $generation and .panelMode == "collapsed" then "collapsed" else "expanded" end' \
      "$TIKPAL_WEB_MODE_STATE_PATH" 2>/dev/null)" || mode=expanded
  fi
  TIKPAL_PANEL_PROCESS_MODE="$mode"
  panel_use_geometry "$mode"
}

panel_detect_support() {
  local geometry screen monitors
  geometry="$(node "$TIKPAL_PANEL_MODULE" geometry "$TIKPAL_PANEL_BASE_LEFT_POSITION" \
    "$TIKPAL_PANEL_BASE_LEFT_WINDOW" "$TIKPAL_PANEL_BASE_PANEL_POSITION" "$TIKPAL_PANEL_BASE_PANEL_WINDOW" expanded)" || return 1
  screen="${geometry##*$'\t'}"
  [[ "$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool getdisplaygeometry 2>/dev/null)" == "$screen" ]] || return 1
  monitors="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xrandr --listactivemonitors 2>/dev/null)" || return 1
  [[ "${monitors%%$'\n'*}" == 'Monitors: 1' ]]
}

panel_state_operation() {
  node "$TIKPAL_PANEL_MODULE" "$1" "$TIKPAL_WEB_MODE_STATE_PATH" \
    "$TIKPAL_KIOSK_X_SESSION_GENERATION_PATH" "${@:2}"
}

panel_verify_windows() {
  local provider_window="$1" provider_profile="$2" panel_window="$3" panel_profile="$4"
  validate_profile_window_fast "$provider_window" "$provider_profile" || return 1
  validate_profile_window_fast "$panel_window" "$panel_profile" || return 1
  [[ "$(initial_entry_window_map_state "$provider_window")" == viewable ]] || return 1
  [[ "$(initial_entry_window_map_state "$panel_window")" == viewable ]] || return 1
  [[ "$(initial_entry_expected_geometry "$TIKPAL_WEB_MODE_LEFT_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW")" == "$(window_geometry_compact "$provider_window")" ]] || return 1
  [[ "$(initial_entry_expected_geometry "$TIKPAL_WEB_MODE_PANEL_POSITION" "$TIKPAL_WEB_MODE_PANEL_WINDOW")" == "$(window_geometry_compact "$panel_window")" ]] || return 1
  # xwininfo lists topmost children first; query independently after the raise.
  local children opacity window
  for window in "$provider_window" "$panel_window"; do
    opacity="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" timeout 3 xprop -id "$window" _NET_WM_WINDOW_OPACITY 2>/dev/null)" || return 1
    case "$opacity" in
      *"not found"*|*"no such atom"*|*"= 4294967295"*) ;;
      *) return 1 ;;
    esac
  done
  children="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" timeout 3 xwininfo -root -tree 2>/dev/null)" || return 1
  PANEL_PROVIDER_XID="$provider_window" PANEL_WINDOW_XID="$panel_window" node -e '
    const fs=require("fs");const lines=fs.readFileSync(0,"utf8").split("\n");
    const ids=lines.map(line=>line.match(/^\s+(0x[0-9a-f]+)\s/i)?.[1]).filter(Boolean).map(Number);
    const p=ids.indexOf(Number(process.env.PANEL_PROVIDER_XID)),s=ids.indexOf(Number(process.env.PANEL_WINDOW_XID));
    process.exit(s>=0 && p>=0 && s<p ? 0 : 1);
  ' <<< "$children"
}

panel_place_windows() {
  local mode="$1" provider_window="$2" provider_profile="$3" panel_window="$4" panel_profile="$5"
  panel_use_geometry "$mode" || return 1
  validate_profile_window_fast "$provider_window" "$provider_profile" || return 1
  validate_profile_window_fast "$panel_window" "$panel_profile" || return 1
  if [[ "$mode" == collapsed ]]; then
    initial_entry_set_geometry "$provider_window" "$TIKPAL_WEB_MODE_LEFT_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW" || return 1
    initial_entry_set_geometry "$panel_window" "$TIKPAL_WEB_MODE_PANEL_POSITION" "$TIKPAL_WEB_MODE_PANEL_WINDOW" || return 1
  else
    initial_entry_set_geometry "$panel_window" "$TIKPAL_WEB_MODE_PANEL_POSITION" "$TIKPAL_WEB_MODE_PANEL_WINDOW" || return 1
    initial_entry_set_geometry "$provider_window" "$TIKPAL_WEB_MODE_LEFT_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW" || return 1
  fi
  initial_entry_raise_window "$panel_window" || return 1
  panel_verify_windows "$provider_window" "$provider_profile" "$panel_window" "$panel_profile"
}

set_panel_mode() {
  local mode="$1" kind="${2:-external}" snapshot old_mode provider provider_profile panel_profile
  local provider_window panel_window started
  local TIKPAL_PANEL_LAYOUT_TRANSACTION=1
  [[ "$mode" == expanded || "$mode" == collapsed ]] || return 1
  [[ "${TIKPAL_WEB_MODE_LOCKED:-0}" == 1 ]] || return 1
  [[ "$kind" == internal ]] || ! provider_switch_in_progress || return 1
  snapshot="$(panel_state_operation snapshot "$kind" "${TIKPAL_PANEL_EXPECTED_PROVIDER:-}" \
    "${TIKPAL_PANEL_EXPECTED_SESSION:-}" "${TIKPAL_PANEL_EXPECTED_GENERATION:-}")" || return 1
  panel_detect_support || { log 'PANEL_LAYOUT_UNSUPPORTED'; return 1; }
  provider="$(jq -r .activeProvider <<< "$snapshot")"
  old_mode="$(jq -r .panelMode <<< "$snapshot")"
  provider_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$provider"
  panel_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel"
  provider_window="$(read_guard_window provider "$provider_profile" || true)"
  panel_window="$(read_guard_window panel "$panel_profile" || true)"
  validate_profile_window_fast "$provider_window" "$provider_profile" || provider_window="$(first_window_for_profile "$provider_profile" || true)"
  validate_profile_window_fast "$panel_window" "$panel_profile" || panel_window="$(first_window_for_profile "$panel_profile" || true)"
  validate_profile_window_fast "$provider_window" "$provider_profile" || return 1
  validate_profile_window_fast "$panel_window" "$panel_profile" || return 1
  panel_use_geometry "$old_mode" || return 1
  if [[ "$old_mode" == "$mode" ]] && panel_verify_windows "$provider_window" "$provider_profile" "$panel_window" "$panel_profile"; then
    panel_state_operation check "$snapshot" "$mode"
    return
  fi
  started="$(now_ms)"
  # This revokes both Phase 2 leases and Phase 3 watches before publishing a
  # fresh Shell generation. Never resize with uncertain Helper ownership.
  x11_helper_restore_shell_owner || return 1
  [[ ! -r "$TIKPAL_WEB_MODE_X11_HELPER_GENERATION_PATH" ]] || \
    IFS= read -r TIKPAL_WEB_MODE_X11_PROCESS_GENERATION < "$TIKPAL_WEB_MODE_X11_HELPER_GENERATION_PATH"
  write_guard_window_list "$provider_profile" "$provider_window" "$panel_profile" "$panel_window" || return 1
  if panel_state_operation check "$snapshot" "$mode" \
    && panel_place_windows "$mode" "$provider_window" "$provider_profile" "$panel_window" "$panel_profile" \
    && TIKPAL_WEB_MODE_FOREGROUND_STATE_COMMIT=1 with_provider_state_lock panel_state_operation commit "$snapshot" "$mode"; then
    panel_refresh_layout || return 1
    log_stage "panel_layout mode=$mode status=ok elapsed_ms=$(( $(now_ms) - started ))"
    return 0
  fi
  # The window lock prevents Close from parking surfaces while rollback runs.
  # A newly queued Close may change state; rollback never overwrites that state.
  if x11_helper_guard_may_write "$provider_window" "$panel_window" \
    && panel_place_windows "$old_mode" "$provider_window" "$provider_profile" "$panel_window" "$panel_profile"; then
    log_stage "panel_layout mode=$mode status=failed rollback=ok"
  else
    log_stage "panel_layout mode=$mode status=failed rollback=failed"
    # Keep the panel reachable without touching an unverified Provider window.
    if validate_profile_window_fast "$panel_window" "$panel_profile" && x11_helper_guard_may_write "$panel_window"; then
      initial_entry_set_geometry "$panel_window" "$TIKPAL_PANEL_BASE_PANEL_POSITION" "$TIKPAL_PANEL_BASE_PANEL_WINDOW" || true
      initial_entry_raise_window "$panel_window" || true
    fi
  fi
  panel_refresh_layout || true
  return 1
}

panel_prepare_open() {
  if [[ "$(jq -r '.panelMode // "expanded"' "$TIKPAL_WEB_MODE_STATE_PATH" 2>/dev/null)" == collapsed ]] \
    && [[ -n "$(read_runtime_active_provider)" ]]; then
    set_panel_mode expanded internal || return 1
  fi
  panel_use_geometry expanded
  TIKPAL_PANEL_LAYOUT_SUPPORTED=0
  if panel_detect_support; then TIKPAL_PANEL_LAYOUT_SUPPORTED=1; fi
  export TIKPAL_PANEL_LAYOUT_SUPPORTED
}

# Invoked by the shared mutation gate after taking web-mode.lock. A background
# process that prepared geometry before a layout change must not write it later.
panel_writer_is_current() {
  [[ "${TIKPAL_PANEL_LAYOUT_TRANSACTION:-0}" != 1 ]] || return 0
  [[ -r "$TIKPAL_WEB_MODE_STATE_PATH" ]] || return 0
  local current
  current="$(jq -r 'if .activeProvider and .panelMode == "collapsed" then "collapsed" else "expanded" end' "$TIKPAL_WEB_MODE_STATE_PATH")" || return 1
  [[ "$current" == "${TIKPAL_PANEL_PROCESS_MODE:-expanded}" ]]
}

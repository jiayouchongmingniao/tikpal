#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="${TIKPAL_KIOSK_ENV_FILE:-$APP_DIR/.env.kiosk}"
FLAGS_FILE="${TIKPAL_CHROMIUM_FLAGS_FILE:-$SCRIPT_DIR/chromium-flags.conf}"

should_source_env_file() {
  local value
  value="$(printf '%s' "${TIKPAL_KIOSK_SKIP_ENV_SOURCE:-0}" | tr '[:upper:]' '[:lower:]')"
  [[ "$value" != "1" && "$value" != "true" && "$value" != "yes" && "$value" != "on" ]]
}

if should_source_env_file && [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

: "${TIKPAL_KIOSK_DISPLAY:=:0}"
: "${TIKPAL_CHROMIUM_BIN:=/usr/lib/chromium-browser/chromium-browser}"
: "${TIKPAL_CHROMIUM_ALSA_OUTPUT_DEVICE:=}"
: "${TIKPAL_WEB_MODE_PROFILE_ROOT:=$HOME/.config/tikpal-web-mode}"
: "${TIKPAL_WEB_MODE_SETTINGS_PATH:=$APP_DIR/.tikpal/web-mode-settings.json}"
: "${TIKPAL_WEB_MODE_STATE_PATH:=$APP_DIR/.tikpal/web-mode-state.json}"
: "${TIKPAL_WEB_MODE_EXTENSION_DIR:=$SCRIPT_DIR/web-mode-extension}"
: "${TIKPAL_WEB_MODE_EXTENSION_ENABLED:=1}"
: "${TIKPAL_WEB_MODE_PROXY_APPLY_TIMEOUT_SECONDS:=5}"
: "${TIKPAL_WEB_MODE_PROVIDER_BOOTSTRAP_TIMEOUT_SECONDS:=7}"
: "${TIKPAL_WEB_MODE_LEFT_WINDOW:=1920x720}"
: "${TIKPAL_WEB_MODE_LEFT_POSITION:=0,0}"
: "${TIKPAL_WEB_MODE_PANEL_WINDOW:=640x720}"
: "${TIKPAL_WEB_MODE_PANEL_POSITION:=1920,0}"
: "${TIKPAL_WEB_MODE_SIDE_PANEL_URL:=http://localhost:4173/side-panel}"
: "${TIKPAL_WEB_MODE_TRANSITION_URL:=http://127.0.0.1:4173/web-mode-transition.html}"
: "${TIKPAL_WEB_MODE_STAGE_POSITION:=2560,0}"
: "${TIKPAL_WEB_MODE_STAGE_REVEAL_MS:=650}"
: "${TIKPAL_WEB_MODE_LOCK_TIMEOUT_SECONDS:=2}"
: "${TIKPAL_WEB_MODE_DEFAULT_PROXY_URL:=http://192.168.10.140:7897}"
: "${TIKPAL_WEB_MODE_ONBOARD:=1}"
: "${TIKPAL_WEB_MODE_ONBOARD_AUTO_FOCUS:=1}"
: "${TIKPAL_WEB_MODE_ONBOARD_WINDOW:=900x280}"
: "${TIKPAL_WEB_MODE_ONBOARD_POSITION:=500,420}"
: "${TIKPAL_WEB_MODE_ALSA_OUTPUT_DEVICE:=${TIKPAL_CHROMIUM_ALSA_OUTPUT_DEVICE:-}}"
: "${TIKPAL_WEB_MODE_WINDOW_GUARD:=1}"
: "${TIKPAL_WEB_MODE_SINGLE_PROVIDER_WINDOW:=1}"
: "${TIKPAL_WEB_MODE_POPUP_BLOCKING:=1}"
: "${TIKPAL_WEB_MODE_PROVIDER_DEBUG_PORT:=9234}"
: "${TIKPAL_WEB_MODE_PROVIDER_GUARD:=1}"
: "${TIKPAL_WEB_MODE_DISABLE_HANG_MONITOR:=1}"
: "${TIKPAL_WEB_MODE_ERROR_PAGE_URL:=http://127.0.0.1:4173/web-mode-error.html}"
: "${TIKPAL_WEB_MODE_QQ_AUTO_CONFIRM:=1}"

log() {
  printf '[tikpal-web-mode] %s\n' "$*"
}

fail() {
  log "ERROR: $*"
  exit 1
}

with_web_mode_lock() {
  mkdir -p "$TIKPAL_WEB_MODE_PROFILE_ROOT"
  if command -v flock >/dev/null 2>&1; then
    (
      flock -x -w "$TIKPAL_WEB_MODE_LOCK_TIMEOUT_SECONDS" 9 || fail "Explore is already switching"
      "$@"
    ) 9>"$TIKPAL_WEB_MODE_PROFILE_ROOT/web-mode.lock"
    return
  fi
  "$@"
}

is_enabled() {
  local value
  value="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  [[ "$value" == "1" || "$value" == "true" || "$value" == "yes" || "$value" == "on" || "$value" == "enabled" ]]
}

normalize_window_size() {
  local value
  value="$(printf '%s' "$1" | tr -d '[:space:]')"
  if [[ "$value" =~ ^([0-9]+)[xX,]([0-9]+)$ ]]; then
    printf '%s,%s\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
    return
  fi
  fail "Invalid window size '$1'; expected WIDTHxHEIGHT or WIDTH,HEIGHT"
}

window_width() {
  local size
  size="$(normalize_window_size "$1")"
  printf '%s\n' "${size%,*}"
}

window_height() {
  local size
  size="$(normalize_window_size "$1")"
  printf '%s\n' "${size#*,}"
}

position_x() {
  printf '%s\n' "${1%,*}"
}

position_y() {
  printf '%s\n' "${1#*,}"
}

provider_url() {
  case "$1" in
    suno) printf '%s\n' "${TIKPAL_WEB_MODE_SUNO_URL:-https://suno.com/explore}" ;;
    spotify) printf '%s\n' "${TIKPAL_WEB_MODE_SPOTIFY_URL:-https://open.spotify.com/}" ;;
    youtube_music) printf '%s\n' "${TIKPAL_WEB_MODE_YOUTUBE_MUSIC_URL:-https://music.youtube.com/}" ;;
    apple_music) printf '%s\n' "${TIKPAL_WEB_MODE_APPLE_MUSIC_URL:-https://music.apple.com/}" ;;
    tidal) printf '%s\n' "${TIKPAL_WEB_MODE_TIDAL_URL:-https://listen.tidal.com/}" ;;
    qobuz) printf '%s\n' "${TIKPAL_WEB_MODE_QOBUZ_URL:-https://play.qobuz.com/}" ;;
    deezer) printf '%s\n' "${TIKPAL_WEB_MODE_DEEZER_URL:-https://www.deezer.com/en/channels/explore/}" ;;
    amazon_music) printf '%s\n' "${TIKPAL_WEB_MODE_AMAZON_MUSIC_URL:-https://music.amazon.com/}" ;;
    qq_music) printf '%s\n' "${TIKPAL_WEB_MODE_QQ_MUSIC_URL:-https://y.qq.com/n/ryqq/player}" ;;
    netease_music) printf '%s\n' "${TIKPAL_WEB_MODE_NETEASE_MUSIC_URL:-https://music.163.com/st/webplayer}" ;;
    *) fail "Unknown Explore provider '$1'" ;;
  esac
}

provider_label() {
  case "$1" in
    suno) printf '%s\n' "Suno" ;;
    spotify) printf '%s\n' "Spotify" ;;
    youtube_music) printf '%s\n' "YouTube Music" ;;
    apple_music) printf '%s\n' "Apple Music" ;;
    tidal) printf '%s\n' "TIDAL" ;;
    qobuz) printf '%s\n' "Qobuz" ;;
    deezer) printf '%s\n' "Deezer" ;;
    amazon_music) printf '%s\n' "Amazon Music" ;;
    qq_music) printf '%s\n' "QQ Music" ;;
    netease_music) printf '%s\n' "NetEase Cloud Music" ;;
    *) printf '%s\n' "$1" ;;
  esac
}

provider_debug_port() {
  local base="$TIKPAL_WEB_MODE_PROVIDER_DEBUG_PORT"
  local offset=0
  [[ "$base" =~ ^[0-9]+$ ]] || base=9234
  case "$1" in
    suno) offset=9 ;;
    spotify) offset=0 ;;
    youtube_music) offset=1 ;;
    apple_music) offset=2 ;;
    tidal) offset=3 ;;
    qobuz) offset=4 ;;
    deezer) offset=5 ;;
    amazon_music) offset=6 ;;
    qq_music) offset=7 ;;
    netease_music) offset=8 ;;
  esac
  printf '%s\n' "$((base + offset))"
}

read_flags() {
  local flags=()
  local line
  [[ -f "$FLAGS_FILE" ]] || {
    printf '%s\n' "${flags[@]}"
    return
  }
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    flags+=("$line")
  done < "$FLAGS_FILE"
  printf '%s\n' "${flags[@]}"
}

read_proxy_settings() {
  node - "$TIKPAL_WEB_MODE_SETTINGS_PATH" "$TIKPAL_WEB_MODE_DEFAULT_PROXY_URL" <<'NODE'
const fs = require("node:fs");
const [settingsPath, defaultProxy] = process.argv.slice(2);
let settings = {};
try { settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")); } catch {}
const enabled = typeof settings.proxyEnabled === "boolean" ? settings.proxyEnabled : true;
const proxyUrl = String(settings.proxyUrl || defaultProxy).trim();
console.log(`${enabled ? "1" : "0"}\t${proxyUrl}`);
NODE
}

proxy_revision_applied() {
  node - "$TIKPAL_WEB_MODE_SETTINGS_PATH" "$TIKPAL_WEB_MODE_STATE_PATH" <<'NODE'
const fs = require("node:fs");
const [settingsPath, statePath] = process.argv.slice(2);
let settings = {};
let state = {};
try { settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")); } catch {}
try { state = JSON.parse(fs.readFileSync(statePath, "utf8")); } catch {}
process.exit(settings.updatedAt && settings.updatedAt === state.proxyAppliedSettingsUpdatedAt ? 0 : 1);
NODE
}

wait_for_proxy_applied() {
  local attempts=$((TIKPAL_WEB_MODE_PROXY_APPLY_TIMEOUT_SECONDS * 10))
  while [[ "$attempts" -gt 0 ]]; do
    proxy_revision_applied && return 0
    sleep 0.1
    attempts=$((attempts - 1))
  done
  return 1
}

wait_for_real_provider_url() {
  local provider_port="$1"
  local attempts=$((TIKPAL_WEB_MODE_PROVIDER_BOOTSTRAP_TIMEOUT_SECONDS * 10))
  while [[ "$attempts" -gt 0 ]]; do
    if curl --noproxy '*' -sf "http://127.0.0.1:$provider_port/json/list" 2>/dev/null \
      | node -e 'let body=""; process.stdin.on("data", chunk => body += chunk); process.stdin.on("end", () => { try { process.exit(JSON.parse(body).some(target => target.type === "page" && String(target.url || "").startsWith("https://")) ? 0 : 1); } catch { process.exit(1); } });'; then
      return 0
    fi
    sleep 0.1
    attempts=$((attempts - 1))
  done
  return 1
}

ensure_chromium_profile_prefs() {
  local profile_dir="$1"
  node - "$profile_dir" "$TIKPAL_WEB_MODE_POPUP_BLOCKING" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [profileDir, popupBlocking] = process.argv.slice(2);
const defaultDir = path.join(profileDir, "Default");
const prefsPath = path.join(defaultDir, "Preferences");
fs.mkdirSync(defaultDir, { recursive: true });
let prefs = {};
try { prefs = JSON.parse(fs.readFileSync(prefsPath, "utf8")); } catch {}
prefs.profile = prefs.profile && typeof prefs.profile === "object" ? prefs.profile : {};
prefs.profile.default_content_setting_values = prefs.profile.default_content_setting_values && typeof prefs.profile.default_content_setting_values === "object"
  ? prefs.profile.default_content_setting_values
  : {};
prefs.profile.default_content_setting_values.cookies = 1;
if (/^(1|true|yes|on|enabled)$/i.test(String(popupBlocking))) {
  prefs.profile.default_content_setting_values.popups = 2;
  prefs.profile.default_content_setting_values.ads = 2;
}
prefs.profile.cookie_controls_mode = 0;
prefs.profile.block_third_party_cookies = false;
fs.writeFileSync(prefsPath, `${JSON.stringify(prefs, null, 2)}\n`);
NODE
}

write_runtime_provider_state() {
  local provider="$1"
  node - "$TIKPAL_WEB_MODE_STATE_PATH" "$provider" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [statePath, provider] = process.argv.slice(2);
let state = {};
try { state = JSON.parse(fs.readFileSync(statePath, "utf8")); } catch {}
state.activeProvider = provider || null;
state.lastError = null;
state.updatedAt = new Date().toISOString();
fs.mkdirSync(path.dirname(statePath), { recursive: true });
fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
NODE
}

read_runtime_active_provider() {
  node - "$TIKPAL_WEB_MODE_STATE_PATH" <<'NODE'
const fs = require("node:fs");
const [statePath] = process.argv.slice(2);
try {
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  process.stdout.write(String(state.activeProvider || ""));
} catch {}
NODE
}

chromium_base_args() {
  printf '%s\n' \
    "--force-dark-mode" \
    "--enable-features=WebUIDarkMode" \
    "--default-background-color=000000"
}

call_onboard_method() {
  local method="$1"
  local session_bus="${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$(id -u)/bus}"
  local _
  command -v gdbus >/dev/null 2>&1 || return 1
  export DBUS_SESSION_BUS_ADDRESS="$session_bus"
  for _ in 1 2 3 4 5; do
    if DISPLAY="$TIKPAL_KIOSK_DISPLAY" DBUS_SESSION_BUS_ADDRESS="$session_bus" \
      timeout 1 gdbus call --session --dest org.onboard.Onboard \
        --object-path /org/onboard/Onboard/Keyboard \
        --method "org.onboard.Onboard.Keyboard.$method" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.2
  done
  return 1
}

position_onboard() {
  local area height keyboard_area=0 keyboard_window="" window width
  is_enabled "$TIKPAL_WEB_MODE_ONBOARD" || return 0
  pgrep -u "$(id -u)" -x onboard >/dev/null 2>&1 || return 0

  if command -v xdotool >/dev/null 2>&1; then
    while IFS= read -r window; do
      width="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool getwindowgeometry --shell "$window" 2>/dev/null | awk -F= '$1 == "WIDTH" { print $2 }')"
      height="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool getwindowgeometry --shell "$window" 2>/dev/null | awk -F= '$1 == "HEIGHT" { print $2 }')"
      area=$(( ${width:-0} * ${height:-0} ))
      if (( area > keyboard_area )); then
        keyboard_window="$window"
        keyboard_area="$area"
      fi
    done < <(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool search --name Onboard 2>/dev/null || true)
    if [[ -n "$keyboard_window" ]]; then
      width="$(window_width "$TIKPAL_WEB_MODE_ONBOARD_WINDOW")"
      height="$(window_height "$TIKPAL_WEB_MODE_ONBOARD_WINDOW")"
      DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool windowmap "$keyboard_window" >/dev/null 2>&1 || true
      DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool windowsize "$keyboard_window" \
        "$((width - 1))" "$((height - 1))" >/dev/null 2>&1 || true
      sleep 0.2
      DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool windowsize "$keyboard_window" "$width" "$height" >/dev/null 2>&1 || true
      DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool windowmove "$keyboard_window" \
        "$(position_x "$TIKPAL_WEB_MODE_ONBOARD_POSITION")" "$(position_y "$TIKPAL_WEB_MODE_ONBOARD_POSITION")" >/dev/null 2>&1 || true
    fi
  fi

  if command -v wmctrl >/dev/null 2>&1 && [[ -n "$keyboard_window" ]]; then
    DISPLAY="$TIKPAL_KIOSK_DISPLAY" wmctrl -i -r "$keyboard_window" -b add,above >/dev/null 2>&1 || true
  fi
}

onboard_visible_windows() {
  command -v xdotool >/dev/null 2>&1 || return 1
  DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool search --onlyvisible --name Onboard 2>/dev/null || true
}

configure_onboard() {
  command -v gsettings >/dev/null 2>&1 || return 0
  gsettings set org.onboard.window docking-enabled false >/dev/null 2>&1 || true
  gsettings set org.onboard.window force-to-top true >/dev/null 2>&1 || true
  gsettings set org.onboard.auto-show enabled false >/dev/null 2>&1 || true
  gsettings set org.onboard.keyboard input-event-source GTK >/dev/null 2>&1 || true
  gsettings set org.onboard.keyboard key-synth XTest >/dev/null 2>&1 || true
}

window_uses_profile() {
  local cmdline pid profile="$1" window="$2"
  [[ -n "$profile" ]] || return 1
  pid="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool getwindowpid "$window" 2>/dev/null || true)"
  [[ -n "$pid" ]] || return 1
  cmdline="$(tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null || true)"
  [[ "$cmdline" == *"--user-data-dir=$profile"* ]]
}

focused_browser_window() {
  local active_provider area best_area=0 best_window="" height profile window width
  command -v xdotool >/dev/null 2>&1 || return 1
  profile="${TIKPAL_WEB_MODE_PROVIDER_PROFILE:-}"
  if [[ -z "$profile" ]]; then
    active_provider="$(read_runtime_active_provider)"
    [[ -n "$active_provider" ]] && profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$active_provider"
  fi
  if [[ -n "$profile" ]]; then
    while IFS= read -r window; do
      [[ -n "$window" ]] || continue
      if window_uses_profile "$profile" "$window"; then
        printf '%s\n' "$window"
        return 0
      fi
    done < <(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool search --onlyvisible --class chromium 2>/dev/null || true)
  fi
  window="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool getactivewindow 2>/dev/null || true)"
  if [[ -n "$window" ]]; then
    printf '%s\n' "$window"
    return 0
  fi
  while IFS= read -r window; do
    [[ -n "$window" ]] || continue
    width="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool getwindowgeometry --shell "$window" 2>/dev/null | awk -F= '$1 == "WIDTH" { print $2 }')"
    height="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool getwindowgeometry --shell "$window" 2>/dev/null | awk -F= '$1 == "HEIGHT" { print $2 }')"
    area=$(( ${width:-0} * ${height:-0} ))
    if (( area > best_area )); then
      best_window="$window"
      best_area="$area"
    fi
  done < <(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool search --onlyvisible --class chromium 2>/dev/null || true)
  [[ -n "$best_window" ]] && printf '%s\n' "$best_window"
}

focus_window() {
  local window="$1"
  [[ -n "$window" ]] || return 0
  command -v xdotool >/dev/null 2>&1 || return 0
  DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool windowfocus "$window" >/dev/null 2>&1 || true
  if [[ -z "$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool getactivewindow 2>/dev/null || true)" ]]; then
    DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool windowactivate "$window" >/dev/null 2>&1 || true
  fi
}

ensure_onboard() {
  local active_window=""
  is_enabled "$TIKPAL_WEB_MODE_ONBOARD" || return 0
  command -v onboard >/dev/null 2>&1 || {
    log "WARN: onboard not found"
    return 0
  }

  if command -v xdotool >/dev/null 2>&1; then
    active_window="$(focused_browser_window || true)"
  fi
  configure_onboard

  if ! pgrep -u "$(id -u)" -x onboard >/dev/null 2>&1; then
    local session_bus="${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$(id -u)/bus}"
    export DBUS_SESSION_BUS_ADDRESS="$session_bus"
    DISPLAY="$TIKPAL_KIOSK_DISPLAY" onboard </dev/null >/dev/null 2>&1 9>&- &
    disown "$!" 2>/dev/null || true
    sleep 0.8
  fi

  focus_window "$active_window"
  if call_onboard_method Show; then
    sleep 0.3
  fi
  position_onboard
  focus_window "$active_window"
}

hide_onboard() {
  local window
  is_enabled "$TIKPAL_WEB_MODE_ONBOARD" || return 0
  pgrep -u "$(id -u)" -x onboard >/dev/null 2>&1 || return 0
  call_onboard_method Hide || true
  sleep 0.2
  while IFS= read -r window; do
    [[ -n "$window" ]] || continue
    DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool windowunmap "$window" >/dev/null 2>&1 || true
  done < <(onboard_visible_windows)
}

toggle_onboard() {
  is_enabled "$TIKPAL_WEB_MODE_ONBOARD" || return 0
  if ! pgrep -u "$(id -u)" -x onboard >/dev/null 2>&1 || [[ -z "$(onboard_visible_windows)" ]]; then
    ensure_onboard
    return
  fi
  hide_onboard
}

close_side_panel() {
  pkill -f -- "--user-data-dir=$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel" >/dev/null 2>&1 || true
  sleep 0.2
  pkill -KILL -f -- "--user-data-dir=$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel" >/dev/null 2>&1 || true
}

side_panel_window_visible() {
  local panel_profile="$1"
  local window pid
  command -v xdotool >/dev/null 2>&1 || return 1
  while IFS= read -r window; do
    [[ -n "$window" ]] || continue
    pid="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool getwindowpid "$window" 2>/dev/null || true)"
    if process_tree_uses_profile "$pid" "$panel_profile"; then
      return 0
    fi
  done < <(visible_chromium_windows)
  return 1
}

window_guard_pid_file() {
  printf '%s\n' "$TIKPAL_WEB_MODE_PROFILE_ROOT/window-guard.pid"
}

stop_window_guard() {
  local pid_file pid
  pid_file="$(window_guard_pid_file)"
  [[ -r "$pid_file" ]] || return 0
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  if [[ "$pid" =~ ^[0-9]+$ ]]; then
    kill "$pid" >/dev/null 2>&1 || true
  fi
  rm -f "$pid_file"
}

provider_guard_pid_file() {
  printf '%s\n' "$TIKPAL_WEB_MODE_PROFILE_ROOT/provider-guard.pid"
}

stop_provider_guard() {
  local pid_file pid
  for pid_file in "$(provider_guard_pid_file)" "$TIKPAL_WEB_MODE_PROFILE_ROOT/qq-confirm.pid"; do
    [[ -r "$pid_file" ]] || {
      rm -f "$pid_file"
      continue
    }
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [[ "$pid" =~ ^[0-9]+$ ]]; then
      kill "$pid" >/dev/null 2>&1 || true
    fi
    rm -f "$pid_file"
  done
}

close_provider_windows() {
  stop_window_guard
  stop_provider_guard
  pkill -f -- "--user-data-dir=$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/" >/dev/null 2>&1 || true
  sleep 0.2
  pkill -KILL -f -- "--user-data-dir=$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/" >/dev/null 2>&1 || true
}

close_web_mode() {
  hide_onboard
  close_provider_windows
  close_side_panel
  close_transition_veil
  write_runtime_provider_state ""
}

close_provider_profile() {
  local provider_profile="$1"
  [[ -n "$provider_profile" ]] || return 0
  pkill -f -- "--user-data-dir=$provider_profile" >/dev/null 2>&1 || true
}

close_other_provider_profiles() {
  local keep_profile="$1"
  local profile
  [[ -d "$TIKPAL_WEB_MODE_PROFILE_ROOT/providers" ]] || return 0
  for profile in "$TIKPAL_WEB_MODE_PROFILE_ROOT"/providers/*; do
    [[ -d "$profile" ]] || continue
    [[ "$profile" == "$keep_profile" ]] && continue
    close_provider_profile "$profile"
  done
}

process_tree_uses_profile() {
  local pid="$1"
  local profile="$2"
  local depth=0
  [[ -n "$pid" && -n "$profile" ]] || return 1

  while [[ "$pid" =~ ^[0-9]+$ && "$pid" != "1" && "$depth" -lt 8 ]]; do
    if [[ -r "/proc/$pid/cmdline" ]] && tr '\0' ' ' < "/proc/$pid/cmdline" | grep -Fq -- "--user-data-dir=$profile"; then
      return 0
    fi
    [[ -r "/proc/$pid/status" ]] || break
    pid="$(awk '/^PPid:/{print $2}' "/proc/$pid/status")"
    depth=$((depth + 1))
  done

  return 1
}

is_tikpal_window_title() {
  local title="$1"
  [[ "$title" == "Tikpal" || "$title" == *"Tikpal - Chromium"* || "$title" == *"Tikpal Speaker"* ]]
}

is_ad_window_title() {
  local title="$1"
  [[ "$title" == *"广告"* || "$title" == *"推广"* || "$title" == *"活动"* || "$title" == *"弹窗"* || "$title" == *"领券"* || "$title" == *"下载"* || "$title" == *"VIP"* || "$title" == *"vip"* || "$title" == *"Ad"* || "$title" == *"ad"* ]]
}

profile_process_exists() {
  pgrep -f -- "--user-data-dir=$1" >/dev/null 2>&1
}

tile_window() {
  local window="$1"
  local position="$2"
  local size="$3"
  local x y width height
  x="$(position_x "$position")"
  y="$(position_y "$position")"
  width="$(window_width "$size")"
  height="$(window_height "$size")"
  if command -v wmctrl >/dev/null 2>&1; then
    DISPLAY="$TIKPAL_KIOSK_DISPLAY" wmctrl -i -r "$window" -b remove,fullscreen,maximized_vert,maximized_horz >/dev/null 2>&1 || true
  fi
  DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool \
    windowmove --sync "$window" "$x" "$y" \
    windowsize --sync "$window" "$width" "$height" \
    windowmove "$window" "$x" "$y" >/dev/null 2>&1 || true
}

raise_window() {
  local window="$1"
  [[ -n "$window" ]] || return 0
  DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool windowraise "$window" windowactivate "$window" >/dev/null 2>&1 || true
}

first_window_for_profile() {
  local profile="$1"
  local window pid geometry width height area best_window="" best_area=0
  command -v xdotool >/dev/null 2>&1 || return 1
  while IFS= read -r window; do
    [[ -n "$window" ]] || continue
    pid="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool getwindowpid "$window" 2>/dev/null || true)"
    process_tree_uses_profile "$pid" "$profile" || continue
    geometry="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool getwindowgeometry "$window" 2>/dev/null || true)"
    width="$(printf '%s\n' "$geometry" | awk -F'[ x]+' '/Geometry:/{print $3}')"
    height="$(printf '%s\n' "$geometry" | awk -F'[ x]+' '/Geometry:/{print $4}')"
    [[ "$width" =~ ^[0-9]+$ && "$height" =~ ^[0-9]+$ ]] || continue
    area=$((width * height))
    if [[ "$area" -gt "$best_area" ]]; then
      best_area="$area"
      best_window="$window"
    fi
  done < <(all_chromium_windows)
  if [[ -n "$best_window" && "$best_area" -gt 100000 ]]; then
    printf '%s\n' "$best_window"
    return 0
  fi
  return 1
}

wait_for_profile_window() {
  local profile="$1"
  local attempts="${2:-50}"
  local window
  while [[ "$attempts" -gt 0 ]]; do
    window="$(first_window_for_profile "$profile" || true)"
    if [[ -n "$window" ]]; then
      printf '%s\n' "$window"
      return 0
    fi
    sleep 0.1
    attempts=$((attempts - 1))
  done
  return 1
}

visible_chromium_windows() {
  {
    DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool search --onlyvisible --class chromium 2>/dev/null || true
    DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool search --onlyvisible --class Chromium-browser 2>/dev/null || true
  } | awk 'NF && !seen[$0]++'
}

all_chromium_windows() {
  {
    DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool search --class chromium 2>/dev/null || true
    DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool search --class Chromium-browser 2>/dev/null || true
  } | awk 'NF && !seen[$0]++'
}

tile_visible_web_mode_windows() {
  local provider_profile="$1"
  local panel_profile="$2"
  local window pid title active_window keep_window provider_window_count
  local provider_windows=()
  command -v xdotool >/dev/null 2>&1 || return 0
  active_window="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool getactivewindow 2>/dev/null || true)"

  while IFS= read -r window; do
    [[ -n "$window" ]] || continue
    pid="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool getwindowpid "$window" 2>/dev/null || true)"
    title="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool getwindowname "$window" 2>/dev/null || true)"

    if process_tree_uses_profile "$pid" "$panel_profile"; then
      tile_window "$window" "$TIKPAL_WEB_MODE_PANEL_POSITION" "$TIKPAL_WEB_MODE_PANEL_WINDOW"
      continue
    fi
    if is_ad_window_title "$title"; then
      DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool windowclose "$window" >/dev/null 2>&1 || true
      continue
    fi
    if process_tree_uses_profile "$pid" "$provider_profile"; then
      tile_window "$window" "$TIKPAL_WEB_MODE_LEFT_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW"
      provider_windows+=("$window")
    elif [[ -n "$title" ]] && ! is_tikpal_window_title "$title"; then
      tile_window "$window" "$TIKPAL_WEB_MODE_LEFT_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW"
      provider_windows+=("$window")
    fi
  done < <(visible_chromium_windows)

  is_enabled "$TIKPAL_WEB_MODE_SINGLE_PROVIDER_WINDOW" || return 0
  [[ "${#provider_windows[@]}" -gt 1 ]] || return 0

  provider_window_count="${#provider_windows[@]}"
  keep_window="${provider_windows[$((provider_window_count - 1))]}"
  for window in "${provider_windows[@]}"; do
    if [[ "$window" == "$active_window" ]]; then
      keep_window="$window"
      break
    fi
  done
  for window in "${provider_windows[@]}"; do
    [[ "$window" == "$keep_window" ]] && continue
    DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool windowclose "$window" >/dev/null 2>&1 || true
  done
  tile_window "$keep_window" "$TIKPAL_WEB_MODE_LEFT_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW"
}

start_window_guard() {
  is_enabled "$TIKPAL_WEB_MODE_WINDOW_GUARD" || return 0
  command -v xdotool >/dev/null 2>&1 || return 0

  local provider_profile="$1"
  local panel_profile="$2"
  [[ -n "$provider_profile" ]] || return 0

  stop_window_guard
  mkdir -p "$TIKPAL_WEB_MODE_PROFILE_ROOT"
  nohup "$SCRIPT_DIR/tikpal-web-mode.sh" guard "$provider_profile" "$panel_profile" >/dev/null 2>&1 9>&- &
  printf '%s\n' "$!" > "$(window_guard_pid_file)"
}

run_window_guard() {
  local provider_profile="$1"
  local panel_profile="$2"
  [[ -n "$provider_profile" ]] || return 0

  while profile_process_exists "$provider_profile"; do
    tile_visible_web_mode_windows "$provider_profile" "$panel_profile"
    sleep 0.25
  done
}

start_provider_guard() {
  local provider="$1"
  local provider_profile="$2"
  local provider_url_value="$3"
  local proxy_enabled="$4"
  local provider_port="${5:-$TIKPAL_WEB_MODE_PROVIDER_DEBUG_PORT}"
  local helper="$SCRIPT_DIR/tikpal-web-mode-guard.mjs"
  local proxy_mode="direct"
  is_enabled "$TIKPAL_WEB_MODE_PROVIDER_GUARD" || return 0
  [[ -f "$helper" ]] || {
    log "WARN: Explore provider guard missing: $helper"
    return 0
  }
  command -v node >/dev/null 2>&1 || {
    log "WARN: node not found; Explore provider guard disabled"
    return 0
  }
  [[ "$proxy_enabled" == "1" ]] && proxy_mode="proxy"

  stop_provider_guard
  mkdir -p "$TIKPAL_WEB_MODE_PROFILE_ROOT"
  TIKPAL_WEB_MODE_PROVIDER_ID="$provider" \
  TIKPAL_WEB_MODE_PROVIDER_LABEL="$(provider_label "$provider")" \
  TIKPAL_WEB_MODE_PROVIDER_PROFILE="$provider_profile" \
  TIKPAL_WEB_MODE_PROVIDER_URL="$provider_url_value" \
  TIKPAL_WEB_MODE_PROXY_MODE="$proxy_mode" \
  TIKPAL_WEB_MODE_ERROR_PAGE_URL="$TIKPAL_WEB_MODE_ERROR_PAGE_URL" \
  TIKPAL_WEB_MODE_PROVIDER_DEBUG_PORT="$provider_port" \
  TIKPAL_WEB_MODE_QQ_AUTO_CONFIRM="$TIKPAL_WEB_MODE_QQ_AUTO_CONFIRM" \
  TIKPAL_WEB_MODE_ONBOARD_AUTO_FOCUS="$TIKPAL_WEB_MODE_ONBOARD_AUTO_FOCUS" \
  TIKPAL_KIOSK_DISPLAY="$TIKPAL_KIOSK_DISPLAY" \
    node "$helper" >/dev/null 2>&1 9>&- &
  printf '%s\n' "$!" > "$(provider_guard_pid_file)"
}

close_transition_veil() {
  pkill -f -- "--user-data-dir=$TIKPAL_WEB_MODE_PROFILE_ROOT/transition" >/dev/null 2>&1 || true
}

launch_transition_veil() {
  local provider="${1:-}"
  local transition_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/transition"
  local transition_url="$TIKPAL_WEB_MODE_TRANSITION_URL"
  local window
  [[ -n "$provider" ]] && transition_url="$transition_url?provider=$provider"
  close_transition_veil
  mkdir -p "$transition_profile"
  ensure_chromium_profile_prefs "$transition_profile"
  mapfile -t flags < <(read_flags)
  mapfile -t base_args < <(chromium_base_args)
  DISPLAY="$TIKPAL_KIOSK_DISPLAY" "$TIKPAL_CHROMIUM_BIN" \
    "${flags[@]}" \
    "${base_args[@]}" \
    "--app=$transition_url" \
    "--user-data-dir=$transition_profile" \
    "--window-position=$TIKPAL_WEB_MODE_LEFT_POSITION" \
    "--window-size=$(normalize_window_size "$TIKPAL_WEB_MODE_LEFT_WINDOW")" \
    >/dev/null 2>&1 9>&- &
  window="$(wait_for_profile_window "$transition_profile" 20 || true)"
  if [[ -n "$window" ]]; then
    tile_window "$window" "$TIKPAL_WEB_MODE_LEFT_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW"
    raise_window "$window"
  fi
}

launch_side_panel() {
  local opening_provider="${1:-}"
  local panel_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel"
  local panel_url="$TIKPAL_WEB_MODE_SIDE_PANEL_URL"
  local window
  [[ -n "$opening_provider" ]] && panel_url="$panel_url?opening=$opening_provider"
  mkdir -p "$panel_profile"
  ensure_chromium_profile_prefs "$panel_profile"
  mapfile -t flags < <(read_flags)
  mapfile -t base_args < <(chromium_base_args)
  DISPLAY="$TIKPAL_KIOSK_DISPLAY" "$TIKPAL_CHROMIUM_BIN" \
    "${flags[@]}" \
    "${base_args[@]}" \
    "--app=$panel_url" \
    "--user-data-dir=$panel_profile" \
    "--window-position=$TIKPAL_WEB_MODE_PANEL_POSITION" \
    "--window-size=$(normalize_window_size "$TIKPAL_WEB_MODE_PANEL_WINDOW")" \
    >/dev/null 2>&1 9>&- &
  window="$(wait_for_profile_window "$panel_profile" 20 || true)"
  if [[ -n "$window" ]]; then
    tile_window "$window" "$TIKPAL_WEB_MODE_PANEL_POSITION" "$TIKPAL_WEB_MODE_PANEL_WINDOW"
    raise_window "$window"
  fi
}

ensure_side_panel() {
  local opening_provider="${1:-}"
  local panel_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel"
  if side_panel_window_visible "$panel_profile"; then
    return 0
  fi
  close_side_panel
  launch_side_panel "$opening_provider"
}

open_provider() {
  local provider="$1"
  local url
  local provider_profile
  local provider_port
  local current_provider
  local current_profile
  local target_window launch_url extension_enabled=0
  local proxy_line proxy_enabled proxy_url
  url="$(provider_url "$provider")"
  provider_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$provider"
  provider_port="$(provider_debug_port "$provider")"
  current_provider="$(read_runtime_active_provider)"
  current_profile=""
  if [[ -n "$current_provider" ]]; then
    current_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$current_provider"
  fi
  proxy_line="$(read_proxy_settings)"
  proxy_enabled="${proxy_line%%$'\t'*}"
  proxy_url="${proxy_line#*$'\t'}"
  launch_url="$url"
  if is_enabled "$TIKPAL_WEB_MODE_EXTENSION_ENABLED" && [[ -f "$TIKPAL_WEB_MODE_EXTENSION_DIR/manifest.json" ]]; then
    extension_enabled=1
    launch_url="$TIKPAL_WEB_MODE_TRANSITION_URL?provider=$provider"
  fi

  mkdir -p "$provider_profile"
  ensure_chromium_profile_prefs "$provider_profile"
  hide_onboard
  stop_window_guard
  close_provider_profile "$provider_profile"
  sleep 0.2
  ensure_side_panel "$provider"
  launch_transition_veil "$provider"
  mapfile -t flags < <(read_flags)
  mapfile -t base_args < <(chromium_base_args)

  local args=(
    "${flags[@]}"
    "${base_args[@]}"
    "--app=$launch_url"
    "--user-data-dir=$provider_profile"
    "--remote-debugging-address=127.0.0.1"
    "--remote-debugging-port=$provider_port"
    "--window-position=$TIKPAL_WEB_MODE_STAGE_POSITION"
    "--window-size=$(normalize_window_size "$TIKPAL_WEB_MODE_LEFT_WINDOW")"
  )

  if is_enabled "$TIKPAL_WEB_MODE_DISABLE_HANG_MONITOR"; then
    args+=("--disable-hang-monitor")
  fi

  if [[ "$extension_enabled" == "1" ]]; then
    args+=("--load-extension=$TIKPAL_WEB_MODE_EXTENSION_DIR")
  fi
  if [[ -n "$TIKPAL_WEB_MODE_ALSA_OUTPUT_DEVICE" ]]; then
    args+=("--alsa-output-device=$TIKPAL_WEB_MODE_ALSA_OUTPUT_DEVICE")
  fi
  if [[ "$extension_enabled" != "1" && "$proxy_enabled" == "1" && -n "$proxy_url" ]]; then
    args+=("--proxy-server=$proxy_url")
    args+=("--proxy-bypass-list=localhost;127.0.0.1;<local>")
  fi

  DISPLAY="$TIKPAL_KIOSK_DISPLAY" "$TIKPAL_CHROMIUM_BIN" "${args[@]}" >/dev/null 2>&1 9>&- &
  target_window="$(wait_for_profile_window "$provider_profile" 70 || true)"
  if [[ -z "$target_window" ]]; then
    close_transition_veil
    close_provider_profile "$provider_profile"
    [[ -n "$current_profile" ]] && start_window_guard "$current_profile" "$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel"
    fail "$(provider_label "$provider") did not open"
  fi
  if [[ "$extension_enabled" == "1" ]] && ! wait_for_real_provider_url "$provider_port"; then
    close_transition_veil
    close_provider_profile "$provider_profile"
    if [[ -n "$current_provider" && "$current_profile" != "$provider_profile" ]]; then
      start_provider_guard "$current_provider" "$current_profile" "$(provider_url "$current_provider")" "$proxy_enabled" "$(provider_debug_port "$current_provider")"
      start_window_guard "$current_profile" "$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel"
    fi
    fail "$(provider_label "$provider") did not enter the provider page within ${TIKPAL_WEB_MODE_PROVIDER_BOOTSTRAP_TIMEOUT_SECONDS}s"
  fi
  start_provider_guard "$provider" "$provider_profile" "$url" "$proxy_enabled" "$provider_port"
  tile_window "$target_window" "$TIKPAL_WEB_MODE_LEFT_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW"
  raise_window "$target_window"
  sleep "$(awk "BEGIN { printf \"%.3f\", $TIKPAL_WEB_MODE_STAGE_REVEAL_MS / 1000 }")"
  close_other_provider_profiles "$provider_profile"
  close_transition_veil
  tile_window "$target_window" "$TIKPAL_WEB_MODE_LEFT_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW"
  raise_window "$target_window"
  write_runtime_provider_state "$provider"
  start_window_guard "$provider_profile" "$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel"
  log "opened $provider"
}

apply_proxy_settings() {
  local provider="$1"
  local provider_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$provider"
  local proxy_line proxy_enabled
  if is_enabled "$TIKPAL_WEB_MODE_EXTENSION_ENABLED" && [[ -f "$TIKPAL_WEB_MODE_EXTENSION_DIR/manifest.json" ]]; then
    profile_process_exists "$provider_profile" || fail "Explore provider process is not running"
    wait_for_proxy_applied || fail "Explore proxy was not applied within ${TIKPAL_WEB_MODE_PROXY_APPLY_TIMEOUT_SECONDS}s"
    proxy_line="$(read_proxy_settings)"
    proxy_enabled="${proxy_line%%$'\t'*}"
    start_provider_guard "$provider" "$provider_profile" "$(provider_url "$provider")" "$proxy_enabled" "$(provider_debug_port "$provider")"
    log "proxy applied without restarting $provider"
    return
  fi
  open_provider "$provider"
}

check_runtime() {
  log "app dir: $APP_DIR"
  log "display: $TIKPAL_KIOSK_DISPLAY"
  log "chromium: $TIKPAL_CHROMIUM_BIN"
  log "left: $TIKPAL_WEB_MODE_LEFT_POSITION $(normalize_window_size "$TIKPAL_WEB_MODE_LEFT_WINDOW")"
  log "stage: $TIKPAL_WEB_MODE_STAGE_POSITION"
  log "panel: $TIKPAL_WEB_MODE_PANEL_POSITION $(normalize_window_size "$TIKPAL_WEB_MODE_PANEL_WINDOW")"
  log "audio: ${TIKPAL_WEB_MODE_ALSA_OUTPUT_DEVICE:-default}"
  log "window guard: $TIKPAL_WEB_MODE_WINDOW_GUARD"
  log "single provider window: $TIKPAL_WEB_MODE_SINGLE_PROVIDER_WINDOW"
  log "popup blocking: $TIKPAL_WEB_MODE_POPUP_BLOCKING"
  log "extension: $TIKPAL_WEB_MODE_EXTENSION_ENABLED $TIKPAL_WEB_MODE_EXTENSION_DIR"
  log "proxy apply timeout: ${TIKPAL_WEB_MODE_PROXY_APPLY_TIMEOUT_SECONDS}s"
  log "provider bootstrap timeout: ${TIKPAL_WEB_MODE_PROVIDER_BOOTSTRAP_TIMEOUT_SECONDS}s"
  log "provider debug: 127.0.0.1:$TIKPAL_WEB_MODE_PROVIDER_DEBUG_PORT"
  log "provider debug stride: per-provider"
  log "provider guard: $TIKPAL_WEB_MODE_PROVIDER_GUARD"
  log "provider hang monitor: $TIKPAL_WEB_MODE_DISABLE_HANG_MONITOR"
  log "switch lock timeout: ${TIKPAL_WEB_MODE_LOCK_TIMEOUT_SECONDS}s"
  log "error page: $TIKPAL_WEB_MODE_ERROR_PAGE_URL"
  log "transition page: $TIKPAL_WEB_MODE_TRANSITION_URL"
  log "onboard: $TIKPAL_WEB_MODE_ONBOARD_POSITION $(normalize_window_size "$TIKPAL_WEB_MODE_ONBOARD_WINDOW")"
  log "onboard input focus: $TIKPAL_WEB_MODE_ONBOARD_AUTO_FOCUS"
  log "qq scoped auto confirm: $TIKPAL_WEB_MODE_QQ_AUTO_CONFIRM"
  log "settings: $TIKPAL_WEB_MODE_SETTINGS_PATH"
  read_proxy_settings | awk -F '\t' '{ printf("[tikpal-web-mode] proxy: %s %s\n", $1 == "1" ? "enabled" : "disabled", $2) }'
  [[ -x "$TIKPAL_CHROMIUM_BIN" ]] || fail "Chromium binary is missing or not executable"
  log "check passed"
}

case "${1:-open}" in
  --check)
    check_runtime
    ;;
  open)
    check_runtime
    with_web_mode_lock open_provider "${2:-spotify}"
    ;;
  close)
    with_web_mode_lock close_web_mode
    log "closed"
    ;;
  guard)
    run_window_guard "${2:-}" "${3:-}"
    ;;
  keyboard)
    check_runtime
    case "${2:-toggle}" in
      show) ensure_onboard ;;
      hide) hide_onboard ;;
      toggle) toggle_onboard ;;
      *) fail "Keyboard mode must be show, hide, or toggle" ;;
    esac
    log "keyboard ${2:-toggle} ready"
    ;;
  proxy)
    check_runtime
    with_web_mode_lock apply_proxy_settings "${2:-spotify}"
    ;;
  *)
    fail "Usage: $0 open <provider>|close|keyboard [show|hide|toggle]|proxy <provider>|--check"
    ;;
esac

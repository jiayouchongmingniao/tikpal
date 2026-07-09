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
: "${TIKPAL_WEB_MODE_LEFT_WINDOW:=1920x720}"
: "${TIKPAL_WEB_MODE_LEFT_POSITION:=0,0}"
: "${TIKPAL_WEB_MODE_PANEL_WINDOW:=640x720}"
: "${TIKPAL_WEB_MODE_PANEL_POSITION:=1920,0}"
: "${TIKPAL_WEB_MODE_SIDE_PANEL_URL:=http://localhost:4173/side-panel}"
: "${TIKPAL_WEB_MODE_DEFAULT_PROXY_URL:=http://192.168.10.140:7897}"
: "${TIKPAL_WEB_MODE_ONBOARD:=1}"
: "${TIKPAL_WEB_MODE_ALSA_OUTPUT_DEVICE:=${TIKPAL_CHROMIUM_ALSA_OUTPUT_DEVICE:-}}"
: "${TIKPAL_WEB_MODE_WINDOW_GUARD:=1}"
: "${TIKPAL_WEB_MODE_SINGLE_PROVIDER_WINDOW:=1}"
: "${TIKPAL_WEB_MODE_POPUP_BLOCKING:=1}"

log() {
  printf '[tikpal-web-mode] %s\n' "$*"
}

fail() {
  log "ERROR: $*"
  exit 1
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
    spotify) printf '%s\n' "${TIKPAL_WEB_MODE_SPOTIFY_URL:-https://open.spotify.com/}" ;;
    youtube_music) printf '%s\n' "${TIKPAL_WEB_MODE_YOUTUBE_MUSIC_URL:-https://music.youtube.com/}" ;;
    apple_music) printf '%s\n' "${TIKPAL_WEB_MODE_APPLE_MUSIC_URL:-https://music.apple.com/}" ;;
    tidal) printf '%s\n' "${TIKPAL_WEB_MODE_TIDAL_URL:-https://listen.tidal.com/}" ;;
    qobuz) printf '%s\n' "${TIKPAL_WEB_MODE_QOBUZ_URL:-https://play.qobuz.com/}" ;;
    deezer) printf '%s\n' "${TIKPAL_WEB_MODE_DEEZER_URL:-https://www.deezer.com/}" ;;
    amazon_music) printf '%s\n' "${TIKPAL_WEB_MODE_AMAZON_MUSIC_URL:-https://music.amazon.com/}" ;;
    qq_music) printf '%s\n' "${TIKPAL_WEB_MODE_QQ_MUSIC_URL:-https://y.qq.com/n/ryqq/player}" ;;
    netease_music) printf '%s\n' "${TIKPAL_WEB_MODE_NETEASE_MUSIC_URL:-https://music.163.com/st/webplayer}" ;;
    *) fail "Unknown Web Mode provider '$1'" ;;
  esac
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

chromium_base_args() {
  printf '%s\n' \
    "--force-dark-mode" \
    "--enable-features=WebUIDarkMode" \
    "--default-background-color=000000"
}

ensure_onboard() {
  is_enabled "$TIKPAL_WEB_MODE_ONBOARD" || return 0
  command -v onboard >/dev/null 2>&1 || {
    log "WARN: onboard not found"
    return 0
  }

  if command -v gsettings >/dev/null 2>&1; then
    gsettings set org.onboard.window docking-enabled false >/dev/null 2>&1 || true
    gsettings set org.onboard.window force-to-top true >/dev/null 2>&1 || true
    gsettings set org.onboard.auto-show enabled true >/dev/null 2>&1 || true
  fi

  if ! pgrep -u "$(id -u)" -x onboard >/dev/null 2>&1; then
    DISPLAY="$TIKPAL_KIOSK_DISPLAY" onboard >/dev/null 2>&1 &
    sleep 0.8
  fi

  if command -v wmctrl >/dev/null 2>&1; then
    DISPLAY="$TIKPAL_KIOSK_DISPLAY" wmctrl -r Onboard -b add,above >/dev/null 2>&1 || true
  fi
}

close_provider_windows() {
  pkill -f -- "--user-data-dir=$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/" >/dev/null 2>&1 || true
}

close_side_panel() {
  pkill -f -- "--user-data-dir=$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel" >/dev/null 2>&1 || true
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
  DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool windowmove "$window" "$x" "$y" windowsize "$window" "$width" "$height" >/dev/null 2>&1 || true
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
  done < <(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool search --onlyvisible --class chromium 2>/dev/null || true)

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

  (
    while profile_process_exists "$provider_profile"; do
      tile_visible_web_mode_windows "$provider_profile" "$panel_profile"
      sleep 1
    done
  ) >/dev/null 2>&1 &
}

launch_side_panel() {
  local panel_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel"
  if pgrep -f -- "--user-data-dir=$panel_profile" >/dev/null 2>&1; then
    return 0
  fi
  mkdir -p "$panel_profile"
  ensure_chromium_profile_prefs "$panel_profile"
  mapfile -t flags < <(read_flags)
  mapfile -t base_args < <(chromium_base_args)
  DISPLAY="$TIKPAL_KIOSK_DISPLAY" "$TIKPAL_CHROMIUM_BIN" \
    "${flags[@]}" \
    "${base_args[@]}" \
    "--app=$TIKPAL_WEB_MODE_SIDE_PANEL_URL" \
    "--user-data-dir=$panel_profile" \
    "--window-position=$TIKPAL_WEB_MODE_PANEL_POSITION" \
    "--window-size=$(normalize_window_size "$TIKPAL_WEB_MODE_PANEL_WINDOW")" \
    >/dev/null 2>&1 &
}

open_provider() {
  local provider="$1"
  local url
  local provider_profile
  local proxy_line proxy_enabled proxy_url
  url="$(provider_url "$provider")"
  provider_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$provider"
  proxy_line="$(read_proxy_settings)"
  proxy_enabled="${proxy_line%%$'\t'*}"
  proxy_url="${proxy_line#*$'\t'}"

  mkdir -p "$provider_profile"
  ensure_chromium_profile_prefs "$provider_profile"
  close_provider_windows
  ensure_onboard
  mapfile -t flags < <(read_flags)
  mapfile -t base_args < <(chromium_base_args)

  local args=(
    "${flags[@]}"
    "${base_args[@]}"
    "--app=$url"
    "--user-data-dir=$provider_profile"
    "--window-position=$TIKPAL_WEB_MODE_LEFT_POSITION"
    "--window-size=$(normalize_window_size "$TIKPAL_WEB_MODE_LEFT_WINDOW")"
  )

  if [[ -f "$TIKPAL_WEB_MODE_EXTENSION_DIR/manifest.json" ]]; then
    args+=("--load-extension=$TIKPAL_WEB_MODE_EXTENSION_DIR")
  fi
  if [[ -n "$TIKPAL_WEB_MODE_ALSA_OUTPUT_DEVICE" ]]; then
    args+=("--alsa-output-device=$TIKPAL_WEB_MODE_ALSA_OUTPUT_DEVICE")
  fi
  if [[ "$proxy_enabled" == "1" && -n "$proxy_url" ]]; then
    args+=("--proxy-server=$proxy_url")
  fi

  DISPLAY="$TIKPAL_KIOSK_DISPLAY" "$TIKPAL_CHROMIUM_BIN" "${args[@]}" >/dev/null 2>&1 &
  launch_side_panel
  write_runtime_provider_state "$provider"
  start_window_guard "$provider_profile" "$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel"
  log "opened $provider"
}

check_runtime() {
  log "app dir: $APP_DIR"
  log "display: $TIKPAL_KIOSK_DISPLAY"
  log "chromium: $TIKPAL_CHROMIUM_BIN"
  log "left: $TIKPAL_WEB_MODE_LEFT_POSITION $(normalize_window_size "$TIKPAL_WEB_MODE_LEFT_WINDOW")"
  log "panel: $TIKPAL_WEB_MODE_PANEL_POSITION $(normalize_window_size "$TIKPAL_WEB_MODE_PANEL_WINDOW")"
  log "audio: ${TIKPAL_WEB_MODE_ALSA_OUTPUT_DEVICE:-default}"
  log "window guard: $TIKPAL_WEB_MODE_WINDOW_GUARD"
  log "single provider window: $TIKPAL_WEB_MODE_SINGLE_PROVIDER_WINDOW"
  log "popup blocking: $TIKPAL_WEB_MODE_POPUP_BLOCKING"
  log "extension: $TIKPAL_WEB_MODE_EXTENSION_DIR"
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
    open_provider "${2:-spotify}"
    ;;
  close)
    close_provider_windows
    close_side_panel
    write_runtime_provider_state ""
    log "closed"
    ;;
  keyboard)
    check_runtime
    ensure_onboard
    log "keyboard ready"
    ;;
  *)
    fail "Usage: $0 open <provider>|close|keyboard|--check"
    ;;
esac

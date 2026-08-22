#!/usr/bin/env bash
set -euo pipefail

SCRIPT_SOURCE="${BASH_SOURCE[0]:-$0}"
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_SOURCE")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="${TIKPAL_KIOSK_ENV_FILE:-$APP_DIR/.env.kiosk}"
export TIKPAL_APP_DIR="${TIKPAL_APP_DIR:-$APP_DIR}"
FLAGS_FILE="${TIKPAL_CHROMIUM_FLAGS_FILE:-$SCRIPT_DIR/chromium-flags.conf}"
WEB_MODE_COMMAND_ARGS=("$@")

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
: "${TIKPAL_CHROMIUM_PROFILE_DIR:=$HOME/.config/tikpal-chromium-kiosk}"
: "${TIKPAL_CHROMIUM_ALSA_OUTPUT_DEVICE:=}"
: "${TIKPAL_AUDIO_ADAPT_BIN:=$APP_DIR/deploy/moode/tikpal-audio-adapt.sh}"
: "${TIKPAL_WEB_MODE_PROFILE_ROOT:=$HOME/.config/tikpal-web-mode}"
: "${TIKPAL_WEB_MODE_SETTINGS_PATH:=$APP_DIR/.tikpal/web-mode-settings.json}"
: "${TIKPAL_WEB_MODE_STATE_PATH:=$APP_DIR/.tikpal/web-mode-state.json}"
: "${TIKPAL_WEB_MODE_EXTENSION_DIR:=$SCRIPT_DIR/web-mode-extension}"
: "${TIKPAL_WEB_MODE_EXTENSION_ENABLED:=1}"
: "${TIKPAL_WEB_MODE_EXTENSION_ID:=dlaggcjljagbfgfidblabfdonkemimfe}"
: "${TIKPAL_WEB_MODE_PROXY_APPLY_TIMEOUT_SECONDS:=5}"
: "${TIKPAL_WEB_MODE_PROVIDER_BOOTSTRAP_TIMEOUT_SECONDS:=7}"
: "${TIKPAL_WEB_MODE_PROVIDER_READY_TIMEOUT_SECONDS:=18}"
: "${TIKPAL_WEB_MODE_PROVIDER_WINDOW_TIMEOUT_SECONDS:=30}"
: "${TIKPAL_WEB_MODE_ENTRY_PROVIDER_PAINT_TIMEOUT_SECONDS:=1.5}"
: "${TIKPAL_WEB_MODE_RESIDENT_ENTRY_SETTLE_SECONDS:=0.16}"
: "${TIKPAL_WEB_MODE_RESIDENT_ENTRY_PAINT_SETTLE_SECONDS:=0.5}"
: "${TIKPAL_WEB_MODE_LEFT_WINDOW:=1920x720}"
: "${TIKPAL_WEB_MODE_LEFT_POSITION:=0,0}"
: "${TIKPAL_WEB_MODE_PANEL_WINDOW:=640x720}"
: "${TIKPAL_WEB_MODE_PANEL_POSITION:=1920,0}"
: "${TIKPAL_WEB_MODE_SIDE_PANEL_URL:=http://localhost:4173/side-panel}"
: "${TIKPAL_WEB_MODE_BACKGROUND_URL:=http://127.0.0.1:4173/web-mode-background.html}"
: "${TIKPAL_WEB_MODE_TRANSITION_URL:=http://127.0.0.1:4173/web-mode-transition.html}"
: "${TIKPAL_WEB_MODE_TRANSITION_DEBUG_PORT:=9250}"
: "${TIKPAL_WEB_MODE_TRANSITION_VEIL_READY_TIMEOUT_SECONDS:=3}"
: "${TIKPAL_WEB_MODE_CLOSE_PARK_TIMEOUT_SECONDS:=3}"
: "${TIKPAL_WEB_MODE_ENTRY_STAGE_POSITION:=0,0}"
: "${TIKPAL_WEB_MODE_ENTRY_STAGE_WINDOW:=2560x720}"
: "${TIKPAL_WEB_MODE_ENTRY_REVEAL_SETTLE_SECONDS:=0.45}"
: "${TIKPAL_WEB_MODE_ENTRY_GUARD_INTERVAL_SECONDS:=0.12}"
: "${TIKPAL_WEB_MODE_CLOSE_ACTIVE_PROVIDER:=}"
: "${TIKPAL_WEB_MODE_CLOSE_REQUEST_ID:=}"
: "${TIKPAL_WEB_MODE_OPEN_EXPECTED_ACTIVE_PROVIDER:=}"
: "${TIKPAL_WEB_MODE_STAGE_POSITION:=2560,0}"
: "${TIKPAL_WEB_MODE_STAGE_REVEAL_MS:=650}"
: "${TIKPAL_WEB_MODE_AUDIO_CROSSFADE_ENABLED:=1}"
: "${TIKPAL_WEB_MODE_AUDIO_CROSSFADE_MS:=2000}"
: "${TIKPAL_WEB_MODE_AUDIO_CROSSFADE_HELPER:=$SCRIPT_DIR/../moode/tikpal-web-mode-crossfade.sh}"
: "${TIKPAL_WEB_MODE_CROSSFADE_CARD:=}"
: "${TIKPAL_WEB_MODE_CROSSFADE_PCM_A:=tikpal_explore_a}"
: "${TIKPAL_WEB_MODE_CROSSFADE_PCM_B:=tikpal_explore_b}"
: "${TIKPAL_WEB_MODE_AUDIO_BUS_STATE_PATH:=$TIKPAL_WEB_MODE_PROFILE_ROOT/active-audio-bus}"
: "${TIKPAL_WEB_MODE_LOCK_TIMEOUT_SECONDS:=2}"
: "${TIKPAL_WEB_MODE_X11_SYNC_WINDOW_OPS:=0}"
: "${TIKPAL_WEB_MODE_CLOSE_WARM_ENABLED:=1}"
: "${TIKPAL_WEB_MODE_CLOSE_KEEP_RESIDENT:=1}"
: "${TIKPAL_WEB_MODE_CLOSE_WARM_TTL_SECONDS:=45}"
: "${TIKPAL_WEB_MODE_CLOSE_AUDIO_GATE_SETTLE_SECONDS:=0.35}"
: "${TIKPAL_WEB_MODE_CLOSE_REFILL_PROVIDER_POOL_ENABLED:=1}"
: "${TIKPAL_WEB_MODE_RESIDENT_SWITCH_SETTLE_SECONDS:=0.16}"
: "${TIKPAL_WEB_MODE_RESIDENT_SWITCH_PAINT_TIMEOUT_SECONDS:=0.6}"
: "${TIKPAL_WEB_MODE_RESIDENT_SWITCH_PAINT_POLL_SECONDS:=0.08}"
: "${TIKPAL_WEB_MODE_PROVIDER_SWITCH_FADE_SECONDS:=0.16}"
: "${TIKPAL_WEB_MODE_TRANSITION_MIN_VISIBLE_SECONDS:=0.5}"
: "${TIKPAL_WEB_MODE_ONBOARD_LOCK_TIMEOUT_SECONDS:=8}"
: "${TIKPAL_WEB_MODE_DEFAULT_PROXY_URL:=http://127.0.0.1:7897}"
: "${TIKPAL_WEB_MODE_ONBOARD:=1}"
: "${TIKPAL_WEB_MODE_ONBOARD_AUTO_FOCUS:=1}"
: "${TIKPAL_WEB_MODE_ONBOARD_WINDOW:=900x280}"
: "${TIKPAL_WEB_MODE_ONBOARD_POSITION:=500,420}"
: "${TIKPAL_WEB_MODE_ONBOARD_SUPPRESS_PATH:=$TIKPAL_WEB_MODE_PROFILE_ROOT/onboard-manual-hidden}"
: "${TIKPAL_WEB_MODE_KEYBOARD_TARGET:=auto}"
: "${TIKPAL_WEB_MODE_ALSA_OUTPUT_DEVICE:=${TIKPAL_CHROMIUM_ALSA_OUTPUT_DEVICE:-}}"
: "${TIKPAL_WEB_MODE_WINDOW_GUARD:=1}"
: "${TIKPAL_WEB_MODE_SINGLE_PROVIDER_WINDOW:=1}"
: "${TIKPAL_WEB_MODE_PROVIDER_POOL:=1}"
: "${TIKPAL_WEB_MODE_PROVIDER_IDLE_POOL_ENABLED:=1}"
: "${TIKPAL_WEB_MODE_PROVIDER_PREWARM_ENABLED:=1}"
: "${TIKPAL_WEB_MODE_PROVIDER_PREWARM_CONTINUE_AFTER_CLOSE:=1}"
: "${TIKPAL_WEB_MODE_PROVIDER_PREWARM_DELAY_SECONDS:=0.4}"
: "${TIKPAL_WEB_MODE_PROVIDER_PREWARM_MAX_CONCURRENT_LAUNCHES:=3}"
: "${TIKPAL_WEB_MODE_PROVIDER_PREWARM_LOCK_TIMEOUT_SECONDS:=2}"
: "${TIKPAL_WEB_MODE_PROVIDER_GUARD_IDLE_POLL_MS:=2000}"
: "${TIKPAL_WEB_MODE_DIRECT_PROBE_ENABLED:=1}"
: "${TIKPAL_WEB_MODE_DIRECT_PROBE_TIMEOUT_SECONDS:=4}"
: "${TIKPAL_WEB_MODE_POPUP_BLOCKING:=1}"
: "${TIKPAL_WEB_MODE_PROVIDER_DEBUG_PORT:=9234}"
: "${TIKPAL_WEB_MODE_PROVIDER_GUARD:=1}"
: "${TIKPAL_WEB_MODE_DISABLE_HANG_MONITOR:=1}"
: "${TIKPAL_WEB_MODE_REFRESH_EXTENSION_CACHE:=1}"
: "${TIKPAL_WEB_MODE_ERROR_PAGE_URL:=http://127.0.0.1:4173/web-mode-error.html}"
: "${TIKPAL_WEB_MODE_PROXY_CONNECT_ERROR:=Proxy did not connect. Try again.}"
: "${TIKPAL_WEB_MODE_QQ_AUTO_CONFIRM:=1}"
: "${TIKPAL_WEB_MODE_QQ_AUDIO_PRIME:=1}"
: "${TIKPAL_WEB_MODE_QQ_MUSIC_AUTO_PLAY:=0}"
: "${TIKPAL_WEB_MODE_QQ_MV_AUTO_FULLSCREEN:=0}"
: "${TIKPAL_WEB_MODE_QQ_MV_CINEMA_MODE:=1}"
: "${TIKPAL_WEB_MODE_QQ_MV_AUTO_PLAY:=1}"
: "${TIKPAL_WEB_MODE_NETEASE_AUTO_PLAY:=1}"

if [[ -n "${TIKPAL_WEB_MODE_ONBOARD_ACTION_POSITION:-}" ]]; then
  TIKPAL_WEB_MODE_ONBOARD_POSITION="$TIKPAL_WEB_MODE_ONBOARD_ACTION_POSITION"
fi

if [[ -n "${TIKPAL_WEB_MODE_ONBOARD_ACTION_WINDOW:-}" ]]; then
  TIKPAL_WEB_MODE_ONBOARD_WINDOW="$TIKPAL_WEB_MODE_ONBOARD_ACTION_WINDOW"
fi

export DISPLAY="$TIKPAL_KIOSK_DISPLAY"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"
export GTK_IM_MODULE="${GTK_IM_MODULE:-fcitx}"
export QT_IM_MODULE="${QT_IM_MODULE:-fcitx}"
export XMODIFIERS="${XMODIFIERS:-@im=fcitx}"

log() {
  printf '[tikpal-web-mode] %s\n' "$*"
}

log_stage() {
  log "$@"
  if command -v logger >/dev/null 2>&1; then
    logger -t tikpal-web-mode -- "$*" >/dev/null 2>&1 || true
  fi
}

now_ms() {
  local value
  value="$(date +%s%3N 2>/dev/null || true)"
  if [[ "$value" =~ ^[0-9]+$ ]]; then
    printf '%s\n' "$value"
    return 0
  fi
  node -e 'process.stdout.write(String(Date.now()))'
}

fail() {
  log "ERROR: $*"
  exit 1
}

with_web_mode_lock() {
  if [[ "${TIKPAL_WEB_MODE_LOCKED:-0}" == "1" ]]; then
    "$@"
    return
  fi
  mkdir -p "$TIKPAL_WEB_MODE_PROFILE_ROOT"
  # Kill orphan close-overlay Chromium via PID file only.
  # Do NOT use pgrep/pkill -f which matches parent sh -lc env vars
  # containing the overlay URL and kills the wrong process.
  local _orphan_pid
  _orphan_pid="$(cat "$TIKPAL_WEB_MODE_PROFILE_ROOT/close-overlay-veil.pid" 2>/dev/null || true)"
  if close_overlay_process_matches "$_orphan_pid"; then
    terminate_close_overlay_process "$_orphan_pid" || true
  fi
  rm -f "$TIKPAL_WEB_MODE_PROFILE_ROOT/close-overlay-veil.pid" 2>/dev/null
  rm -rf "$TIKPAL_WEB_MODE_PROFILE_ROOT/close-overlay."* 2>/dev/null
  if command -v flock >/dev/null 2>&1; then
    local lock_status
    # Keep the lock in flock's parent and close its descriptor before the
    # launcher runs. Background veil/probe helpers then cannot inherit it and
    # extend a completed foreground switch indefinitely.
    flock -E 75 -o -x -w "$TIKPAL_WEB_MODE_LOCK_TIMEOUT_SECONDS" \
      "$TIKPAL_WEB_MODE_PROFILE_ROOT/web-mode.lock" \
      env TIKPAL_WEB_MODE_LOCKED=1 "$0" "${WEB_MODE_COMMAND_ARGS[@]}"
    lock_status=$?
    [[ "$lock_status" == "75" ]] && fail "Explore is already switching"
    return "$lock_status"
  fi
  "$@"
}

provider_state_lock_path() {
  printf '%s\n' "$TIKPAL_WEB_MODE_PROFILE_ROOT/provider-state.lock"
}

with_provider_state_lock() {
  if [[ "${TIKPAL_WEB_MODE_PROVIDER_STATE_LOCKED:-0}" == "1" ]]; then
    "$@"
    return
  fi
  mkdir -p "$TIKPAL_WEB_MODE_PROFILE_ROOT"
  if command -v flock >/dev/null 2>&1; then
    (
      flock -x 8
      TIKPAL_WEB_MODE_PROVIDER_STATE_LOCKED=1 "$@"
    ) 8>"$(provider_state_lock_path)"
    return
  fi
  TIKPAL_WEB_MODE_PROVIDER_STATE_LOCKED=1 "$@"
}

with_onboard_lock() {
  mkdir -p "$TIKPAL_WEB_MODE_PROFILE_ROOT"
  if command -v flock >/dev/null 2>&1; then
    (
      flock -x -w "$TIKPAL_WEB_MODE_ONBOARD_LOCK_TIMEOUT_SECONDS" 8 || fail "Onboard is busy"
      "$@"
    ) 8>"$TIKPAL_WEB_MODE_PROFILE_ROOT/onboard.lock"
    return
  fi
  "$@"
}

is_enabled() {
  local value
  value="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  [[ "$value" == "1" || "$value" == "true" || "$value" == "yes" || "$value" == "on" || "$value" == "enabled" ]]
}

detect_non_hdmi_card_id() {
  command -v aplay >/dev/null 2>&1 || return 1
  aplay -l 2>/dev/null | awk '
    /^card [0-9]+:/ {
      line = $0
      lower = tolower(line)
      if (lower ~ /loopback|vc4hdmi|bcm2835|hdmi/) next
      id = line
      sub(/^card [0-9]+: /, "", id)
      sub(/[[:space:]].*$/, "", id)
      gsub(/[^[:alnum:]_-]/, "", id)
      if (id == "") next
      if (lower ~ /usb/) {
        print id
        found = 1
        exit
      }
      if (first == "") first = id
    }
    END {
      if (!found && first != "") print first
    }
  '
}

resolve_physical_alsa_output_device() {
  local value lower card_id
  value="$(printf '%s' "${1:-}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  lower="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"
  case "$lower" in
    ""|default)
      printf '\n'
      ;;
    auto)
      if [[ -x "$TIKPAL_AUDIO_ADAPT_BIN" ]]; then
        if "$TIKPAL_AUDIO_ADAPT_BIN" resolve-browser; then
          return
        fi
        log "WARN: audio adapter failed; falling back to first non-HDMI ALSA card" >&2
      fi
      card_id="$(detect_non_hdmi_card_id || true)"
      if [[ -z "$card_id" ]]; then
        log "WARN: auto ALSA output requested but no non-HDMI card was detected" >&2
        printf '\n'
        return
      fi
      printf 'dmix:CARD=%s,DEV=0\n' "$card_id"
      ;;
    *)
      printf '%s\n' "$value"
      ;;
  esac
}

resolve_web_mode_audio_devices() {
  [[ "${TIKPAL_WEB_MODE_AUDIO_DEVICES_RESOLVED:-0}" == "1" ]] && return 0
  TIKPAL_CHROMIUM_ALSA_OUTPUT_DEVICE="$(resolve_physical_alsa_output_device "$TIKPAL_CHROMIUM_ALSA_OUTPUT_DEVICE")"
  TIKPAL_WEB_MODE_ALSA_OUTPUT_DEVICE="$(resolve_physical_alsa_output_device "$TIKPAL_WEB_MODE_ALSA_OUTPUT_DEVICE")"
  TIKPAL_WEB_MODE_AUDIO_DEVICES_RESOLVED=1
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

provider_ids() {
  printf '%s\n' \
    suno \
    spotify \
    youtube_music \
    apple_music \
    tidal \
    qobuz \
    deezer \
    amazon_music \
    qq_music \
    netease_music
}

# Prewarm order: slow providers first so they get the earliest concurrent
# slots while fast direct-bootstrap providers fill in later.
provider_prewarm_order() {
  printf '%s\n' \
    youtube_music \
    apple_music \
    tidal \
    deezer \
    spotify \
    suno \
    qobuz \
    amazon_music \
    qq_music \
    netease_music
}


provider_uses_direct_bootstrap() {
  case "$1" in
    deezer|qq_music|netease_music) return 0 ;;
    *) return 1 ;;
  esac
}

provider_prefers_direct_proxy() {
  case "$1" in
    qq_music|netease_music) return 0 ;;
    *) return 1 ;;
  esac
}

effective_provider_proxy_enabled() {
  local provider="$1"
  local global_proxy_enabled="${2:-0}"
  if [[ "$global_proxy_enabled" != "1" ]]; then
    printf '0\n'
    return
  fi
  if provider_prefers_direct_proxy "$provider"; then
    printf '0\n'
    return
  fi
  printf '1\n'
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

http_code_is_reachable() {
  local code="$1"
  [[ "$code" =~ ^[1-5][0-9][0-9]$ && "$code" != "000" ]]
}

provider_direct_reachable() {
  local provider="$1"
  local url code timeout
  is_enabled "$TIKPAL_WEB_MODE_DIRECT_PROBE_ENABLED" || return 0
  command -v curl >/dev/null 2>&1 || return 0
  timeout="$TIKPAL_WEB_MODE_DIRECT_PROBE_TIMEOUT_SECONDS"
  [[ "$timeout" =~ ^[0-9]+$ ]] || timeout=4
  url="$(provider_url "$provider")"
  code="$(curl --noproxy '*' -k -I -L -sS -o /dev/null \
    --connect-timeout 2 --max-time "$timeout" -w '%{http_code}' "$url" 2>/dev/null || true)"
  if http_code_is_reachable "$code"; then
    return 0
  fi
  code="$(curl --noproxy '*' -k -L -r 0-0 -sS -o /dev/null \
    --connect-timeout 2 --max-time "$timeout" -w '%{http_code}' "$url" 2>/dev/null || true)"
  http_code_is_reachable "$code"
}

provider_needs_proxy_message() {
  printf '%s needs proxy' "$(provider_label "$1")"
}

urlencode_query() {
  node -e 'process.stdout.write(encodeURIComponent(process.argv[1] || ""))' "$1"
}

read_provider_text_scale() {
  node - "$TIKPAL_WEB_MODE_SETTINGS_PATH" <<'NODE'
const fs = require("node:fs");
const [settingsPath] = process.argv.slice(2);
let settings = {};
try { settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")); } catch {}
const raw = Number(settings.providerTextScale);
const rounded = Math.round(raw * 100) / 100;
const value = [1, 1.1, 1.2].find((candidate) => Math.abs(candidate - rounded) < 0.001) ?? 1.1;
console.log(value.toFixed(2).replace(/\.00$/, ""));
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
  local deadline
  deadline=$((SECONDS + TIKPAL_WEB_MODE_PROVIDER_BOOTSTRAP_TIMEOUT_SECONDS))
  while [[ "$SECONDS" -lt "$deadline" ]]; do
    if provider_cdp_json_list "$provider_port" \
      | node -e 'let body=""; process.stdin.on("data", chunk => body += chunk); process.stdin.on("end", () => { try { process.exit(JSON.parse(body).some(target => target.type === "page" && String(target.url || "").startsWith("https://")) ? 0 : 1); } catch { process.exit(1); } });'; then
      return 0
    fi
    sleep 0.1
  done
  return 1
}

provider_cdp_json_list() {
  local provider_port="$1"
  # Chromium can accept a DevTools connection while its renderer is wedged.
  # This check is part of the foreground switch path, so it must never inherit
  # the API command's much longer timeout.
  # The Gentoo curl accepts only integer --connect-timeout values. Keep the
  # foreground probe bounded below one second without making every resident
  # page look absent on that runtime.
  timeout 0.8 curl --noproxy '*' -sf --connect-timeout 1 --max-time 1 "http://127.0.0.1:$provider_port/json/list" 2>/dev/null
}

pause_provider_media_via_cdp() {
  local provider_port="$1"
  local cdp_json="${2:-}"
  local ws_url
  if [[ -z "$cdp_json" ]]; then
    cdp_json="$(timeout 1 curl --noproxy '*' -sf --connect-timeout 1 --max-time 1 "http://127.0.0.1:$provider_port/json/list" 2>/dev/null)"
  fi
  ws_url="$(printf '%s' "$cdp_json" | node -e 'let b="";process.stdin.on("data",c=>b+=c);process.stdin.on("end",()=>{try{const a=JSON.parse(b);const t=a.find(x=>x.type==="page"&&x.webSocketDebuggerUrl);if(t)process.stdout.write(t.webSocketDebuggerUrl)}catch{}})')"
  [[ -n "$ws_url" ]] || return 1
  node --experimental-websocket -e "                                    \
    const ws = new WebSocket(process.argv[1]);                           \
    ws.addEventListener('open', () => {                                  \
      ws.send(JSON.stringify({id:1, method:'Runtime.evaluate', params:{  \
        expression: '(window.__tikpalProviderAudioGate?.setActive(false) || {}).active', \
        returnByValue: true                                              \
      }}));                                                              \
    });                                                                  \
    ws.addEventListener('message', e => {                                \
      try{const m=JSON.parse(e.data); if(m.id===1){ws.close();process.exit(m.error?1:0)}}catch{} \
    });                                                                  \
    ws.addEventListener('error', () => { try{ws.close()}catch{}; process.exit(1) }); \
    setTimeout(() => { try{ws.close()}catch{}; process.exit(1) }, 2000); \
  " "$ws_url" 2>/dev/null
}

provider_window_has_nonblank_x11_frame() {
  local target_window="$1"
  [[ "$target_window" =~ ^[0-9]+$ ]] || return 1
  command -v ffmpeg >/dev/null 2>&1 || return 1
  # Read the target X11 window itself while the transition veil is still on
  # top.  Sampling the composed left pane made a blank Chromium target look
  # healthy whenever the old provider, transition, or kiosk beneath it was
  # bright.  A flat white/gray first paint has no useful contrast and must
  # remain covered until the already-resident provider redraws.
  DISPLAY="$TIKPAL_KIOSK_DISPLAY" XAUTHORITY="$XAUTHORITY" \
    timeout 1 ffmpeg -hide_banner -loglevel error \
      -f x11grab -window_id "$target_window" -i "$TIKPAL_KIOSK_DISPLAY.0" \
      -frames:v 1 -vf 'scale=96:36:flags=fast_bilinear,format=gray' \
      -f rawvideo - 2>/dev/null \
    | node -e '
      const chunks = [];
      process.stdin.on("data", (chunk) => chunks.push(chunk));
      process.stdin.on("end", () => {
        const pixels = Buffer.concat(chunks);
        if (pixels.length < 512) process.exit(1);
        const stride = Math.max(1, Math.floor(pixels.length / 4096));
        let min = 255, max = 0, sum = 0, count = 0;
        for (let index = 0; index < pixels.length; index += stride) {
          const value = pixels[index];
          min = Math.min(min, value);
          max = Math.max(max, value);
          sum += value;
          count += 1;
        }
        const mean = sum / count;
        let deviation = 0;
        for (let index = 0; index < pixels.length; index += stride) deviation += Math.abs(pixels[index] - mean);
        process.exit(max - min >= 18 && deviation / count >= 3 ? 0 : 1);
      });
    '
}

wait_for_provider_window_nonblank_x11_frame() {
  local target_window="$1"
  local timeout_seconds="$TIKPAL_WEB_MODE_RESIDENT_SWITCH_PAINT_TIMEOUT_SECONDS"
  local poll_seconds="$TIKPAL_WEB_MODE_RESIDENT_SWITCH_PAINT_POLL_SECONDS"
  local deadline
  [[ "$timeout_seconds" =~ ^[0-9]+([.][0-9]+)?$ ]] || timeout_seconds=3
  [[ "$poll_seconds" =~ ^[0-9]+([.][0-9]+)?$ ]] || poll_seconds=0.08
  deadline="$(awk -v now="$(now_ms)" -v timeout="$timeout_seconds" 'BEGIN { printf "%.0f", now + timeout * 1000 }')"
  while (( $(now_ms) < deadline )); do
    provider_window_has_nonblank_x11_frame "$target_window" && return 0
    sleep "$poll_seconds"
  done
  provider_window_has_nonblank_x11_frame "$target_window"
}

# Background probe: check for a non-blank X11 frame while the transition
# veil is still visible.  Writes "1" to a temp file on success so
# reveal_resident_provider_window can skip its synchronous wait.
probe_target_window_background() {
  local target_window="$1"
  local probe_file="$TIKPAL_WEB_MODE_PROFILE_ROOT/.paint-probe-$target_window"
  rm -f "$probe_file"
  (
    if wait_for_provider_window_nonblank_x11_frame "$target_window"; then
      printf '1' > "$probe_file"
    fi
  ) >/dev/null 2>&1 &
}

# Check whether a background paint probe already passed.
check_target_window_probe() {
  local target_window="$1"
  local probe_file="$TIKPAL_WEB_MODE_PROFILE_ROOT/.paint-probe-$target_window"
  [[ -r "$probe_file" ]] && [[ "$(cat "$probe_file" 2>/dev/null)" == "1" ]]
}

# Clean up background probe temp files.
cleanup_target_window_probe() {
  local target_window="$1"
  rm -f "$TIKPAL_WEB_MODE_PROFILE_ROOT/.paint-probe-$target_window"
}

provider_has_real_provider_page() {
  local provider_port="$1"
  provider_cdp_json_list "$provider_port" \
    | node -e 'let body=""; process.stdin.on("data", chunk => body += chunk); process.stdin.on("end", () => { try { process.exit(JSON.parse(body).some(target => target.type === "page" && String(target.url || "").startsWith("https://")) ? 0 : 1); } catch { process.exit(1); } });'
}

provider_friendly_error_reason() {
  local provider_port="$1"
  provider_cdp_json_list "$provider_port" \
    | node -e 'let body=""; process.stdin.on("data", chunk => body += chunk); process.stdin.on("end", () => { try { const target = JSON.parse(body).find(item => { if (item.type !== "page") return false; const url = new URL(String(item.url || "")); return url.pathname.endsWith("/web-mode-error.html"); }); process.stdout.write(target ? new URL(String(target.url)).searchParams.get("reason") || "" : ""); } catch {} });'
}

wait_for_provider_ready() {
  local provider_port="$1"
  local provider="${2:-}"
  local timeout_seconds="${3:-$TIKPAL_WEB_MODE_PROVIDER_READY_TIMEOUT_SECONDS}"
  node --experimental-websocket - "$provider_port" "$timeout_seconds" "$provider" <<'NODE'
const [port, timeoutSeconds, provider] = process.argv.slice(2);
const deadline = Date.now() + Math.max(1, Number(timeoutSeconds) || 18) * 1000;
const readyExpression = `(() => {
  if (!document.body || document.readyState !== "complete") return false;
  const textLength = String(document.body.innerText || "").replace(/\\s+/g, " ").trim().length;
  const candidates = Array.from(document.querySelectorAll("main,nav,header,button,a,input,[role='button'],audio,video")).slice(0, 200);
  const visibleCount = candidates.filter((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0 && rect.width > 2 && rect.height > 2;
  }).length;
  return textLength >= 80 || visibleCount >= 3;
})()`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function evaluate(wsUrl, expression) {
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error("CDP readiness timeout"));
    }, 1000);
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
    });
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      clearTimeout(timer);
      ws.close();
      if (message.error) reject(new Error(message.error.message || "CDP readiness failed"));
      else resolve(message.result?.result?.value === true);
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("CDP readiness websocket failed"));
    });
  });
}

let stableChecks = 0;
while (Date.now() < deadline) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(800) });
    const targets = await response.json();
    const target = targets.find((item) => item.type === "page" && String(item.url || "").startsWith("https://") && item.webSocketDebuggerUrl);
    const isReady = target && await evaluate(target.webSocketDebuggerUrl, readyExpression);
    if (isReady) {
      stableChecks += 1;
      if (stableChecks >= 2) process.exit(0);
    } else {
      stableChecks = 0;
    }
  } catch {
    stableChecks = 0;
  }
  await sleep(200);
}
process.exit(1);
NODE
}

wait_for_entry_provider_paint() {
  local provider_port="$1"
  local provider="${2:-}"
  local target_window="${3:-}"
  local timeout_seconds="${TIKPAL_WEB_MODE_ENTRY_PROVIDER_PAINT_TIMEOUT_SECONDS:-0}"
  [[ "$timeout_seconds" == "0" ]] && return 0
  wait_for_provider_ready "$provider_port" "$provider" "$timeout_seconds" || return 1
  [[ -z "$target_window" ]] || wait_for_provider_window_nonblank_x11_frame "$target_window"
}

navigate_provider_target() {
  local provider_port="$1"
  local target_url="$2"
  node --experimental-websocket - "$provider_port" "$target_url" <<'NODE'
const [port, url] = process.argv.slice(2);

function navigate(wsUrl, targetUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error("CDP navigation timeout"));
    }, 1500);
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ id: 1, method: "Page.navigate", params: { url: targetUrl } }));
    });
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      clearTimeout(timer);
      ws.close();
      if (message.error) reject(new Error(message.error.message || "CDP navigation failed"));
      else resolve();
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("CDP navigation websocket failed"));
    });
  });
}

(async () => {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(800) });
  const targets = await response.json();
  const target = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
  if (!target) throw new Error("No provider page target");
  await navigate(target.webSocketDebuggerUrl, url);
})().catch(() => process.exit(1));
NODE
}

crossfade_helper() {
  TIKPAL_WEB_MODE_ALSA_OUTPUT_DEVICE="$TIKPAL_WEB_MODE_ALSA_OUTPUT_DEVICE" \
  TIKPAL_WEB_MODE_CROSSFADE_CARD="$TIKPAL_WEB_MODE_CROSSFADE_CARD" \
  TIKPAL_WEB_MODE_CROSSFADE_PCM_A="$TIKPAL_WEB_MODE_CROSSFADE_PCM_A" \
  TIKPAL_WEB_MODE_CROSSFADE_PCM_B="$TIKPAL_WEB_MODE_CROSSFADE_PCM_B" \
    "$TIKPAL_WEB_MODE_AUDIO_CROSSFADE_HELPER" "$@"
}

crossfade_available() {
  is_enabled "$TIKPAL_WEB_MODE_AUDIO_CROSSFADE_ENABLED" || return 1
  [[ -n "$TIKPAL_WEB_MODE_ALSA_OUTPUT_DEVICE" ]] || return 1
  [[ -x "$TIKPAL_WEB_MODE_AUDIO_CROSSFADE_HELPER" ]] || return 1
  crossfade_helper check >/dev/null 2>&1
}

profile_audio_bus() {
  local profile="$1"
  local pid command_line
  while IFS= read -r pid; do
    [[ "$pid" =~ ^[0-9]+$ && -r "/proc/$pid/cmdline" ]] || continue
    command_line="$(tr '\0' ' ' < "/proc/$pid/cmdline")"
    if [[ "$command_line" == *"--alsa-output-device=$TIKPAL_WEB_MODE_CROSSFADE_PCM_A"* ]]; then
      printf '%s\n' a
      return 0
    fi
    if [[ "$command_line" == *"--alsa-output-device=$TIKPAL_WEB_MODE_CROSSFADE_PCM_B"* ]]; then
      printf '%s\n' b
      return 0
    fi
  done < <(pgrep -f -- "--user-data-dir=$profile" 2>/dev/null || true)
  return 1
}

write_audio_bus_state() {
  local bus="${1:-}"
  if [[ "$bus" != "a" && "$bus" != "b" ]]; then
    rm -f "$TIKPAL_WEB_MODE_AUDIO_BUS_STATE_PATH"
    return
  fi
  mkdir -p "$(dirname "$TIKPAL_WEB_MODE_AUDIO_BUS_STATE_PATH")"
  printf '%s\n' "$bus" > "$TIKPAL_WEB_MODE_AUDIO_BUS_STATE_PATH"
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
prefs.profile.content_settings = prefs.profile.content_settings && typeof prefs.profile.content_settings === "object"
  ? prefs.profile.content_settings
  : {};
prefs.profile.content_settings.exceptions = prefs.profile.content_settings.exceptions && typeof prefs.profile.content_settings.exceptions === "object"
  ? prefs.profile.content_settings.exceptions
  : {};
const chromeTimestamp = String((BigInt(Date.now()) + 11644473600000n) * 1000n);
const blockLocalNetworkOrigins = [
  "https://suno.com:443,*",
  "https://open.spotify.com:443,*",
  "https://music.youtube.com:443,*",
  "https://music.apple.com:443,*",
  "https://listen.tidal.com:443,*",
  "https://tidal.com:443,*",
  "https://play.qobuz.com:443,*",
  "https://www.deezer.com:443,*",
  "https://music.amazon.com:443,*",
  "https://y.qq.com:443,*",
  "https://music.163.com:443,*"
];
for (const bucketName of ["loopback_network", "local_network", "local_network_access"]) {
  const bucket = prefs.profile.content_settings.exceptions[bucketName] && typeof prefs.profile.content_settings.exceptions[bucketName] === "object"
    ? prefs.profile.content_settings.exceptions[bucketName]
    : {};
  for (const origin of blockLocalNetworkOrigins) {
    bucket[origin] = { last_modified: chromeTimestamp, setting: 2 };
  }
  prefs.profile.content_settings.exceptions[bucketName] = bucket;
}
prefs.profile.cookie_controls_mode = 0;
prefs.profile.block_third_party_cookies = false;
if (prefs.profile.content_settings && typeof prefs.profile.content_settings === "object") {
  if (prefs.profile.content_settings.exceptions && typeof prefs.profile.content_settings.exceptions === "object") {
    delete prefs.profile.content_settings.exceptions.zoomlevels;
  }
}
delete prefs.profile.per_host_zoom_levels;
delete prefs.profile.default_zoom_level;
if (prefs.partition && typeof prefs.partition === "object") {
  delete prefs.partition.default_zoom_level;
}
fs.writeFileSync(prefsPath, `${JSON.stringify(prefs, null, 2)}\n`);
NODE
}

refresh_extension_script_cache() {
  local profile_dir="$1"
  if ! is_enabled "$TIKPAL_WEB_MODE_REFRESH_EXTENSION_CACHE"; then
    return 0
  fi
  rm -rf "$profile_dir/Default/Service Worker"
  node - "$profile_dir" "$TIKPAL_WEB_MODE_EXTENSION_ID" <<'NODE'
const fs = require("fs");
const path = require("path");

const [profileDir, extensionId] = process.argv.slice(2);
const prefsPath = path.join(profileDir, "Default", "Preferences");
if (!profileDir || !extensionId || !fs.existsSync(prefsPath)) process.exit(0);

let prefs;
try {
  prefs = JSON.parse(fs.readFileSync(prefsPath, "utf8"));
} catch {
  process.exit(0);
}

const settings = prefs.extensions?.settings;
const extensionSettings = settings && settings[extensionId];
if (!extensionSettings || typeof extensionSettings !== "object") process.exit(0);

delete extensionSettings.service_worker_registration_info;
delete extensionSettings.serviceworkerevents;

const tmpPath = `${prefsPath}.tmp-${process.pid}`;
fs.writeFileSync(tmpPath, JSON.stringify(prefs));
fs.renameSync(tmpPath, prefsPath);
NODE
}

profile_has_widevine_cdm() {
  local profile_dir="$1"
  [[ -n "$profile_dir" && -d "$profile_dir/WidevineCdm" ]] || return 1
  find "$profile_dir/WidevineCdm" -path "*/_platform_specific/linux_x64/libwidevinecdm.so" -type f -size +1000000c -print -quit 2>/dev/null | grep -q .
}

seed_profile_widevine_cdm() {
  local target_profile="$1"
  local source_profile source_provider
  [[ -n "$target_profile" && -d "$target_profile" ]] || return 0
  profile_has_widevine_cdm "$target_profile" && return 0

  for source_profile in "$TIKPAL_CHROMIUM_PROFILE_DIR" "$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel"; do
    [[ -n "$source_profile" && "$source_profile" != "$target_profile" ]] || continue
    profile_has_widevine_cdm "$source_profile" || continue
    if rm -rf "$target_profile/WidevineCdm" && cp -a "$source_profile/WidevineCdm" "$target_profile/WidevineCdm"; then
      log "seeded Widevine CDM for $(basename "$target_profile") from $(basename "$source_profile")"
      return 0
    fi
  done

  while IFS= read -r source_provider; do
    [[ -n "$source_provider" ]] || continue
    source_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$source_provider"
    [[ "$source_profile" != "$target_profile" ]] || continue
    profile_has_widevine_cdm "$source_profile" || continue
    if rm -rf "$target_profile/WidevineCdm" && cp -a "$source_profile/WidevineCdm" "$target_profile/WidevineCdm"; then
      log "seeded Widevine CDM for $(basename "$target_profile") from $source_provider"
      return 0
    fi
  done < <(provider_ids)

  log "WARN: Widevine CDM is unavailable for $(basename "$target_profile"); protected playback may fail"
  return 0
}

write_runtime_provider_state() {
  with_provider_state_lock write_runtime_provider_state_unlocked "$@"
}

write_runtime_provider_state_unlocked() {
  local provider="$1"
  node - "$TIKPAL_WEB_MODE_STATE_PATH" "$provider" "$(provider_ids | tr '\n' ',' | sed 's/,$//')" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [statePath, provider, providerList] = process.argv.slice(2);
const providerIds = String(providerList || "").split(",").filter(Boolean);
let state = {};
try { state = JSON.parse(fs.readFileSync(statePath, "utf8")); } catch {}
const closeRequestId = String(process.env.TIKPAL_WEB_MODE_CLOSE_REQUEST_ID || "");
const openRequestId = String(process.env.TIKPAL_WEB_MODE_OPEN_REQUEST_ID || "");
const expectedProvider = String(process.env.TIKPAL_WEB_MODE_OPEN_EXPECTED_ACTIVE_PROVIDER || "");
const startupReset = process.env.TIKPAL_WEB_MODE_STARTUP_RESET === "1";
const closeOwnsState = !startupReset && Boolean(state.closeRequestId && !state.activeProvider);
if (closeOwnsState && closeRequestId !== state.closeRequestId) process.exit(0);
if (openRequestId && (state.openRequestId !== openRequestId || state.openingProvider !== expectedProvider || provider !== expectedProvider)) process.exit(0);
const preserveCloseRequest = closeOwnsState && closeRequestId === state.closeRequestId;
state.activeProvider = provider || null;
if (state.activeProvider) state.lastProvider = state.activeProvider;
state.lastError = null;
state.updatedAt = new Date().toISOString();
if (!state.activeProvider) {
  state.closeRequestId = preserveCloseRequest ? closeRequestId : null;
  state.openingProvider = null;
  state.openRequestId = null;
} else {
  state.closeRequestId = null;
  state.openingProvider = null;
  state.openRequestId = null;
  const residentProviders = state.residentProviders && typeof state.residentProviders === "object"
    ? state.residentProviders
    : {};
  for (const id of providerIds) {
    const current = residentProviders[id] && typeof residentProviders[id] === "object"
      ? residentProviders[id]
      : {};
    if (id === state.activeProvider) {
      residentProviders[id] = { ...current, status: "active", lastError: null, updatedAt: state.updatedAt };
    } else if (current.status === "active") {
      // A former active provider has already shown a real provider page. Do
      // not send its card back through the prewarm queue while guards run
      // their later diagnostics.
      residentProviders[id] = { ...current, status: "ready", lastError: null, updatedAt: state.updatedAt };
    }
  }
  state.residentProviders = residentProviders;
}
fs.mkdirSync(path.dirname(statePath), { recursive: true });
const temporaryPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`);
fs.renameSync(temporaryPath, statePath);
NODE
}

write_runtime_provider_status() {
  with_provider_state_lock write_runtime_provider_status_unlocked "$@"
}

write_runtime_prewarm_complete() {
  local complete="$1"
  with_provider_state_lock write_runtime_prewarm_complete_unlocked "$complete"
}

write_runtime_prewarm_complete_unlocked() {
  local complete="$1"
  node - "$TIKPAL_WEB_MODE_STATE_PATH" "$complete" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [statePath, complete] = process.argv.slice(2);
let state = {};
try { state = JSON.parse(fs.readFileSync(statePath, "utf8")); } catch {}
state.prewarmComplete = complete === "1";
state.updatedAt = new Date().toISOString();
fs.mkdirSync(path.dirname(statePath), { recursive: true });
const temporaryPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`);
fs.renameSync(temporaryPath, statePath);
NODE
}

write_runtime_provider_status_unlocked() {
  local provider="$1"
  local status="$2"
  local message="${3:-}"
  node - "$TIKPAL_WEB_MODE_STATE_PATH" "$provider" "$status" "$message" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [statePath, provider, status, message] = process.argv.slice(2);
const allowed = new Set(["opening", "prewarming", "ready", "active", "check_setup", "check_proxy", "region_unavailable", "closed"]);
let state = {};
try { state = JSON.parse(fs.readFileSync(statePath, "utf8")); } catch {}
const closeRequestId = String(process.env.TIKPAL_WEB_MODE_CLOSE_REQUEST_ID || "");
if (state.closeRequestId && !state.activeProvider && closeRequestId !== state.closeRequestId) process.exit(0);
const nextStatus = state.activeProvider === provider && (status === "active" || status === "ready")
  ? "active"
  : status === "active"
    ? "ready"
    : status;
const now = new Date().toISOString();
state.residentProviders = state.residentProviders && typeof state.residentProviders === "object"
  ? state.residentProviders
  : {};
if (provider && allowed.has(nextStatus)) {
  if (nextStatus === "closed") {
    delete state.residentProviders[provider];
  } else {
    state.residentProviders[provider] = {
      ...(state.residentProviders[provider] || {}),
      status: nextStatus,
      lastError: message || null,
      updatedAt: now
    };
  }
}
state.updatedAt = now;
fs.mkdirSync(path.dirname(statePath), { recursive: true });
const temporaryPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`);
fs.renameSync(temporaryPath, statePath);
NODE
}

seed_runtime_provider_pool_statuses() {
  with_provider_state_lock seed_runtime_provider_pool_statuses_unlocked "$@"
}

seed_runtime_provider_pool_statuses_unlocked() {
  local active_provider="$1"
  local seed_mode="${2:-preserve}"
  node - "$TIKPAL_WEB_MODE_STATE_PATH" "$active_provider" "$seed_mode" "$(provider_ids | tr '\n' ',' | sed 's/,$//')" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [statePath, activeProvider, seedMode, providerList] = process.argv.slice(2);
const force = seedMode === "force";
const providerIds = String(providerList || "").split(",").filter(Boolean);
let state = {};
try { state = JSON.parse(fs.readFileSync(statePath, "utf8")); } catch {}
const now = new Date().toISOString();
const residentProviders = state.residentProviders && typeof state.residentProviders === "object"
  ? state.residentProviders
  : {};
for (const provider of providerIds) {
  if (!provider || provider === activeProvider) continue;
  const current = residentProviders[provider] && typeof residentProviders[provider] === "object"
    ? residentProviders[provider]
    : {};
  if (!force && current.status && current.status !== "opening" && current.status !== "closed" && current.status !== "check_proxy") continue;
  residentProviders[provider] = {
    ...current,
    status: "prewarming",
    lastError: null,
    updatedAt: now
  };
}
state.residentProviders = residentProviders;
state.prewarmComplete = false;
state.updatedAt = now;
fs.mkdirSync(path.dirname(statePath), { recursive: true });
const temporaryPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`);
fs.renameSync(temporaryPath, statePath);
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

runtime_close_request_is_current() {
  local close_request_id="${1:-$TIKPAL_WEB_MODE_CLOSE_REQUEST_ID}"
  [[ -z "$close_request_id" ]] && return 0
  node - "$TIKPAL_WEB_MODE_STATE_PATH" "$close_request_id" <<'NODE'
const fs = require("node:fs");
const [statePath, closeRequestId] = process.argv.slice(2);
try {
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  process.exit(state.closeRequestId === closeRequestId && !state.activeProvider ? 0 : 1);
} catch {
  process.exit(1);
}
NODE
}

runtime_open_request_is_current() {
  local expected_provider="${TIKPAL_WEB_MODE_OPEN_EXPECTED_ACTIVE_PROVIDER:-}"
  local open_request_id="${TIKPAL_WEB_MODE_OPEN_REQUEST_ID:-}"
  [[ -z "$expected_provider" ]] && return 0
  node - "$TIKPAL_WEB_MODE_STATE_PATH" "$expected_provider" "$open_request_id" <<'NODE'
const fs = require("node:fs");
const [statePath, expectedProvider, openRequestId] = process.argv.slice(2);
try {
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const ownsRequest = state.openingProvider === expectedProvider
    && (!openRequestId || state.openRequestId === openRequestId)
    && !state.closeRequestId;
  const legacyOwner = !openRequestId && state.activeProvider === expectedProvider && !state.closeRequestId;
  process.exit(ownsRequest || legacyOwner ? 0 : 1);
} catch {
  process.exit(1);
}
NODE
}

read_runtime_provider_status() {
  local provider="$1"
  node - "$TIKPAL_WEB_MODE_STATE_PATH" "$provider" <<'NODE'
const fs = require("node:fs");
const [statePath, provider] = process.argv.slice(2);
try {
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const status = state.residentProviders?.[provider]?.status;
  process.stdout.write(typeof status === "string" ? status : "");
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
  local attempts="${2:-5}"
  local timeout_seconds="${3:-1}"
  local session_bus="${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$(id -u)/bus}"
  local _
  command -v gdbus >/dev/null 2>&1 || return 1
  export DBUS_SESSION_BUS_ADDRESS="$session_bus"
  [[ "$attempts" =~ ^[0-9]+$ ]] || attempts=5
  while [[ "$attempts" -gt 0 ]]; do
    if DISPLAY="$TIKPAL_KIOSK_DISPLAY" DBUS_SESSION_BUS_ADDRESS="$session_bus" \
      timeout "$timeout_seconds" gdbus call --session --dest org.onboard.Onboard \
        --object-path /org/onboard/Onboard/Keyboard \
        --method "org.onboard.Onboard.Keyboard.$method" >/dev/null 2>&1; then
      return 0
    fi
    attempts=$((attempts - 1))
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
      [[ "$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe getwindowname "$window" 2>/dev/null || true)" == "Onboard" ]] || continue
      if command -v xwininfo >/dev/null 2>&1 &&
        DISPLAY="$TIKPAL_KIOSK_DISPLAY" xwininfo -id "$window" 2>/dev/null | grep -q "Class: InputOnly"; then
        continue
      fi
      width="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe getwindowgeometry --shell "$window" 2>/dev/null | awk -F= '$1 == "WIDTH" { print $2 }')"
      height="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe getwindowgeometry --shell "$window" 2>/dev/null | awk -F= '$1 == "HEIGHT" { print $2 }')"
      area=$(( ${width:-0} * ${height:-0} ))
      if (( area > keyboard_area )); then
        keyboard_window="$window"
        keyboard_area="$area"
      fi
    done < <(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe search --name Onboard 2>/dev/null || true)
    if [[ -n "$keyboard_window" ]]; then
      width="$(window_width "$TIKPAL_WEB_MODE_ONBOARD_WINDOW")"
      height="$(window_height "$TIKPAL_WEB_MODE_ONBOARD_WINDOW")"
      DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowmap "$keyboard_window" >/dev/null 2>&1 || true
      DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowsize "$keyboard_window" \
        "$((width - 1))" "$((height - 1))" >/dev/null 2>&1 || true
      sleep 0.2
      DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowsize "$keyboard_window" "$width" "$height" >/dev/null 2>&1 || true
      DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowmove "$keyboard_window" \
        "$(position_x "$TIKPAL_WEB_MODE_ONBOARD_POSITION")" "$(position_y "$TIKPAL_WEB_MODE_ONBOARD_POSITION")" >/dev/null 2>&1 || true
      DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowraise "$keyboard_window" >/dev/null 2>&1 || true
    fi
  fi

  if command -v wmctrl >/dev/null 2>&1 && [[ -n "$keyboard_window" ]]; then
    DISPLAY="$TIKPAL_KIOSK_DISPLAY" wmctrl -i -r "$keyboard_window" -b add,above >/dev/null 2>&1 || true
  fi
}

onboard_visible_windows() {
  local window
  command -v xdotool >/dev/null 2>&1 || return 1
  while IFS= read -r window; do
    [[ -n "$window" ]] || continue
    [[ "$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe getwindowname "$window" 2>/dev/null || true)" == "Onboard" ]] || continue
    if command -v xwininfo >/dev/null 2>&1 &&
      DISPLAY="$TIKPAL_KIOSK_DISPLAY" xwininfo -id "$window" 2>/dev/null | grep -q "Class: InputOnly"; then
      continue
    fi
    printf '%s\n' "$window"
  done < <(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe search --onlyvisible --name Onboard 2>/dev/null || true)
}

raise_onboard() {
  local window
  command -v xdotool >/dev/null 2>&1 || return 0
  while IFS= read -r window; do
    [[ -n "$window" ]] || continue
    DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowraise "$window" >/dev/null 2>&1 || true
    if command -v wmctrl >/dev/null 2>&1; then
      DISPLAY="$TIKPAL_KIOSK_DISPLAY" wmctrl -i -r "$window" -b add,above >/dev/null 2>&1 || true
    fi
  done < <(onboard_visible_windows)
}

move_onboard_if_requested() {
  local area height keyboard_area=0 keyboard_window="" window width
  is_enabled "$TIKPAL_WEB_MODE_ONBOARD" || return 0
  is_enabled "${TIKPAL_WEB_MODE_ONBOARD_REQUESTED_POSITION:-0}" || return 0
  command -v xdotool >/dev/null 2>&1 || return 0
  pgrep -u "$(id -u)" -x onboard >/dev/null 2>&1 || return 0

  while IFS= read -r window; do
    [[ -n "$window" ]] || continue
    [[ "$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe getwindowname "$window" 2>/dev/null || true)" == "Onboard" ]] || continue
    if command -v xwininfo >/dev/null 2>&1 &&
      DISPLAY="$TIKPAL_KIOSK_DISPLAY" xwininfo -id "$window" 2>/dev/null | grep -q "Class: InputOnly"; then
      continue
    fi
    width="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe getwindowgeometry --shell "$window" 2>/dev/null | awk -F= '$1 == "WIDTH" { print $2 }')"
    height="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe getwindowgeometry --shell "$window" 2>/dev/null | awk -F= '$1 == "HEIGHT" { print $2 }')"
    area=$(( ${width:-0} * ${height:-0} ))
    if (( area > keyboard_area )); then
      keyboard_window="$window"
      keyboard_area="$area"
    fi
  done < <(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe search --onlyvisible --name Onboard 2>/dev/null || true)

  [[ -n "$keyboard_window" ]] || return 0
  width="$(window_width "$TIKPAL_WEB_MODE_ONBOARD_WINDOW")"
  height="$(window_height "$TIKPAL_WEB_MODE_ONBOARD_WINDOW")"
  DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowsize "$keyboard_window" "$width" "$height" >/dev/null 2>&1 || true
  DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowmove "$keyboard_window" \
    "$(position_x "$TIKPAL_WEB_MODE_ONBOARD_POSITION")" "$(position_y "$TIKPAL_WEB_MODE_ONBOARD_POSITION")" >/dev/null 2>&1 || true
  DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowraise "$keyboard_window" >/dev/null 2>&1 || true
  if command -v wmctrl >/dev/null 2>&1; then
    DISPLAY="$TIKPAL_KIOSK_DISPLAY" wmctrl -i -r "$keyboard_window" -b add,above >/dev/null 2>&1 || true
  fi
}

install_onboard_ime_toggle_script() {
  local source_script="$SCRIPT_DIR/onboard-scripts/tikpalImeToggle.py"
  local target_dir="/usr/share/onboard/scripts"
  local target_script="$target_dir/tikpalImeToggle.py"
  [[ -f "$source_script" ]] || return 1

  if [[ -r "$target_script" ]] && cmp -s "$source_script" "$target_script"; then
    return 0
  fi

  if [[ -w "$target_dir" ]]; then
    install -m 0755 "$source_script" "$target_script"
    return 0
  fi

  if command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
    sudo install -m 0755 "$source_script" "$target_script"
    return 0
  fi

  return 1
}

install_onboard_ime_color_scheme() {
  local source_scheme="$SCRIPT_DIR/onboard-themes/Tikpal-Classic.colors"
  local target_dir="${XDG_DATA_HOME:-$HOME/.local/share}/onboard/themes"
  local target_scheme="$target_dir/Tikpal-Classic.colors"
  [[ -f "$source_scheme" ]] || return 1
  mkdir -p "$target_dir"
  install -m 0644 "$source_scheme" "$target_scheme"
}

configure_onboard_input_method_key() {
  local source_dir="/usr/share/onboard/layouts"
  local target_dir="${XDG_DATA_HOME:-$HOME/.local/share}/onboard/layouts"
  local target_theme_dir="${XDG_DATA_HOME:-$HOME/.local/share}/onboard/themes"
  local target_en_layout="$target_dir/Tikpal-Compact-EN.onboard"
  local target_pinyin_layout="$target_dir/Tikpal-Compact-Pinyin.onboard"
  local target_german_layout="$target_dir/Tikpal-Compact-German.onboard"
  local target_italian_layout="$target_dir/Tikpal-Compact-Italian.onboard"
  local target_korean_layout="$target_dir/Tikpal-Compact-Korean.onboard"
  local target_japanese_layout="$target_dir/Tikpal-Compact-Japanese.onboard"
  local target_spanish_layout="$target_dir/Tikpal-Compact-Spanish.onboard"
  local target_color_scheme="$target_theme_dir/Tikpal-Classic.colors"

  if ! command -v fcitx5-remote >/dev/null 2>&1 \
    || [[ ! -f "$source_dir/Compact.onboard" ]] \
    || [[ ! -f "$source_dir/Compact-Alpha.svg" ]] \
    || [[ ! -f "$source_dir/Compact-Numbers.svg" ]] \
    || [[ ! -f "$source_dir/Compact-Utils.svg" ]]; then
    gsettings reset org.onboard layout >/dev/null 2>&1 || true
    gsettings set org.onboard.theme-settings color-scheme "/usr/share/onboard/themes/Classic Onboard.colors" >/dev/null 2>&1 || true
    gsettings reset org.onboard key-label-overrides >/dev/null 2>&1 || true
    return 0
  fi

  if ! install_onboard_ime_toggle_script; then
    log "WARN: Onboard IME toggle script could not be installed; using F9 fallback"
  fi
  if ! install_onboard_ime_color_scheme; then
    log "WARN: Tikpal Onboard IME color scheme could not be installed; using default Onboard colors"
  fi

  mkdir -p "$target_dir"
  cp -f "$source_dir/Compact-Alpha.svg" "$source_dir/Compact-Numbers.svg" \
    "$source_dir/Compact-Utils.svg" "$target_dir/"
  if ! python3 - "$source_dir/Compact.onboard" "$target_en_layout" "$target_pinyin_layout" "$target_german_layout" "$target_italian_layout" "$target_korean_layout" "$target_japanese_layout" "$target_spanish_layout" <<'PY'
from __future__ import annotations

import sys
import xml.etree.ElementTree as ET

source, en_path, pinyin_path, german_path, italian_path, korean_path, japanese_path, spanish_path = sys.argv[1:]

variants = [
    {
        "path": en_path,
        "ime_label": "EN",
        "ime_theme": "TIKPAL-IME-INACTIVE",
        "key_theme": "TIKPAL-KEY-EN",
        "labels": {"SPCE": "Space"},
    },
    {
        "path": pinyin_path,
        "ime_label": "中文",
        "ime_theme": "TIKPAL-IME-ACTIVE",
        "key_theme": "TIKPAL-KEY-PINYIN",
        "labels": {"SPCE": "空格", "RTRN": "↵"},
    },
    {
        "path": german_path,
        "ime_label": "DE",
        "ime_theme": "TIKPAL-IME-ACTIVE",
        "key_theme": "TIKPAL-KEY-GERMAN",
        "labels": {
            "TLDE": "^ °",
            "AE02": '2 "',
            "AE03": "3 §",
            "AE06": "6 &",
            "AE07": "7 /",
            "AE08": "8 (",
            "AE09": "9 )",
            "AE10": "0 =",
            "AE11": "ß ?",
            "AE12": "´ `",
            "AD06": "Z",
            "AD11": "Ü",
            "AD12": "+ *",
            "AC10": "Ö",
            "AC11": "Ä",
            "BKSL": "# '",
            "LSGT": "< >",
            "AB01": "Y",
            "AB08": ", ;",
            "AB09": ". :",
            "AB10": "- _",
            "SPCE": "Leertaste",
            "RTRN": "Enter",
        },
    },
    {
        "path": italian_path,
        "ime_label": "IT",
        "ime_theme": "TIKPAL-IME-ACTIVE",
        "key_theme": "TIKPAL-KEY-ITALIAN",
        "labels": {
            "TLDE": "\\ |",
            "AE02": '2 "',
            "AE03": "3 £",
            "AE06": "6 &",
            "AE07": "7 /",
            "AE08": "8 (",
            "AE09": "9 )",
            "AE10": "0 =",
            "AE11": "' ?",
            "AE12": "ì ^",
            "AD11": "è é",
            "AD12": "+ *",
            "AC10": "ò ç",
            "AC11": "à °",
            "BKSL": "ù §",
            "LSGT": "< >",
            "AB08": ", ;",
            "AB09": ". :",
            "AB10": "- _",
            "SPCE": "Spazio",
            "RTRN": "Invio",
        },
    },
    {
        "path": korean_path,
        "ime_label": "한국어",
        "ime_theme": "TIKPAL-IME-ACTIVE",
        "key_theme": "TIKPAL-KEY-KOREAN",
        "labels": {
            "AD01": "ㅂ",
            "AD02": "ㅈ",
            "AD03": "ㄷ",
            "AD04": "ㄱ",
            "AD05": "ㅅ",
            "AD06": "ㅛ",
            "AD07": "ㅕ",
            "AD08": "ㅑ",
            "AD09": "ㅐ",
            "AD10": "ㅔ",
            "AC01": "ㅁ",
            "AC02": "ㄴ",
            "AC03": "ㅇ",
            "AC04": "ㄹ",
            "AC05": "ㅎ",
            "AC06": "ㅗ",
            "AC07": "ㅓ",
            "AC08": "ㅏ",
            "AC09": "ㅣ",
            "AB01": "ㅋ",
            "AB02": "ㅌ",
            "AB03": "ㅊ",
            "AB04": "ㅍ",
            "AB05": "ㅠ",
            "AB06": "ㅜ",
            "AB07": "ㅡ",
            "SPCE": "스페이스",
            "RTRN": "확인",
        },
    },
    {
        "path": japanese_path,
        "ime_label": "日本語",
        "ime_theme": "TIKPAL-IME-ACTIVE",
        "key_theme": "TIKPAL-KEY-JAPANESE",
        "labels": {"SPCE": "変換", "RTRN": "確定"},
    },
    {
        "path": spanish_path,
        "ime_label": "ES",
        "ime_theme": "TIKPAL-IME-ACTIVE",
        "key_theme": "TIKPAL-KEY-SPANISH",
        "labels": {
            "TLDE": "º ª",
            "AE11": "' ?",
            "AE12": "¡ ¿",
            "AD11": "` ^",
            "AD12": "+ *",
            "AC10": "Ñ",
            "AC11": "´ ¨",
            "BKSL": "Ç",
            "LSGT": "< >",
            "AB08": ", ;",
            "AB09": ". :",
            "AB10": "- _",
            "SPCE": "Espacio",
            "RTRN": "Intro",
        },
    },
]


def patch_key(key: ET.Element, variant: dict[str, object]) -> None:
    key_id = key.attrib.get("id", "")
    group = key.attrib.get("group", "")
    key_theme = str(variant["key_theme"])

    if group == "alphanumeric":
        key.set("theme_id", key_theme)

    if group == "bottomrow" and key_id == "move":
        key.set("theme_id", "TIKPAL-KEY-MOVE")

    if group == "bottomrow" and key_id == "LWIN":
        key.set("id", "TIKPAL-IME")
        key.set("svg_id", "LWIN")
        key.set("theme_id", str(variant["ime_theme"]))
        key.set("label", str(variant["ime_label"]))
        key.set("script", "tikpalImeToggle")
        return

    labels = variant["labels"]
    if key_id in labels:
        key.set("label", str(labels[key_id]))
        if key_id in {"SPCE", "RTRN"}:
            key.set("theme_id", key_theme)


for variant in variants:
    tree = ET.parse(source)
    root = tree.getroot()
    for key in root.iter("key"):
        patch_key(key, variant)
    tree.write(variant["path"], encoding="utf-8", xml_declaration=True)
PY
  then
    gsettings reset org.onboard layout >/dev/null 2>&1 || true
    gsettings set org.onboard.theme-settings color-scheme "/usr/share/onboard/themes/Classic Onboard.colors" >/dev/null 2>&1 || true
    gsettings reset org.onboard key-label-overrides >/dev/null 2>&1 || true
    return 0
  fi
  if [[ -f "$target_color_scheme" ]]; then
    gsettings set org.onboard.theme-settings color-scheme "$target_color_scheme" >/dev/null 2>&1 || true
  fi
  gsettings set org.onboard layout "$target_en_layout" >/dev/null 2>&1 || true
  gsettings reset org.onboard key-label-overrides >/dev/null 2>&1 || true
  python3 /usr/share/onboard/scripts/tikpalImeToggle.py --sync >/dev/null 2>&1 || true
}

sync_onboard_input_method_visual() {
  [[ -f /usr/share/onboard/scripts/tikpalImeToggle.py ]] || return 0
  python3 /usr/share/onboard/scripts/tikpalImeToggle.py --sync >/dev/null 2>&1 || true
}

configure_onboard_visibility() {
  command -v gsettings >/dev/null 2>&1 || return 0
  local session_bus
  session_bus="${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$(id -u)/bus}"
  export DBUS_SESSION_BUS_ADDRESS="$session_bus"
  gsettings set org.onboard.window docking-enabled false >/dev/null 2>&1 || true
  gsettings set org.onboard.window force-to-top true >/dev/null 2>&1 || true
  gsettings set org.onboard.window window-state-sticky true >/dev/null 2>&1 || true
  gsettings set org.onboard show-status-icon false >/dev/null 2>&1 || true
  gsettings set org.onboard.icon-palette in-use false >/dev/null 2>&1 || true
  gsettings set org.onboard.auto-show enabled false >/dev/null 2>&1 || true
  gsettings set org.onboard.auto-show hide-on-key-press false >/dev/null 2>&1 || true
  gsettings set org.onboard.window enable-inactive-transparency false >/dev/null 2>&1 || true
  gsettings set org.onboard.window inactive-transparency 0.0 >/dev/null 2>&1 || true
  gsettings set org.onboard.window transparency 0.0 >/dev/null 2>&1 || true
  gsettings set org.onboard.keyboard input-event-source XInput >/dev/null 2>&1 || true
  gsettings set org.onboard.keyboard key-synth XTest >/dev/null 2>&1 || true
}

configure_onboard() {
  command -v gsettings >/dev/null 2>&1 || return 0
  local height session_bus width x y
  session_bus="${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$(id -u)/bus}"
  export DBUS_SESSION_BUS_ADDRESS="$session_bus"
  width="$(window_width "$TIKPAL_WEB_MODE_ONBOARD_WINDOW")"
  height="$(window_height "$TIKPAL_WEB_MODE_ONBOARD_WINDOW")"
  x="$(position_x "$TIKPAL_WEB_MODE_ONBOARD_POSITION")"
  y="$(position_y "$TIKPAL_WEB_MODE_ONBOARD_POSITION")"
  configure_onboard_visibility
  gsettings set org.onboard.window.landscape width "$width" >/dev/null 2>&1 || true
  gsettings set org.onboard.window.landscape height "$height" >/dev/null 2>&1 || true
  gsettings set org.onboard.window.landscape x "$x" >/dev/null 2>&1 || true
  gsettings set org.onboard.window.landscape y "$y" >/dev/null 2>&1 || true
  configure_onboard_input_method_key
}

window_uses_profile() {
  local cmdline pid profile="$1" window="$2"
  [[ -n "$profile" ]] || return 1
  pid="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe getwindowpid "$window" 2>/dev/null || true)"
  [[ -n "$pid" ]] || return 1
  cmdline="$(tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null || true)"
  [[ "$cmdline" == *"--user-data-dir=$profile"* ]]
}

kiosk_browser_window() {
  local window
  command -v xdotool >/dev/null 2>&1 || return 1
  [[ -n "$TIKPAL_CHROMIUM_PROFILE_DIR" ]] || return 1
  while IFS= read -r window; do
    [[ -n "$window" ]] || continue
    if window_uses_profile "$TIKPAL_CHROMIUM_PROFILE_DIR" "$window"; then
      printf '%s\n' "$window"
      return 0
    fi
  done < <(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe search --onlyvisible --class chromium 2>/dev/null || true)
  return 1
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
    done < <(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe search --onlyvisible --class chromium 2>/dev/null || true)
  fi
  window="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe getactivewindow 2>/dev/null || true)"
  if [[ -n "$window" ]]; then
    printf '%s\n' "$window"
    return 0
  fi
  while IFS= read -r window; do
    [[ -n "$window" ]] || continue
    width="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe getwindowgeometry --shell "$window" 2>/dev/null | awk -F= '$1 == "WIDTH" { print $2 }')"
    height="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe getwindowgeometry --shell "$window" 2>/dev/null | awk -F= '$1 == "HEIGHT" { print $2 }')"
    area=$(( ${width:-0} * ${height:-0} ))
    if (( area > best_area )); then
      best_window="$window"
      best_area="$area"
    fi
  done < <(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe search --onlyvisible --class chromium 2>/dev/null || true)
  [[ -n "$best_window" ]] && printf '%s\n' "$best_window"
}

focus_window() {
  local window="$1"
  [[ -n "$window" ]] || return 0
  command -v xdotool >/dev/null 2>&1 || return 0
  DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowfocus "$window" >/dev/null 2>&1 || true
  if [[ -z "$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe getactivewindow 2>/dev/null || true)" ]]; then
    DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowactivate "$window" >/dev/null 2>&1 || true
  fi
}

restore_local_kiosk_keyboard_focus() {
  local target window
  target="$(printf '%s' "${TIKPAL_WEB_MODE_KEYBOARD_TARGET:-auto}" | tr '[:upper:]' '[:lower:]')"
  [[ "$target" == "kiosk" ]] || return 0
  window="$(kiosk_browser_window || true)"
  [[ -n "$window" ]] || return 0
  focus_window "$window"
}

start_onboard_process() {
  local onboard_bin session_bus
  onboard_bin="$(command -v onboard 2>/dev/null || true)"
  [[ -n "$onboard_bin" ]] || return 1
  session_bus="${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$(id -u)/bus}"
  export DBUS_SESSION_BUS_ADDRESS="$session_bus"

  if systemctl --user cat tikpal-onboard.service >/dev/null 2>&1; then
    systemctl --user reset-failed tikpal-onboard.service >/dev/null 2>&1 || true
    systemctl --user start tikpal-onboard.service >/dev/null 2>&1 && return 0
  fi

  systemd-run --user --quiet --unit=tikpal-onboard \
    --setenv="DISPLAY=$TIKPAL_KIOSK_DISPLAY" --setenv="DBUS_SESSION_BUS_ADDRESS=$session_bus" \
    "$onboard_bin" >/dev/null 2>&1 && return 0

  DISPLAY="$TIKPAL_KIOSK_DISPLAY" DBUS_SESSION_BUS_ADDRESS="$session_bus" nohup "$onboard_bin" >/dev/null 2>&1 &
}

ensure_onboard() {
  is_enabled "$TIKPAL_WEB_MODE_ONBOARD" || return 0
  [[ ! -e "$TIKPAL_WEB_MODE_ONBOARD_SUPPRESS_PATH" ]] || return 0
  command -v onboard >/dev/null 2>&1 || {
    log "WARN: onboard not found"
    return 0
  }

  if ! pgrep -u "$(id -u)" -x onboard >/dev/null 2>&1; then
    configure_onboard
    start_onboard_process
    sleep 0.8
  else
    configure_onboard
  fi

  sync_onboard_input_method_visual
  call_onboard_method Show || true
  sleep 0.2
  call_onboard_method Show || true
  sleep 0.1
  raise_onboard
  move_onboard_if_requested
  restore_local_kiosk_keyboard_focus
}

preload_onboard() {
  is_enabled "$TIKPAL_WEB_MODE_ONBOARD" || return 0
  command -v onboard >/dev/null 2>&1 || {
    log "WARN: onboard not found"
    return 0
  }
  configure_onboard

  if ! pgrep -u "$(id -u)" -x onboard >/dev/null 2>&1; then
    start_onboard_process
    sleep 0.8
  fi

  hide_onboard
}

hide_onboard() {
  is_enabled "$TIKPAL_WEB_MODE_ONBOARD" || return 0
  pgrep -u "$(id -u)" -x onboard >/dev/null 2>&1 || return 0
  [[ -n "$(onboard_visible_windows)" ]] || return 0
  call_onboard_method Hide 1 0.35 || true
}

toggle_onboard() {
  is_enabled "$TIKPAL_WEB_MODE_ONBOARD" || return 0
  if ! pgrep -u "$(id -u)" -x onboard >/dev/null 2>&1 || [[ -z "$(onboard_visible_windows)" ]]; then
    rm -f "$TIKPAL_WEB_MODE_ONBOARD_SUPPRESS_PATH"
    ensure_onboard
    return
  fi
  mkdir -p "$(dirname "$TIKPAL_WEB_MODE_ONBOARD_SUPPRESS_PATH")"
  touch "$TIKPAL_WEB_MODE_ONBOARD_SUPPRESS_PATH"
  hide_onboard
}

force_onboard() {
  rm -f "$TIKPAL_WEB_MODE_ONBOARD_SUPPRESS_PATH"
  ensure_onboard
}

keepalive_onboard() {
  is_enabled "$TIKPAL_WEB_MODE_ONBOARD" || return 0
  rm -f "$TIKPAL_WEB_MODE_ONBOARD_SUPPRESS_PATH"
  if ! pgrep -u "$(id -u)" -x onboard >/dev/null 2>&1; then
    return
  fi
  [[ -n "$(onboard_visible_windows)" ]] || return 0
  raise_onboard || true
  restore_local_kiosk_keyboard_focus
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
    pid="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe getwindowpid "$window" 2>/dev/null || true)"
    if process_tree_uses_profile "$pid" "$panel_profile"; then
      return 0
    fi
  done < <(visible_chromium_windows)
  return 1
}

window_guard_pid_file() {
  printf '%s\n' "$TIKPAL_WEB_MODE_PROFILE_ROOT/window-guard.pid"
}

provider_switch_marker_path() {
  printf '%s\n' "$TIKPAL_WEB_MODE_PROFILE_ROOT/provider-switch.pid"
}

begin_provider_switch_guard() {
  local marker
  marker="$(provider_switch_marker_path)"
  mkdir -p "$(dirname "$marker")"
  printf '%s\n' "$BASHPID" > "$marker"
}

provider_switch_in_progress() {
  local marker pid
  marker="$(provider_switch_marker_path)"
  [[ -r "$marker" ]] || return 1
  pid="$(cat "$marker" 2>/dev/null || true)"
  if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" >/dev/null 2>&1; then
    return 0
  fi
  rm -f "$marker"
  return 1
}

clear_provider_switch_guard() {
  local marker pid
  marker="$(provider_switch_marker_path)"
  [[ -r "$marker" ]] || return 0
  pid="$(cat "$marker" 2>/dev/null || true)"
  if [[ "$pid" == "$BASHPID" ]]; then
    rm -f "$marker"
  fi
  # A stale marker belongs to an already-finished switch. It is harmless here
  # and must not turn an otherwise successful provider open into a shell error.
  return 0
}


prewarm_pid_file() {
  printf '%s\n' "$TIKPAL_WEB_MODE_PROFILE_ROOT/provider-prewarm.pid"
}

prewarm_active_provider_file() {
  printf '%s\n' "$TIKPAL_WEB_MODE_PROFILE_ROOT/provider-prewarm.active-provider"
}


pool_warm_stamp_file() {
  printf '%s\n' "$TIKPAL_WEB_MODE_PROFILE_ROOT/pool-warm.stamp"
}
provider_pool_needs_prewarm() {
  local active_provider="${1:-}"
  local provider profile provider_port friendly_error_reason
  is_enabled "$TIKPAL_WEB_MODE_PROVIDER_POOL" || return 1
  is_enabled "$TIKPAL_WEB_MODE_PROVIDER_PREWARM_ENABLED" || return 1
  while IFS= read -r provider; do
    [[ -n "$provider" && "$provider" != "$active_provider" ]] || continue
    profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$provider"
    profile_process_exists "$profile" || return 0
    provider_port="$(provider_debug_port "$provider")"
    # A resident pool is warm once CDP has exposed the provider's real HTTPS
    # page. Full DOM readiness belongs to foreground cold starts only.
    if provider_has_real_provider_page "$provider_port"; then
      continue
    fi
    friendly_error_reason="$(provider_friendly_error_reason "$provider_port")"
    [[ "$friendly_error_reason" == "region_unavailable" ]] || return 0
  done < <(provider_ids)
  return 1
}

sync_runtime_provider_pool_process_statuses() {
  local active_provider="${1:-}"
  local allow_active_clear="${2:-1}"
  local provider profile provider_port status friendly_error_reason
  is_enabled "$TIKPAL_WEB_MODE_PROVIDER_POOL" || return 0
  while IFS= read -r provider; do
    [[ -n "$provider" ]] || continue
    [[ "$(read_runtime_active_provider)" == "$active_provider" ]] || {
      log "reconcile abandoned: active provider changed from $active_provider"
      return 0
    }
    profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$provider"
    provider_port="$(provider_debug_port "$provider")"
    if profile_process_exists "$profile"; then
      if provider_has_real_provider_page "$provider_port"; then
        if [[ "$provider" == "$active_provider" ]]; then
          write_runtime_provider_status "$provider" "active"
        else
          # Do not make a confirmed real page wait on a slow DOM probe, or let
          # an asynchronous guard demote it back to Prewarming.
          write_runtime_provider_status "$provider" "ready"
        fi
        continue
      fi
      friendly_error_reason="$(provider_friendly_error_reason "$provider_port")"
      if [[ "$friendly_error_reason" == "region_unavailable" ]]; then
        write_runtime_provider_status "$provider" "region_unavailable" "$(provider_label "$provider") is unavailable in the current Proxy region"
        continue
      fi
      status="$(read_runtime_provider_status "$provider")"
      if [[ "$provider" == "$active_provider" ]]; then
        write_runtime_provider_status "$provider" "check_setup" "$(provider_label "$provider") did not enter the provider page"
        if [[ "$allow_active_clear" == "1" ]]; then
          write_runtime_provider_state ""
        else
          log "reconcile retained active provider $provider after stale-page status"
        fi
      elif [[ "$status" == "ready" || "$status" == "active" ]]; then
        write_runtime_provider_status "$provider" "check_setup" "$(provider_label "$provider") did not enter the provider page"
      elif [[ "$status" == "prewarming" ]]; then
        # Process exists but page never materialised; the prewarm is stuck.
        write_runtime_provider_status "$provider" "check_setup" "$(provider_label "$provider") did not enter the provider page"
      elif [[ -z "$status" ]]; then
        write_runtime_provider_status "$provider" "prewarming"
      fi
      continue
    fi
    status="$(read_runtime_provider_status "$provider")"
    if [[ "$status" == "ready" || "$status" == "active" || "$status" == "opening" || "$status" == "prewarming" ]]; then
      write_runtime_provider_status "$provider" "closed"
    fi
  done < <(provider_ids)
}

reconcile_provider_pool_in_background() {
  local active_provider="$1"
  local started_ms elapsed_ms
  is_enabled "$TIKPAL_WEB_MODE_PROVIDER_POOL" || return 0
  [[ -n "$active_provider" ]] || return 0
  started_ms="$(now_ms)"
  if command -v setsid >/dev/null 2>&1; then
    setsid "$SCRIPT_DIR/tikpal-web-mode.sh" reconcile "$active_provider" "$started_ms" </dev/null >/dev/null 2>&1 9>&- &
  else
    nohup "$SCRIPT_DIR/tikpal-web-mode.sh" reconcile "$active_provider" "$started_ms" </dev/null >/dev/null 2>&1 9>&- &
  fi
}

reconcile_provider_pool() {
  local active_provider="$1"
  local started_ms="${2:-$(now_ms)}"
  local elapsed_ms provider_profile proxy_line proxy_enabled
  provider_switch_in_progress && {
    elapsed_ms="$(( $(now_ms) - started_ms ))"
    log_stage "reconcile_ms=$elapsed_ms provider=$active_provider abandoned=switching"
    return 0
  }
  [[ "$(read_runtime_active_provider)" == "$active_provider" ]] || {
    elapsed_ms="$(( $(now_ms) - started_ms ))"
    log_stage "reconcile_ms=$elapsed_ms provider=$active_provider abandoned=1"
    return 0
  }
  provider_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$active_provider"
  provider_switch_in_progress && {
    elapsed_ms="$(( $(now_ms) - started_ms ))"
    log_stage "reconcile_ms=$elapsed_ms provider=$active_provider abandoned=switching"
    return 0
  }
  reassert_visible_provider_surfaces "$(first_window_for_profile "$provider_profile" || true)" "$provider_profile" "$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel"
  proxy_line="$(read_proxy_settings)"
  proxy_enabled="$(effective_provider_proxy_enabled "$active_provider" "${proxy_line%%$'\t'*}")"
  start_provider_guard "$active_provider" "$provider_profile" "$(provider_url "$active_provider")" "$proxy_enabled" "$(provider_debug_port "$active_provider")"
  if provider_prewarm_queue_running; then
    elapsed_ms="$(( $(now_ms) - started_ms ))"
    log_stage "reconcile_ms=$elapsed_ms provider=$active_provider pool=prewarming"
    return 0
  fi
  if [[ -f "$(pool_warm_stamp_file)" ]]; then
    elapsed_ms="$(( $(now_ms) - started_ms ))"
    log_stage "reconcile_ms=$elapsed_ms provider=$active_provider pool=trusted"
    return 0
  fi
  sync_runtime_provider_pool_process_statuses "$active_provider" 0
  [[ "$(read_runtime_active_provider)" == "$active_provider" ]] || {
    elapsed_ms="$(( $(now_ms) - started_ms ))"
    log_stage "reconcile_ms=$elapsed_ms provider=$active_provider abandoned=1"
    return 0
  }
  provider_switch_in_progress && {
    elapsed_ms="$(( $(now_ms) - started_ms ))"
    log_stage "reconcile_ms=$elapsed_ms provider=$active_provider abandoned=switching"
    return 0
  }
  start_provider_pool_prewarm "$active_provider" preserve 0
  elapsed_ms="$(( $(now_ms) - started_ms ))"
  if [[ "$(read_runtime_active_provider)" == "$active_provider" ]]; then
    log_stage "reconcile_ms=$elapsed_ms provider=$active_provider"
  else
    log_stage "reconcile_ms=$elapsed_ms provider=$active_provider abandoned=1"
  fi
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


provider_prewarm_queue_pids() {
  local pid
  command -v pgrep >/dev/null 2>&1 || return 0
  while IFS= read -r pid; do
    [[ "$pid" =~ ^[0-9]+$ && "$pid" != "$$" && "$pid" != "$BASHPID" ]] || continue
    printf '%s\n' "$pid"
  done < <(
    {
      pgrep -f "[t]ikpal-web-mode.sh prewarm" 2>/dev/null || true
      pgrep -f "[t]ikpal-web-mode.sh warm-pool" 2>/dev/null || true
    } | awk 'NF && !seen[$0]++'
  )
}

provider_prewarm_queue_running() {
  [[ -n "$(provider_prewarm_queue_pids)" ]]
}

stop_provider_pool_prewarm() {
  local pid_file pid pids waited
  pid_file="$(prewarm_pid_file)"
  if [[ -r "$pid_file" ]]; then
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [[ "$pid" =~ ^[0-9]+$ && "$pid" != "$$" && "$pid" != "$BASHPID" ]]; then
      kill -TERM "-$pid" >/dev/null 2>&1 || true
      pkill -TERM -P "$pid" >/dev/null 2>&1 || true
      kill "$pid" >/dev/null 2>&1 || true
    fi
  fi
  if command -v pgrep >/dev/null 2>&1; then
    pids="$(provider_prewarm_queue_pids)"
    for pid in $pids; do
      kill -TERM "-$pid" >/dev/null 2>&1 || true
      kill -TERM "$pid" >/dev/null 2>&1 || true
    done
    waited=0
    while provider_prewarm_queue_running && [[ "$waited" -lt 20 ]]; do
      sleep 0.05
      waited=$((waited + 1))
    done
    if provider_prewarm_queue_running; then
      pids="$(provider_prewarm_queue_pids)"
      for pid in $pids; do
        kill -KILL "-$pid" >/dev/null 2>&1 || true
        kill -KILL "$pid" >/dev/null 2>&1 || true
      done
    fi
  fi
  rm -f "$pid_file"
}

provider_guard_pid_file() {
  local provider="${1:-}"
  if [[ -n "$provider" ]]; then
    printf '%s\n' "$TIKPAL_WEB_MODE_PROFILE_ROOT/provider-guard-$provider.pid"
    return
  fi
  printf '%s\n' "$TIKPAL_WEB_MODE_PROFILE_ROOT/provider-guard.pid"
}

stop_provider_guard() {
  local provider="${1:-}"
  local pid_file pid
  local pid_files=()
  local pids=()
  if [[ -n "$provider" ]]; then
    pid_files+=("$(provider_guard_pid_file "$provider")")
  else
    pid_files+=("$(provider_guard_pid_file)")
    for pid_file in "$TIKPAL_WEB_MODE_PROFILE_ROOT"/provider-guard-*.pid; do
      [[ -e "$pid_file" ]] && pid_files+=("$pid_file")
    done
    pid_files+=("$TIKPAL_WEB_MODE_PROFILE_ROOT/qq-confirm.pid")
  fi
  for pid_file in "${pid_files[@]}"; do
    [[ -r "$pid_file" ]] || {
      rm -f "$pid_file" >/dev/null 2>&1 || true
      continue
    }
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [[ "$pid" =~ ^[0-9]+$ ]]; then
      kill "$pid" >/dev/null 2>&1 || true
      pids+=("$pid")
    fi
    rm -f "$pid_file"
  done
  sleep 0.2
  for pid in "${pids[@]}"; do
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill -KILL "$pid" >/dev/null 2>&1 || true
    fi
  done
}

close_provider_windows() {
  stop_window_guard
  stop_provider_pool_prewarm
  stop_provider_guard
  pkill -f -- "--user-data-dir=$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/" >/dev/null 2>&1 || true
  sleep 0.2
  pkill -KILL -f -- "--user-data-dir=$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/" >/dev/null 2>&1 || true
}

park_profile_windows_for_reopen() {
  local profile="$1"
  local size="${2:-$TIKPAL_WEB_MODE_LEFT_WINDOW}"
  local window pid
  [[ -n "$profile" ]] || return 0
  command -v xdotool >/dev/null 2>&1 || return 0
  window="$(first_window_for_profile "$profile" || true)"
  if [[ -n "$window" ]]; then
    # Hide instantly before the async off-screen move so the X compositor
    # cannot expose a white root-window flash during the wmctrl transition.
    set_window_opacity "$window" 0 >/dev/null 2>&1 || true
    tile_window_fast "$window" "$TIKPAL_WEB_MODE_STAGE_POSITION" "$size"
    clear_window_above "$window"
    DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowlower "$window" >/dev/null 2>&1 || true
    return
  fi
  local failed=0
  while IFS= read -r window; do
    [[ -n "$window" ]] || continue
    pid="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe getwindowpid "$window" 2>/dev/null || true)"
    process_tree_uses_profile "$pid" "$profile" || continue
    set_window_opacity "$window" 0 >/dev/null 2>&1 || true
    tile_window_fast "$window" "$TIKPAL_WEB_MODE_STAGE_POSITION" "$size"
    clear_window_above "$window"
    DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowlower "$window" >/dev/null 2>&1 || true
  done < <(cached_chromium_windows)
  return "$failed"
}

park_side_panel_for_reopen() {
  park_profile_windows_for_reopen "$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel" "$TIKPAL_WEB_MODE_PANEL_WINDOW"
}

park_provider_windows_for_reopen() {
  local active_provider="${1:-}"
  local provider profile failed=0
  if [[ -n "$active_provider" ]]; then
    profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$active_provider"
    if profile_process_exists "$profile"; then
      park_profile_windows_for_reopen "$profile" "$TIKPAL_WEB_MODE_LEFT_WINDOW" || failed=1
    fi
  fi
  while IFS= read -r provider; do
    [[ -n "$provider" ]] || continue
    [[ -z "$active_provider" || "$provider" != "$active_provider" ]] || continue
    profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$provider"
    profile_process_exists "$profile" || continue
    park_profile_windows_for_reopen "$profile" "$TIKPAL_WEB_MODE_LEFT_WINDOW" || failed=1
  done < <(provider_ids)
  return "$failed"
}

park_left_web_mode_surfaces_for_reopen() {
  local active_provider="${1:-}"
  park_provider_windows_for_reopen "$active_provider"
}

close_overlay_process_matches() {
  local pid="$1"
  local expected_profile="${2:-}"
  local command_line
  [[ "$pid" =~ ^[0-9]+$ && -r "/proc/$pid/cmdline" ]] || return 1
  command_line="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
  [[ "$command_line" == *"--user-data-dir=$TIKPAL_WEB_MODE_PROFILE_ROOT/close-overlay."* ]] || return 1
  [[ -z "$expected_profile" || "$command_line" == *"--user-data-dir=$expected_profile"* ]]
}

terminate_close_overlay_process() {
  local pid="$1"
  local expected_profile="${2:-}"
  close_overlay_process_matches "$pid" "$expected_profile" || return 1
  # This is a disposable, already-covered Chromium surface. A graceful
  # termination can keep its opaque X11 window alive for several seconds
  # after the provider and panel are safely gone.
  pkill -KILL -P "$pid" 2>/dev/null || true
  kill -KILL "$pid" 2>/dev/null || true
}



wait_for_close_overlay_fade() {
  local fade_seconds sleep_seconds
  fade_seconds="$TIKPAL_WEB_MODE_CLOSE_OVERLAY_FADE_SECONDS"
  [[ "$fade_seconds" =~ ^[0-9]+$ ]] || fade_seconds=3
  sleep_seconds="$(awk -v fade_seconds="$fade_seconds" 'BEGIN { printf "%.1f", fade_seconds + 0.5 }')"
  sleep "$sleep_seconds"
}

park_web_mode_surfaces_for_reopen() {
  local active_provider="${1:-}"
  park_provider_windows_for_reopen "$active_provider" &
  local providers_pid=$!
  park_side_panel_for_reopen &
  local panel_pid=$!
  local providers_status=0 panel_status=0
  wait "$providers_pid" || providers_status=$?
  wait "$panel_pid" || panel_status=$?
  if [[ "$providers_status" != "0" || "$panel_status" != "0" ]]; then
    log "ERROR: provider or side panel did not park"
    return 1
  fi
  # screen once Explore has returned to Ambient.
}

close_web_mode_process_surfaces() {
  close_provider_windows &
  local providers_pid=$!
  close_side_panel &
  local panel_pid=$!
  wait "$providers_pid" 2>/dev/null || true
  wait "$panel_pid" 2>/dev/null || true
}

schedule_web_mode_warm_cleanup() {
  is_enabled "$TIKPAL_WEB_MODE_CLOSE_WARM_ENABLED" || return 0
  is_enabled "$TIKPAL_WEB_MODE_CLOSE_KEEP_RESIDENT" && return 0
  local ttl="$TIKPAL_WEB_MODE_CLOSE_WARM_TTL_SECONDS"
  [[ "$ttl" =~ ^[0-9]+([.][0-9]+)?$ ]] || ttl=45
  if command -v setsid >/dev/null 2>&1; then
    env TIKPAL_WEB_MODE_CLOSE_WARM_TTL_SECONDS="$ttl" setsid "$SCRIPT_DIR/tikpal-web-mode.sh" cleanup-warm </dev/null >/dev/null 2>&1 9>&- &
  else
    env TIKPAL_WEB_MODE_CLOSE_WARM_TTL_SECONDS="$ttl" nohup "$SCRIPT_DIR/tikpal-web-mode.sh" cleanup-warm </dev/null >/dev/null 2>&1 9>&- &
  fi
}

schedule_provider_pool_refill_after_close() {
  is_enabled "$TIKPAL_WEB_MODE_CLOSE_KEEP_RESIDENT" || return 0
  is_enabled "$TIKPAL_WEB_MODE_CLOSE_REFILL_PROVIDER_POOL_ENABLED" || return 0
  is_enabled "$TIKPAL_WEB_MODE_PROVIDER_POOL" || return 0
  is_enabled "$TIKPAL_WEB_MODE_PROVIDER_IDLE_POOL_ENABLED" || return 0
  is_enabled "$TIKPAL_WEB_MODE_PROVIDER_PREWARM_ENABLED" || return 0
  [[ -z "$(read_runtime_active_provider)" ]] || return 0
  provider_prewarm_queue_running && return 0
  if [[ -f "$(pool_warm_stamp_file)" ]]; then
    sync_runtime_provider_pool_process_statuses ""
    return 0
  fi
  if ! provider_pool_needs_prewarm ""; then
    sync_runtime_provider_pool_process_statuses ""
    return 0
  fi
  if command -v setsid >/dev/null 2>&1; then
    setsid "$SCRIPT_DIR/tikpal-web-mode.sh" warm-pool </dev/null >/dev/null 2>&1 9>&- &
  else
    nohup "$SCRIPT_DIR/tikpal-web-mode.sh" warm-pool </dev/null >/dev/null 2>&1 9>&- &
  fi
  printf '%s\n' "$!" > "$(prewarm_pid_file)"
}

close_web_mode_full() {
  local providers_pid panel_pid
  close_legacy_exit_stage
  hide_onboard
  close_provider_windows &
  providers_pid=$!
  close_side_panel &
  panel_pid=$!
  wait "$providers_pid" 2>/dev/null || true
  wait "$panel_pid" 2>/dev/null || true
  write_audio_bus_state ""
  write_runtime_provider_state ""
  if is_enabled "${TIKPAL_WEB_MODE_STARTUP_RESET:-0}"; then
    rm -f "$(pool_warm_stamp_file)"
  fi
  # Keep the warm marker for ordinary close/reopen cycles. A physical kiosk
  # startup has just terminated every provider, so it must rebuild the pool.
  sync_runtime_provider_pool_process_statuses ""
}

close_web_mode_warm() {
  local active_provider settle
  active_provider="${TIKPAL_WEB_MODE_CLOSE_ACTIVE_PROVIDER:-}"
  [[ -n "$active_provider" ]] || active_provider="$(read_runtime_active_provider)"
  settle="$TIKPAL_WEB_MODE_CLOSE_AUDIO_GATE_SETTLE_SECONDS"
  [[ "$settle" =~ ^[0-9]+([.][0-9]+)?$ ]] || settle=0.35
  close_legacy_exit_stage
  hide_onboard
  if ! runtime_close_request_is_current; then
    return 0
  fi
  stop_window_guard
  if ! runtime_close_request_is_current; then
    return 0
  fi
  park_web_mode_surfaces_for_reopen "$active_provider" || return 1
  if ! runtime_close_request_is_current; then
    return 0
  fi
  write_audio_bus_state ""
  write_runtime_provider_state ""
  sync_runtime_provider_pool_process_statuses ""
  sleep "$settle"
  if ! is_enabled "$TIKPAL_WEB_MODE_CLOSE_KEEP_RESIDENT"; then
    stop_provider_guard
  fi
  schedule_provider_pool_refill_after_close
  schedule_web_mode_warm_cleanup
}

close_web_mode() {
  if is_enabled "$TIKPAL_WEB_MODE_CLOSE_WARM_ENABLED"; then
    close_web_mode_warm
    return
  fi
  close_web_mode_full
}

cleanup_warm_web_mode() {
  is_enabled "$TIKPAL_WEB_MODE_CLOSE_KEEP_RESIDENT" && return 0
  if [[ -n "$(read_runtime_active_provider)" ]]; then
    return 0
  fi
  close_web_mode_full
}

close_web_mode_from_guard() {
  close_legacy_exit_stage
  hide_onboard
  if is_enabled "$TIKPAL_WEB_MODE_CLOSE_KEEP_RESIDENT"; then
    if [[ -n "$(read_runtime_active_provider)" ]]; then
      return 0
    fi
    park_web_mode_surfaces_for_reopen "" || return 1
    if [[ -n "$(read_runtime_active_provider)" ]]; then
      return 0
    fi
    write_audio_bus_state ""
    write_runtime_provider_state ""
    sync_runtime_provider_pool_process_statuses ""
    schedule_provider_pool_refill_after_close
    return 0
  fi
  close_web_mode_full
}

profile_command_line_matches() {
  local profile="$1"
  local command_line="$2"
  local canonical_profile
  [[ -n "$profile" ]] || return 1
  [[ " $command_line " == *" --user-data-dir=$profile "* ]] && return 0
  canonical_profile="$(readlink -f -- "$profile" 2>/dev/null || true)"
  [[ -n "$canonical_profile" && "$canonical_profile" != "$profile" ]] || return 1
  [[ " $command_line " == *" --user-data-dir=$canonical_profile "* ]]
}

profile_process_exists() {
  local profile="$1"
  local canonical_profile pid command_line executable_name
  [[ -n "$profile" ]] || return 1
  canonical_profile="$(readlink -f -- "$profile" 2>/dev/null || true)"
  while IFS= read -r pid; do
    [[ "$pid" =~ ^[0-9]+$ && -r "/proc/$pid/cmdline" ]] || continue
    command_line="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
    profile_command_line_matches "$profile" "$command_line" || continue
    # A guard is invoked with the profile as a positional argument. It must
    # never keep a dead Chromium profile falsely resident. Chromium can replace
    # the configured launcher wrapper with its real executable in /proc.
    [[ "$command_line" == "$TIKPAL_CHROMIUM_BIN"* ]] && return 0
    executable_name="$(basename "$(readlink -f "/proc/$pid/exe" 2>/dev/null || true)")"
    case "$executable_name" in
      chrome|chromium|chromium-browser) return 0 ;;
    esac
  done < <(
    pgrep -f -- "--user-data-dir=$profile" 2>/dev/null || true
    if [[ -n "$canonical_profile" && "$canonical_profile" != "$profile" ]]; then
      pgrep -f -- "--user-data-dir=$canonical_profile" 2>/dev/null || true
    fi
  )
  return 1
}

any_provider_process_exists() {
  local profile
  [[ -d "$TIKPAL_WEB_MODE_PROFILE_ROOT/providers" ]] || return 1
  for profile in "$TIKPAL_WEB_MODE_PROFILE_ROOT"/providers/*; do
    [[ -d "$profile" ]] || continue
    profile_process_exists "$profile" && return 0
  done
  return 1
}

cleanup_stale_profile_singletons() {
  local provider_profile="$1"
  [[ -n "$provider_profile" && -d "$provider_profile" ]] || return 0
  profile_process_exists "$provider_profile" && return 0
  rm -f "$provider_profile"/SingletonCookie \
    "$provider_profile"/SingletonLock \
    "$provider_profile"/SingletonSocket
}

close_provider_profile() {
  local provider_profile="$1"
  local canonical_profile
  [[ -n "$provider_profile" ]] || return 0
  canonical_profile="$(readlink -f -- "$provider_profile" 2>/dev/null || true)"
  pkill -TERM -f -- "--user-data-dir=$provider_profile" >/dev/null 2>&1 || true
  if [[ -n "$canonical_profile" && "$canonical_profile" != "$provider_profile" ]]; then
    pkill -TERM -f -- "--user-data-dir=$canonical_profile" >/dev/null 2>&1 || true
  fi
  for _ in {1..10}; do
    profile_process_exists "$provider_profile" || break
    sleep 0.1
  done
  if profile_process_exists "$provider_profile"; then
    pkill -KILL -f -- "--user-data-dir=$provider_profile" >/dev/null 2>&1 || true
    if [[ -n "$canonical_profile" && "$canonical_profile" != "$provider_profile" ]]; then
      pkill -KILL -f -- "--user-data-dir=$canonical_profile" >/dev/null 2>&1 || true
    fi
  fi
  cleanup_stale_profile_singletons "$provider_profile"
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
    if [[ -r "/proc/$pid/cmdline" ]] && profile_command_line_matches "$profile" "$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"; then
      return 0
    fi
    [[ -r "/proc/$pid/status" ]] || break
    pid="$(awk '/^PPid:/{print $2}' "/proc/$pid/status")"
    depth=$((depth + 1))
  done

  return 1
}

# Find an X11 window owned by a process tree rooted at $1.
# Traverses child PIDs because Chromium forks — the spawned PID may not be the
# window owner.  Uses xdotool search --pid which reads _NET_WM_PID.
find_window_for_pid() {
  local parent_pid="$1"
  local _pid _w
  command -v xdotool >/dev/null 2>&1 || return 1
  [[ "$parent_pid" =~ ^[0-9]+$ ]] || return 1
  # Direct match first.
  _w="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe search --pid "$parent_pid" 2>/dev/null | head -1 || true)"
  [[ -n "$_w" ]] && { printf '%s
' "$_w"; return 0; }
  # Traverse one level of children (Chromium main → renderer/gpu/zygote).
  while IFS= read -r _pid; do
    [[ "$_pid" =~ ^[0-9]+$ ]] || continue
    _w="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe search --pid "$_pid" 2>/dev/null | head -1 || true)"
    [[ -n "$_w" ]] && { printf '%s
' "$_w"; return 0; }
  done < <(pgrep -P "$parent_pid" 2>/dev/null || true)
  return 1
}

provider_profile_for_pid() {
  local pid="$1"
  local provider profile
  while IFS= read -r provider; do
    [[ -n "$provider" ]] || continue
    profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$provider"
    process_tree_uses_profile "$pid" "$profile" || continue
    printf '%s\t%s\n' "$provider" "$profile"
    return 0
  done < <(provider_ids)
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

is_oauth_window_title() {
  local title="$1"
  [[ "$title" == *"Google"* && ( "$title" == *"账号"* || "$title" == *"帳號"* || "$title" == *"Account"* || "$title" == *"Sign in"* || "$title" == *"登录"* || "$title" == *"登入"* ) ]]
}

tile_window() {
  local window="$1"
  local position="$2"
  local size="$3"
  local current_height current_width current_x current_y geometry height width x y
  x="$(position_x "$position")"
  y="$(position_y "$position")"
  width="$(window_width "$size")"
  height="$(window_height "$size")"
  TIKPAL_TILE_WINDOW_CHANGED=0
  geometry="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe getwindowgeometry --shell "$window" 2>/dev/null || true)"
  current_x="$(printf '%s\n' "$geometry" | awk -F= '$1 == "X" { print $2 }')"
  current_y="$(printf '%s\n' "$geometry" | awk -F= '$1 == "Y" { print $2 }')"
  current_width="$(printf '%s\n' "$geometry" | awk -F= '$1 == "WIDTH" { print $2 }')"
  current_height="$(printf '%s\n' "$geometry" | awk -F= '$1 == "HEIGHT" { print $2 }')"
  if [[ "$current_x" == "$x" && "$current_y" == "$y" && "$current_width" == "$width" && "$current_height" == "$height" ]]; then
    return 0
  fi
  TIKPAL_TILE_WINDOW_CHANGED=1
  if command -v wmctrl >/dev/null 2>&1; then
    DISPLAY="$TIKPAL_KIOSK_DISPLAY" wmctrl -i -r "$window" -b remove,fullscreen,maximized_vert,maximized_horz >/dev/null 2>&1 || true
    if ! is_enabled "$TIKPAL_WEB_MODE_X11_SYNC_WINDOW_OPS"; then
      DISPLAY="$TIKPAL_KIOSK_DISPLAY" wmctrl -i -r "$window" -e "0,$x,$y,$width,$height" >/dev/null 2>&1 && return 0
    fi
  fi
  if is_enabled "$TIKPAL_WEB_MODE_X11_SYNC_WINDOW_OPS"; then
    DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe \
      windowmove --sync "$window" "$x" "$y" \
      windowsize --sync "$window" "$width" "$height" \
      windowmove "$window" "$x" "$y" >/dev/null 2>&1 || true
    return 0
  fi
  DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe \
    windowmove "$window" "$x" "$y" \
    windowsize "$window" "$width" "$height" \
    windowmove "$window" "$x" "$y" >/dev/null 2>&1 || true
}

tile_window_fast() {
  local window="$1"
  local position="$2"
  local size="$3"
  local height width x y
  x="$(position_x "$position")"
  y="$(position_y "$position")"
  width="$(window_width "$size")"
  height="$(window_height "$size")"
  TIKPAL_TILE_WINDOW_CHANGED=1
  if command -v wmctrl >/dev/null 2>&1 && ! is_enabled "$TIKPAL_WEB_MODE_X11_SYNC_WINDOW_OPS"; then
    DISPLAY="$TIKPAL_KIOSK_DISPLAY" wmctrl -i -r "$window" -e "0,$x,$y,$width,$height" >/dev/null 2>&1 && return 0
  fi
  if is_enabled "$TIKPAL_WEB_MODE_X11_SYNC_WINDOW_OPS"; then
    tile_window "$window" "$position" "$size"
    return
  fi
  DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe \
    windowmove "$window" "$x" "$y" \
    windowsize "$window" "$width" "$height" \
    windowmove "$window" "$x" "$y" >/dev/null 2>&1 || true
}

window_is_at_position() {
  local window="$1"
  local position="$2"
  local size="$3"
  local geometry expected_height expected_width expected_x expected_y height width x y
  [[ "$window" =~ ^[0-9]+$ ]] || return 1
  geometry="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe getwindowgeometry --shell "$window" 2>/dev/null || true)"
  x="$(printf '%s\n' "$geometry" | awk -F= '$1 == "X" { print $2 }')"
  y="$(printf '%s\n' "$geometry" | awk -F= '$1 == "Y" { print $2 }')"
  width="$(printf '%s\n' "$geometry" | awk -F= '$1 == "WIDTH" { print $2 }')"
  height="$(printf '%s\n' "$geometry" | awk -F= '$1 == "HEIGHT" { print $2 }')"
  expected_x="$(position_x "$position")"
  expected_y="$(position_y "$position")"
  expected_width="$(window_width "$size")"
  expected_height="$(window_height "$size")"
  [[ "$x" == "$expected_x" && "$y" == "$expected_y" && "$width" == "$expected_width" && "$height" == "$expected_height" ]]
}

wait_for_window_position() {
  local window="$1"
  local position="$2"
  local size="$3"
  local timeout_seconds="$TIKPAL_WEB_MODE_CLOSE_PARK_TIMEOUT_SECONDS"
  local deadline
  [[ "$timeout_seconds" =~ ^[0-9]+([.][0-9]+)?$ ]] || timeout_seconds=3
  deadline="$(awk -v now="$(now_ms)" -v timeout="$timeout_seconds" 'BEGIN { printf "%.0f", now + timeout * 1000 }')"
  while (( $(now_ms) < deadline )); do
    window_is_at_position "$window" "$position" "$size" && return 0
    sleep 0.05
  done
  window_is_at_position "$window" "$position" "$size"
}

raise_window() {
  local window="$1"
  [[ -n "$window" ]] || return 0
  DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowraise "$window" windowactivate "$window" >/dev/null 2>&1 || true
}

raise_window_without_focus() {
  local window="$1"
  [[ -n "$window" ]] || return 0
  DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowraise "$window" >/dev/null 2>&1 || true
}

mark_window_above() {
  local window="$1"
  [[ -n "$window" ]] || return 0
  command -v wmctrl >/dev/null 2>&1 || return 0
  DISPLAY="$TIKPAL_KIOSK_DISPLAY" wmctrl -i -r "$window" -b add,above >/dev/null 2>&1 || true
}

clear_window_above() {
  local window="$1"
  [[ -n "$window" ]] || return 0
  command -v wmctrl >/dev/null 2>&1 || return 0
  DISPLAY="$TIKPAL_KIOSK_DISPLAY" wmctrl -i -r "$window" -b remove,above >/dev/null 2>&1 || true
}

set_window_opacity() {
  local window="$1"
  local opacity="$2"
  local window_id value
  [[ "$window" =~ ^[0-9]+$ ]] || return 1
  command -v xprop >/dev/null 2>&1 || return 1
  [[ "$opacity" =~ ^0([.][0-9]+)?$|^1([.]0+)?$ ]] || return 1
  window_id="$(printf '0x%x' "$window")"
  value="$(awk -v opacity="$opacity" 'BEGIN { printf "0x%08x", int(4294967295 * opacity) }')"
  DISPLAY="$TIKPAL_KIOSK_DISPLAY" xprop -id "$window_id" -f _NET_WM_WINDOW_OPACITY 32c -set _NET_WM_WINDOW_OPACITY "$value" >/dev/null 2>&1
}

restore_window_opacity() {
  local window="$1"
  set_window_opacity "$window" 1 >/dev/null 2>&1 || true
}

first_window_for_profile() {
  local profile="$1"
  local window pid geometry width height area best_window="" best_area=0
  local cache_path cached_window
  command -v xdotool >/dev/null 2>&1 || return 1
  cache_path="$(profile_window_cache_path "$profile")"
  if [[ -r "$cache_path" ]]; then
    cached_window="$(cat "$cache_path" 2>/dev/null || true)"
    if validate_profile_window "$cached_window" "$profile"; then
      printf '%s\n' "$cached_window"
      return 0
    fi
    rm -f "$cache_path"
  fi
  while IFS= read -r window; do
    [[ -n "$window" ]] || continue
    pid="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe getwindowpid "$window" 2>/dev/null || true)"
    process_tree_uses_profile "$pid" "$profile" || continue
    geometry="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe getwindowgeometry "$window" 2>/dev/null || true)"
    width="$(printf '%s\n' "$geometry" | awk -F'[ x]+' '/Geometry:/{print $3}')"
    height="$(printf '%s\n' "$geometry" | awk -F'[ x]+' '/Geometry:/{print $4}')"
    [[ "$width" =~ ^[0-9]+$ && "$height" =~ ^[0-9]+$ ]] || continue
    area=$((width * height))
    if [[ "$area" -gt "$best_area" ]]; then
      best_area="$area"
      best_window="$window"
    fi
  done < <(cached_chromium_windows)
  if [[ -n "$best_window" && "$best_area" -gt 100000 ]]; then
    mkdir -p "$(dirname "$cache_path")"
    printf '%s\n' "$best_window" > "$cache_path"
    printf '%s\n' "$best_window"
    return 0
  fi
  return 1
}

profile_window_cache_path() {
  local profile="$1"
  local key
  key="$(printf '%s' "$profile" | cksum | awk '{print $1 "-" $2}')"
  printf '%s\n' "$TIKPAL_WEB_MODE_PROFILE_ROOT/window-$key.id"
}

validate_profile_window() {
  local window="$1"
  local profile="$2"
  local pid geometry width height
  [[ "$window" =~ ^[0-9]+$ ]] || return 1
  pid="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe getwindowpid "$window" 2>/dev/null || true)"
  process_tree_uses_profile "$pid" "$profile" || return 1
  geometry="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe getwindowgeometry "$window" 2>/dev/null || true)"
  width="$(printf '%s\n' "$geometry" | awk -F'[ x]+' '/Geometry:/{print $3}')"
  height="$(printf '%s\n' "$geometry" | awk -F'[ x]+' '/Geometry:/{print $4}')"
  [[ "$width" =~ ^[0-9]+$ && "$height" =~ ^[0-9]+$ ]] || return 1
  [[ "$((width * height))" -gt 100000 ]]
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

profile_window_timeout_attempts() {
  local seconds="${1:-0}"
  [[ "$seconds" =~ ^[0-9]+$ ]] || seconds=0
  if [[ "$seconds" -le 0 ]]; then
    printf '50\n'
    return 0
  fi
  printf '%s\n' "$((seconds * 10))"
}

visible_chromium_windows() {
  {
    DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe search --onlyvisible --class chromium 2>/dev/null || true
    DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe search --onlyvisible --class Chromium-browser 2>/dev/null || true
  } | awk 'NF && !seen[$0]++'
}

profile_has_visible_window() {
  local profile="$1"
  local window pid geometry width height
  [[ -n "$profile" ]] || return 1
  while IFS= read -r window; do
    [[ -n "$window" ]] || continue
    pid="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe getwindowpid "$window" 2>/dev/null || true)"
    process_tree_uses_profile "$pid" "$profile" || continue
    geometry="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe getwindowgeometry --shell "$window" 2>/dev/null || true)"
    width="$(printf '%s\n' "$geometry" | awk -F= '$1 == "WIDTH" { print $2 }')"
    height="$(printf '%s\n' "$geometry" | awk -F= '$1 == "HEIGHT" { print $2 }')"
    [[ "$width" =~ ^[0-9]+$ && "$height" =~ ^[0-9]+$ ]] || continue
    (( width * height > 100000 )) && return 0
  done < <(visible_chromium_windows)
  return 1
}

provider_launch_position() {
  local launch_role="${1:-active}"
  if [[ "$launch_role" == "prewarm" ]]; then
    printf '%s\n' "$TIKPAL_WEB_MODE_STAGE_POSITION"
    return 0
  fi
  printf '%s\n' "$TIKPAL_WEB_MODE_LEFT_POSITION"
}

xdotool_safe() {
  local timeout_seconds=3
  # Window discovery is repeated throughout a resident reveal. On this X11
  # stack a missing Chromium class can block the query for the whole command
  # timeout, so a stale scan must not keep the foreground switch lock alive.
  if [[ "${1:-}" == "search" ]]; then
    timeout_seconds="${TIKPAL_WEB_MODE_X11_SEARCH_TIMEOUT_SECONDS:-0.35}"
  fi
  timeout "$timeout_seconds" xdotool "$@" 2>/dev/null || true
}

park_pointer_in_side_panel() {
  local panel_x panel_y panel_width panel_height target_x target_y
  command -v xdotool >/dev/null 2>&1 || return 0
  panel_x="$(position_x "$TIKPAL_WEB_MODE_PANEL_POSITION")"
  panel_y="$(position_y "$TIKPAL_WEB_MODE_PANEL_POSITION")"
  panel_width="$(window_width "$TIKPAL_WEB_MODE_PANEL_WINDOW")"
  panel_height="$(window_height "$TIKPAL_WEB_MODE_PANEL_WINDOW")"
  [[ "$panel_x" =~ ^[0-9]+$ && "$panel_y" =~ ^[0-9]+$ && "$panel_width" =~ ^[1-9][0-9]*$ && "$panel_height" =~ ^[1-9][0-9]*$ ]] || return 0
  target_x="$((panel_x + panel_width - 1))"
  target_y="$((panel_y + panel_height - 1))"
  DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe mousemove "$target_x" "$target_y"
}

commit_visible_provider_state() {
  local provider="$1"
  park_pointer_in_side_panel
  write_runtime_provider_state "$provider"
}

all_chromium_windows() {
  {
    DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe search --class chromium
    DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe search --class Chromium-browser
  } | awk 'NF && !seen[$0]++'
}

_CHROMIUM_WINDOW_CACHE=""

cached_chromium_windows() {
  if [[ -z "$_CHROMIUM_WINDOW_CACHE" ]]; then
    _CHROMIUM_WINDOW_CACHE="$(all_chromium_windows)"
  fi
  printf '%s\n' "$_CHROMIUM_WINDOW_CACHE"
}

invalidate_chromium_window_cache() {
  _CHROMIUM_WINDOW_CACHE=""
}

tile_visible_web_mode_windows() {
  local provider_profile="$1"
  local panel_profile="$2"
  local force_raise="${3:-0}"
  local did_restack=0
  local window pid title active_window active_provider_window oauth_provider_window preferred_provider_window keep_window provider_window_count provider_entry provider_entry_id provider_entry_profile
  local background_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/background"
  local background_windows=()
  local provider_windows=()
  command -v xdotool >/dev/null 2>&1 || return 0
  active_window="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe getactivewindow 2>/dev/null || true)"

  while IFS= read -r window; do
    [[ -n "$window" ]] || continue
    pid="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe getwindowpid "$window" 2>/dev/null || true)"
    title="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe getwindowname "$window" 2>/dev/null || true)"

    if process_tree_uses_profile "$pid" "$panel_profile"; then
      tile_window "$window" "$TIKPAL_WEB_MODE_PANEL_POSITION" "$TIKPAL_WEB_MODE_PANEL_WINDOW"
      mark_window_above "$window"
      if [[ "$force_raise" == "1" || "${TIKPAL_TILE_WINDOW_CHANGED:-0}" == "1" ]]; then
        raise_window_without_focus "$window"
        did_restack=1
      fi
      continue
    fi
    if process_tree_uses_profile "$pid" "$background_profile"; then
      background_windows+=("$window")
      continue
    fi
    if is_ad_window_title "$title"; then
      DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowclose "$window" >/dev/null 2>&1 || true
      continue
    fi
    if process_tree_uses_profile "$pid" "$provider_profile"; then
      tile_window "$window" "$TIKPAL_WEB_MODE_LEFT_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW"
      mark_window_above "$window"
      provider_windows+=("$window")
      [[ "$window" == "$active_window" ]] && active_provider_window="$window"
      if is_oauth_window_title "$title" && { [[ "$window" == "$active_window" ]] || [[ -z "$oauth_provider_window" ]]; }; then
        oauth_provider_window="$window"
      fi
    elif is_enabled "$TIKPAL_WEB_MODE_PROVIDER_POOL" && provider_entry="$(provider_profile_for_pid "$pid" || true)" && [[ -n "$provider_entry" ]]; then
      provider_entry_id="${provider_entry%%$'\t'*}"
      provider_entry_profile="${provider_entry#*$'\t'}"
      if [[ "$provider_entry_profile" == "$provider_profile" ]]; then
        tile_window "$window" "$TIKPAL_WEB_MODE_LEFT_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW"
        mark_window_above "$window"
      else
        tile_window "$window" "$TIKPAL_WEB_MODE_STAGE_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW"
        clear_window_above "$window"
      fi
      if [[ "$provider_entry_profile" == "$provider_profile" ]]; then
        provider_windows+=("$window")
        [[ "$window" == "$active_window" ]] && active_provider_window="$window"
        if is_oauth_window_title "$title" && { [[ "$window" == "$active_window" ]] || [[ -z "$oauth_provider_window" ]]; }; then
          oauth_provider_window="$window"
        fi
      fi
    elif [[ -n "$title" ]] && ! is_tikpal_window_title "$title"; then
      tile_window "$window" "$TIKPAL_WEB_MODE_LEFT_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW"
      mark_window_above "$window"
      provider_windows+=("$window")
      [[ "$window" == "$active_window" ]] && active_provider_window="$window"
      if is_oauth_window_title "$title" && { [[ "$window" == "$active_window" ]] || [[ -z "$oauth_provider_window" ]]; }; then
        oauth_provider_window="$window"
      fi
    fi
  done < <(visible_chromium_windows)

  for window in "${background_windows[@]}"; do
    if [[ "${#provider_windows[@]}" -gt 0 ]]; then
      tile_window "$window" "$TIKPAL_WEB_MODE_STAGE_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW"
      clear_window_above "$window"
      DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowlower "$window" >/dev/null 2>&1 || true
    else
      tile_window "$window" "$TIKPAL_WEB_MODE_LEFT_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW"
      mark_window_above "$window"
      if [[ "$force_raise" == "1" || "${TIKPAL_TILE_WINDOW_CHANGED:-0}" == "1" ]]; then
        raise_window_without_focus "$window"
        did_restack=1
      fi
    fi
  done

  # Lower kiosk window behind providers (mirrors background window handling)
  if [[ "${#provider_windows[@]}" -gt 0 ]]; then
    local kiosk_win
    kiosk_win="$(kiosk_browser_window || true)"
    if [[ -n "$kiosk_win" ]]; then
      DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowlower "$kiosk_win" >/dev/null 2>&1 || true
    fi
  fi

  if [[ "${#provider_windows[@]}" -gt 0 && ( "$force_raise" == "1" || "${TIKPAL_TILE_WINDOW_CHANGED:-0}" == "1" ) ]]; then
    preferred_provider_window="${oauth_provider_window:-${active_provider_window:-${provider_windows[0]}}}"
    raise_window_without_focus "$preferred_provider_window"
    did_restack=1
  fi

  [[ "$did_restack" == "1" ]] && raise_onboard
  is_enabled "$TIKPAL_WEB_MODE_PROVIDER_POOL" && return 0
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
    DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowclose "$window" >/dev/null 2>&1 || true
    did_restack=1
  done
  tile_window "$keep_window" "$TIKPAL_WEB_MODE_LEFT_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW"
  mark_window_above "$keep_window"
  if [[ "$force_raise" == "1" || "$did_restack" == "1" || "${TIKPAL_TILE_WINDOW_CHANGED:-0}" == "1" ]]; then
    raise_window_without_focus "$keep_window"
    raise_onboard
  fi
}

start_window_guard() {
  is_enabled "$TIKPAL_WEB_MODE_WINDOW_GUARD" || return 0
  command -v xdotool >/dev/null 2>&1 || return 0

  local provider_profile="$1"
  local panel_profile="$2"
  [[ -n "$provider_profile" ]] || is_enabled "$TIKPAL_WEB_MODE_PROVIDER_POOL" || return 0

  stop_window_guard
  mkdir -p "$TIKPAL_WEB_MODE_PROFILE_ROOT"
  nohup "$SCRIPT_DIR/tikpal-web-mode.sh" guard "$provider_profile" "$panel_profile" >/dev/null 2>&1 9>&- &
  printf '%s\n' "$!" > "$(window_guard_pid_file)"
}

run_window_guard() {
  local provider_profile="$1"
  local panel_profile="$2"
  local force_raise=1
  local stack_refresh_ticks=0
  local active_provider active_profile
  [[ -n "$provider_profile" ]] || is_enabled "$TIKPAL_WEB_MODE_PROVIDER_POOL" || return 0

  if is_enabled "$TIKPAL_WEB_MODE_PROVIDER_POOL"; then
    while any_provider_process_exists || side_panel_window_visible "$panel_profile"; do
      active_provider="$(read_runtime_active_provider)"
      if [[ -z "$active_provider" ]]; then
        # Guard was told to stop (PID file removed) — exit without parking
        if [[ "$(cat "$(window_guard_pid_file)" 2>/dev/null || true)" != "$$" ]]; then
          return 0
        fi
        close_web_mode_from_guard
        return 0
      fi
      active_profile=""
      active_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$active_provider"
      tile_visible_web_mode_windows "$active_profile" "$panel_profile" "$force_raise"
      force_raise=0
      stack_refresh_ticks=$((stack_refresh_ticks + 1))
      if [[ "$stack_refresh_ticks" -ge 4 ]]; then
        force_raise=1
        stack_refresh_ticks=0
      fi
      sleep 0.25
    done
    return 0
  fi

  while profile_process_exists "$provider_profile"; do
    tile_visible_web_mode_windows "$provider_profile" "$panel_profile" "$force_raise"
    force_raise=0
    stack_refresh_ticks=$((stack_refresh_ticks + 1))
    if [[ "$stack_refresh_ticks" -ge 4 ]]; then
      force_raise=1
      stack_refresh_ticks=0
    fi
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

  if is_enabled "$TIKPAL_WEB_MODE_PROVIDER_POOL"; then
    stop_provider_guard "$provider"
  else
    stop_provider_guard
  fi
  mkdir -p "$TIKPAL_WEB_MODE_PROFILE_ROOT"
  TIKPAL_WEB_MODE_PROVIDER_ID="$provider" \
  TIKPAL_WEB_MODE_PROVIDER_LABEL="$(provider_label "$provider")" \
  TIKPAL_WEB_MODE_PROVIDER_PROFILE="$provider_profile" \
  TIKPAL_WEB_MODE_PROVIDER_URL="$provider_url_value" \
  TIKPAL_WEB_MODE_STATE_PATH="$TIKPAL_WEB_MODE_STATE_PATH" \
  TIKPAL_WEB_MODE_PROXY_MODE="$proxy_mode" \
  TIKPAL_WEB_MODE_ERROR_PAGE_URL="$TIKPAL_WEB_MODE_ERROR_PAGE_URL" \
  TIKPAL_WEB_MODE_PROVIDER_DEBUG_PORT="$provider_port" \
  TIKPAL_WEB_MODE_QQ_AUTO_CONFIRM="$TIKPAL_WEB_MODE_QQ_AUTO_CONFIRM" \
  TIKPAL_WEB_MODE_QQ_AUDIO_PRIME="$TIKPAL_WEB_MODE_QQ_AUDIO_PRIME" \
  TIKPAL_WEB_MODE_QQ_MUSIC_AUTO_PLAY="$TIKPAL_WEB_MODE_QQ_MUSIC_AUTO_PLAY" \
  TIKPAL_WEB_MODE_QQ_MV_AUTO_FULLSCREEN="$TIKPAL_WEB_MODE_QQ_MV_AUTO_FULLSCREEN" \
  TIKPAL_WEB_MODE_QQ_MV_CINEMA_MODE="$TIKPAL_WEB_MODE_QQ_MV_CINEMA_MODE" \
  TIKPAL_WEB_MODE_QQ_MV_AUTO_PLAY="$TIKPAL_WEB_MODE_QQ_MV_AUTO_PLAY" \
  TIKPAL_WEB_MODE_NETEASE_AUTO_PLAY="$TIKPAL_WEB_MODE_NETEASE_AUTO_PLAY" \
  TIKPAL_WEB_MODE_ONBOARD_AUTO_FOCUS="$TIKPAL_WEB_MODE_ONBOARD_AUTO_FOCUS" \
  TIKPAL_WEB_MODE_PROVIDER_GUARD_IDLE_POLL_MS="$TIKPAL_WEB_MODE_PROVIDER_GUARD_IDLE_POLL_MS" \
  TIKPAL_KIOSK_DISPLAY="$TIKPAL_KIOSK_DISPLAY" \
    node --experimental-websocket "$helper" >/dev/null 2>&1 7>&- 9>&- &
  if is_enabled "$TIKPAL_WEB_MODE_PROVIDER_POOL"; then
    printf '%s\n' "$!" > "$(provider_guard_pid_file "$provider")"
  else
    printf '%s\n' "$!" > "$(provider_guard_pid_file)"
  fi
}

refresh_provider_pool_guards() {
  local provider provider_profile provider_port proxy_line proxy_enabled
  is_enabled "$TIKPAL_WEB_MODE_PROVIDER_POOL" || return 0
  proxy_line="$(read_proxy_settings)"
  while IFS= read -r provider; do
    [[ -n "$provider" ]] || continue
    provider_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$provider"
    profile_process_exists "$provider_profile" || continue
    provider_port="$(provider_debug_port "$provider")"
    proxy_enabled="$(effective_provider_proxy_enabled "$provider" "${proxy_line%%$'\t'*}")"
    start_provider_guard "$provider" "$provider_profile" "$(provider_url "$provider")" "$proxy_enabled" "$provider_port"
  done < <(provider_ids)
  log "refreshed provider guards"
}

close_legacy_exit_stage() {
  # Older builds could leave this full-screen Chromium profile above the room.
  # It is cleanup-only now: closing Explore must never create or raise it.
  pkill -f -- "--user-data-dir=$TIKPAL_WEB_MODE_PROFILE_ROOT/exit-stage" >/dev/null 2>&1 || true
}

fade_profile_window_for_provider_switch() {
  local profile="$1"
  local window="${2:-}"
  local duration step opacity
  if [[ -z "$window" ]]; then
    window="$(first_window_for_profile "$profile" || true)"
  fi
  [[ -n "$window" ]] || return 0
  duration="$TIKPAL_WEB_MODE_PROVIDER_SWITCH_FADE_SECONDS"
  [[ "$duration" =~ ^[0-9]+([.][0-9]+)?$ ]] || duration=0.10
  [[ "$duration" != "0" ]] || return 0
  step="$(awk -v duration="$duration" 'BEGIN { printf "%.3f", duration / 3 }')"

  # A stale opacity from an interrupted switch must not carry into this one.
  restore_window_opacity "$window"
  for opacity in 0.70 0.30 0.04; do
    set_window_opacity "$window" "$opacity" >/dev/null 2>&1 || {
      sleep "$duration"
      return 0
    }
    sleep "$step"
  done
}

begin_provider_switch_transition() {
  local current_profile="$1"
  local provider="$2"
  local current_window="${3:-}"
  local started_ms
  started_ms="$(now_ms)"
  TIKPAL_WEB_MODE_TRANSITION_SHOWN_MS=0

  if [[ -z "$current_window" ]]; then
    invalidate_chromium_window_cache
    current_window="$(first_window_for_profile "$current_profile" || true)"
  fi
  if [[ -n "$current_window" ]]; then
    fade_profile_window_for_provider_switch "$current_profile" "$current_window"
    TIKPAL_WEB_MODE_TRANSITION_SHOWN_MS="$(now_ms)"
    log_stage "transition_fade provider=$provider ms=$(( TIKPAL_WEB_MODE_TRANSITION_SHOWN_MS - started_ms ))"
  else
    log_stage "transition_skip provider=$provider reason=no-current-window ms=$(( $(now_ms) - started_ms ))"
  fi
  return 0
}

recover_or_cover_provider_failure() {
  local current_provider="${1:-}"
  local current_profile="${2:-}"
  local failed_provider="${3:-}"
  local status="${4:-check_setup}"
  local message="${5:-}"
  local current_window failed_profile proxy_line proxy_enabled
  proxy_line="$(read_proxy_settings)"
  proxy_enabled="$(effective_provider_proxy_enabled "$current_provider" "${proxy_line%%$'\t'*}")"

  # A failed target can still finish its extension navigation after the API has
  # restored the previous provider. Keep that stale target and its guard off
  # the left surface so runtime state and the visible page cannot diverge.
  if [[ -n "$failed_provider" && "$failed_provider" != "$current_provider" ]]; then
    failed_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$failed_provider"
    stop_provider_guard "$failed_provider"
    park_profile_windows_for_reopen "$failed_profile" "$TIKPAL_WEB_MODE_LEFT_WINDOW" || true
  fi
  clear_provider_switch_guard

  if [[ -n "$current_provider" && "$current_provider" != "$failed_provider" && -n "$current_profile" ]] \
    && profile_process_exists "$current_profile"; then
    current_window="$(wait_for_profile_window "$current_profile" 8 || true)"
    if [[ -n "$current_window" ]]; then
      write_runtime_provider_state "$current_provider"
      [[ -n "$failed_provider" ]] && write_runtime_provider_status "$failed_provider" "$status" "$message"
      tile_visible_web_mode_windows "$current_profile" "$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel" 1
      tile_window "$current_window" "$TIKPAL_WEB_MODE_LEFT_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW"
      restore_window_opacity "$current_window"
      raise_window "$current_window"
      start_provider_guard "$current_provider" "$current_profile" "$(provider_url "$current_provider")" "$proxy_enabled" "$(provider_debug_port "$current_provider")"
      start_window_guard "$current_profile" "$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel"
      return 0
    fi
  fi

  write_runtime_provider_state ""
  [[ -n "$failed_provider" ]] && write_runtime_provider_status "$failed_provider" "$status" "$message"
  close_web_mode
  return 1
}

launch_side_panel() {
  local opening_provider="${1:-}"
  local hidden="${2:-0}"
  local panel_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel"
  local panel_url="$TIKPAL_WEB_MODE_SIDE_PANEL_URL"
  local panel_position="$TIKPAL_WEB_MODE_PANEL_POSITION"
  local window
  [[ -n "$opening_provider" ]] && panel_url="$panel_url?opening=$opening_provider"
  [[ "$hidden" == "1" ]] && panel_position="$TIKPAL_WEB_MODE_STAGE_POSITION"
  mkdir -p "$panel_profile"
  ensure_chromium_profile_prefs "$panel_profile"
  cleanup_stale_profile_singletons "$panel_profile"
  mapfile -t flags < <(read_flags)
  mapfile -t base_args < <(chromium_base_args)
  DISPLAY="$TIKPAL_KIOSK_DISPLAY" "$TIKPAL_CHROMIUM_BIN" \
    "${flags[@]}" \
    "${base_args[@]}" \
    "--app=$panel_url" \
    "--user-data-dir=$panel_profile" \
    "--window-position=$panel_position" \
    "--window-size=$(normalize_window_size "$TIKPAL_WEB_MODE_PANEL_WINDOW")" \
    >/dev/null 2>&1 9>&- &
  window="$(wait_for_profile_window "$panel_profile" 20 || true)"
  if [[ -n "$window" ]]; then
    tile_window "$window" "$panel_position" "$TIKPAL_WEB_MODE_PANEL_WINDOW"
    [[ "$hidden" == "1" ]] || raise_window "$window"
    return 0
  fi
  return 1
}

ensure_side_panel() {
  local opening_provider="${1:-}"
  local hidden="${2:-0}"
  local panel_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel"
  local panel_window
  panel_window="$(first_window_for_profile "$panel_profile" || true)"
  if [[ "$hidden" == "1" ]]; then
    if [[ -n "$panel_window" ]]; then
      tile_window_fast "$panel_window" "$TIKPAL_WEB_MODE_STAGE_POSITION" "$TIKPAL_WEB_MODE_PANEL_WINDOW"
      clear_window_above "$panel_window"
      return 0
    fi
    close_side_panel
    launch_side_panel "$opening_provider" 1 >/dev/null 2>&1 9>&- &
    return 0
  fi
  if [[ -n "$panel_window" ]]; then
    # Re-tile to final position — the panel may have been staged off-screen
    # by a previous hidden-mode launch (prewarm, prepare-entry).
    tile_window_fast "$panel_window" "$TIKPAL_WEB_MODE_PANEL_POSITION" "$TIKPAL_WEB_MODE_PANEL_WINDOW"
    return 0
  fi
  if side_panel_window_visible "$panel_profile"; then
    return 0
  fi
  close_side_panel
  launch_side_panel "$opening_provider" >/dev/null 2>&1 9>&- &
  return 0
}

prepare_entry_surfaces() {
  local provider="${1:-qq_music}"

  # This is deliberately only an initial-entry stage. It never launches or
  # reveals a provider, so the API can run it alongside the local-audio gate.
  # Use non-hidden mode so the panel appears at its final position (PANEL_POSITION)
  # immediately, making it visible during the audio gate and CDP wait.
  [[ -z "$(read_runtime_active_provider)" ]] || return 0
  hide_onboard
  ensure_side_panel "$provider" 0 || true
}

park_prepared_entry_surfaces() {
  # Audio release can fail after preparation has started. Restore the staged
  # surfaces off-screen so a failed Explore entry never leaves a visible veil.
  [[ -z "$(read_runtime_active_provider)" ]] || return 0
  park_side_panel_for_reopen
}

reveal_initial_entry_surfaces() {
  local target_window="$1"
  local panel_profile="$2"
  local panel_window
  panel_window="$(wait_for_profile_window "$panel_profile" 8 || true)"

  if [[ -n "$panel_window" ]]; then
    tile_window_fast "$panel_window" "$TIKPAL_WEB_MODE_PANEL_POSITION" "$TIKPAL_WEB_MODE_PANEL_WINDOW"
    clear_window_above "$panel_window"
    DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowlower "$panel_window" >/dev/null 2>&1 || true
  fi
  tile_window_fast "$target_window" "$TIKPAL_WEB_MODE_LEFT_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW"
  clear_window_above "$target_window"
  DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowlower "$target_window" >/dev/null 2>&1 || true
  sleep "$TIKPAL_WEB_MODE_ENTRY_REVEAL_SETTLE_SECONDS"
  [[ -n "$panel_window" ]] && raise_window_without_focus "$panel_window"
  raise_window "$target_window"
}

reveal_resident_initial_entry_surfaces() {
  local target_window="$1"
  local panel_profile="$2"
  local panel_window settle paint_settle
  panel_window="$(wait_for_profile_window "$panel_profile" 2 || true)"
  settle="$TIKPAL_WEB_MODE_RESIDENT_ENTRY_SETTLE_SECONDS"
  paint_settle="$TIKPAL_WEB_MODE_RESIDENT_ENTRY_PAINT_SETTLE_SECONDS"
  [[ "$settle" =~ ^[0-9]+([.][0-9]+)?$ ]] || settle=0.16
  [[ "$paint_settle" =~ ^[0-9]+([.][0-9]+)?$ ]] || paint_settle=0.5

  if [[ -n "$panel_window" ]]; then
    tile_window_fast "$panel_window" "$TIKPAL_WEB_MODE_PANEL_POSITION" "$TIKPAL_WEB_MODE_PANEL_WINDOW"
    clear_window_above "$panel_window"
    DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowlower "$panel_window" >/dev/null 2>&1 || true
  fi
  tile_window_fast "$target_window" "$TIKPAL_WEB_MODE_LEFT_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW"
  clear_window_above "$target_window"
  DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowlower "$target_window" >/dev/null 2>&1 || true
  sleep "$settle"
  sleep "$paint_settle"
  tile_window_fast "$target_window" "$TIKPAL_WEB_MODE_LEFT_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW"
  mark_window_above "$target_window"
  raise_window "$target_window"
  [[ -n "$panel_window" ]] && raise_window_without_focus "$panel_window"
}

reveal_resident_provider_surfaces() {
  local target_window="$1"
  local provider_profile="$2"
  local panel_profile="$3"
  local previous_profile="${4:-}"
  local transition_shown_ms="${5:-0}"
  local provider_port="${6:-}"
  local panel_window
  panel_window="$(wait_for_profile_window "$panel_profile" 8 || true)"
  if [[ -n "$panel_window" ]]; then
    restore_window_opacity "$panel_window"
    tile_window_fast "$panel_window" "$TIKPAL_WEB_MODE_PANEL_POSITION" "$TIKPAL_WEB_MODE_PANEL_WINDOW"
    mark_window_above "$panel_window"
    raise_window_without_focus "$panel_window"
  fi
  reveal_resident_provider_window "$target_window" "$previous_profile" "$provider_profile" "$transition_shown_ms" "$provider_port"
  raise_onboard
}

reveal_resident_provider_window() {
  local target_window="$1"
  local previous_profile="${2:-}"
  local provider_profile="${3:-}"
  local transition_shown_ms="${4:-0}"
  local provider_port="${5:-}"
  local started_ms="$(now_ms)"
  # Restore opacity before reveal — park_profile_windows_for_reopen sets 0
  # to avoid white flash during the async off-screen move.
  restore_window_opacity "$target_window"
  # If CDP already proves the provider has a real HTTPS page, the compositor
  # has rendered meaningful content.  Skip the slow X11 paint check and settle
  # delay entirely — the 3 s timeout on 115 always fails even when the window
  # has visible content.
  if [[ -n "$provider_port" ]] && provider_has_real_provider_page "$provider_port"; then
    log_stage "reveal_cdp_skip_paint target=$target_window port=$provider_port ms=$(( $(now_ms) - started_ms ))"
    # Raise the new window FIRST so the user sees it immediately.
    # Park old windows AFTER — the new window covers them, so parking
    # latency is invisible.  This matters when the X server is busy
    # rendering the kiosk UI (xdotool calls take 3+ s under load).
    mark_window_above "$target_window"
    raise_window "$target_window"
    log_stage "reveal_physical target=$target_window provider_port=$provider_port ms=$(( $(now_ms) - started_ms ))"
    if [[ -n "$previous_profile" && "$previous_profile" != "$provider_profile" ]]; then
      park_profile_windows_for_reopen "$previous_profile" "$TIKPAL_WEB_MODE_LEFT_WINDOW" || true
    fi
    return 0
  fi
  # Tile and lower only if not already pre-positioned by the caller.
  if ! check_target_window_probe "$target_window" 2>/dev/null; then
    tile_window_fast "$target_window" "$TIKPAL_WEB_MODE_LEFT_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW"
    clear_window_above "$target_window"
    DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowlower "$target_window" >/dev/null 2>&1 || true
  fi
  if [[ "$TIKPAL_WEB_MODE_RESIDENT_SWITCH_SETTLE_SECONDS" =~ ^[0-9]+([.][0-9]+)?$ ]] \
    && [[ "$TIKPAL_WEB_MODE_RESIDENT_SWITCH_SETTLE_SECONDS" != "0" ]]; then
    sleep "$TIKPAL_WEB_MODE_RESIDENT_SWITCH_SETTLE_SECONDS"
  fi
  log_stage "reveal_paint_check target=$target_window port=$provider_port ms=$(( $(now_ms) - started_ms ))"
  # Verify the target window itself before letting it rise above the shared
  # transition.  This keeps Chromium's blank first compositor frame and the
  # kiosk underneath from becoming visible during a resident switch.
  # A background probe may have already confirmed the frame; skip the
  # synchronous wait when it has.  CDP proves that the provider loaded, but
  # cannot prove the compositor has painted its visible X11 surface.
  local _paint_check_ms=$(( $(now_ms) ))
  if ! check_target_window_probe "$target_window" && ! wait_for_provider_window_nonblank_x11_frame "$target_window"; then
    cleanup_target_window_probe "$target_window"
    clear_window_above "$target_window"
    DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowlower "$target_window" >/dev/null 2>&1 || true
    log_stage "reveal_paint_failed target=$target_window port=$provider_port elapsed_ms=$(( $(now_ms) - _paint_check_ms ))"
    return 1
  fi
  cleanup_target_window_probe "$target_window"
  log_stage "reveal_paint_ok target=$target_window elapsed_ms=$(( $(now_ms) - _paint_check_ms ))"
  if [[ -n "$previous_profile" && "$previous_profile" != "$provider_profile" ]]; then
    park_profile_windows_for_reopen "$previous_profile" "$TIKPAL_WEB_MODE_LEFT_WINDOW" || true
  fi
  mark_window_above "$target_window"
  raise_window "$target_window"
  log_stage "reveal_physical target=$target_window provider_port=$provider_port ms=$(( $(now_ms) - started_ms ))"
  # The transition profile is kept alive and off-screen for the next switch;
  # do not tear it down after a successful reveal.
}

reassert_visible_provider_surfaces() {
  local target_window="$1"
  local provider_profile="$2"
  local panel_profile="$3"
  local panel_window
  panel_window="$(wait_for_profile_window "$panel_profile" 4 || true)"
  if [[ -n "$panel_window" ]]; then
    tile_window_fast "$panel_window" "$TIKPAL_WEB_MODE_PANEL_POSITION" "$TIKPAL_WEB_MODE_PANEL_WINDOW"
    mark_window_above "$panel_window"
    raise_window_without_focus "$panel_window"
  fi
  tile_window_fast "$target_window" "$TIKPAL_WEB_MODE_LEFT_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW"
  mark_window_above "$target_window"
  raise_window "$target_window"
}

launch_provider_for_pool() {
  local provider="$1"
  local wait_ready="${2:-1}"
  local launch_role="${3:-active}"
  local force_existing="${4:-0}"
  local url provider_profile provider_port launch_url extension_enabled=0
  local target_window proxy_line proxy_enabled proxy_url target_audio_device lock_timeout window_position launch_started_ms
  local wait_for_entry=0 wait_for_full_ready=0
  case "$wait_ready" in
    1|ready)
      wait_for_entry=1
      wait_for_full_ready=1
      ;;
    entry)
      wait_for_entry=1
      ;;
  esac
  if command -v flock >/dev/null 2>&1 && [[ "${TIKPAL_WEB_MODE_PROVIDER_LAUNCH_LOCKED:-0}" != "1" ]]; then
    lock_timeout="$TIKPAL_WEB_MODE_PROVIDER_WINDOW_TIMEOUT_SECONDS"
    [[ "$launch_role" == "prewarm" ]] && lock_timeout="$TIKPAL_WEB_MODE_PROVIDER_PREWARM_LOCK_TIMEOUT_SECONDS"
    mkdir -p "$TIKPAL_WEB_MODE_PROFILE_ROOT"
    (
      flock -x -w "$lock_timeout" 7 || exit 75
      TIKPAL_WEB_MODE_PROVIDER_LAUNCH_LOCKED=1 launch_provider_for_pool "$provider" "$wait_ready" "$launch_role" "$force_existing"
    ) 7>"$TIKPAL_WEB_MODE_PROFILE_ROOT/provider-$provider.launch.lock"
    local lock_status=$?
    if [[ "$lock_status" == "75" ]]; then
      rm -f "$TIKPAL_WEB_MODE_PROFILE_ROOT/provider-$provider.launch.lock"
      return 1
    fi
    return "$lock_status"
  fi

  url="$(provider_url "$provider")"
  provider_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$provider"
  provider_port="$(provider_debug_port "$provider")"
  window_position="$(provider_launch_position "$launch_role")"
  launch_started_ms="$(now_ms)"
  log_stage "provider_launch provider=$provider role=$launch_role force=$force_existing"
  if [[ "$launch_role" == "prewarm" && -z "$(read_runtime_active_provider)" ]] && ! is_enabled "${TIKPAL_WEB_MODE_IDLE_POOL_WARMUP:-0}"; then
    return 0
  fi
  proxy_line="$(read_proxy_settings)"
  proxy_enabled="$(effective_provider_proxy_enabled "$provider" "${proxy_line%%$'\t'*}")"
  proxy_url="${proxy_line#*$'\t'}"
  launch_url="$url"
  if [[ "$proxy_enabled" != "1" ]] && ! provider_prefers_direct_proxy "$provider" && ! provider_direct_reachable "$provider"; then
    write_runtime_provider_status "$provider" "check_proxy" "$(provider_needs_proxy_message "$provider")"
    [[ "$launch_role" == "prewarm" ]] && return 0
    return 1
  fi

  if is_enabled "$TIKPAL_WEB_MODE_EXTENSION_ENABLED" && [[ -f "$TIKPAL_WEB_MODE_EXTENSION_DIR/manifest.json" ]]; then
    extension_enabled=1
  fi

  if profile_process_exists "$provider_profile"; then
    if ! provider_has_real_provider_page "$provider_port"; then
      if [[ "$launch_role" == "prewarm" && "$force_existing" == "1" ]]; then
        write_runtime_provider_status "$provider" "prewarming"
        if ! navigate_provider_target "$provider_port" "$url" || ! wait_for_real_provider_url "$provider_port"; then
          write_runtime_provider_status "$provider" "check_setup" "$(provider_label "$provider") did not enter the provider page"
          return 0
        fi
      else
        write_runtime_provider_status "$provider" "check_setup" "$(provider_label "$provider") did not enter the provider page"
        [[ "$launch_role" == "prewarm" ]] && return 0
        return 1
      fi
    elif [[ "$launch_role" == "prewarm" && "$force_existing" == "1" ]]; then
      write_runtime_provider_status "$provider" "prewarming"
      if ! navigate_provider_target "$provider_port" "$url" || ! wait_for_real_provider_url "$provider_port"; then
        write_runtime_provider_status "$provider" "check_setup" "$(provider_label "$provider") could not reopen"
        return 0
      fi
    fi
    start_provider_guard "$provider" "$provider_profile" "$url" "$proxy_enabled" "$provider_port"
    log_stage "provider_https_ready provider=$provider role=$launch_role reused=1 ms=$(( $(now_ms) - launch_started_ms ))"
    if [[ "$launch_role" == "prewarm" && -z "$(read_runtime_active_provider)" ]] && ! is_enabled "${TIKPAL_WEB_MODE_IDLE_POOL_WARMUP:-0}"; then
      return 0
    fi
    if [[ "$launch_role" == "prewarm" ]]; then
      if provider_has_real_provider_page "$provider_port"; then
        write_runtime_provider_status "$provider" "ready"
        return 0
      fi
      write_runtime_provider_status "$provider" "check_setup" "$(provider_label "$provider") did not enter the provider page"
      return 0
    fi
    if ! wait_for_provider_ready "$provider_port" "$provider"; then
      write_runtime_provider_status "$provider" "check_setup" "$(provider_label "$provider") did not become ready"
      return 1
    fi
    write_runtime_provider_status "$provider" "ready"
    return 0
  fi

  if [[ "$launch_role" == "prewarm" ]]; then
    write_runtime_provider_status "$provider" "prewarming"
  else
    write_runtime_provider_status "$provider" "opening"
  fi
  resolve_web_mode_audio_devices
  target_audio_device="$TIKPAL_WEB_MODE_ALSA_OUTPUT_DEVICE"
  mkdir -p "$provider_profile"
  ensure_chromium_profile_prefs "$provider_profile"
  seed_profile_widevine_cdm "$provider_profile"
  cleanup_stale_profile_singletons "$provider_profile"
  refresh_extension_script_cache "$provider_profile"
  mapfile -t flags < <(read_flags)
  mapfile -t base_args < <(chromium_base_args)

  local args=(
    "${flags[@]}"
    "${base_args[@]}"
    "--app=$launch_url"
    "--user-data-dir=$provider_profile"
    "--remote-debugging-address=127.0.0.1"
    "--remote-debugging-port=$provider_port"
    "--window-position=$window_position"
    "--window-size=$(normalize_window_size "$TIKPAL_WEB_MODE_LEFT_WINDOW")"
  )

  if is_enabled "$TIKPAL_WEB_MODE_DISABLE_HANG_MONITOR"; then
    args+=("--disable-hang-monitor")
  fi
  if [[ "$extension_enabled" == "1" ]]; then
    args+=("--load-extension=$TIKPAL_WEB_MODE_EXTENSION_DIR")
  fi
  if [[ -n "$target_audio_device" ]]; then
    args+=("--alsa-output-device=$target_audio_device")
  fi
  if [[ "$proxy_enabled" == "1" && -n "$proxy_url" ]]; then
    args+=("--proxy-server=$proxy_url")
    args+=("--proxy-bypass-list=localhost;127.0.0.1;<local>")
  fi

  DISPLAY="$TIKPAL_KIOSK_DISPLAY" "$TIKPAL_CHROMIUM_BIN" "${args[@]}" >/dev/null 2>&1 7>&- 9>&- &
  target_window="$(wait_for_profile_window "$provider_profile" "$(profile_window_timeout_attempts "$TIKPAL_WEB_MODE_PROVIDER_WINDOW_TIMEOUT_SECONDS")" || true)"
  if [[ -z "$target_window" ]]; then
    close_provider_profile "$provider_profile"
    if [[ "$launch_role" == "prewarm" && -z "$(read_runtime_active_provider)" ]] && ! is_enabled "${TIKPAL_WEB_MODE_IDLE_POOL_WARMUP:-0}"; then
      return 1
    fi
    write_runtime_provider_status "$provider" "check_setup" "$(provider_label "$provider") did not open"
    return 1
  fi
  tile_window "$target_window" "$window_position" "$TIKPAL_WEB_MODE_LEFT_WINDOW"
  start_provider_guard "$provider" "$provider_profile" "$url" "$proxy_enabled" "$provider_port"

  if [[ "$wait_for_entry" == "1" ]]; then
    if ! wait_for_real_provider_url "$provider_port"; then
      if [[ "$launch_role" == "prewarm" && -z "$(read_runtime_active_provider)" ]] && ! is_enabled "${TIKPAL_WEB_MODE_IDLE_POOL_WARMUP:-0}"; then
        return 1
      fi
      write_runtime_provider_status "$provider" "check_setup" "$(provider_label "$provider") did not enter the provider page"
      return 1
    fi
    log_stage "provider_https_ready provider=$provider role=$launch_role reused=0 ms=$(( $(now_ms) - launch_started_ms ))"
  fi
  if [[ "$wait_for_full_ready" == "1" ]]; then
    if ! wait_for_provider_ready "$provider_port" "$provider"; then
      if [[ "$launch_role" == "prewarm" && -z "$(read_runtime_active_provider)" ]] && ! is_enabled "${TIKPAL_WEB_MODE_IDLE_POOL_WARMUP:-0}"; then
        return 1
      fi
      write_runtime_provider_status "$provider" "check_setup" "$(provider_label "$provider") did not become ready"
      return 1
    fi
  fi
  if [[ "$launch_role" == "prewarm" && -z "$(read_runtime_active_provider)" ]] && ! is_enabled "${TIKPAL_WEB_MODE_IDLE_POOL_WARMUP:-0}"; then
    return 0
  fi
  if [[ "$wait_for_full_ready" != "1" ]]; then
    if [[ "$launch_role" == "prewarm" ]]; then
      # Prewarm is complete as soon as a real HTTPS provider page exists. The
      # slower DOM probe remains reserved for foreground cold starts.
      write_runtime_provider_status "$provider" "ready"
    fi
    return 0
  fi
  write_runtime_provider_status "$provider" "ready"
}

provider_prewarm_max_concurrent_launches() {
  local maximum="${TIKPAL_WEB_MODE_PROVIDER_PREWARM_MAX_CONCURRENT_LAUNCHES:-2}"
  [[ "$maximum" =~ ^[0-9]+$ ]] || maximum=2
  [[ "$maximum" -gt 0 ]] || maximum=1
  [[ "$maximum" -le 10 ]] || maximum=10
  printf '%s\n' "$maximum"
}

provider_prewarm_queue_can_continue() {
  local active_provider="$1"
  local queue_mode="$2"
  local current_active
  current_active="$(read_runtime_active_provider)"

  if [[ "$queue_mode" == "idle" ]]; then
    if [[ -n "$current_active" ]]; then
      log "idle provider pool warmup paused because Explore is active"
      return 1
    fi
    return 0
  fi

  if [[ -n "$active_provider" && "$current_active" != "$active_provider" ]]; then
    log "provider prewarm abandoned: active provider changed from $active_provider"
    return 1
  fi
  if [[ -z "$current_active" ]] && ! is_enabled "$TIKPAL_WEB_MODE_PROVIDER_PREWARM_CONTINUE_AFTER_CLOSE"; then
    log "provider prewarm paused because Explore closed"
    return 1
  fi
  return 0
}

launch_provider_prewarm_worker() {
  local provider="$1"
  local active_provider="$2"
  local force_existing="$3"
  local queue_mode="$4"
  local current_active started_ms elapsed_ms status
  provider_prewarm_queue_can_continue "$active_provider" "$queue_mode" || return 0
  started_ms="$(now_ms)"
  log_stage "prewarm_launch provider=$provider mode=$queue_mode"
  current_active="$(read_runtime_active_provider)"
  if [[ "$queue_mode" == "idle" || -z "$current_active" ]]; then
    TIKPAL_WEB_MODE_IDLE_POOL_WARMUP=1 launch_provider_for_pool "$provider" entry prewarm "$force_existing" || true
  else
    launch_provider_for_pool "$provider" entry prewarm "$force_existing" || true
  fi
  elapsed_ms="$(( $(now_ms) - started_ms ))"
  status="$(read_runtime_provider_status "$provider")"
  log_stage "prewarm_page_ready provider=$provider status=$status ms=$elapsed_ms"
}

# After the main prewarm queue completes, retry providers that ended up in
# check_setup but still have a live Chromium process.  One retry with the
# normal bootstrap timeout is enough; a second failure leaves the provider
# marked for manual inspection.
retry_failed_prewarm_providers() {
  local active_provider="$1"
  local queue_mode="$2"
  local provider profile provider_port status retried=0
  while IFS= read -r provider; do
    [[ -n "$provider" && "$provider" != "$active_provider" ]] || continue
    provider_prewarm_queue_can_continue "$active_provider" "$queue_mode" || return 0
    status="$(read_runtime_provider_status "$provider")"
    [[ "$status" == "check_setup" ]] || continue
    profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$provider"
    profile_process_exists "$profile" || continue
    provider_port="$(provider_debug_port "$provider")"
    log "retrying prewarm for $provider (was check_setup)"
    write_runtime_provider_status "$provider" "prewarming"
    launch_provider_for_pool "$provider" entry prewarm 1 || true
    retried=$((retried + 1))
  done < <(provider_prewarm_order)
  [[ "$retried" -eq 0 ]] || log "retried $retried failed prewarm providers"
}

provider_prewarm_queue_is_complete() {
  node - "$TIKPAL_WEB_MODE_STATE_PATH" "$(provider_ids | tr '\n' ',' | sed 's/,$//')" <<'NODE'
const fs = require("node:fs");
const [statePath, providerList] = process.argv.slice(2);
const completeStatuses = new Set(["ready", "active", "check_setup", "check_proxy", "region_unavailable"]);
try {
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const providers = state.residentProviders && typeof state.residentProviders === "object" ? state.residentProviders : {};
  const ids = String(providerList || "").split(",").filter(Boolean);
  process.exit(ids.every((id) => { const s = String(providers[id]?.status || ""); return !s || completeStatuses.has(s); }) ? 0 : 1);
} catch {
  process.exit(1);
}
NODE
}

run_provider_prewarm_queue() {
  local active_provider="$1"
  local force_existing="$2"
  local queue_mode="$3"
  local provider worker_pid current_active
  local maximum delay interrupted=0
  local -a worker_pids=()
  local -a remaining_pids=()

  maximum="$(provider_prewarm_max_concurrent_launches)"
  delay="$TIKPAL_WEB_MODE_PROVIDER_PREWARM_DELAY_SECONDS"
  [[ "$delay" =~ ^[0-9]+([.][0-9]+)?$ ]] || delay=0.75

  while IFS= read -r provider; do
    [[ -n "$provider" && "$provider" != "$active_provider" ]] || continue
    provider_prewarm_queue_can_continue "$active_provider" "$queue_mode" || {
      interrupted=1
      break
    }
    while [[ "${#worker_pids[@]}" -ge "$maximum" ]]; do
      remaining_pids=()
      for worker_pid in "${worker_pids[@]}"; do
        if kill -0 "$worker_pid" >/dev/null 2>&1; then
          remaining_pids+=("$worker_pid")
        else
          wait "$worker_pid" >/dev/null 2>&1 || true
        fi
      done
      worker_pids=("${remaining_pids[@]}")
      [[ "${#worker_pids[@]}" -lt "$maximum" ]] && break
      provider_prewarm_queue_can_continue "$active_provider" "$queue_mode" || {
        interrupted=1
        break 2
      }
      sleep 0.05
    done
    (
      launch_provider_prewarm_worker "$provider" "$active_provider" "$force_existing" "$queue_mode"
    ) &
    worker_pids+=("$!")
    sleep "$delay"
  done < <(provider_prewarm_order)

  for worker_pid in "${worker_pids[@]}"; do
    wait "$worker_pid" >/dev/null 2>&1 || true
  done

  provider_prewarm_queue_can_continue "$active_provider" "$queue_mode" || interrupted=1
  if [[ "$interrupted" == "1" ]]; then
    current_active="$(read_runtime_active_provider)"
    sync_runtime_provider_pool_process_statuses "$current_active"
    if provider_prewarm_queue_is_complete; then
      write_runtime_prewarm_complete 1
      log "provider prewarm queue completed after settling interrupted queue"
    fi
    return 0
  fi
  current_active="$(read_runtime_active_provider)"
  sync_runtime_provider_pool_process_statuses "$current_active"
  if provider_prewarm_queue_is_complete; then
    write_runtime_prewarm_complete 1
    log "provider prewarm queue completed: max-concurrent=$maximum"
  else
    log "provider prewarm queue incomplete: max-concurrent=$maximum"
  fi
}

prewarm_provider_pool() {
  local active_provider="${1:-}"
  local current_active force_existing pid_file active_file
  is_enabled "$TIKPAL_WEB_MODE_PROVIDER_PREWARM_ENABLED" || return 0
  pid_file="$(prewarm_pid_file)"
  active_file="$(prewarm_active_provider_file)"
  mkdir -p "$(dirname "$pid_file")"
  printf '%s\n' "$BASHPID" > "$pid_file"
  printf '%s\n' "$active_provider" > "$active_file"
  prewarm_provider_pool_cleanup() {
    local pf af
    pf="$(prewarm_pid_file)" || return 0
    af="$(prewarm_active_provider_file)" || return 0
    [[ "$(cat "$pf" 2>/dev/null || true)" == "$BASHPID" ]] || return 0
    rm -f "$pf" "$af"
  }
  trap prewarm_provider_pool_cleanup EXIT
  current_active="$(read_runtime_active_provider)"
  [[ -z "$active_provider" || "$current_active" == "$active_provider" ]] || {
    log "provider prewarm abandoned: active provider changed from $active_provider"
    return 0
  }
  seed_runtime_provider_pool_statuses "$active_provider"
  force_existing="${TIKPAL_WEB_MODE_PROVIDER_PREWARM_FORCE:-0}"
  run_provider_prewarm_queue "$active_provider" "$force_existing" active
}

start_provider_pool_prewarm() {
  local active_provider="$1"
  local seed_mode="${2:-preserve}"
  local allow_active_clear="${3:-1}"
  local force_env=() running_active_provider
  is_enabled "$TIKPAL_WEB_MODE_PROVIDER_POOL" || return 0
  is_enabled "$TIKPAL_WEB_MODE_PROVIDER_PREWARM_ENABLED" || return 0
  if [[ "$seed_mode" != "force" ]] && provider_prewarm_queue_running; then
    running_active_provider="$(cat "$(prewarm_active_provider_file)" 2>/dev/null || true)"
    if [[ "$running_active_provider" == "$active_provider" ]]; then
      log "provider pool prewarm already running"
      return 0
    fi
    log "replacing stale provider prewarm for $running_active_provider"
  fi
  stop_provider_pool_prewarm
  if [[ "$seed_mode" != "force" ]] && ! provider_pool_needs_prewarm "$active_provider"; then
    sync_runtime_provider_pool_process_statuses "$active_provider" "$allow_active_clear"
    write_runtime_prewarm_complete 1
    log "provider pool already resident; prewarm skipped"
    return 0
  fi
  mkdir -p "$TIKPAL_WEB_MODE_PROFILE_ROOT"
  seed_runtime_provider_pool_statuses "$active_provider" "$seed_mode"
  if [[ "$seed_mode" == "force" ]]; then
    force_env=(env TIKPAL_WEB_MODE_PROVIDER_PREWARM_FORCE=1)
  fi
  if command -v setsid >/dev/null 2>&1; then
    "${force_env[@]}" setsid "$SCRIPT_DIR/tikpal-web-mode.sh" prewarm "$active_provider" </dev/null >/dev/null 2>&1 9>&- &
  else
    "${force_env[@]}" nohup "$SCRIPT_DIR/tikpal-web-mode.sh" prewarm "$active_provider" </dev/null >/dev/null 2>&1 9>&- &
  fi
  printf '%s\n' "$!" > "$(prewarm_pid_file)"
  printf '%s\n' "$active_provider" > "$(prewarm_active_provider_file)"
}

warm_provider_pool() {
  local pid_file
  is_enabled "$TIKPAL_WEB_MODE_PROVIDER_POOL" || return 0
  is_enabled "$TIKPAL_WEB_MODE_PROVIDER_IDLE_POOL_ENABLED" || return 0
  is_enabled "$TIKPAL_WEB_MODE_PROVIDER_PREWARM_ENABLED" || return 0
  stop_provider_pool_prewarm
  pid_file="$(prewarm_pid_file)"
  mkdir -p "$(dirname "$pid_file")"
  printf '%s\n' "$BASHPID" > "$pid_file"
  warm_provider_pool_cleanup() {
    local pf
    pf="$(prewarm_pid_file)" || return 0
    [[ "$(cat "$pf" 2>/dev/null || true)" == "$BASHPID" ]] && rm -f "$pf"
  }
  trap warm_provider_pool_cleanup EXIT
  hide_onboard
  # Clear stale state from previous session so idle queue always runs.
  write_runtime_provider_state ""
  rm -f "$(pool_warm_stamp_file)"
  seed_runtime_provider_pool_statuses "" force
  if [[ -z "$(read_runtime_active_provider)" ]]; then
    ensure_side_panel "" 1
  fi
  run_provider_prewarm_queue "" force idle
  if ! provider_prewarm_queue_is_complete; then
    local current_active
    current_active="$(read_runtime_active_provider)"
    sync_runtime_provider_pool_process_statuses "$current_active" 0
  fi
  if provider_prewarm_queue_is_complete; then
    write_runtime_prewarm_complete 1
    touch "$(pool_warm_stamp_file)"
    log "warmed provider pool"
  else
    log "warm provider pool incomplete; providers will reconcile on next open"
  fi
}

open_provider_pool() {
  local provider="$1"
  local provider_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$provider"
  local current_provider current_profile target_window="" proxy_line proxy_enabled message extension_enabled=0 entry_stage=0
  local resident_status fast_resident=0 switching_provider=0 current_port provider_port
  local started_ms reveal_ms command_return_ms transition_shown_ms=0
  if ! runtime_open_request_is_current; then
    log "open abandoned: active provider no longer ${TIKPAL_WEB_MODE_OPEN_EXPECTED_ACTIVE_PROVIDER}"
    return 0
  fi
  started_ms="$(now_ms)"
  current_provider="$(read_runtime_active_provider)"
  current_profile=""
  if [[ -n "$current_provider" ]]; then
    current_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$current_provider"
    if ! profile_process_exists "$current_profile"; then
      write_runtime_provider_state ""
      current_provider=""
      current_profile=""
    fi
  fi
  [[ -z "$current_provider" ]] && entry_stage=1
  [[ "$entry_stage" != "1" && "$current_provider" != "$provider" ]] && switching_provider=1
  resident_status="$(read_runtime_provider_status "$provider")"
  provider_port="$(provider_debug_port "$provider")"
  if profile_process_exists "$provider_profile"; then
    target_window="$(first_window_for_profile "$provider_profile" || true)"
    local cdp_json_list=""
    if [[ -n "$target_window" ]]; then
      cdp_json_list="$(timeout 0.8 curl --noproxy '*' -sf --connect-timeout 1 --max-time 1 "http://127.0.0.1:$provider_port/json/list" 2>/dev/null || true)"
      if printf '%s' "$cdp_json_list" | node -e 'let b="";process.stdin.on("data",c=>b+=c);process.stdin.on("end",()=>{try{process.exit(JSON.parse(b).some(t=>t.type==="page"&&String(t.url||"").startsWith("https://"))?0:1)}catch{process.exit(1)}})'; then
        fast_resident=1
      fi
    fi
  fi
  log_stage "open_pool_init provider=$provider fast_resident=$fast_resident switching=$switching_provider entry=$entry_stage ms=$(( $(now_ms) - started_ms ))"
  # A foreground choice owns the pool from this point. Stop both idle and
  # active background queues before a hot reveal as well as a cold launch.
  # Stop the old X11 guard first: it otherwise keeps raising the old provider
  # while terminating a prewarm worker, which exposes its black first frame.
  if [[ "$switching_provider" == "1" ]]; then
    begin_provider_switch_guard
    stop_window_guard
    # Pause old provider's media before switch to prevent audio mixing.
    if [[ -n "$current_provider" ]]; then
      pause_provider_media_via_cdp "$(provider_debug_port "$current_provider")" "$cdp_json_list" || log "WARN: could not pause $current_provider media via CDP"
    fi
    if [[ "$fast_resident" == "1" ]]; then
      # CDP fast path: skip the fade animation.  The new window will be
      # raised on top of the old one instantly.  The fade's xprop calls
      # take 1+ seconds when the X server is busy rendering the kiosk UI.
      transition_shown_ms="$(now_ms)"
      log_stage "open_pool_transition provider=$provider transition_shown=$transition_shown_ms ms=$(( $(now_ms) - started_ms )) cdp_skip_fade=1"
    else
      if ! begin_provider_switch_transition "$current_profile" "$provider" "$target_window"; then
        message="Explore transition cover is unavailable"
        recover_or_cover_provider_failure "$current_provider" "$current_profile" "$provider" "check_setup" "$message" || true
        fail "$message"
      fi
      transition_shown_ms="$TIKPAL_WEB_MODE_TRANSITION_SHOWN_MS"
      log_stage "open_pool_transition provider=$provider transition_shown=$transition_shown_ms ms=$(( $(now_ms) - started_ms ))"
    fi
  fi
  if [[ -f "$(pool_warm_stamp_file)" ]]; then
    if provider_prewarm_queue_running; then
      stop_provider_pool_prewarm
    fi
  fi
  # A newer sidebar choice owns the pending request. Do not carry this stale
  # foreground command through another resident reveal while it holds the
  # shared web-mode lock; the server will run the newest request next.
  if ! runtime_open_request_is_current; then
    clear_provider_switch_guard
    log "open abandoned before resident reveal: $provider"
    return 0
  fi
  # A single bounded CDP read can lose a just-woken resident renderer. Retry
  # only after the shared transition has covered the old page, with the normal
  # bootstrap deadline; do not cold-restart a profile that then proves to have
  # a real provider page.
  if [[ "$fast_resident" != "1" && "$entry_stage" != "1" && -n "$target_window" ]] \
    && profile_process_exists "$provider_profile"; then
    if wait_for_real_provider_url "$provider_port"; then
      log_stage "open_pool_bootstrap provider=$provider result=ok ms=$(( $(now_ms) - started_ms ))"
      fast_resident=1
    elif [[ "$resident_status" == "ready" || "$resident_status" == "active" ]]; then
      write_runtime_provider_status "$provider" "check_setup" "$(provider_label "$provider") did not enter the provider page"
      log_stage "open_pool_bootstrap provider=$provider result=fail ms=$(( $(now_ms) - started_ms ))"
    else
      log_stage "open_pool_bootstrap provider=$provider result=fail ms=$(( $(now_ms) - started_ms ))"
    fi
  fi
  if [[ "$fast_resident" == "1" && "$entry_stage" != "1" ]]; then
    stop_window_guard
    if ! runtime_open_request_is_current; then
      clear_provider_switch_guard
      log "open abandoned before resident reveal: $provider"
      return 0
    fi
    if [[ "$entry_stage" != "1" && "$switching_provider" == "1" ]]; then
      # begin_provider_switch_transition ran exactly once before the resident
      # path. Its transition or background cover remains visible while this
      # target probe verifies a non-empty X11 frame.
      if [[ -n "$target_window" ]]; then
        tile_window_fast "$target_window" "$TIKPAL_WEB_MODE_LEFT_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW"
        clear_window_above "$target_window"
        DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool_safe windowlower "$target_window" >/dev/null 2>&1 || true
      fi
    fi
    # Ensure old provider media is paused before reveal.
    if [[ "$switching_provider" == "1" && -n "$current_provider" ]]; then
      pause_provider_media_via_cdp "$(provider_debug_port "$current_provider")" "$cdp_json_list" || true
    fi
    if reveal_resident_provider_window "$target_window" "$current_profile" "$provider_profile" "$transition_shown_ms" "$provider_port"; then
      invalidate_chromium_window_cache
      reveal_ms="$(( $(now_ms) - started_ms ))"
      log_stage "reveal_ms=$reveal_ms provider=$provider resident=1"
      clear_provider_switch_guard
      if ! runtime_open_request_is_current; then
        log "open abandoned before resident commit: $provider"
        return 0
      fi
      commit_visible_provider_state "$provider"
      write_audio_bus_state ""
      start_window_guard "$provider_profile" "$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel"
      reconcile_provider_pool_in_background "$provider"
      command_return_ms="$(( $(now_ms) - started_ms ))"
      log_stage "command_return_ms=$command_return_ms provider=$provider resident=1"
      log "opened $provider"
      return 0
    fi
    # Paint check failed, but the provider process may still be healthy.
    # Verify via CDP before killing the profile for a cold relaunch.
    if provider_has_real_provider_page "$provider_port"; then
      log "resident $provider paint failed but CDP confirms real page; reusing"
      tile_window_fast "$target_window" "$TIKPAL_WEB_MODE_LEFT_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW"
      mark_window_above "$target_window"
      raise_window "$target_window"
      invalidate_chromium_window_cache
      reveal_ms="$(( $(now_ms) - started_ms ))"
      log_stage "reveal_ms=$reveal_ms provider=$provider resident=1 cdp_fallback=1"
      clear_provider_switch_guard
      if ! runtime_open_request_is_current; then
        log "open abandoned before resident commit: $provider"
        return 0
      fi
      commit_visible_provider_state "$provider"
      write_audio_bus_state ""
      start_window_guard "$provider_profile" "$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel"
      reconcile_provider_pool_in_background "$provider"
      command_return_ms="$(( $(now_ms) - started_ms ))"
      log_stage "command_return_ms=$command_return_ms provider=$provider resident=1 cdp_fallback=1"
      log "opened $provider"
      return 0
    fi
    log "resident $provider did not paint and CDP confirms no real page; reopening"
    close_provider_profile "$provider_profile"
    fast_resident=0
  fi
  if is_enabled "$TIKPAL_WEB_MODE_EXTENSION_ENABLED" && [[ -f "$TIKPAL_WEB_MODE_EXTENSION_DIR/manifest.json" ]]; then
    extension_enabled=1
  fi

  hide_onboard
  # Use non-hidden mode so the panel is placed at its final position
  # immediately, rather than being staged off-screen and re-tiled later.
  # This makes the side panel visible during the long CDP/provider wait.
  if ! ensure_side_panel "$provider" 0; then
    close_web_mode
    fail "Explore side panel did not open"
  fi
  proxy_line="$(read_proxy_settings)"
  proxy_enabled="$(effective_provider_proxy_enabled "$provider" "${proxy_line%%$'\t'*}")"
  if [[ "$proxy_enabled" != "1" ]] && ! provider_prefers_direct_proxy "$provider" && ! provider_direct_reachable "$provider"; then
    message="$(provider_needs_proxy_message "$provider")"
    recover_or_cover_provider_failure "$current_provider" "$current_profile" "$provider" "check_proxy" "$message" || true
    fail "$message"
  fi
  stop_window_guard
  if [[ "$fast_resident" != "1" ]] && profile_process_exists "$provider_profile"; then
    close_provider_profile "$provider_profile"
  fi

  if profile_process_exists "$provider_profile"; then
    if [[ "$fast_resident" != "1" ]]; then
      start_provider_guard "$provider" "$provider_profile" "$(provider_url "$provider")" "$proxy_enabled" "$(provider_debug_port "$provider")"
      if [[ "$extension_enabled" == "1" ]] && ! provider_uses_direct_bootstrap "$provider" && ! wait_for_real_provider_url "$(provider_debug_port "$provider")"; then
        message="$(provider_label "$provider") did not enter the provider page"
        recover_or_cover_provider_failure "$current_provider" "$current_profile" "$provider" "check_setup" "$message" || true
        fail "$message"
      fi
    fi
  elif ! launch_provider_for_pool "$provider" entry; then
    message="$(provider_label "$provider") did not enter the provider page"
    recover_or_cover_provider_failure "$current_provider" "$current_profile" "$provider" "check_setup" "$message" || true
    fail "$message"
  fi

  target_window="$(wait_for_profile_window "$provider_profile" "$(profile_window_timeout_attempts "$TIKPAL_WEB_MODE_PROVIDER_WINDOW_TIMEOUT_SECONDS")" || true)"
  if [[ -z "$target_window" ]]; then
    message="$(provider_label "$provider") window is unavailable"
    recover_or_cover_provider_failure "$current_provider" "$current_profile" "$provider" "check_setup" "$message" || true
    fail "$(provider_label "$provider") did not open"
  fi
  if [[ "$fast_resident" != "1" && "$entry_stage" == "1" ]]; then
    wait_for_entry_provider_paint "$(provider_debug_port "$provider")" "$provider" "$target_window" || log "WARN: $(provider_label "$provider") did not complete DOM/X11 paint checks before entry reveal"
  elif [[ "$fast_resident" != "1" ]]; then
    if ! wait_for_provider_ready "$(provider_debug_port "$provider")" "$provider"; then
      message="$(provider_label "$provider") did not become ready"
      recover_or_cover_provider_failure "$current_provider" "$current_profile" "$provider" "check_setup" "$message" || true
      fail "$message"
    fi
  fi
  if [[ "$entry_stage" == "1" ]]; then
    if [[ "$fast_resident" == "1" ]]; then
      reveal_resident_initial_entry_surfaces "$target_window" "$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel"
    else
      reveal_initial_entry_surfaces "$target_window" "$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel"
    fi
    reassert_visible_provider_surfaces "$target_window" "$provider_profile" "$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel"
  else
    # Pause old provider media before reveal to prevent audio mixing.
    if [[ "$switching_provider" == "1" && -n "$current_provider" ]]; then
      pause_provider_media_via_cdp "$(provider_debug_port "$current_provider")" || true
    fi
    reveal_resident_provider_surfaces "$target_window" "$provider_profile" "$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel" "$current_profile" "$transition_shown_ms" "$provider_port"
  fi
  if ! runtime_open_request_is_current; then
    log "open abandoned before provider commit: $provider"
    return 0
  fi
  commit_visible_provider_state "$provider"
  reveal_ms="$(( $(now_ms) - started_ms ))"
  log_stage "reveal_ms=$reveal_ms provider=$provider resident=$fast_resident"
  clear_provider_switch_guard
  write_audio_bus_state ""
  start_window_guard "$provider_profile" "$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel"
  reconcile_provider_pool_in_background "$provider"
  command_return_ms="$(( $(now_ms) - started_ms ))"
  log_stage "command_return_ms=$command_return_ms provider=$provider resident=$fast_resident"
  log "opened $provider"
}

open_provider() {
  local provider="$1"
  if is_enabled "$TIKPAL_WEB_MODE_PROVIDER_POOL"; then
    open_provider_pool "$provider"
    return
  fi

  local url
  local provider_profile
  local provider_port
  local current_provider
  local current_profile
  local target_window launch_url extension_enabled=0
  local current_audio_bus="" target_audio_bus="" target_audio_device="" crossfade_switch=0
  local proxy_line proxy_enabled proxy_url
  local message
  local entry_stage=0 switching_provider=0 transition_shown_ms=0
  url="$(provider_url "$provider")"
  provider_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$provider"
  provider_port="$(provider_debug_port "$provider")"
  current_provider="$(read_runtime_active_provider)"
  current_profile=""
  if [[ -n "$current_provider" ]]; then
    current_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$current_provider"
  else
    entry_stage=1
  fi
  [[ "$entry_stage" != "1" && "$current_provider" != "$provider" ]] && switching_provider=1
  proxy_line="$(read_proxy_settings)"
  proxy_enabled="$(effective_provider_proxy_enabled "$provider" "${proxy_line%%$'\t'*}")"
  proxy_url="${proxy_line#*$'\t'}"
  launch_url="$url"
  if [[ "$proxy_enabled" != "1" ]] && ! provider_prefers_direct_proxy "$provider" && ! provider_direct_reachable "$provider"; then
    message="$(provider_needs_proxy_message "$provider")"
    ensure_side_panel "$provider"
    write_runtime_provider_status "$provider" "check_proxy" "$message"
    recover_or_cover_provider_failure "$current_provider" "$current_profile" "$provider" "check_proxy" "$message" || true
    fail "$message"
  fi
  if is_enabled "$TIKPAL_WEB_MODE_EXTENSION_ENABLED" && [[ -f "$TIKPAL_WEB_MODE_EXTENSION_DIR/manifest.json" ]]; then
    extension_enabled=1
  fi

  resolve_web_mode_audio_devices
  target_audio_device="$TIKPAL_WEB_MODE_ALSA_OUTPUT_DEVICE"

  if crossfade_available; then
    if [[ -n "$current_profile" && "$current_profile" != "$provider_profile" ]] && profile_process_exists "$current_profile"; then
      current_audio_bus="$(profile_audio_bus "$current_profile" || true)"
    fi
    if [[ "$current_audio_bus" == "a" ]]; then
      target_audio_bus="b"
      crossfade_switch=1
    elif [[ "$current_audio_bus" == "b" ]]; then
      target_audio_bus="a"
      crossfade_switch=1
    else
      target_audio_bus="a"
    fi
    if [[ "$crossfade_switch" == "1" ]]; then
      if ! crossfade_helper set "$target_audio_bus" 0 >/dev/null 2>&1; then
        log "WARN: Explore crossfade bus could not be muted; using direct provider audio"
        current_audio_bus=""
        target_audio_bus=""
        target_audio_device="$TIKPAL_WEB_MODE_ALSA_OUTPUT_DEVICE"
        crossfade_switch=0
      else
        target_audio_device="$(crossfade_helper device "$target_audio_bus")"
      fi
    elif crossfade_helper set "$target_audio_bus" 100 >/dev/null 2>&1; then
      target_audio_device="$(crossfade_helper device "$target_audio_bus")"
    else
      log "WARN: Explore crossfade bus could not be initialized; using direct provider audio"
      target_audio_bus=""
    fi
  elif is_enabled "$TIKPAL_WEB_MODE_AUDIO_CROSSFADE_ENABLED"; then
    log "WARN: Explore crossfade is unavailable; using direct provider audio"
  fi

  mkdir -p "$provider_profile"
  ensure_chromium_profile_prefs "$provider_profile"
  hide_onboard
  stop_window_guard
  close_provider_profile "$provider_profile"
  sleep 0.2
  ensure_chromium_profile_prefs "$provider_profile"
  seed_profile_widevine_cdm "$provider_profile"
  refresh_extension_script_cache "$provider_profile"
  if ! ensure_side_panel "$provider" "$entry_stage"; then
    [[ -n "$target_audio_bus" ]] && crossfade_helper set "$target_audio_bus" 0 >/dev/null 2>&1 || true
    close_web_mode
    fail "Explore side panel did not open"
  fi
  if [[ "$switching_provider" == "1" ]]; then
    if ! begin_provider_switch_transition "$current_profile" "$provider"; then
      [[ -n "$target_audio_bus" ]] && crossfade_helper set "$target_audio_bus" 0 >/dev/null 2>&1 || true
      message="Explore transition cover is unavailable"
      recover_or_cover_provider_failure "$current_provider" "$current_profile" "$provider" "check_setup" "$message" || true
      fail "$message"
    fi
    transition_shown_ms="$TIKPAL_WEB_MODE_TRANSITION_SHOWN_MS"
  fi
  mapfile -t flags < <(read_flags)
  mapfile -t base_args < <(chromium_base_args)

  local args=(
    "${flags[@]}"
    "${base_args[@]}"
    "--app=$launch_url"
    "--user-data-dir=$provider_profile"
    "--remote-debugging-address=127.0.0.1"
    "--remote-debugging-port=$provider_port"
    "--window-position=$TIKPAL_WEB_MODE_LEFT_POSITION"
    "--window-size=$(normalize_window_size "$TIKPAL_WEB_MODE_LEFT_WINDOW")"
  )

  if is_enabled "$TIKPAL_WEB_MODE_DISABLE_HANG_MONITOR"; then
    args+=("--disable-hang-monitor")
  fi

  if [[ "$extension_enabled" == "1" ]]; then
    args+=("--load-extension=$TIKPAL_WEB_MODE_EXTENSION_DIR")
  fi
  if [[ -n "$target_audio_device" ]]; then
    args+=("--alsa-output-device=$target_audio_device")
  fi
  if [[ "$proxy_enabled" == "1" && -n "$proxy_url" ]]; then
    args+=("--proxy-server=$proxy_url")
    args+=("--proxy-bypass-list=localhost;127.0.0.1;<local>")
  fi

  DISPLAY="$TIKPAL_KIOSK_DISPLAY" "$TIKPAL_CHROMIUM_BIN" "${args[@]}" >/dev/null 2>&1 9>&- &
  target_window="$(wait_for_profile_window "$provider_profile" "$(profile_window_timeout_attempts "$TIKPAL_WEB_MODE_PROVIDER_WINDOW_TIMEOUT_SECONDS")" || true)"
  if [[ -z "$target_window" ]]; then
    [[ -n "$target_audio_bus" ]] && crossfade_helper set "$target_audio_bus" 0 >/dev/null 2>&1 || true
    close_provider_profile "$provider_profile"
    message="$(provider_label "$provider") did not open"
    recover_or_cover_provider_failure "$current_provider" "$current_profile" "$provider" "check_setup" "$message" || true
    fail "$message"
  fi
  start_provider_guard "$provider" "$provider_profile" "$url" "$proxy_enabled" "$provider_port"
  if [[ "$extension_enabled" == "1" ]] && ! provider_uses_direct_bootstrap "$provider" && ! wait_for_real_provider_url "$provider_port"; then
    [[ -n "$target_audio_bus" ]] && crossfade_helper set "$target_audio_bus" 0 >/dev/null 2>&1 || true
    close_provider_profile "$provider_profile"
    message="$(provider_label "$provider") did not enter the provider page within ${TIKPAL_WEB_MODE_PROVIDER_BOOTSTRAP_TIMEOUT_SECONDS}s"
    recover_or_cover_provider_failure "$current_provider" "$current_profile" "$provider" "check_setup" "$message" || true
    fail "$message"
  fi
  if ! wait_for_provider_ready "$provider_port" "$provider"; then
    [[ -n "$target_audio_bus" ]] && crossfade_helper set "$target_audio_bus" 0 >/dev/null 2>&1 || true
    close_provider_profile "$provider_profile"
    message="$(provider_label "$provider") did not become ready within ${TIKPAL_WEB_MODE_PROVIDER_READY_TIMEOUT_SECONDS}s"
    recover_or_cover_provider_failure "$current_provider" "$current_profile" "$provider" "check_setup" "$message" || true
    fail "$message"
  fi
  if [[ "$entry_stage" == "1" ]]; then
    reveal_initial_entry_surfaces "$target_window" "$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel"
    reassert_visible_provider_surfaces "$target_window" "$provider_profile" "$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel"
  else
    reveal_resident_provider_window "$target_window" "$current_profile" "$provider_profile" "$transition_shown_ms" "$provider_port"
    reassert_visible_provider_surfaces "$target_window" "$provider_profile" "$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel"
    sleep 0.05
    if [[ "$crossfade_switch" == "1" ]]; then
      if ! crossfade_helper fade "$current_audio_bus" "$target_audio_bus" "$TIKPAL_WEB_MODE_AUDIO_CROSSFADE_MS"; then
        log "WARN: Explore crossfade failed; completing the provider switch at full target gain"
        crossfade_helper set "$target_audio_bus" 100 >/dev/null 2>&1 || true
        crossfade_helper set "$current_audio_bus" 0 >/dev/null 2>&1 || true
      fi
    else
      sleep "$(awk "BEGIN { printf \"%.3f\", $TIKPAL_WEB_MODE_STAGE_REVEAL_MS / 1000 }")"
    fi
    close_other_provider_profiles "$provider_profile"
  fi
  write_audio_bus_state "$target_audio_bus"
  commit_visible_provider_state "$provider"
  start_window_guard "$provider_profile" "$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel"
  log "opened $provider"
}

apply_proxy_settings() {
  local provider="$1"
  local provider_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$provider"
  local proxy_line proxy_enabled message
  if is_enabled "$TIKPAL_WEB_MODE_EXTENSION_ENABLED" && [[ -f "$TIKPAL_WEB_MODE_EXTENSION_DIR/manifest.json" ]]; then
    if ! profile_process_exists "$provider_profile"; then
      message="$(provider_label "$provider") did not open"
      recover_or_cover_provider_failure "" "" "$provider" "check_setup" "$message" || true
      fail "$message"
    fi
    if ! wait_for_proxy_applied; then
      message="$TIKPAL_WEB_MODE_PROXY_CONNECT_ERROR"
      recover_or_cover_provider_failure "" "" "$provider" "check_setup" "$message" || true
      fail "$message"
    fi
    proxy_line="$(read_proxy_settings)"
    proxy_enabled="$(effective_provider_proxy_enabled "$provider" "${proxy_line%%$'\t'*}")"
    if [[ "$proxy_enabled" != "1" ]] && ! provider_prefers_direct_proxy "$provider" && ! provider_direct_reachable "$provider"; then
      message="$(provider_needs_proxy_message "$provider")"
      recover_or_cover_provider_failure "" "" "$provider" "check_proxy" "$message" || true
      [[ -n "$(read_runtime_active_provider)" ]] && start_provider_pool_prewarm "$provider" force
      log "proxy disabled for $provider; marked check_proxy"
      return
    fi
    start_provider_guard "$provider" "$provider_profile" "$(provider_url "$provider")" "$proxy_enabled" "$(provider_debug_port "$provider")"
    if ! wait_for_real_provider_url "$(provider_debug_port "$provider")"; then
      message="$TIKPAL_WEB_MODE_PROXY_CONNECT_ERROR"
      recover_or_cover_provider_failure "" "" "$provider" "check_setup" "$message" || true
      fail "$message"
    fi
    if ! wait_for_provider_ready "$(provider_debug_port "$provider")" "$provider"; then
      message="$TIKPAL_WEB_MODE_PROXY_CONNECT_ERROR"
      recover_or_cover_provider_failure "" "" "$provider" "check_setup" "$message" || true
      fail "$message"
    fi
    start_provider_pool_prewarm "$provider" force
    log "proxy applied without restarting $provider; provider pool prewarm restarted"
    return
  fi
  open_provider "$provider"
}

check_runtime() {
  local xdotool_bin
  resolve_web_mode_audio_devices
  log "app dir: $APP_DIR"
  log "display: $TIKPAL_KIOSK_DISPLAY"
  log "chromium: $TIKPAL_CHROMIUM_BIN"
  log "left: $TIKPAL_WEB_MODE_LEFT_POSITION $(normalize_window_size "$TIKPAL_WEB_MODE_LEFT_WINDOW")"
  log "stage: $TIKPAL_WEB_MODE_STAGE_POSITION"
  log "panel: $TIKPAL_WEB_MODE_PANEL_POSITION $(normalize_window_size "$TIKPAL_WEB_MODE_PANEL_WINDOW")"
  log "audio: ${TIKPAL_WEB_MODE_ALSA_OUTPUT_DEVICE:-default}"
  log "provider ready timeout: ${TIKPAL_WEB_MODE_PROVIDER_READY_TIMEOUT_SECONDS}s"
  log "audio crossfade: $TIKPAL_WEB_MODE_AUDIO_CROSSFADE_ENABLED ${TIKPAL_WEB_MODE_AUDIO_CROSSFADE_MS}ms"
  log "window guard: $TIKPAL_WEB_MODE_WINDOW_GUARD"
  log "single provider window: $TIKPAL_WEB_MODE_SINGLE_PROVIDER_WINDOW"
  log "provider pool: $TIKPAL_WEB_MODE_PROVIDER_POOL"
  log "provider idle pool: $TIKPAL_WEB_MODE_PROVIDER_IDLE_POOL_ENABLED"
  log "provider prewarm: $TIKPAL_WEB_MODE_PROVIDER_PREWARM_ENABLED delay=${TIKPAL_WEB_MODE_PROVIDER_PREWARM_DELAY_SECONDS}s"
  log "provider guard idle poll: ${TIKPAL_WEB_MODE_PROVIDER_GUARD_IDLE_POLL_MS}ms"
  log "popup blocking: $TIKPAL_WEB_MODE_POPUP_BLOCKING"
  log "extension: $TIKPAL_WEB_MODE_EXTENSION_ENABLED $TIKPAL_WEB_MODE_EXTENSION_DIR"
  log "provider text scale: $(read_provider_text_scale)"
  log "proxy apply timeout: ${TIKPAL_WEB_MODE_PROXY_APPLY_TIMEOUT_SECONDS}s"
  log "provider bootstrap timeout: ${TIKPAL_WEB_MODE_PROVIDER_BOOTSTRAP_TIMEOUT_SECONDS}s"
  log "entry provider paint timeout: ${TIKPAL_WEB_MODE_ENTRY_PROVIDER_PAINT_TIMEOUT_SECONDS}s"
  log "provider window timeout: ${TIKPAL_WEB_MODE_PROVIDER_WINDOW_TIMEOUT_SECONDS}s"
  log "provider debug: 127.0.0.1:$TIKPAL_WEB_MODE_PROVIDER_DEBUG_PORT"
  log "provider debug stride: per-provider"
  log "provider guard: $TIKPAL_WEB_MODE_PROVIDER_GUARD"
  log "provider hang monitor: $TIKPAL_WEB_MODE_DISABLE_HANG_MONITOR"
  log "switch lock timeout: ${TIKPAL_WEB_MODE_LOCK_TIMEOUT_SECONDS}s"
  log "warm close: $TIKPAL_WEB_MODE_CLOSE_WARM_ENABLED keep-resident=$TIKPAL_WEB_MODE_CLOSE_KEEP_RESIDENT ttl=${TIKPAL_WEB_MODE_CLOSE_WARM_TTL_SECONDS}s"
  log "error page: $TIKPAL_WEB_MODE_ERROR_PAGE_URL"
  log "onboard: $TIKPAL_WEB_MODE_ONBOARD_POSITION $(normalize_window_size "$TIKPAL_WEB_MODE_ONBOARD_WINDOW")"
  log "onboard input focus: $TIKPAL_WEB_MODE_ONBOARD_AUTO_FOCUS"
  log "qq scoped auto confirm: $TIKPAL_WEB_MODE_QQ_AUTO_CONFIRM"
  log "qq audio prime: $TIKPAL_WEB_MODE_QQ_AUDIO_PRIME"
  log "qq music auto play: $TIKPAL_WEB_MODE_QQ_MUSIC_AUTO_PLAY"
  log "settings: $TIKPAL_WEB_MODE_SETTINGS_PATH"
  read_proxy_settings | awk -F '\t' '{ printf("[tikpal-web-mode] proxy: %s %s\n", $1 == "1" ? "enabled" : "disabled", $2) }'
  [[ -x "$TIKPAL_CHROMIUM_BIN" ]] || fail "Chromium binary is missing or not executable"
  xdotool_bin="$(command -v xdotool || true)"
  [[ -n "$xdotool_bin" ]] || fail "xdotool is required for Explore provider window detection; install with: sudo apt-get install -y xdotool"
  log "xdotool: $xdotool_bin"
  log "check passed"
}

check_runtime_quiet() {
  resolve_web_mode_audio_devices
  [[ -x "$TIKPAL_CHROMIUM_BIN" ]] || fail "Chromium binary is missing or not executable"
  command -v xdotool >/dev/null 2>&1 || fail "xdotool is required for Explore provider window detection"
}

case "${1:-open}" in
  --check)
    check_runtime
    ;;
  open)
    check_runtime_quiet
    with_web_mode_lock open_provider "${2:-qq_music}"
    ;;
  prepare-entry)
    check_runtime_quiet
    with_web_mode_lock prepare_entry_surfaces "${2:-qq_music}"
    ;;
  park-entry)
    with_web_mode_lock park_prepared_entry_surfaces
    ;;
  close)
    with_web_mode_lock close_web_mode
    log "closed"
    ;;
  close-full)
    with_web_mode_lock close_web_mode_full
    log "closed full"
    ;;
  cleanup-warm)
    cleanup_ttl="$TIKPAL_WEB_MODE_CLOSE_WARM_TTL_SECONDS"
    [[ "$cleanup_ttl" =~ ^[0-9]+([.][0-9]+)?$ ]] || cleanup_ttl=45
    sleep "$cleanup_ttl"
    with_web_mode_lock cleanup_warm_web_mode
    log "warm cleanup checked"
    ;;
  warm-pool)
    warm_provider_pool
    ;;
  guard)
    run_window_guard "${2:-}" "${3:-}"
    ;;
  prewarm)
    prewarm_provider_pool "${2:-}"
    ;;
  reconcile)
    reconcile_provider_pool "${2:-}" "${3:-}"
    ;;
  sync-status)
    sync_runtime_provider_pool_process_statuses "$(read_runtime_active_provider)"
    ;;
  provider-status)
    provider_id="${2:-}"
    provider_status="${3:-}"
    if ! provider_ids | grep -Fx -- "$provider_id" >/dev/null; then
      fail "Unknown provider: $provider_id"
    fi
    case "$provider_status" in
      ready|active)
        if provider_has_real_provider_page "$(provider_debug_port "$provider_id")"; then
          write_runtime_provider_status "$provider_id" "$provider_status"
        elif [[ "$provider_status" == "active" && "$(read_runtime_active_provider)" != "$provider_id" ]]; then
          # A stale guard must not overwrite a confirmed Ready card while its
          # asynchronous diagnostics decide whether this is terminal.
          log "ignored stale provider-status active for $provider_id without a real HTTPS page"
        fi
        ;;
      *) fail "Provider status must be ready or active" ;;
    esac
    ;;
  refresh-guards)
    refresh_provider_pool_guards
    ;;
  keyboard)
    case "${2:-toggle}" in
      preload) with_onboard_lock preload_onboard ;;
      show) with_onboard_lock ensure_onboard ;;
      show-force) with_onboard_lock force_onboard ;;
      keepalive) with_onboard_lock keepalive_onboard ;;
      hide) with_onboard_lock hide_onboard ;;
      toggle) with_onboard_lock toggle_onboard ;;
      *) fail "Keyboard mode must be preload, show, show-force, keepalive, hide, or toggle" ;;
    esac
    log "keyboard ${2:-toggle} ready"
    ;;
  proxy)
    check_runtime_quiet
    with_web_mode_lock apply_proxy_settings "${2:-spotify}"
    ;;
  *)
    fail "Usage: $0 open <provider>|prepare-entry <provider>|park-entry|close|close-full|cleanup-warm|warm-pool|prewarm <provider>|reconcile <provider> [started-ms]|sync-status|refresh-guards|keyboard [show|hide|toggle]|proxy <provider>|--check"
    ;;
esac

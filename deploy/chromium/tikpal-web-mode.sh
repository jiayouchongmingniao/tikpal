#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="${TIKPAL_KIOSK_ENV_FILE:-$APP_DIR/.env.kiosk}"
export TIKPAL_APP_DIR="${TIKPAL_APP_DIR:-$APP_DIR}"
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
: "${TIKPAL_WEB_MODE_LEFT_WINDOW:=1920x720}"
: "${TIKPAL_WEB_MODE_LEFT_POSITION:=0,0}"
: "${TIKPAL_WEB_MODE_PANEL_WINDOW:=640x720}"
: "${TIKPAL_WEB_MODE_PANEL_POSITION:=1920,0}"
: "${TIKPAL_WEB_MODE_SIDE_PANEL_URL:=http://localhost:4173/side-panel}"
: "${TIKPAL_WEB_MODE_TRANSITION_URL:=http://127.0.0.1:4173/web-mode-transition.html}"
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
: "${TIKPAL_WEB_MODE_ONBOARD_LOCK_TIMEOUT_SECONDS:=8}"
: "${TIKPAL_WEB_MODE_DEFAULT_PROXY_URL:=http://127.0.0.1:7897}"
: "${TIKPAL_WEB_MODE_ONBOARD:=1}"
: "${TIKPAL_WEB_MODE_ONBOARD_AUTO_FOCUS:=1}"
: "${TIKPAL_WEB_MODE_ONBOARD_WINDOW:=900x280}"
: "${TIKPAL_WEB_MODE_ONBOARD_POSITION:=500,420}"
: "${TIKPAL_WEB_MODE_ONBOARD_SUPPRESS_PATH:=$TIKPAL_WEB_MODE_PROFILE_ROOT/onboard-manual-hidden}"
: "${TIKPAL_WEB_MODE_ALSA_OUTPUT_DEVICE:=${TIKPAL_CHROMIUM_ALSA_OUTPUT_DEVICE:-}}"
: "${TIKPAL_WEB_MODE_WINDOW_GUARD:=1}"
: "${TIKPAL_WEB_MODE_SINGLE_PROVIDER_WINDOW:=1}"
: "${TIKPAL_WEB_MODE_PROVIDER_POOL:=1}"
: "${TIKPAL_WEB_MODE_PROVIDER_PREWARM_ENABLED:=1}"
: "${TIKPAL_WEB_MODE_PROVIDER_PREWARM_DELAY_SECONDS:=0.75}"
: "${TIKPAL_WEB_MODE_PROVIDER_PREWARM_LOCK_TIMEOUT_SECONDS:=2}"
: "${TIKPAL_WEB_MODE_DIRECT_PROBE_ENABLED:=1}"
: "${TIKPAL_WEB_MODE_DIRECT_PROBE_TIMEOUT_SECONDS:=4}"
: "${TIKPAL_WEB_MODE_POPUP_BLOCKING:=1}"
: "${TIKPAL_WEB_MODE_PROVIDER_DEBUG_PORT:=9234}"
: "${TIKPAL_WEB_MODE_PROVIDER_GUARD:=1}"
: "${TIKPAL_WEB_MODE_DISABLE_HANG_MONITOR:=1}"
: "${TIKPAL_WEB_MODE_REFRESH_EXTENSION_CACHE:=1}"
: "${TIKPAL_WEB_MODE_ERROR_PAGE_URL:=http://127.0.0.1:4173/web-mode-error.html}"
: "${TIKPAL_WEB_MODE_QQ_AUTO_CONFIRM:=1}"
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

provider_uses_direct_bootstrap() {
  case "$1" in
    deezer) return 0 ;;
    *) return 1 ;;
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
  printf '%s needs Proxy On' "$(provider_label "$1")"
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

wait_for_provider_ready() {
  local provider_port="$1"
  local provider="${2:-}"
  node --experimental-websocket - "$provider_port" "$TIKPAL_WEB_MODE_PROVIDER_READY_TIMEOUT_SECONDS" "$provider" <<'NODE'
const [port, timeoutSeconds, provider] = process.argv.slice(2);
const deadline = Date.now() + Math.max(1, Number(timeoutSeconds) || 18) * 1000;
const readyExpression = `(() => {
  if (!document.body || document.readyState === "loading") return false;
  const textLength = String(document.body.innerText || "").replace(/\\s+/g, " ").trim().length;
  const candidates = Array.from(document.querySelectorAll("main,nav,header,button,a,input,[role='button'],audio,video")).slice(0, 200);
  const visibleCount = candidates.filter((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0 && rect.width > 2 && rect.height > 2;
  }).length;
  return textLength >= 80 || visibleCount >= 3;
})()`;
const urlReadyHosts = new Set(
  provider === "apple_music" ? ["music.apple.com"] :
  provider === "tidal" ? ["listen.tidal.com", "tidal.com"] :
  provider === "deezer" ? ["deezer.com", "www.deezer.com"] :
  []
);

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

function targetHost(url) {
  try {
    return new URL(String(url || "")).hostname;
  } catch {
    return "";
  }
}

let stableChecks = 0;
while (Date.now() < deadline) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(800) });
    const targets = await response.json();
    const target = targets.find((item) => item.type === "page" && String(item.url || "").startsWith("https://") && item.webSocketDebuggerUrl);
    const host = targetHost(target?.url);
    const isReady = target && (urlReadyHosts.has(host) || await evaluate(target.webSocketDebuggerUrl, readyExpression));
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

write_runtime_provider_state() {
  local provider="$1"
  node - "$TIKPAL_WEB_MODE_STATE_PATH" "$provider" "$(provider_ids | tr '\n' ',' | sed 's/,$//')" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [statePath, provider, providerList] = process.argv.slice(2);
const providerIds = String(providerList || "").split(",").filter(Boolean);
let state = {};
try { state = JSON.parse(fs.readFileSync(statePath, "utf8")); } catch {}
state.activeProvider = provider || null;
state.lastError = null;
state.updatedAt = new Date().toISOString();
if (!state.activeProvider) {
  state.residentProviders = {};
} else {
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
      residentProviders[id] = { ...current, status: "ready", lastError: null, updatedAt: state.updatedAt };
    }
  }
  state.residentProviders = residentProviders;
}
fs.mkdirSync(path.dirname(statePath), { recursive: true });
fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
NODE
}

write_runtime_provider_status() {
  local provider="$1"
  local status="$2"
  local message="${3:-}"
  node - "$TIKPAL_WEB_MODE_STATE_PATH" "$provider" "$status" "$message" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [statePath, provider, status, message] = process.argv.slice(2);
const allowed = new Set(["opening", "prewarming", "ready", "active", "check_setup", "check_proxy", "closed"]);
let state = {};
try { state = JSON.parse(fs.readFileSync(statePath, "utf8")); } catch {}
const now = new Date().toISOString();
state.residentProviders = state.residentProviders && typeof state.residentProviders === "object"
  ? state.residentProviders
  : {};
if (provider && allowed.has(status)) {
  if (status === "closed") {
    delete state.residentProviders[provider];
  } else {
    state.residentProviders[provider] = {
      ...(state.residentProviders[provider] || {}),
      status,
      lastError: message || null,
      updatedAt: now
    };
  }
}
state.updatedAt = now;
fs.mkdirSync(path.dirname(statePath), { recursive: true });
fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
NODE
}

seed_runtime_provider_pool_statuses() {
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
state.updatedAt = now;
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
      [[ "$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool getwindowname "$window" 2>/dev/null || true)" == "Onboard" ]] || continue
      if command -v xwininfo >/dev/null 2>&1 &&
        DISPLAY="$TIKPAL_KIOSK_DISPLAY" xwininfo -id "$window" 2>/dev/null | grep -q "Class: InputOnly"; then
        continue
      fi
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
      DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool windowraise "$keyboard_window" >/dev/null 2>&1 || true
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
    [[ "$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool getwindowname "$window" 2>/dev/null || true)" == "Onboard" ]] || continue
    if command -v xwininfo >/dev/null 2>&1 &&
      DISPLAY="$TIKPAL_KIOSK_DISPLAY" xwininfo -id "$window" 2>/dev/null | grep -q "Class: InputOnly"; then
      continue
    fi
    printf '%s\n' "$window"
  done < <(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool search --onlyvisible --name Onboard 2>/dev/null || true)
}

raise_onboard() {
  local window
  command -v xdotool >/dev/null 2>&1 || return 0
  while IFS= read -r window; do
    [[ -n "$window" ]] || continue
    DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool windowraise "$window" >/dev/null 2>&1 || true
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
    [[ "$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool getwindowname "$window" 2>/dev/null || true)" == "Onboard" ]] || continue
    if command -v xwininfo >/dev/null 2>&1 &&
      DISPLAY="$TIKPAL_KIOSK_DISPLAY" xwininfo -id "$window" 2>/dev/null | grep -q "Class: InputOnly"; then
      continue
    fi
    width="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool getwindowgeometry --shell "$window" 2>/dev/null | awk -F= '$1 == "WIDTH" { print $2 }')"
    height="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool getwindowgeometry --shell "$window" 2>/dev/null | awk -F= '$1 == "HEIGHT" { print $2 }')"
    area=$(( ${width:-0} * ${height:-0} ))
    if (( area > keyboard_area )); then
      keyboard_window="$window"
      keyboard_area="$area"
    fi
  done < <(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool search --onlyvisible --name Onboard 2>/dev/null || true)

  [[ -n "$keyboard_window" ]] || return 0
  width="$(window_width "$TIKPAL_WEB_MODE_ONBOARD_WINDOW")"
  height="$(window_height "$TIKPAL_WEB_MODE_ONBOARD_WINDOW")"
  DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool windowsize "$keyboard_window" "$width" "$height" >/dev/null 2>&1 || true
  DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool windowmove "$keyboard_window" \
    "$(position_x "$TIKPAL_WEB_MODE_ONBOARD_POSITION")" "$(position_y "$TIKPAL_WEB_MODE_ONBOARD_POSITION")" >/dev/null 2>&1 || true
  DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool windowraise "$keyboard_window" >/dev/null 2>&1 || true
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
  call_onboard_method Hide || true
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

prewarm_pid_file() {
  printf '%s\n' "$TIKPAL_WEB_MODE_PROFILE_ROOT/provider-prewarm.pid"
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

stop_provider_pool_prewarm() {
  local pid_file pid
  pid_file="$(prewarm_pid_file)"
  if [[ -r "$pid_file" ]]; then
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [[ "$pid" =~ ^[0-9]+$ ]]; then
      pkill -TERM -P "$pid" >/dev/null 2>&1 || true
      kill "$pid" >/dev/null 2>&1 || true
    fi
  fi
  if command -v pkill >/dev/null 2>&1; then
    pkill -TERM -f "$SCRIPT_DIR/tikpal-web-mode.sh prewarm" >/dev/null 2>&1 || true
    sleep 0.1
    pkill -KILL -f "$SCRIPT_DIR/tikpal-web-mode.sh prewarm" >/dev/null 2>&1 || true
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
    fi
    rm -f "$pid_file"
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

close_web_mode() {
  hide_onboard
  close_provider_windows
  close_side_panel
  close_transition_veil
  write_audio_bus_state ""
  write_runtime_provider_state ""
}

profile_process_exists() {
  pgrep -f -- "--user-data-dir=$1" >/dev/null 2>&1
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
  [[ -n "$provider_profile" ]] || return 0
  pkill -TERM -f -- "--user-data-dir=$provider_profile" >/dev/null 2>&1 || true
  for _ in {1..10}; do
    profile_process_exists "$provider_profile" || break
    sleep 0.1
  done
  if profile_process_exists "$provider_profile"; then
    pkill -KILL -f -- "--user-data-dir=$provider_profile" >/dev/null 2>&1 || true
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
    if [[ -r "/proc/$pid/cmdline" ]] && tr '\0' ' ' < "/proc/$pid/cmdline" | grep -Fq -- "--user-data-dir=$profile"; then
      return 0
    fi
    [[ -r "/proc/$pid/status" ]] || break
    pid="$(awk '/^PPid:/{print $2}' "/proc/$pid/status")"
    depth=$((depth + 1))
  done

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
  geometry="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool getwindowgeometry --shell "$window" 2>/dev/null || true)"
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

raise_window_without_focus() {
  local window="$1"
  [[ -n "$window" ]] || return 0
  DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool windowraise "$window" >/dev/null 2>&1 || true
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
  local force_raise="${3:-0}"
  local did_restack=0
  local window pid title active_window keep_window provider_window_count provider_entry provider_entry_id provider_entry_profile
  local provider_windows=()
  command -v xdotool >/dev/null 2>&1 || return 0
  active_window="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool getactivewindow 2>/dev/null || true)"

  while IFS= read -r window; do
    [[ -n "$window" ]] || continue
    pid="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool getwindowpid "$window" 2>/dev/null || true)"
    title="$(DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool getwindowname "$window" 2>/dev/null || true)"

    if process_tree_uses_profile "$pid" "$panel_profile"; then
      tile_window "$window" "$TIKPAL_WEB_MODE_PANEL_POSITION" "$TIKPAL_WEB_MODE_PANEL_WINDOW"
      if [[ "$force_raise" == "1" || "${TIKPAL_TILE_WINDOW_CHANGED:-0}" == "1" ]]; then
        raise_window_without_focus "$window"
        did_restack=1
      fi
      continue
    fi
    if is_ad_window_title "$title"; then
      DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool windowclose "$window" >/dev/null 2>&1 || true
      continue
    fi
    if process_tree_uses_profile "$pid" "$provider_profile"; then
      tile_window "$window" "$TIKPAL_WEB_MODE_LEFT_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW"
      if [[ "$force_raise" == "1" || "${TIKPAL_TILE_WINDOW_CHANGED:-0}" == "1" ]]; then
        raise_window_without_focus "$window"
        did_restack=1
      fi
      provider_windows+=("$window")
    elif is_enabled "$TIKPAL_WEB_MODE_PROVIDER_POOL" && provider_entry="$(provider_profile_for_pid "$pid" || true)" && [[ -n "$provider_entry" ]]; then
      provider_entry_id="${provider_entry%%$'\t'*}"
      provider_entry_profile="${provider_entry#*$'\t'}"
      if [[ "$provider_entry_profile" == "$provider_profile" ]]; then
        tile_window "$window" "$TIKPAL_WEB_MODE_LEFT_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW"
      else
        tile_window "$window" "$TIKPAL_WEB_MODE_STAGE_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW"
      fi
      if [[ "$provider_entry_profile" == "$provider_profile" ]]; then
        provider_windows+=("$window")
      fi
    elif [[ -n "$title" ]] && ! is_tikpal_window_title "$title"; then
      tile_window "$window" "$TIKPAL_WEB_MODE_LEFT_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW"
      if [[ "$force_raise" == "1" || "${TIKPAL_TILE_WINDOW_CHANGED:-0}" == "1" ]]; then
        raise_window_without_focus "$window"
        did_restack=1
      fi
      provider_windows+=("$window")
    fi
  done < <(visible_chromium_windows)

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
    DISPLAY="$TIKPAL_KIOSK_DISPLAY" xdotool windowclose "$window" >/dev/null 2>&1 || true
    did_restack=1
  done
  tile_window "$keep_window" "$TIKPAL_WEB_MODE_LEFT_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW"
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
  local active_provider active_profile
  [[ -n "$provider_profile" ]] || is_enabled "$TIKPAL_WEB_MODE_PROVIDER_POOL" || return 0

  if is_enabled "$TIKPAL_WEB_MODE_PROVIDER_POOL"; then
    while any_provider_process_exists || side_panel_window_visible "$panel_profile"; do
      active_provider="$(read_runtime_active_provider)"
      active_profile=""
      [[ -n "$active_provider" ]] && active_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$active_provider"
      tile_visible_web_mode_windows "$active_profile" "$panel_profile" "$force_raise"
      force_raise=0
      sleep 0.25
    done
    return 0
  fi

  while profile_process_exists "$provider_profile"; do
    tile_visible_web_mode_windows "$provider_profile" "$panel_profile" "$force_raise"
    force_raise=0
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
  TIKPAL_WEB_MODE_QQ_MV_AUTO_FULLSCREEN="$TIKPAL_WEB_MODE_QQ_MV_AUTO_FULLSCREEN" \
  TIKPAL_WEB_MODE_QQ_MV_CINEMA_MODE="$TIKPAL_WEB_MODE_QQ_MV_CINEMA_MODE" \
  TIKPAL_WEB_MODE_QQ_MV_AUTO_PLAY="$TIKPAL_WEB_MODE_QQ_MV_AUTO_PLAY" \
  TIKPAL_WEB_MODE_NETEASE_AUTO_PLAY="$TIKPAL_WEB_MODE_NETEASE_AUTO_PLAY" \
  TIKPAL_WEB_MODE_ONBOARD_AUTO_FOCUS="$TIKPAL_WEB_MODE_ONBOARD_AUTO_FOCUS" \
  TIKPAL_KIOSK_DISPLAY="$TIKPAL_KIOSK_DISPLAY" \
    node --experimental-websocket "$helper" >/dev/null 2>&1 9>&- &
  if is_enabled "$TIKPAL_WEB_MODE_PROVIDER_POOL"; then
    printf '%s\n' "$!" > "$(provider_guard_pid_file "$provider")"
  else
    printf '%s\n' "$!" > "$(provider_guard_pid_file)"
  fi
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

launch_provider_for_pool() {
  local provider="$1"
  local wait_ready="${2:-1}"
  local launch_role="${3:-active}"
  local force_existing="${4:-0}"
  local url provider_profile provider_port launch_url extension_enabled=0
  local target_window proxy_line proxy_enabled proxy_url target_audio_device lock_timeout
  if command -v flock >/dev/null 2>&1 && [[ "${TIKPAL_WEB_MODE_PROVIDER_LAUNCH_LOCKED:-0}" != "1" ]]; then
    lock_timeout="$TIKPAL_WEB_MODE_PROVIDER_WINDOW_TIMEOUT_SECONDS"
    [[ "$launch_role" == "prewarm" ]] && lock_timeout="$TIKPAL_WEB_MODE_PROVIDER_PREWARM_LOCK_TIMEOUT_SECONDS"
    mkdir -p "$TIKPAL_WEB_MODE_PROFILE_ROOT"
    (
      flock -x -w "$lock_timeout" 7 || exit 75
      TIKPAL_WEB_MODE_PROVIDER_LAUNCH_LOCKED=1 launch_provider_for_pool "$provider" "$wait_ready" "$launch_role" "$force_existing"
    ) 7>"$TIKPAL_WEB_MODE_PROFILE_ROOT/provider-$provider.launch.lock"
    local lock_status=$?
    [[ "$lock_status" == "75" ]] && return 1
    return "$lock_status"
  fi

  url="$(provider_url "$provider")"
  provider_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$provider"
  provider_port="$(provider_debug_port "$provider")"
  if [[ "$launch_role" == "prewarm" && -z "$(read_runtime_active_provider)" ]]; then
    return 0
  fi
  proxy_line="$(read_proxy_settings)"
  proxy_enabled="${proxy_line%%$'\t'*}"
  proxy_url="${proxy_line#*$'\t'}"
  launch_url="$url"
  if [[ "$proxy_enabled" != "1" ]] && ! provider_direct_reachable "$provider"; then
    write_runtime_provider_status "$provider" "check_proxy" "$(provider_needs_proxy_message "$provider")"
    [[ "$launch_role" == "prewarm" ]] && return 0
    return 1
  fi

  if is_enabled "$TIKPAL_WEB_MODE_EXTENSION_ENABLED" && [[ -f "$TIKPAL_WEB_MODE_EXTENSION_DIR/manifest.json" ]]; then
    extension_enabled=1
    if ! provider_uses_direct_bootstrap "$provider"; then
      launch_url="$TIKPAL_WEB_MODE_TRANSITION_URL?provider=$provider"
    fi
  fi

  if profile_process_exists "$provider_profile"; then
    if [[ "$launch_role" == "prewarm" && "$force_existing" == "1" ]]; then
      write_runtime_provider_status "$provider" "prewarming"
      if ! navigate_provider_target "$provider_port" "$url"; then
        write_runtime_provider_status "$provider" "check_setup" "$(provider_label "$provider") could not reopen"
        return 0
      fi
    fi
    start_provider_guard "$provider" "$provider_profile" "$url" "$proxy_enabled" "$provider_port"
    if [[ "$launch_role" == "prewarm" && -z "$(read_runtime_active_provider)" ]]; then
      return 0
    fi
    if [[ "$launch_role" == "prewarm" && "$force_existing" == "1" ]]; then
      return 0
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
    "--window-position=$TIKPAL_WEB_MODE_STAGE_POSITION"
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
  if [[ "$proxy_enabled" == "1" && -n "$proxy_url" && ( "$extension_enabled" != "1" || "$launch_url" == "$url" ) ]]; then
    args+=("--proxy-server=$proxy_url")
    args+=("--proxy-bypass-list=localhost;127.0.0.1;<local>")
  fi

  DISPLAY="$TIKPAL_KIOSK_DISPLAY" "$TIKPAL_CHROMIUM_BIN" "${args[@]}" >/dev/null 2>&1 9>&- &
  target_window="$(wait_for_profile_window "$provider_profile" "$(profile_window_timeout_attempts "$TIKPAL_WEB_MODE_PROVIDER_WINDOW_TIMEOUT_SECONDS")" || true)"
  if [[ -z "$target_window" ]]; then
    close_provider_profile "$provider_profile"
    if [[ "$launch_role" == "prewarm" && -z "$(read_runtime_active_provider)" ]]; then
      return 1
    fi
    write_runtime_provider_status "$provider" "check_setup" "$(provider_label "$provider") did not open"
    return 1
  fi
  tile_window "$target_window" "$TIKPAL_WEB_MODE_STAGE_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW"
  start_provider_guard "$provider" "$provider_profile" "$url" "$proxy_enabled" "$provider_port"

  if [[ "$wait_ready" == "1" ]]; then
    if [[ "$extension_enabled" == "1" ]] && ! wait_for_real_provider_url "$provider_port"; then
      if [[ "$launch_role" == "prewarm" && -z "$(read_runtime_active_provider)" ]]; then
        return 1
      fi
      write_runtime_provider_status "$provider" "check_setup" "$(provider_label "$provider") did not enter the provider page"
      return 1
    fi
    if ! wait_for_provider_ready "$provider_port" "$provider"; then
      if [[ "$launch_role" == "prewarm" && -z "$(read_runtime_active_provider)" ]]; then
        return 1
      fi
      write_runtime_provider_status "$provider" "check_setup" "$(provider_label "$provider") did not become ready"
      return 1
    fi
  fi
  if [[ "$launch_role" == "prewarm" && -z "$(read_runtime_active_provider)" ]]; then
    return 0
  fi
  if [[ "$launch_role" == "prewarm" && "$wait_ready" != "1" ]]; then
    write_runtime_provider_status "$provider" "prewarming"
    return 0
  fi
  write_runtime_provider_status "$provider" "ready"
}

prewarm_provider_pool() {
  local active_provider="${1:-}"
  local provider delay force_existing
  is_enabled "$TIKPAL_WEB_MODE_PROVIDER_PREWARM_ENABLED" || return 0
  seed_runtime_provider_pool_statuses "$active_provider"
  delay="$TIKPAL_WEB_MODE_PROVIDER_PREWARM_DELAY_SECONDS"
  force_existing="${TIKPAL_WEB_MODE_PROVIDER_PREWARM_FORCE:-0}"
  while IFS= read -r provider; do
    [[ -n "$provider" && "$provider" != "$active_provider" ]] || continue
    [[ -n "$(read_runtime_active_provider)" ]] || return 0
    sleep "$delay"
    [[ -n "$(read_runtime_active_provider)" ]] || return 0
    launch_provider_for_pool "$provider" 0 prewarm "$force_existing" || true
  done < <(provider_ids)
}

start_provider_pool_prewarm() {
  local active_provider="$1"
  local seed_mode="${2:-preserve}"
  is_enabled "$TIKPAL_WEB_MODE_PROVIDER_POOL" || return 0
  is_enabled "$TIKPAL_WEB_MODE_PROVIDER_PREWARM_ENABLED" || return 0
  stop_provider_pool_prewarm
  mkdir -p "$TIKPAL_WEB_MODE_PROFILE_ROOT"
  seed_runtime_provider_pool_statuses "$active_provider" "$seed_mode"
  if [[ "$seed_mode" == "force" ]]; then
    TIKPAL_WEB_MODE_PROVIDER_PREWARM_FORCE=1 nohup "$SCRIPT_DIR/tikpal-web-mode.sh" prewarm "$active_provider" >/dev/null 2>&1 9>&- &
  else
    nohup "$SCRIPT_DIR/tikpal-web-mode.sh" prewarm "$active_provider" >/dev/null 2>&1 9>&- &
  fi
  printf '%s\n' "$!" > "$(prewarm_pid_file)"
}

open_provider_pool() {
  local provider="$1"
  local provider_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$provider"
  local current_provider current_profile target_window proxy_line proxy_enabled
  current_provider="$(read_runtime_active_provider)"
  current_profile=""
  [[ -n "$current_provider" ]] && current_profile="$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$current_provider"

  stop_provider_pool_prewarm
  hide_onboard
  ensure_side_panel "$provider"
  proxy_line="$(read_proxy_settings)"
  proxy_enabled="${proxy_line%%$'\t'*}"
  if [[ "$proxy_enabled" != "1" ]] && ! provider_direct_reachable "$provider"; then
    write_runtime_provider_status "$provider" "check_proxy" "$(provider_needs_proxy_message "$provider")"
    [[ -n "$current_provider" ]] && write_runtime_provider_state "$current_provider"
    [[ -n "$current_profile" ]] && start_window_guard "$current_profile" "$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel"
    fail "$(provider_needs_proxy_message "$provider")"
  fi
  if ! profile_process_exists "$provider_profile"; then
    launch_transition_veil "$provider"
  fi
  stop_window_guard

  if profile_process_exists "$provider_profile"; then
    start_provider_guard "$provider" "$provider_profile" "$(provider_url "$provider")" "$proxy_enabled" "$(provider_debug_port "$provider")"
    write_runtime_provider_status "$provider" "ready"
  elif ! launch_provider_for_pool "$provider" 1; then
    close_transition_veil
    [[ -n "$current_provider" ]] && write_runtime_provider_state "$current_provider"
    [[ -n "$current_profile" ]] && start_window_guard "$current_profile" "$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel"
    fail "$(provider_label "$provider") did not become ready"
  fi

  write_runtime_provider_state "$provider"
  target_window="$(wait_for_profile_window "$provider_profile" "$(profile_window_timeout_attempts "$TIKPAL_WEB_MODE_PROVIDER_WINDOW_TIMEOUT_SECONDS")" || true)"
  if [[ -z "$target_window" ]]; then
    close_transition_veil
    [[ -n "$current_provider" ]] && write_runtime_provider_state "$current_provider"
    [[ -n "$current_profile" ]] && start_window_guard "$current_profile" "$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel"
    write_runtime_provider_status "$provider" "check_setup" "$(provider_label "$provider") window is unavailable"
    fail "$(provider_label "$provider") did not open"
  fi
  tile_visible_web_mode_windows "$provider_profile" "$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel" 1
  tile_window "$target_window" "$TIKPAL_WEB_MODE_LEFT_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW"
  raise_window "$target_window"
  close_transition_veil
  write_audio_bus_state ""
  start_window_guard "$provider_profile" "$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel"
  start_provider_pool_prewarm "$provider"
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
  if [[ "$proxy_enabled" != "1" ]] && ! provider_direct_reachable "$provider"; then
    write_runtime_provider_status "$provider" "check_proxy" "$(provider_needs_proxy_message "$provider")"
    fail "$(provider_needs_proxy_message "$provider")"
  fi
  if is_enabled "$TIKPAL_WEB_MODE_EXTENSION_ENABLED" && [[ -f "$TIKPAL_WEB_MODE_EXTENSION_DIR/manifest.json" ]]; then
    extension_enabled=1
    if ! provider_uses_direct_bootstrap "$provider"; then
      launch_url="$TIKPAL_WEB_MODE_TRANSITION_URL?provider=$provider"
    fi
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
  refresh_extension_script_cache "$provider_profile"
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
  if [[ -n "$target_audio_device" ]]; then
    args+=("--alsa-output-device=$target_audio_device")
  fi
  if [[ "$proxy_enabled" == "1" && -n "$proxy_url" && ( "$extension_enabled" != "1" || "$launch_url" == "$url" ) ]]; then
    args+=("--proxy-server=$proxy_url")
    args+=("--proxy-bypass-list=localhost;127.0.0.1;<local>")
  fi

  DISPLAY="$TIKPAL_KIOSK_DISPLAY" "$TIKPAL_CHROMIUM_BIN" "${args[@]}" >/dev/null 2>&1 9>&- &
  target_window="$(wait_for_profile_window "$provider_profile" "$(profile_window_timeout_attempts "$TIKPAL_WEB_MODE_PROVIDER_WINDOW_TIMEOUT_SECONDS")" || true)"
  if [[ -z "$target_window" ]]; then
    [[ -n "$target_audio_bus" ]] && crossfade_helper set "$target_audio_bus" 0 >/dev/null 2>&1 || true
    close_transition_veil
    close_provider_profile "$provider_profile"
    [[ -n "$current_profile" ]] && start_window_guard "$current_profile" "$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel"
    fail "$(provider_label "$provider") did not open"
  fi
  start_provider_guard "$provider" "$provider_profile" "$url" "$proxy_enabled" "$provider_port"
  if [[ "$extension_enabled" == "1" ]] && ! wait_for_real_provider_url "$provider_port"; then
    [[ -n "$target_audio_bus" ]] && crossfade_helper set "$target_audio_bus" 0 >/dev/null 2>&1 || true
    close_transition_veil
    close_provider_profile "$provider_profile"
    if [[ -n "$current_provider" && "$current_profile" != "$provider_profile" ]]; then
      start_provider_guard "$current_provider" "$current_profile" "$(provider_url "$current_provider")" "$proxy_enabled" "$(provider_debug_port "$current_provider")"
      start_window_guard "$current_profile" "$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel"
    else
      stop_provider_guard
    fi
    fail "$(provider_label "$provider") did not enter the provider page within ${TIKPAL_WEB_MODE_PROVIDER_BOOTSTRAP_TIMEOUT_SECONDS}s"
  fi
  if ! wait_for_provider_ready "$provider_port" "$provider"; then
    [[ -n "$target_audio_bus" ]] && crossfade_helper set "$target_audio_bus" 0 >/dev/null 2>&1 || true
    close_transition_veil
    close_provider_profile "$provider_profile"
    if [[ -n "$current_provider" && "$current_profile" != "$provider_profile" ]]; then
      start_provider_guard "$current_provider" "$current_profile" "$(provider_url "$current_provider")" "$proxy_enabled" "$(provider_debug_port "$current_provider")"
      start_window_guard "$current_profile" "$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel"
    else
      stop_provider_guard
    fi
    fail "$(provider_label "$provider") did not become ready within ${TIKPAL_WEB_MODE_PROVIDER_READY_TIMEOUT_SECONDS}s"
  fi
  tile_window "$target_window" "$TIKPAL_WEB_MODE_LEFT_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW"
  raise_window "$target_window"
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
  close_transition_veil
  tile_window "$target_window" "$TIKPAL_WEB_MODE_LEFT_POSITION" "$TIKPAL_WEB_MODE_LEFT_WINDOW"
  raise_window "$target_window"
  write_audio_bus_state "$target_audio_bus"
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
    if [[ "$proxy_enabled" != "1" ]] && ! provider_direct_reachable "$provider"; then
      write_runtime_provider_status "$provider" "check_proxy" "$(provider_needs_proxy_message "$provider")"
      start_provider_pool_prewarm "$provider" force
      log "proxy disabled for $provider; marked check_proxy"
      return
    fi
    start_provider_guard "$provider" "$provider_profile" "$(provider_url "$provider")" "$proxy_enabled" "$(provider_debug_port "$provider")"
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
  log "provider prewarm: $TIKPAL_WEB_MODE_PROVIDER_PREWARM_ENABLED delay=${TIKPAL_WEB_MODE_PROVIDER_PREWARM_DELAY_SECONDS}s"
  log "popup blocking: $TIKPAL_WEB_MODE_POPUP_BLOCKING"
  log "extension: $TIKPAL_WEB_MODE_EXTENSION_ENABLED $TIKPAL_WEB_MODE_EXTENSION_DIR"
  log "provider text scale: $(read_provider_text_scale)"
  log "proxy apply timeout: ${TIKPAL_WEB_MODE_PROXY_APPLY_TIMEOUT_SECONDS}s"
  log "provider bootstrap timeout: ${TIKPAL_WEB_MODE_PROVIDER_BOOTSTRAP_TIMEOUT_SECONDS}s"
  log "provider window timeout: ${TIKPAL_WEB_MODE_PROVIDER_WINDOW_TIMEOUT_SECONDS}s"
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
  xdotool_bin="$(command -v xdotool || true)"
  [[ -n "$xdotool_bin" ]] || fail "xdotool is required for Explore provider window detection; install with: sudo apt-get install -y xdotool"
  log "xdotool: $xdotool_bin"
  log "check passed"
}

case "${1:-open}" in
  --check)
    check_runtime
    ;;
  open)
    check_runtime
    with_web_mode_lock open_provider "${2:-qq_music}"
    ;;
  close)
    with_web_mode_lock close_web_mode
    log "closed"
    ;;
  guard)
    run_window_guard "${2:-}" "${3:-}"
    ;;
  prewarm)
    prewarm_provider_pool "${2:-}"
    ;;
  keyboard)
    case "${2:-toggle}" in
      preload) with_onboard_lock preload_onboard ;;
      show) with_onboard_lock ensure_onboard ;;
      show-force) with_onboard_lock force_onboard ;;
      hide) with_onboard_lock hide_onboard ;;
      toggle) with_onboard_lock toggle_onboard ;;
      *) fail "Keyboard mode must be preload, show, show-force, hide, or toggle" ;;
    esac
    log "keyboard ${2:-toggle} ready"
    ;;
  proxy)
    check_runtime
    with_web_mode_lock apply_proxy_settings "${2:-spotify}"
    ;;
  *)
    fail "Usage: $0 open <provider>|close|prewarm <provider>|keyboard [show|hide|toggle]|proxy <provider>|--check"
    ;;
esac

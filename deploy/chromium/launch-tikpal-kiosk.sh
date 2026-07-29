#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="${TIKPAL_KIOSK_ENV_FILE:-$APP_DIR/.env.kiosk}"
FLAGS_FILE="${TIKPAL_CHROMIUM_FLAGS_FILE:-$SCRIPT_DIR/chromium-flags.conf}"

should_source_env_file() {
  local value
  value="$(printf '%s' "${TIKPAL_KIOSK_SKIP_ENV_SOURCE:-0}" | tr '[:upper:]' '[:lower:]')"
  case "$value" in
    1|true|yes|on)
      return 1
      ;;
    *)
      return 0
      ;;
  esac
}

if should_source_env_file && [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

: "${TIKPAL_KIOSK_URL:=http://localhost:4173/}"
: "${TIKPAL_KIOSK_WINDOW:=2560x720}"
: "${TIKPAL_KIOSK_WINDOW_POSITION:=0,0}"
: "${TIKPAL_KIOSK_DISPLAY:=:0}"
: "${TIKPAL_KIOSK_DISPLAY_MODE:=auto}"
: "${TIKPAL_KIOSK_ACTIVE_DISPLAY_MODE:=$TIKPAL_KIOSK_DISPLAY_MODE}"
: "${TIKPAL_KIOSK_XRANDR_MODE:=2560x720}"
: "${TIKPAL_KIOSK_XRANDR_OUTPUT:=}"
: "${TIKPAL_KIOSK_XRANDR_CLONE_OUTPUTS:=}"
: "${TIKPAL_KIOSK_X_COMMAND_TIMEOUT_SECONDS:=5}"
: "${TIKPAL_CHROMIUM_BIN:=/usr/lib/chromium-browser/chromium-browser}"
: "${TIKPAL_CHROMIUM_PROFILE_DIR:=$HOME/.config/tikpal-chromium-kiosk}"
: "${TIKPAL_CHROMIUM_COLOR_SCHEME:=dark}"
: "${TIKPAL_CHROMIUM_ALSA_OUTPUT_DEVICE:=}"
: "${TIKPAL_AUDIO_ADAPT_BIN:=$APP_DIR/deploy/moode/tikpal-audio-adapt.sh}"
: "${TIKPAL_KIOSK_REMOTE_DEBUG:=0}"
: "${TIKPAL_KIOSK_REMOTE_DEBUG_ADDRESS:=127.0.0.1}"
: "${TIKPAL_KIOSK_REMOTE_DEBUG_PORT:=9222}"
: "${TIKPAL_KIOSK_REMOTE_DEBUG_CHROMIUM_ADDRESS:=127.0.0.1}"
: "${TIKPAL_KIOSK_REMOTE_DEBUG_CHROMIUM_PORT:=$TIKPAL_KIOSK_REMOTE_DEBUG_PORT}"

MODE="launch"
if [[ "${1:-}" == "--check" ]]; then
  MODE="check"
fi

log() {
  printf '[tikpal-kiosk] %s\n' "$*"
}

fail() {
  log "ERROR: $*"
  exit 1
}

is_enabled() {
  local value
  value="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "$value" in
    1|true|yes|on|enabled)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
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

run_x_command() {
  if command -v timeout >/dev/null 2>&1; then
    timeout -k 1s "${TIKPAL_KIOSK_X_COMMAND_TIMEOUT_SECONDS}s" "$@"
    return
  fi
  "$@"
}

normalize_chromium_window_size() {
  local value
  value="$(printf '%s' "$1" | tr -d '[:space:]')"

  if [[ "$value" =~ ^([0-9]+)[xX,]([0-9]+)$ ]]; then
    printf '%s,%s\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
    return
  fi

  fail "Invalid TIKPAL_KIOSK_WINDOW '$1'; expected WIDTHxHEIGHT or WIDTH,HEIGHT"
}

TIKPAL_CHROMIUM_ALSA_OUTPUT_DEVICE="$(resolve_physical_alsa_output_device "$TIKPAL_CHROMIUM_ALSA_OUTPUT_DEVICE")"
CHROMIUM_WINDOW_SIZE="$(normalize_chromium_window_size "$TIKPAL_KIOSK_WINDOW")"

read_flags() {
  local flags=()
  local line
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    flags+=("$line")
  done < "$FLAGS_FILE"
  printf '%s\n' "${flags[@]}"
}

reset_chromium_profile_state() {
  mkdir -p "$TIKPAL_CHROMIUM_PROFILE_DIR/Default"
  rm -rf \
    "$TIKPAL_CHROMIUM_PROFILE_DIR/SingletonCookie" \
    "$TIKPAL_CHROMIUM_PROFILE_DIR/SingletonLock" \
    "$TIKPAL_CHROMIUM_PROFILE_DIR/SingletonSocket" \
    "$TIKPAL_CHROMIUM_PROFILE_DIR/Default/Sessions" \
    "$TIKPAL_CHROMIUM_PROFILE_DIR/Default/Session Storage"

  if command -v node >/dev/null 2>&1; then
    node - "$TIKPAL_CHROMIUM_PROFILE_DIR" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const profileDir = process.argv[2];

function patchJson(filePath, update) {
  let value = {};
  try {
    value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    value = {};
  }
  update(value);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

patchJson(path.join(profileDir, "Default", "Preferences"), (prefs) => {
  prefs.profile = { ...(prefs.profile ?? {}), exit_type: "Normal", exited_cleanly: true };
  prefs.browser = { ...(prefs.browser ?? {}), has_seen_welcome_page: true };
  delete prefs.session;
});

patchJson(path.join(profileDir, "Local State"), (state) => {
  state.exited_cleanly = true;
  state.profile = { ...(state.profile ?? {}), last_used: "Default" };
});
NODE
  fi
}

check_runtime() {
  log "app dir: $APP_DIR"
  log "env file: $ENV_FILE"
  log "kiosk url: $TIKPAL_KIOSK_URL"
  log "window: $TIKPAL_KIOSK_WINDOW"
  log "chromium window: $CHROMIUM_WINDOW_SIZE"
  log "window position: $TIKPAL_KIOSK_WINDOW_POSITION"
  log "display: $TIKPAL_KIOSK_DISPLAY"
  log "display mode: $TIKPAL_KIOSK_ACTIVE_DISPLAY_MODE"
  log "chromium: $TIKPAL_CHROMIUM_BIN"
  log "profile: $TIKPAL_CHROMIUM_PROFILE_DIR"
  log "alsa output device: ${TIKPAL_CHROMIUM_ALSA_OUTPUT_DEVICE:-default}"
  if is_enabled "$TIKPAL_KIOSK_REMOTE_DEBUG"; then
    log "remote debug: ${TIKPAL_KIOSK_REMOTE_DEBUG_ADDRESS}:${TIKPAL_KIOSK_REMOTE_DEBUG_PORT} -> ${TIKPAL_KIOSK_REMOTE_DEBUG_CHROMIUM_ADDRESS}:${TIKPAL_KIOSK_REMOTE_DEBUG_CHROMIUM_PORT}"
  else
    log "remote debug: off"
  fi
  log "flags: $FLAGS_FILE"

  [[ -f "$FLAGS_FILE" ]] || fail "Chromium flags file is missing"
  [[ -x "$TIKPAL_CHROMIUM_BIN" ]] || fail "Chromium binary is missing or not executable"
  mkdir -p "$TIKPAL_CHROMIUM_PROFILE_DIR" || fail "Cannot create Chromium profile directory"

  if [[ "$TIKPAL_KIOSK_URL" != http://localhost:* && "$TIKPAL_KIOSK_URL" != http://127.0.0.1:* ]]; then
    log "WARN: kiosk URL is not localhost; check this is intentional"
  fi

  if [[ "$TIKPAL_KIOSK_XRANDR_MODE" != "none" ]] && ! command -v xrandr >/dev/null 2>&1; then
    log "WARN: xrandr not found; display mode will not be enforced"
  fi

  log "check passed"
}

if [[ "$MODE" == "check" ]]; then
  check_runtime
  exit 0
fi

check_runtime
reset_chromium_profile_state

export DISPLAY="$TIKPAL_KIOSK_DISPLAY"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"
export GTK_IM_MODULE="${GTK_IM_MODULE:-fcitx}"
export QT_IM_MODULE="${QT_IM_MODULE:-fcitx}"
export XMODIFIERS="${XMODIFIERS:-@im=fcitx}"

if [[ "$TIKPAL_KIOSK_ACTIVE_DISPLAY_MODE" != "virtual" && "$TIKPAL_KIOSK_XRANDR_MODE" != "none" ]] && command -v xrandr >/dev/null 2>&1; then
  if [[ -n "$TIKPAL_KIOSK_XRANDR_OUTPUT" ]]; then
    XRANDR_ARGS=(--output "$TIKPAL_KIOSK_XRANDR_OUTPUT" --mode "$TIKPAL_KIOSK_XRANDR_MODE" --primary)
    if [[ -n "$TIKPAL_KIOSK_XRANDR_CLONE_OUTPUTS" ]]; then
      for clone_output in $TIKPAL_KIOSK_XRANDR_CLONE_OUTPUTS; do
        XRANDR_ARGS+=(--output "$clone_output" --mode "$TIKPAL_KIOSK_XRANDR_MODE" --same-as "$TIKPAL_KIOSK_XRANDR_OUTPUT")
      done
    fi
    run_x_command xrandr "${XRANDR_ARGS[@]}" || log "WARN: xrandr mode set failed or timed out"
  else
    run_x_command xrandr -s "$TIKPAL_KIOSK_XRANDR_MODE" || log "WARN: xrandr mode set failed or timed out"
  fi
fi

if command -v xset >/dev/null 2>&1; then
  run_x_command xset -dpms || true
  run_x_command xset s off || true
  run_x_command xset s noblank || true
fi

if command -v unclutter >/dev/null 2>&1; then
  unclutter -idle 0.1 -root >/dev/null 2>&1 &
fi

mapfile -t EXTRA_FLAGS < <(read_flags)
ARGS=(
  "--kiosk"
  "$TIKPAL_KIOSK_URL"
  "--user-data-dir=$TIKPAL_CHROMIUM_PROFILE_DIR"
  "--start-fullscreen"
  "--window-position=$TIKPAL_KIOSK_WINDOW_POSITION"
  "--window-size=$CHROMIUM_WINDOW_SIZE"
)

if [[ "$TIKPAL_CHROMIUM_COLOR_SCHEME" == "dark" ]]; then
  ARGS+=("--force-dark-mode" "--enable-features=WebUIDarkMode")
fi

if [[ -n "$TIKPAL_CHROMIUM_ALSA_OUTPUT_DEVICE" ]]; then
  ARGS+=("--alsa-output-device=$TIKPAL_CHROMIUM_ALSA_OUTPUT_DEVICE")
fi

if is_enabled "$TIKPAL_KIOSK_REMOTE_DEBUG"; then
  ARGS+=(
    "--remote-debugging-address=$TIKPAL_KIOSK_REMOTE_DEBUG_CHROMIUM_ADDRESS"
    "--remote-debugging-port=$TIKPAL_KIOSK_REMOTE_DEBUG_CHROMIUM_PORT"
  )
fi

log "launching Chromium"
exec "$TIKPAL_CHROMIUM_BIN" "${EXTRA_FLAGS[@]}" "${ARGS[@]}"

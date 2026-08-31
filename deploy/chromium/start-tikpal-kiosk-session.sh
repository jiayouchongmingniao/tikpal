#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="${TIKPAL_KIOSK_ENV_FILE:-$APP_DIR/.env.kiosk}"
export TIKPAL_APP_DIR="${TIKPAL_APP_DIR:-$APP_DIR}"

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

: "${TIKPAL_KIOSK_DISPLAY:=:0}"
: "${TIKPAL_KIOSK_X_COMMAND_TIMEOUT_SECONDS:=5}"
: "${TIKPAL_KIOSK_RESET_WEB_MODE_ON_START:=1}"
: "${TIKPAL_KIOSK_X_SESSION_GENERATION_PATH:=$APP_DIR/.tikpal/kiosk-x-session-generation}"
export DISPLAY="$TIKPAL_KIOSK_DISPLAY"
export TIKPAL_KIOSK_X_SESSION_GENERATION_PATH

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

read_preferred_input_method() {
  python3 - "$APP_DIR" <<'PY'
import json
import os
import sys

app_dir = sys.argv[1]
path = os.environ.get("TIKPAL_UI_PREFERENCES_STATE_PATH") or os.path.join(app_dir, ".tikpal", "ui-preferences.json")
candidate = "keyboard-us"
try:
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
    if data.get("inputMethodId") == "keyboard-us":
        candidate = "keyboard-us"
except Exception:
    pass
print(candidate)
PY
}

input_method_should_activate() {
  case "$1" in
    pinyin|keyboard-de|keyboard-it|hangul|anthy|keyboard-es)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

fcitx_candidate_font() {
  local preferred_family="Noto Sans CJK SC"
  case "$1" in
    anthy)
      preferred_family="Noto Sans CJK JP"
      ;;
    hangul)
      preferred_family="Noto Sans CJK KR"
      ;;
    pinyin)
      preferred_family="Noto Sans CJK SC"
      ;;
  esac

  if command -v fc-match >/dev/null 2>&1 &&
    fc-match "$preferred_family" 2>/dev/null | grep -qi "Noto Sans CJK"; then
    printf '%s 16\n' "$preferred_family"
    return 0
  fi

  if command -v fc-match >/dev/null 2>&1 &&
    fc-match "Source Han Sans CN" 2>/dev/null | grep -qi "Source Han"; then
    printf 'Source Han Sans CN 16\n'
    return 0
  fi

  printf 'WenQuanYi Zen Hei 16\n'
}

configure_fcitx5() {
  command -v fcitx5 >/dev/null 2>&1 || return 0
  local config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/fcitx5"
  local default_im
  default_im="$(read_preferred_input_method)"
  mkdir -p "$config_dir"
  cat >"$config_dir/profile" <<EOF
[Groups/0]
Name=Default
Default Layout=us
DefaultIM=$default_im

[Groups/0/Items/0]
Name=keyboard-us
Layout=

[Groups/0/Items/1]
Name=pinyin
Layout=

[Groups/0/Items/2]
Name=keyboard-de
Layout=

[Groups/0/Items/3]
Name=keyboard-it
Layout=

[Groups/0/Items/4]
Name=hangul
Layout=

[Groups/0/Items/5]
Name=anthy
Layout=

[Groups/0/Items/6]
Name=keyboard-es
Layout=

[GroupOrder]
0=Default
EOF
  cat >"$config_dir/config" <<'EOF'
[Hotkey/TriggerKeys]
0=F9
1=Control+space

[Behavior]
ActiveByDefault=False
ShareInputState=All
ShowInputMethodInformation=False
showInputMethodInformationWhenFocusIn=False
ShowFirstInputMethodInformation=False
DefaultPageSize=5
EOF
  mkdir -p "$config_dir/conf"
  local candidate_font
  candidate_font="$(fcitx_candidate_font "$default_im")"
  cat >"$config_dir/conf/classicui.conf" <<EOF
Vertical Candidate List=False
Font="$candidate_font"
MenuFont="$candidate_font"
TrayFont="$candidate_font"
EOF
  export GTK_IM_MODULE=fcitx
  export QT_IM_MODULE=fcitx
  export XMODIFIERS=@im=fcitx
  export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$(id -u)/bus}"
  fcitx5 -d --replace >/dev/null 2>&1 || true
  if command -v fcitx5-remote >/dev/null 2>&1; then
    sleep 0.2
    fcitx5-remote -s "$default_im" >/dev/null 2>&1 || true
  if input_method_should_activate "$default_im"; then
    fcitx5-remote -o >/dev/null 2>&1 || true
  else
      fcitx5-remote -c >/dev/null 2>&1 || true
    fi
  fi
  if [[ -f /usr/share/onboard/scripts/tikpalImeToggle.py ]]; then
    python3 /usr/share/onboard/scripts/tikpalImeToggle.py --set-mode keyboard-us >/dev/null 2>&1 || true
  fi
}

run_x_command() {
  if command -v timeout >/dev/null 2>&1; then
    timeout -k 1s "${TIKPAL_KIOSK_X_COMMAND_TIMEOUT_SECONDS}s" "$@"
    return
  fi
  "$@"
}

reset_web_mode_runtime() {
  if ! is_enabled "$TIKPAL_KIOSK_RESET_WEB_MODE_ON_START"; then
    return 0
  fi
  if [[ ! -x "$SCRIPT_DIR/tikpal-web-mode.sh" ]]; then
    return 0
  fi
  TIKPAL_KIOSK_SKIP_ENV_SOURCE=1 TIKPAL_WEB_MODE_STARTUP_RESET=1 "$SCRIPT_DIR/tikpal-web-mode.sh" close-full >/dev/null 2>&1 || true
}

publish_x_session_generation() {
  local generation temporary_path
  generation="$(head -n 1 /proc/sys/kernel/random/uuid 2>/dev/null || true)"
  [[ "$generation" =~ ^[A-Za-z0-9._:-]+$ ]] || generation="${BASHPID}-$(date +%s)-${RANDOM}"
  mkdir -p "$(dirname "$TIKPAL_KIOSK_X_SESSION_GENERATION_PATH")"
  temporary_path="$TIKPAL_KIOSK_X_SESSION_GENERATION_PATH.$$.$RANDOM.tmp"
  if ! printf '%s\n' "$generation" > "$temporary_path" \
    || ! mv -f "$temporary_path" "$TIKPAL_KIOSK_X_SESSION_GENERATION_PATH"; then
    rm -f "$temporary_path" 2>/dev/null || true
    return 1
  fi
}

publish_x_session_generation

if command -v xset >/dev/null 2>&1; then
  run_x_command xset -dpms || true
  run_x_command xset s off || true
  run_x_command xset s noblank || true
fi

configure_fcitx5
reset_web_mode_runtime

exec "$SCRIPT_DIR/launch-tikpal-kiosk.sh"

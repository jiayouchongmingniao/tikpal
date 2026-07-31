#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="${TIKPAL_KIOSK_ENV_FILE:-$APP_DIR/.env.kiosk}"

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
export DISPLAY="$TIKPAL_KIOSK_DISPLAY"

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
locale_to_method = {
    "en": "keyboard-us",
    "zh-CN": "pinyin",
    "de": "keyboard-de",
    "it": "keyboard-it",
    "ko": "hangul",
    "ja": "anthy",
    "es": "keyboard-es",
}
supported = set(locale_to_method.values())
candidate = "keyboard-us"
try:
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
    if data.get("inputMethodId") in supported:
        candidate = data["inputMethodId"]
    elif data.get("locale") in locale_to_method:
        candidate = locale_to_method[data["locale"]]
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
  local candidate_font="Source Han Sans CN 16"
  if command -v fc-match >/dev/null 2>&1 &&
    fc-match "Noto Sans CJK SC" 2>/dev/null | grep -qi "Noto Sans CJK"; then
    candidate_font="Noto Sans CJK SC 16"
  fi
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
    python3 /usr/share/onboard/scripts/tikpalImeToggle.py --set-mode "$default_im" >/dev/null 2>&1 || true
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
  TIKPAL_KIOSK_SKIP_ENV_SOURCE=1 "$SCRIPT_DIR/tikpal-web-mode.sh" close >/dev/null 2>&1 || true
}

if command -v xset >/dev/null 2>&1; then
  run_x_command xset -dpms || true
  run_x_command xset s off || true
  run_x_command xset s noblank || true
fi

configure_fcitx5
reset_web_mode_runtime

exec "$SCRIPT_DIR/launch-tikpal-kiosk.sh"

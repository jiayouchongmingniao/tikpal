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
export DISPLAY="$TIKPAL_KIOSK_DISPLAY"

configure_fcitx5() {
  command -v fcitx5 >/dev/null 2>&1 || return 0
  local config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/fcitx5"
  mkdir -p "$config_dir"
  cat >"$config_dir/profile" <<'EOF'
[Groups/0]
Name=Default
Default Layout=us
DefaultIM=pinyin

[Groups/0/Items/0]
Name=keyboard-us
Layout=

[Groups/0/Items/1]
Name=pinyin
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
ShareInputState=No
ShowInputMethodInformation=False
showInputMethodInformationWhenFocusIn=False
ShowFirstInputMethodInformation=False
DefaultPageSize=5
EOF
  mkdir -p "$config_dir/conf"
  cat >"$config_dir/conf/classicui.conf" <<'EOF'
Vertical Candidate List=False
Font="AR PL UMing CN 12"
EOF
  export GTK_IM_MODULE=fcitx
  export QT_IM_MODULE=fcitx
  export XMODIFIERS=@im=fcitx
  export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$(id -u)/bus}"
  fcitx5 -d --replace >/dev/null 2>&1 || true
}

run_x_command() {
  if command -v timeout >/dev/null 2>&1; then
    timeout -k 1s "${TIKPAL_KIOSK_X_COMMAND_TIMEOUT_SECONDS}s" "$@"
    return
  fi
  "$@"
}

if command -v xset >/dev/null 2>&1; then
  run_x_command xset -dpms || true
  run_x_command xset s off || true
  run_x_command xset s noblank || true
fi

configure_fcitx5

exec "$SCRIPT_DIR/launch-tikpal-kiosk.sh"

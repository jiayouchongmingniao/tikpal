#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
SERVICE_USER="${SUDO_USER:-moode}"
INSTALL_KIOSK=0
RESTART_SERVICES=0
KIOSK_PACKAGES=(
  xvfb
  x11vnc
  novnc
  websockify
  socat
  onboard
  wmctrl
  xdotool
  fcitx5
  fcitx5-anthy
  fcitx5-chinese-addons
  fcitx5-frontend-gtk3
  fcitx5-hangul
)

usage() {
  cat <<USAGE
Usage: sudo deploy/systemd/install-systemd-services.sh [options]

Options:
  --app-dir PATH       App directory on the Pi (default: current repo root)
  --user NAME          Service user (default: current user)
  --enable-kiosk       Install and enable tikpal-kiosk.service and watchdog timer
  --restart            Restart installed services after daemon-reload
  -h, --help           Show this help
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-dir)
      APP_DIR="$2"
      shift 2
      ;;
    --user)
      SERVICE_USER="$2"
      shift 2
      ;;
    --enable-kiosk)
      INSTALL_KIOSK=1
      shift
      ;;
    --restart)
      RESTART_SERVICES=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Please run with sudo so systemd units and Chromium policies can be installed." >&2
  exit 1
fi

APP_DIR="$(cd "$APP_DIR" && pwd)"

install_unit() {
  local template="$1"
  local target="/etc/systemd/system/$(basename "$template")"
  sed \
    -e "s|@APP_DIR@|$APP_DIR|g" \
    -e "s|@SERVICE_USER@|$SERVICE_USER|g" \
    "$template" > "$target"
  chmod 0644 "$target"
  echo "installed $target"
}

install_kiosk_packages() {
  local missing_packages=()
  local package
  command -v apt-get >/dev/null 2>&1 || {
    echo "WARN: apt-get not found; skipping kiosk package install" >&2
    return
  }
  for package in "${KIOSK_PACKAGES[@]}"; do
    if ! dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q "install ok installed"; then
      missing_packages+=("$package")
    fi
  done
  if [[ "${#missing_packages[@]}" -eq 0 ]]; then
    echo "kiosk packages already installed"
    return
  fi
  DEBIAN_FRONTEND=noninteractive apt-get update -y
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${missing_packages[@]}"
}

install_onboard_scripts() {
  local source_dir="$APP_DIR/deploy/chromium/onboard-scripts"
  local target_dir="/usr/share/onboard/scripts"
  [[ -d "$source_dir" ]] || return 0
  [[ -d "$target_dir" ]] || {
    echo "WARN: $target_dir not found; skipping Tikpal Onboard scripts" >&2
    return 0
  }
  install -m 0644 "$source_dir"/tikpalImeToggle.py "$target_dir/tikpalImeToggle.py"
  echo "installed $target_dir/tikpalImeToggle.py"
}

install_onboard_themes() {
  local source_dir="$APP_DIR/deploy/chromium/onboard-themes"
  local target_dir="/usr/share/onboard/themes"
  [[ -d "$source_dir" ]] || return 0
  [[ -d "$target_dir" ]] || {
    echo "WARN: $target_dir not found; skipping Tikpal Onboard themes" >&2
    return 0
  }
  install -m 0644 "$source_dir"/Tikpal-Classic.colors "$target_dir/Tikpal-Classic.colors"
  echo "installed $target_dir/Tikpal-Classic.colors"
}

install_physical_display_prepare() {
  local helper="$APP_DIR/deploy/chromium/tikpal-physical-display-prepare.sh"
  local target="/usr/local/sbin/tikpal-physical-display-prepare"
  local dropin_dir="/etc/systemd/system/tikpal-kiosk.service.d"
  local stability_unit="/etc/systemd/system/tikpal-display-stability.service"
  [[ -x "$helper" ]] || {
    echo "WARN: $helper not found; skipping physical display prepare install" >&2
    return 0
  }
  install -o root -g root -m 0755 "$helper" "$target"
  mkdir -p "$dropin_dir"
  cat > "$dropin_dir/physical-display.conf" <<EOF
[Unit]
Wants=display_turzx.service
After=display_turzx.service

[Service]
Environment=TIKPAL_KIOSK_ENV_FILE=$APP_DIR/.env.kiosk
ExecStartPre=+/usr/local/sbin/tikpal-physical-display-prepare wait-ready
ExecStartPost=+/bin/sh -c 'systemctl stop tikpal-physical-display-kick.service >/dev/null 2>&1 || true; if command -v systemd-run >/dev/null 2>&1; then systemd-run --quiet --collect --no-block --unit=tikpal-physical-display-kick --property=Type=oneshot --setenv=TIKPAL_KIOSK_ENV_FILE="\$TIKPAL_KIOSK_ENV_FILE" --setenv=HOME=/root /usr/local/sbin/tikpal-physical-display-prepare delayed-soft-kick; else nohup env TIKPAL_KIOSK_ENV_FILE="\$TIKPAL_KIOSK_ENV_FILE" HOME=/root /usr/local/sbin/tikpal-physical-display-prepare delayed-soft-kick >/var/log/tikpal-physical-display-kick.log 2>&1 & fi'
EOF
  chmod 0644 "$dropin_dir/physical-display.conf"
  cat > "$stability_unit" <<EOF
[Unit]
Description=Tikpal physical display PCI stability
After=systemd-udev-settle.service
Before=tikpal-kiosk.service

[Service]
Type=oneshot
Environment=TIKPAL_KIOSK_ENV_FILE=$APP_DIR/.env.kiosk
ExecStart=/usr/local/sbin/tikpal-physical-display-prepare pci-stabilize
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
  chmod 0644 "$stability_unit"
  systemctl enable tikpal-display-stability.service >/dev/null 2>&1 || true
  echo "installed $target"
  echo "installed $dropin_dir/physical-display.conf"
  echo "installed $stability_unit"
}

install_turzx_brightness_helper() {
  local helper="$APP_DIR/deploy/turzx/tikpal-turzx-brightness.sh"
  local target="/usr/local/sbin/tikpal-turzx-brightness"
  local sudoers_file="/etc/sudoers.d/tikpal-turzx-brightness"
  [[ -f "$helper" ]] || return 0
  install -o root -g root -m 0755 "$helper" "$target"
  echo "installed $target"
  if command -v visudo >/dev/null 2>&1; then
    local tmp_sudoers
    tmp_sudoers="$(mktemp)"
    cat > "$tmp_sudoers" <<EOF
Defaults:$SERVICE_USER env_keep += "TIKPAL_TURZX_PM_FIFO_IN TIKPAL_TURZX_PM_FIFO_OUT TIKPAL_TURZX_BRIGHTNESS_STATE TIKPAL_TURZX_DEFAULT_BRIGHTNESS TIKPAL_TURZX_HARDWARE_BRIGHTNESS_ENABLED TIKPAL_TURZX_SERVICE TIKPAL_TURZX_USB_ID"
$SERVICE_USER ALL=(root) NOPASSWD:SETENV: $target
EOF
    if visudo -cf "$tmp_sudoers" >/dev/null; then
      install -o root -g root -m 0440 "$tmp_sudoers" "$sudoers_file"
      echo "installed $sudoers_file"
    else
      echo "WARN: generated sudoers for TURZX brightness helper did not validate; skipping" >&2
    fi
    rm -f "$tmp_sudoers"
  fi
}

install_roonbridge_helpers() {
  local multiroom_helper="/usr/local/sbin/tikpal-multiroom-state"
  local roon_helper="/usr/local/sbin/tikpal-roonbridge-state"
  local audio_profile_helper="/usr/local/sbin/tikpal-audio-output-profile"
  local mpd_profile_helper="/usr/local/sbin/tikpal-mpd-bitperfect-profile"
  local sudoers_file="/etc/sudoers.d/tikpal-roonbridge-mpd"
  if [[ -f "$APP_DIR/deploy/moode/tikpal-multiroom-state.sh" ]]; then
    install -o root -g root -m 0755 "$APP_DIR/deploy/moode/tikpal-multiroom-state.sh" "$multiroom_helper"
    echo "installed $multiroom_helper"
  fi
  if [[ -f "$APP_DIR/deploy/moode/tikpal-roonbridge-state.sh" ]]; then
    install -o root -g root -m 0755 "$APP_DIR/deploy/moode/tikpal-roonbridge-state.sh" "$roon_helper"
    echo "installed $roon_helper"
  fi
  if [[ -f "$APP_DIR/deploy/moode/tikpal-audio-output-profile.sh" ]]; then
    install -o root -g root -m 0755 "$APP_DIR/deploy/moode/tikpal-audio-output-profile.sh" "$audio_profile_helper"
    echo "installed $audio_profile_helper"
  fi
  if [[ -f "$APP_DIR/deploy/moode/tikpal-mpd-bitperfect-profile.sh" ]]; then
    install -o root -g root -m 0755 "$APP_DIR/deploy/moode/tikpal-mpd-bitperfect-profile.sh" "$mpd_profile_helper"
    echo "installed $mpd_profile_helper"
  fi
  if command -v visudo >/dev/null 2>&1; then
    local tmp_sudoers
    tmp_sudoers="$(mktemp)"
    cat > "$tmp_sudoers" <<EOF
Defaults:$SERVICE_USER env_keep += "TIKPAL_MULTIROOM_ROON_SERVICE TIKPAL_MULTIROOM_ROON_LABEL TIKPAL_MULTIROOM_LYRION_SERVICE TIKPAL_MULTIROOM_LYRION_LABEL TIKPAL_MULTIROOM_TIKPAL_SERVICE TIKPAL_MULTIROOM_TIKPAL_LABEL TIKPAL_ROONBRIDGE_SERVICE TIKPAL_ROONBRIDGE_LABEL TIKPAL_MPD_CONF TIKPAL_MPD_STANDARD_ALSA_DEVICE TIKPAL_MPD_PURE_ALSA_DEVICE TIKPAL_MPD_BITPERFECT_ALSA_DEVICE TIKPAL_MPD_SLEEP_SAMPLE_RATE TIKPAL_MPD_SLEEP_VOLUME_LIMIT TIKPAL_AUDIO_CARD_FORCE"
$SERVICE_USER ALL=(root) NOPASSWD:SETENV: $multiroom_helper, $roon_helper, $audio_profile_helper, $mpd_profile_helper
EOF
    if visudo -cf "$tmp_sudoers" >/dev/null; then
      install -o root -g root -m 0440 "$tmp_sudoers" "$sudoers_file"
      echo "installed $sudoers_file"
    else
      echo "WARN: generated sudoers for Roon/MPD helpers did not validate; skipping" >&2
    fi
    rm -f "$tmp_sudoers"
  fi
}

ensure_library_scan_env() {
  local env_file="$APP_DIR/.env"
  local helper="$APP_DIR/deploy/moode/tikpal-library-sync.sh"
  local usb_helper="$APP_DIR/deploy/moode/tikpal-usb-library-sync.sh"
  [[ -f "$env_file" ]] || return 0
  local current
  current="$(sed -n 's/^TIKPAL_LIBRARY_SCAN_COMMAND=//p' "$env_file" | tail -n 1)"
  current="${current%\"}"
  current="${current#\"}"
  current="${current%\'}"
  current="${current#\'}"
  local updated=0
  if [[ -z "$current" || "$current" == *"tikpal-usb-library-sync.sh"* ]]; then
    {
      printf '\n# Tikpal Library Scan keeps repo Local music and removable USB roots visible to MPD.\n'
      printf 'TIKPAL_LIBRARY_SCAN_COMMAND="%s"\n' "$helper"
    } >> "$env_file"
    updated=1
  fi
  if ! grep -q '^TIKPAL_USB_LIBRARY_SCAN_COMMAND=' "$env_file"; then
    printf 'TIKPAL_USB_LIBRARY_SCAN_COMMAND="%s"\n' "$usb_helper" >> "$env_file"
    updated=1
  fi
  if ! grep -q '^TIKPAL_USB_LIBRARY_AUTO_UPDATE=' "$env_file"; then
    printf 'TIKPAL_USB_LIBRARY_AUTO_UPDATE=0\n' >> "$env_file"
    updated=1
  fi
  if ! grep -q '^TIKPAL_USB_LIBRARY_AUTO_UPDATE_MIN_MS=' "$env_file"; then
    printf 'TIKPAL_USB_LIBRARY_AUTO_UPDATE_MIN_MS=15000\n' >> "$env_file"
    updated=1
  fi
  if ! grep -q '^TIKPAL_USB_LIBRARY_AUTO_MOUNT=' "$env_file"; then
    printf 'TIKPAL_USB_LIBRARY_AUTO_MOUNT=1\n' >> "$env_file"
    updated=1
  fi
  if ! grep -q '^TIKPAL_USB_LIBRARY_MOUNT_ROOT=' "$env_file"; then
    printf 'TIKPAL_USB_LIBRARY_MOUNT_ROOT=/run/media/tikpal\n' >> "$env_file"
    updated=1
  fi
  if ! grep -q '^TIKPAL_USB_LIBRARY_AUTO_MOUNT_WAIT_SECONDS=' "$env_file"; then
    printf 'TIKPAL_USB_LIBRARY_AUTO_MOUNT_WAIT_SECONDS=8\n' >> "$env_file"
    updated=1
  fi
  if ! grep -q '^TIKPAL_NAS_AUTO_MOUNT=' "$env_file"; then
    printf 'TIKPAL_NAS_AUTO_MOUNT=1\n' >> "$env_file"
    updated=1
  fi
  if ! grep -q '^TIKPAL_MPC_UPDATE_TIMEOUT_SECONDS=' "$env_file"; then
    printf 'TIKPAL_MPC_UPDATE_TIMEOUT_SECONDS=8\n' >> "$env_file"
    updated=1
  fi
  [[ "$updated" -eq 1 ]] || return 0
  chown "$SERVICE_USER":"$SERVICE_USER" "$env_file" || true
  echo "updated $env_file with Tikpal library sync command"
}

ensure_kiosk_audio_release_env() {
  local env_file="$APP_DIR/.env"
  [[ -f "$env_file" ]] || return 0
  if grep -q '^TIKPAL_KIOSK_AUDIO_RELEASE_COMMAND=' "$env_file"; then
    return 0
  fi
  {
    printf '\n# Release Chromium audio services before MPD-backed Library or Radio reclaims _audioout.\n'
    printf 'TIKPAL_KIOSK_AUDIO_RELEASE_COMMAND="./deploy/moode/tikpal-release-kiosk-audio.sh"\n'
    printf 'TIKPAL_KIOSK_AUDIO_RELEASE_SETTLE_MS=250\n'
  } >> "$env_file"
  chown "$SERVICE_USER":"$SERVICE_USER" "$env_file" || true
  echo "updated $env_file with Tikpal kiosk audio release command"
}

ensure_turzx_brightness_env() {
  local env_file="$APP_DIR/.env"
  [[ -f "$env_file" ]] || return 0
  local updated=0
  if ! grep -q '^TIKPAL_TURZX_BRIGHTNESS_COMMAND=' "$env_file"; then
    {
      printf '\n# TURZX/EVDI USB display backlight. Used when the active RandR output is DVI-I-* or DVI-D-*.\n'
      printf 'TIKPAL_TURZX_BRIGHTNESS_COMMAND="sudo -n -E /usr/local/sbin/tikpal-turzx-brightness"\n'
      printf 'TIKPAL_TURZX_DEFAULT_BRIGHTNESS=45\n'
      printf 'TIKPAL_TURZX_HARDWARE_BRIGHTNESS_ENABLED=0\n'
    } >> "$env_file"
    updated=1
  fi
  [[ "$updated" -eq 1 ]] || return 0
  chown "$SERVICE_USER":"$SERVICE_USER" "$env_file" || true
  echo "updated $env_file with TURZX brightness command"
}

ensure_roonbridge_env() {
  local env_file="$APP_DIR/.env"
  [[ -f "$env_file" ]] || return 0
  local updated=0
  if ! grep -q '^TIKPAL_MULTIROOM_ROON_READY_COMMAND=' "$env_file"; then
    printf '\n# Multi-room Audio ecosystems can be enabled from Settings; playback handoff releases MPD/Radio while an endpoint owns ALSA.\n' >> "$env_file"
    printf 'TIKPAL_MULTIROOM_ROON_SERVICE=roonbridge.service\n' >> "$env_file"
    printf 'TIKPAL_MULTIROOM_ROON_READY_COMMAND="sudo -n -E /usr/local/sbin/tikpal-multiroom-state roon ready"\n' >> "$env_file"
    printf 'TIKPAL_MULTIROOM_ROON_ACTIVE_COMMAND="sudo -n -E /usr/local/sbin/tikpal-multiroom-state roon active"\n' >> "$env_file"
    printf 'TIKPAL_MULTIROOM_ROON_ENABLE_COMMAND="sudo -n -E /usr/local/sbin/tikpal-multiroom-state roon enable"\n' >> "$env_file"
    printf 'TIKPAL_MULTIROOM_ROON_DISABLE_COMMAND="sudo -n -E /usr/local/sbin/tikpal-multiroom-state roon disable"\n' >> "$env_file"
    printf 'TIKPAL_MULTIROOM_ROON_LABEL_COMMAND="sudo -n -E /usr/local/sbin/tikpal-multiroom-state roon label"\n' >> "$env_file"
    printf 'TIKPAL_MULTIROOM_LYRION_SERVICE=squeezelite.service\n' >> "$env_file"
    printf 'TIKPAL_MULTIROOM_LYRION_READY_COMMAND="sudo -n -E /usr/local/sbin/tikpal-multiroom-state lyrion ready"\n' >> "$env_file"
    printf 'TIKPAL_MULTIROOM_LYRION_ACTIVE_COMMAND="sudo -n -E /usr/local/sbin/tikpal-multiroom-state lyrion active"\n' >> "$env_file"
    printf 'TIKPAL_MULTIROOM_LYRION_ENABLE_COMMAND="sudo -n -E /usr/local/sbin/tikpal-multiroom-state lyrion enable"\n' >> "$env_file"
    printf 'TIKPAL_MULTIROOM_LYRION_DISABLE_COMMAND="sudo -n -E /usr/local/sbin/tikpal-multiroom-state lyrion disable"\n' >> "$env_file"
    printf 'TIKPAL_MULTIROOM_LYRION_LABEL_COMMAND="sudo -n -E /usr/local/sbin/tikpal-multiroom-state lyrion label"\n' >> "$env_file"
    printf 'TIKPAL_MULTIROOM_TIKPAL_SERVICE=tikpal-multiroom.service\n' >> "$env_file"
    printf 'TIKPAL_MULTIROOM_TIKPAL_READY_COMMAND="sudo -n -E /usr/local/sbin/tikpal-multiroom-state tikpal ready"\n' >> "$env_file"
    printf 'TIKPAL_MULTIROOM_TIKPAL_ACTIVE_COMMAND="sudo -n -E /usr/local/sbin/tikpal-multiroom-state tikpal active"\n' >> "$env_file"
    printf 'TIKPAL_MULTIROOM_TIKPAL_ENABLE_COMMAND="sudo -n -E /usr/local/sbin/tikpal-multiroom-state tikpal enable"\n' >> "$env_file"
    printf 'TIKPAL_MULTIROOM_TIKPAL_DISABLE_COMMAND="sudo -n -E /usr/local/sbin/tikpal-multiroom-state tikpal disable"\n' >> "$env_file"
    printf 'TIKPAL_MULTIROOM_TIKPAL_LABEL_COMMAND="sudo -n -E /usr/local/sbin/tikpal-multiroom-state tikpal label"\n' >> "$env_file"
    updated=1
  fi
  if ! grep -q '^TIKPAL_ROONBRIDGE_SERVICE=' "$env_file"; then
    printf '\n# Legacy Roon Bridge commands are kept for old clients and rollback.\n' >> "$env_file"
    printf 'TIKPAL_ROONBRIDGE_SERVICE=roonbridge.service\n' >> "$env_file"
    updated=1
  fi
  if ! grep -q '^TIKPAL_ROONBRIDGE_READY_COMMAND=' "$env_file"; then
    printf 'TIKPAL_ROONBRIDGE_READY_COMMAND="sudo -n -E /usr/local/sbin/tikpal-roonbridge-state ready"\n' >> "$env_file"
    updated=1
  fi
  if ! grep -q '^TIKPAL_ROONBRIDGE_ACTIVE_COMMAND=' "$env_file"; then
    printf 'TIKPAL_ROONBRIDGE_ACTIVE_COMMAND="sudo -n -E /usr/local/sbin/tikpal-roonbridge-state active"\n' >> "$env_file"
    updated=1
  fi
  if ! grep -q '^TIKPAL_ROONBRIDGE_ENABLE_COMMAND=' "$env_file"; then
    printf 'TIKPAL_ROONBRIDGE_ENABLE_COMMAND="sudo -n -E /usr/local/sbin/tikpal-roonbridge-state enable"\n' >> "$env_file"
    updated=1
  fi
  if ! grep -q '^TIKPAL_ROONBRIDGE_DISABLE_COMMAND=' "$env_file"; then
    printf 'TIKPAL_ROONBRIDGE_DISABLE_COMMAND="sudo -n -E /usr/local/sbin/tikpal-roonbridge-state disable"\n' >> "$env_file"
    updated=1
  fi
  if ! grep -q '^TIKPAL_ROONBRIDGE_LABEL_COMMAND=' "$env_file"; then
    printf 'TIKPAL_ROONBRIDGE_LABEL_COMMAND="sudo -n -E /usr/local/sbin/tikpal-roonbridge-state label"\n' >> "$env_file"
    updated=1
  fi
  if ! grep -q '^TIKPAL_AUDIO_OUTPUT_PROFILE_COMMAND=' "$env_file"; then
    printf '\n# MPD listening profile switcher used by Settings -> Audio Output.\n' >> "$env_file"
    printf 'TIKPAL_AUDIO_OUTPUT_PROFILE_COMMAND="sudo -n -E /usr/local/sbin/tikpal-audio-output-profile %%PROFILE%%"\n' >> "$env_file"
    updated=1
  fi
  if ! grep -q '^TIKPAL_MPD_BITPERFECT_PROFILE_COMMAND=' "$env_file"; then
    printf '# Legacy Standard/Bit-perfect wrapper kept for old clients and rollback.\n' >> "$env_file"
    printf 'TIKPAL_MPD_BITPERFECT_PROFILE_COMMAND="sudo -n -E /usr/local/sbin/tikpal-mpd-bitperfect-profile %%MODE%%"\n' >> "$env_file"
    updated=1
  fi
  if ! grep -q '^TIKPAL_MPD_STANDARD_ALSA_DEVICE=' "$env_file"; then
    printf 'TIKPAL_MPD_STANDARD_ALSA_DEVICE=_audioout\n' >> "$env_file"
    updated=1
  fi
  if ! grep -q '^TIKPAL_MPD_PURE_ALSA_DEVICE=' "$env_file"; then
    printf 'TIKPAL_MPD_PURE_ALSA_DEVICE=\n' >> "$env_file"
    updated=1
  fi
  if ! grep -q '^TIKPAL_MPD_BITPERFECT_ALSA_DEVICE=' "$env_file"; then
    printf 'TIKPAL_MPD_BITPERFECT_ALSA_DEVICE=\n' >> "$env_file"
    updated=1
  fi
  if ! grep -q '^TIKPAL_MPD_SLEEP_SAMPLE_RATE=' "$env_file"; then
    printf 'TIKPAL_MPD_SLEEP_SAMPLE_RATE=48000\n' >> "$env_file"
    updated=1
  fi
  if ! grep -q '^TIKPAL_MPD_SLEEP_VOLUME_LIMIT=' "$env_file"; then
    printf 'TIKPAL_MPD_SLEEP_VOLUME_LIMIT=45\n' >> "$env_file"
    updated=1
  fi
  [[ "$updated" -eq 1 ]] || return 0
  chown "$SERVICE_USER":"$SERVICE_USER" "$env_file" || true
  echo "updated $env_file with Multi-room Audio and Audio Output commands"
}

ensure_radio_presets() {
  [[ "${TIKPAL_INSTALL_RADIO_PRESETS:-1}" != "0" ]] || return 0
  local helper="$APP_DIR/deploy/moode/tikpal-radio-presets-sync.sh"
  [[ -x "$helper" ]] || {
    echo "WARN: $helper not found; skipping Tikpal Radio preset sync" >&2
    return 0
  }
  "$helper" apply
}

if [[ ! -f "$APP_DIR/server/index.mjs" || ! -f "$APP_DIR/server/web.mjs" ]]; then
  echo "Missing Tikpal server files under $APP_DIR" >&2
  exit 1
fi

if [[ ! -d "$APP_DIR/dist" ]]; then
  echo "Missing $APP_DIR/dist. Run npm ci && npm run build before installing services." >&2
  exit 1
fi

if [[ "${TIKPAL_INSTALL_LOCALE_FIX:-1}" != "0" && -x "$APP_DIR/deploy/moode/tikpal-locale-enable.sh" ]]; then
  "$APP_DIR/deploy/moode/tikpal-locale-enable.sh"
fi

ensure_library_scan_env
ensure_kiosk_audio_release_env
install_turzx_brightness_helper
ensure_turzx_brightness_env
install_roonbridge_helpers
ensure_roonbridge_env
ensure_radio_presets

install_unit "$SCRIPT_DIR/tikpal-api.service"
install_unit "$SCRIPT_DIR/tikpal-web.service"
install_unit "$SCRIPT_DIR/tikpal-audio-adapt.service"
install_unit "$SCRIPT_DIR/tikpal-library-sync.service"

if [[ "$INSTALL_KIOSK" -eq 1 ]]; then
  if [[ "${TIKPAL_INSTALL_KIOSK_PACKAGES:-1}" != "0" ]]; then
    install_kiosk_packages
  fi
  install_onboard_scripts
  install_onboard_themes
  install_physical_display_prepare
  install_unit "$SCRIPT_DIR/tikpal-kiosk.service"
  install_unit "$SCRIPT_DIR/tikpal-kiosk-viewer.service"
  install_unit "$SCRIPT_DIR/tikpal-kiosk-devtools.service"
  install_unit "$SCRIPT_DIR/tikpal-kiosk-watchdog.service"
  install_unit "$SCRIPT_DIR/tikpal-kiosk-watchdog.timer"
  if [[ ! -f "$APP_DIR/.env.kiosk" ]]; then
    cp "$APP_DIR/deploy/chromium/env.kiosk.example" "$APP_DIR/.env.kiosk"
    chown "$SERVICE_USER":"$SERVICE_USER" "$APP_DIR/.env.kiosk" || true
    echo "created $APP_DIR/.env.kiosk from example"
  fi
  web_mode_audio_device="$(sed -n 's/^TIKPAL_WEB_MODE_ALSA_OUTPUT_DEVICE=//p' "$APP_DIR/.env.kiosk" | tail -n 1)"
  web_mode_audio_device="${web_mode_audio_device%\"}"
  web_mode_audio_device="${web_mode_audio_device#\"}"
  if [[ -n "$web_mode_audio_device" && -x "$APP_DIR/deploy/moode/tikpal-web-mode-crossfade.sh" ]]; then
    if ! TIKPAL_WEB_MODE_ALSA_OUTPUT_DEVICE="$web_mode_audio_device" \
      "$APP_DIR/deploy/moode/tikpal-web-mode-crossfade.sh" install; then
      echo "WARN: Explore audio crossfade install failed; continuing with direct provider audio" >&2
    fi
  fi
fi

for policy_dir in /etc/chromium/policies/managed /etc/chromium-browser/policies/managed; do
  mkdir -p "$policy_dir"
  rm -f "$policy_dir/tikpal-kiosk-managed.json"
  cp "$APP_DIR/deploy/chromium/managed-policies.json" "$policy_dir/tikpal-kiosk.json"
  chmod 0644 "$policy_dir/tikpal-kiosk.json"
  echo "installed $policy_dir/tikpal-kiosk.json"
done

systemctl daemon-reload
systemctl enable tikpal-audio-adapt.service tikpal-library-sync.service tikpal-api.service tikpal-web.service

if [[ "$INSTALL_KIOSK" -eq 1 ]]; then
  loginctl enable-linger "$SERVICE_USER"
  systemctl enable tikpal-kiosk.service tikpal-kiosk-viewer.service tikpal-kiosk-devtools.service tikpal-kiosk-watchdog.timer
  if systemctl is-active --quiet kiosk.service; then
    echo "WARN: legacy kiosk.service is active. Inspect it before enabling Tikpal as the only screen owner." >&2
  fi
fi

if [[ "$RESTART_SERVICES" -eq 1 ]]; then
  systemctl restart tikpal-audio-adapt.service
  systemctl restart tikpal-library-sync.service
  systemctl restart tikpal-api.service
  systemctl restart tikpal-web.service
  if [[ "$INSTALL_KIOSK" -eq 1 ]]; then
    systemctl restart tikpal-kiosk.service
    systemctl restart tikpal-kiosk-viewer.service
    systemctl restart tikpal-kiosk-devtools.service
    systemctl restart tikpal-kiosk-watchdog.timer
  fi
fi

echo "Tikpal services installed."
echo "Verify with:"
echo "  systemctl status tikpal-audio-adapt.service"
echo "  $APP_DIR/deploy/moode/tikpal-audio-adapt.sh check"
echo "  systemctl status tikpal-library-sync.service"
echo "  $APP_DIR/deploy/moode/tikpal-library-sync.sh check"
echo "  systemctl is-active tikpal-api.service tikpal-web.service"
echo "  curl -fsS http://127.0.0.1:8787/api/v1/health"
echo "  curl -fsSI http://127.0.0.1:4173/"
echo "  curl -fsSI http://127.0.0.1:4174/"
if [[ "$INSTALL_KIOSK" -eq 1 ]]; then
  echo "  $APP_DIR/deploy/chromium/launch-tikpal-kiosk.sh --check"
  echo "  systemctl status tikpal-kiosk.service"
  echo "  systemctl status tikpal-kiosk-viewer.service"
  echo "  systemctl status tikpal-kiosk-devtools.service"
  echo "  systemctl status tikpal-kiosk-watchdog.timer"
  echo "  $APP_DIR/deploy/chromium/tikpal-kiosk-healthcheck.sh --check"
fi

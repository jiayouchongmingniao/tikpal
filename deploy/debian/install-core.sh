#!/usr/bin/env bash
# Debian 12 ARM64 core only. Never installs audio replacement services or a browser.
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVICE_USER="${1:-${SUDO_USER:-}}"
[[ $(id -u) == 0 && -n "$SERVICE_USER" && "$SERVICE_USER" != root ]] || { echo 'Usage: sudo bash deploy/debian/install-core.sh USER' >&2; exit 1; }
source /etc/os-release
[[ "$ID" == debian && "$VERSION_ID" == 12 && "$(dpkg --print-architecture)" == arm64 ]] || { echo 'Requires Debian 12 arm64' >&2; exit 1; }
[[ -f /etc/gdm3/daemon.conf ]] || { echo 'Requires the existing GDM display manager' >&2; exit 1; }
SERVICE_HOME="$(getent passwd "$SERVICE_USER" | cut -d: -f6)"
SERVICE_UID="$(id -u "$SERVICE_USER")"
[[ -d "$SERVICE_HOME" && "$APP_DIR" =~ ^/[a-zA-Z0-9_./-]+$ && "$SERVICE_HOME" =~ ^/[a-zA-Z0-9_./-]+$ ]] || exit 1
BACKUP="$SERVICE_HOME/tikpal-migration/install-backup"
mkdir -p "$BACKUP/files"
touch "$BACKUP/manifest.tsv"
managed_install() {
  local source="$1" target="$2" mode="${3:-644}" owner="${4:-$SERVICE_USER}"
  if ! cut -f2 "$BACKUP/manifest.tsv" | grep -Fxq "$target"; then
    if [[ -e "$target" ]]; then
      mkdir -p "$BACKUP/files$(dirname "$target")"
      cp -a "$target" "$BACKUP/files$target"
      printf 'existing\t%s\n' "$target" >> "$BACKUP/manifest.tsv"
    else
      printf 'new\t%s\n' "$target" >> "$BACKUP/manifest.tsv"
    fi
  fi
  install -D -o "$owner" -g "$(id -gn "$owner")" -m "$mode" "$source" "$target.new.$$"
  mv -f "$target.new.$$" "$target"
}
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
[[ -f "$BACKUP/packages-before.tsv" ]] || dpkg-query -W > "$BACKUP/packages-before.tsv"
packages=(ca-certificates curl xz-utils build-essential pkg-config libxcb1-dev libjson-c-dev
  xdotool wmctrl x11-utils x11-xserver-utils xvfb xauth jq sqlite3 mpd mpc ffmpeg rsync)
apt-get update
apt-get --simulate install --no-install-recommends --no-upgrade "${packages[@]}" > "$BACKUP/apt-plan.txt"
# Protect Radxa's kernel/browser/graphics packages from an implicit replacement.
if grep -Eq '^(Remv |Inst (linux-|chromium|mesa|lib.*mesa|libmali|rockchip))' "$BACKUP/apt-plan.txt"; then
  cat "$BACKUP/apt-plan.txt" >&2
  echo 'Package plan would change the protected platform; inspect before proceeding' >&2
  exit 1
fi
# Suppress package postinst service starts; restore any original policy immediately.
policy=/usr/sbin/policy-rc.d
if [[ -e "$policy" ]]; then cp -a "$policy" "$tmp/policy-rc.d"; fi
restore_policy() {
  if [[ -e "$tmp/policy-rc.d" ]]; then cp -a "$tmp/policy-rc.d" "$policy"; else rm -f "$policy"; fi
}
trap 'restore_policy; rm -rf "$tmp"' EXIT
printf '#!/bin/sh\nexit 101\n' > "$policy"
chmod 755 "$policy"
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends --no-upgrade "${packages[@]}"
restore_policy
trap 'rm -rf "$tmp"' EXIT
# The distro MPD must not compete with the per-user daemon on the next boot.
for unit in mpd.service mpd.socket; do
  if [[ ! -e "$BACKUP/$unit.enabled" ]]; then
    systemctl is-enabled "$unit" > "$BACKUP/$unit.enabled" 2>/dev/null || true
  fi
  if systemctl is-active --quiet "$unit"; then
    echo "An existing $unit is active; refusing to replace it" >&2; exit 1
  fi
  systemctl disable "$unit"
done
node_name=node-v24.21.0-linux-arm64
node_sha=6ad1325edbdb5649c379b75a237147a666c95d4f9ae8d340fef2d1575d289ad2
if [[ ! -x "/opt/tikpal/$node_name/bin/node" ]]; then
  curl -fL --retry 2 "https://nodejs.org/dist/v24.21.0/$node_name.tar.xz" -o "$tmp/node.tar.xz"
  printf '%s  %s\n' "$node_sha" "$tmp/node.tar.xz" | sha256sum -c -
  mkdir -p /opt/tikpal
  tar -xJf "$tmp/node.tar.xz" -C /opt/tikpal
fi
cc -std=c11 -O2 -Wall -Wextra -Werror -D_POSIX_C_SOURCE=200809L \
  $(pkg-config --cflags xcb json-c) "$APP_DIR/deploy/chromium/tikpal-x11-helper.c" \
  -o "$tmp/tikpal-x11-helper" $(pkg-config --libs xcb json-c)
"$tmp/tikpal-x11-helper" self-test
managed_install "$tmp/tikpal-x11-helper" /usr/local/libexec/tikpal-x11-helper 755 root
cc -std=c11 -O2 -Wall -Wextra -Werror $(pkg-config --cflags xcb) \
  "$APP_DIR/deploy/debian/xdotool-compat.c" -o "$tmp/xdotool" $(pkg-config --libs xcb)
managed_install "$tmp/xdotool" "$SERVICE_HOME/.local/lib/tikpal/bin/xdotool" 755
install -d -o "$SERVICE_USER" -g "$(id -gn "$SERVICE_USER")" \
  /var/lib/tikpal "$SERVICE_HOME/.config/tikpal" "$SERVICE_HOME/.config/systemd/user" \
  "$SERVICE_HOME/.config/autostart" "$SERVICE_HOME/.local/share/tikpal" "$SERVICE_HOME/.local/share/tikpal/music" \
  "$SERVICE_HOME/.local/share/tikpal/playlists" "$SERVICE_HOME/.config/tikpal-web-mode" "$APP_DIR/.tikpal"
if [[ ! -e /var/lib/tikpal/radio.sqlite3 ]]; then
  managed_install "$APP_DIR/deploy/moode/data/tikpal-radio-36.sqlite3" /var/lib/tikpal/radio.sqlite3
fi
cat > "$tmp/mpd.conf" <<EOF
music_directory "$SERVICE_HOME/.local/share/tikpal/music"
playlist_directory "$SERVICE_HOME/.local/share/tikpal/playlists"
db_file "$SERVICE_HOME/.local/share/tikpal/mpd.db"
state_file "$SERVICE_HOME/.local/share/tikpal/mpd.state"
sticker_file "$SERVICE_HOME/.local/share/tikpal/sticker.sql"
log_file "syslog"
bind_to_address "127.0.0.1"
port "6600"
restore_paused "yes"
audio_output {
  type "alsa"
  name "Tikpal PipeWire"
  device "pipewire"
  mixer_type "hardware"
  mixer_device "pipewire"
  mixer_control "Master"
}
EOF
managed_install "$tmp/mpd.conf" "$SERVICE_HOME/.config/tikpal/mpd.conf"
if [[ ! -e "$APP_DIR/.env.kiosk" ]]; then
  cat > "$tmp/env" <<EOF
NODE_ENV=production
PATH=$SERVICE_HOME/.local/lib/tikpal/bin:/opt/tikpal/node-v24.21.0-linux-arm64/bin:/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin
TIKPAL_PLAYER_BACKEND=mpc
TIKPAL_MPD_MUSIC_ROOT=$SERVICE_HOME/.local/share/tikpal/music
TIKPAL_RADIO_SQLITE_DB=/var/lib/tikpal/radio.sqlite3
TIKPAL_RADIO_LOGO_DIR=$APP_DIR/public/assets/radio-logos
TIKPAL_API_HOST=127.0.0.1
TIKPAL_WEB_KIOSK_HOST=127.0.0.1
TIKPAL_WEB_REMOTE_HOST=127.0.0.1
TIKPAL_KIOSK_XRANDR_MODE=none
TIKPAL_CHROMIUM_BIN=/usr/bin/chromium
TIKPAL_CHROMIUM_FLAGS_FILE=$SERVICE_HOME/.config/tikpal/chromium-flags.conf
TIKPAL_CHROMIUM_PROFILE_DIR=$SERVICE_HOME/.config/tikpal-chromium-kiosk
TIKPAL_CHROMIUM_ALSA_OUTPUT_DEVICE=default
TIKPAL_WEB_MODE_ALSA_OUTPUT_DEVICE=default
TIKPAL_WEB_MODE_RUNTIME_USER=$SERVICE_USER
TIKPAL_WEB_MODE_PROFILE_ROOT=$SERVICE_HOME/.config/tikpal-web-mode
TIKPAL_WEB_MODE_SYSTEM_WIDEVINE_CDM_DIR=/usr/lib/chromium/WidevineCdm
TIKPAL_WEB_MODE_DEFAULT_PROXY_URL=http://127.0.0.1:7897
TIKPAL_WEB_MODE_AUDIO_CROSSFADE_ENABLED=0
TIKPAL_WEB_MODE_PROVIDER_PREWARM_ENABLED=0
TIKPAL_WEB_MODE_BOOT_PREWARM_ENABLED=0
TIKPAL_WEB_MODE_ONBOARD=0
TIKPAL_WEB_MODE_X11_HELPER_MODE=disabled
TIKPAL_WEB_MODE_CDP_SESSION_MANAGER=1
TIKPAL_WEB_MODE_CDP_SESSION_MANAGER_SOCKET=/run/user/$SERVICE_UID/tikpal/cdp-session-manager.sock
TIKPAL_WEB_MODE_PROVIDER_BACKGROUND_FREEZE_ENABLED=1
TIKPAL_WEB_MODE_PROVIDER_BACKGROUND_PROCESS_FREEZE_ENABLED=1
TIKPAL_WEB_MODE_NETEASE_MUSIC_AUDIO_BUFFER_SIZE=8192
TIKPAL_WEB_MODE_X11_HELPER_SOCKET=/run/user/$SERVICE_UID/tikpal/x11-helper.sock
TIKPAL_WEB_MODE_X11_HELPER_GENERATION_PATH=$SERVICE_HOME/.config/tikpal-web-mode/x11-helper-generation
TIKPAL_WEB_MODE_PROVIDER_SWITCH_MARKER_PATH=/run/user/$SERVICE_UID/tikpal/provider-switch.pid
TIKPAL_WEB_MODE_PHYSICAL_REVEAL_STAMP_PATH=/run/user/$SERVICE_UID/tikpal/last-physical-reveal.tsv
TIKPAL_KIOSK_REMOTE_DEBUG=1
TIKPAL_KIOSK_REMOTE_DEBUG_PORT=9222
TIKPAL_OUTPUT_VOLUME_GET_COMMAND='amixer -D pipewire get Master'
TIKPAL_OUTPUT_VOLUME_SET_COMMAND='amixer -D pipewire sset Master %VALUE%%'
TIKPAL_AUDIO_OUTPUT_PROFILE_COMMAND=
TIKPAL_MPD_BITPERFECT_PROFILE_COMMAND=
TIKPAL_STARTUP_SCENE_SOUND_ENABLED=0
EOF
  managed_install "$tmp/env" "$APP_DIR/.env.kiosk" 600
fi
if [[ ! -e "$APP_DIR/.tikpal/web-mode-settings.json" ]]; then
  printf '{"proxyEnabled":false,"proxyUrl":"http://127.0.0.1:7897","providerTextScale":1.1}\n' > "$tmp/settings"
  managed_install "$tmp/settings" "$APP_DIR/.tikpal/web-mode-settings.json" 600
fi
cp "$APP_DIR/deploy/chromium/chromium-flags.conf" "$tmp/flags"
printf '\n--class=tikpal-chromium\n' >> "$tmp/flags"
managed_install "$tmp/flags" "$SERVICE_HOME/.config/tikpal/chromium-flags.conf"
for service in mpd api web cdp helper kiosk; do
  cat > "$tmp/unit" <<EOF
[Unit]
Description=Tikpal Debian $service
PartOf=tikpal-debian.target graphical-session.target
After=pipewire.service wireplumber.service
[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStart=/bin/bash $APP_DIR/deploy/debian/run-service.sh $service
Restart=on-failure
RestartSec=3
TimeoutStopSec=15
KillMode=control-group
EOF
  managed_install "$tmp/unit" "$SERVICE_HOME/.config/systemd/user/tikpal-debian-$service.service"
done
cat > "$tmp/target" <<EOF
[Unit]
Description=Tikpal Debian graphical session
PartOf=graphical-session.target
Wants=tikpal-debian-mpd.service tikpal-debian-api.service tikpal-debian-web.service tikpal-debian-cdp.service tikpal-debian-helper.service tikpal-debian-kiosk.service
EOF
managed_install "$tmp/target" "$SERVICE_HOME/.config/systemd/user/tikpal-debian.target"
cat > "$tmp/session" <<EOF
[Desktop Entry]
Type=Application
Name=Tikpal Kiosk
Comment=Standalone Tikpal X11 session
Exec=/bin/bash $APP_DIR/deploy/debian/kiosk-session.sh
TryExec=/usr/bin/bash
DesktopNames=Tikpal
EOF
managed_install "$tmp/session" /usr/share/xsessions/tikpal.desktop 644 root
# Select the dedicated X11 session for automatic login, keeping KDE installed.
python3 - "$SERVICE_USER" "$tmp" <<'PYCONFIG'
import configparser, pathlib, sys
user, temporary = sys.argv[1:]
for source, target, section, values in [
    ('/etc/gdm3/daemon.conf', 'gdm.conf', 'daemon', {'WaylandEnable':'false', 'AutomaticLoginEnable':'true', 'AutomaticLogin':user, 'DefaultSession':'tikpal.desktop'}),
    ('/var/lib/AccountsService/users/'+user, 'account.conf', 'User', {'XSession':'tikpal', 'Session':'tikpal', 'SessionType':'x11'}),
]:
    config=configparser.ConfigParser(interpolation=None, strict=False)
    config.optionxform=str
    config.read(source)
    if not config.has_section(section): config.add_section(section)
    for key,value in values.items(): config.set(section,key,value)
    with open(pathlib.Path(temporary)/target,'w') as output: config.write(output, space_around_delimiters=False)
PYCONFIG
managed_install "$tmp/gdm.conf" /etc/gdm3/daemon.conf 644 root
managed_install "$tmp/account.conf" "/var/lib/AccountsService/users/$SERVICE_USER" 600 root
chown -R "$SERVICE_USER:$(id -gn "$SERVICE_USER")" "$BACKUP"
runuser -u "$SERVICE_USER" -- env XDG_RUNTIME_DIR="/run/user/$SERVICE_UID" \
  DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$SERVICE_UID/bus" systemctl --user daemon-reload
dpkg-query -W > "$BACKUP/packages-after.tsv"
echo 'Installed. Build as the service user, then reboot to enter Tikpal Kiosk.'

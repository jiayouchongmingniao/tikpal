#!/usr/bin/env bash
set -euo pipefail

# Enable DDC/CI display brightness control for Tikpal on a Debian or Gentoo host.
# Run with sudo from any directory after the app checkout exists.

SERVICE_USER="${SERVICE_USER:-moode}"
APP_DIR="${APP_DIR:-/home/${SERVICE_USER}/code/tikpal}"
TIKPAL_DDCUTIL_BIN="${TIKPAL_DDCUTIL_BIN:-ddcutil}"
TIKPAL_DDCUTIL_DISPLAY="${TIKPAL_DDCUTIL_DISPLAY:-${DDCUTIL_DISPLAY:-}}"
BACKUP_SUFFIX="${TIKPAL_DDCCI_BACKUP_SUFFIX:-tikpal-ddcci.$(date -u +%Y%m%d%H%M%S)}"

log() {
  printf '\n[tikpal-ddcci] %s\n' "$*"
}

warn() {
  printf '\n[tikpal-ddcci] WARN: %s\n' "$*" >&2
}

die() {
  printf '\n[tikpal-ddcci] ERROR: %s\n' "$*" >&2
  exit 1
}

require_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    echo "Please run with sudo so packages, udev rules, and boot config can be updated." >&2
    exit 1
  fi
}

backup_file() {
  local path="$1"
  local suffix="$2"
  if [[ -e "$path" && ! -e "${path}.${suffix}" ]]; then
    cp -a "$path" "${path}.${suffix}"
  fi
}

append_once() {
  local path="$1"
  local line="$2"
  grep -qxF "$line" "$path" 2>/dev/null || printf '%s\n' "$line" >> "$path"
}

set_env_value() {
  local path="$1"
  local key="$2"
  local value="$3"
  local line="$key="

  mkdir -p "$(dirname "$path")"
  touch "$path"

  if [[ -n "$value" ]]; then
    if [[ "$value" =~ ^[A-Za-z0-9_./:@,+%-]+$ ]]; then
      line="${key}=${value}"
    else
      local escaped="${value//\\/\\\\}"
      escaped="${escaped//\"/\\\"}"
      line="${key}=\"${escaped}\""
    fi
  fi

  if grep -q "^${key}=" "$path"; then
    sed -i "s|^${key}=.*|${line}|" "$path"
  else
    printf '%s\n' "$line" >> "$path"
  fi
}

configure_packages() {
  log "Installing ddcutil and i2c-tools"
  if command -v emerge >/dev/null 2>&1; then
    emerge --ask=n app-misc/ddcutil sys-apps/i2c-tools
    return
  fi
  if command -v apt-get >/dev/null 2>&1; then
    DEBIAN_FRONTEND=noninteractive apt-get update -y
    DEBIAN_FRONTEND=noninteractive apt-get install -y ddcutil i2c-tools
    return
  fi
  die "unsupported package manager; install ddcutil and i2c-tools, then rerun"
}

configure_i2c_access() {
  log "Enabling i2c-dev and i2c group access"
  if ! getent group i2c >/dev/null 2>&1; then
    groupadd --system i2c
  fi
  usermod -aG i2c "$SERVICE_USER"

  backup_file /etc/modules-load.d/tikpal-ddcci.conf "$BACKUP_SUFFIX"
  printf 'i2c-dev\n' > /etc/modules-load.d/tikpal-ddcci.conf
  modprobe i2c-dev || warn "modprobe i2c-dev failed; reboot may be required"

  backup_file /etc/udev/rules.d/45-tikpal-ddcci-i2c.rules "$BACKUP_SUFFIX"
  cat > /etc/udev/rules.d/45-tikpal-ddcci-i2c.rules <<'EOF_UDEV'
# Allow the Tikpal service user, via the i2c group, to access DDC/CI adapters.
KERNEL=="i2c-[0-9]*", GROUP="i2c", MODE="0660"
EOF_UDEV

  udevadm control --reload-rules || true
  udevadm trigger --subsystem-match=i2c-dev || udevadm trigger --subsystem-match=i2c || true
}

configure_boot_i2c() {
  local config_path=""
  if [[ -f /boot/firmware/config.txt ]]; then
    config_path="/boot/firmware/config.txt"
  elif [[ -f /boot/config.txt ]]; then
    config_path="/boot/config.txt"
  fi

  if [[ -z "$config_path" ]]; then
    warn "Raspberry Pi config.txt not found; skip persistent i2c_arm setting"
    return
  fi

  log "Persisting i2c_arm in $config_path"
  backup_file "$config_path" "tikpal-ddcci.bak"
  append_once "$config_path" ""
  append_once "$config_path" "# Tikpal DDC/CI support"
  append_once "$config_path" "dtparam=i2c_arm=on"
}

configure_tikpal_env() {
  local env_file="$APP_DIR/.env"
  log "Writing Tikpal DDC/CI env to $env_file"
  if [[ -e "$env_file" ]]; then
    backup_file "$env_file" "$BACKUP_SUFFIX"
  else
    mkdir -p "$(dirname "$env_file")"
    touch "$env_file"
    chown "$SERVICE_USER:$SERVICE_USER" "$env_file"
    chmod 0640 "$env_file"
  fi
  set_env_value "$env_file" TIKPAL_DDCUTIL_BIN "$TIKPAL_DDCUTIL_BIN"
  set_env_value "$env_file" TIKPAL_DDCUTIL_DISPLAY "$TIKPAL_DDCUTIL_DISPLAY"
}

probe_ddcci() {
  log "Probing DDC/CI display"
  ls -l /dev/i2c-* 2>/dev/null || warn "No /dev/i2c-* adapters visible yet"
  "$TIKPAL_DDCUTIL_BIN" detect --brief || warn "ddcutil detect failed; check HDMI/DDC wiring and display support"

  local ddc_cmd=("$TIKPAL_DDCUTIL_BIN")
  if [[ -n "$TIKPAL_DDCUTIL_DISPLAY" ]]; then
    ddc_cmd+=(--display "$TIKPAL_DDCUTIL_DISPLAY")
  fi

  if ! sudo -H -u "$SERVICE_USER" "${ddc_cmd[@]}" getvcp 10 --brief; then
    warn "DDC/CI VCP 0x10 brightness is not readable as ${SERVICE_USER}; reboot or monitor support may be required"
    return 1
  fi
}

main() {
  require_root
  configure_packages
  configure_i2c_access
  configure_boot_i2c
  if [[ -z "$TIKPAL_DDCUTIL_DISPLAY" ]]; then
    log "Probing DDC/CI displays before writing Tikpal configuration"
    "$TIKPAL_DDCUTIL_BIN" detect --brief || warn "ddcutil detect failed; check HDMI/DDC wiring and display support"
    die "set TIKPAL_DDCUTIL_DISPLAY to the one verified Corsair display number, then rerun; no Tikpal DDC configuration was written"
  fi
  probe_ddcci
  configure_tikpal_env

  log "Done. Restart tikpal-api.service after changing .env, and reboot if /dev/i2c-* did not appear."
}

main "$@"

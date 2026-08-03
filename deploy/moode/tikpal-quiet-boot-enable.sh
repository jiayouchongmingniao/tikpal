#!/usr/bin/env bash
set -euo pipefail

CMDLINE_PATH=""
GRUB_DEFAULT_PATH=""
DRY_RUN=0

usage() {
  cat <<USAGE
Usage: sudo deploy/moode/tikpal-quiet-boot-enable.sh [options]

Options:
  --cmdline PATH  Override cmdline.txt path for validation
  --grub-default PATH
                 Override /etc/default/grub path for validation
  --dry-run       Print the planned changes without writing anything
  -h, --help      Show this help
USAGE
}

log() {
  printf '[tikpal-quiet-boot] %s\n' "$*"
}

warn() {
  printf '[tikpal-quiet-boot] WARN: %s\n' "$*" >&2
}

fail() {
  printf '[tikpal-quiet-boot] ERROR: %s\n' "$*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --cmdline)
      CMDLINE_PATH="$2"
      shift 2
      ;;
    --grub-default)
      GRUB_DEFAULT_PATH="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "Unknown option: $1"
      ;;
  esac
done

if [[ "$DRY_RUN" -eq 0 && "$(id -u)" -ne 0 ]]; then
  fail "Please run with sudo so boot config and system services can be updated."
fi

find_cmdline_path() {
  local candidate
  for candidate in /boot/firmware/cmdline.txt /boot/cmdline.txt; do
    if [[ -f "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

find_grub_default_path() {
  if [[ -f /etc/default/grub ]]; then
    printf '%s\n' /etc/default/grub
    return 0
  fi
  return 1
}

normalize_spaces() {
  tr '\n' ' ' | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//'
}

build_quiet_cmdline() {
  local current="$1"
  local token
  local -a tokens=()
  local -a kept=()
  local -a quiet_tokens=(
    "quiet"
    "loglevel=0"
    "systemd.show_status=false"
    "rd.systemd.show_status=false"
    "udev.log_level=0"
    "vt.global_cursor_default=0"
    "logo.nologo"
    "splash"
    "plymouth.ignore-serial-consoles"
  )

  read -r -a tokens <<< "$current"

  for token in "${tokens[@]}"; do
    case "$token" in
      quiet|splash|logo.nologo|plymouth.ignore-serial-consoles)
        ;;
      loglevel=*|systemd.show_status=*|rd.systemd.show_status=*|udev.log_level=*|vt.global_cursor_default=*)
        ;;
      console=tty[0-9]*|console=tty0)
        ;;
      *)
        kept+=("$token")
        ;;
    esac
  done

  kept+=("${quiet_tokens[@]}")
  printf '%s\n' "${kept[*]}"
}

read_grub_default_cmdline() {
  local grub_path="$1"
  local line value
  line="$(grep -E '^[[:space:]]*GRUB_CMDLINE_LINUX_DEFAULT=' "$grub_path" | tail -n 1 || true)"
  if [[ -z "$line" ]]; then
    printf '\n'
    return 0
  fi
  value="${line#*=}"
  value="${value%%#*}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  printf '%s\n' "$value"
}

write_grub_default_cmdline() {
  local grub_path="$1"
  local next_cmdline="$2"
  local tmp_path
  tmp_path="${grub_path}.tikpal-tmp-$$"
  awk -v quiet_value="$next_cmdline" '
    BEGIN { wrote = 0; wrote_timeout_style = 0; wrote_timeout = 0 }
    /^[[:space:]]*GRUB_CMDLINE_LINUX_DEFAULT=/ && wrote == 0 {
      print "GRUB_CMDLINE_LINUX_DEFAULT=\"" quiet_value "\""
      wrote = 1
      next
    }
    /^[[:space:]]*GRUB_TIMEOUT_STYLE=/ && wrote_timeout_style == 0 {
      print "GRUB_TIMEOUT_STYLE=hidden"
      wrote_timeout_style = 1
      next
    }
    /^[[:space:]]*GRUB_TIMEOUT=/ && wrote_timeout == 0 {
      print "GRUB_TIMEOUT=0"
      wrote_timeout = 1
      next
    }
    { print }
    END {
      if (wrote == 0) {
        print "GRUB_CMDLINE_LINUX_DEFAULT=\"" quiet_value "\""
      }
      if (wrote_timeout_style == 0) {
        print "GRUB_TIMEOUT_STYLE=hidden"
      }
      if (wrote_timeout == 0) {
        print "GRUB_TIMEOUT=0"
      }
    }
  ' "$grub_path" > "$tmp_path"
  cat "$tmp_path" > "$grub_path"
  rm -f "$tmp_path"
}

grub_menu_needs_quiet() {
  local grub_path="$1"
  grep -Eq '^[[:space:]]*GRUB_TIMEOUT_STYLE=hidden[[:space:]]*$' "$grub_path" \
    && grep -Eq '^[[:space:]]*GRUB_TIMEOUT=0[[:space:]]*$' "$grub_path"
}

run_grub_mkconfig() {
  local grub_cmd=""
  local output_path=""
  grub_cmd="$(command -v grub-mkconfig || command -v grub2-mkconfig || true)"
  if [[ -z "$grub_cmd" ]]; then
    warn "could not find grub-mkconfig; run it manually before rebooting"
    return 0
  fi

  if [[ -d /boot/grub ]]; then
    output_path="/boot/grub/grub.cfg"
  elif [[ -d /boot/grub2 ]]; then
    output_path="/boot/grub2/grub.cfg"
  else
    warn "could not find /boot/grub or /boot/grub2; run grub-mkconfig manually"
    return 0
  fi

  "$grub_cmd" -o "$output_path" >/dev/null || warn "$grub_cmd failed for $output_path"
  log "updated $output_path"
}

BOOT_CONFIG_TYPE=""
BOOT_CONFIG_PATH=""

if [[ -n "$CMDLINE_PATH" && -n "$GRUB_DEFAULT_PATH" ]]; then
  fail "Use only one of --cmdline or --grub-default."
elif [[ -n "$CMDLINE_PATH" ]]; then
  BOOT_CONFIG_TYPE="cmdline"
  BOOT_CONFIG_PATH="$CMDLINE_PATH"
elif [[ -n "$GRUB_DEFAULT_PATH" ]]; then
  BOOT_CONFIG_TYPE="grub"
  BOOT_CONFIG_PATH="$GRUB_DEFAULT_PATH"
else
  if BOOT_CONFIG_PATH="$(find_cmdline_path 2>/dev/null)"; then
    BOOT_CONFIG_TYPE="cmdline"
  elif BOOT_CONFIG_PATH="$(find_grub_default_path 2>/dev/null)"; then
    BOOT_CONFIG_TYPE="grub"
  else
    fail "Could not find /boot/firmware/cmdline.txt, /boot/cmdline.txt, or /etc/default/grub"
  fi
fi

[[ -f "$BOOT_CONFIG_PATH" ]] || fail "boot config file not found: $BOOT_CONFIG_PATH"

if [[ "$BOOT_CONFIG_TYPE" == "cmdline" ]]; then
  CURRENT_CMDLINE="$(normalize_spaces < "$BOOT_CONFIG_PATH")"
else
  CURRENT_CMDLINE="$(read_grub_default_cmdline "$BOOT_CONFIG_PATH" | normalize_spaces)"
fi
NEXT_CMDLINE="$(build_quiet_cmdline "$CURRENT_CMDLINE")"
GRUB_MENU_NEEDS_UPDATE=0
if [[ "$BOOT_CONFIG_TYPE" == "grub" ]] && ! grub_menu_needs_quiet "$BOOT_CONFIG_PATH"; then
  GRUB_MENU_NEEDS_UPDATE=1
fi

log "boot config type: $BOOT_CONFIG_TYPE"
log "boot config: $BOOT_CONFIG_PATH"
log "current cmdline: $CURRENT_CMDLINE"
log "next cmdline: $NEXT_CMDLINE"
if [[ "$BOOT_CONFIG_TYPE" == "grub" ]]; then
  log "planned: set GRUB_TIMEOUT_STYLE=hidden and GRUB_TIMEOUT=0"
fi
log "planned: mask getty@tty1.service"
log "planned: mask getty@tty2.service"
log "planned: mask getty@tty3.service"
log "planned: write /etc/systemd/system.conf.d/tikpal-quiet-boot.conf"
log "planned: write /etc/systemd/logind.conf.d/tikpal-quiet-vts.conf"
log "planned: write /etc/sysctl.d/99-tikpal-quiet-console.conf"

if [[ "$DRY_RUN" -eq 1 ]]; then
  log "dry run complete"
  exit 0
fi

if [[ "$CURRENT_CMDLINE" != "$NEXT_CMDLINE" || "$GRUB_MENU_NEEDS_UPDATE" -eq 1 ]]; then
  BACKUP_PATH="$BOOT_CONFIG_PATH.tikpal-bak-$(date +%Y%m%d-%H%M%S)"
  cp "$BOOT_CONFIG_PATH" "$BACKUP_PATH"
  if [[ "$BOOT_CONFIG_TYPE" == "cmdline" ]]; then
    printf '%s\n' "$NEXT_CMDLINE" > "$BOOT_CONFIG_PATH"
  else
    write_grub_default_cmdline "$BOOT_CONFIG_PATH" "$NEXT_CMDLINE"
    run_grub_mkconfig
  fi
  log "updated $BOOT_CONFIG_PATH"
  log "backup: $BACKUP_PATH"
else
  log "cmdline already contains Tikpal quiet boot settings"
  if [[ "$BOOT_CONFIG_TYPE" == "grub" ]]; then
    run_grub_mkconfig
  fi
fi

mkdir -p /etc/systemd/system.conf.d
cat > /etc/systemd/system.conf.d/tikpal-quiet-boot.conf <<'EOF'
[Manager]
ShowStatus=no
EOF
chmod 0644 /etc/systemd/system.conf.d/tikpal-quiet-boot.conf
log "installed /etc/systemd/system.conf.d/tikpal-quiet-boot.conf"

mkdir -p /etc/systemd/logind.conf.d
cat > /etc/systemd/logind.conf.d/tikpal-quiet-vts.conf <<'EOF'
[Login]
NAutoVTs=0
ReserveVT=0
EOF
chmod 0644 /etc/systemd/logind.conf.d/tikpal-quiet-vts.conf
log "installed /etc/systemd/logind.conf.d/tikpal-quiet-vts.conf"

mkdir -p /etc/sysctl.d
cat > /etc/sysctl.d/99-tikpal-quiet-console.conf <<'EOF'
kernel.printk = 1 4 1 7
EOF
chmod 0644 /etc/sysctl.d/99-tikpal-quiet-console.conf
log "installed /etc/sysctl.d/99-tikpal-quiet-console.conf"

sysctl -w kernel.printk="1 4 1 7" >/dev/null || warn "could not update kernel.printk for the current boot"

for tty in tty1 tty2 tty3; do
  systemctl mask --now "getty@${tty}.service" >/dev/null 2>&1 || warn "could not mask getty@${tty}.service"
  pkill -t "$tty" agetty >/dev/null 2>&1 || true
done
systemctl daemon-reload || warn "systemd daemon-reload failed; quiet status still applies after next boot"

log "quiet boot is installed. Reboot once to apply cmdline changes."

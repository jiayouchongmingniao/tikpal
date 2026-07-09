#!/usr/bin/env bash
set -euo pipefail

CMDLINE_PATH=""
DRY_RUN=0

usage() {
  cat <<USAGE
Usage: sudo deploy/moode/tikpal-quiet-boot-enable.sh [options]

Options:
  --cmdline PATH  Override cmdline.txt path for validation
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

if [[ -z "$CMDLINE_PATH" ]]; then
  CMDLINE_PATH="$(find_cmdline_path)" || fail "Could not find /boot/firmware/cmdline.txt or /boot/cmdline.txt"
fi

[[ -f "$CMDLINE_PATH" ]] || fail "cmdline file not found: $CMDLINE_PATH"

CURRENT_CMDLINE="$(normalize_spaces < "$CMDLINE_PATH")"
NEXT_CMDLINE="$(build_quiet_cmdline "$CURRENT_CMDLINE")"

log "cmdline: $CMDLINE_PATH"
log "current cmdline: $CURRENT_CMDLINE"
log "next cmdline: $NEXT_CMDLINE"
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

if [[ "$CURRENT_CMDLINE" != "$NEXT_CMDLINE" ]]; then
  BACKUP_PATH="$CMDLINE_PATH.tikpal-bak-$(date +%Y%m%d-%H%M%S)"
  cp "$CMDLINE_PATH" "$BACKUP_PATH"
  printf '%s\n' "$NEXT_CMDLINE" > "$CMDLINE_PATH"
  log "updated $CMDLINE_PATH"
  log "backup: $BACKUP_PATH"
else
  log "cmdline already contains Tikpal quiet boot settings"
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
systemctl daemon-reexec || warn "systemd daemon-reexec failed; quiet status still applies after next boot"

log "quiet boot is installed. Reboot once to apply cmdline changes."

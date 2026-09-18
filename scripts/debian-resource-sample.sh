#!/usr/bin/env bash
set -euo pipefail

# Read-only sampler for a Debian Tikpal session. It deliberately reports
# cgroup memory and cumulative CPU ticks instead of summing Chromium RSS,
# because Chromium processes share a large number of pages.

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${TIKPAL_KIOSK_ENV_FILE:-$APP_DIR/.env.kiosk}"
if [[ -r "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

interval=5
samples=1
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --interval) interval="${2:-}"; shift 2 ;;
    --samples) samples="${2:-}"; shift 2 ;;
    -h|--help)
      printf 'Usage: %s [--interval seconds] [--samples count]\n' "$0"
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      exit 64
      ;;
  esac
done
[[ "$interval" =~ ^[0-9]+([.][0-9]+)?$ ]] || { printf 'invalid interval\n' >&2; exit 64; }
[[ "$samples" =~ ^[0-9]+$ && "$samples" -gt 0 ]] || { printf 'invalid samples\n' >&2; exit 64; }
[[ -r /proc/loadavg && -r /proc/meminfo ]] || { printf 'Debian resource sampling requires Linux /proc\n' >&2; exit 69; }

profile_root="${TIKPAL_WEB_MODE_PROFILE_ROOT:-$HOME/.config/tikpal-web-mode}"
thermal_root="${TIKPAL_WEB_MODE_PROVIDER_THERMAL_ZONE_ROOT:-/sys/class/thermal}"
units="${TIKPAL_RESOURCE_SAMPLE_UNITS:-tikpal-debian-api.service tikpal-debian-cdp.service tikpal-debian-helper.service tikpal-debian-kiosk.service tikpal-debian-mpd.service tikpal-debian-web.service}"
clock_ticks="$(getconf CLK_TCK 2>/dev/null || printf '100')"
start_epoch="$(date +%s)"

thermal_summary() {
  local zone type temperature maximum=0 found=0 entries=()
  for zone in "$thermal_root"/thermal_zone*; do
    [[ -r "$zone/type" && -r "$zone/temp" ]] || continue
    type="$(tr -d '[:space:]' < "$zone/type" 2>/dev/null || true)"
    temperature="$(tr -d '[:space:]' < "$zone/temp" 2>/dev/null || true)"
    [[ "$temperature" =~ ^[0-9]+$ ]] || continue
    entries+=("${type}:${temperature}")
    if [[ "$found" == "0" || "$temperature" -gt "$maximum" ]]; then
      maximum="$temperature"
      found=1
    fi
  done
  printf '%s|%s' "${maximum:-}" "$(IFS=,; printf '%s' "${entries[*]:-}")"
}

profile_summary() {
  local profile provider pid command executable ticks count total
  local entries=()
  [[ -d "$profile_root/providers" ]] || return 0
  for profile in "$profile_root"/providers/*; do
    [[ -d "$profile" ]] || continue
    provider="$(basename "$profile")"
    count=0
    total=0
    while IFS= read -r pid; do
      [[ "$pid" =~ ^[0-9]+$ && -r "/proc/$pid/cmdline" && -r "/proc/$pid/stat" ]] || continue
      command="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
      [[ "$command" == *"--user-data-dir=$profile"* ]] || continue
      executable="$(basename "$(readlink -f "/proc/$pid/exe" 2>/dev/null || true)")"
      case "$executable" in
        chrome|chromium|chromium-bin|chromium-browser) ;;
        *) continue ;;
      esac
      ticks="$(awk '{print $14 + $15}' "/proc/$pid/stat" 2>/dev/null || true)"
      [[ "$ticks" =~ ^[0-9]+$ ]] || continue
      count=$((count + 1))
      total=$((total + ticks))
    done < <(pgrep -u "$(id -u)" -f -- "--user-data-dir=$profile" 2>/dev/null || true)
    entries+=("${provider}:${count}:${total}")
  done
  IFS=,; printf '%s' "${entries[*]:-}"
}

cgroup_summary() {
  local unit data memory cpu entries=()
  for unit in $units; do
    data="$(systemctl --user show "$unit" -p MemoryCurrent -p CPUUsageNSec --value --no-pager 2>/dev/null || true)"
    memory="$(printf '%s\n' "$data" | sed -n '1p')"
    cpu="$(printf '%s\n' "$data" | sed -n '2p')"
    [[ "$memory" =~ ^[0-9]+$ ]] || memory=""
    [[ "$cpu" =~ ^[0-9]+$ ]] || cpu=""
    entries+=("${unit%.service}:${memory}:${cpu}")
  done
  IFS=,; printf '%s' "${entries[*]:-}"
}

error_count_since_start() {
  journalctl --user \
    -u pipewire.service -u wireplumber.service \
    -u tikpal-debian-mpd.service -u tikpal-debian-kiosk.service -u tikpal-debian-cdp.service \
    --since "@$start_epoch" --no-pager 2>/dev/null \
    | grep -Eic 'xrun|underrun|overrun|error|fail|crash' || true
}

printf 'timestamp\tload1\tmem_available_kib\tswap_used_kib\tthermal_max_mC\tthermal_zones_mC\tchromium_profile_processes_cpu_ticks\tservice_memory_bytes_cpu_ns\tnew_error_events\n'
for ((sample = 1; sample <= samples; sample += 1)); do
  read -r load1 _ < /proc/loadavg
  mem_available="$(awk '/^MemAvailable:/{print $2}' /proc/meminfo)"
  swap_total="$(awk '/^SwapTotal:/{print $2}' /proc/meminfo)"
  swap_free="$(awk '/^SwapFree:/{print $2}' /proc/meminfo)"
  swap_used=$((swap_total - swap_free))
  thermal="$(thermal_summary)"
  thermal_max="${thermal%%|*}"
  thermal_zones="${thermal#*|}"
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$(date -Is)" "$load1" "${mem_available:-}" "$swap_used" "$thermal_max" "$thermal_zones" \
    "$(profile_summary)" "$(cgroup_summary)" "$(error_count_since_start)"
  [[ "$sample" == "$samples" ]] || sleep "$interval"
done

# A consumer can convert a profile's tick delta to CPU seconds with the
# clock-tick value below; preserving it in stderr keeps the TSV machine-safe.
printf 'clock_ticks_per_second=%s\n' "$clock_ticks" >&2

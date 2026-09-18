#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fixture="$(mktemp -d)"
cleanup() { rm -rf "$fixture"; }
trap cleanup EXIT

export TIKPAL_KIOSK_SKIP_ENV_SOURCE=0
export TIKPAL_KIOSK_ENV_FILE="$fixture/missing.env"
export TIKPAL_WEB_MODE_SOURCE_ONLY=1
export TIKPAL_WEB_MODE_PROFILE_ROOT="$fixture/runtime"
export TIKPAL_WEB_MODE_STATE_PATH="$fixture/state.json"
export TIKPAL_WEB_MODE_PROVIDER_THERMAL_ZONE_ROOT="$fixture/thermal"
export TIKPAL_WEB_MODE_PROVIDER_THERMAL_STATE_PATH="$fixture/runtime/thermal-state.tsv"
export TIKPAL_CHROMIUM_FLAGS_FILE="$fixture/chromium-flags.conf"
export TIKPAL_WEB_MODE_DEVICE_ENV_FILE="$fixture/web-mode.env"
printf 'TIKPAL_WEB_MODE_PROVIDER_MAX_RESIDENT=2\n' > "$TIKPAL_WEB_MODE_DEVICE_ENV_FILE"
printf '%s\n' \
  --disable-backgrounding-occluded-windows \
  --disable-renderer-backgrounding \
  --enable-accelerated-video-decode > "$TIKPAL_CHROMIUM_FLAGS_FILE"

# shellcheck disable=SC1090
source "$ROOT/deploy/chromium/tikpal-web-mode.sh"

[[ "$(provider_max_resident)" == "2" ]]
mapfile -t provider_flags < <(read_provider_chromium_flags)
[[ "${#provider_flags[@]}" == "1" ]]
[[ "${provider_flags[0]}" == "--enable-accelerated-video-decode" ]]
# The resident-reveal branch commits the new state before reconciliation, so
# it must explicitly hand the just-left provider to the bounded pool.
grep -Fq 'reconcile_provider_pool_in_background "$provider" "$current_provider"' \
  "$ROOT/deploy/chromium/tikpal-web-mode.sh"

mkdir -p "$TIKPAL_WEB_MODE_PROVIDER_THERMAL_ZONE_ROOT/thermal_zone0" "$TIKPAL_WEB_MODE_PROVIDER_THERMAL_ZONE_ROOT/thermal_zone1"
printf 'little-core-thermal\n' > "$TIKPAL_WEB_MODE_PROVIDER_THERMAL_ZONE_ROOT/thermal_zone0/type"
printf '85100\n' > "$TIKPAL_WEB_MODE_PROVIDER_THERMAL_ZONE_ROOT/thermal_zone0/temp"
printf 'gpu-thermal\n' > "$TIKPAL_WEB_MODE_PROVIDER_THERMAL_ZONE_ROOT/thermal_zone1/type"
printf '80200\n' > "$TIKPAL_WEB_MODE_PROVIDER_THERMAL_ZONE_ROOT/thermal_zone1/temp"
export TIKPAL_WEB_MODE_PROVIDER_THERMAL_PAUSE_MILLICELSIUS=85000
export TIKPAL_WEB_MODE_PROVIDER_THERMAL_RESUME_MILLICELSIUS=80000
export TIKPAL_WEB_MODE_PROVIDER_THERMAL_COOLDOWN_SECONDS=0
[[ "$(provider_thermal_max_millicelsius)" == "85100" ]]
! provider_thermal_background_work_allowed
printf '79000\n' > "$TIKPAL_WEB_MODE_PROVIDER_THERMAL_ZONE_ROOT/thermal_zone0/temp"
printf '79000\n' > "$TIKPAL_WEB_MODE_PROVIDER_THERMAL_ZONE_ROOT/thermal_zone1/temp"
! provider_thermal_background_work_allowed
provider_thermal_background_work_allowed
[[ ! -e "$TIKPAL_WEB_MODE_PROVIDER_THERMAL_STATE_PATH" ]]

mkdir -p "$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/netease_music" \
  "$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/qq_music" \
  "$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/suno"
events="$fixture/events"
provider_ids() { printf '%s\n' netease_music qq_music suno; }
provider_max_resident() { printf '2\n'; }
profile_process_exists() { [[ -d "$1" ]]; }
read_runtime_provider_status() {
  case "$1" in
    netease_music) printf 'active\n' ;;
    qq_music) printf 'ready\n' ;;
    suno) printf 'check_proxy\n' ;;
  esac
}
stop_provider_guard() { printf 'stop:%s\n' "$1" >> "$events"; }
close_provider_profile() { printf 'close:%s\n' "$(basename "$1")" >> "$events"; }
write_runtime_provider_status() { printf 'status:%s:%s\n' "$1" "$2" >> "$events"; }
write_runtime_prewarm_complete() { printf 'prewarm:%s\n' "$1" >> "$events"; }
schedule_background_provider_freeze() { printf 'freeze:%s\n' "$1" >> "$events"; }
stop_provider_pool_prewarm() { printf 'stop-prewarm\n' >> "$events"; }
provider_thermal_background_work_allowed() { return 0; }

reconcile_bounded_provider_pool netease_music qq_music
grep -Fxq 'close:suno' "$events"
! grep -qE 'close:(netease_music|qq_music)' "$events"
grep -Fxq 'freeze:netease_music' "$events"

: > "$events"
provider_background_freeze_enabled() { return 0; }
provider_background_process_freeze_enabled() { return 1; }
provider_switch_in_progress() { return 1; }
provider_cdp_lifecycle() { return 1; }
freeze_background_provider qq_music netease_music
grep -Fxq 'close:qq_music' "$events"
grep -Fxq 'status:qq_music:closed' "$events"

echo 'Provider resource guard fixture passed: flag filtering, thermal hysteresis, bounded release, resident handoff, lifecycle fallback'

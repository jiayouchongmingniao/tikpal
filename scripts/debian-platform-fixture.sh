#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fixture="$(mktemp -d)"
pids=()
cleanup() { for pid in "${pids[@]:-}"; do kill "$pid" 2>/dev/null || true; done; rm -rf "$fixture"; }
trap cleanup EXIT
export TIKPAL_KIOSK_SKIP_ENV_SOURCE=1 TIKPAL_WEB_MODE_SOURCE_ONLY=1
export TIKPAL_WEB_MODE_PROFILE_ROOT="$fixture/runtime" TIKPAL_WEB_MODE_STATE_PATH="$fixture/state.json"
source "$ROOT/deploy/chromium/tikpal-web-mode.sh"
uname() { printf '%s\n' "$fixture_arch"; }
mkdir -p "$fixture/profile/WidevineCdm/1/_platform_specific/linux_x64"
dd if=/dev/zero of="$fixture/profile/WidevineCdm/1/_platform_specific/linux_x64/libwidevinecdm.so" bs=1024 count=1100 2>/dev/null
fixture_arch=x86_64
profile_has_widevine_cdm "$fixture/profile"
fixture_arch=aarch64
! profile_has_widevine_cdm "$fixture/profile"
mkdir -p "$fixture/profile/WidevineCdm/1/_platform_specific/linux_arm64"
cp "$fixture/profile/WidevineCdm/1/_platform_specific/linux_x64/libwidevinecdm.so" "$fixture/libwidevinecdm.so"
ln -s "$fixture/libwidevinecdm.so" "$fixture/profile/WidevineCdm/1/_platform_specific/linux_arm64/libwidevinecdm.so"
profile_has_widevine_cdm "$fixture/profile"
mkdir "$fixture/seeded-profile"
TIKPAL_WEB_MODE_SYSTEM_WIDEVINE_CDM_DIR="$fixture/profile/WidevineCdm"
TIKPAL_WEB_MODE_SYSTEM_WIDEVINE_CDM_FALLBACK_DIR=""
seed_profile_widevine_cdm "$fixture/seeded-profile"
[[ -f "$fixture/seeded-profile/WidevineCdm/1/_platform_specific/linux_arm64/libwidevinecdm.so" ]]
[[ ! -L "$fixture/seeded-profile/WidevineCdm/1/_platform_specific/linux_arm64/libwidevinecdm.so" ]]
grep -Fqx "{\"Path\":\"$fixture/seeded-profile/WidevineCdm\"}" "$fixture/seeded-profile/latest-component-updated-widevine-cdm"
fixture_arch=riscv64
! profile_has_widevine_cdm "$fixture/profile"
fixture_arch=arm64
profile_has_widevine_cdm "$fixture/profile"
! profile_has_widevine_cdm "$fixture/missing"
echo 'Debian platform fixture passed: architecture-specific CDM paths and absent CDM'
unset -f uname
if [[ "$(uname -s)" == Linux ]]; then
  cc -std=c11 -O2 -Wall -Wextra -Werror "$ROOT/deploy/debian/xdotool-compat.c" -o "$fixture/xdotool" $(pkg-config --cflags --libs xcb)
  cc -std=c11 -O2 "$ROOT/scripts/fixtures/tikpal-x11-late-writer-client.c" -o "$fixture/chromium-bin" $(pkg-config --cflags --libs xcb)
  for number in {181..200}; do [[ -S "/tmp/.X11-unix/X$number" ]] || break; done
  export DISPLAY=":$number" TIKPAL_KIOSK_DISPLAY=":$number"
  Xvfb "$DISPLAY" -screen 0 2560x1440x24 > "$fixture/xvfb.log" 2>&1 & pids+=("$!")
  for i in {1..100}; do [[ -S "/tmp/.X11-unix/X$number" ]] && break; sleep 0.02; done
  "$fixture/chromium-bin" surface --display "$DISPLAY" --output "$fixture/xid" --user-data-dir="$fixture/profile" --x 0 --y 0 --width 1920 --height 1440 & pids+=("$!")
  for i in {1..100}; do [[ -s "$fixture/xid" ]] && break; sleep 0.02; done
  xid="$(cat "$fixture/xid")"
  profile_process_exists "$fixture/profile"
  ! profile_process_exists "$fixture/profile-neighbor"
  [[ "$(first_window_for_profile "$fixture/profile")" == "$xid" ]]
  "$fixture/xdotool" windowlower "$xid"
  "$fixture/xdotool" windowraise "$xid"
  "$fixture/xdotool" getwindowgeometry --shell "$xid" | grep -qx 'HEIGHT=1440'
  ! "$fixture/xdotool" windowlower 0
  ! "$fixture/xdotool" windowlower 4294967295
  echo 'Debian X11 fixture passed: chromium-bin discovery, profile isolation, restack and invalid XIDs'
fi

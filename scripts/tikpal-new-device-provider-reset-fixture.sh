#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESET_SCRIPT="$SCRIPT_DIR/../deploy/chromium/tikpal-new-device-provider-reset.sh"
FIXTURE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/tikpal-new-device-provider-reset.XXXXXX")"
TEST_HOME="$FIXTURE_DIR/home"
PROFILE_ROOT="$TEST_HOME/.config/tikpal-web-mode"
PROVIDER_ROOT="$PROFILE_ROOT/providers"

cleanup() {
  rm -rf -- "$FIXTURE_DIR"
}
trap cleanup EXIT

fail_fixture() {
  printf 'new-device provider reset fixture failed: %s\n' "$*" >&2
  exit 1
}

mkdir -p \
  "$PROVIDER_ROOT/deezer/Default" \
  "$PROVIDER_ROOT/tidal/Default" \
  "$PROFILE_ROOT/side-panel/Default"
printf 'deezer-cookie' > "$PROVIDER_ROOT/deezer/Default/Cookies"
printf 'tidal-cookie' > "$PROVIDER_ROOT/tidal/Default/Cookies"
printf 'panel-state' > "$PROFILE_ROOT/side-panel/Default/Preferences"

check_output="$(HOME="$TEST_HOME" TIKPAL_WEB_MODE_PROFILE_ROOT="$PROFILE_ROOT" "$RESET_SCRIPT" check)"
[[ "$check_output" == *$'providerProfiles=2'* && "$check_output" == *$'action=none'* ]] ||
  fail_fixture "check did not report profiles without changing them"
[[ -f "$PROVIDER_ROOT/deezer/Default/Cookies" && -f "$PROVIDER_ROOT/tidal/Default/Cookies" ]] ||
  fail_fixture "check changed provider state"

clear_output="$(HOME="$TEST_HOME" TIKPAL_WEB_MODE_PROFILE_ROOT="$PROFILE_ROOT" "$RESET_SCRIPT" --clear-provider-profiles)"
[[ "$clear_output" == *$'action=cleared-provider-profiles'* ]] ||
  fail_fixture "clear did not report the scoped action"
[[ -d "$PROVIDER_ROOT" && -z "$(find "$PROVIDER_ROOT" -mindepth 1 -print -quit)" ]] ||
  fail_fixture "clear left provider browser state"
[[ -f "$PROFILE_ROOT/side-panel/Default/Preferences" ]] ||
  fail_fixture "clear touched the side-panel profile"

if HOME="$TEST_HOME" TIKPAL_WEB_MODE_PROFILE_ROOT="$TEST_HOME/.config/not-tikpal" "$RESET_SCRIPT" check >/dev/null 2>&1; then
  fail_fixture "unexpected profile root was accepted"
fi

printf 'new-device provider reset fixture passed\n'

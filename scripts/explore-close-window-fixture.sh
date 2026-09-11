#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" == Linux ]] || { echo 'SKIP window profile fixture requires Linux'; exit 0; }
repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
fixture_dir="$(mktemp -d)"
root_pid="" child_pid=""
cleanup() { [[ -z "$child_pid" ]] || kill "$child_pid" 2>/dev/null || true; [[ -z "$root_pid" ]] || kill "$root_pid" 2>/dev/null || true; rm -rf "$fixture_dir"; }
trap cleanup EXIT
cat > "$fixture_dir/browser.mjs" <<'JS'
import {spawn} from 'node:child_process';
import fs from 'node:fs';
process.title = `chrome ${process.argv[2]}`;
const child=spawn('sleep',['60']);fs.writeFileSync(process.env.CHILD_FILE,String(child.pid));
setInterval(()=>{},1000);
JS
CHILD_FILE="$fixture_dir/child" node "$fixture_dir/browser.mjs" "--user-data-dir=$fixture_dir/providers/suno" &
root_pid=$!
for _ in {1..50}; do [[ ! -f "$fixture_dir/child" ]] || break; sleep .02; done
child_pid="$(cat "$fixture_dir/child")"
export TIKPAL_WEB_MODE_STATE_PATH="$fixture_dir/state"
export TIKPAL_KIOSK_SKIP_ENV_SOURCE=1 TIKPAL_WEB_MODE_PROFILE_ROOT="$fixture_dir" TIKPAL_WEB_MODE_SOURCE_ONLY=1
source "$repo_dir/deploy/chromium/tikpal-web-mode.sh"
[[ "$(web_mode_surface_kind_for_pid "$root_pid")" == provider ]]
[[ "$(web_mode_surface_kind_for_pid "$child_pid")" == provider ]]
# Test the real enumeration with deterministic X11 responses. Offscreen roots
# must be filtered before any PID lookup, and the onscreen child must survive.
visible_chromium_windows() { printf '1\n2\n'; }
xdotool_safe() {
  if [[ "$1" == getwindowgeometry ]]; then
    [[ "${*: -1}" == 1 ]] && printf 'X=0\nY=0\nWIDTH=1920\nHEIGHT=720\n' || printf 'X=2560\nY=0\nWIDTH=1920\nHEIGHT=720\n'
  elif [[ "$1" == getwindowpid ]]; then
    [[ "$2" == 1 ]] || { echo 'offscreen PID queried' >&2; return 1; }
    echo "$child_pid"
  fi
}
[[ "$(web_mode_surface_windows_on_screen)" == $'1\tprovider' ]]
TIKPAL_WEB_MODE_LEFT_WINDOW=2504x720
[[ "$(web_mode_surface_windows_on_screen)" == $'1\tprovider' ]]
export TIKPAL_WEB_MODE_CLOSE_REQUEST_ID=c1
for outcome in close_audio_confirmed close_audio_process_stopped; do
  printf '%s' '{"activeProvider":"suno","closeRequestId":"c1","lastOpenedRequestId":"s1","lastOpenedXSessionGeneration":"x1","residentProviders":{"suno":{"status":"active"}}}' > "$TIKPAL_WEB_MODE_STATE_PATH"
  printf '{"requestId":"c1","session":"s1","generation":"x1","provider":"suno","outcome":"%s"}' "$outcome" > "$TIKPAL_WEB_MODE_STATE_PATH.close-audio.json"
  write_runtime_provider_state ""
  if [[ "$outcome" == close_audio_confirmed ]]; then
    jq -e '.residentProviders.suno.status == "ready" and .residentProviders.suno.activity == "parked"' "$TIKPAL_WEB_MODE_STATE_PATH" >/dev/null
  else
    jq -e '.residentProviders.suno == null' "$TIKPAL_WEB_MODE_STATE_PATH" >/dev/null
  fi
done
echo '[explore-close-window-fixture] flattened Chromium title, child ancestry, physical bounds and offscreen filtering passed'

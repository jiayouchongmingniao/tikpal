#!/usr/bin/env bash
set -euo pipefail

# Records one complete resident-pool lap and writes per-switch evidence.  It
# deliberately uses the local API so normal audio handoff and lock semantics
# stay identical to a real touch interaction.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
: "${TIKPAL_KIOSK_DISPLAY:=:0}"
: "${TIKPAL_EXPLORE_ACCEPTANCE_API_URL:=http://127.0.0.1:8787}"
: "${TIKPAL_EXPLORE_ACCEPTANCE_SETTLE_SECONDS:=0.9}"
: "${XAUTHORITY:=$HOME/.Xauthority}"
export DISPLAY="$TIKPAL_KIOSK_DISPLAY" XAUTHORITY

now_ms() {
  local value
  value="$(date +%s%3N 2>/dev/null || true)"
  if [[ "$value" =~ ^[0-9]+$ ]]; then
    printf '%s\n' "$value"
  else
    node -e 'process.stdout.write(String(Date.now()))'
  fi
}

usage() {
  printf '%s\n' "Usage: $0 [output-directory]"
}

if [[ "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

for command in curl ffmpeg node xdotool; do
  command -v "$command" >/dev/null 2>&1 || {
    printf '%s\n' "missing required command: $command" >&2
    exit 1
  }
done

if ! systemctl is-active --quiet tikpal-api.service; then
  printf '%s\n' "tikpal-api.service is not active" >&2
  exit 1
fi

output_dir="${1:-$APP_DIR/.tikpal/explore-switch-acceptance-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$output_dir/responses" "$output_dir/geometry"
printf 'target\tstarted_ms\treturned_ms\telapsed_ms\tactive_provider\tresult\n' > "$output_dir/switches.tsv"

read_active_provider() {
  curl --fail --silent --show-error --max-time 5 "$TIKPAL_EXPLORE_ACCEPTANCE_API_URL/api/v1/web-mode/state" \
    | node -e 'let body=""; process.stdin.on("data", (part) => body += part); process.stdin.on("end", () => { try { const state = JSON.parse(body); process.stdout.write(String(state.activeProvider || "")); } catch { process.exit(1); } });'
}

capture_geometry() {
  local target="$1"
  DISPLAY="$TIKPAL_KIOSK_DISPLAY" XAUTHORITY="$XAUTHORITY" \
    xdotool search --onlyvisible --class chromium getwindowname %@ getwindowgeometry %@ > "$output_dir/geometry/$target.txt" 2>&1 || true
}

recorder_pid=""
finish_recording() {
  if [[ -n "$recorder_pid" ]] && kill -0 "$recorder_pid" >/dev/null 2>&1; then
    kill -INT "$recorder_pid" >/dev/null 2>&1 || true
    wait "$recorder_pid" || true
  fi
}
trap finish_recording EXIT

active_provider="$(read_active_provider)"
providers=(suno spotify youtube_music apple_music tidal qobuz deezer amazon_music qq_music netease_music)
if [[ -z "$active_provider" ]]; then
  printf '%s\n' "Explore has no active provider; open one normally, wait for its pool to warm, then rerun this acceptance capture." >&2
  exit 1
fi

found_active=0
targets=()
for provider in "${providers[@]}"; do
  if [[ "$provider" == "$active_provider" ]]; then
    found_active=1
  else
    targets+=("$provider")
  fi
done
if [[ "$found_active" != "1" ]]; then
  printf '%s\n' "unexpected active provider: $active_provider" >&2
  exit 1
fi
targets+=("$active_provider")

ffmpeg -hide_banner -loglevel warning -y \
  -f x11grab -framerate 30 -video_size 2560x720 \
  -i "$TIKPAL_KIOSK_DISPLAY.0+0,0" \
  -c:v libx264 -preset ultrafast -crf 18 -pix_fmt yuv420p \
  "$output_dir/explore-ten-provider-switches.mp4" > "$output_dir/ffmpeg.log" 2>&1 &
recorder_pid="$!"
sleep 0.4

for provider in "${targets[@]}"; do
  started_ms="$(now_ms)"
  response_path="$output_dir/responses/$provider.json"
  if curl --fail --silent --show-error --max-time 115 \
    -H 'content-type: application/json' \
    --data "{\"type\":\"open\",\"provider\":\"$provider\"}" \
    "$TIKPAL_EXPLORE_ACCEPTANCE_API_URL/api/v1/web-mode/actions" > "$response_path"; then
    returned_ms="$(now_ms)"
    result="ok"
  else
    returned_ms="$(now_ms)"
    result="failed"
  fi
  elapsed_ms="$((returned_ms - started_ms))"
  response_active="$(node - "$response_path" <<'NODE'
const fs = require("node:fs");
try { process.stdout.write(String(JSON.parse(fs.readFileSync(process.argv[2], "utf8")).activeProvider || "")); } catch {}
NODE
)"
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$provider" "$started_ms" "$returned_ms" "$elapsed_ms" "$response_active" "$result" >> "$output_dir/switches.tsv"
  capture_geometry "$provider"
  sleep "$TIKPAL_EXPLORE_ACCEPTANCE_SETTLE_SECONDS"
done

finish_recording
recorder_pid=""
node - "$output_dir/switches.tsv" <<'NODE' | tee "$output_dir/summary.txt"
const fs = require("node:fs");
const [header, ...rows] = fs.readFileSync(process.argv[2], "utf8").trim().split("\n");
const samples = rows.map((line) => line.split("\t")).filter((parts) => parts[5] === "ok").map((parts) => Number(parts[3])).sort((a, b) => a - b);
const percentile = (p) => samples[Math.min(samples.length - 1, Math.floor((samples.length - 1) * p))] ?? 0;
const failed = rows.filter((line) => line.split("\t")[5] !== "ok").length;
console.log(`switches=${rows.length} passed=${samples.length} failed=${failed}`);
if (samples.length) console.log(`latency_ms min=${samples[0]} p50=${percentile(0.5)} p95=${percentile(0.95)} max=${samples.at(-1)}`);
NODE
printf '%s\n' "evidence=$output_dir"

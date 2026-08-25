#!/usr/bin/env bash
set -euo pipefail

# Physical Explore acceptance for the 2560x720 Gentoo kiosk. Every mutation is
# a real X11 click. HTTP and CDP are read-only evidence channels.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
: "${TIKPAL_KIOSK_DISPLAY:=:0}"
: "${TIKPAL_KIOSK_XAUTHORITY:=/home/moode/.Xauthority}"
: "${TIKPAL_EXPLORE_ACCEPTANCE_API_URL:=http://127.0.0.1:8787}"
: "${TIKPAL_EXPLORE_ACCEPTANCE_KIOSK_CDP_PORT:=9222}"
: "${TIKPAL_EXPLORE_ACCEPTANCE_PROVIDER_CDP_BASE:=9234}"
: "${TIKPAL_EXPLORE_ACCEPTANCE_TIMEOUT_SECONDS:=60}"
: "${TIKPAL_EXPLORE_ACCEPTANCE_SWITCH_ROUNDS:=20}"
: "${TIKPAL_EXPLORE_ACCEPTANCE_OPEN_CLOSE_ROUNDS:=3}"
: "${TIKPAL_EXPLORE_ACCEPTANCE_FRAME_RANGE:=12}"
: "${TIKPAL_WEB_MODE_PROFILE_ROOT:=/home/moode/.config/tikpal-web-mode}"
: "${TIKPAL_WEB_MODE_PHYSICAL_REVEAL_STAMP_PATH:=$TIKPAL_WEB_MODE_PROFILE_ROOT/last-physical-reveal.tsv}"
: "${TIKPAL_WEB_MODE_STATE_PATH:=$APP_DIR/.tikpal/web-mode-state.json}"
: "${TIKPAL_WEB_MODE_SETTINGS_PATH:=$APP_DIR/.tikpal/web-mode-settings.json}"
: "${TIKPAL_EXPLORE_ACCEPTANCE_OUTPUT_DIR:=$APP_DIR/.tikpal/explore-physical-acceptance-$(date +%Y%m%d-%H%M%S)}"
acceptance_mode="${1:-full}"

export DISPLAY="$TIKPAL_KIOSK_DISPLAY"
export XAUTHORITY="$TIKPAL_KIOSK_XAUTHORITY"

providers=(
  suno spotify youtube_music apple_music tidal
  qobuz deezer amazon_music qq_music netease_music
)
output_dir="$TIKPAL_EXPLORE_ACCEPTANCE_OUTPUT_DIR"
lock_path="$TIKPAL_WEB_MODE_PROFILE_ROOT/web-mode.lock"
physical_reveal_stamp_path="$TIKPAL_WEB_MODE_PHYSICAL_REVEAL_STAMP_PATH"
rounds_path="$output_dir/rounds.tsv"
frames_path="$output_dir/frames.tsv"
restore_needed=0
initial_active=""
initial_last=""
initial_room_signature=""
initial_proxy_hash=""
switch_panel_window=""
physical_stamp_status="missing"
physical_stamp_provider=""
physical_stamp_target=""
physical_stamp_previous=""
physical_stamp_ms=""

now_ms() {
  local value
  value="$(date +%s%3N 2>/dev/null || true)"
  if [[ "$value" =~ ^[0-9]+$ ]]; then
    printf '%s\n' "$value"
  else
    node -e 'process.stdout.write(String(Date.now()))'
  fi
}

clear_physical_reveal_stamp() {
  rm -f "$physical_reveal_stamp_path"
  [[ ! -e "$physical_reveal_stamp_path" ]]
}

validate_physical_reveal_stamp() {
  local expected_provider="$1"
  local expected_target="$2"
  local expected_previous="$3"
  local input_ms="$4"
  local observed_ms="$5"
  local parsed=""

  physical_stamp_status="missing"
  physical_stamp_provider=""
  physical_stamp_target=""
  physical_stamp_previous=""
  physical_stamp_ms=""
  [[ -e "$physical_reveal_stamp_path" ]] || return 1
  if ! parsed="$(awk -F '\t' '
    NR == 1 && NF == 4 {
      parsed = $1 "\034" $2 "\034" $3 "\034" $4
      valid = 1
      next
    }
    { valid = 0 }
    END {
      if (NR == 1 && valid) print parsed
      else exit 1
    }
  ' "$physical_reveal_stamp_path" 2>/dev/null)"; then
    physical_stamp_status="malformed"
    return 2
  fi
  IFS=$'\034' read -r physical_stamp_provider physical_stamp_target physical_stamp_previous physical_stamp_ms <<< "$parsed"
  if [[ "$physical_stamp_provider" != "$expected_provider" ]]; then
    physical_stamp_status="wrong-provider"
    return 2
  fi
  if [[ ! "$physical_stamp_target" =~ ^[0-9]+$ || "$physical_stamp_target" != "$expected_target" ]]; then
    physical_stamp_status="wrong-target"
    return 2
  fi
  if [[ ! "$physical_stamp_previous" =~ ^[0-9]+$ || "$physical_stamp_previous" != "$expected_previous" ]]; then
    physical_stamp_status="wrong-previous"
    return 2
  fi
  if [[ ! "$physical_stamp_ms" =~ ^[0-9]+$ || "$physical_stamp_ms" -lt "$input_ms" ]]; then
    physical_stamp_status="stale-time"
    return 2
  fi
  if [[ "$physical_stamp_ms" -gt "$observed_ms" ]]; then
    physical_stamp_status="future-time"
    return 2
  fi
  physical_stamp_status="valid"
}

run_physical_reveal_stamp_fixtures() {
  local fixture_dir fixture_path failures=0
  fixture_dir="$(mktemp -d)"
  fixture_path="$fixture_dir/last-physical-reveal.tsv"
  physical_reveal_stamp_path="$fixture_path"

  printf 'qq_music\t101\t202\t1100\n' > "$fixture_path"
  if ! validate_physical_reveal_stamp qq_music 101 202 1000 1200; then
    printf 'fixture normal failed: %s\n' "$physical_stamp_status" >&2
    failures=$((failures + 1))
  fi

  printf 'netease_music\t101\t202\t1100\n' > "$fixture_path"
  if validate_physical_reveal_stamp qq_music 101 202 1000 1200 || [[ "$physical_stamp_status" != "wrong-provider" ]]; then
    printf 'fixture wrong-provider failed: %s\n' "$physical_stamp_status" >&2
    failures=$((failures + 1))
  fi

  printf 'qq_music\t999\t202\t1100\n' > "$fixture_path"
  if validate_physical_reveal_stamp qq_music 101 202 1000 1200 || [[ "$physical_stamp_status" != "wrong-target" ]]; then
    printf 'fixture wrong-target failed: %s\n' "$physical_stamp_status" >&2
    failures=$((failures + 1))
  fi

  printf 'qq_music\t101\t999\t1100\n' > "$fixture_path"
  if validate_physical_reveal_stamp qq_music 101 202 1000 1200 || [[ "$physical_stamp_status" != "wrong-previous" ]]; then
    printf 'fixture wrong-previous failed: %s\n' "$physical_stamp_status" >&2
    failures=$((failures + 1))
  fi

  printf 'qq_music\t101\t202\t999\n' > "$fixture_path"
  if validate_physical_reveal_stamp qq_music 101 202 1000 1200 || [[ "$physical_stamp_status" != "stale-time" ]]; then
    printf 'fixture stale-time failed: %s\n' "$physical_stamp_status" >&2
    failures=$((failures + 1))
  fi

  printf 'qq_music\t101\t202\t1201\n' > "$fixture_path"
  if validate_physical_reveal_stamp qq_music 101 202 1000 1200 || [[ "$physical_stamp_status" != "future-time" ]]; then
    printf 'fixture future-time failed: %s\n' "$physical_stamp_status" >&2
    failures=$((failures + 1))
  fi

  printf 'qq_music\t101' > "$fixture_path"
  if validate_physical_reveal_stamp qq_music 101 202 1000 1200 || [[ "$physical_stamp_status" != "malformed" ]]; then
    printf 'fixture half-write failed: %s\n' "$physical_stamp_status" >&2
    failures=$((failures + 1))
  fi

  rm -f "$fixture_path"
  if validate_physical_reveal_stamp qq_music 101 202 1000 1200 || [[ "$physical_stamp_status" != "missing" ]]; then
    printf 'fixture missing failed: %s\n' "$physical_stamp_status" >&2
    failures=$((failures + 1))
  fi

  rmdir "$fixture_dir"
  [[ "$failures" == "0" ]] || fail "$failures physical reveal stamp fixtures failed"
  printf 'physical reveal stamp fixtures passed\n'
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  return 1
}

if [[ "$acceptance_mode" == "stamp-fixtures" ]]; then
  run_physical_reveal_stamp_fixtures
  exit 0
fi

declare -A switch_provider_windows=()

require_commands() {
  local command
  for command in curl ffmpeg flock node sha256sum xdotool; do
    command -v "$command" >/dev/null 2>&1 || fail "missing required command: $command"
  done
  [[ -r "$XAUTHORITY" ]] || fail "missing Xauthority: $XAUTHORITY"
  systemctl is-active --quiet tikpal-api.service || fail "tikpal-api.service is not active"
  systemctl is-active --quiet tikpal-web.service || fail "tikpal-web.service is not active"
  systemctl is-active --quiet tikpal-kiosk.service || fail "tikpal-kiosk.service is not active"
}

read_web_state() {
  curl --noproxy '*' --fail --silent --show-error --max-time 5 \
    "$TIKPAL_EXPLORE_ACCEPTANCE_API_URL/api/v1/web-mode/state"
}

redact_evidence_json() {
  node -e '
let body = "";
process.stdin.on("data", (chunk) => body += chunk);
process.stdin.on("end", () => {
  const redact = (value) => {
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redact(entry)]));
    }
    if (typeof value !== "string" || !/^https?:\/\//i.test(value)) return value;
    try {
      const url = new URL(value);
      url.username = "";
      url.password = "";
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch {
      return value.replace(/[?#].*$/, "");
    }
  };
  process.stdout.write(JSON.stringify(redact(JSON.parse(body)), null, 2) + "\n");
});'
}

web_state_fields() {
  node -e '
let body = "";
process.stdin.on("data", (chunk) => body += chunk);
process.stdin.on("end", () => {
  const state = JSON.parse(body);
  process.stdout.write([
    state.activeProvider || "",
    state.openingProvider || "",
    state.closeRequestId || "",
    state.lastProvider || "",
    state.prewarmComplete === true ? "1" : "0",
    state.lastError || ""
  ].join("\u001f"));
});'
}

room_signature() {
  curl --noproxy '*' --fail --silent --show-error --max-time 5 \
    "$TIKPAL_EXPLORE_ACCEPTANCE_API_URL/api/v1/experience/state" \
    | node -e '
let body = "";
process.stdin.on("data", (chunk) => body += chunk);
process.stdin.on("end", () => {
  const state = JSON.parse(body);
  process.stdout.write(JSON.stringify({
    mode: state.mode ?? null,
    sceneSoundEnabled: state.sceneSoundEnabled ?? null,
    sceneVideoId: state.sceneVideoId ?? null
  }));
});'
}

provider_debug_port() {
  local offset=0
  case "$1" in
    spotify) offset=0 ;;
    youtube_music) offset=1 ;;
    apple_music) offset=2 ;;
    tidal) offset=3 ;;
    qobuz) offset=4 ;;
    deezer) offset=5 ;;
    amazon_music) offset=6 ;;
    qq_music) offset=7 ;;
    netease_music) offset=8 ;;
    suno) offset=9 ;;
    *) return 1 ;;
  esac
  printf '%s\n' "$((TIKPAL_EXPLORE_ACCEPTANCE_PROVIDER_CDP_BASE + offset))"
}

cdp_eval() {
  local port="$1"
  local expression="$2"
  node --experimental-websocket - "$port" "$expression" <<'NODE'
const [port, expression] = process.argv.slice(2);
const targets = await fetch("http://127.0.0.1:" + port + "/json/list", {
  signal: AbortSignal.timeout(1500)
}).then((response) => response.json());
const pages = targets.filter((target) => target.type === "page" && target.webSocketDebuggerUrl);
const target = pages.find((page) => String(page.url || "").startsWith("https://")) || pages[0];
if (!target) process.exit(2);
const result = await new Promise((resolve, reject) => {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const timer = setTimeout(() => reject(new Error("CDP timeout")), 1800);
  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: { expression, returnByValue: true, awaitPromise: true }
    }));
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id !== 1) return;
    clearTimeout(timer);
    socket.close();
    if (message.error || message.result?.exceptionDetails) reject(new Error("CDP evaluation failed"));
    else resolve(message.result?.result?.value ?? null);
  });
  socket.addEventListener("error", () => reject(new Error("CDP socket failed")));
});
process.stdout.write(JSON.stringify(result));
NODE
}

kiosk_element_center() {
  local selector="$1"
  local expression result
  expression="(() => { const element = document.querySelector('$selector'); if (!element) return null; const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); const x = Math.round(rect.left + rect.width / 2); const y = Math.round(rect.top + rect.height / 2); const hit = document.elementFromPoint(x, y); return { x, y, disabled: Boolean(element.disabled), visible: rect.width > 8 && rect.height > 8 && style.visibility !== 'hidden' && Number(style.opacity || '1') > 0.2, targetable: Boolean(hit && (hit === element || element.contains(hit))) }; })()"
  result="$(cdp_eval "$TIKPAL_EXPLORE_ACCEPTANCE_KIOSK_CDP_PORT" "$expression" 2>/dev/null || true)"
  printf '%s' "$result" | node -e '
let body = "";
process.stdin.on("data", (chunk) => body += chunk);
process.stdin.on("end", () => {
  try {
    const value = JSON.parse(body);
    if (!value || !value.visible || !value.targetable || value.disabled) process.exit(1);
    process.stdout.write(value.x + "\t" + value.y);
  } catch {
    process.exit(1);
  }
});'
}

click_kiosk_selector() {
  local selector="$1"
  local center x y attempts
  for attempts in 1 2 3 4 5 6 7 8 9 10; do
    center="$(kiosk_element_center "$selector" || true)"
    if [[ -n "$center" ]]; then
      IFS=$'\t' read -r x y <<< "$center"
      xdotool mousemove --sync "$x" "$y" click 1
      return 0
    fi
    sleep 0.1
  done
  fail "kiosk element is not physically clickable: $selector"
}

click_open_explore() {
  xdotool mousemove --sync 700 360 click 1
  sleep 0.3
  # The physical source card is in the HUD's top row. Its transparent gesture
  # layer can make elementFromPoint unreliable on this compositor, so click
  # the measured center of the actual Explore card rather than an API action.
  xdotool mousemove --sync 2415 127 click 1
}

provider_index() {
  local target="$1"
  local index=0 provider
  for provider in "${providers[@]}"; do
    if [[ "$provider" == "$target" ]]; then
      printf '%s\n' "$index"
      return 0
    fi
    index=$((index + 1))
  done
  return 1
}

click_provider_card() {
  local provider="$1"
  local index column row x y
  index="$(provider_index "$provider")" || fail "unknown provider: $provider"
  column=$((index % 2))
  row=$((index / 2))
  x=$((2086 + column * 308))
  y=$((204 + row * 72))
  xdotool mousemove --sync "$x" "$y" click 1
}

click_close() {
  xdotool mousemove --sync 2502 48 click 1
}

lock_is_free() {
  flock -n "$lock_path" true >/dev/null 2>&1
}

profile_kind_for_pid() {
  local pid="$1"
  local depth=0 command_line provider
  while [[ "$pid" =~ ^[0-9]+$ && "$pid" != "1" && "$depth" -lt 8 ]]; do
    if [[ -r "/proc/$pid/cmdline" ]]; then
      command_line="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
      if [[ " $command_line " == *" --user-data-dir=$TIKPAL_WEB_MODE_PROFILE_ROOT/side-panel "* ]]; then
        printf 'panel\t\n'
        return 0
      fi
      for provider in "${providers[@]}"; do
        if [[ " $command_line " == *" --user-data-dir=$TIKPAL_WEB_MODE_PROFILE_ROOT/providers/$provider "* ]]; then
          printf 'provider\t%s\n' "$provider"
          return 0
        fi
      done
    fi
    [[ -r "/proc/$pid/status" ]] || break
    pid="$(awk '/^PPid:/{print $2}' "/proc/$pid/status")"
    depth=$((depth + 1))
  done
  printf 'other\t\n'
}

visible_chromium_windows() {
  {
    xdotool search --onlyvisible --class chromium 2>/dev/null || true
    xdotool search --onlyvisible --class Chromium-browser 2>/dev/null || true
  } | awk 'NF && !seen[$0]++'
}

capture_windows() {
  local output="$1"
  local window pid geometry x y width height name kind provider
  : > "$output"
  while IFS= read -r window; do
    [[ "$window" =~ ^[0-9]+$ ]] || continue
    pid="$(xdotool getwindowpid "$window" 2>/dev/null || true)"
    geometry="$(xdotool getwindowgeometry --shell "$window" 2>/dev/null || true)"
    x="$(printf '%s\n' "$geometry" | awk -F= '$1=="X"{print $2}')"
    y="$(printf '%s\n' "$geometry" | awk -F= '$1=="Y"{print $2}')"
    width="$(printf '%s\n' "$geometry" | awk -F= '$1=="WIDTH"{print $2}')"
    height="$(printf '%s\n' "$geometry" | awk -F= '$1=="HEIGHT"{print $2}')"
    name="$(xdotool getwindowname "$window" 2>/dev/null | tr '\t\r\n' ' ' || true)"
    IFS=$'\t' read -r kind provider <<< "$(profile_kind_for_pid "$pid")"
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
      "$window" "$kind" "$provider" "$x" "$y" "$width" "$height" "$pid" "$name" >> "$output"
  done < <(visible_chromium_windows)
}

target_geometry_ready() {
  local provider="$1"
  local windows="$2"
  awk -F '\t' -v provider="$provider" '
    $2=="provider" && $3==provider && $4==0 && $5==0 && $6==1920 && $7==720 { provider_ok=1 }
    $2=="panel" && $4==1920 && $5==0 && $6==640 && $7==720 { panel_ok=1 }
    END { exit(provider_ok && panel_ok ? 0 : 1) }
  ' "$windows"
}

visible_surface_count() {
  local windows="$1"
  awk -F '\t' '
    ($2=="provider" || $2=="panel") &&
    $4 ~ /^-?[0-9]+$/ && $5 ~ /^-?[0-9]+$/ && $6 ~ /^[0-9]+$/ && $7 ~ /^[0-9]+$/ &&
    $4 < 2560 && $4 + $6 > 0 && $5 < 720 && $5 + $7 > 0 { count += 1 }
    END { print count + 0 }
  ' "$windows"
}

load_switch_observer_windows() {
  local windows="$1"
  local window kind provider _x _y width height _pid _name item
  switch_provider_windows=()
  switch_panel_window=""
  while IFS=$'\t' read -r window kind provider _x _y width height _pid _name; do
    [[ "$window" =~ ^[0-9]+$ && "$width" =~ ^[0-9]+$ && "$height" =~ ^[0-9]+$ ]] || continue
    (( width * height > 100000 )) || continue
    if [[ "$kind" == "provider" && -n "$provider" && -z "${switch_provider_windows[$provider]:-}" ]]; then
      switch_provider_windows[$provider]="$window"
    elif [[ "$kind" == "panel" && -z "$switch_panel_window" ]]; then
      switch_panel_window="$window"
    fi
  done < "$windows"
  [[ "$switch_panel_window" =~ ^[0-9]+$ ]] || return 1
  for item in "${providers[@]}"; do
    [[ "${switch_provider_windows[$item]:-}" =~ ^[0-9]+$ ]] || return 1
  done
}

targeted_switch_geometries() {
  local target="$1"
  local previous="$2"
  local target_window="${switch_provider_windows[$target]:-}"
  local previous_window="${switch_provider_windows[$previous]:-}"
  local panel_window="$switch_panel_window"
  local probe
  [[ "$target_window" =~ ^[0-9]+$ && "$previous_window" =~ ^[0-9]+$ && "$panel_window" =~ ^[0-9]+$ ]] || return 1
  probe="$(timeout 2 xdotool \
    getwindowgeometry --shell "$target_window" \
    getwindowgeometry --shell "$previous_window" \
    getwindowgeometry --shell "$panel_window" 2>/dev/null || true)"
  printf '%s\n' "$probe" | awk -F= -v target="$target_window" -v previous="$previous_window" -v panel="$panel_window" '
    $1=="WINDOW" { window=$2 }
    $1=="X" { x[window]=$2 }
    $1=="Y" { y[window]=$2 }
    $1=="WIDTH" { width[window]=$2 }
    $1=="HEIGHT" { height[window]=$2 }
    END {
      printf "%s,%s %sx%s\t%s,%s %sx%s\t%s,%s %sx%s\n",
        x[target], y[target], width[target], height[target],
        x[previous], y[previous], width[previous], height[previous],
        x[panel], y[panel], width[panel], height[panel]
    }'
}

switch_geometry_complete() {
  local geometry="$1"
  [[ "$geometry" =~ ^-?[0-9]+,-?[0-9]+[[:space:]][1-9][0-9]*x[1-9][0-9]*$ ]]
}

capture_frame() {
  local path="$1"
  ffmpeg -hide_banner -loglevel error -y \
    -f x11grab -video_size 2560x720 -i "$DISPLAY.0+0,0" \
    -frames:v 1 "$path"
  printf '%s\t%s\n' "$(sha256sum "$path" | awk '{print $1}')" "$path" >> "$frames_path"
}

region_range() {
  local frame="$1"
  local crop="$2"
  ffmpeg -hide_banner -i "$frame" \
    -vf "crop=$crop,signalstats,metadata=print" -frames:v 1 -f null - 2>&1 \
    | awk -F= '
      /lavfi.signalstats.YMIN=/{ ymin=$2 }
      /lavfi.signalstats.YMAX=/{ ymax=$2 }
      END {
        if (ymin=="" || ymax=="") exit 1
        print ymax-ymin
      }'
}

open_frame_nonblank() {
  local frame="$1"
  local provider_range panel_range
  provider_range="$(region_range "$frame" "1920:720:0:0" || printf '0')"
  panel_range="$(region_range "$frame" "640:720:1920:0" || printf '0')"
  [[ "$provider_range" =~ ^[0-9]+([.][0-9]+)?$ ]] || provider_range=0
  [[ "$panel_range" =~ ^[0-9]+([.][0-9]+)?$ ]] || panel_range=0
  awk -v left="$provider_range" -v panel="$panel_range" -v threshold="$TIKPAL_EXPLORE_ACCEPTANCE_FRAME_RANGE" \
    'BEGIN { exit(left >= threshold && panel >= threshold ? 0 : 1) }'
}

provider_has_real_page() {
  local provider="$1"
  local port
  port="$(provider_debug_port "$provider")"
  curl --noproxy '*' --fail --silent --max-time 2 "http://127.0.0.1:$port/json/list" \
    | node -e '
let body = "";
process.stdin.on("data", (chunk) => body += chunk);
process.stdin.on("end", () => {
  try {
    const targets = JSON.parse(body);
    process.exit(targets.some((target) => target.type === "page" && String(target.url || "").startsWith("https://")) ? 0 : 1);
  } catch {
    process.exit(1);
  }
});'
}

capture_audio_gates() {
  local target="$1"
  local output="$2"
  node --experimental-websocket - "$TIKPAL_EXPLORE_ACCEPTANCE_PROVIDER_CDP_BASE" "$target" > "$output" <<'NODE'
const [baseText, targetProvider] = process.argv.slice(2);
const base = Number(baseText);
const providers = [
  ["suno", 9], ["spotify", 0], ["youtube_music", 1], ["apple_music", 2], ["tidal", 3],
  ["qobuz", 4], ["deezer", 5], ["amazon_music", 6], ["qq_music", 7], ["netease_music", 8]
];
function evidenceUrl(raw) {
  try {
    const url = new URL(String(raw || ""));
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return String(raw || "").replace(/[?#].*$/, "");
  }
}
async function evaluate(wsUrl) {
  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    const timer = setTimeout(() => reject(new Error("timeout")), 1600);
    socket.addEventListener("open", () => socket.send(JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: {
        expression: "window.__tikpalProviderAudioGate?.status?.() ?? null",
        returnByValue: true
      }
    })));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      clearTimeout(timer);
      socket.close();
      resolve(message.result?.result?.value ?? null);
    });
    socket.addEventListener("error", reject);
  });
}
const rows = await Promise.all(providers.map(async ([provider, offset]) => {
  try {
    const targets = await fetch("http://127.0.0.1:" + (base + offset) + "/json/list", {
      signal: AbortSignal.timeout(1400)
    }).then((response) => response.json());
    const page = targets.find((item) => item.type === "page" && String(item.url || "").startsWith("https://") && item.webSocketDebuggerUrl);
    if (!page) return { provider, real: false, gate: null, url: "" };
    return { provider, real: true, gate: await evaluate(page.webSocketDebuggerUrl), url: evidenceUrl(page.url) };
  } catch (error) {
    return { provider, real: false, gate: null, url: "", error: error?.message || "failed" };
  }
}));
for (const row of rows) {
  process.stdout.write([
    row.provider,
    row.real ? "1" : "0",
    row.gate?.active === true ? "1" : row.gate?.active === false ? "0" : "",
    row.gate?.playingCount ?? "",
    row.url,
    row.error || ""
  ].join("\t") + "\n");
}
const target = rows.find((row) => row.provider === targetProvider);
const mismatch = !target?.real || target?.gate?.active !== true ||
  rows.some((row) => row.provider !== targetProvider && row.gate?.active === true);
process.exit(mismatch ? 1 : 0);
NODE
}

capture_round_evidence() {
  local round_dir="$1"
  local provider="${2:-}"
  mkdir -p "$round_dir/cdp"
  read_web_state 2>/dev/null | redact_evidence_json > "$round_dir/api-state.json" 2>/dev/null || true
  redact_evidence_json < "$TIKPAL_WEB_MODE_STATE_PATH" > "$round_dir/runtime-state.json" 2>/dev/null || true
  capture_windows "$round_dir/windows.tsv"
  if lock_is_free; then printf 'free\n'; else printf 'held\n'; fi > "$round_dir/lock.txt"
  local item port
  for item in "${providers[@]}"; do
    port="$(provider_debug_port "$item")"
    curl --noproxy '*' --silent --max-time 2 "http://127.0.0.1:$port/json/list" 2>/dev/null \
      | redact_evidence_json > "$round_dir/cdp/$item.json" 2>/dev/null || true
  done
  [[ -z "$provider" ]] || capture_audio_gates "$provider" "$round_dir/audio-gates.tsv" 2>/dev/null || true
}

main_visual_snapshot() {
  cdp_eval "$TIKPAL_EXPLORE_ACCEPTANCE_KIOSK_CDP_PORT" "(() => { const ambient = document.querySelector('.ambient-screen'); const videos = Array.from(document.querySelectorAll('video')).filter((video) => { const rect = video.getBoundingClientRect(); const style = getComputedStyle(video); return rect.width > 8 && rect.height > 8 && style.visibility !== 'hidden' && Number(style.opacity || '1') > 0.05; }); const video = videos[0] || null; return { ambient: Boolean(ambient), roomMode: ambient?.getAttribute('data-room-mode') || '', videoPresent: Boolean(video), currentTime: Number(video?.currentTime || 0), readyState: Number(video?.readyState || 0), health: video?.dataset?.tikpalVideoHealth || '' }; })()" 2>/dev/null
}

main_visual_ready() {
  local snapshot="$1"
  printf '%s' "$snapshot" | node -e '
let body = "";
process.stdin.on("data", (chunk) => body += chunk);
process.stdin.on("end", () => {
  try {
    const state = JSON.parse(body);
    process.exit(state?.ambient && state.roomMode ? 0 : 1);
  } catch {
    process.exit(1);
  }
});'
}

wait_provider_settled() {
  local action="$1"
  local round="$2"
  local provider="$3"
  local input_ms="$4"
  local round_dir="$output_dir/$action-$round-$provider"
  local deadline=$((SECONDS + TIKPAL_EXPLORE_ACCEPTANCE_TIMEOUT_SECONDS))
  local lock_seen=0 stable=0 first_visible_ms="" settled_ms="" result="timeout"
  local state fields active opening close_request windows probe surfaces
  mkdir -p "$round_dir"
  while [[ "$SECONDS" -lt "$deadline" ]]; do
    lock_is_free || lock_seen=1
    state="$(read_web_state 2>/dev/null || true)"
    fields="$(printf '%s' "$state" | web_state_fields 2>/dev/null || true)"
    IFS=$'\x1f' read -r active opening close_request _ <<< "$fields"
    capture_windows "$round_dir/windows-current.tsv"
    surfaces="$(visible_surface_count "$round_dir/windows-current.tsv")"
    if target_geometry_ready "$provider" "$round_dir/windows-current.tsv" && [[ "$surfaces" == "2" ]]; then
      probe="$round_dir/probe.png"
      if capture_frame "$probe" >/dev/null 2>&1 && open_frame_nonblank "$probe"; then
        if [[ -z "$first_visible_ms" ]]; then
          first_visible_ms="$(now_ms)"
          cp "$probe" "$round_dir/first-visible.png"
        fi
        if [[ "$active" == "$provider" && -z "$opening" && -z "$close_request" ]] \
          && lock_is_free && provider_has_real_page "$provider" \
          && capture_audio_gates "$provider" "$round_dir/audio-gates-current.tsv" 2>/dev/null; then
          stable=$((stable + 1))
        else
          stable=0
        fi
      else
        stable=0
      fi
    else
      stable=0
    fi
    if [[ "$stable" -ge 2 ]]; then
      settled_ms="$(now_ms)"
      cp "$round_dir/probe.png" "$round_dir/settled.png"
      result="ok"
      break
    fi
    sleep 0.1
  done
  capture_round_evidence "$round_dir" "$provider"
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$action" "$round" "$provider" "$input_ms" "${first_visible_ms:--1}" "${settled_ms:--1}" \
    "$((${first_visible_ms:-input_ms} - input_ms))" "$((${settled_ms:-input_ms} - input_ms))" "$lock_seen" "$result" \
    "${first_visible_ms:--1}" "0" \
    >> "$rounds_path"
  [[ "$result" == "ok" ]] || fail "$action round $round did not settle on $provider"
}

wait_switch_settled_targeted() {
  local round="$1"
  local provider="$2"
  local previous="$3"
  local input_ms="$4"
  local round_dir="$output_dir/switch-$round-$provider"
  local deadline=$((SECONDS + TIKPAL_EXPLORE_ACCEPTANCE_TIMEOUT_SECONDS))
  local lock_seen=0 stable=0 first_visible_ms="" observer_visible_ms="" settled_ms="" result="stamp-missing"
  local sample_ms geometries target_geometry previous_geometry panel_geometry lock_state stamp_ready=0
  local geometry_attempt geometry_complete=0
  local state fields active opening close_request gate_path
  local target_window="${switch_provider_windows[$provider]:-}"
  local previous_window="${switch_provider_windows[$previous]:-}"
  mkdir -p "$round_dir"
  printf 'sample_ms\tphysical_ms\tstamp_status\ttarget_geometry\tprevious_geometry\tpanel_geometry\tlock\n' \
    > "$round_dir/targeted-observer.tsv"
  while [[ "$SECONDS" -lt "$deadline" ]]; do
    sample_ms="$(now_ms)"
    target_geometry=""
    previous_geometry=""
    panel_geometry=""
    stamp_ready=0
    if [[ -e "$physical_reveal_stamp_path" ]]; then
      sample_ms="$(now_ms)"
      if validate_physical_reveal_stamp "$provider" "$target_window" "$previous_window" "$input_ms" "$sample_ms"; then
        stamp_ready=1
        [[ "$result" != "stamp-missing" ]] || result="geometry-pending"
      else
        cp "$physical_reveal_stamp_path" "$round_dir/physical-reveal-invalid.tsv" 2>/dev/null || true
        result="stamp-$physical_stamp_status"
      fi
    else
      physical_stamp_status="missing"
      physical_stamp_ms=""
    fi
    if lock_is_free; then
      lock_state=free
    else
      lock_state=held
      lock_seen=1
    fi
    if [[ "$stamp_ready" == "1" && "$lock_state" == "free" ]]; then
      geometry_complete=0
      for geometry_attempt in 1 2 3; do
        sample_ms="$(now_ms)"
        geometries="$(targeted_switch_geometries "$provider" "$previous" || true)"
        IFS=$'\t' read -r target_geometry previous_geometry panel_geometry <<< "$geometries"
        printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
          "$sample_ms" "${physical_stamp_ms:--1}" "$physical_stamp_status" \
          "$target_geometry" "$previous_geometry" "$panel_geometry" "$lock_state" \
          >> "$round_dir/targeted-observer.tsv"
        if switch_geometry_complete "$target_geometry" \
          && switch_geometry_complete "$previous_geometry" \
          && switch_geometry_complete "$panel_geometry"
        then
          geometry_complete=1
          break
        fi
        [[ "$geometry_attempt" -ge 3 ]] || sleep 0.15
      done
    else
      printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
        "$sample_ms" "${physical_stamp_ms:--1}" "$physical_stamp_status" \
        "$target_geometry" "$previous_geometry" "$panel_geometry" "$lock_state" \
        >> "$round_dir/targeted-observer.tsv"
    fi
    if [[ "$result" == stamp-* && "$result" != "stamp-missing" ]]; then
      break
    fi
    if [[ "$stamp_ready" == "1" && "$lock_state" == "free" ]]; then
      if [[ "$geometry_complete" != "1" \
        || "$target_geometry" != "0,0 1920x720" \
        || "$previous_geometry" != "2560,0 1920x720" \
        || "$panel_geometry" != "1920,0 640x720" ]]
      then
        result="geometry-mismatch"
        break
      fi
      if [[ -z "$first_visible_ms" ]]; then
        if capture_frame "$round_dir/first-visible-probe.png" >/dev/null 2>&1 \
          && open_frame_nonblank "$round_dir/first-visible-probe.png"
        then
          observer_visible_ms="$(now_ms)"
          if ! validate_physical_reveal_stamp "$provider" "$target_window" "$previous_window" "$input_ms" "$observer_visible_ms"; then
            result="stamp-${physical_stamp_status}-after-geometry"
            break
          fi
          first_visible_ms="$physical_stamp_ms"
          cp "$physical_reveal_stamp_path" "$round_dir/physical-reveal.tsv"
          cp "$round_dir/first-visible-probe.png" "$round_dir/first-visible.png"
          if (( first_visible_ms - input_ms > 5000 )); then
            result="visible-over-5s"
            break
          fi
          result="settling"
        else
          result="blank-first-frame"
          break
        fi
      fi
      if [[ -n "$first_visible_ms" ]]; then
        state="$(read_web_state 2>/dev/null || true)"
        fields="$(printf '%s' "$state" | web_state_fields 2>/dev/null || true)"
        IFS=$'\x1f' read -r active opening close_request _ <<< "$fields"
        gate_path="$round_dir/audio-gates-stable-$((stable + 1)).tsv"
        if [[ "$active" == "$provider" && -z "$opening" && -z "$close_request" && "$lock_state" == "free" ]] \
          && capture_audio_gates "$provider" "$gate_path" 2>/dev/null
        then
          stable=$((stable + 1))
        else
          stable=0
        fi
      fi
    else
      stable=0
    fi
    if [[ "$stable" -ge 2 ]]; then
      settled_ms="$(now_ms)"
      cp "$round_dir/first-visible.png" "$round_dir/settled.png"
      result="ok"
      break
    fi
    sleep 0.25
  done
  cp "$physical_reveal_stamp_path" "$round_dir/physical-reveal-final.tsv" 2>/dev/null || true
  capture_round_evidence "$round_dir" "$provider"
  cp "$round_dir/windows.tsv" "$round_dir/windows-current.tsv"
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "switch" "$round" "$provider" "$input_ms" "${first_visible_ms:--1}" "${settled_ms:--1}" \
    "$((${first_visible_ms:-input_ms} - input_ms))" "$((${settled_ms:-input_ms} - input_ms))" "$lock_seen" "$result" \
    "${observer_visible_ms:--1}" "$(( ${observer_visible_ms:-input_ms} - ${first_visible_ms:-input_ms} ))" \
    >> "$rounds_path"
  [[ "$result" == "ok" ]] || fail "switch round $round did not settle on $provider: $result"
  sleep 0.5
}

wait_close_settled() {
  local round="$1"
  local input_ms="$2"
  local round_dir="$output_dir/close-$round"
  local deadline=$((SECONDS + TIKPAL_EXPLORE_ACCEPTANCE_TIMEOUT_SECONDS))
  local lock_seen=0 stable=0 first_visible_ms="" settled_ms="" result="timeout"
  local state fields active opening close_request snapshot surfaces hash1 hash2 snapshot2
  mkdir -p "$round_dir"
  while [[ "$SECONDS" -lt "$deadline" ]]; do
    lock_is_free || lock_seen=1
    state="$(read_web_state 2>/dev/null || true)"
    fields="$(printf '%s' "$state" | web_state_fields 2>/dev/null || true)"
    IFS=$'\x1f' read -r active opening close_request _ <<< "$fields"
    capture_windows "$round_dir/windows-current.tsv"
    surfaces="$(visible_surface_count "$round_dir/windows-current.tsv")"
    snapshot="$(main_visual_snapshot || true)"
    if [[ "$surfaces" == "0" ]] && main_visual_ready "$snapshot"; then
      if [[ -z "$first_visible_ms" ]]; then
        first_visible_ms="$(now_ms)"
        capture_frame "$round_dir/first-visible.png" >/dev/null 2>&1 || true
        printf '%s\n' "$snapshot" > "$round_dir/first-visual.json"
      fi
      if [[ -z "$active" && -z "$opening" && -z "$close_request" ]] && lock_is_free; then
        stable=$((stable + 1))
      else
        stable=0
      fi
    else
      stable=0
    fi
    if [[ "$stable" -ge 2 ]]; then
      capture_frame "$round_dir/ambient-1.png"
      printf '%s\n' "$snapshot" > "$round_dir/ambient-1.json"
      sleep 0.5
      snapshot2="$(main_visual_snapshot || true)"
      capture_frame "$round_dir/ambient-2.png"
      printf '%s\n' "$snapshot2" > "$round_dir/ambient-2.json"
      hash1="$(sha256sum "$round_dir/ambient-1.png" | awk '{print $1}')"
      hash2="$(sha256sum "$round_dir/ambient-2.png" | awk '{print $1}')"
      if ! node - "$round_dir/ambient-1.json" "$round_dir/ambient-2.json" "$hash1" "$hash2" <<'NODE'
const fs = require("node:fs");
const [firstPath, secondPath, firstHash, secondHash] = process.argv.slice(2);
const first = JSON.parse(fs.readFileSync(firstPath, "utf8"));
const second = JSON.parse(fs.readFileSync(secondPath, "utf8"));
if (!first?.ambient || !second?.ambient || first.roomMode !== second.roomMode) process.exit(1);
if (first.videoPresent && (!(second.currentTime > first.currentTime) || firstHash === secondHash)) process.exit(1);
NODE
      then
        result="visual-mismatch"
        break
      fi
      settled_ms="$(now_ms)"
      result="ok"
      break
    fi
    sleep 0.1
  done
  capture_round_evidence "$round_dir"
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "close" "$round" "" "$input_ms" "${first_visible_ms:--1}" "${settled_ms:--1}" \
    "$((${first_visible_ms:-input_ms} - input_ms))" "$((${settled_ms:-input_ms} - input_ms))" "$lock_seen" "$result" \
    "${first_visible_ms:--1}" "0" \
    >> "$rounds_path"
  [[ "$result" == "ok" ]] || fail "close round $round did not settle cleanly"
}

wait_prewarm_complete() {
  local deadline=$((SECONDS + TIKPAL_EXPLORE_ACCEPTANCE_TIMEOUT_SECONDS))
  local state
  while [[ "$SECONDS" -lt "$deadline" ]]; do
    state="$(read_web_state 2>/dev/null || true)"
    if printf '%s' "$state" | node -e '
let body = "";
process.stdin.on("data", (chunk) => body += chunk);
process.stdin.on("end", () => {
  try {
    const state = JSON.parse(body);
    const entries = Object.values(state.residentProviders || {});
    const terminal = new Set(["ready", "active", "check_proxy", "check_setup", "region_unavailable", "unavailable"]);
    process.exit(state.prewarmComplete === true && entries.length >= 10 && entries.every((entry) => terminal.has(entry?.status)) ? 0 : 1);
  } catch {
    process.exit(1);
  }
});'
    then
      return 0
    fi
    sleep 0.5
  done
  fail "provider prewarm queue is not complete"
}

ready_providers() {
  read_web_state | node -e '
let body = "";
process.stdin.on("data", (chunk) => body += chunk);
process.stdin.on("end", () => {
  const state = JSON.parse(body);
  for (const provider of ["suno","spotify","youtube_music","apple_music","tidal","qobuz","deezer","amazon_music","qq_music","netease_music"]) {
    if (["ready", "active"].includes(state.residentProviders?.[provider]?.status)) console.log(provider);
  }
});'
}

switch_only_preflight() {
  local state fields active opening close_request prewarm provider surfaces
  local preflight_dir="$output_dir/preflight"
  mkdir -p "$preflight_dir"
  if ! state="$(read_web_state)"; then
    fail "switch-only preflight could not read web-mode state"
    return 1
  fi
  if ! printf '%s\n' "$state" | redact_evidence_json > "$preflight_dir/api-state.json"; then
    fail "switch-only preflight could not record web-mode state"
    return 1
  fi
  fields="$(printf '%s' "$state" | web_state_fields)"
  IFS=$'\x1f' read -r active opening close_request _ prewarm _ <<< "$fields"
  if [[ -z "$active" || -n "$opening" || -n "$close_request" || "$prewarm" != "1" ]]; then
    fail "switch-only preflight requires an active, idle, fully prewarmed Explore session"
    return 1
  fi
  if ! printf '%s' "$state" | node -e '
let body = "";
process.stdin.on("data", (chunk) => body += chunk);
process.stdin.on("end", () => {
  const state = JSON.parse(body);
  const ids = ["suno","spotify","youtube_music","apple_music","tidal","qobuz","deezer","amazon_music","qq_music","netease_music"];
  process.exit(ids.every((id) => ["ready", "active"].includes(state.residentProviders?.[id]?.status)) ? 0 : 1);
});'
  then
    fail "switch-only preflight requires all ten providers to be resident and Ready"
    return 1
  fi
  for provider in "${providers[@]}"; do
    if ! provider_has_real_page "$provider"; then
      fail "switch-only preflight found no real HTTPS page for $provider"
      return 1
    fi
  done
  if ! capture_round_evidence "$preflight_dir" "$active"; then
    fail "switch-only preflight could not capture evidence"
    return 1
  fi
  if ! capture_frame "$preflight_dir/frame.png" >/dev/null; then
    fail "switch-only preflight could not capture the kiosk frame"
    return 1
  fi
  if ! capture_windows "$preflight_dir/windows.tsv"; then
    fail "switch-only preflight could not capture windows"
    return 1
  fi
  surfaces="$(visible_surface_count "$preflight_dir/windows.tsv")"
  if ! target_geometry_ready "$active" "$preflight_dir/windows.tsv"; then
    fail "switch-only preflight target or panel geometry is not ready"
    return 1
  fi
  if [[ "$surfaces" != "2" ]]; then
    fail "switch-only preflight found $surfaces visible Explore surfaces instead of 2"
    return 1
  fi
  if ! open_frame_nonblank "$preflight_dir/frame.png"; then
    fail "switch-only preflight frame is blank"
    return 1
  fi
  if ! lock_is_free; then
    fail "switch-only preflight web-mode lock is held"
    return 1
  fi
  printf '%s\n' "$active"
}

restore_initial_state() {
  local state fields active input_ms
  restore_needed=0
  state="$(read_web_state 2>/dev/null || true)"
  fields="$(printf '%s' "$state" | web_state_fields 2>/dev/null || true)"
  IFS=$'\x1f' read -r active _ <<< "$fields"
  if [[ -n "$initial_active" ]]; then
    if [[ -z "$active" ]]; then
      input_ms="$(now_ms)"
      click_open_explore || return 0
      wait_provider_settled restore-open 1 "${initial_last:-$initial_active}" "$input_ms" || return 0
      active="${initial_last:-$initial_active}"
    fi
    if [[ "$active" != "$initial_active" ]]; then
      input_ms="$(now_ms)"
      click_provider_card "$initial_active" || return 0
      wait_provider_settled restore-provider 1 "$initial_active" "$input_ms" || return 0
    fi
  elif [[ -n "$active" ]]; then
    input_ms="$(now_ms)"
    click_close || return 0
    wait_close_settled restore "$input_ms" || return 0
  fi
}

on_exit() {
  local status=$?
  set +e
  if [[ "$restore_needed" == "1" ]]; then
    restore_initial_state
  fi
  if [[ -s "$rounds_path" ]]; then
    summarize
  fi
  exit "$status"
}
trap on_exit EXIT

summarize() {
  node - "$rounds_path" <<'NODE' | tee "$output_dir/summary.txt"
const fs = require("node:fs");
const [header, ...lines] = fs.readFileSync(process.argv[2], "utf8").trim().split("\n");
const rows = lines.filter(Boolean).map((line) => {
  const values = line.split("\t");
  return {
    action: values[0],
    visibleMs: Number(values[6]),
    settledMs: Number(values[7]),
    observerDelayMs: Number(values[11] || 0),
    result: values[9]
  };
});
const percentile = (samples, p) => samples[Math.min(samples.length - 1, Math.ceil(samples.length * p) - 1)] ?? 0;
for (const action of ["open", "close", "switch"]) {
  const group = rows.filter((row) => row.action === action);
  const passed = group.filter((row) => row.result === "ok");
  console.log(action + ": rounds=" + group.length + " passed=" + passed.length + " failed=" + (group.length - passed.length));
  for (const field of ["visibleMs", "observerDelayMs", "settledMs"]) {
    const samples = passed.map((row) => row[field]).sort((a, b) => a - b);
    if (!samples.length) continue;
    console.log("  " + field + ": min=" + samples[0] +
      " median=" + percentile(samples, 0.5) +
      " p95=" + percentile(samples, 0.95) +
      " max=" + samples[samples.length - 1]);
  }
}
NODE
}

main() {
  local initial_state fields cycle expected input_ms setup_provider current
  local final_room final_proxy_hash round target ready_index pass offset start_index
  local -a ready=() requested=()
  case "$acceptance_mode" in
    stamp-fixtures)
      run_physical_reveal_stamp_fixtures
      return 0
      ;;
    full|switch-only) ;;
    switch-once) ;;
    *) fail "usage: $0 [full|switch-only|switch-once|stamp-fixtures]" ;;
  esac
  require_commands
  mkdir -p "$output_dir"
  printf '%s\n' "$acceptance_mode" > "$output_dir/mode.txt"
  printf 'action\tround\ttarget\tinput_ms\tfirst_visible_ms\tsettled_ms\tvisible_ms\tsettled_elapsed_ms\tlock_seen\tresult\tobserver_visible_ms\tobserver_delay_ms\n' > "$rounds_path"
  printf 'sha256\tpath\n' > "$frames_path"
  initial_state="$(read_web_state)"
  printf '%s\n' "$initial_state" | redact_evidence_json > "$output_dir/initial-web-mode.json"
  fields="$(printf '%s' "$initial_state" | web_state_fields)"
  IFS=$'\x1f' read -r initial_active _ _ initial_last _ _ <<< "$fields"
  initial_room_signature="$(room_signature)"
  printf '%s\n' "$initial_room_signature" | redact_evidence_json > "$output_dir/initial-room.json"
  initial_proxy_hash="$(sha256sum "$TIKPAL_WEB_MODE_SETTINGS_PATH" 2>/dev/null | awk '{print $1}' || printf 'missing')"
  printf '%s\n' "$initial_proxy_hash" > "$output_dir/initial-proxy.sha256"
  if [[ "$acceptance_mode" == "switch-only" || "$acceptance_mode" == "switch-once" ]]; then
    restore_needed=0
    if [[ "$acceptance_mode" == "switch-only" ]]; then
      [[ "$TIKPAL_EXPLORE_ACCEPTANCE_SWITCH_ROUNDS" == "20" ]] \
        || fail "switch-only acceptance requires exactly 20 switch rounds"
    else
      [[ "$TIKPAL_EXPLORE_ACCEPTANCE_SWITCH_ROUNDS" == "1" \
        && -n "${TIKPAL_EXPLORE_ACCEPTANCE_SEQUENCE:-}" ]] \
        || fail "switch-once requires one explicit provider in TIKPAL_EXPLORE_ACCEPTANCE_SEQUENCE"
    fi
    if ! current="$(switch_only_preflight)"; then
      return 1
    fi
    load_switch_observer_windows "$output_dir/preflight/windows.tsv" \
      || fail "switch-only preflight could not cache ten provider windows and the panel"
    sleep 2
  else
    restore_needed=1
    wait_prewarm_complete
    if [[ -n "$initial_active" ]]; then
      input_ms="$(now_ms)"
      click_close
      wait_close_settled setup "$input_ms"
    fi

    for ((cycle=1; cycle<=TIKPAL_EXPLORE_ACCEPTANCE_OPEN_CLOSE_ROUNDS; cycle++)); do
      fields="$(read_web_state | web_state_fields)"
      IFS=$'\x1f' read -r _ _ _ expected _ _ <<< "$fields"
      expected="${expected:-qq_music}"
      input_ms="$(now_ms)"
      click_open_explore
      wait_provider_settled open "$cycle" "$expected" "$input_ms"
      input_ms="$(now_ms)"
      click_close
      wait_close_settled "$cycle" "$input_ms"
    done

    fields="$(read_web_state | web_state_fields)"
    IFS=$'\x1f' read -r _ _ _ setup_provider _ _ <<< "$fields"
    setup_provider="${setup_provider:-qq_music}"
    input_ms="$(now_ms)"
    click_open_explore
    wait_provider_settled setup-open 1 "$setup_provider" "$input_ms"
    current="$setup_provider"
  fi

  if [[ -n "${TIKPAL_EXPLORE_ACCEPTANCE_SEQUENCE:-}" ]]; then
    while IFS= read -r target; do
      [[ -n "$target" ]] && requested+=("$target")
    done < <(printf '%s\n' "$TIKPAL_EXPLORE_ACCEPTANCE_SEQUENCE" | tr ', ' '\n\n')
  elif [[ "$acceptance_mode" == "switch-only" ]]; then
    start_index="$(provider_index "$current")"
    for pass in 1 2; do
      for ((offset=1; offset<=${#providers[@]}; offset++)); do
        requested+=("${providers[$(((start_index + offset) % ${#providers[@]}))]}")
      done
    done
  else
    while IFS= read -r target; do
      [[ -n "$target" ]] && ready+=("$target")
    done < <(ready_providers)
    [[ "${#ready[@]}" -ge 2 ]] || fail "fewer than two providers are Ready"
    ready_index=0
    for ((round=1; round<=TIKPAL_EXPLORE_ACCEPTANCE_SWITCH_ROUNDS; round++)); do
      while [[ "${ready[$ready_index]}" == "$current" ]]; do
        ready_index=$(((ready_index + 1) % ${#ready[@]}))
      done
      requested+=("${ready[$ready_index]}")
      ready_index=$(((ready_index + 1) % ${#ready[@]}))
    done
  fi
  [[ "${#requested[@]}" -eq "$TIKPAL_EXPLORE_ACCEPTANCE_SWITCH_ROUNDS" ]] \
    || fail "provider sequence must contain exactly $TIKPAL_EXPLORE_ACCEPTANCE_SWITCH_ROUNDS entries"

  round=0
  for target in "${requested[@]}"; do
    round=$((round + 1))
    [[ "$target" != "$current" ]] || fail "round $round repeats the already active provider $target"
    if [[ "$acceptance_mode" == "switch-only" || "$acceptance_mode" == "switch-once" ]]; then
      clear_physical_reveal_stamp || fail "round $round could not clear the previous physical reveal stamp"
    fi
    input_ms="$(now_ms)"
    click_provider_card "$target"
    if [[ "$acceptance_mode" == "switch-only" || "$acceptance_mode" == "switch-once" ]]; then
      wait_switch_settled_targeted "$round" "$target" "$current" "$input_ms"
    else
      wait_provider_settled switch "$round" "$target" "$input_ms"
    fi
    current="$target"
  done

  if [[ "$acceptance_mode" == "full" ]]; then
    restore_initial_state
  fi
  final_room="$(room_signature)"
  final_proxy_hash="$(sha256sum "$TIKPAL_WEB_MODE_SETTINGS_PATH" 2>/dev/null | awk '{print $1}' || printf 'missing')"
  printf '%s\n' "$final_room" | redact_evidence_json > "$output_dir/final-room.json"
  printf '%s\n' "$final_proxy_hash" > "$output_dir/final-proxy.sha256"
  [[ "$final_room" == "$initial_room_signature" ]] || fail "room state was not restored"
  [[ "$final_proxy_hash" == "$initial_proxy_hash" ]] || fail "proxy settings changed during acceptance"
  capture_round_evidence "$output_dir/final"
  printf 'evidence=%s\n' "$output_dir"
}

main "$@"

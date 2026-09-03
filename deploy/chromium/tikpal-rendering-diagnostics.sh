#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="${TIKPAL_KIOSK_ENV_FILE:-$APP_DIR/.env.kiosk}"

should_source_env_file() {
  local value
  value="$(printf '%s' "${TIKPAL_KIOSK_SKIP_ENV_SOURCE:-0}" | tr '[:upper:]' '[:lower:]')"
  case "$value" in
    1|true|yes|on) return 1 ;;
    *) return 0 ;;
  esac
}

if should_source_env_file && [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

: "${TIKPAL_KIOSK_DISPLAY:=:0}"
: "${TIKPAL_KIOSK_REMOTE_DEBUG_CHROMIUM_ADDRESS:=127.0.0.1}"
: "${TIKPAL_KIOSK_REMOTE_DEBUG_CHROMIUM_PORT:=9223}"
: "${TIKPAL_WEB_MODE_CDP_SESSION_MANAGER_CLIENT:=$SCRIPT_DIR/tikpal-web-mode-cdp-client.py}"
: "${TIKPAL_WEB_MODE_CDP_SESSION_MANAGER_SOCKET:=/run/tikpal/cdp-session-manager.sock}"
: "${TIKPAL_RENDER_DIAGNOSTICS_PROVIDER:=spotify}"

export DISPLAY="$TIKPAL_KIOSK_DISPLAY"
export XAUTHORITY="${XAUTHORITY:-/home/${TIKPAL_KIOSK_SERVICE_USER:-moode}/.Xauthority}"

report() {
  printf '[tikpal-render-diagnostics] %s\n' "$*"
}

resolve_xauthority() {
  local xorg_authority
  xorg_authority="$(ps -C Xorg -o args= 2>/dev/null | awk '
    {
      for (field = 1; field < NF; field += 1) {
        if ($field == "-auth" && $(field + 1) != "") {
          print $(field + 1)
          exit
        }
      }
    }
  ')"
  if [[ -n "$xorg_authority" && -r "$xorg_authority" ]]; then
    XAUTHORITY="$xorg_authority"
    export XAUTHORITY
  fi
}

limited_command() {
  if command -v timeout >/dev/null 2>&1; then
    timeout -k 1s 5s "$@"
    return
  fi
  "$@"
}

report_xrandr() {
  command -v xrandr >/dev/null 2>&1 || {
    report "xrandr=unavailable"
    return
  }
  local current
  current="$(limited_command xrandr --current 2>&1 || true)"
  if [[ -z "$current" ]]; then
    report "xrandr=unavailable"
    return
  fi
  printf '%s\n' "$current" | awk '
    / connected/ { output=$1; connected=1; next }
    connected && /\*/ {
      for (field = 1; field <= NF; field += 1) {
        if ($field ~ /\*/) {
          rate = $field
          sub(/\*/, "", rate)
          print "[tikpal-render-diagnostics] xrandr output=" output " mode=" $1 " rate=" rate
          connected=0
          next
        }
      }
    }
  '
}

report_gl() {
  command -v glxinfo >/dev/null 2>&1 || {
    report "glxinfo=unavailable (install x11-apps/mesa-progs)"
    return
  }
  local output selected
  output="$(limited_command glxinfo -B 2>&1 || true)"
  selected="$(printf '%s\n' "$output" | awk '/OpenGL vendor|OpenGL renderer|OpenGL version/ { print "[tikpal-render-diagnostics] " $0 }')"
  if [[ -n "$selected" ]]; then
    printf '%s\n' "$selected"
  elif [[ -n "$output" ]]; then
    report "glxinfo-no-renderer=$(printf '%s' "$output" | tr '\n' ' ' | cut -c 1-360)"
  else
    report "glxinfo-no-renderer=empty-output"
  fi
}

report_vaapi() {
  command -v vainfo >/dev/null 2>&1 || {
    report "vainfo=unavailable (install media-video/libva-utils)"
    return
  }
  local output selected
  output="$(limited_command vainfo --display x11 2>&1 || true)"
  selected="$(printf '%s\n' "$output" | awk '
    /VA-API version|Driver version|VAProfile/ { print "[tikpal-render-diagnostics] " $0 }
  ')"
  if [[ -n "$selected" ]]; then
    printf '%s\n' "$selected"
  elif [[ -n "$output" ]]; then
    report "vainfo-no-profile=$(printf '%s' "$output" | tr '\n' ' ' | cut -c 1-360)"
  else
    report "vainfo-no-profile=empty-output"
  fi
}

report_thermal() {
  local path label value
  for path in /sys/class/hwmon/hwmon*/temp*_input /sys/class/thermal/thermal_zone*/temp; do
    [[ -r "$path" ]] || continue
    value="$(cat "$path" 2>/dev/null || true)"
    [[ "$value" =~ ^[0-9]+$ ]] || continue
    label="$(cat "$(dirname "$path")/name" 2>/dev/null || basename "$(dirname "$path")")"
    report "temperature source=$label path=$path celsius=$(awk -v millidegrees="$value" 'BEGIN { printf "%.1f", millidegrees / 1000 }')"
  done
}

report_cpu() {
  local policy governor
  report "loadavg=$(cut -d ' ' -f 1-3 /proc/loadavg 2>/dev/null || true)"
  for policy in /sys/devices/system/cpu/cpufreq/policy*/scaling_governor; do
    [[ -r "$policy" ]] || continue
    governor="$(cat "$policy" 2>/dev/null || true)"
    report "cpu-policy=${policy%/scaling_governor} governor=${governor:-unavailable}"
  done
}

report_chromium_processes() {
  ps -eo pid=,pcpu=,pmem=,comm=,args= 2>/dev/null | awk '
    $4 == "chromium" || $4 == "chromium-browser" {
      command=$0
      sub(/^ +/, "", command)
      print "[tikpal-render-diagnostics] chromium-process " command
    }
  ' || true
}

report_main_chromium_gpu() {
  command -v node >/dev/null 2>&1 || {
    report "main-chromium-cdp=unavailable (node missing)"
    return
  }
  TIKPAL_DIAGNOSTICS_ADDRESS="$TIKPAL_KIOSK_REMOTE_DEBUG_CHROMIUM_ADDRESS" \
    TIKPAL_DIAGNOSTICS_PORT="$TIKPAL_KIOSK_REMOTE_DEBUG_CHROMIUM_PORT" \
    node --experimental-websocket - <<'NODE' || true
const address = process.env.TIKPAL_DIAGNOSTICS_ADDRESS;
const port = process.env.TIKPAL_DIAGNOSTICS_PORT;
const timeoutMs = 1800;
const fail = (error) => console.log(`[tikpal-render-diagnostics] main-chromium-cdp=unavailable reason=${String(error.message || error).replace(/\s+/g, " ")}`);
(async () => {
try {
  const versionResponse = await fetch(`http://${address}:${port}/json/version`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!versionResponse.ok) throw new Error(`version-http-${versionResponse.status}`);
  const version = await versionResponse.json();
  const wsUrl = version.webSocketDebuggerUrl;
  if (!wsUrl) throw new Error("browser-websocket-missing");
  const ws = await new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    const timer = setTimeout(() => { try { socket.close(); } catch {} reject(new Error("connect-timeout")); }, timeoutMs);
    socket.addEventListener("open", () => { clearTimeout(timer); resolve(socket); });
    socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("connect-failed")); });
  });
  let sequence = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    let message;
    try { message = JSON.parse(String(event.data)); } catch { return; }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    message.error ? request.reject(new Error(message.error.message || "cdp-error")) : request.resolve(message.result || {});
  });
  const rpc = (method, params = {}, sessionId = "") => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method}-timeout`)); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const [system, targets] = await Promise.all([
    rpc("SystemInfo.getInfo"),
    rpc("Target.getTargets")
  ]);
  const gpu = system.gpu || {};
  const aux = gpu.auxAttributes || {};
  const feature = gpu.featureStatus || {};
  console.log(`[tikpal-render-diagnostics] main-chromium browser=${version.Browser || "unknown"} renderer=${aux.gl_renderer || aux.glRenderer || "unknown"} video_decode=${feature.video_decode || "unknown"}`);
  const kioskTarget = (targets.targetInfos || []).find((target) => target.type === "page" && /(?:localhost|127\.0\.0\.1):4173/.test(target.url || ""));
  if (kioskTarget) {
    const attached = await rpc("Target.attachToTarget", { targetId: kioskTarget.targetId, flatten: true });
    const expression = `(() => { const render = window.__tikpalRenderingDiagnostics?.() || null; const video = document.querySelector('video.flame-video.is-active'); const quality = video?.getVideoPlaybackQuality?.(); return { render, video: quality ? { totalFrames: quality.totalVideoFrames, droppedFrames: quality.droppedVideoFrames } : null }; })()`;
    const evaluated = await rpc("Runtime.evaluate", { expression, returnByValue: true }, attached.sessionId);
    console.log(`[tikpal-render-diagnostics] main-page-frames=${JSON.stringify(evaluated.result?.value || null)}`);
    await rpc("Target.detachFromTarget", { sessionId: attached.sessionId }).catch(() => {});
  } else {
    console.log("[tikpal-render-diagnostics] main-page-frames=unavailable reason=kiosk-target-missing");
  }
  try { ws.close(); } catch {}
} catch (error) {
  fail(error);
}
})();
NODE
}

report_provider_gpu() {
  [[ -x "$TIKPAL_WEB_MODE_CDP_SESSION_MANAGER_CLIENT" ]] || {
    report "provider-cdp=unavailable"
    return
  }
  local response
  response="$(limited_command "$TIKPAL_WEB_MODE_CDP_SESSION_MANAGER_CLIENT" \
    --socket "$TIKPAL_WEB_MODE_CDP_SESSION_MANAGER_SOCKET" \
    --provider "$TIKPAL_RENDER_DIAGNOSTICS_PROVIDER" --op browser-info 2>&1 || true)"
  [[ -n "$response" ]] || response="unavailable"
  report "provider-cdp-browser-info=$response"
  response="$(limited_command "$TIKPAL_WEB_MODE_CDP_SESSION_MANAGER_CLIENT" \
    --socket "$TIKPAL_WEB_MODE_CDP_SESSION_MANAGER_SOCKET" --op status 2>&1 || true)"
  [[ -n "$response" ]] || response="unavailable"
  report "provider-cdp-status=$response"
}

resolve_xauthority
report "begin display=$DISPLAY xauthority=$XAUTHORITY render_profile=${TIKPAL_RENDER_PROFILE:-standard}"
report_xrandr
report_gl
report_vaapi
report_thermal
report_cpu
report_chromium_processes
report_main_chromium_gpu
report_provider_gpu
report "end"

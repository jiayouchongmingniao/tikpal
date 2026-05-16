import http from "node:http";
import { execFile } from "node:child_process";
import { basename } from "node:path";
import { promisify } from "node:util";

const PORT = Number(process.env.TIKPAL_API_PORT ?? 8787);
const HOST = process.env.TIKPAL_API_HOST ?? "127.0.0.1";
const PLAYER_BACKEND = (process.env.TIKPAL_PLAYER_BACKEND ?? "mock").toLowerCase();
const API_MODE = PLAYER_BACKEND === "mpc" ? "mpc" : "mock";
const MPD_HOST = process.env.TIKPAL_MPD_HOST ?? "127.0.0.1";
const MPD_PORT = process.env.TIKPAL_MPD_PORT ?? "6600";
const MPC_BIN = process.env.TIKPAL_MPC_BIN ?? "mpc";
const MPD_DEFAULT_QUEUE_PATH = process.env.TIKPAL_MPD_DEFAULT_QUEUE_PATH ?? "Codex";
const MPD_STARTUP_VOLUME = Number(process.env.TIKPAL_MPD_STARTUP_VOLUME ?? 30);
const APP_VERSION = process.env.TIKPAL_APP_VERSION ?? "0.1.0";
const REQUESTED_RENDERER = "webgl";
const REQUESTED_KIOSK_WINDOW = process.env.TIKPAL_KIOSK_WINDOW ?? "2560x720";
const LIBRARY_SCAN_COMMAND = process.env.TIKPAL_LIBRARY_SCAN_COMMAND ?? "";
const SYSTEM_REBOOT_COMMAND = process.env.TIKPAL_SYSTEM_REBOOT_COMMAND ?? "systemctl reboot";
const SYSTEM_SHUTDOWN_COMMAND = process.env.TIKPAL_SYSTEM_SHUTDOWN_COMMAND ?? "systemctl poweroff";
const DSP_PRESET = process.env.TIKPAL_DSP_PRESET ?? "Unknown";
const execFileAsync = promisify(execFile);

const tracks = [
  {
    title: "Get Lucky (feat. Pharrell Williams)",
    artist: "Daft Punk",
    album: "Random Access Memories",
    durationSeconds: 369
  },
  {
    title: "Instant Crush",
    artist: "Daft Punk",
    album: "Random Access Memories",
    durationSeconds: 337
  },
  {
    title: "Lose Yourself to Dance",
    artist: "Daft Punk",
    album: "Random Access Memories",
    durationSeconds: 353
  }
];

let trackIndex = 0;
let playbackState = "playing";
let elapsedSeconds = 84;
let favorite = false;
let lastTickAt = Date.now();
let lastMockLibraryScanAt = 0;
let lastSystemLibraryScanRequestedAt = 0;

const system = {
  network: {
    kind: "ethernet",
    label: "Ethernet",
    ip: "192.168.1.100",
    speed: "1Gbps"
  },
  outputDevice: {
    kind: "usb",
    label: "USB Audio",
    detail: "DAC: Gustard X26 Pro"
  },
  volume: {
    db: -32.5,
    percent: 58,
    muted: false
  },
  audioFormat: {
    codec: "PCM",
    bitDepth: 24,
    sampleRate: 96000,
    container: "FLAC"
  },
  sampleRate: 96000,
  bitDepth: 24,
  cpuTemp: 48,
  dspState: {
    enabled: true,
    preset: "Jazz"
  },
  library: {
    source: "NAS",
    trackCount: 3265,
    lastScan: "Today 10:30",
    scanning: false
  },
  uptime: "2d 4h"
};

function formatMockTimeLabel(date = new Date()) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `Today ${hours}:${minutes}`;
}

function syncElapsed() {
  const now = Date.now();

  if (playbackState !== "playing") {
    lastTickAt = now;
    return;
  }

  const deltaSeconds = Math.floor((now - lastTickAt) / 1000);
  if (deltaSeconds <= 0) return;

  lastTickAt += deltaSeconds * 1000;
  elapsedSeconds += deltaSeconds;

  while (elapsedSeconds >= tracks[trackIndex].durationSeconds) {
    elapsedSeconds -= tracks[trackIndex].durationSeconds;
    trackIndex = (trackIndex + 1) % tracks.length;
  }
}

function getPlayback() {
  syncElapsed();
  const track = tracks[trackIndex];
  return {
    state: playbackState,
    source: "mpd",
    albumArtUrl: null,
    title: track.title,
    artist: track.artist,
    album: track.album,
    elapsedSeconds,
    durationSeconds: track.durationSeconds,
    currentTrackIndex: trackIndex + 1,
    queueLength: 13,
    favorite
  };
}

function parseDuration(value) {
  if (!value) return null;
  const parts = String(value)
    .trim()
    .split(":")
    .map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part))) return null;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function formatMpcSeek(seconds) {
  const safeSeconds = Math.max(0, Math.round(Number(seconds)));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

async function runCommand(command, options = {}) {
  try {
    const { stdout } = await execFileAsync("sh", ["-lc", command], {
      timeout: options.timeout ?? 3500,
      maxBuffer: 1024 * 256
    });
    return stdout.trim();
  } catch (error) {
    if (options.allowFailure) return "";
    const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
    const message = stderr || (error instanceof Error ? error.message : `Command failed: ${command}`);
    throw new Error(message);
  }
}

async function runMpc(args, options = {}) {
  try {
    const { stdout } = await execFileAsync(MPC_BIN, ["--host", MPD_HOST, "--port", MPD_PORT, ...args], {
      timeout: options.timeout ?? 3500,
      maxBuffer: 1024 * 256
    });
    return stdout.trimEnd();
  } catch (error) {
    if (options.allowFailure) return "";
    const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
    const message = stderr || (error instanceof Error ? error.message : "mpc command failed");
    throw new Error(message);
  }
}

function parseMpcStatus(statusRaw) {
  const state = statusRaw.match(/\[(playing|paused|stopped)\]/)?.[1] ?? "stopped";
  const queueMatch = statusRaw.match(/#(\d+)\/(\d+)/);
  const progressMatch = statusRaw.match(/\s([0-9:]+)\/([0-9:]+)\s+\(/);
  const volumeMatch = statusRaw.match(/volume:\s*(\d+)%/);
  const scanning = /updating db/i.test(statusRaw);

  return {
    state,
    elapsedSeconds: progressMatch ? parseDuration(progressMatch[1]) : null,
    durationSeconds: progressMatch ? parseDuration(progressMatch[2]) : null,
    currentTrackIndex: queueMatch ? Number(queueMatch[1]) : 0,
    queueLength: queueMatch ? Number(queueMatch[2]) : 0,
    volumePercent: volumeMatch ? Number(volumeMatch[1]) : null,
    scanning
  };
}

function parseMpcStats(statsRaw) {
  const songs = statsRaw.match(/Songs:\s*(\d+)/)?.[1];
  const updated = statsRaw.match(/DB Updated:\s*(.+)/)?.[1];
  return {
    trackCount: songs ? Number(songs) : system.library.trackCount,
    lastScan: updated?.trim() ?? system.library.lastScan
  };
}

function trackTitleFromFile(file) {
  if (!file) return null;
  return basename(file).replace(/\.[^.]+$/, "") || file;
}

function detectOutputKind(label) {
  const normalized = label.toLowerCase();
  if (normalized.includes("bluetooth")) return "bluetooth";
  if (normalized.includes("hdmi")) return "hdmi";
  if (normalized.includes("i2s")) return "i2s";
  if (normalized.includes("usb") || normalized.includes("dac")) return "usb";
  return "usb";
}

function parseAplayDevices(aplayRaw) {
  return aplayRaw
    .split("\n")
    .map((line) => line.trim())
    .map((line) => {
      const match = line.match(/^card\s+\d+:\s+([^\s]+)\s+\[(.+?)\],\s+device\s+\d+:\s+(.+?)\s+\[(.+?)\]$/i);
      if (!match) return null;
      return {
        cardId: match[1],
        cardLabel: match[2],
        deviceId: match[3],
        deviceLabel: match[4]
      };
    })
    .filter(Boolean);
}

function parseMpcOutputs(outputsRaw) {
  const lines = outputsRaw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const parsed = [];
  for (let index = 0; index < lines.length; index += 1) {
    const header = lines[index];
    const enabledLine = lines[index + 1] ?? "";
    const match = header.match(/^output\s+for\s+(.+?)\s+is\s+(enabled|disabled)$/i);
    if (match) {
      parsed.push({
        label: match[1],
        enabled: match[2].toLowerCase() === "enabled"
      });
      continue;
    }

    const legacyMatch = header.match(/^Output\s+\d+\s+\((.+?)\):\s*(enabled|disabled)$/i);
    if (legacyMatch) {
      parsed.push({
        label: legacyMatch[1],
        enabled: legacyMatch[2].toLowerCase() === "enabled"
      });
      continue;
    }

    const enabledMatch = enabledLine.match(/^(enabled|disabled)$/i);
    if (enabledMatch) {
      parsed.push({
        label: header,
        enabled: enabledMatch[1].toLowerCase() === "enabled"
      });
      index += 1;
    }
  }

  const primary = parsed.find((item) => item.enabled) ?? parsed[0];
  if (!primary) {
    return system.outputDevice;
  }

  return {
    kind: detectOutputKind(primary.label),
    label: primary.label,
    detail: primary.enabled ? "Active output" : "Output available"
  };
}

function refineOutputDevice(outputDevice, aplayRaw) {
  const devices = parseAplayDevices(aplayRaw);
  if (!devices.length) return outputDevice;

  const normalizedLabel = outputDevice.label.toLowerCase();
  const usbDevice = devices.find((device) => {
    const combined = `${device.cardId} ${device.cardLabel} ${device.deviceId} ${device.deviceLabel}`.toLowerCase();
    return combined.includes("usb") || combined.includes("dac");
  });
  const hdmiDevice = devices.find((device) => device.cardLabel.toLowerCase().includes("hdmi"));

  if (normalizedLabel.includes("alsa default") && usbDevice) {
    return {
      kind: "usb",
      label: usbDevice.deviceLabel,
      detail: `DAC: ${usbDevice.cardLabel}`
    };
  }

  if (normalizedLabel.includes("hdmi") && hdmiDevice) {
    return {
      kind: "hdmi",
      label: "HDMI Audio",
      detail: hdmiDevice.cardLabel
    };
  }

  return outputDevice;
}

async function getNetworkSnapshot() {
  const routeRaw = await runCommand("ip route get 1.1.1.1 | head -n 1", { allowFailure: true });
  const iface = routeRaw.match(/\bdev\s+(\S+)/)?.[1];
  const ip = routeRaw.match(/\bsrc\s+(\S+)/)?.[1];

  if (!iface || !ip) {
    return {
      kind: "offline",
      label: "Offline",
      ip: "Unavailable",
      speed: "Disconnected"
    };
  }

  const kindRaw = await runCommand(`[ -d /sys/class/net/${iface}/wireless ] && echo wifi || echo ethernet`, { allowFailure: true });
  const kind = kindRaw === "wifi" ? "wifi" : "ethernet";
  let speed = system.network.speed;

  if (kind === "wifi") {
    const wifiBitrateRaw = await runCommand(`iw dev ${iface} link 2>/dev/null`, { allowFailure: true });
    const bitrateMatch = wifiBitrateRaw.match(/tx bitrate:\s*([0-9.]+\s+\S+)/i);
    if (bitrateMatch) {
      speed = bitrateMatch[1];
    } else {
      const wirelessRaw = await runCommand("cat /proc/net/wireless 2>/dev/null", { allowFailure: true });
      const qualityLine = wirelessRaw
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.startsWith(`${iface}:`));
      const qualityMatch = qualityLine?.match(/:\s+\d+\s+([0-9.]+)\./);
      if (qualityMatch) {
        speed = `Signal ${Math.round(Number(qualityMatch[1]))}/70`;
      } else {
        speed = "Connected";
      }
    }
  } else {
    const speedRaw = await runCommand(`cat /sys/class/net/${iface}/speed 2>/dev/null`, { allowFailure: true });
    const speedNumber = Number(speedRaw);
    speed = Number.isFinite(speedNumber) && speedNumber > 0 ? `${speedNumber}Mbps` : system.network.speed;
  }

  return {
    kind,
    label: kind === "wifi" ? "Wi-Fi" : "Ethernet",
    ip,
    speed
  };
}

async function getCpuTempSnapshot() {
  const vcgencmdRaw = await runCommand("vcgencmd measure_temp", { allowFailure: true });
  const vcgencmdMatch = vcgencmdRaw.match(/temp=([0-9.]+)/);
  if (vcgencmdMatch) {
    return Math.round(Number(vcgencmdMatch[1]));
  }

  const sysfsRaw = await runCommand("cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null", { allowFailure: true });
  const tempMilli = Number(sysfsRaw);
  if (Number.isFinite(tempMilli) && tempMilli > 0) {
    return Math.round(tempMilli / 1000);
  }

  return system.cpuTemp;
}

async function getUptimeSnapshot() {
  const uptimeRaw = await runCommand("uptime -p | sed 's/^up //'", { allowFailure: true });
  return uptimeRaw || system.uptime;
}

async function getDspSnapshot() {
  const activeRaw = await runCommand("systemctl is-active camilladsp 2>/dev/null || true", { allowFailure: true });
  const enabled = activeRaw === "active";
  return {
    enabled,
    preset: enabled ? DSP_PRESET : "Inactive"
  };
}

async function getRuntimeSnapshot() {
  const xrandrRaw = await runCommand("xrandr --query", { allowFailure: true });
  const currentMatch = xrandrRaw.match(/current\s+(\d+)\s+x\s+(\d+)/i);
  const kioskWindow = currentMatch ? `${currentMatch[1]}x${currentMatch[2]}` : REQUESTED_KIOSK_WINDOW;
  return {
    rendererType: REQUESTED_RENDERER === "webgl" ? "webgl" : "unknown",
    requestedRenderer: "webgl",
    kioskWindow,
    appVersion: APP_VERSION,
    apiMode: API_MODE,
    updatedAt: new Date().toISOString()
  };
}

async function getOutputDeviceSnapshot() {
  const outputsRaw = await runMpc(["outputs"], { allowFailure: true });
  if (!outputsRaw) return system.outputDevice;
  const baseOutput = parseMpcOutputs(outputsRaw);
  const aplayRaw = await runCommand("aplay -l 2>/dev/null", { allowFailure: true });
  return refineOutputDevice(baseOutput, aplayRaw);
}

async function getMpcSystemSnapshot(statusRaw, statsRaw) {
  const status = parseMpcStatus(statusRaw);
  const stats = parseMpcStats(statsRaw);
  const [network, outputDevice, dspState, cpuTemp, uptime] = await Promise.all([
    getNetworkSnapshot(),
    getOutputDeviceSnapshot(),
    getDspSnapshot(),
    getCpuTempSnapshot(),
    getUptimeSnapshot()
  ]);

  const scanRecentlyRequested = Date.now() - lastSystemLibraryScanRequestedAt < 15000;

  return {
    ...system,
    network,
    outputDevice,
    cpuTemp,
    uptime,
    dspState,
    library: {
      ...system.library,
      source: "MPD",
      trackCount: stats.trackCount,
      lastScan: stats.lastScan,
      scanning: status.scanning || scanRecentlyRequested
    }
  };
}

async function getMpcSnapshot() {
  const [currentRaw, statusRaw, statsRaw] = await Promise.all([
    runMpc(["--format", "%title%\t%artist%\t%album%\t%file%\t%time%", "current"], { allowFailure: true }),
    runMpc(["status"], { allowFailure: true }),
    runMpc(["stats"], { allowFailure: true })
  ]);

  const status = parseMpcStatus(statusRaw);
  const [title, artist, album, file, duration] = currentRaw.split("\t");
  const hasCurrentTrack = Boolean(currentRaw.trim());
  const durationSeconds = parseDuration(duration) ?? status.durationSeconds;
  const volumePercent = status.volumePercent ?? system.volume.percent;
  const nextSystem = await getMpcSystemSnapshot(statusRaw, statsRaw);

  return {
    playback: {
      state: hasCurrentTrack ? status.state : "stopped",
      source: "mpd",
      albumArtUrl: null,
      title: hasCurrentTrack ? title || trackTitleFromFile(file) : null,
      artist: hasCurrentTrack ? artist || "Unknown Artist" : null,
      album: hasCurrentTrack ? album || "MPD Queue" : null,
      elapsedSeconds: hasCurrentTrack ? status.elapsedSeconds : null,
      durationSeconds: hasCurrentTrack ? durationSeconds : null,
      currentTrackIndex: status.currentTrackIndex,
      queueLength: status.queueLength,
      favorite
    },
    system: {
      ...nextSystem,
      volume: {
        db: Number((-72 + volumePercent * 0.68).toFixed(1)),
        percent: volumePercent,
        muted: volumePercent <= 0
      }
    }
  };
}

async function ensureMpcQueue() {
  const statusRaw = await runMpc(["status"], { allowFailure: true });
  const status = parseMpcStatus(statusRaw);
  if (status.queueLength > 0) return;

  const preferredTracks = (await runMpc(["listall", MPD_DEFAULT_QUEUE_PATH], { allowFailure: true }))
    .split("\n")
    .filter(Boolean);
  const fallbackTracks = (await runMpc(["listall"], { allowFailure: true }))
    .split("\n")
    .filter(Boolean);
  const tracksToQueue = preferredTracks.length > 0 ? preferredTracks : fallbackTracks;
  const firstTrack = tracksToQueue[0];
  if (!firstTrack) {
    throw new Error("MPD library is empty; cannot start playback");
  }
  await runMpc(["clear"]);
  for (const track of tracksToQueue.slice(0, 32)) {
    await runMpc(["add", track]);
  }
}

async function applyMpcPlaybackAction(action) {
  switch (action.type) {
    case "play_pause": {
      await ensureMpcQueue();
      const status = parseMpcStatus(await runMpc(["status"], { allowFailure: true }));
      await runMpc([status.state === "playing" ? "pause" : "play"]);
      break;
    }
    case "play":
      await ensureMpcQueue();
      await runMpc(["play"]);
      break;
    case "pause":
      await runMpc(["pause"]);
      break;
    case "next":
      await ensureMpcQueue();
      await runMpc(["next"]);
      break;
    case "previous":
      await ensureMpcQueue();
      await runMpc(["prev"]);
      break;
    case "seek": {
      const seconds = Number(action.value);
      if (!Number.isFinite(seconds) || seconds < 0) {
        throw new Error("seek requires a non-negative value");
      }
      await runMpc(["seek", formatMpcSeek(seconds)]);
      break;
    }
    case "favorite_toggle":
      favorite = !favorite;
      break;
    case "volume_set": {
      const percent = Number(action.value);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        throw new Error("volume_set requires value between 0 and 100");
      }
      await runMpc(["volume", String(Math.round(percent))]);
      break;
    }
    default:
      throw new Error(`Unsupported playback action: ${action.type}`);
  }
}

async function primeMpcPlayback() {
  try {
    await ensureMpcQueue();
    const status = parseMpcStatus(await runMpc(["status"], { allowFailure: true }));
    if (status.state !== "playing" || status.queueLength === 0) {
      if (Number.isFinite(MPD_STARTUP_VOLUME) && MPD_STARTUP_VOLUME >= 0 && MPD_STARTUP_VOLUME <= 100) {
        await runMpc(["volume", String(Math.round(MPD_STARTUP_VOLUME))]);
      }
      await runMpc(["play"]);
    }
  } catch (error) {
    console.warn(`tikpal-api mpc prime failed: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

async function getPlaybackSnapshot() {
  if (API_MODE === "mpc") {
    return (await getMpcSnapshot()).playback;
  }
  return getPlayback();
}

async function getMockSystemSnapshot() {
  return {
    ...system,
    library: {
      ...system.library,
      scanning: Date.now() - lastMockLibraryScanAt < 2000
    }
  };
}

async function getTikpalState() {
  const snapshot = API_MODE === "mpc" ? await getMpcSnapshot() : { playback: getPlayback(), system: await getMockSystemSnapshot() };
  const runtime = API_MODE === "mpc"
    ? await getRuntimeSnapshot()
    : {
        rendererType: "unknown",
        requestedRenderer: "webgl",
        kioskWindow: REQUESTED_KIOSK_WINDOW,
        appVersion: APP_VERSION,
        apiMode: API_MODE,
        updatedAt: new Date().toISOString()
      };

  return {
    playback: snapshot.playback,
    system: snapshot.system,
    runtime
  };
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Accept"
  });

  if (status === 204) {
    response.end();
    return;
  }

  response.end(JSON.stringify(body));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error("Request body too large"));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function applyPlaybackAction(action) {
  syncElapsed();

  switch (action.type) {
    case "play_pause":
      playbackState = playbackState === "playing" ? "paused" : "playing";
      break;
    case "play":
      playbackState = "playing";
      break;
    case "pause":
      playbackState = "paused";
      break;
    case "next":
      trackIndex = (trackIndex + 1) % tracks.length;
      elapsedSeconds = 0;
      playbackState = "playing";
      lastTickAt = Date.now();
      break;
    case "previous":
      trackIndex = (trackIndex + tracks.length - 1) % tracks.length;
      elapsedSeconds = 0;
      playbackState = "playing";
      lastTickAt = Date.now();
      break;
    case "seek": {
      const seconds = Number(action.value);
      const durationSeconds = tracks[trackIndex].durationSeconds;
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > durationSeconds) {
        throw new Error(`seek requires value between 0 and ${durationSeconds}`);
      }
      elapsedSeconds = Math.round(seconds);
      lastTickAt = Date.now();
      break;
    }
    case "favorite_toggle":
      favorite = !favorite;
      break;
    case "volume_set": {
      const percent = Number(action.value);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        throw new Error("volume_set requires value between 0 and 100");
      }
      system.volume.percent = Math.round(percent);
      system.volume.db = Number((-72 + system.volume.percent * 0.68).toFixed(1));
      break;
    }
    default:
      throw new Error(`Unsupported playback action: ${action.type}`);
  }
}

async function runSystemActionCommand(command, label) {
  if (!command.trim()) {
    throw new Error(`${label} is not supported in this runtime`);
  }
  await runCommand(command, { allowFailure: false, timeout: 5000 });
}

function applyMockSystemAction(action) {
  switch (action.type) {
    case "library_scan":
      lastMockLibraryScanAt = Date.now();
      system.library.lastScan = formatMockTimeLabel();
      system.library.scanning = false;
      return;
    case "reboot":
    case "shutdown":
      throw new Error(`${action.type} is not supported while the API runs in mock mode`);
    default:
      throw new Error(`Unsupported system action: ${action.type}`);
  }
}

async function applyMpcSystemAction(action) {
  switch (action.type) {
    case "library_scan":
      lastSystemLibraryScanRequestedAt = Date.now();
      if (LIBRARY_SCAN_COMMAND) {
        await runSystemActionCommand(LIBRARY_SCAN_COMMAND, "library_scan");
      } else {
        await runMpc(["update"]);
      }
      return;
    case "reboot":
      await runSystemActionCommand(SYSTEM_REBOOT_COMMAND, "reboot");
      return;
    case "shutdown":
      await runSystemActionCommand(SYSTEM_SHUTDOWN_COMMAND, "shutdown");
      return;
    default:
      throw new Error(`Unsupported system action: ${action.type}`);
  }
}

async function applySystemAction(action) {
  if (API_MODE === "mpc") {
    await applyMpcSystemAction(action);
    return;
  }
  applyMockSystemAction(action);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${HOST}:${PORT}`}`);

  if (request.method === "OPTIONS") {
    sendJson(response, 204, {});
    return;
  }

  try {
    if (request.method === "GET" && (url.pathname === "/api/v1/health" || url.pathname === "/api/v1/system/health")) {
      sendJson(response, 200, { ok: true, service: "tikpal-api", mode: API_MODE });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/system/state") {
      sendJson(response, 200, await getTikpalState());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/playback/status") {
      sendJson(response, 200, await getPlaybackSnapshot());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/system/status") {
      sendJson(response, 200, (await getTikpalState()).system);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/system/runtime") {
      sendJson(response, 200, (await getTikpalState()).runtime);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v1/playback/actions") {
      const action = await readJson(request);
      if (API_MODE === "mpc") {
        await applyMpcPlaybackAction(action);
      } else {
        applyPlaybackAction(action);
      }
      sendJson(response, 200, await getTikpalState());
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v1/system/actions") {
      const action = await readJson(request);
      await applySystemAction(action);
      sendJson(response, 200, await getTikpalState());
      return;
    }

    sendJson(response, 404, { error: "NOT_FOUND", path: url.pathname });
  } catch (error) {
    sendJson(response, 400, {
      error: "BAD_REQUEST",
      message: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`tikpal-api ${API_MODE} listening on http://${HOST}:${PORT}`);
  if (API_MODE === "mpc") {
    void primeMpcPlayback();
  }
});

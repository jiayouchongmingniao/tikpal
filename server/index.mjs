import http from "node:http";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, extname, posix, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { buildAccessDeniedBody, getTikpalApiAccessDecision, hasValidTikpalKey } from "./accessControl.mjs";
import { buildOpenApiDocsHtml, buildOpenApiDocument } from "./openapi.mjs";
import { recognizeWithAcrCloud } from "./recognitionProviders/acrcloud.mjs";

const PORT = Number(process.env.TIKPAL_API_PORT ?? 8787);
const HOST = process.env.TIKPAL_API_HOST ?? "127.0.0.1";
const PORTABLE_API_KEY = process.env.TIKPAL_PORTABLE_API_KEY ?? "";
const PLAYER_BACKEND = (process.env.TIKPAL_PLAYER_BACKEND ?? "mock").toLowerCase();
const API_MODE = PLAYER_BACKEND === "mpc" ? "mpc" : "mock";
const MPD_HOST = process.env.TIKPAL_MPD_HOST ?? "127.0.0.1";
const MPD_PORT = process.env.TIKPAL_MPD_PORT ?? "6600";
const MPC_BIN = process.env.TIKPAL_MPC_BIN ?? "mpc";
const MPD_DEFAULT_QUEUE_PATH = process.env.TIKPAL_MPD_DEFAULT_QUEUE_PATH ?? "Codex";
const MPD_STARTUP_VOLUME = Number(process.env.TIKPAL_MPD_STARTUP_VOLUME ?? 30);
const MPD_MUSIC_ROOT = process.env.TIKPAL_MPD_MUSIC_ROOT ?? "/var/lib/mpd/music";
const APP_VERSION = process.env.TIKPAL_APP_VERSION ?? "0.1.0";
const REQUESTED_RENDERER = (process.env.TIKPAL_RENDERER ?? "media").toLowerCase();
const REQUESTED_KIOSK_WINDOW = process.env.TIKPAL_KIOSK_WINDOW ?? "2560x720";
const LIBRARY_SCAN_COMMAND = process.env.TIKPAL_LIBRARY_SCAN_COMMAND ?? "";
const SYSTEM_REBOOT_COMMAND = process.env.TIKPAL_SYSTEM_REBOOT_COMMAND ?? "systemctl reboot";
const SYSTEM_SHUTDOWN_COMMAND = process.env.TIKPAL_SYSTEM_SHUTDOWN_COMMAND ?? "systemctl poweroff";
const DSP_PRESET = process.env.TIKPAL_DSP_PRESET ?? "Unknown";
const DDCUTIL_BIN = process.env.TIKPAL_DDCUTIL_BIN ?? "ddcutil";
const DDCUTIL_DISPLAY = process.env.TIKPAL_DDCUTIL_DISPLAY ?? "";
const DDCUTIL_READ_CACHE_MS_RAW = Number(process.env.TIKPAL_DDCUTIL_READ_CACHE_MS ?? 300_000);
const DDCUTIL_READ_CACHE_MS = Number.isFinite(DDCUTIL_READ_CACHE_MS_RAW) && DDCUTIL_READ_CACHE_MS_RAW >= 0
  ? DDCUTIL_READ_CACHE_MS_RAW
  : 300_000;
const DDCUTIL_READ_TIMEOUT_MS_RAW = Number(process.env.TIKPAL_DDCUTIL_READ_TIMEOUT_MS ?? 3500);
const DDCUTIL_READ_TIMEOUT_MS = Number.isFinite(DDCUTIL_READ_TIMEOUT_MS_RAW) && DDCUTIL_READ_TIMEOUT_MS_RAW > 0
  ? DDCUTIL_READ_TIMEOUT_MS_RAW
  : 3500;
const FFPROBE_BIN = process.env.TIKPAL_FFPROBE_BIN ?? "ffprobe";
const FFMPEG_BIN = process.env.TIKPAL_FFMPEG_BIN ?? "ffmpeg";
const RADIO_ACTIVATE_COMMAND = process.env.TIKPAL_RADIO_ACTIVATE_COMMAND ?? "";
const RADIO_DEFAULT_URI = process.env.TIKPAL_RADIO_DEFAULT_URI ?? "";
const RADIO_LABEL = process.env.TIKPAL_RADIO_LABEL ?? "Last Station";
const RADIO_PRESET_LIMIT = Number(process.env.TIKPAL_RADIO_PRESET_LIMIT ?? 250);
const AUDIO_READY_COMMAND = process.env.TIKPAL_AUDIO_READY_COMMAND ?? "";
const AUDIO_ACTIVE_COMMAND = process.env.TIKPAL_AUDIO_ACTIVE_COMMAND ?? "";
const AUDIO_ACTIVATE_COMMAND = process.env.TIKPAL_AUDIO_ACTIVATE_COMMAND ?? "";
const AUDIO_LABEL_COMMAND = process.env.TIKPAL_AUDIO_LABEL_COMMAND ?? "";
const SPOTIFY_READY_COMMAND = process.env.TIKPAL_SPOTIFY_READY_COMMAND ?? "";
const SPOTIFY_ACTIVE_COMMAND = process.env.TIKPAL_SPOTIFY_ACTIVE_COMMAND ?? "";
const SPOTIFY_ACTIVATE_COMMAND = process.env.TIKPAL_SPOTIFY_ACTIVATE_COMMAND ?? "";
const SPOTIFY_DISABLE_COMMAND = process.env.TIKPAL_SPOTIFY_DISABLE_COMMAND ?? "";
const SPOTIFY_LABEL_COMMAND = process.env.TIKPAL_SPOTIFY_LABEL_COMMAND ?? "";
const BLUETOOTH_READY_COMMAND = process.env.TIKPAL_BLUETOOTH_READY_COMMAND ?? "";
const BLUETOOTH_ACTIVE_COMMAND = process.env.TIKPAL_BLUETOOTH_ACTIVE_COMMAND ?? "";
const BLUETOOTH_ENABLE_COMMAND = process.env.TIKPAL_BLUETOOTH_ENABLE_COMMAND ?? "";
const BLUETOOTH_DISABLE_COMMAND = process.env.TIKPAL_BLUETOOTH_DISABLE_COMMAND ?? "";
const BLUETOOTH_LABEL_COMMAND = process.env.TIKPAL_BLUETOOTH_LABEL_COMMAND ?? "";
const BLUETOOTH_METADATA_COMMAND = process.env.TIKPAL_BLUETOOTH_METADATA_COMMAND ?? "";
const AIRPLAY_READY_COMMAND = process.env.TIKPAL_AIRPLAY_READY_COMMAND ?? "";
const AIRPLAY_ACTIVE_COMMAND = process.env.TIKPAL_AIRPLAY_ACTIVE_COMMAND ?? "";
const AIRPLAY_ENABLE_COMMAND = process.env.TIKPAL_AIRPLAY_ENABLE_COMMAND ?? "";
const AIRPLAY_DISABLE_COMMAND = process.env.TIKPAL_AIRPLAY_DISABLE_COMMAND ?? "";
const AIRPLAY_LABEL_COMMAND = process.env.TIKPAL_AIRPLAY_LABEL_COMMAND ?? "";
const AIRPLAY_RECEIVER_ACTIVE_COMMAND = process.env.TIKPAL_AIRPLAY_RECEIVER_ACTIVE_COMMAND ?? "systemctl is-active --quiet shairport-sync.service";
const AIRPLAY_METADATA_COMMAND = process.env.TIKPAL_AIRPLAY_METADATA_COMMAND ?? "";
const UPNP_READY_COMMAND = process.env.TIKPAL_UPNP_READY_COMMAND ?? "";
const UPNP_ACTIVE_COMMAND = process.env.TIKPAL_UPNP_ACTIVE_COMMAND ?? "";
const UPNP_ENABLE_COMMAND = process.env.TIKPAL_UPNP_ENABLE_COMMAND ?? "";
const UPNP_DISABLE_COMMAND = process.env.TIKPAL_UPNP_DISABLE_COMMAND ?? "";
const UPNP_LABEL_COMMAND = process.env.TIKPAL_UPNP_LABEL_COMMAND ?? "";
const OUTPUT_VOLUME_GET_COMMAND = process.env.TIKPAL_OUTPUT_VOLUME_GET_COMMAND ?? "amixer get PCM";
const OUTPUT_VOLUME_SET_COMMAND = process.env.TIKPAL_OUTPUT_VOLUME_SET_COMMAND ?? "amixer sset PCM %VALUE%%";
const HIFI_EQ_APPLY_COMMAND = process.env.TIKPAL_HIFI_EQ_APPLY_COMMAND ?? "";
const HIFI_SPECTRUM_COMMAND = process.env.TIKPAL_HIFI_SPECTRUM_COMMAND ?? "";
const HIFI_SPECTRUM_CACHE_MS_RAW = Number(process.env.TIKPAL_HIFI_SPECTRUM_CACHE_MS ?? 900);
const HIFI_SPECTRUM_CACHE_MS = Number.isFinite(HIFI_SPECTRUM_CACHE_MS_RAW) && HIFI_SPECTRUM_CACHE_MS_RAW >= 0
  ? HIFI_SPECTRUM_CACHE_MS_RAW
  : 900;
const STATE_SNAPSHOT_REFRESH_MS_RAW = Number(process.env.TIKPAL_STATE_SNAPSHOT_REFRESH_MS ?? 3000);
const STATE_SNAPSHOT_REFRESH_MS = Number.isFinite(STATE_SNAPSHOT_REFRESH_MS_RAW) && STATE_SNAPSHOT_REFRESH_MS_RAW >= 1000
  ? STATE_SNAPSHOT_REFRESH_MS_RAW
  : 3000;
const RECOGNITION_PROVIDER = (process.env.TIKPAL_RECOGNITION_PROVIDER ?? "").trim().toLowerCase();
const ACRCLOUD_HOST = process.env.TIKPAL_ACRCLOUD_HOST ?? "";
const ACRCLOUD_ACCESS_KEY = process.env.TIKPAL_ACRCLOUD_ACCESS_KEY ?? "";
const ACRCLOUD_ACCESS_SECRET = process.env.TIKPAL_ACRCLOUD_ACCESS_SECRET ?? "";
const BLUETOOTH_CAPTURE_COMMAND = process.env.TIKPAL_BLUETOOTH_CAPTURE_COMMAND ?? "";
const AIRPLAY_CAPTURE_COMMAND = process.env.TIKPAL_AIRPLAY_CAPTURE_COMMAND ?? "";
const AIRPLAY_ARTWORK_ROOT = resolve(process.env.TIKPAL_AIRPLAY_ARTWORK_ROOT ?? "/var/local/www/imagesw/airplay-covers");
const BLUETOOTH_CAPTURE_DURATION_SECONDS = Number(process.env.TIKPAL_BLUETOOTH_CAPTURE_DURATION_SECONDS ?? 10);
const BLUETOOTH_RECOGNITION_SETTLE_MS = Number(process.env.TIKPAL_BLUETOOTH_RECOGNITION_SETTLE_MS ?? 4000);
const BLUETOOTH_RECOGNITION_RETRY_MS = Number(process.env.TIKPAL_BLUETOOTH_RECOGNITION_RETRY_MS ?? 45000);
const BLUETOOTH_RECOGNITION_NOT_FOUND_RETRY_MS = Number(process.env.TIKPAL_BLUETOOTH_RECOGNITION_NOT_FOUND_RETRY_MS ?? 30000);
const MOCK_BLUETOOTH_CONNECT_AFTER_MS = Number(process.env.TIKPAL_MOCK_BLUETOOTH_CONNECT_AFTER_MS ?? 1200);
const MOCK_BLUETOOTH_METADATA = process.env.TIKPAL_MOCK_BLUETOOTH_METADATA ?? "";
const MOCK_BLUETOOTH_METADATA_FILE = process.env.TIKPAL_MOCK_BLUETOOTH_METADATA_FILE ?? "";
const MOCK_SPOTIFY_CONNECT_AFTER_MS = Number(process.env.TIKPAL_MOCK_SPOTIFY_CONNECT_AFTER_MS ?? 1200);
const MOCK_AIRPLAY_CONNECT_AFTER_MS = Number(process.env.TIKPAL_MOCK_AIRPLAY_CONNECT_AFTER_MS ?? 1200);
const MOCK_UPNP_CONNECT_AFTER_MS = Number(process.env.TIKPAL_MOCK_UPNP_CONNECT_AFTER_MS ?? 1200);
const LRCLIB_BASE_URL = process.env.TIKPAL_LRCLIB_BASE_URL ?? "https://lrclib.net";
const LRCLIB_TIMEOUT_MS = Number(process.env.TIKPAL_LRCLIB_TIMEOUT_MS ?? 7000);
const THEAUDIODB_BASE_URL = process.env.TIKPAL_THEAUDIODB_BASE_URL ?? "https://www.theaudiodb.com";
const THEAUDIODB_API_KEY = process.env.TIKPAL_THEAUDIODB_API_KEY ?? "123";
const REMOTE_METADATA_TIMEOUT_MS = Number(process.env.TIKPAL_REMOTE_METADATA_TIMEOUT_MS ?? 4500);
const LYRICS_ERROR_BACKOFF_MS = Number(process.env.TIKPAL_LYRICS_ERROR_BACKOFF_MS ?? 90000);
const BLUETOOTH_LYRICS_MIN_TIMED_DURATION_MS = 30_000;
const BLUETOOTH_LYRICS_DURATION_GRACE_MS = 2_000;
const REMOTE_MEDIA_CACHE_ROOT = resolve(process.cwd(), ".cache", "remote-media");
const REMOTE_ARTWORK_CACHE_DIR = resolve(REMOTE_MEDIA_CACHE_ROOT, "artwork");
const REMOTE_ARTWORK_INDEX_DIR = resolve(REMOTE_MEDIA_CACHE_ROOT, "artwork-index");
const LOCAL_LIBRARY_MANIFEST_PATH = process.env.TIKPAL_LOCAL_LIBRARY_MANIFEST_PATH
  ?? resolve(process.cwd(), "public", "assets", "music", "_metadata", "library_manifest.json");
const LOCAL_LIBRARY_ROOT = resolve(dirname(LOCAL_LIBRARY_MANIFEST_PATH), "..");
const LOCAL_PLAYLIST_INDEX_PATH = resolve(LOCAL_LIBRARY_ROOT, "_metadata", "playlist_index.json");
const LOCAL_PLAYLIST_ROOT = resolve(LOCAL_LIBRARY_ROOT, "_playlists");
const MUSIC_LIBRARY_STATE_PATH = resolve(process.env.TIKPAL_MUSIC_LIBRARY_STATE_PATH ?? resolve(process.cwd(), ".tikpal", "music-library-state.json"));
const ROOM_EXPERIENCE_STATE_PATH = resolve(process.env.TIKPAL_ROOM_EXPERIENCE_STATE_PATH ?? resolve(process.cwd(), ".tikpal", "room-experience-state.json"));
const LOCAL_LIBRARY_COVER_COLUMNS = ["cover_relative_path", "cover_path", "album_art_relative_path", "artwork_relative_path"];
const LOCAL_LIBRARY_COVER_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];
const PUBLIC_ASSETS_ROOT = resolve(process.env.TIKPAL_PUBLIC_ASSETS_ROOT ?? resolve(process.cwd(), "public", "assets"));
const PUBLIC_SCENES_ROOT = resolve(PUBLIC_ASSETS_ROOT, "scenes");
const SCENE_VIDEO_MANIFEST_PATH = resolve(PUBLIC_SCENES_ROOT, "_metadata", "scene_videos.json");
const AMBIENT_BACKGROUND_VIDEO_EXTENSIONS = new Set([".mp4"]);
const PREFERRED_AMBIENT_BACKGROUND_VIDEOS = [];
const DEFAULT_SCENE_VIDEO = {
  id: "scene-empty",
  label: "No scene video",
  src: ""
};
const PLAYLIST_NAME_MAX_LENGTH = 40;
const PLAYLIST_MOOD_TAGS = new Set(["Focus", "Flow", "Calm", "Sleep", "Fireplace", "Meditation", "Reading", "Morning"]);
const PLAYLIST_COVER_TYPES = new Set(["gradient", "scene", "collage", "custom"]);
const PLAYBACK_MODES = new Set(["sequence", "repeat_one", "shuffle"]);
const ROOM_MODES = new Set(["focus", "calm", "sleep", "hifi"]);
const ROOM_SESSION_PHASES = new Set(["idle", "preparing", "active", "windDown"]);
const REMOTE_SOURCE_TARGETS = new Set(["mpd", "radio", "spotify", "bluetooth", "airplay", "upnp"]);
const REMOTE_ALLOWED_ACTIONS = [
  "playback.play_pause",
  "playback.play",
  "playback.pause",
  "playback.next",
  "playback.previous",
  "playback.seek",
  "playback.play_mode_set",
  "volume_set",
  "source.set",
  "room.set_mode",
  "room.start_session",
  "room.stop_session",
  "room.update_timer",
  "scene.set",
  "scene.sound_set",
  "hifi.eq_set",
  "display.brightness_set",
  "lyrics.refresh"
];
const HIFI_EQ_PRESETS = [
  { id: "flat", label: "Flat", intent: "Reference response", hifiVisualPresetId: "spectrum-bars" },
  { id: "warm", label: "Warm", intent: "Gentle low-mid lift", hifiVisualPresetId: "waveform" },
  { id: "vocal", label: "Vocal", intent: "Clearer midrange presence", hifiVisualPresetId: "dual-vu" }
];
const HIFI_EQ_PRESET_IDS = new Set(HIFI_EQ_PRESETS.map((preset) => preset.id));
const HIFI_VISUAL_PRESETS = new Set(["spectrum-bars", "waveform", "dual-vu"]);
const DEFAULT_HIFI_EQ_PRESET_ID = "flat";
const DEFAULT_HIFI_VISUAL_PRESET_ID = "spectrum-bars";
const DEFAULT_NIGHT_SCHEDULE = {
  enabled: true,
  timeZone: normalizeTimeZone(process.env.TZ) || "Asia/Shanghai",
  start: "22:30",
  end: "06:30",
  brightnessPercent: 5,
  active: false,
  preNightBrightnessPercent: null
};
const ROOM_MODE_PRESETS = {
  focus: {
    presetId: "focus-library-flow",
    sceneVideoId: "midnight-library",
    sceneVideoLabel: "Midnight Library",
    sceneVideoSrc: "/assets/scenes/Midnight-Library.mp4",
    hifiEqPresetId: DEFAULT_HIFI_EQ_PRESET_ID,
    hifiVisualPresetId: DEFAULT_HIFI_VISUAL_PRESET_ID,
    sceneSoundEnabled: false,
    playlistId: null,
    volumePercent: 42,
    brightnessPercent: 64,
    timerMinutes: 50
  },
  calm: {
    presetId: "calm-rain-room",
    sceneVideoId: "rainy-window",
    sceneVideoLabel: "Rainy Window",
    sceneVideoSrc: "/assets/scenes/Rainy-Window.mp4",
    hifiEqPresetId: DEFAULT_HIFI_EQ_PRESET_ID,
    hifiVisualPresetId: DEFAULT_HIFI_VISUAL_PRESET_ID,
    sceneSoundEnabled: false,
    playlistId: null,
    volumePercent: 38,
    brightnessPercent: 48,
    timerMinutes: 45
  },
  sleep: {
    presetId: "sleep-ocean-dim",
    sceneVideoId: "deep-blue-ocean",
    sceneVideoLabel: "Deep Blue Ocean",
    sceneVideoSrc: "/assets/scenes/Deep-Blue-Ocean.mp4",
    hifiEqPresetId: DEFAULT_HIFI_EQ_PRESET_ID,
    hifiVisualPresetId: DEFAULT_HIFI_VISUAL_PRESET_ID,
    sceneSoundEnabled: false,
    playlistId: null,
    volumePercent: 26,
    brightnessPercent: 22,
    timerMinutes: 90
  },
  hifi: {
    presetId: "hifi-eq-console",
    sceneVideoId: "scene-empty",
    sceneVideoLabel: "Hi-Fi EQ",
    sceneVideoSrc: "",
    hifiEqPresetId: DEFAULT_HIFI_EQ_PRESET_ID,
    hifiVisualPresetId: DEFAULT_HIFI_VISUAL_PRESET_ID,
    sceneSoundEnabled: false,
    playlistId: null,
    volumePercent: 58,
    brightnessPercent: 72,
    timerMinutes: null
  }
};
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
let mockSelectedLocalTrack = null;
let mockLocalQueueTracks = [];
let mockLocalQueueIndex = 0;
let playbackState = "playing";
let elapsedSeconds = 84;
let playMode = "sequence";
let lastTickAt = Date.now();
let lastMockLibraryScanAt = 0;
let lastSystemLibraryScanRequestedAt = 0;
const mediaMetadataCache = new Map();
let currentArtworkState = null;
let mockActiveSource = "mpd";
let mockActiveRadioStationId = "radio-1";
let mockArmedSource = null;
let scenePlaybackState = "stopped";
let currentSceneVideo = { ...DEFAULT_SCENE_VIDEO };
let mockAudioArmedAt = 0;
let mockSpotifyArmedAt = 0;
let mockBluetoothArmedAt = 0;
let mockAirplayArmedAt = 0;
let mockUpnpArmedAt = 0;
let lyricsState = buildLyricsState();
const lyricsResultCache = new Map();
const lyricsRetryAfter = new Map();
const lyricsInFlight = new Map();
const remoteArtworkCache = new Map();
const remoteArtworkInFlight = new Map();
let bluetoothRecognitionSession = buildBluetoothRecognitionSession();
let displayBrightnessSnapshotCache = null;
let displayBrightnessRefreshPromise = null;
let tikpalStateSnapshotCache = null;
let tikpalStateSnapshotRefreshPromise = null;
let tikpalStateSnapshotRefreshTimer = null;

const system = {
  network: {
    kind: "ethernet",
    label: "Ethernet",
    ip: "192.168.1.100",
    speed: "1Gbps"
  },
  display: {
    brightnessPercent: 72,
    controllable: true,
    transport: "mock"
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
    preset: "Flat",
    presetId: "flat",
    presetLabel: "Flat",
    controllable: true,
    controlTransport: "mock",
    availablePresets: HIFI_EQ_PRESETS
  },
  library: {
    source: "NAS",
    trackCount: 3265,
    lastScan: "Today 10:30",
    scanning: false
  },
  uptime: "2d 4h"
};

function buildSourceSummary({ id, label, availability, active, controllability, secondaryStatus }) {
  return {
    id,
    label,
    kind: id,
    availability,
    active,
    controllability,
    armed: false,
    connectionState: "idle",
    connectedLabel: null,
    advertisedLabel: null,
    secondaryStatus
  };
}

function buildRadioStationSummary({ id, label, uri, genre, bitrateKbps, codec, secondaryStatus, active }) {
  return {
    id,
    label,
    uri,
    genre: genre ?? "",
    bitrateKbps: bitrateKbps ?? null,
    codec: codec ?? null,
    secondaryStatus,
    active
  };
}

function buildSourceRuntimeState(overrides = {}) {
  return {
    supported: false,
    available: false,
    armed: false,
    connected: false,
    connectedLabel: null,
    advertisedLabel: null,
    ...overrides
  };
}

function normalizeSceneVideoSummary(action = {}) {
  const rawSrc = String(action.sceneVideoSrc ?? "").trim();
  const src = rawSrc.startsWith("/assets/") && rawSrc.toLowerCase().endsWith(".mp4")
    ? rawSrc
    : DEFAULT_SCENE_VIDEO.src;
  const fallbackLabel = basename(decodeURIComponent(src).replace(/^\/assets\//, "")) || DEFAULT_SCENE_VIDEO.label;
  const label = String(action.sceneVideoLabel ?? "").trim() || fallbackLabel;
  const id = String(action.sceneVideoId ?? "").trim()
    || label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    || DEFAULT_SCENE_VIDEO.id;

  return { id, label, src };
}

function activateSceneAudio(action = {}) {
  currentSceneVideo = normalizeSceneVideoSummary(action);
  scenePlaybackState = "playing";
}

function stopSceneAudio() {
  scenePlaybackState = "stopped";
}

function clampPercent(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function normalizeTimeZone(value) {
  const timeZone = String(value ?? "").trim();
  if (!timeZone) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return null;
  }
}

function assertValidTimeZone(value) {
  const timeZone = normalizeTimeZone(value);
  if (!timeZone) {
    throw new Error("nightSchedule.timeZone must be a valid IANA timezone");
  }
  return timeZone;
}

function normalizeClockTime(value, fallback) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return fallback;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function clockTimeToMinutes(value) {
  const [hour, minute] = String(value).split(":").map(Number);
  return hour * 60 + minute;
}

function getLocalMinutesForTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0) % 24;
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

function isWithinNightWindow(date, schedule) {
  if (!schedule.enabled) return false;
  const nowMinutes = getLocalMinutesForTimeZone(date, schedule.timeZone);
  const startMinutes = clockTimeToMinutes(schedule.start);
  const endMinutes = clockTimeToMinutes(schedule.end);
  if (startMinutes === endMinutes) return false;
  if (startMinutes < endMinutes) return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

function normalizeHifiVisualPresetId(value, fallback = DEFAULT_HIFI_VISUAL_PRESET_ID) {
  const id = String(value ?? "").trim();
  return HIFI_VISUAL_PRESETS.has(id) ? id : fallback;
}

function getHifiEqPreset(id = DEFAULT_HIFI_EQ_PRESET_ID) {
  return HIFI_EQ_PRESETS.find((preset) => preset.id === id) ?? HIFI_EQ_PRESETS[0];
}

function normalizeHifiEqPresetId(value, fallback = DEFAULT_HIFI_EQ_PRESET_ID) {
  const id = String(value ?? "").trim();
  return HIFI_EQ_PRESET_IDS.has(id) ? id : fallback;
}

function getHifiEqPresetIdForVisualPresetId(value, fallback = DEFAULT_HIFI_EQ_PRESET_ID) {
  const visualPresetId = normalizeHifiVisualPresetId(value, "");
  return HIFI_EQ_PRESETS.find((preset) => preset.hifiVisualPresetId === visualPresetId)?.id ?? fallback;
}

function buildHifiEqPatch(action = {}, fallbackEqPresetId = DEFAULT_HIFI_EQ_PRESET_ID) {
  const visualFallback = getHifiEqPresetIdForVisualPresetId(action.hifiVisualPresetId, fallbackEqPresetId);
  const hifiEqPresetId = normalizeHifiEqPresetId(action.hifiEqPresetId, visualFallback);
  const preset = getHifiEqPreset(hifiEqPresetId);
  return {
    hifiEqPresetId: preset.id,
    hifiVisualPresetId: preset.hifiVisualPresetId
  };
}

function buildDspState(experience, { enabled, controllable, controlTransport }) {
  const preset = getHifiEqPreset(experience.hifiEqPresetId);
  return {
    enabled,
    preset: preset.label,
    presetId: preset.id,
    presetLabel: preset.label,
    controllable,
    controlTransport,
    availablePresets: HIFI_EQ_PRESETS
  };
}

function normalizeNightSchedule(raw = {}, fallback = DEFAULT_NIGHT_SCHEDULE) {
  return {
    enabled: raw?.enabled === undefined ? fallback.enabled : raw.enabled !== false,
    timeZone: normalizeTimeZone(raw?.timeZone) ?? fallback.timeZone,
    start: normalizeClockTime(raw?.start, fallback.start),
    end: normalizeClockTime(raw?.end, fallback.end),
    brightnessPercent: clampPercent(raw?.brightnessPercent, fallback.brightnessPercent),
    active: raw?.active === true,
    preNightBrightnessPercent: Number.isFinite(Number(raw?.preNightBrightnessPercent))
      ? clampPercent(raw.preNightBrightnessPercent, fallback.preNightBrightnessPercent ?? 50)
      : null
  };
}

function normalizeRoomMode(value) {
  const mode = String(value ?? "").trim().toLowerCase();
  if (ROOM_MODES.has(mode)) return mode;
  return "calm";
}

function normalizeRoomSessionPhase(value) {
  const phase = String(value ?? "").trim();
  return ROOM_SESSION_PHASES.has(phase) ? phase : "idle";
}

function normalizeTimerMinutes(value, fallback) {
  if (value === null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(5, Math.min(180, Math.round(numeric)));
}

function normalizeTimerEndsAt(value) {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

function buildTimerEndsAt(timerMinutes, now = new Date()) {
  if (typeof timerMinutes !== "number") return null;
  return new Date(now.getTime() + timerMinutes * 60_000).toISOString();
}

function buildDefaultRoomExperienceState(mode = "calm") {
  const normalizedMode = normalizeRoomMode(mode);
  const preset = ROOM_MODE_PRESETS[normalizedMode];
  return {
    mode: normalizedMode,
    phase: "idle",
    presetId: preset.presetId,
    sceneVideoId: preset.sceneVideoId,
    ...buildHifiEqPatch({ hifiEqPresetId: preset.hifiEqPresetId }, preset.hifiEqPresetId),
    sceneSoundEnabled: preset.sceneSoundEnabled,
    playlistId: preset.playlistId,
    volumePercent: preset.volumePercent,
    brightnessPercent: preset.brightnessPercent,
    timerMinutes: preset.timerMinutes,
    timerEndsAt: null,
    nightSchedule: { ...DEFAULT_NIGHT_SCHEDULE },
    updatedAt: new Date().toISOString()
  };
}

function normalizeRoomExperienceState(raw) {
  const base = buildDefaultRoomExperienceState(raw?.mode);
  const preset = ROOM_MODE_PRESETS[base.mode];
  const timerMinutes = normalizeTimerMinutes(raw?.timerMinutes, preset.timerMinutes);
  const hifiEqPatch = buildHifiEqPatch(raw, preset.hifiEqPresetId);
  return {
    ...base,
    phase: normalizeRoomSessionPhase(raw?.phase),
    presetId: String(raw?.presetId ?? preset.presetId).trim() || preset.presetId,
    sceneVideoId: String(raw?.sceneVideoId ?? preset.sceneVideoId).trim() || preset.sceneVideoId,
    ...hifiEqPatch,
    sceneSoundEnabled: raw?.sceneSoundEnabled === true,
    playlistId: raw?.playlistId === null || raw?.playlistId === undefined ? null : String(raw.playlistId).trim() || null,
    volumePercent: clampPercent(raw?.volumePercent, preset.volumePercent),
    brightnessPercent: clampPercent(raw?.brightnessPercent, preset.brightnessPercent),
    timerMinutes,
    timerEndsAt: normalizeTimerEndsAt(raw?.timerEndsAt),
    nightSchedule: normalizeNightSchedule(raw?.nightSchedule, DEFAULT_NIGHT_SCHEDULE),
    updatedAt: String(raw?.updatedAt ?? base.updatedAt)
  };
}

function buildQueueEntrySummary({ id, position, title, artist, album, durationSeconds, active }) {
  return {
    id,
    position,
    title,
    artist,
    album,
    durationSeconds,
    active
  };
}

function buildMockQueuePreview() {
  if (mockLocalQueueTracks.length > 0) {
    const queue = mockLocalQueueTracks.map((track, index) => buildQueueEntrySummary({
      id: `local-${track.id}`,
      position: index + 1,
      title: track.title,
      artist: track.artist,
      album: track.album,
      durationSeconds: track.durationSeconds,
      active: index === mockLocalQueueIndex
    }));
    const previewStart = Math.max(0, Math.min(queue.length - 5, mockLocalQueueIndex - 1));
    return queue.slice(previewStart, previewStart + 5);
  }

  const total = 13;
  const queue = Array.from({ length: total }, (_, index) => {
    const track = tracks[index % tracks.length];
    return buildQueueEntrySummary({
      id: `mock-queue-${index + 1}`,
      position: index + 1,
      title: track.title,
      artist: track.artist,
      album: track.album,
      durationSeconds: track.durationSeconds,
      active: index === trackIndex
    });
  });
  const previewStart = Math.max(0, Math.min(queue.length - 5, trackIndex - 1));
  return queue.slice(previewStart, previewStart + 5);
}

function setMockLocalQueue(queueTracks, startIndex = 0) {
  mockLocalQueueTracks = Array.isArray(queueTracks) ? queueTracks.filter(Boolean) : [];
  mockLocalQueueIndex = Math.max(0, Math.min(mockLocalQueueTracks.length - 1, startIndex));
  mockSelectedLocalTrack = mockLocalQueueTracks[mockLocalQueueIndex] ?? null;
}

function clearMockLocalQueue() {
  mockLocalQueueTracks = [];
  mockLocalQueueIndex = 0;
  mockSelectedLocalTrack = null;
}

function advanceMockLocalQueue(delta) {
  if (mockLocalQueueTracks.length === 0) return false;
  if (playMode === "shuffle") {
    mockLocalQueueIndex = Math.floor(Math.random() * mockLocalQueueTracks.length);
  } else {
    mockLocalQueueIndex = (mockLocalQueueIndex + delta + mockLocalQueueTracks.length) % mockLocalQueueTracks.length;
  }
  mockSelectedLocalTrack = mockLocalQueueTracks[mockLocalQueueIndex] ?? null;
  elapsedSeconds = 0;
  playbackState = "playing";
  lastTickAt = Date.now();
  return true;
}

function getPlaybackSettings() {
  return {
    playMode
  };
}

function normalizePlaybackMode(mode) {
  if (typeof mode === "string" && PLAYBACK_MODES.has(mode)) {
    return mode;
  }

  throw new Error("play_mode_set requires mode sequence, repeat_one, or shuffle");
}

function randomMockTrackIndex(excludedIndex = trackIndex) {
  if (tracks.length <= 1) return excludedIndex;
  let nextIndex = excludedIndex;
  while (nextIndex === excludedIndex) {
    nextIndex = Math.floor(Math.random() * tracks.length);
  }
  return nextIndex;
}

function buildAudioState({ activeSource, armedSource = null, radioReady, radioActive, radioStations = [], audioSourceState, spotifyState, bluetoothState, airplayState, upnpState }) {
  audioSourceState = buildSourceRuntimeState(audioSourceState);
  spotifyState = buildSourceRuntimeState(spotifyState);
  bluetoothState = buildSourceRuntimeState(bluetoothState);
  airplayState = buildSourceRuntimeState(airplayState);
  upnpState = buildSourceRuntimeState(upnpState);

  const activeRadio = radioStations.find((station) => station.active) ?? null;
  const sources = [
    buildSourceSummary({
      id: "mpd",
      label: "Library",
      availability: "available",
      active: activeSource === "mpd",
      controllability: "switchable",
      secondaryStatus: activeSource === "mpd" ? "Local library control ready" : "Return to local queue"
    }),
    buildSourceSummary({
      id: "radio",
      label: "Radio",
      availability: radioActive || radioReady ? "available" : "unavailable",
      active: activeSource === "radio",
      controllability: radioReady ? "switchable" : "status-only",
      secondaryStatus: radioActive
        ? `${activeRadio?.label ?? RADIO_LABEL} active`
        : radioReady
          ? `Choose from ${radioStations.length || 1} presets`
          : "No radio route configured"
    }),
    buildSourceSummary({
      id: "scene",
      label: "Scene Sound",
      availability: "available",
      active: activeSource === "scene",
      controllability: "switchable",
      secondaryStatus: activeSource === "scene"
        ? `${currentSceneVideo.label} audio ${scenePlaybackState === "playing" ? "playing" : "stopped"}`
        : "Use the current background video as an exclusive source"
    }),
    {
      ...buildSourceSummary({
        id: "audio",
        label: "Audio",
        availability: audioSourceState.available ? "available" : "unavailable",
        active: activeSource === "audio",
        controllability: audioSourceState.supported ? "switchable" : "status-only",
        secondaryStatus: audioSourceState.connected
          ? `${audioSourceState.connectedLabel ?? "Audio"} active`
          : audioSourceState.armed
            ? audioSourceState.advertisedLabel
              ? `Audio is open as ${audioSourceState.advertisedLabel}`
              : "Audio source is open"
            : audioSourceState.supported
              ? audioSourceState.advertisedLabel
                ? `Select to open Audio as ${audioSourceState.advertisedLabel}`
                : "Select to open Audio"
              : "Audio source unavailable"
      }),
      armed: audioSourceState.armed,
      connectionState: audioSourceState.connected ? "connected" : audioSourceState.armed ? "armed" : "idle",
      connectedLabel: audioSourceState.connectedLabel,
      advertisedLabel: audioSourceState.advertisedLabel
    },
    {
      ...buildSourceSummary({
        id: "spotify",
        label: "Spotify Connect",
        availability: spotifyState.available ? (spotifyState.connected ? "available" : "waiting") : "unavailable",
        active: activeSource === "spotify",
        controllability: spotifyState.supported ? "handoff" : "status-only",
        secondaryStatus: spotifyState.connected
          ? `${spotifyState.connectedLabel ?? "Spotify session"} connected`
          : spotifyState.armed
            ? spotifyState.advertisedLabel
              ? `Spotify Connect is open as ${spotifyState.advertisedLabel}`
              : "Spotify Connect is open for this source"
            : spotifyState.supported
              ? spotifyState.advertisedLabel
                ? `Closed until you open Spotify Connect as ${spotifyState.advertisedLabel}`
                : "Closed until you open Spotify Connect"
              : "Spotify Connect unavailable"
      }),
      armed: spotifyState.armed,
      connectionState: spotifyState.connected ? "connected" : spotifyState.armed ? "armed" : "blocked",
      connectedLabel: spotifyState.connectedLabel,
      advertisedLabel: spotifyState.advertisedLabel
    },
    {
      ...buildSourceSummary({
        id: "bluetooth",
        label: "Bluetooth",
        availability: bluetoothState.available ? (bluetoothState.connected ? "available" : "waiting") : "unavailable",
        active: activeSource === "bluetooth",
        controllability: bluetoothState.supported ? "switchable" : "status-only",
        secondaryStatus: bluetoothState.connected
          ? `${bluetoothState.connectedLabel ?? "Bluetooth device"} connected`
          : bluetoothState.armed
            ? bluetoothState.advertisedLabel
              ? `Pairing is open as ${bluetoothState.advertisedLabel}`
              : "Pairing is open for this source"
            : bluetoothState.supported
              ? bluetoothState.advertisedLabel
                ? `Closed until you open pairing as ${bluetoothState.advertisedLabel}`
                : "Closed until you open pairing"
              : "Bluetooth gating unavailable"
      }),
      armed: bluetoothState.armed,
      connectionState: bluetoothState.connected ? "connected" : bluetoothState.armed ? "armed" : "blocked",
      connectedLabel: bluetoothState.connectedLabel,
      advertisedLabel: bluetoothState.advertisedLabel
    },
    {
      ...buildSourceSummary({
        id: "airplay",
        label: "AirPlay",
        availability: airplayState.available ? (airplayState.connected ? "available" : "waiting") : "unavailable",
        active: activeSource === "airplay",
        controllability: airplayState.supported ? "switchable" : "status-only",
        secondaryStatus: airplayState.connected
          ? `${airplayState.connectedLabel ?? "AirPlay session"} connected`
          : airplayState.armed
            ? airplayState.advertisedLabel
              ? `AirPlay is open as ${airplayState.advertisedLabel}`
              : "AirPlay is open for this source"
            : airplayState.supported
              ? airplayState.advertisedLabel
                ? `Closed until you open AirPlay as ${airplayState.advertisedLabel}`
                : "Closed until you open AirPlay"
              : "AirPlay gating unavailable"
      }),
      armed: airplayState.armed,
      connectionState: airplayState.connected ? "connected" : airplayState.armed ? "armed" : "blocked",
      connectedLabel: airplayState.connectedLabel,
      advertisedLabel: airplayState.advertisedLabel
    },
    {
      ...buildSourceSummary({
        id: "upnp",
        label: "DLNA",
        availability: upnpState.available ? (upnpState.connected ? "available" : "waiting") : "unavailable",
        active: activeSource === "upnp",
        controllability: upnpState.supported ? "switchable" : "status-only",
        secondaryStatus: upnpState.connected
          ? `${upnpState.connectedLabel ?? "DLNA session"} connected`
          : upnpState.armed
            ? upnpState.advertisedLabel
              ? `DLNA is open as ${upnpState.advertisedLabel}`
              : "DLNA is open for this source"
            : upnpState.supported
              ? upnpState.advertisedLabel
                ? `Closed until you open DLNA as ${upnpState.advertisedLabel}`
                : "Closed until you open DLNA"
              : "DLNA gating unavailable"
      }),
      armed: upnpState.armed,
      connectionState: upnpState.connected ? "connected" : upnpState.armed ? "armed" : "blocked",
      connectedLabel: upnpState.connectedLabel,
      advertisedLabel: upnpState.advertisedLabel
    }
  ];

  const preferredCurrentSource = armedSource && (armedSource === "scene" || armedSource === "audio" || armedSource === "spotify" || armedSource === "bluetooth" || armedSource === "airplay" || armedSource === "upnp")
    ? sources.find((source) => source.id === armedSource)
    : null;

  return {
    currentSource:
      preferredCurrentSource
      ?? sources.find((source) => source.active)
      ?? sources.find((source) => source.id === armedSource)
      ?? sources[0],
    sources
  };
}

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

  if (mockActiveSource === "scene") {
    lastTickAt = now;
    return;
  }

  if (mockActiveSource === "mpd" && mockSelectedLocalTrack) {
    const durationSeconds = mockSelectedLocalTrack.durationSeconds;
    if (durationSeconds && elapsedSeconds >= durationSeconds) {
      if (playMode === "repeat_one") {
        elapsedSeconds %= durationSeconds;
      } else if (mockLocalQueueTracks.length > 1 && mockLocalQueueIndex < mockLocalQueueTracks.length - 1) {
        mockLocalQueueIndex += 1;
        mockSelectedLocalTrack = mockLocalQueueTracks[mockLocalQueueIndex] ?? null;
        elapsedSeconds = 0;
      } else {
        elapsedSeconds = durationSeconds;
        playbackState = "stopped";
      }
    }
    return;
  }

  while (elapsedSeconds >= tracks[trackIndex].durationSeconds) {
    elapsedSeconds -= tracks[trackIndex].durationSeconds;
    if (playMode !== "repeat_one") {
      trackIndex = playMode === "shuffle" ? randomMockTrackIndex(trackIndex) : (trackIndex + 1) % tracks.length;
    }
  }
}

function getPlayback() {
  syncElapsed();
  const musicState = readMusicLibraryStateSync();
  const mockSpotifyConnected = mockActiveSource === "spotify" && Date.now() - mockSpotifyArmedAt >= MOCK_SPOTIFY_CONNECT_AFTER_MS;
  const mockBluetoothConnected = mockActiveSource === "bluetooth" && Date.now() - mockBluetoothArmedAt >= MOCK_BLUETOOTH_CONNECT_AFTER_MS;
  const mockAirplayConnected = mockActiveSource === "airplay" && Date.now() - mockAirplayArmedAt >= MOCK_AIRPLAY_CONNECT_AFTER_MS;
  const mockUpnpConnected = mockActiveSource === "upnp" && Date.now() - mockUpnpArmedAt >= MOCK_UPNP_CONNECT_AFTER_MS;
  const mockBluetoothMetadata = mockBluetoothConnected ? readMockBluetoothPlaybackMetadata() : null;

  if (mockActiveSource === "scene") {
    return {
      state: scenePlaybackState,
      source: "scene",
      albumArtUrl: null,
      title: "Scene Audio",
      artist: currentSceneVideo.label,
      album: currentSceneVideo.label,
      elapsedSeconds: null,
      durationSeconds: null,
      currentTrackIndex: 0,
      queueLength: 0,
      favorite: false,
      settings: getPlaybackSettings(),
      queuePreview: []
    };
  }

  if (mockActiveSource === "audio") {
    const track = tracks[trackIndex];
    return {
      state: playbackState,
      source: "audio",
      albumArtUrl: null,
      title: track.title,
      artist: track.artist,
      album: track.album,
      elapsedSeconds,
      durationSeconds: track.durationSeconds,
      currentTrackIndex: trackIndex + 1,
      queueLength: 13,
      favorite: false,
      settings: getPlaybackSettings(),
      queuePreview: buildMockQueuePreview()
    };
  }

  if (mockActiveSource === "spotify") {
    return {
      state: mockSpotifyConnected ? "playing" : "stopped",
      source: "spotify",
      albumArtUrl: null,
      title: mockSpotifyConnected ? "Spotify Connect Ready" : "Spotify Connect Waiting",
      artist: mockSpotifyConnected ? "Tikpal Speaker" : "Choose Tikpal Speaker in Spotify",
      album: "Spotify Connect",
      elapsedSeconds: null,
      durationSeconds: null,
      currentTrackIndex: 0,
      queueLength: 0,
      favorite: false,
      settings: getPlaybackSettings(),
      queuePreview: []
    };
  }

  if (mockActiveSource === "bluetooth") {
    return {
      state: playbackState === "stopped" ? "paused" : playbackState,
      source: "bluetooth",
      albumArtUrl: null,
      title: mockBluetoothConnected ? mockBluetoothMetadata?.title ?? null : "Bluetooth Pairing",
      artist: mockBluetoothConnected ? mockBluetoothMetadata?.artist || "Tikpal Demo Phone" : "Waiting for Bluetooth audio",
      album: mockBluetoothMetadata?.album || "Bluetooth Source",
      elapsedSeconds: millisecondsToSeconds(mockBluetoothMetadata?.positionMs),
      durationSeconds: millisecondsToSeconds(mockBluetoothMetadata?.durationMs, { allowZero: false }),
      currentTrackIndex: 0,
      queueLength: 0,
      favorite: false,
      settings: getPlaybackSettings(),
      queuePreview: []
    };
  }

  if (mockActiveSource === "airplay") {
    return {
      state: playbackState === "stopped" ? "paused" : playbackState,
      source: "airplay",
      albumArtUrl: null,
      title: mockAirplayConnected ? "AirPlay Ready" : "AirPlay Waiting",
      artist: mockAirplayConnected ? "Living Room iPhone" : "Waiting for AirPlay audio",
      album: "AirPlay Source",
      elapsedSeconds: null,
      durationSeconds: null,
      currentTrackIndex: 0,
      queueLength: 0,
      favorite: false,
      settings: getPlaybackSettings(),
      queuePreview: []
    };
  }

  if (mockActiveSource === "upnp") {
    return {
      state: playbackState === "stopped" ? "paused" : playbackState,
      source: "upnp",
      albumArtUrl: null,
      title: mockUpnpConnected ? "DLNA Ready" : "DLNA Waiting",
      artist: mockUpnpConnected ? "Tikpal Speaker" : "Waiting for DLNA audio",
      album: "DLNA Source",
      elapsedSeconds: null,
      durationSeconds: null,
      currentTrackIndex: 0,
      queueLength: 0,
      favorite: false,
      settings: getPlaybackSettings(),
      queuePreview: []
    };
  }

  if (mockActiveSource === "radio") {
    const activeRadio = getMockRadioStations().find((station) => station.id === mockActiveRadioStationId) ?? getMockRadioStations()[0];
    return {
      state: "playing",
      source: "radio",
      albumArtUrl: null,
      title: activeRadio?.label ?? RADIO_LABEL,
      artist: "Internet Radio",
      album: "Radio",
      elapsedSeconds: null,
      durationSeconds: null,
      currentTrackIndex: 1,
      queueLength: 1,
      favorite: false,
      settings: getPlaybackSettings(),
      queuePreview: [
        buildQueueEntrySummary({
          id: activeRadio?.id ?? "radio-active",
          position: 1,
          title: activeRadio?.label ?? RADIO_LABEL,
          artist: "Internet Radio",
          album: "Radio",
          durationSeconds: null,
          active: true
        })
      ]
    };
  }

  if (mockSelectedLocalTrack) {
    const queueLength = mockLocalQueueTracks.length || 1;
    return {
      state: playbackState,
      source: "mpd",
      albumArtUrl: mockSelectedLocalTrack.albumArtUrl,
      title: mockSelectedLocalTrack.title,
      artist: mockSelectedLocalTrack.artist,
      album: mockSelectedLocalTrack.album,
      elapsedSeconds,
      durationSeconds: mockSelectedLocalTrack.durationSeconds,
      currentTrackIndex: mockLocalQueueIndex + 1,
      queueLength,
      favorite: isFavoriteTrackPath(mockSelectedLocalTrack.path, musicState),
      settings: getPlaybackSettings(),
      queuePreview: buildMockQueuePreview()
    };
  }

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
    favorite: false,
    settings: getPlaybackSettings(),
    queuePreview: buildMockQueuePreview()
  };
}

function getMockRadioStations() {
  return [
    buildRadioStationSummary({
      id: "radio-1",
      label: "1.FM - Blues Radio",
      uri: "http://strm112.1.fm/blues_mobile_mp3",
      genre: "Blues",
      bitrateKbps: 192,
      codec: "MP3",
      secondaryStatus: "Blues · 192 kbps MP3",
      active: mockActiveSource === "radio" && mockActiveRadioStationId === "radio-1"
    }),
    buildRadioStationSummary({
      id: "radio-2",
      label: "A.M. Ambient",
      uri: "http://radio.stereoscenic.com/ama-h",
      genre: "Ambient",
      bitrateKbps: 256,
      codec: "MP3",
      secondaryStatus: "Ambient · 256 kbps MP3",
      active: mockActiveSource === "radio" && mockActiveRadioStationId === "radio-2"
    }),
    buildRadioStationSummary({
      id: "radio-3",
      label: "6forty Radio",
      uri: "http://radio.6forty.com:8000/6forty",
      genre: "Alternative",
      bitrateKbps: 192,
      codec: "MP3",
      secondaryStatus: "Alternative · 192 kbps MP3",
      active: mockActiveSource === "radio" && mockActiveRadioStationId === "radio-3"
    })
  ];
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

async function commandSucceeds(command, options = {}) {
  if (!command.trim()) return false;
  try {
    await runCommand(command, options);
    return true;
  } catch {
    return false;
  }
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function expandHifiEqCommand(command, preset) {
  return command
    .replaceAll("%PRESET%", shellQuote(preset.id))
    .replaceAll("%LABEL%", shellQuote(preset.label))
    .replaceAll("%VISUAL%", shellQuote(preset.hifiVisualPresetId));
}

async function applyHifiEqPreset(presetId) {
  const preset = getHifiEqPreset(presetId);
  if (API_MODE !== "mpc") {
    return;
  }
  if (!HIFI_EQ_APPLY_COMMAND.trim()) {
    throw new Error("TIKPAL_HIFI_EQ_APPLY_COMMAND is required before Hi-Fi EQ can be controlled in mpc mode");
  }
  await runCommand(expandHifiEqCommand(HIFI_EQ_APPLY_COMMAND, preset), { allowFailure: false, timeout: 8000 });
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
  const repeat = /repeat:\s*on/i.test(statusRaw);
  const random = /random:\s*on/i.test(statusRaw);
  const single = /single:\s*on/i.test(statusRaw);
  const scanning = /updating db/i.test(statusRaw);

  return {
    state,
    elapsedSeconds: progressMatch ? parseDuration(progressMatch[1]) : null,
    durationSeconds: progressMatch ? parseDuration(progressMatch[2]) : null,
    currentTrackIndex: queueMatch ? Number(queueMatch[1]) : 0,
    queueLength: queueMatch ? Number(queueMatch[2]) : 0,
    volumePercent: volumeMatch ? Number(volumeMatch[1]) : null,
    settings: {
      playMode: random ? "shuffle" : repeat && single ? "repeat_one" : "sequence"
    },
    scanning
  };
}

let mpcMutationQueue = Promise.resolve();

// Keep multi-command MPD writes from interleaving with startup priming or user actions.
async function withMpcMutationLock(task) {
  const previous = mpcMutationQueue.catch(() => {});
  const next = previous.then(task);
  mpcMutationQueue = next.catch(() => {});
  return await next;
}

function parseOutputVolumePercent(raw) {
  const matches = Array.from(String(raw ?? "").matchAll(/\[(\d{1,3})%\]/g));
  const lastMatch = matches.at(-1);
  if (!lastMatch) return null;
  const percent = Number(lastMatch[1]);
  return Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : null;
}

async function readOutputVolumePercent() {
  if (!OUTPUT_VOLUME_GET_COMMAND.trim()) return null;
  const raw = await runCommand(OUTPUT_VOLUME_GET_COMMAND, { allowFailure: true, timeout: 2500 });
  return parseOutputVolumePercent(raw);
}

async function setOutputVolumePercent(percent) {
  const normalized = Math.max(0, Math.min(100, Math.round(Number(percent))));
  if (!Number.isFinite(normalized)) {
    throw new Error("output volume requires value between 0 and 100");
  }
  if (!OUTPUT_VOLUME_SET_COMMAND.trim()) {
    throw new Error("output volume control is unavailable in this runtime");
  }
  const command = OUTPUT_VOLUME_SET_COMMAND.replace(/%VALUE%/g, String(normalized));
  await runCommand(command, { allowFailure: false, timeout: 2500 });
}

function isStreamUri(value) {
  return /^https?:\/\//i.test(String(value ?? ""));
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

function prettifyStreamLabel(value) {
  return String(value ?? "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function activeRadioStationLabelFromAudio(audio) {
  const currentSource = audio?.currentSource;
  if (currentSource?.id !== "radio") return RADIO_LABEL;
  const secondaryStatus = normalizeMetadataValue(currentSource.secondaryStatus);
  if (secondaryStatus.toLowerCase().endsWith(" active")) {
    return secondaryStatus.slice(0, -7).trim() || RADIO_LABEL;
  }
  return secondaryStatus || currentSource.label || RADIO_LABEL;
}

function splitTrackArtistLabel(rawTitle) {
  const separators = [" - ", " – ", " — "];
  for (const separator of separators) {
    const parts = String(rawTitle).split(separator).map((part) => normalizeMetadataValue(part)).filter(Boolean);
    if (parts.length === 2) {
      return {
        artist: parts[0],
        title: parts[1]
      };
    }
  }
  return null;
}

function normalizeRadioPlaybackMetadata({ title, artist, album, file, audio }) {
  const stationLabel = activeRadioStationLabelFromAudio(audio);
  const rawTitle = normalizeMetadataValue(title) || prettifyStreamLabel(trackTitleFromFile(file)) || stationLabel;
  const rawArtist = normalizeMetadataValue(artist);
  const rawAlbum = normalizeMetadataValue(album);
  const splitLabel = splitTrackArtistLabel(rawTitle);

  if (splitLabel && (!rawArtist || rawArtist === "Unknown Artist" || rawArtist === "Internet Radio")) {
    return {
      title: splitLabel.title,
      artist: splitLabel.artist,
      album: rawAlbum || stationLabel || "Radio",
      trustedForLyrics: true
    };
  }

  const trustedForLyrics = Boolean(rawTitle)
    && rawTitle !== stationLabel
    && !rawTitle.toLowerCase().includes("radio")
    && rawArtist
    && rawArtist !== "Unknown Artist"
    && rawArtist !== "Internet Radio";

  if (trustedForLyrics) {
    return {
      title: rawTitle,
      artist: rawArtist,
      album: rawAlbum || stationLabel || "Radio",
      trustedForLyrics: true
    };
  }

  return {
    title: stationLabel || rawTitle || RADIO_LABEL,
    artist: "Internet Radio",
    album: rawAlbum || stationLabel || "Radio",
    trustedForLyrics: false
  };
}

function parseKeyValueMetadata(raw) {
  const metadata = {};
  for (const line of String(raw ?? "").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*)=(.*)$/);
    if (!match) continue;
    metadata[match[1].toLowerCase()] = normalizeMetadataValue(match[2]);
  }
  return metadata;
}

function readMetadataNumber(metadata, keys) {
  for (const key of keys) {
    const value = Number(metadata[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function parsePlaybackTimingDiagnostics(metadata) {
  const diagnostics = {
    metadataMtimeMs: readMetadataNumber(metadata, ["metadatamtimems", "metadataMtimeMs", "metadata_mtime_ms"]),
    airplayStartedAtMs: readMetadataNumber(metadata, ["airplaystartedatms", "airplayStartedAtMs", "airplay_started_at_ms"]),
    airplayStoppedAtMs: readMetadataNumber(metadata, ["airplaystoppedatms", "airplayStoppedAtMs", "airplay_stopped_at_ms"]),
    clockStartMs: readMetadataNumber(metadata, ["clockstartms", "clockStartMs", "clock_start_ms"]),
    clockLeadMs: readMetadataNumber(metadata, ["clockleadms", "clockLeadMs", "clock_lead_ms"]),
    effectiveClockStartMs: readMetadataNumber(metadata, ["effectiveclockstartms", "effectiveClockStartMs", "effective_clock_start_ms"]),
    clockStartReason: normalizeMetadataValue(metadata.clockstartreason ?? metadata.clockStartReason ?? metadata.clock_start_reason) || null
  };

  const hasTimingValue = Object.entries(diagnostics).some(([key, value]) => (
    key === "clockStartReason" ? Boolean(value) : Number.isFinite(value)
  ));
  return hasTimingValue ? diagnostics : null;
}

function metadataArtworkUrl(metadata) {
  const artworkMtimeMs = readMetadataNumber(metadata, ["artworkmtimems", "artworkMtimeMs", "artwork_mtime_ms"]);
  const artworkVersion = Number.isFinite(artworkMtimeMs) && artworkMtimeMs > 0
    ? `&v=${encodeURIComponent(String(Math.round(artworkMtimeMs)))}`
    : "";
  const artworkPath = normalizeMetadataValue(metadata.artworkpath ?? metadata.artworkPath ?? metadata.artwork_path);
  if (artworkPath) {
    return `/api/v1/media/airplay-artwork?path=${encodeURIComponent(artworkPath)}${artworkVersion}`;
  }

  const artworkUrl = normalizeMetadataValue(
    metadata.artworkurl
      ?? metadata.artworkUrl
      ?? metadata.artwork_url
      ?? metadata.albumarturl
      ?? metadata.albumArtUrl
      ?? metadata.album_art_url
  );
  if (!artworkUrl) return null;
  if (artworkUrl.startsWith("file:///var/local/www/imagesw/airplay-covers/")) {
    return `/api/v1/media/airplay-artwork?path=${encodeURIComponent(artworkUrl.slice("file://".length))}${artworkVersion}`;
  }
  return artworkUrl;
}

function parseBluetoothMetadataOutput(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return null;

  let parsed = null;
  if (value.startsWith("{")) {
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = null;
    }
  }

  const metadata = parsed && typeof parsed === "object" ? parsed : parseKeyValueMetadata(value);
  const title = normalizeMetadataValue(metadata.title ?? metadata.track ?? metadata.name);
  if (!title) return null;
  const positionMs = Number(metadata.positionms ?? metadata.position_ms ?? metadata.position);
  const durationMs = Number(metadata.durationms ?? metadata.duration_ms ?? metadata.duration);
  const status = normalizeMetadataValue(metadata.status).toLowerCase();

  return {
    title,
    artist: normalizeMetadataValue(metadata.artist ?? metadata.artists) || null,
    album: normalizeMetadataValue(metadata.album) || null,
    status: status || null,
    positionMs: Number.isFinite(positionMs) ? positionMs : null,
    durationMs: Number.isFinite(durationMs) ? durationMs : null,
    artworkUrl: metadataArtworkUrl(metadata),
    timingDiagnostics: parsePlaybackTimingDiagnostics(metadata)
  };
}

async function readBluetoothPlaybackMetadata() {
  if (!BLUETOOTH_METADATA_COMMAND.trim()) return null;
  const raw = await runCommand(BLUETOOTH_METADATA_COMMAND, { allowFailure: true, timeout: 3500 });
  return parseBluetoothMetadataOutput(raw);
}

async function readAirplayPlaybackMetadata() {
  if (!AIRPLAY_METADATA_COMMAND.trim()) return null;
  const raw = await runCommand(AIRPLAY_METADATA_COMMAND, { allowFailure: true, timeout: 3500 });
  return parseBluetoothMetadataOutput(raw);
}

function readMockBluetoothPlaybackMetadata() {
  if (MOCK_BLUETOOTH_METADATA_FILE.trim()) {
    try {
      return parseBluetoothMetadataOutput(readFileSync(MOCK_BLUETOOTH_METADATA_FILE, "utf8"));
    } catch {
      return null;
    }
  }
  return parseBluetoothMetadataOutput(MOCK_BLUETOOTH_METADATA);
}

function mapBluetoothPlaybackState(metadata) {
  switch (metadata?.status) {
    case "playing":
      return "playing";
    case "paused":
      return "paused";
    case "stopped":
      return "stopped";
    default:
      return metadata ? "playing" : "paused";
  }
}

function millisecondsToSeconds(value, { allowZero = true } = {}) {
  if (!Number.isFinite(value) || value < 0 || value >= 4_294_000_000) return null;
  if (!allowZero && value === 0) return null;
  return Math.max(0, Math.round(value) / 1000);
}

function albumLabelFromFile(file) {
  if (!file) return "MPD Queue";
  const parent = basename(dirname(file));
  return parent && parent !== "." ? parent : "MPD Queue";
}

function resolveMpdFilePath(file) {
  if (!file) return null;
  const normalized = posix.normalize(String(file)).replace(/^\/+/, "");
  if (!normalized || normalized === ".." || normalized.startsWith("../")) {
    return null;
  }

  const root = resolve(MPD_MUSIC_ROOT);
  const absolutePath = resolve(root, normalized);
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${sep}`)) {
    return null;
  }

  return absolutePath;
}

function detectArtworkMimeType(stream) {
  const mimeType = stream?.tags?.mimetype;
  if (mimeType?.startsWith("image/")) return mimeType;

  switch (stream?.codec_name) {
    case "mjpeg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    default:
      return null;
  }
}

function buildArtworkToken(filePath, mtimeMs) {
  return createHash("sha1")
    .update(`${filePath}:${mtimeMs}`)
    .digest("hex");
}

async function readMediaMetadata(file) {
  const absolutePath = resolveMpdFilePath(file);
  if (!absolutePath) {
    return {
      title: trackTitleFromFile(file),
      artist: "Unknown Artist",
      album: albumLabelFromFile(file),
      artworkMimeType: null,
      artworkToken: null,
      absolutePath: null
    };
  }

  let fileStat;
  try {
    fileStat = await stat(absolutePath);
  } catch {
    return {
      title: trackTitleFromFile(file),
      artist: "Unknown Artist",
      album: albumLabelFromFile(file),
      artworkMimeType: null,
      artworkToken: null,
      absolutePath: null
    };
  }

  const cached = mediaMetadataCache.get(absolutePath);
  if (cached?.mtimeMs === fileStat.mtimeMs) {
    return cached.metadata;
  }

  let probe = {};
  try {
    const { stdout } = await execFileAsync(
      FFPROBE_BIN,
      [
        "-v",
        "error",
        "-show_entries",
        "format_tags=title,artist,album:stream=codec_name,codec_type,disposition:stream_tags=mimetype",
        "-of",
        "json",
        absolutePath
      ],
      {
        timeout: 3500,
        maxBuffer: 1024 * 512
      }
    );
    probe = JSON.parse(stdout);
  } catch {
    probe = {};
  }

  const tags = probe?.format?.tags ?? {};
  const artworkStream = Array.isArray(probe?.streams)
    ? probe.streams.find((stream) => stream?.codec_type === "video" && (stream?.disposition?.attached_pic === 1 || Boolean(detectArtworkMimeType(stream))))
    : null;

  const metadata = {
    title: tags.title?.trim() || trackTitleFromFile(file),
    artist: tags.artist?.trim() || "Unknown Artist",
    album: tags.album?.trim() || albumLabelFromFile(file),
    artworkMimeType: detectArtworkMimeType(artworkStream),
    artworkToken: artworkStream ? buildArtworkToken(absolutePath, fileStat.mtimeMs) : null,
    absolutePath
  };

  mediaMetadataCache.set(absolutePath, {
    mtimeMs: fileStat.mtimeMs,
    metadata
  });
  return metadata;
}

async function readArtworkBuffer(filePath) {
  try {
    const { stdout } = await execFileAsync(
      FFMPEG_BIN,
      ["-v", "error", "-i", filePath, "-map", "0:v:0", "-c", "copy", "-f", "image2pipe", "-"],
      {
        encoding: "buffer",
        timeout: 5000,
        maxBuffer: 1024 * 1024 * 8
      }
    );
    return stdout.length > 0 ? stdout : null;
  } catch {
    return null;
  }
}

async function resolveExistingImagePath(absolutePath) {
  const mimeType = imageMimeTypeFromPath(absolutePath);
  if (!mimeType) return null;

  try {
    const info = await stat(absolutePath);
    if (!info.isFile()) return null;
    return {
      absolutePath,
      mimeType,
      token: buildArtworkToken(absolutePath, info.mtimeMs)
    };
  } catch {
    return null;
  }
}

async function resolveFolderArtworkForMedia(filePath) {
  if (!filePath) return null;

  const candidates = [];
  const mediaDir = dirname(filePath);
  const baseName = basename(filePath, extname(filePath));
  for (const extension of LOCAL_LIBRARY_COVER_EXTENSIONS) {
    candidates.push(resolve(mediaDir, `${baseName}${extension}`));
  }
  for (const extension of LOCAL_LIBRARY_COVER_EXTENSIONS) {
    candidates.push(resolve(mediaDir, `folder${extension}`));
  }
  for (const extension of LOCAL_LIBRARY_COVER_EXTENSIONS) {
    candidates.push(resolve(dirname(mediaDir), `folder${extension}`));
  }

  for (const candidate of candidates) {
    const artwork = await resolveExistingImagePath(candidate);
    if (artwork) return artwork;
  }

  return null;
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
  const experience = await readRoomExperienceState();
  return buildDspState(experience, {
    enabled,
    controllable: Boolean(HIFI_EQ_APPLY_COMMAND.trim()),
    controlTransport: HIFI_EQ_APPLY_COMMAND.trim() ? "command" : "unavailable"
  });
}

function ddcutilArgs(args) {
  return DDCUTIL_DISPLAY ? ["--display", DDCUTIL_DISPLAY, ...args] : args;
}

function buildUnavailableDisplayBrightnessSnapshot() {
  return {
    brightnessPercent: system.display.brightnessPercent,
    controllable: false,
    transport: "unavailable"
  };
}

function parseDisplayBrightnessSnapshot(raw) {
  const current = raw.match(/current value =\s*(\d+)/i)?.[1] ?? raw.match(/^VCP\s+10\s+\S+\s+(\d+)\s+(\d+)/i)?.[1];
  const max = raw.match(/max value =\s*(\d+)/i)?.[1] ?? raw.match(/^VCP\s+10\s+\S+\s+(\d+)\s+(\d+)/i)?.[2];

  if (!current || !max) {
    return buildUnavailableDisplayBrightnessSnapshot();
  }

  const currentNumber = Number(current);
  const maxNumber = Number(max);
  if (!Number.isFinite(currentNumber) || !Number.isFinite(maxNumber) || maxNumber <= 0) {
    return buildUnavailableDisplayBrightnessSnapshot();
  }

  return {
    brightnessPercent: clampPercent((currentNumber / maxNumber) * 100, system.display.brightnessPercent),
    controllable: true,
    transport: "ddcci"
  };
}

async function refreshDisplayBrightnessSnapshot() {
  const raw = await runCommand(
    `${DDCUTIL_BIN} ${ddcutilArgs(["getvcp", "10", "--brief"]).join(" ")}`,
    { allowFailure: true, timeout: DDCUTIL_READ_TIMEOUT_MS }
  );
  const snapshot = parseDisplayBrightnessSnapshot(raw);
  displayBrightnessSnapshotCache = { value: snapshot, updatedAtMs: Date.now() };
  system.display = snapshot;
  return snapshot;
}

function scheduleDisplayBrightnessRefresh() {
  if (!displayBrightnessRefreshPromise) {
    displayBrightnessRefreshPromise = refreshDisplayBrightnessSnapshot()
      .catch(() => buildUnavailableDisplayBrightnessSnapshot())
      .finally(() => {
        displayBrightnessRefreshPromise = null;
      });
  }
  return displayBrightnessRefreshPromise;
}

async function readDisplayBrightnessSnapshot() {
  const now = Date.now();
  if (displayBrightnessSnapshotCache && now - displayBrightnessSnapshotCache.updatedAtMs < DDCUTIL_READ_CACHE_MS) {
    return displayBrightnessSnapshotCache.value;
  }

  void scheduleDisplayBrightnessRefresh();
  return displayBrightnessSnapshotCache?.value ?? system.display;
}

async function setDisplayBrightnessPercent(percent) {
  const nextPercent = clampPercent(percent, system.display.brightnessPercent);

  if (API_MODE !== "mpc") {
    system.display.brightnessPercent = nextPercent;
    system.display.controllable = true;
    system.display.transport = "mock";
    return;
  }

  const command = `${DDCUTIL_BIN} ${ddcutilArgs(["setvcp", "10", String(nextPercent)]).join(" ")}`;
  await runCommand(command, { allowFailure: false, timeout: 5000 });
  displayBrightnessSnapshotCache = {
    value: {
      brightnessPercent: nextPercent,
      controllable: true,
      transport: "ddcci"
    },
    updatedAtMs: Date.now()
  };
  system.display = displayBrightnessSnapshotCache.value;
}

function buildRuntimeSnapshot(kioskWindow = REQUESTED_KIOSK_WINDOW) {
  return {
    rendererType: REQUESTED_RENDERER === "webgl" ? "webgl" : "media",
    requestedRenderer: REQUESTED_RENDERER,
    kioskWindow,
    appVersion: APP_VERSION,
    apiMode: API_MODE,
    updatedAt: new Date().toISOString()
  };
}

function getCachedRuntimeSnapshot() {
  return tikpalStateSnapshotCache?.state?.runtime ?? buildRuntimeSnapshot();
}

async function getRuntimeSnapshot() {
  const xrandrRaw = await runCommand("xrandr --query", { allowFailure: true });
  const currentMatch = xrandrRaw.match(/current\s+(\d+)\s+x\s+(\d+)/i);
  const kioskWindow = currentMatch ? `${currentMatch[1]}x${currentMatch[2]}` : REQUESTED_KIOSK_WINDOW;
  return buildRuntimeSnapshot(kioskWindow);
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
  const [network, display, outputDevice, dspState, cpuTemp, uptime] = await Promise.all([
    getNetworkSnapshot(),
    readDisplayBrightnessSnapshot(),
    getOutputDeviceSnapshot(),
    getDspSnapshot(),
    getCpuTempSnapshot(),
    getUptimeSnapshot()
  ]);

  const scanRecentlyRequested = Date.now() - lastSystemLibraryScanRequestedAt < 15000;

  return {
    ...system,
    network,
    display,
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

function getCachedMpcSystemSnapshot(statusRaw, statsRaw) {
  const cachedSystem = tikpalStateSnapshotCache?.state?.system ?? system;
  const status = parseMpcStatus(statusRaw);
  const stats = parseMpcStats(statsRaw);
  const scanRecentlyRequested = Date.now() - lastSystemLibraryScanRequestedAt < 15000;

  return {
    ...cachedSystem,
    library: {
      ...cachedSystem.library,
      source: "MPD",
      trackCount: stats.trackCount,
      lastScan: stats.lastScan,
      scanning: status.scanning || scanRecentlyRequested
    }
  };
}

async function readMpcRadioStations() {
  const query = "SELECT id, name, station, genre, bitrate, format FROM cfg_radio ORDER BY id LIMIT " + (Number.isFinite(RADIO_PRESET_LIMIT) && RADIO_PRESET_LIMIT > 0 ? Math.round(RADIO_PRESET_LIMIT) : 8);
  const raw = await runCommand(`sqlite3 -separator '|' /var/local/www/db/moode-sqlite3.db "${query}"`, { allowFailure: true });
  if (!raw) {
    return [];
  }

  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [id, name, station, genre, bitrate, format] = line.split("|");
      const bits = [];
      if (genre) bits.push(genre);
      if (bitrate) bits.push(`${bitrate} kbps`);
      if (format) bits.push(format);
      return buildRadioStationSummary({
        id: `radio-${id}`,
        label: name || `Radio ${id}`,
        uri: station,
        genre: genre || "Unknown",
        bitrateKbps: Number.isFinite(Number(bitrate)) ? Number(bitrate) : null,
        codec: format || null,
        secondaryStatus: bits.join(" · ") || "Radio preset",
        active: false
      });
    });
}

function fallbackRadioStations() {
  return RADIO_DEFAULT_URI
    ? [
        buildRadioStationSummary({
          id: "radio-default",
          label: RADIO_LABEL,
          uri: RADIO_DEFAULT_URI,
          genre: "Unknown",
          bitrateKbps: null,
          codec: null,
          secondaryStatus: "Fallback preset",
          active: false
        })
      ]
    : [];
}

async function getAvailableRadioStations() {
  if (API_MODE !== "mpc") {
    return getMockRadioStations();
  }

  const radioStations = await readMpcRadioStations();
  return radioStations.length > 0 ? radioStations : fallbackRadioStations();
}

function normalizeRadioFilters(searchParams) {
  const q = (searchParams.get("q") ?? "").trim();
  const genre = (searchParams.get("genre") ?? "").trim();
  const bitrate = (searchParams.get("bitrate") ?? "").trim();
  const limitRaw = Number(searchParams.get("limit") ?? 120);
  const offsetRaw = Number(searchParams.get("offset") ?? 0);

  if (!Number.isFinite(limitRaw) || limitRaw <= 0 || limitRaw > 250) {
    throw new Error("limit must be between 1 and 250");
  }

  if (!Number.isFinite(offsetRaw) || offsetRaw < 0) {
    throw new Error("offset must be a non-negative number");
  }

  return {
    q,
    genre,
    bitrate,
    limit: Math.round(limitRaw),
    offset: Math.round(offsetRaw)
  };
}

function filterRadioStations(stations, filters) {
  return stations.filter((station) => {
    if (filters.q) {
      const haystack = `${station.label} ${station.secondaryStatus} ${station.genre}`.toLowerCase();
      if (!haystack.includes(filters.q.toLowerCase())) return false;
    }

    if (filters.genre && station.genre !== filters.genre) {
      return false;
    }

    if (filters.bitrate) {
      const stationBitrate = station.bitrateKbps === null ? "" : `${station.bitrateKbps} kbps`;
      if (stationBitrate !== filters.bitrate) return false;
    }

    return true;
  });
}

async function getRadioCatalogPayload(searchParams) {
  const filters = normalizeRadioFilters(searchParams);
  const stations = await getAvailableRadioStations();
  const genres = Array.from(new Set(stations.map((station) => station.genre).filter(Boolean))).sort((left, right) => left.localeCompare(right));
  const bitrates = Array.from(
    new Set(
      stations
        .map((station) => (station.bitrateKbps === null ? "" : `${station.bitrateKbps} kbps`))
        .filter(Boolean)
    )
  ).sort((left, right) => Number.parseInt(left, 10) - Number.parseInt(right, 10));
  const filtered = filterRadioStations(stations, filters);
  const paged = filtered.slice(filters.offset, filters.offset + filters.limit);

  return {
    stations: paged,
    total: filtered.length,
    genres,
    bitrates,
    filters,
    updatedAt: new Date().toISOString()
  };
}

function normalizeLibraryCategoryId(label) {
  const normalized = String(label ?? "").trim().toLowerCase();
  if (normalized === "focus") return "focus";
  if (normalized === "meditation") return "meditation";
  if (normalized === "rest") return "rest";
  return null;
}

function libraryCategoryLabel(categoryId) {
  switch (categoryId) {
    case "focus":
      return "Focus";
    case "meditation":
      return "Meditation";
    case "rest":
      return "Rest";
    default:
      return "Library";
  }
}

const LOCAL_LIBRARY_SUBCATEGORY_ORDER = {
  focus: [
    "Lo-fi / Ambient",
    "Classical / Piano",
    "Binaural / Alpha / Theta",
    "White Noise / Brown Noise"
  ],
  meditation: [
    "Guided Meditation",
    "Breathing",
    "Singing Bowl",
    "Nature Sounds"
  ],
  rest: [
    "Nap",
    "Sleep",
    "Rain / Ocean / Forest",
    "Deep Sleep Long Tracks"
  ]
};

function localLibrarySubCategoryOrder(categoryId, label) {
  const order = LOCAL_LIBRARY_SUBCATEGORY_ORDER[categoryId] ?? [];
  const index = order.indexOf(label);
  return index === -1 ? order.length : index;
}

function readJsonRowsFromText(text, label) {
  const parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
  if (!Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON array`);
  }
  return parsed.filter((row) => row && typeof row === "object" && !Array.isArray(row));
}

function normalizeSafeRelativePath(value) {
  const normalized = posix.normalize(String(value ?? "").trim().replaceAll("\\", "/")).replace(/^\/+/, "");
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) return null;
  return normalized;
}

function normalizeLocalLibraryStateTrackPath(value) {
  const safePath = normalizeSafeRelativePath(value);
  if (!safePath) return null;

  const mpdPrefix = normalizeSafeRelativePath(MPD_DEFAULT_QUEUE_PATH);
  if (mpdPrefix && safePath.startsWith(`${mpdPrefix}/`)) {
    return safePath.slice(mpdPrefix.length + 1);
  }

  return safePath;
}

function emptyMusicLibraryState() {
  return {
    version: 2,
    favorites: { trackPaths: [] },
    playlists: []
  };
}

function uniqueSafeTrackPaths(values = []) {
  const paths = [];
  const seen = new Set();
  for (const value of values) {
    const safePath = normalizeLocalLibraryStateTrackPath(value);
    if (!safePath || seen.has(safePath)) continue;
    seen.add(safePath);
    paths.push(safePath);
  }
  return paths;
}

function normalizePlaylistMoodTags(values = []) {
  const tags = [];
  const seen = new Set();
  const sourceValues = Array.isArray(values) ? values : [];
  for (const value of sourceValues) {
    const tag = String(value ?? "").trim();
    const knownTag = Array.from(PLAYLIST_MOOD_TAGS).find((candidate) => candidate.toLowerCase() === tag.toLowerCase());
    if (!knownTag || seen.has(knownTag)) continue;
    seen.add(knownTag);
    tags.push(knownTag);
  }
  return tags.length > 0 ? tags.slice(0, 4) : ["Focus"];
}

function inferPlaylistMoodTags(name, tracks = []) {
  const text = [
    name,
    ...tracks.flatMap((track) => [track?.categoryId, track?.subCategory, track?.album])
  ].filter(Boolean).join(" ").toLowerCase();

  const tags = [];
  if (text.includes("sleep") || text.includes("rest") || text.includes("nap")) tags.push("Sleep");
  if (text.includes("meditation") || text.includes("breath") || text.includes("bowl")) tags.push("Meditation");
  if (text.includes("rain") || text.includes("ocean") || text.includes("forest") || text.includes("calm")) tags.push("Calm");
  if (text.includes("fireplace") || text.includes("fire") || text.includes("warm")) tags.push("Fireplace");
  if (text.includes("morning")) tags.push("Morning");
  if (text.includes("flow")) tags.push("Flow");
  if (text.includes("reading")) tags.push("Reading");
  if (text.includes("focus") || text.includes("work") || tags.length === 0) tags.push("Focus");

  return normalizePlaylistMoodTags(tags);
}

function normalizePlaylistCoverType(value) {
  const coverType = String(value ?? "").trim().toLowerCase();
  return PLAYLIST_COVER_TYPES.has(coverType) ? coverType : "gradient";
}

function normalizePlaylistCoverValue(value) {
  const coverValue = String(value ?? "").trim();
  return coverValue ? coverValue.slice(0, 80) : null;
}

function normalizePlaylistDescription(value) {
  const description = String(value ?? "").trim();
  return description ? description.slice(0, 160) : "";
}

function buildDefaultPlaylistCoverValue(name, moodTags = []) {
  const tag = moodTags[0] ?? "Focus";
  return `${tag.toLowerCase()}-${String(name ?? "playlist").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "mix"}`;
}

function normalizePlaylistMetadata(playlist = {}, fallbackName = "Playlist", fallbackTracks = []) {
  const moodTags = normalizePlaylistMoodTags(
    Array.isArray(playlist.moodTags) && playlist.moodTags.length > 0
      ? playlist.moodTags
      : inferPlaylistMoodTags(fallbackName, fallbackTracks)
  );
  const coverType = normalizePlaylistCoverType(playlist.coverType);
  const coverValue = normalizePlaylistCoverValue(playlist.coverValue) ?? buildDefaultPlaylistCoverValue(fallbackName, moodTags);

  return {
    description: normalizePlaylistDescription(playlist.description),
    moodTags,
    coverType,
    coverValue
  };
}

function normalizeMusicLibraryState(raw) {
  const state = emptyMusicLibraryState();
  const favorites = raw?.favorites?.trackPaths ?? [];
  state.favorites.trackPaths = uniqueSafeTrackPaths(Array.isArray(favorites) ? favorites : []);
  const playlists = Array.isArray(raw?.playlists) ? raw.playlists : [];
  const seenIds = new Set();
  for (const playlist of playlists) {
    const id = String(playlist?.id ?? "").trim();
    const name = String(playlist?.name ?? "").trim();
    if (!id || !name || seenIds.has(id)) continue;
    seenIds.add(id);
    const metadata = normalizePlaylistMetadata(playlist, name);
    state.playlists.push({
      id,
      name,
      description: metadata.description,
      moodTags: metadata.moodTags,
      coverType: metadata.coverType,
      coverValue: metadata.coverValue,
      trackPaths: uniqueSafeTrackPaths(Array.isArray(playlist.trackPaths) ? playlist.trackPaths : []),
      createdAt: String(playlist.createdAt ?? playlist.updatedAt ?? new Date(0).toISOString()),
      updatedAt: String(playlist.updatedAt ?? playlist.createdAt ?? new Date(0).toISOString())
    });
  }
  return state;
}

function readMusicLibraryStateSync() {
  try {
    return normalizeMusicLibraryState(JSON.parse(readFileSync(MUSIC_LIBRARY_STATE_PATH, "utf8")));
  } catch {
    return emptyMusicLibraryState();
  }
}

async function readMusicLibraryState() {
  try {
    return normalizeMusicLibraryState(JSON.parse(await readFile(MUSIC_LIBRARY_STATE_PATH, "utf8")));
  } catch {
    return emptyMusicLibraryState();
  }
}

async function writeMusicLibraryState(state) {
  const normalized = normalizeMusicLibraryState(state);
  await mkdir(dirname(MUSIC_LIBRARY_STATE_PATH), { recursive: true });
  await writeFile(MUSIC_LIBRARY_STATE_PATH, `${JSON.stringify(normalized, null, 2)}\n`);
  return normalized;
}

async function readRoomExperienceState() {
  try {
    return normalizeRoomExperienceState(JSON.parse(await readFile(ROOM_EXPERIENCE_STATE_PATH, "utf8")));
  } catch {
    return buildDefaultRoomExperienceState("calm");
  }
}

async function writeRoomExperienceState(state) {
  const normalized = normalizeRoomExperienceState({
    ...state,
    updatedAt: new Date().toISOString()
  });
  await mkdir(dirname(ROOM_EXPERIENCE_STATE_PATH), { recursive: true });
  await writeFile(ROOM_EXPERIENCE_STATE_PATH, `${JSON.stringify(normalized, null, 2)}\n`);
  return normalized;
}

async function applyBrightnessSafely(percent) {
  try {
    await applySystemAction({ type: "brightness_set", value: percent });
  } catch {
    // Night mode remains visible in state even when the display cannot be controlled.
  }
}

async function stopSceneSourceSafely() {
  try {
    const state = await getTikpalState({ skipExperienceReconcile: true });
    if (state.audio.currentSource.id === "scene") {
      await applySourceSwitch({ target: "mpd" });
    }
  } catch {
    // The browser-side video is muted by state; the next playback refresh will reconcile the source.
  }
}

async function reconcileRoomExperienceState(state) {
  const now = new Date();
  let next = normalizeRoomExperienceState(state);
  let changed = false;
  let shouldStopScene = false;

  if (next.timerEndsAt && new Date(next.timerEndsAt).getTime() <= now.getTime()) {
    shouldStopScene = next.sceneSoundEnabled;
    next = {
      ...next,
      phase: "windDown",
      sceneSoundEnabled: false,
      timerEndsAt: null,
      nightSchedule: {
        ...next.nightSchedule,
        active: true,
        preNightBrightnessPercent: next.nightSchedule.preNightBrightnessPercent ?? system.display.brightnessPercent
      }
    };
    await applyBrightnessSafely(next.nightSchedule.brightnessPercent);
    changed = true;
  }

  const inNightWindow = isWithinNightWindow(now, next.nightSchedule);
  if (next.nightSchedule.enabled && inNightWindow && !next.nightSchedule.active) {
    next = {
      ...next,
      nightSchedule: {
        ...next.nightSchedule,
        active: true,
        preNightBrightnessPercent: system.display.brightnessPercent
      }
    };
    await applyBrightnessSafely(next.nightSchedule.brightnessPercent);
    changed = true;
  } else if ((!next.nightSchedule.enabled || !inNightWindow) && next.nightSchedule.active && next.phase !== "windDown") {
    const restorePercent = next.nightSchedule.preNightBrightnessPercent;
    next = {
      ...next,
      nightSchedule: {
        ...next.nightSchedule,
        active: false,
        preNightBrightnessPercent: null
      }
    };
    if (Number.isFinite(restorePercent)) {
      await applyBrightnessSafely(restorePercent);
    }
    changed = true;
  }

  if (shouldStopScene) {
    await stopSceneSourceSafely();
  }

  return changed ? await writeRoomExperienceState(next) : next;
}

async function getRoomExperienceState() {
  return await reconcileRoomExperienceState(await readRoomExperienceState());
}

function isFavoriteTrackPath(trackPath, state = readMusicLibraryStateSync()) {
  const safePath = normalizeLocalLibraryStateTrackPath(trackPath);
  return Boolean(safePath && state.favorites.trackPaths.includes(safePath));
}

async function setFavoriteTrackPath(trackPath, nextFavorite) {
  const safePath = normalizeLocalLibraryStateTrackPath(trackPath);
  if (!safePath) return await readMusicLibraryState();
  const state = await readMusicLibraryState();
  const current = new Set(state.favorites.trackPaths);
  if (nextFavorite) {
    current.add(safePath);
  } else {
    current.delete(safePath);
  }
  state.favorites.trackPaths = Array.from(current);
  return await writeMusicLibraryState(state);
}

async function toggleFavoriteTrackPath(trackPath) {
  const safePath = normalizeLocalLibraryStateTrackPath(trackPath);
  if (!safePath) return await readMusicLibraryState();
  return await setFavoriteTrackPath(safePath, !isFavoriteTrackPath(safePath));
}

function resolveLocalLibraryAssetPath(relativePath) {
  const safePath = normalizeSafeRelativePath(relativePath);
  if (!safePath) return null;

  const root = resolve(LOCAL_LIBRARY_ROOT);
  const absolutePath = resolve(root, ...safePath.split("/"));
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${sep}`)) return null;

  return {
    relativePath: safePath,
    absolutePath
  };
}

function imageMimeTypeFromPath(filePath) {
  switch (extname(filePath).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    default:
      return null;
  }
}

async function resolveExistingLocalLibraryImage(relativePath) {
  const asset = resolveLocalLibraryAssetPath(relativePath);
  if (!asset) return null;

  const mimeType = imageMimeTypeFromPath(asset.absolutePath);
  if (!mimeType) return null;

  try {
    const info = await stat(asset.absolutePath);
    if (!info.isFile()) return null;
    return {
      ...asset,
      mimeType,
      token: buildArtworkToken(asset.absolutePath, info.mtimeMs)
    };
  } catch {
    return null;
  }
}

async function resolveExistingAirplayArtwork(rawPath) {
  const value = normalizeMetadataValue(rawPath);
  if (!value) return null;

  const absolutePath = resolve(value.startsWith("/imagesw/airplay-covers/")
    ? resolve("/var/local/www", value.replace(/^\/+/, ""))
    : value);
  if (absolutePath !== AIRPLAY_ARTWORK_ROOT && !absolutePath.startsWith(`${AIRPLAY_ARTWORK_ROOT}${sep}`)) {
    return null;
  }

  const mimeType = imageMimeTypeFromPath(absolutePath);
  if (!mimeType) return null;

  try {
    const info = await stat(absolutePath);
    if (!info.isFile()) return null;
    return {
      absolutePath,
      mimeType
    };
  } catch {
    return null;
  }
}

function localLibraryImageUrl(relativePath) {
  return `/api/v1/media/library-cover?path=${encodeURIComponent(relativePath)}`;
}

function encodeAssetRelativePath(relativePath) {
  return relativePath.split("/").map((part) => encodeURIComponent(part)).join("/");
}

function ambientVideoOrder(video) {
  if (Number.isFinite(video.order)) return video.order;
  const preferredIndex = PREFERRED_AMBIENT_BACKGROUND_VIDEOS.indexOf(video.filename);
  return preferredIndex === -1 ? null : preferredIndex;
}

function sortAmbientBackgroundVideos(first, second) {
  const firstOrder = ambientVideoOrder(first);
  const secondOrder = ambientVideoOrder(second);
  if (firstOrder !== null || secondOrder !== null) {
    if (firstOrder === null) return 1;
    if (secondOrder === null) return -1;
    if (firstOrder !== secondOrder) return firstOrder - secondOrder;
  }

  const firstPreferredIndex = PREFERRED_AMBIENT_BACKGROUND_VIDEOS.indexOf(first.filename);
  const secondPreferredIndex = PREFERRED_AMBIENT_BACKGROUND_VIDEOS.indexOf(second.filename);
  if (firstPreferredIndex !== -1 || secondPreferredIndex !== -1) {
    if (firstPreferredIndex === -1) return 1;
    if (secondPreferredIndex === -1) return -1;
    return firstPreferredIndex - secondPreferredIndex;
  }

  return first.filename.localeCompare(second.filename);
}

function normalizeSceneVideoRoomModes(value) {
  if (!Array.isArray(value)) return [];

  const modes = [];
  for (const entry of value) {
    const mode = String(entry ?? "").trim().toLowerCase();
    if (mode === "hifi" || !ROOM_MODES.has(mode) || modes.includes(mode)) continue;
    modes.push(mode);
  }

  return modes;
}

async function readSceneBackgroundVideos() {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(SCENE_VIDEO_MANIFEST_PATH, "utf8"));
  } catch {
    return [];
  }

  if (!Array.isArray(manifest.videos)) return [];

  const videos = [];
  for (const video of manifest.videos) {
    const filename = normalizeSafeRelativePath(video.filename);
    if (!filename || !AMBIENT_BACKGROUND_VIDEO_EXTENSIONS.has(extname(filename).toLowerCase())) continue;

    const absolutePath = resolve(PUBLIC_SCENES_ROOT, ...filename.split("/"));
    if (absolutePath !== PUBLIC_SCENES_ROOT && !absolutePath.startsWith(`${PUBLIC_SCENES_ROOT}${sep}`)) continue;

    try {
      const info = await stat(absolutePath);
      if (!info.isFile()) continue;
    } catch {
      continue;
    }

    const id = String(video.id ?? "").trim() || basename(filename, extname(filename));
    const roomModes = normalizeSceneVideoRoomModes(video.roomModes);
    videos.push({
      id,
      filename,
      label: String(video.label ?? "").trim() || basename(filename, extname(filename)),
      src: `/assets/scenes/${encodeAssetRelativePath(filename)}`,
      ...(Number.isFinite(Number(video.order)) ? { order: Number(video.order) } : {}),
      ...(video.default === true ? { default: true } : {}),
      ...(roomModes.length > 0 ? { roomModes } : {}),
      source: "scene"
    });
  }

  return videos;
}

async function getAmbientBackgroundVideosPayload() {
  let entries = [];
  try {
    entries = await readdir(PUBLIC_ASSETS_ROOT, { withFileTypes: true });
  } catch {
    return {
      videos: [],
      total: 0,
      updatedAt: new Date().toISOString(),
      catalogVersion: null,
      defaultVideoId: null
    };
  }

  const legacyVideos = entries
    .filter((entry) => entry.isFile() && AMBIENT_BACKGROUND_VIDEO_EXTENSIONS.has(extname(entry.name).toLowerCase()))
    .map((entry) => ({
      id: basename(entry.name, extname(entry.name)),
      filename: entry.name,
      label: entry.name,
      src: `/assets/${encodeURIComponent(entry.name)}`,
      source: "legacy"
    }));
  const sceneVideos = await readSceneBackgroundVideos();
  const videos = [...legacyVideos, ...sceneVideos].sort(sortAmbientBackgroundVideos);
  const catalogVersion = createHash("sha1")
    .update(videos.map((video) => `${video.id}:${video.src}:${video.label}:${video.order ?? ""}:${video.default ? "1" : "0"}:${(video.roomModes ?? []).join(",")}`).join("|"))
    .digest("hex")
    .slice(0, 12);

  return {
    videos,
    total: videos.length,
    updatedAt: new Date().toISOString(),
    catalogVersion,
    defaultVideoId: videos.find((video) => video.default)?.id ?? DEFAULT_SCENE_VIDEO.id
  };
}

function pushUniquePath(candidates, value) {
  const normalized = normalizeSafeRelativePath(value);
  if (normalized && !candidates.some((candidate) => candidate.path === normalized)) {
    candidates.push({
      path: normalized,
      labelOverlay: posix.parse(normalized).name.toLowerCase() === "folder"
    });
  }
}

function explicitCoverLabelOverlay(row, cover) {
  const mode = String(row.cover_label_mode ?? row.cover_text_mode ?? "").trim().toLowerCase();
  if (["none", "off", "false", "hide", "hidden"].includes(mode)) return false;
  if (["category", "label", "overlay", "show"].includes(mode)) return true;
  return cover.labelOverlay;
}

async function resolveLocalLibraryCover(row, { categoryLabel, subCategory, trackPath }) {
  const candidates = [];
  for (const column of LOCAL_LIBRARY_COVER_COLUMNS) {
    pushUniquePath(candidates, row[column]);
  }

  const safeTrackPath = normalizeSafeRelativePath(trackPath);
  if (safeTrackPath) {
    const parsedPath = posix.parse(safeTrackPath);
    for (const extension of LOCAL_LIBRARY_COVER_EXTENSIONS) {
      pushUniquePath(candidates, posix.join(parsedPath.dir, `${parsedPath.name}${extension}`));
    }
    for (const extension of LOCAL_LIBRARY_COVER_EXTENSIONS) {
      pushUniquePath(candidates, posix.join(parsedPath.dir, `folder${extension}`));
    }
  }

  const categoryPath = normalizeSafeRelativePath(categoryLabel);
  const subCategoryPath = normalizeSafeRelativePath(subCategory);
  if (categoryPath && subCategoryPath) {
    for (const extension of LOCAL_LIBRARY_COVER_EXTENSIONS) {
      pushUniquePath(candidates, posix.join(categoryPath, subCategoryPath, `folder${extension}`));
    }
  }

  if (categoryPath) {
    for (const extension of LOCAL_LIBRARY_COVER_EXTENSIONS) {
      pushUniquePath(candidates, posix.join(categoryPath, `folder${extension}`));
    }
  }

  for (const candidate of candidates) {
    const cover = await resolveExistingLocalLibraryImage(candidate.path);
    if (cover) {
      return {
        ...cover,
        labelOverlay: explicitCoverLabelOverlay(row, candidate)
      };
    }
  }

  return null;
}

function resolveLocalLibraryCategory(row) {
  return normalizeLibraryCategoryId(row.category_level_1);
}

function buildLibrarySubCategoryId(categoryId, subCategory) {
  return `${categoryId}:${String(subCategory)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "library"}`;
}

async function readLocalAudioLibraryTracks(options = {}) {
  let manifestRows = [];
  const musicState = options.musicState ?? readMusicLibraryStateSync();
  try {
    manifestRows = readJsonRowsFromText(await readFile(LOCAL_LIBRARY_MANIFEST_PATH, "utf8"), "Music library manifest");
  } catch {
    return [];
  }
  const favoritePaths = new Set(musicState.favorites.trackPaths);

  const tracks = await Promise.all(manifestRows
    .map(async (row) => {
      const categoryId = resolveLocalLibraryCategory(row);
      if (!categoryId) return null;

      const title = row.title?.trim() || row.final_filename?.trim() || "Untitled";
      const artist = row.artist_or_author?.trim() || "Unknown Artist";
      const subCategory = row.category_level_2?.trim() || libraryCategoryLabel(categoryId);
      const path = row.final_relative_path?.trim() || null;
      const cover = await resolveLocalLibraryCover(row, {
        categoryLabel: row.category_level_1?.trim() || libraryCategoryLabel(categoryId),
        subCategory,
        trackPath: path
      });

      return {
        id: row.id?.trim() || path || `${categoryId}-${title}`,
        title,
        artist,
        album: `${libraryCategoryLabel(categoryId)} / ${subCategory}`,
        storage: "local",
        categoryId,
        subCategory,
        durationSeconds: parseDuration(row.duration_mm_ss),
        path,
        albumArtUrl: cover ? localLibraryImageUrl(cover.relativePath) : null,
        albumArtLabel: cover?.labelOverlay ? subCategory : null,
        albumArtScope: cover?.labelOverlay ? libraryCategoryLabel(categoryId) : null,
        active: false,
        favorite: Boolean(path && favoritePaths.has(path))
      };
    }));

  return tracks.filter(Boolean);
}

async function findLocalAudioLibraryTrackByPath(localTrackPath) {
  const safePath = normalizeLocalLibraryStateTrackPath(localTrackPath);
  if (!safePath) return null;

  const tracks = await readLocalAudioLibraryTracks();
  return tracks.find((track) => normalizeSafeRelativePath(track.path) === safePath) ?? null;
}

function buildMpdLocalLibraryTrackPathCandidates(localTrackPath) {
  const safePath = normalizeLocalLibraryStateTrackPath(localTrackPath);
  if (!safePath) return [];

  const candidates = [];
  const seen = new Set();
  const pushCandidate = (candidate) => {
    const safeCandidate = normalizeSafeRelativePath(candidate);
    if (!safeCandidate || seen.has(safeCandidate)) return;
    seen.add(safeCandidate);
    candidates.push(safeCandidate);
  };

  const mpdPrefix = normalizeSafeRelativePath(MPD_DEFAULT_QUEUE_PATH);
  if (mpdPrefix && !safePath.startsWith(`${mpdPrefix}/`)) {
    pushCandidate(posix.join(mpdPrefix, safePath));
  }
  pushCandidate(safePath);
  return candidates;
}

async function resolveMpdLocalLibraryTrackPath(localTrackPath) {
  const candidates = buildMpdLocalLibraryTrackPathCandidates(localTrackPath);
  for (const candidate of candidates) {
    const listed = await runMpc(["listall", candidate], { allowFailure: true });
    if (listed.split("\n").map((line) => line.trim()).includes(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function resolveMpdLocalLibraryQueue(startTrackPath) {
  const safeStartPath = normalizeLocalLibraryStateTrackPath(startTrackPath);
  if (!safeStartPath) return null;

  const mpdPrefix = normalizeSafeRelativePath(MPD_DEFAULT_QUEUE_PATH);
  const listedTracks = (await runMpc(mpdPrefix ? ["listall", mpdPrefix] : ["listall"], { allowFailure: true }))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (listedTracks.length === 0) return null;

  const listedTrackSet = new Set(listedTracks);
  const startTrack = buildMpdLocalLibraryTrackPathCandidates(safeStartPath).find((candidate) => listedTrackSet.has(candidate));
  if (!startTrack) return null;

  return {
    addRootPath: mpdPrefix,
    mpdTrackPaths: listedTracks,
    startIndex: listedTracks.indexOf(startTrack)
  };
}

function buildNasAudioLibraryTracks(playback) {
  return playback.queuePreview.map((entry) => ({
    id: `nas-${entry.id}`,
    title: entry.title,
    artist: entry.artist,
    album: entry.album || "NAS Library",
    storage: "nas",
    categoryId: "nas",
    subCategory: entry.active ? "Now Playing" : "Queue",
    durationSeconds: entry.durationSeconds,
    path: null,
    albumArtUrl: null,
    albumArtLabel: null,
    albumArtScope: null,
    active: entry.active,
    favorite: false
  }));
}

function buildLocalLibraryCategories(localTracks) {
  return ["focus", "meditation", "rest"].map((categoryId) => {
    const categoryTracks = localTracks.filter((track) => track.categoryId === categoryId);
    const subCategoryCounts = new Map();
    categoryTracks.forEach((track) => {
      subCategoryCounts.set(track.subCategory, (subCategoryCounts.get(track.subCategory) ?? 0) + 1);
    });

    return {
      id: categoryId,
      label: libraryCategoryLabel(categoryId),
      trackCount: categoryTracks.length,
      subCategories: Array.from(subCategoryCounts.entries())
        .sort(([leftLabel], [rightLabel]) => (
          localLibrarySubCategoryOrder(categoryId, leftLabel) - localLibrarySubCategoryOrder(categoryId, rightLabel)
          || leftLabel.localeCompare(rightLabel)
        ))
        .map(([label, trackCount]) => ({
          id: buildLibrarySubCategoryId(categoryId, label),
          label,
          trackCount
        }))
    };
  });
}

function normalizeAudioLibraryFilters(searchParams) {
  const storage = (searchParams.get("storage") ?? "all").trim().toLowerCase();
  const category = (searchParams.get("category") ?? "").trim().toLowerCase();
  const subCategory = (searchParams.get("subCategory") ?? "").trim();
  const limitRaw = Number(searchParams.get("limit") ?? 250);
  const offsetRaw = Number(searchParams.get("offset") ?? 0);

  if (!["all", "local", "nas", "usb", "favorites", "recently_added"].includes(storage)) {
    throw new Error("storage must be all, local, nas, usb, favorites, or recently_added");
  }

  if (category && !normalizeLibraryCategoryId(category)) {
    throw new Error("category must be focus, meditation, or rest");
  }

  if (!Number.isFinite(limitRaw) || limitRaw <= 0 || limitRaw > 500) {
    throw new Error("limit must be between 1 and 500");
  }

  if (!Number.isFinite(offsetRaw) || offsetRaw < 0) {
    throw new Error("offset must be a non-negative number");
  }

  return {
    storage,
    category: category ? normalizeLibraryCategoryId(category) : "",
    subCategory,
    limit: Math.round(limitRaw),
    offset: Math.round(offsetRaw)
  };
}

function filterAudioLibraryTracks(tracks, filters) {
  return tracks.filter((track) => {
    if (filters.storage !== "all" && track.storage !== filters.storage) return false;
    if (filters.category && track.categoryId !== filters.category) return false;
    if (filters.subCategory && track.subCategory !== filters.subCategory) return false;
    return true;
  });
}

async function getAudioLibraryPayload(searchParams) {
  const filters = normalizeAudioLibraryFilters(searchParams);
  const state = await getTikpalState();
  const musicState = readMusicLibraryStateSync();
  const localTracks = await readLocalAudioLibraryTracks({ musicState });
  const nasTracks = buildNasAudioLibraryTracks(state.playback);
  const favoriteTracks = localTracks
    .filter((track) => track.favorite)
    .map((track) => ({ ...track, storage: "favorites" }));
  const recentlyAddedTracks = localTracks
    .slice(0, 12)
    .map((track) => ({ ...track, storage: "recently_added", subCategory: "Recently Added" }));
  const sourceTracks = filters.storage === "local"
    ? localTracks
    : filters.storage === "nas"
      ? nasTracks
      : filters.storage === "favorites"
        ? favoriteTracks
        : filters.storage === "recently_added"
          ? recentlyAddedTracks
          : filters.storage === "usb"
            ? []
            : [...localTracks, ...nasTracks, ...favoriteTracks, ...recentlyAddedTracks];
  const tracks = sourceTracks;
  const filtered = filterAudioLibraryTracks(tracks, filters);
  const paged = filtered.slice(filters.offset, filters.offset + filters.limit);

  return {
    sources: [
      { id: "library", label: "Library" },
      { id: "radio", label: "Radio" },
      { id: "spotify", label: "Spotify" },
      { id: "airplay", label: "AirPlay" },
      { id: "bluetooth", label: "Bluetooth" },
      { id: "upnp", label: "DLNA" }
    ],
    storages: [
      {
        id: "local",
        label: "Local",
        trackCount: localTracks.length,
        categories: buildLocalLibraryCategories(localTracks)
      },
      {
        id: "nas",
        label: "NAS",
        trackCount: state.system.library.trackCount || nasTracks.length,
        categories: []
      },
      {
        id: "usb",
        label: "USB",
        trackCount: 0,
        categories: []
      },
      {
        id: "favorites",
        label: "Favorites",
        trackCount: favoriteTracks.length,
        categories: []
      },
      {
        id: "recently_added",
        label: "Recently Added",
        trackCount: recentlyAddedTracks.length,
        categories: []
      }
    ],
    tracks: paged,
    total: filtered.length,
    filters,
    updatedAt: state.runtime.updatedAt
  };
}

function buildPlaylistId(name) {
  const slug = String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    || "playlist";
  return `${slug}-${Date.now().toString(36)}`;
}

function buildDuplicatePlaylistName(name) {
  const suffix = " Copy";
  const base = String(name ?? "Playlist").trim() || "Playlist";
  if (base.length + suffix.length <= PLAYLIST_NAME_MAX_LENGTH) return `${base}${suffix}`;
  return `${base.slice(0, PLAYLIST_NAME_MAX_LENGTH - suffix.length).trimEnd()}${suffix}`;
}

function normalizePlaylistName(name) {
  const normalized = String(name ?? "").trim();
  if (!normalized) throw new Error("playlist name is required");
  if (normalized.length > PLAYLIST_NAME_MAX_LENGTH) throw new Error(`playlist name must be ${PLAYLIST_NAME_MAX_LENGTH} characters or fewer`);
  return normalized;
}

function clonePlaylistTrack(track, position, storage = track.storage) {
  return {
    ...track,
    storage,
    position
  };
}

function playlistDurationSeconds(tracks) {
  let total = 0;
  let hasAny = false;
  for (const track of tracks) {
    if (typeof track.durationSeconds !== "number") return null;
    total += track.durationSeconds;
    hasAny = true;
  }
  return hasAny ? total : null;
}

async function readCuratedPlaylistIndexRows() {
  try {
    return readJsonRowsFromText(await readFile(LOCAL_PLAYLIST_INDEX_PATH, "utf8"), "Playlist index");
  } catch {
    return [];
  }
}

function playlistTrackPathFromM3uLine(line) {
  const entry = line.trim();
  if (!entry || entry.startsWith("#")) return null;
  const absolutePath = resolve(LOCAL_PLAYLIST_ROOT, ...entry.split(/[\\/]+/));
  const relation = relative(LOCAL_LIBRARY_ROOT, absolutePath).split(sep).join("/");
  return normalizeSafeRelativePath(relation);
}

async function readCuratedPlaylistTrackPaths(fileName) {
  const safeFileName = basename(String(fileName ?? ""));
  if (!safeFileName || !safeFileName.endsWith(".m3u")) return [];
  const playlistPath = resolve(LOCAL_PLAYLIST_ROOT, safeFileName);
  if (playlistPath !== LOCAL_PLAYLIST_ROOT && !playlistPath.startsWith(`${LOCAL_PLAYLIST_ROOT}${sep}`)) return [];
  try {
    return uniqueSafeTrackPaths((await readFile(playlistPath, "utf8"))
      .split(/\r?\n/)
      .map(playlistTrackPathFromM3uLine)
      .filter(Boolean));
  } catch {
    return [];
  }
}

function tracksForPaths(trackPaths, trackMap, storage = "local") {
  return trackPaths
    .map((trackPath, index) => {
      const track = trackMap.get(normalizeSafeRelativePath(trackPath));
      return track ? clonePlaylistTrack(track, index + 1, storage) : null;
    })
    .filter(Boolean);
}

async function buildAudioPlaylistsPayload() {
  const musicState = readMusicLibraryStateSync();
  const localTracks = await readLocalAudioLibraryTracks({ musicState });
  const trackMap = new Map(localTracks.map((track) => [normalizeSafeRelativePath(track.path), track]));
  const userPlaylists = musicState.playlists.map((playlist) => {
    const tracks = tracksForPaths(playlist.trackPaths, trackMap, "local");
    const metadata = normalizePlaylistMetadata(playlist, playlist.name, tracks);
    return {
      id: playlist.id,
      name: playlist.name,
      source: "user",
      readOnly: false,
      description: metadata.description,
      moodTags: metadata.moodTags,
      coverType: metadata.coverType,
      coverValue: metadata.coverValue,
      trackCount: tracks.length,
      durationSeconds: playlistDurationSeconds(tracks),
      createdAt: playlist.createdAt,
      updatedAt: playlist.updatedAt,
      tracks
    };
  });

  const curatedRows = await readCuratedPlaylistIndexRows();
  const curatedPlaylists = await Promise.all(curatedRows.map(async (row) => {
    const trackPaths = await readCuratedPlaylistTrackPaths(row.file_name);
    const tracks = tracksForPaths(trackPaths, trackMap, "local");
    const name = row.playlist_name?.trim() || row.file_name?.replace(/\.m3u$/i, "") || "Curated Playlist";
    const metadata = normalizePlaylistMetadata({
      description: row.description,
      moodTags: row.category ? [row.category] : undefined,
      coverType: "collage",
      coverValue: row.category?.trim() || null
    }, name, tracks);
    return {
      id: `curated:${row.file_name}`,
      name,
      source: "curated",
      readOnly: true,
      description: metadata.description,
      moodTags: metadata.moodTags,
      coverType: metadata.coverType,
      coverValue: metadata.coverValue,
      trackCount: tracks.length,
      durationSeconds: playlistDurationSeconds(tracks),
      createdAt: null,
      updatedAt: null,
      tracks
    };
  }));

  return {
    playlists: [...userPlaylists, ...curatedPlaylists],
    updatedAt: new Date().toISOString()
  };
}

async function createAudioPlaylist(payload) {
  const name = normalizePlaylistName(payload?.name);
  const now = new Date().toISOString();
  const state = await readMusicLibraryState();
  const trackPaths = uniqueSafeTrackPaths(Array.isArray(payload?.trackPaths) ? payload.trackPaths : []);
  const metadata = normalizePlaylistMetadata(payload, name);
  state.playlists.push({
    id: buildPlaylistId(name),
    name,
    description: metadata.description,
    moodTags: metadata.moodTags,
    coverType: metadata.coverType,
    coverValue: metadata.coverValue,
    trackPaths,
    createdAt: now,
    updatedAt: now
  });
  await writeMusicLibraryState(state);
}

async function findPlaylistTemplate(playlistId) {
  const state = await readMusicLibraryState();
  const userPlaylist = state.playlists.find((playlist) => playlist.id === playlistId);
  if (userPlaylist) return { ...userPlaylist, readOnly: false };

  if (String(playlistId ?? "").startsWith("curated:")) {
    const fileName = String(playlistId).slice("curated:".length);
    const rows = await readCuratedPlaylistIndexRows();
    const row = rows.find((entry) => entry.file_name === fileName);
    const name = row?.playlist_name?.trim() || fileName.replace(/\.m3u$/i, "") || "Curated Playlist";
    const trackPaths = await readCuratedPlaylistTrackPaths(fileName);
    return {
      id: playlistId,
      name,
      description: normalizePlaylistDescription(row?.description),
      moodTags: normalizePlaylistMoodTags(row?.category ? [row.category] : inferPlaylistMoodTags(name)),
      coverType: "collage",
      coverValue: normalizePlaylistCoverValue(row?.category) ?? buildDefaultPlaylistCoverValue(name, [row?.category].filter(Boolean)),
      trackPaths,
      createdAt: null,
      updatedAt: null,
      readOnly: true
    };
  }
  return null;
}

async function findPlaylistTrackPaths(playlistId) {
  const state = await readMusicLibraryState();
  const userPlaylist = state.playlists.find((playlist) => playlist.id === playlistId);
  if (userPlaylist) return userPlaylist.trackPaths;

  if (String(playlistId ?? "").startsWith("curated:")) {
    const fileName = String(playlistId).slice("curated:".length);
    return await readCuratedPlaylistTrackPaths(fileName);
  }
  return null;
}

async function playTrackPaths(trackPaths, startIndex = 0) {
  const safePaths = uniqueSafeTrackPaths(trackPaths);
  if (safePaths.length === 0) throw new Error("playlist has no playable tracks");
  const safeStartIndex = Math.max(0, Math.min(safePaths.length - 1, Number.isInteger(Number(startIndex)) ? Number(startIndex) : 0));
  await enforceConnectionGate("mpd");
  if (API_MODE === "mpc") {
    await withMpcMutationLock(async () => {
      const mpdTrackPaths = [];
      for (const trackPath of safePaths) {
        const mpdTrackPath = await resolveMpdLocalLibraryTrackPath(trackPath);
        if (!mpdTrackPath) throw new Error(`Local library track is not available in MPD: ${trackPath}`);
        mpdTrackPaths.push(mpdTrackPath);
      }

      await runMpc(["clear"]);
      for (const trackPath of mpdTrackPaths) {
        await runMpc(["add", trackPath]);
      }
      await ensureMpcPlaybackStarted(safeStartIndex + 1);
    });
    return;
  }
  const trackMap = new Map((await readLocalAudioLibraryTracks()).map((track) => [normalizeSafeRelativePath(track.path), track]));
  const playableTracks = safePaths.map((trackPath) => trackMap.get(trackPath)).filter(Boolean);
  if (playableTracks.length === 0) throw new Error("playlist has no playable tracks");
  setMockLocalQueue(playableTracks, safeStartIndex);
  mockArmedSource = "mpd";
  mockActiveSource = "mpd";
  playbackState = "playing";
  elapsedSeconds = 0;
  lastTickAt = Date.now();
}

async function applyAudioPlaylistAction(action) {
  if (action?.type === "play") {
    const trackPaths = await findPlaylistTrackPaths(action.playlistId);
    if (!trackPaths) throw new Error("playlist not found");
    await playTrackPaths(trackPaths, action.startIndex);
    return;
  }

  if (action?.type === "duplicate") {
    const template = await findPlaylistTemplate(action.playlistId);
    if (!template) throw new Error("playlist not found");
    const state = await readMusicLibraryState();
    const now = new Date().toISOString();
    const name = normalizePlaylistName(action.name || buildDuplicatePlaylistName(template.name));
    const metadata = normalizePlaylistMetadata({
      description: action.description ?? template.description,
      moodTags: action.moodTags ?? template.moodTags,
      coverType: action.coverType ?? template.coverType,
      coverValue: action.coverValue ?? template.coverValue
    }, name);
    state.playlists.push({
      id: buildPlaylistId(name),
      name,
      description: metadata.description,
      moodTags: metadata.moodTags,
      coverType: metadata.coverType,
      coverValue: metadata.coverValue,
      trackPaths: uniqueSafeTrackPaths(template.trackPaths),
      createdAt: now,
      updatedAt: now
    });
    await writeMusicLibraryState(state);
    return;
  }

  const state = await readMusicLibraryState();
  const playlist = state.playlists.find((entry) => entry.id === action?.playlistId);
  if (!playlist) throw new Error("editable playlist not found");
  const now = new Date().toISOString();

  switch (action.type) {
    case "rename":
      playlist.name = normalizePlaylistName(action.name);
      break;
    case "update_metadata": {
      if (typeof action.name === "string") {
        playlist.name = normalizePlaylistName(action.name);
      }
      const metadata = normalizePlaylistMetadata({
        description: action.description ?? playlist.description,
        moodTags: action.moodTags ?? playlist.moodTags,
        coverType: action.coverType ?? playlist.coverType,
        coverValue: action.coverValue ?? playlist.coverValue
      }, playlist.name);
      playlist.description = metadata.description;
      playlist.moodTags = metadata.moodTags;
      playlist.coverType = metadata.coverType;
      playlist.coverValue = metadata.coverValue;
      break;
    }
    case "delete":
      state.playlists = state.playlists.filter((entry) => entry.id !== playlist.id);
      await writeMusicLibraryState(state);
      return;
    case "add_track": {
      const trackPath = normalizeSafeRelativePath(action.trackPath);
      if (!trackPath) throw new Error("trackPath is required");
      playlist.trackPaths = uniqueSafeTrackPaths([...playlist.trackPaths, trackPath]);
      break;
    }
    case "remove_track": {
      const trackPath = normalizeSafeRelativePath(action.trackPath);
      if (!trackPath) throw new Error("trackPath is required");
      playlist.trackPaths = playlist.trackPaths.filter((entry) => entry !== trackPath);
      break;
    }
    case "move_track": {
      const fromIndex = Number(action.fromIndex);
      const toIndex = Number(action.toIndex);
      if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) throw new Error("move_track requires integer indexes");
      if (fromIndex < 0 || fromIndex >= playlist.trackPaths.length) throw new Error("fromIndex is out of range");
      const boundedToIndex = Math.max(0, Math.min(playlist.trackPaths.length - 1, toIndex));
      const [trackPath] = playlist.trackPaths.splice(fromIndex, 1);
      playlist.trackPaths.splice(boundedToIndex, 0, trackPath);
      break;
    }
    case "replace_tracks":
      playlist.trackPaths = uniqueSafeTrackPaths(Array.isArray(action.trackPaths) ? action.trackPaths : []);
      break;
    default:
      throw new Error(`Unsupported playlist action: ${action?.type}`);
  }

  playlist.updatedAt = now;
  await writeMusicLibraryState(state);
}

async function getSourceStatusFromCommands({ readyCommand, activeCommand, labelCommand, armed, supported, gateConnectionUntilArmed = false }) {
  const [ready, rawConnected, label] = await Promise.all([
    commandSucceeds(readyCommand, { timeout: 2500 }),
    commandSucceeds(activeCommand, { timeout: 2500 }),
    labelCommand.trim() ? runCommand(labelCommand, { allowFailure: true, timeout: 2500 }) : Promise.resolve("")
  ]);
  const connected = gateConnectionUntilArmed ? armed && rawConnected : rawConnected;

  return {
    supported,
    available: supported ? (armed ? ready || rawConnected || armed : true) : false,
    armed,
    connected,
    connectedLabel: null,
    advertisedLabel: label.trim() || null
  };
}

async function getAirplaySourceStatus({ readyCommand, activeCommand, labelCommand, armed, supported }) {
  const [ready, rendererActive, receiverActive, label] = await Promise.all([
    commandSucceeds(readyCommand, { timeout: 2500 }),
    commandSucceeds(activeCommand, { timeout: 2500 }),
    commandSucceeds(AIRPLAY_RECEIVER_ACTIVE_COMMAND, { timeout: 2500 }),
    labelCommand.trim() ? runCommand(labelCommand, { allowFailure: true, timeout: 2500 }) : Promise.resolve("")
  ]);

  const airplayArmed = armed && (ready || rendererActive || receiverActive || armed);

  return {
    supported,
    available: supported ? (armed ? ready || receiverActive || rendererActive || armed : true) : false,
    armed: airplayArmed,
    connected: armed && receiverActive && rendererActive,
    connectedLabel: null,
    advertisedLabel: label.trim() || null
  };
}

async function ensureAirplayReceiverState(enabled) {
  const command = enabled
    ? "sh -lc 'systemctl start shairport-sync.service >/dev/null 2>&1 || sudo -n systemctl start shairport-sync.service >/dev/null 2>&1 || true'"
    : "sh -lc 'systemctl stop shairport-sync.service >/dev/null 2>&1 || sudo -n systemctl stop shairport-sync.service >/dev/null 2>&1 || true'";
  await runCommand(command, { allowFailure: true, timeout: 5000 });
}

async function enforceConnectionGate(nextSource) {
  if (nextSource === "audio") {
    if (AUDIO_ACTIVATE_COMMAND) {
      await runSystemActionCommand(AUDIO_ACTIVATE_COMMAND, "audio activate");
    }
    if (SPOTIFY_DISABLE_COMMAND) {
      await runSystemActionCommand(SPOTIFY_DISABLE_COMMAND, "spotify connect disable");
    }
    if (BLUETOOTH_DISABLE_COMMAND) {
      await runSystemActionCommand(BLUETOOTH_DISABLE_COMMAND, "bluetooth disable");
    }
    if (AIRPLAY_DISABLE_COMMAND) {
      await runSystemActionCommand(AIRPLAY_DISABLE_COMMAND, "airplay disable");
    }
    if (UPNP_DISABLE_COMMAND) {
      await runSystemActionCommand(UPNP_DISABLE_COMMAND, "dlna disable");
    }
    await ensureAirplayReceiverState(false);
    return;
  }

  if (nextSource === "scene") {
    if (SPOTIFY_DISABLE_COMMAND) {
      await runSystemActionCommand(SPOTIFY_DISABLE_COMMAND, "spotify connect disable");
    }
    if (BLUETOOTH_DISABLE_COMMAND) {
      await runSystemActionCommand(BLUETOOTH_DISABLE_COMMAND, "bluetooth disable");
    }
    if (AIRPLAY_DISABLE_COMMAND) {
      await runSystemActionCommand(AIRPLAY_DISABLE_COMMAND, "airplay disable");
    }
    if (UPNP_DISABLE_COMMAND) {
      await runSystemActionCommand(UPNP_DISABLE_COMMAND, "dlna disable");
    }
    await ensureAirplayReceiverState(false);
    return;
  }

  if (nextSource === "spotify") {
    if (!SPOTIFY_READY_COMMAND && !SPOTIFY_ACTIVE_COMMAND && !SPOTIFY_ACTIVATE_COMMAND && !SPOTIFY_LABEL_COMMAND) {
      throw new Error("spotify connect is unavailable in this runtime");
    }
    if (SPOTIFY_ACTIVATE_COMMAND) {
      await runSystemActionCommand(SPOTIFY_ACTIVATE_COMMAND, "spotify connect activate");
    }
    if (BLUETOOTH_DISABLE_COMMAND) {
      await runSystemActionCommand(BLUETOOTH_DISABLE_COMMAND, "bluetooth disable");
    }
    if (AIRPLAY_DISABLE_COMMAND) {
      await runSystemActionCommand(AIRPLAY_DISABLE_COMMAND, "airplay disable");
    }
    if (UPNP_DISABLE_COMMAND) {
      await runSystemActionCommand(UPNP_DISABLE_COMMAND, "dlna disable");
    }
    await ensureAirplayReceiverState(false);
    return;
  }

  if (nextSource === "bluetooth") {
    if (!BLUETOOTH_ENABLE_COMMAND) {
      throw new Error("bluetooth gating is unavailable in this runtime");
    }
    await runSystemActionCommand(BLUETOOTH_ENABLE_COMMAND, "bluetooth enable");
    if (SPOTIFY_DISABLE_COMMAND) {
      await runSystemActionCommand(SPOTIFY_DISABLE_COMMAND, "spotify connect disable");
    }
    if (AIRPLAY_DISABLE_COMMAND) {
      await runSystemActionCommand(AIRPLAY_DISABLE_COMMAND, "airplay disable");
    }
    if (UPNP_DISABLE_COMMAND) {
      await runSystemActionCommand(UPNP_DISABLE_COMMAND, "dlna disable");
    }
    return;
  }

  if (nextSource === "airplay") {
    if (!AIRPLAY_ENABLE_COMMAND) {
      throw new Error("airplay gating is unavailable in this runtime");
    }
    await runSystemActionCommand(AIRPLAY_ENABLE_COMMAND, "airplay enable");
    await ensureAirplayReceiverState(true);
    if (SPOTIFY_DISABLE_COMMAND) {
      await runSystemActionCommand(SPOTIFY_DISABLE_COMMAND, "spotify connect disable");
    }
    if (BLUETOOTH_DISABLE_COMMAND) {
      await runSystemActionCommand(BLUETOOTH_DISABLE_COMMAND, "bluetooth disable");
    }
    if (UPNP_DISABLE_COMMAND) {
      await runSystemActionCommand(UPNP_DISABLE_COMMAND, "dlna disable");
    }
    return;
  }

  if (nextSource === "upnp") {
    if (!UPNP_ENABLE_COMMAND) {
      throw new Error("dlna gating is unavailable in this runtime");
    }
    await runSystemActionCommand(UPNP_ENABLE_COMMAND, "dlna enable");
    if (SPOTIFY_DISABLE_COMMAND) {
      await runSystemActionCommand(SPOTIFY_DISABLE_COMMAND, "spotify connect disable");
    }
    if (BLUETOOTH_DISABLE_COMMAND) {
      await runSystemActionCommand(BLUETOOTH_DISABLE_COMMAND, "bluetooth disable");
    }
    if (AIRPLAY_DISABLE_COMMAND) {
      await runSystemActionCommand(AIRPLAY_DISABLE_COMMAND, "airplay disable");
    }
    await ensureAirplayReceiverState(false);
    return;
  }

  if (SPOTIFY_DISABLE_COMMAND) {
    await runSystemActionCommand(SPOTIFY_DISABLE_COMMAND, "spotify connect disable");
  }
  if (BLUETOOTH_DISABLE_COMMAND) {
    await runSystemActionCommand(BLUETOOTH_DISABLE_COMMAND, "bluetooth disable");
  }
  if (AIRPLAY_DISABLE_COMMAND) {
    await runSystemActionCommand(AIRPLAY_DISABLE_COMMAND, "airplay disable");
  }
  if (UPNP_DISABLE_COMMAND) {
    await runSystemActionCommand(UPNP_DISABLE_COMMAND, "dlna disable");
  }
  await ensureAirplayReceiverState(false);
}

async function getMpcAudioSnapshot(currentFile) {
  const radioStations = await getAvailableRadioStations();
  const [audioSourceState, spotifyState, bluetoothState, airplayState, upnpState] = await Promise.all([
    getSourceStatusFromCommands({
      readyCommand: AUDIO_READY_COMMAND,
      activeCommand: AUDIO_ACTIVE_COMMAND,
      labelCommand: AUDIO_LABEL_COMMAND,
      armed: mockArmedSource === "audio",
      supported: true
    }),
    getSourceStatusFromCommands({
      readyCommand: SPOTIFY_READY_COMMAND,
      activeCommand: SPOTIFY_ACTIVE_COMMAND,
      labelCommand: SPOTIFY_LABEL_COMMAND,
      armed: mockArmedSource === "spotify",
      gateConnectionUntilArmed: true,
      supported: Boolean(
        SPOTIFY_READY_COMMAND
        || SPOTIFY_ACTIVE_COMMAND
        || SPOTIFY_ACTIVATE_COMMAND
        || SPOTIFY_DISABLE_COMMAND
        || SPOTIFY_LABEL_COMMAND
      )
    }),
    getSourceStatusFromCommands({
      readyCommand: BLUETOOTH_READY_COMMAND,
      activeCommand: BLUETOOTH_ACTIVE_COMMAND,
      labelCommand: BLUETOOTH_LABEL_COMMAND,
      armed: mockArmedSource === "bluetooth",
      gateConnectionUntilArmed: true,
      supported: Boolean(
        BLUETOOTH_READY_COMMAND
        || BLUETOOTH_ACTIVE_COMMAND
        || BLUETOOTH_LABEL_COMMAND
        || BLUETOOTH_ENABLE_COMMAND
        || BLUETOOTH_DISABLE_COMMAND
      )
    }),
    getAirplaySourceStatus({
      readyCommand: AIRPLAY_READY_COMMAND,
      activeCommand: AIRPLAY_ACTIVE_COMMAND,
      labelCommand: AIRPLAY_LABEL_COMMAND,
      armed: mockArmedSource === "airplay",
      supported: Boolean(
        AIRPLAY_READY_COMMAND
        || AIRPLAY_ACTIVE_COMMAND
        || AIRPLAY_LABEL_COMMAND
        || AIRPLAY_ENABLE_COMMAND
        || AIRPLAY_DISABLE_COMMAND
      )
    }),
    getSourceStatusFromCommands({
      readyCommand: UPNP_READY_COMMAND,
      activeCommand: UPNP_ACTIVE_COMMAND,
      labelCommand: UPNP_LABEL_COMMAND,
      armed: mockArmedSource === "upnp",
      gateConnectionUntilArmed: true,
      supported: Boolean(
        UPNP_READY_COMMAND
        || UPNP_ACTIVE_COMMAND
        || UPNP_LABEL_COMMAND
        || UPNP_ENABLE_COMMAND
        || UPNP_DISABLE_COMMAND
      )
    })
  ]);
  const radioReady = Boolean(RADIO_ACTIVATE_COMMAND || RADIO_DEFAULT_URI || radioStations.length > 0);
  const radioActive = isStreamUri(currentFile);
  const activeSource = mockArmedSource === "scene"
    ? "scene"
    : audioSourceState.connected
    ? "audio"
    : spotifyState.connected
      ? "spotify"
      : bluetoothState.connected
        ? "bluetooth"
        : airplayState.connected
          ? "airplay"
          : upnpState.connected
            ? "upnp"
          : audioSourceState.armed
            ? "audio"
            : spotifyState.armed
              ? "spotify"
              : bluetoothState.armed
                ? "bluetooth"
                : airplayState.armed
                  ? "airplay"
                  : upnpState.armed
                    ? "upnp"
                    : radioActive
                      ? "radio"
                      : "mpd";
  const nextRadioStations = radioStations.map((station) => ({
    ...station,
    active: radioActive && station.uri === currentFile
  }));

  return buildAudioState({
    activeSource,
    armedSource: mockArmedSource,
    radioReady,
    radioActive,
    radioStations: nextRadioStations,
    audioSourceState,
    spotifyState,
    bluetoothState,
    airplayState,
    upnpState
  });
}

function commandSourceSupported(commands) {
  return commands.some((command) => Boolean(command));
}

function buildCachedSourceRuntimeState(source, supported, advertisedLabel = null) {
  const armed = mockArmedSource === source;
  return {
    supported,
    available: supported,
    armed,
    connected: false,
    connectedLabel: null,
    advertisedLabel
  };
}

function buildMinimalMpcAudioSnapshot(currentFile = "") {
  const radioActive = isStreamUri(currentFile);
  const activeSource = mockArmedSource === "scene"
    ? "scene"
    : mockArmedSource && ["audio", "spotify", "bluetooth", "airplay", "upnp"].includes(mockArmedSource)
      ? mockArmedSource
      : radioActive
        ? "radio"
        : "mpd";

  return buildAudioState({
    activeSource,
    armedSource: mockArmedSource,
    radioReady: Boolean(RADIO_ACTIVATE_COMMAND || RADIO_DEFAULT_URI),
    radioActive,
    radioStations: [],
    audioSourceState: buildCachedSourceRuntimeState("audio", true),
    spotifyState: buildCachedSourceRuntimeState("spotify", commandSourceSupported([
      SPOTIFY_READY_COMMAND,
      SPOTIFY_ACTIVE_COMMAND,
      SPOTIFY_ACTIVATE_COMMAND,
      SPOTIFY_DISABLE_COMMAND,
      SPOTIFY_LABEL_COMMAND
    ]), tikpalStateSnapshotCache?.state?.audio?.sources?.find((source) => source.id === "spotify")?.advertisedLabel ?? null),
    bluetoothState: buildCachedSourceRuntimeState("bluetooth", commandSourceSupported([
      BLUETOOTH_READY_COMMAND,
      BLUETOOTH_ACTIVE_COMMAND,
      BLUETOOTH_LABEL_COMMAND,
      BLUETOOTH_ENABLE_COMMAND,
      BLUETOOTH_DISABLE_COMMAND
    ]), tikpalStateSnapshotCache?.state?.audio?.sources?.find((source) => source.id === "bluetooth")?.advertisedLabel ?? null),
    airplayState: buildCachedSourceRuntimeState("airplay", commandSourceSupported([
      AIRPLAY_READY_COMMAND,
      AIRPLAY_ACTIVE_COMMAND,
      AIRPLAY_LABEL_COMMAND,
      AIRPLAY_ENABLE_COMMAND,
      AIRPLAY_DISABLE_COMMAND
    ]), tikpalStateSnapshotCache?.state?.audio?.sources?.find((source) => source.id === "airplay")?.advertisedLabel ?? null),
    upnpState: buildCachedSourceRuntimeState("upnp", commandSourceSupported([
      UPNP_READY_COMMAND,
      UPNP_ACTIVE_COMMAND,
      UPNP_LABEL_COMMAND,
      UPNP_ENABLE_COMMAND,
      UPNP_DISABLE_COMMAND
    ]), tikpalStateSnapshotCache?.state?.audio?.sources?.find((source) => source.id === "upnp")?.advertisedLabel ?? null)
  });
}

async function getMpcQueuePreview(status) {
  if (!status.queueLength) return [];

  const playlistRaw = await runMpc([
    "playlist",
    "--format",
    "%position%\t%title%\t%artist%\t%album%\t%time%\t%file%"
  ], { allowFailure: true });

  const queue = playlistRaw
    .split("\n")
    .filter(Boolean)
    .map((line, index) => {
      const [positionRaw, title, artist, album, duration, file] = line.split("\t");
      const position = Number(positionRaw) + 1;
      return buildQueueEntrySummary({
        id: file || `mpd-queue-${position || index + 1}`,
        position: Number.isFinite(position) ? position : index + 1,
        title: title?.trim() || trackTitleFromFile(file) || `Track ${index + 1}`,
        artist: artist?.trim() || "Unknown Artist",
        album: album?.trim() || albumLabelFromFile(file),
        durationSeconds: parseDuration(duration),
        active: (Number.isFinite(position) ? position : index + 1) === status.currentTrackIndex
      });
    });

  if (queue.length === 0) return [];

  const activeIndex = Math.max(0, queue.findIndex((entry) => entry.active));
  const previewStart = Math.max(0, Math.min(queue.length - 6, activeIndex - 1));
  return queue.slice(previewStart, previewStart + 6);
}

function buildFastTrackMetadata({ title, artist, album, file }) {
  return {
    title: title?.trim() || trackTitleFromFile(file),
    artist: artist?.trim() || "Unknown Artist",
    album: album?.trim() || albumLabelFromFile(file),
    artworkMimeType: null,
    artworkToken: null,
    absolutePath: null
  };
}

async function getMpcSnapshot(options = {}) {
  const includeSlowRuntimeStatus = options.includeSlowRuntimeStatus !== false;
  const [currentRaw, statusRaw, statsRaw] = await Promise.all([
    runMpc(["--format", "%title%\t%artist%\t%album%\t%file%\t%time%", "current"], { allowFailure: true }),
    runMpc(["status"], { allowFailure: true }),
    runMpc(["stats"], { allowFailure: true })
  ]);

  const status = parseMpcStatus(statusRaw);
  const [title, artist, album, file, duration] = currentRaw.split("\t");
  const hasCurrentTrack = Boolean(currentRaw.trim());
  const durationSeconds = parseDuration(duration) ?? status.durationSeconds;
  const nextSystem = includeSlowRuntimeStatus
    ? await getMpcSystemSnapshot(statusRaw, statsRaw)
    : getCachedMpcSystemSnapshot(statusRaw, statsRaw);
  const audio = includeSlowRuntimeStatus
    ? await getMpcAudioSnapshot(file)
    : buildMinimalMpcAudioSnapshot(file);
  const queuePreview = await getMpcQueuePreview(status);
  const playbackSource = audio.sources.find((source) => source.active)?.id ?? audio.currentSource.id;
  const outputVolumePercent = includeSlowRuntimeStatus ? await readOutputVolumePercent() : null;
  const isSceneSource = playbackSource === "scene";
  const isExternalHandoffSource = playbackSource === "scene" || playbackSource === "spotify" || playbackSource === "bluetooth" || playbackSource === "airplay" || playbackSource === "upnp";
  const isMpdBackedSource = playbackSource === "mpd" || playbackSource === "audio";
  const volumePercent = isExternalHandoffSource
    ? (outputVolumePercent ?? status.volumePercent ?? system.volume.percent)
    : (status.volumePercent ?? outputVolumePercent ?? system.volume.percent);
  const radioPlaybackMetadata = playbackSource === "radio"
    ? normalizeRadioPlaybackMetadata({ title, artist, album, file, audio })
    : null;
  const bluetoothPlaybackMetadata = includeSlowRuntimeStatus && playbackSource === "bluetooth"
    ? await readBluetoothPlaybackMetadata()
    : null;
  const airplayPlaybackMetadata = includeSlowRuntimeStatus && playbackSource === "airplay"
    ? await readAirplayPlaybackMetadata()
    : null;
  const hasBluetoothTrackMetadata = Boolean(bluetoothPlaybackMetadata?.title);
  const hasAirplayTrackMetadata = Boolean(airplayPlaybackMetadata?.title);
  const metadata = hasCurrentTrack
    ? includeSlowRuntimeStatus
      ? await readMediaMetadata(file)
      : buildFastTrackMetadata({ title, artist, album, file })
    : {
        title: null,
        artist: null,
        album: null,
        artworkMimeType: null,
        artworkToken: null,
        absolutePath: null
      };

  if (includeSlowRuntimeStatus) {
    currentArtworkState = hasCurrentTrack
      ? await resolveCurrentArtworkState({
          playbackSource,
          metadata,
          fallbackTitle: radioPlaybackMetadata?.title || title || trackTitleFromFile(file),
          fallbackArtist: radioPlaybackMetadata?.artist || artist || "Unknown Artist",
          fallbackAlbum: radioPlaybackMetadata?.album || album || "MPD Queue"
        })
      : null;
  }

  return {
    playback: {
      state: isSceneSource
        ? scenePlaybackState
        : playbackSource === "bluetooth"
        ? mapBluetoothPlaybackState(bluetoothPlaybackMetadata)
        : playbackSource === "airplay"
          ? audio.currentSource.connectionState === "connected" ? mapBluetoothPlaybackState(airplayPlaybackMetadata) : "stopped"
        : playbackSource === "spotify"
          ? audio.currentSource.connectionState === "connected" ? "playing" : "stopped"
        : playbackSource === "upnp"
          ? audio.currentSource.connectionState === "connected" ? "playing" : "stopped"
        : hasCurrentTrack ? status.state : "stopped",
      source: playbackSource,
      albumArtUrl: playbackSource === "bluetooth"
        ? bluetoothPlaybackMetadata?.artworkUrl ?? null
        : playbackSource === "airplay"
          ? airplayPlaybackMetadata?.artworkUrl ?? null
          : !isExternalHandoffSource && hasCurrentTrack && includeSlowRuntimeStatus && currentArtworkState ? `/api/v1/media/artwork?track=${encodeURIComponent(currentArtworkState.token)}` : null,
      title: isSceneSource
          ? "Scene Audio"
          : playbackSource === "radio"
          ? radioPlaybackMetadata?.title || metadata.title || title || RADIO_LABEL
          : playbackSource === "spotify"
            ? "Spotify Connect Ready"
          : playbackSource === "upnp"
            ? "DLNA Ready"
          : playbackSource === "bluetooth"
            ? bluetoothPlaybackMetadata?.title || "Bluetooth Ready"
            : playbackSource === "airplay"
              ? airplayPlaybackMetadata?.title || "AirPlay Ready"
          : hasCurrentTrack ? metadata.title || title || trackTitleFromFile(file) : null,
      artist: isSceneSource
          ? currentSceneVideo.label
          : playbackSource === "radio"
          ? radioPlaybackMetadata?.artist || metadata.artist || artist || "Internet Radio"
          : playbackSource === "spotify"
            ? audio.currentSource.connectedLabel
              || (audio.currentSource.advertisedLabel ? `Choose ${audio.currentSource.advertisedLabel} in Spotify` : "Choose Tikpal in Spotify")
          : playbackSource === "upnp"
            ? audio.currentSource.connectedLabel
              || (audio.currentSource.advertisedLabel ? `Cast to ${audio.currentSource.advertisedLabel} with DLNA` : "Cast to Tikpal with DLNA")
          : playbackSource === "bluetooth"
            ? bluetoothPlaybackMetadata?.artist || (hasBluetoothTrackMetadata
              ? null
              : audio.currentSource.connectedLabel
                || (audio.currentSource.advertisedLabel ? `Find ${audio.currentSource.advertisedLabel} in Bluetooth` : "Pair a device to start playback"))
          : playbackSource === "airplay"
              ? airplayPlaybackMetadata?.artist || (hasAirplayTrackMetadata
                ? null
                : audio.currentSource.connectedLabel
                  || (audio.currentSource.advertisedLabel ? `Choose ${audio.currentSource.advertisedLabel} from AirPlay` : "Choose Tikpal from AirPlay"))
          : hasCurrentTrack ? metadata.artist || artist || "Unknown Artist" : null,
      album: isSceneSource
          ? currentSceneVideo.label
          : playbackSource === "radio"
          ? radioPlaybackMetadata?.album || metadata.album || album || "Radio"
          : playbackSource === "spotify"
            ? "Spotify Connect"
          : playbackSource === "upnp"
            ? "DLNA Source"
          : playbackSource === "bluetooth"
            ? bluetoothPlaybackMetadata?.album || null
            : playbackSource === "airplay"
              ? airplayPlaybackMetadata?.album || "AirPlay Source"
          : hasCurrentTrack ? metadata.album || album || "MPD Queue" : null,
      elapsedSeconds: isSceneSource
        ? null
        : playbackSource === "bluetooth"
        ? millisecondsToSeconds(bluetoothPlaybackMetadata?.positionMs)
        : playbackSource === "airplay"
          ? millisecondsToSeconds(airplayPlaybackMetadata?.positionMs)
        : playbackSource === "spotify"
          || playbackSource === "upnp"
          ? null
        : isMpdBackedSource && hasCurrentTrack ? status.elapsedSeconds : null,
      durationSeconds: isSceneSource
        ? null
        : playbackSource === "bluetooth"
        ? millisecondsToSeconds(bluetoothPlaybackMetadata?.durationMs, { allowZero: false })
        : playbackSource === "airplay"
          ? millisecondsToSeconds(airplayPlaybackMetadata?.durationMs, { allowZero: false })
        : playbackSource === "spotify"
          || playbackSource === "upnp"
          ? null
        : isMpdBackedSource && hasCurrentTrack ? durationSeconds : null,
      timingDiagnostics: playbackSource === "bluetooth"
        ? bluetoothPlaybackMetadata?.timingDiagnostics ?? null
        : playbackSource === "airplay"
          ? airplayPlaybackMetadata?.timingDiagnostics ?? null
          : null,
      currentTrackIndex: playbackSource === "mpd" ? status.currentTrackIndex : 0,
      queueLength: playbackSource === "mpd" ? status.queueLength : 0,
      favorite: isMpdBackedSource && hasCurrentTrack ? isFavoriteTrackPath(file) : false,
      settings: status.settings,
      queuePreview: playbackSource === "mpd" ? queuePreview : []
    },
    system: {
      ...nextSystem,
      volume: {
        db: Number((-72 + volumePercent * 0.68).toFixed(1)),
        percent: volumePercent,
        muted: volumePercent <= 0
      }
    },
    audio
  };
}

async function loadDefaultMpdQueue() {
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

async function ensureMpcQueue() {
  const statusRaw = await runMpc(["status"], { allowFailure: true });
  const status = parseMpcStatus(statusRaw);
  if (status.queueLength > 0) return;
  await loadDefaultMpdQueue();
}

async function ensureMpcPlaybackStarted(position = null) {
  const playArgs = position === null ? ["play"] : ["play", String(position)];
  await runMpc(playArgs);

  let status = parseMpcStatus(await runMpc(["status"], { allowFailure: true }));
  if (status.queueLength > 0 && status.state !== "playing") {
    await runMpc(["play"]);
    status = parseMpcStatus(await runMpc(["status"], { allowFailure: true }));
  }

  if (status.queueLength > 0 && status.state !== "playing") {
    throw new Error("MPD did not enter playing state after playback start");
  }
}

async function switchToMpdSource() {
  await loadDefaultMpdQueue();
  await ensureMpcPlaybackStarted();
}

async function switchToLocalLibraryTrack(localTrackPath) {
  const track = await findLocalAudioLibraryTrackByPath(localTrackPath);
  if (!track?.path) {
    throw new Error(`Unknown local library track: ${localTrackPath}`);
  }

  const queue = await resolveMpdLocalLibraryQueue(track.path);
  if (!queue) {
    throw new Error(`Local library track is not available in MPD: ${track.path}`);
  }

  await enforceConnectionGate("mpd");
  await runMpc(["clear"]);
  if (queue.addRootPath) {
    await runMpc(["add", queue.addRootPath]);
  } else {
    for (const mpdTrackPath of queue.mpdTrackPaths.slice(0, 250)) {
      await runMpc(["add", mpdTrackPath]);
    }
  }
  await ensureMpcPlaybackStarted(queue.startIndex + 1);
}

async function switchToAudioSource() {
  await enforceConnectionGate("audio");
  await switchToMpdSource();
}

async function switchToRadioSource(action = {}) {
  const radioStations = await getAvailableRadioStations();
  const selectedStation = action.radioStationId
    ? radioStations.find((station) => station.id === action.radioStationId)
    : null;

  if (action.radioStationId && !selectedStation) {
    throw new Error(`Unknown radio station: ${action.radioStationId}`);
  }

  const targetUri = selectedStation?.uri ?? radioStations[0]?.uri ?? RADIO_DEFAULT_URI ?? "";

  if (!targetUri && RADIO_ACTIVATE_COMMAND) {
    await runSystemActionCommand(RADIO_ACTIVATE_COMMAND, "radio");
    return;
  }

  if (!targetUri) {
    throw new Error("radio is unavailable in this runtime");
  }

  await runMpc(["clear"]);
  await runMpc(["add", targetUri]);
  await ensureMpcPlaybackStarted();
}

async function switchToSpotifySource() {
  await enforceConnectionGate("spotify");
  await runMpc(["stop"], { allowFailure: true });
}

async function switchToBluetoothSource() {
  await enforceConnectionGate("bluetooth");
  await runMpc(["stop"], { allowFailure: true });
}

async function switchToAirplaySource() {
  await enforceConnectionGate("airplay");
  await runMpc(["stop"], { allowFailure: true });
}

async function switchToUpnpSource() {
  await enforceConnectionGate("upnp");
  await runMpc(["stop"], { allowFailure: true });
}

async function switchToSceneSource(action = {}) {
  activateSceneAudio(action);
  await enforceConnectionGate("scene");
  await runMpc(["stop"], { allowFailure: true });
}

async function applyMpcPlayMode(mode) {
  switch (mode) {
    case "sequence":
      await runMpc(["random", "off"]);
      await runMpc(["repeat", "off"]);
      await runMpc(["single", "off"]);
      break;
    case "repeat_one":
      await runMpc(["random", "off"]);
      await runMpc(["repeat", "on"]);
      await runMpc(["single", "on"]);
      break;
    case "shuffle":
      await runMpc(["random", "on"]);
      await runMpc(["repeat", "off"]);
      await runMpc(["single", "off"]);
      break;
    default:
      throw new Error(`Unsupported playback mode: ${mode}`);
  }
}

async function applyMpcPlaybackActionUnlocked(action) {
  if (mockArmedSource === "scene") {
    switch (action.type) {
      case "play_pause":
        scenePlaybackState = scenePlaybackState === "playing" ? "stopped" : "playing";
        return;
      case "play":
        scenePlaybackState = "playing";
        return;
      case "pause":
        scenePlaybackState = "stopped";
        return;
      case "next":
      case "previous":
      case "seek":
      case "favorite_toggle":
      case "play_mode_set":
        return;
      case "volume_set": {
        const percent = Number(action.value);
        if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
          throw new Error("volume_set requires value between 0 and 100");
        }
        await setOutputVolumePercent(percent);
        return;
      }
      default:
        throw new Error(`Unsupported playback action: ${action.type}`);
    }
  }

  switch (action.type) {
    case "play_pause": {
      await ensureMpcQueue();
      const status = parseMpcStatus(await runMpc(["status"], { allowFailure: true }));
      if (status.state === "playing") {
        await runMpc(["pause"]);
      } else {
        await ensureMpcPlaybackStarted();
      }
      break;
    }
    case "play":
      await ensureMpcQueue();
      await ensureMpcPlaybackStarted();
      break;
    case "pause":
      await runMpc(["pause"]);
      break;
    case "next":
      await ensureMpcQueue();
      await runMpc(["next"]);
      await ensureMpcPlaybackStarted();
      break;
    case "previous":
      await ensureMpcQueue();
      await runMpc(["prev"]);
      await ensureMpcPlaybackStarted();
      break;
    case "seek": {
      const seconds = Number(action.value);
      if (!Number.isFinite(seconds) || seconds < 0) {
        throw new Error("seek requires a non-negative value");
      }
      await runMpc(["seek", formatMpcSeek(seconds)]);
      break;
    }
    case "favorite_toggle": {
      const currentFile = (await runMpc(["--format", "%file%", "current"], { allowFailure: true })).trim();
      await toggleFavoriteTrackPath(currentFile);
      break;
    }
    case "play_mode_set": {
      const mode = normalizePlaybackMode(action.mode);
      await applyMpcPlayMode(mode);
      break;
    }
    case "volume_set": {
      const percent = Number(action.value);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        throw new Error("volume_set requires value between 0 and 100");
      }
      if (mockArmedSource === "scene" || mockArmedSource === "bluetooth" || mockArmedSource === "airplay" || mockArmedSource === "upnp") {
        await setOutputVolumePercent(percent);
      } else {
        await runMpc(["volume", String(Math.round(percent))]);
      }
      break;
    }
    default:
      throw new Error(`Unsupported playback action: ${action.type}`);
  }
}

async function applyMpcPlaybackAction(action) {
  return await withMpcMutationLock(() => applyMpcPlaybackActionUnlocked(action));
}

async function primeMpcPlayback() {
  try {
    await withMpcMutationLock(async () => {
      await ensureMpcQueue();
      const status = parseMpcStatus(await runMpc(["status"], { allowFailure: true }));
      if (status.state !== "playing" || status.queueLength === 0) {
        if (Number.isFinite(MPD_STARTUP_VOLUME) && MPD_STARTUP_VOLUME >= 0 && MPD_STARTUP_VOLUME <= 100) {
          await runMpc(["volume", String(Math.round(MPD_STARTUP_VOLUME))]);
        }
        await ensureMpcPlaybackStarted();
      }
    });
  } catch (error) {
    console.warn(`tikpal-api mpc prime failed: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

async function getPlaybackSnapshot() {
  if (API_MODE === "mpc") {
    return (await getTikpalState()).playback;
  }
  return getPlayback();
}

function getMockAudioSnapshot() {
  const radioStations = getMockRadioStations();
  const audioConnected = mockActiveSource === "audio";
  const spotifyConnected = mockActiveSource === "spotify" && Date.now() - mockSpotifyArmedAt >= MOCK_SPOTIFY_CONNECT_AFTER_MS;
  const bluetoothConnected = mockActiveSource === "bluetooth" && Date.now() - mockBluetoothArmedAt >= MOCK_BLUETOOTH_CONNECT_AFTER_MS;
  const airplayConnected = mockActiveSource === "airplay" && Date.now() - mockAirplayArmedAt >= MOCK_AIRPLAY_CONNECT_AFTER_MS;
  const upnpConnected = mockActiveSource === "upnp" && Date.now() - mockUpnpArmedAt >= MOCK_UPNP_CONNECT_AFTER_MS;
  return buildAudioState({
    activeSource: mockActiveSource,
    armedSource: mockArmedSource,
    radioReady: true,
    radioActive: mockActiveSource === "radio",
    radioStations,
    audioSourceState: {
      supported: true,
      available: true,
      armed: mockArmedSource === "audio",
      connected: audioConnected,
      connectedLabel: audioConnected ? system.outputDevice.label : null,
      advertisedLabel: null
    },
    spotifyState: {
      supported: true,
      available: true,
      armed: mockArmedSource === "spotify",
      connected: spotifyConnected,
      connectedLabel: spotifyConnected ? "Spotify Connect" : null,
      advertisedLabel: "Tikpal Speaker"
    },
    bluetoothState: {
      supported: true,
      available: true,
      armed: mockArmedSource === "bluetooth",
      connected: bluetoothConnected,
      connectedLabel: bluetoothConnected ? "Tikpal Demo Phone" : null,
      advertisedLabel: "Tikpal Speaker"
    },
    airplayState: {
      supported: true,
      available: true,
      armed: mockArmedSource === "airplay",
      connected: airplayConnected,
      connectedLabel: airplayConnected ? "Living Room iPhone" : null,
      advertisedLabel: "Tikpal Speaker"
    },
    upnpState: {
      supported: true,
      available: true,
      armed: mockArmedSource === "upnp",
      connected: upnpConnected,
      connectedLabel: upnpConnected ? "DLNA Controller" : null,
      advertisedLabel: "Tikpal Speaker"
    }
  });
}

async function getMockSystemSnapshot() {
  const experience = await readRoomExperienceState();
  return {
    ...system,
    display: {
      ...system.display
    },
    dspState: buildDspState(experience, {
      enabled: true,
      controllable: true,
      controlTransport: "mock"
    }),
    library: {
      ...system.library,
      scanning: Date.now() - lastMockLibraryScanAt < 2000
    }
  };
}

function buildMockRuntimeSnapshot() {
  return buildRuntimeSnapshot(REQUESTED_KIOSK_WINDOW);
}

function buildFallbackMpcStateSnapshot() {
  const audio = buildMinimalMpcAudioSnapshot();
  const playback = {
    ...getPlayback(),
    state: mockArmedSource === "scene" ? scenePlaybackState : "stopped",
    source: audio.currentSource.id,
    albumArtUrl: null,
    elapsedSeconds: null,
    durationSeconds: null,
    currentTrackIndex: 0,
    queueLength: 0,
    favorite: false,
    queuePreview: []
  };

  return {
    playback,
    system: {
      ...system,
      library: {
        ...system.library,
        source: "MPD"
      }
    },
    runtime: buildRuntimeSnapshot(),
    audio,
    lyrics: lyricsState
  };
}

function withCurrentVolatileState(state) {
  return {
    ...state,
    lyrics: lyricsState
  };
}

function readCachedTikpalState() {
  return withCurrentVolatileState(tikpalStateSnapshotCache?.state ?? buildFallbackMpcStateSnapshot());
}

function cacheTikpalStateSnapshot(state) {
  tikpalStateSnapshotCache = {
    state: withCurrentVolatileState(state),
    updatedAtMs: Date.now(),
    error: null
  };
  return readCachedTikpalState();
}

async function collectTikpalStateSnapshot(options = {}) {
  if (!options.skipExperienceReconcile) {
    await reconcileRoomExperienceState(await readRoomExperienceState());
  }

  const includeSlowRuntimeStatus = options.includeSlowRuntimeStatus !== false;
  const snapshot = API_MODE === "mpc"
    ? await getMpcSnapshot({ includeSlowRuntimeStatus })
    : {
        playback: getPlayback(),
        system: await getMockSystemSnapshot(),
        audio: getMockAudioSnapshot()
      };
  const runtime = API_MODE === "mpc"
    ? includeSlowRuntimeStatus ? await getRuntimeSnapshot() : getCachedRuntimeSnapshot()
    : buildMockRuntimeSnapshot();
  const lyrics = scheduleLyricsRecognition(snapshot);

  return {
    playback: snapshot.playback,
    system: snapshot.system,
    runtime,
    audio: snapshot.audio,
    lyrics
  };
}

function requestTikpalStateSnapshotRefresh({ force = false } = {}) {
  if (API_MODE !== "mpc") return null;
  const now = Date.now();
  if (!force && tikpalStateSnapshotCache && now - tikpalStateSnapshotCache.updatedAtMs < STATE_SNAPSHOT_REFRESH_MS) {
    return null;
  }
  if (tikpalStateSnapshotRefreshPromise) {
    return tikpalStateSnapshotRefreshPromise;
  }

  tikpalStateSnapshotRefreshPromise = collectTikpalStateSnapshot({ includeSlowRuntimeStatus: true })
    .then((state) => cacheTikpalStateSnapshot(state))
    .catch((error) => {
      const message = error instanceof Error ? error.message : "unknown error";
      console.warn(`tikpal-api state snapshot refresh failed: ${message}`);
      if (tikpalStateSnapshotCache) {
        tikpalStateSnapshotCache.error = message;
      }
      return readCachedTikpalState();
    })
    .finally(() => {
      tikpalStateSnapshotRefreshPromise = null;
    });

  return tikpalStateSnapshotRefreshPromise;
}

async function refreshTikpalStateSnapshotAfterMutation() {
  if (API_MODE !== "mpc") {
    return await collectTikpalStateSnapshot();
  }

  try {
    const state = await collectTikpalStateSnapshot({
      includeSlowRuntimeStatus: false,
      skipExperienceReconcile: true
    });
    cacheTikpalStateSnapshot(state);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.warn(`tikpal-api fast state refresh failed: ${message}`);
  }

  void requestTikpalStateSnapshotRefresh({ force: true });
  return readCachedTikpalState();
}

async function getTikpalState(options = {}) {
  if (API_MODE !== "mpc") {
    return await collectTikpalStateSnapshot(options);
  }

  void requestTikpalStateSnapshotRefresh();
  return readCachedTikpalState();
}

function startTikpalStateSnapshotCollector() {
  if (API_MODE !== "mpc" || tikpalStateSnapshotRefreshTimer) return;
  void requestTikpalStateSnapshotRefresh({ force: true });
  tikpalStateSnapshotRefreshTimer = setInterval(() => {
    void requestTikpalStateSnapshotRefresh({ force: true });
  }, STATE_SNAPSHOT_REFRESH_MS);
  tikpalStateSnapshotRefreshTimer.unref?.();
}

async function getAudioSourcesPayload() {
  const state = await getTikpalState();
  return {
    currentSource: state.audio.currentSource,
    sources: state.audio.sources,
    updatedAt: state.runtime.updatedAt
  };
}

function normalizeSpectrumBands(value) {
  const bands = Array.isArray(value) ? value.slice(0, 32).map((band) => {
    const numeric = Number(band);
    return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 0;
  }) : [];
  while (bands.length < 32) {
    bands.push(0);
  }
  return bands;
}

function normalizeAudioSpectrumFrame(raw, source) {
  const bands = normalizeSpectrumBands(raw?.bands ?? raw);
  const peaks = raw?.peaks ?? {};
  const left = Number(peaks.left ?? raw?.leftPeak ?? raw?.peakLeft ?? bands[8] ?? 0);
  const right = Number(peaks.right ?? raw?.rightPeak ?? raw?.peakRight ?? bands[23] ?? 0);
  return {
    bands,
    peaks: {
      left: Number.isFinite(left) ? Math.max(0, Math.min(1, left)) : 0,
      right: Number.isFinite(right) ? Math.max(0, Math.min(1, right)) : 0
    },
    source,
    bandCount: 32,
    updatedAt: new Date().toISOString()
  };
}

async function buildMockAudioSpectrumFrame() {
  const experience = await readRoomExperienceState();
  const preset = getHifiEqPreset(experience.hifiEqPresetId);
  const now = Date.now() / 1000;
  const volumeGain = 0.42 + Math.max(0, Math.min(1, system.volume.percent / 100)) * 0.42;
  const bands = Array.from({ length: 32 }, (_, index) => {
    const position = index / 31;
    const wave = (Math.sin(now * 2.1 + index * 0.47) + Math.cos(now * 1.4 + index * 0.23) + 2) / 4;
    const eqShape = preset.id === "warm"
      ? 1.14 - position * 0.24
      : preset.id === "vocal"
        ? 0.82 + Math.exp(-Math.pow((position - 0.56) / 0.24, 2)) * 0.42
        : 0.92 + position * 0.08;
    return Math.max(0, Math.min(1, (0.18 + wave * 0.72) * eqShape * volumeGain));
  });
  const left = Math.max(...bands.slice(0, 16));
  const right = Math.max(...bands.slice(16));
  return normalizeAudioSpectrumFrame({ bands, peaks: { left, right } }, "mock");
}

let audioSpectrumCommandCache = null;
let audioSpectrumCommandInFlight = null;

async function getCommandAudioSpectrumFrame() {
  const now = Date.now();
  if (audioSpectrumCommandCache && now - audioSpectrumCommandCache.cachedAtMs < HIFI_SPECTRUM_CACHE_MS) {
    return audioSpectrumCommandCache.frame;
  }
  if (audioSpectrumCommandInFlight) {
    if (audioSpectrumCommandCache) {
      return audioSpectrumCommandCache.frame;
    }
    return await audioSpectrumCommandInFlight;
  }

  audioSpectrumCommandInFlight = (async () => {
    const raw = await runCommand(HIFI_SPECTRUM_COMMAND, { allowFailure: false, timeout: 3000 });
    const frame = normalizeAudioSpectrumFrame(JSON.parse(raw), "command");
    audioSpectrumCommandCache = {
      frame,
      cachedAtMs: Date.now()
    };
    return frame;
  })();

  try {
    return await audioSpectrumCommandInFlight;
  } finally {
    audioSpectrumCommandInFlight = null;
  }
}

async function getAudioSpectrumFrame() {
  if (HIFI_SPECTRUM_COMMAND.trim()) {
    return await getCommandAudioSpectrumFrame();
  }
  if (API_MODE === "mpc") {
    throw new Error("TIKPAL_HIFI_SPECTRUM_COMMAND is required before Hi-Fi spectrum can be sampled in mpc mode");
  }
  return await buildMockAudioSpectrumFrame();
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Accept,X-Tikpal-Key,X-Tikpal-Local-Ui"
  });

  if (status === 204) {
    response.end();
    return;
  }

  response.end(JSON.stringify(body));
}

function sendHtml(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Accept,X-Tikpal-Key,X-Tikpal-Local-Ui"
  });
  response.end(body);
}

function sendBinary(response, status, contentType, body) {
  response.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Accept,X-Tikpal-Key,X-Tikpal-Local-Ui"
  });
  response.end(body);
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function buildGeneratedArtworkSvg({ title, artist, album }) {
  const seed = createHash("md5")
    .update(`${title}|${artist}|${album}`)
    .digest("hex");
  const hueA = Number.parseInt(seed.slice(0, 2), 16) % 360;
  const hueB = (hueA + 72 + (Number.parseInt(seed.slice(2, 4), 16) % 120)) % 360;
  const label = (album || title || "TK")
    .split(/\s+/)
    .map((word) => word[0] ?? "")
    .join("")
    .slice(0, 3)
    .toUpperCase();

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200" role="img" aria-label="${escapeXml(title || "Tikpal")}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="hsl(${hueA} 72% 58%)"/>
      <stop offset="100%" stop-color="hsl(${hueB} 68% 18%)"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="1200" rx="88" fill="url(#bg)"/>
  <circle cx="920" cy="280" r="220" fill="rgba(255,255,255,0.12)"/>
  <circle cx="300" cy="920" r="260" fill="rgba(0,0,0,0.18)"/>
  <rect x="100" y="100" width="1000" height="1000" rx="72" fill="rgba(12,16,24,0.28)" stroke="rgba(255,255,255,0.16)"/>
  <text x="600" y="520" text-anchor="middle" fill="rgba(255,255,255,0.94)" font-family="Helvetica, Arial, sans-serif" font-size="220" font-weight="700">${escapeXml(label || "TK")}</text>
  <text x="130" y="860" fill="rgba(255,255,255,0.96)" font-family="Helvetica, Arial, sans-serif" font-size="80" font-weight="700">${escapeXml(title || "Not Playing")}</text>
  <text x="130" y="935" fill="rgba(255,255,255,0.78)" font-family="Helvetica, Arial, sans-serif" font-size="46">${escapeXml(artist || "Unknown Artist")}</text>
  <text x="130" y="995" fill="rgba(255,255,255,0.62)" font-family="Helvetica, Arial, sans-serif" font-size="38">${escapeXml(album || "MPD Queue")}</text>
</svg>`;
}

function buildLyricsState(overrides = {}) {
  return {
    status: "idle",
    sourceScope: "local_playback",
    providerMode: "online",
    recognitionMode: null,
    recognitionProvider: null,
    recognitionConfidence: null,
    trackKey: null,
    title: null,
    artist: null,
    synced: false,
    timingStrategy: null,
    activeLineIndex: null,
    lines: [],
    message: null,
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

function buildBluetoothRecognitionSession(overrides = {}) {
  return {
    connectionKey: null,
    connectedAtMs: 0,
    resolvedState: null,
    retryAfterMs: 0,
    inFlight: null,
    ...overrides
  };
}

function isProxyInputSource(source) {
  return source === "bluetooth" || source === "airplay";
}

function isProxyInputSourceScope(sourceScope) {
  return sourceScope === "bluetooth_input" || sourceScope === "airplay_input";
}

function getProxyInputScope(source) {
  return source === "airplay" ? "airplay_input" : "bluetooth_input";
}

function getProxyInputLabel(source) {
  return source === "airplay" ? "AirPlay" : "Bluetooth";
}

function normalizeMetadataValue(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function buildPlaybackTrackKey({ source, title, artist, album, durationSeconds }) {
  const normalizedTitle = normalizeMetadataValue(title);
  if (!normalizedTitle) return null;
  const payload = [
    source,
    normalizedTitle.toLowerCase(),
    normalizeMetadataValue(artist).toLowerCase(),
    normalizeMetadataValue(album).toLowerCase(),
    Number.isFinite(durationSeconds) ? String(Math.round(durationSeconds)) : ""
  ].join("|");
  return createHash("sha1").update(payload).digest("hex");
}

function cloneLyricsState(state, overrides = {}) {
  return buildLyricsState({
    ...state,
    ...overrides
  });
}

function decorateLyricsState(state, candidate, overrides = {}) {
  return cloneLyricsState(state, {
    trackKey: state.trackKey ?? candidate.trackKey ?? null,
    title: state.title ?? candidate.title ?? null,
    artist: state.artist ?? candidate.artist ?? null,
    sourceScope: candidate.sourceScope,
    recognitionMode: candidate.recognitionMode ?? null,
    recognitionProvider: candidate.recognitionProvider ?? null,
    recognitionConfidence: candidate.recognitionConfidence ?? null,
    ...overrides
  });
}

function buildMetadataLyricsCandidate(playback, overrides = {}) {
  return {
    supported: true,
    source: playback.source,
    sourceScope: overrides.sourceScope ?? "local_playback",
    recognitionMode: "metadata",
    recognitionProvider: "lrclib",
    trackKey: buildPlaybackTrackKey(playback),
    title: normalizeMetadataValue(playback.title),
    artist: normalizeMetadataValue(playback.artist),
    album: normalizeMetadataValue(playback.album),
    durationMs: Number.isFinite(playback.durationSeconds) ? Math.round(playback.durationSeconds * 1000) : null,
    playbackClock: Number.isFinite(playback.elapsedSeconds)
  };
}

function getProxyInputSourceSummary(audio, source) {
  if (audio?.currentSource?.id === source) {
    return audio.currentSource;
  }
  return Array.isArray(audio?.sources) ? audio.sources.find((entry) => entry.id === source) ?? null : null;
}

function buildProxyInputConnectionKey(sourceSummary, source) {
  return [
    source,
    sourceSummary?.connectedLabel ?? "",
    sourceSummary?.advertisedLabel ?? "",
    sourceSummary?.connectionState ?? ""
  ].join("|");
}

function getLyricsCandidate(snapshot) {
  const playback = snapshot?.playback ?? {};
  const audio = snapshot?.audio ?? null;

  if (isProxyInputSource(playback.source)) {
    const source = playback.source;
    const sourceSummary = getProxyInputSourceSummary(audio, source);
    const sourceScope = getProxyInputScope(source);
    const sourceLabel = getProxyInputLabel(source);

    if (!sourceSummary?.armed && !sourceSummary?.active) {
      return {
        supported: false,
        sourceScope,
        reason: `Select ${sourceLabel} to identify incoming audio`
      };
    }

    if (sourceSummary.connectionState !== "connected") {
      return {
        supported: false,
        sourceScope,
        reason: `Waiting for ${sourceLabel} audio`
      };
    }

    const metadataCandidate = buildMetadataLyricsCandidate(playback, {
      sourceScope
    });
    if (metadataCandidate.trackKey && !looksLikeUntrustedTrackMetadata(metadataCandidate)) {
      return metadataCandidate;
    }

    return {
      supported: true,
      source,
      sourceScope,
      recognitionMode: "fingerprint",
      recognitionProvider: "acrcloud",
      recognitionConfidence: null,
      connectionKey: buildProxyInputConnectionKey(sourceSummary, source),
      title: null,
      artist: sourceSummary.connectedLabel ?? playback.artist ?? null,
      album: null,
      durationMs: Number.isFinite(playback.durationSeconds) ? Math.round(playback.durationSeconds * 1000) : null,
      playbackClock: Number.isFinite(playback.elapsedSeconds)
    };
  }

  if ((playback.source !== "mpd" && playback.source !== "audio" && playback.source !== "radio") || !playback.title) {
    return {
      supported: false,
      sourceScope: "local_playback",
      reason: null
    };
  }

  return buildMetadataLyricsCandidate(playback);
}

function looksLikeUntrustedTrackMetadata(candidate) {
  const title = normalizeMetadataValue(candidate?.title).toLowerCase();
  const artist = normalizeMetadataValue(candidate?.artist).toLowerCase();
  const album = normalizeMetadataValue(candidate?.album).toLowerCase();
  if (!title) return true;
  const placeholderPhrases = new Set([
    "bluetooth ready",
    "bluetooth pairing",
    "airplay ready",
    "airplay waiting",
    "bluetooth source",
    "airplay source",
    "pair a device to start playback",
    "waiting for bluetooth audio",
    "waiting for airplay audio"
  ]);
  const guidePrefixes = ["find ", "choose ", "select ", "look for "];
  const metadataFields = [title, artist, album].filter(Boolean);
  const metadataLooksPlaceholder = metadataFields.some((value) => {
    if (placeholderPhrases.has(value)) return true;
    if (guidePrefixes.some((prefix) => value.startsWith(prefix))) return true;
    const mentionsProxySource = value.includes("bluetooth") || value.includes("airplay");
    const mentionsPromptState = value.includes("ready")
      || value.includes("waiting")
      || value.includes("pair")
      || value.includes("choose")
      || value.includes("select")
      || value.includes("open")
      || value.includes("source");
    return mentionsProxySource && mentionsPromptState;
  });
  if (metadataLooksPlaceholder) {
    return true;
  }
  const unknownArtist = !artist || artist === "unknown artist" || artist === "internet radio";
  const titleLooksSynthetic = title.includes("http")
    || title.includes(".mp3")
    || title.includes(".aac")
    || title.includes("_")
    || title.includes("stream")
    || title.includes("radio");
  return unknownArtist && titleLooksSynthetic;
}

function lyricsErrorMessage(error) {
  if (error?.name === "AbortError") return "Lyrics lookup timed out";
  if (error instanceof Error && error.message) {
    const rawMessage = normalizeMetadataValue(error.message);
    const lowerMessage = rawMessage.toLowerCase();
    if (!rawMessage) return "Lyrics lookup failed";
    if (lowerMessage.includes("airplay capture")) {
      return "AirPlay audio capture unavailable";
    }
    if (lowerMessage.includes("bluealsa")
      || lowerMessage.includes("bluetooth capture")
      || lowerMessage.includes("no readable bluealsa input device was found")
      || lowerMessage.includes("error opening input file")
      || lowerMessage.includes("device or resource busy")) {
      return "Bluetooth audio capture unavailable";
    }
    if (lowerMessage.includes("acrcloud request failed")
      || lowerMessage.includes("acrcloud recognition failed")) {
      return "Track identification unavailable";
    }
    if (lowerMessage.includes("acrcloud credentials are not configured")
      || lowerMessage.includes("acrcloud host is not configured")
      || lowerMessage.includes("bluetooth recognition provider is not configured")
      || lowerMessage.includes("airplay recognition provider is not configured")) {
      return "Track identification is not configured";
    }
    if (rawMessage.length > 140 || error.message.includes("\n")) {
      return "Lyrics lookup failed";
    }
    return rawMessage;
  }
  return "Lyrics lookup failed";
}

function parseLyricsTimestampMs(raw) {
  const match = String(raw).trim().match(/^(\d+):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const fraction = match[3] ?? "0";
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  const milliseconds = Number(fraction.padEnd(3, "0").slice(0, 3));
  return minutes * 60_000 + seconds * 1000 + milliseconds;
}

function parseSyncedLyrics(rawLyrics) {
  if (!rawLyrics) return [];
  const parsed = [];
  for (const rawLine of String(rawLyrics).split(/\r?\n/)) {
    const matches = [...rawLine.matchAll(/\[([^\]]+)\]/g)];
    if (matches.length === 0) continue;
    const text = rawLine.replace(/\[[^\]]+\]/g, "").trim();
    if (!text) continue;
    for (const match of matches) {
      const startMs = parseLyricsTimestampMs(match[1]);
      if (startMs === null) continue;
      parsed.push({
        text,
        startMs,
        endMs: null
      });
    }
  }

  parsed.sort((left, right) => {
    if (left.startMs === null && right.startMs === null) return 0;
    if (left.startMs === null) return 1;
    if (right.startMs === null) return -1;
    return left.startMs - right.startMs;
  });

  return parsed.map((line, index) => ({
    ...line,
    endMs: parsed[index + 1]?.startMs ?? null
  }));
}

function parseUnsyncedLyrics(rawLyrics) {
  if (!rawLyrics) return [];
  return String(rawLyrics)
    .split(/\n\s*\n/)
    .map((block) => block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join(" "))
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => ({
      text,
      startMs: null,
      endMs: null
    }));
}

function parseBluetoothStaticLyrics(rawLyrics) {
  if (!rawLyrics) return [];
  return String(rawLyrics)
    .split(/\r?\n/)
    .map((line) => normalizeMetadataValue(line))
    .filter(Boolean)
    .map((text) => ({
      text,
      startMs: null,
      endMs: null
    }));
}

function convertSyncedLinesToStaticLines(lines) {
  return lines
    .map((line) => normalizeMetadataValue(line.text))
    .filter(Boolean)
    .map((text) => ({
      text,
      startMs: null,
      endMs: null
    }));
}

function buildBluetoothSyncedLyricsTiming(lines, durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < BLUETOOTH_LYRICS_MIN_TIMED_DURATION_MS || lines.length === 0) {
    return {
      synced: true,
      timingStrategy: "provider_synced",
      lines
    };
  }

  const timedLines = lines.filter((line) => Number.isFinite(line.startMs));
  const lastStartMs = timedLines.at(-1)?.startMs;
  if (!Number.isFinite(lastStartMs) || lastStartMs <= durationMs + BLUETOOTH_LYRICS_DURATION_GRACE_MS) {
    return {
      synced: true,
      timingStrategy: "provider_synced",
      lines: lines.map((line) => ({
        ...line,
        endMs: Number.isFinite(line.endMs) ? Math.min(line.endMs, durationMs) : line.endMs
      }))
    };
  }

  const durationLimitMs = durationMs + BLUETOOTH_LYRICS_DURATION_GRACE_MS;
  const clipped = lines
    .filter((line) => !Number.isFinite(line.startMs) || line.startMs <= durationLimitMs)
    .map((line) => ({
      ...line,
      endMs: Number.isFinite(line.endMs) ? Math.min(line.endMs, durationMs) : line.endMs
    }));
  const clippedTimedLineCount = clipped.filter((line) => Number.isFinite(line.startMs)).length;
  const minimumUsefulLineCount = Math.min(2, timedLines.length);

  if (clippedTimedLineCount >= minimumUsefulLineCount) {
    return {
      synced: true,
      timingStrategy: "bluez_duration_clipped",
      lines: clipped
    };
  }

  return {
    synced: false,
    timingStrategy: "static_duration_mismatch",
    lines: []
  };
}

function buildEstimatedTimedLyrics(lines, durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 30_000 || lines.length < 2) {
    return [];
  }

  const introMs = Math.min(12_000, Math.max(2_500, Math.round(durationMs * 0.045)));
  const outroMs = Math.min(8_000, Math.max(1_500, Math.round(durationMs * 0.035)));
  const availableMs = Math.max(lines.length * 400, durationMs - introMs - outroMs);
  const weights = lines.map((line) => {
    const wordCount = normalizeMetadataValue(line.text).split(/\s+/).filter(Boolean).length;
    return Math.max(1.2, Math.min(5.5, 0.8 + wordCount * 0.34));
  });
  const totalWeight = weights.reduce((total, weight) => total + weight, 0) || 1;
  let consumedWeight = 0;

  return lines.map((line, index) => {
    const isLast = index === lines.length - 1;
    const startMs = Math.min(
      durationMs,
      Math.round(introMs + (availableMs * consumedWeight) / totalWeight)
    );
    consumedWeight += weights[index];
    const endMs = isLast
      ? durationMs
      : Math.min(durationMs, Math.round(introMs + (availableMs * consumedWeight) / totalWeight));

    return {
      ...line,
      startMs,
      endMs
    };
  });
}

function buildDisplayableLyricsLines(lyricsBody, candidate) {
  const syncedLines = parseSyncedLyrics(lyricsBody?.syncedLyrics);
  const plainLines = parseUnsyncedLyrics(lyricsBody?.plainLyrics);

  if (isProxyInputSourceScope(candidate.sourceScope)) {
    const syncedTiming = buildBluetoothSyncedLyricsTiming(syncedLines, candidate.durationMs);
    if (candidate.playbackClock && syncedLines.length > 0) {
      if (syncedTiming.lines.length > 0) {
        return syncedTiming;
      }

      const displayLines = parseBluetoothStaticLyrics(lyricsBody?.plainLyrics);
      return {
        synced: false,
        timingStrategy: syncedTiming.timingStrategy,
        lines: displayLines.length > 0 ? displayLines : convertSyncedLinesToStaticLines(syncedLines)
      };
    }

    const staticLines = parseBluetoothStaticLyrics(lyricsBody?.plainLyrics);
    const displayLines = staticLines.length > 0 ? staticLines : convertSyncedLinesToStaticLines(syncedLines);
    const estimatedLines = candidate.playbackClock ? buildEstimatedTimedLyrics(displayLines, candidate.durationMs) : [];
    if (estimatedLines.length > 0) {
      return {
        synced: true,
        timingStrategy: "estimated_plain",
        lines: estimatedLines
      };
    }

    return {
      synced: false,
      timingStrategy: "plain_static",
      lines: displayLines
    };
  }

  if (syncedLines.length > 0) {
    return {
      synced: true,
      timingStrategy: "provider_synced",
      lines: syncedLines
    };
  }

  return {
    synced: false,
    timingStrategy: "plain_static",
    lines: plainLines
  };
}

async function fetchJsonWithTimeout(url, { timeoutMs = 4500, headers } = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers,
      signal: controller.signal
    });
    const text = await response.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }
    return { response, body, text };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchBinaryWithTimeout(url, { timeoutMs = 4500 } = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    const arrayBuffer = await response.arrayBuffer();
    return { response, buffer: Buffer.from(arrayBuffer) };
  } finally {
    clearTimeout(timeoutId);
  }
}

function artworkExtensionFromContentType(contentType) {
  switch (String(contentType ?? "").toLowerCase()) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      return null;
  }
}

function buildArtworkCacheKey({ artist, album }) {
  const artistLabel = normalizeMetadataValue(artist).toLowerCase();
  const albumLabel = normalizeMetadataValue(album).toLowerCase();
  if (!artistLabel || !albumLabel) return null;
  return createHash("sha1").update(`${artistLabel}|${albumLabel}`).digest("hex");
}

function buildArtworkIndexPath(cacheKey) {
  return resolve(REMOTE_ARTWORK_INDEX_DIR, `${cacheKey}.json`);
}

async function readCachedRemoteArtwork(cacheKey) {
  if (!cacheKey) return null;
  if (remoteArtworkCache.has(cacheKey)) return remoteArtworkCache.get(cacheKey);

  try {
    const payload = JSON.parse(await readFile(buildArtworkIndexPath(cacheKey), "utf8"));
    if (!payload?.filePath || !payload?.contentType) return null;
    const cached = {
      filePath: payload.filePath,
      contentType: payload.contentType,
      token: payload.token ?? `remote-${cacheKey}`
    };
    remoteArtworkCache.set(cacheKey, cached);
    return cached;
  } catch {
    return null;
  }
}

async function cacheRemoteArtwork({ cacheKey, imageUrl }) {
  await mkdir(REMOTE_ARTWORK_CACHE_DIR, { recursive: true });
  await mkdir(REMOTE_ARTWORK_INDEX_DIR, { recursive: true });

  const { response, buffer } = await fetchBinaryWithTimeout(imageUrl, {
    timeoutMs: REMOTE_METADATA_TIMEOUT_MS
  });
  if (!response.ok) {
    throw new Error(`Artwork request failed: ${response.status}`);
  }

  const contentType = response.headers.get("content-type")?.split(";")[0] ?? "";
  const extension = artworkExtensionFromContentType(contentType);
  if (!extension) {
    throw new Error("Artwork content type is unsupported");
  }

  const filePath = resolve(REMOTE_ARTWORK_CACHE_DIR, `${cacheKey}.${extension}`);
  const metadata = {
    filePath,
    contentType,
    token: `remote-${cacheKey}`
  };

  await writeFile(filePath, buffer);
  await writeFile(buildArtworkIndexPath(cacheKey), JSON.stringify(metadata));
  remoteArtworkCache.set(cacheKey, metadata);
  return metadata;
}

async function fetchRemoteArtworkForAlbum({ artist, album }) {
  const cacheKey = buildArtworkCacheKey({ artist, album });
  if (!cacheKey) return null;

  const cached = await readCachedRemoteArtwork(cacheKey);
  if (cached) return cached;

  if (remoteArtworkInFlight.has(cacheKey)) {
    return remoteArtworkInFlight.get(cacheKey);
  }

  const pending = (async () => {
    const searchUrl = new URL(`/api/v1/json/${THEAUDIODB_API_KEY}/searchalbum.php`, THEAUDIODB_BASE_URL);
    searchUrl.searchParams.set("s", artist);
    searchUrl.searchParams.set("a", album);

    const { response, body } = await fetchJsonWithTimeout(searchUrl, {
      timeoutMs: REMOTE_METADATA_TIMEOUT_MS
    });
    if (!response.ok) {
      throw new Error(`TheAudioDB album lookup failed: ${response.status}`);
    }

    const albumEntry = Array.isArray(body?.album) ? body.album.find((entry) => entry?.strAlbumThumb) : null;
    if (!albumEntry?.strAlbumThumb) return null;
    return cacheRemoteArtwork({
      cacheKey,
      imageUrl: albumEntry.strAlbumThumb
    });
  })();

  remoteArtworkInFlight.set(cacheKey, pending);
  try {
    return await pending;
  } finally {
    remoteArtworkInFlight.delete(cacheKey);
  }
}

async function resolveCurrentArtworkState({ playbackSource, metadata, fallbackTitle, fallbackArtist, fallbackAlbum }) {
  const title = metadata.title || fallbackTitle || trackTitleFromFile("") || "Not Playing";
  const artist = metadata.artist || fallbackArtist || "Unknown Artist";
  const album = metadata.album || fallbackAlbum || "MPD Queue";

  if (metadata.absolutePath && metadata.artworkMimeType) {
    return {
      kind: "embedded",
      token: metadata.artworkToken ?? buildArtworkToken(metadata.absolutePath, 0),
      mimeType: metadata.artworkMimeType,
      absolutePath: metadata.absolutePath,
      title,
      artist,
      album
    };
  }

  if (metadata.absolutePath) {
    const folderArtwork = await resolveFolderArtworkForMedia(metadata.absolutePath);
    if (folderArtwork) {
      return {
        kind: "local-file",
        token: folderArtwork.token,
        mimeType: folderArtwork.mimeType,
        localPath: folderArtwork.absolutePath,
        absolutePath: null,
        title,
        artist,
        album
      };
    }
  }

  if (playbackSource === "mpd" && metadata.absolutePath) {
    const cacheKey = buildArtworkCacheKey({ artist, album });
    const remoteArtwork = cacheKey ? await readCachedRemoteArtwork(cacheKey) : null;
    if (remoteArtwork) {
      return {
        kind: "remote",
        token: remoteArtwork.token,
        mimeType: remoteArtwork.contentType,
        remotePath: remoteArtwork.filePath,
        absolutePath: null,
        title,
        artist,
        album
      };
    }

    if (cacheKey) {
      void fetchRemoteArtworkForAlbum({ artist, album }).catch(() => null);
    }
  }

  return {
    kind: "generated",
    token: `generated-${buildPlaybackTrackKey({ source: playbackSource, title, artist, album, durationSeconds: null }) ?? "unknown"}`,
    mimeType: "image/svg+xml; charset=utf-8",
    absolutePath: null,
    title,
    artist,
    album
  };
}

async function fetchLyricsFromProvider(candidate) {
  const fetchSearchVariant = async (params) => {
    const searchUrl = new URL("/api/search", LRCLIB_BASE_URL);
    for (const [key, value] of Object.entries(params)) {
      if (value) searchUrl.searchParams.set(key, value);
    }
    const { response, body } = await fetchJsonWithTimeout(searchUrl, {
      timeoutMs: Math.max(LRCLIB_TIMEOUT_MS, 12_000)
    });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`LRCLIB search failed: ${response.status}`);
    }
    return Array.isArray(body) && body.length > 0 ? body[0] : null;
  };

  const searchVariants = [
    {
      track_name: candidate.title,
      ...(candidate.artist ? { artist_name: candidate.artist } : {})
    },
    {
      track_name: candidate.title
    }
  ];

  let lyricsBody = null;
  const shouldPreferSearch = isProxyInputSourceScope(candidate.sourceScope);

  if (shouldPreferSearch) {
    for (const params of searchVariants) {
      try {
        lyricsBody = await fetchSearchVariant(params);
      } catch (error) {
        if (lyricsErrorMessage(error) !== "Lyrics lookup timed out") {
          throw error;
        }
      }
      if (lyricsBody) break;
    }
  }

  if (!lyricsBody) {
    const exactUrl = new URL("/api/get", LRCLIB_BASE_URL);
    exactUrl.searchParams.set("track_name", candidate.title);
    if (candidate.artist) exactUrl.searchParams.set("artist_name", candidate.artist);
    if (candidate.album) exactUrl.searchParams.set("album_name", candidate.album);
    if (candidate.durationMs) exactUrl.searchParams.set("duration", String(candidate.durationMs));

    const exactResponse = await fetchJsonWithTimeout(exactUrl, {
      timeoutMs: Math.max(LRCLIB_TIMEOUT_MS, 12_000)
    });

    if (exactResponse.response.ok) {
      lyricsBody = exactResponse.body;
    } else if (exactResponse.response.status !== 404) {
      throw new Error(`LRCLIB request failed: ${exactResponse.response.status}`);
    }
  }

  if (!lyricsBody && !shouldPreferSearch) {
    for (const params of searchVariants) {
      lyricsBody = await fetchSearchVariant(params);
      if (lyricsBody) break;
    }
  }

  if (!lyricsBody) {
    return buildLyricsState({
      status: "not_found",
      trackKey: candidate.trackKey,
      title: candidate.title,
      artist: candidate.artist || null,
      message: "Lyrics unavailable for this track"
    });
  }

  const providerDurationSeconds = Number(lyricsBody?.duration ?? lyricsBody?.durationSeconds);
  const candidateWithProviderDuration = Number.isFinite(candidate.durationMs)
    ? candidate
    : {
        ...candidate,
        durationMs: Number.isFinite(providerDurationSeconds) && providerDurationSeconds > 0
          ? Math.round(providerDurationSeconds * 1000)
          : candidate.durationMs
      };
  const { synced, timingStrategy, lines } = buildDisplayableLyricsLines(lyricsBody, candidateWithProviderDuration);

  if (lines.length === 0) {
    return buildLyricsState({
      status: "not_found",
      trackKey: candidate.trackKey,
      title: candidate.title,
      artist: candidate.artist || null,
      message: "Lyrics unavailable for this track"
    });
  }

  return buildLyricsState({
    status: "ready",
    trackKey: candidate.trackKey,
    title: normalizeMetadataValue(lyricsBody?.trackName ?? candidate.title) || candidate.title,
    artist: normalizeMetadataValue(lyricsBody?.artistName ?? candidate.artist) || candidate.artist || null,
    synced,
    timingStrategy,
    lines,
    message: null
  });
}

function getProxyInputCaptureCommand(source) {
  return source === "airplay" ? AIRPLAY_CAPTURE_COMMAND : BLUETOOTH_CAPTURE_COMMAND;
}

async function captureBluetoothSample(source = "bluetooth") {
  const captureCommand = getProxyInputCaptureCommand(source);
  const sourceLabel = getProxyInputLabel(source);
  if (!captureCommand.trim()) {
    throw new Error(`${sourceLabel} capture command is not configured`);
  }

  const durationSeconds = Math.max(1, Math.round(BLUETOOTH_CAPTURE_DURATION_SECONDS));
  const cacheDir = resolve(REMOTE_MEDIA_CACHE_ROOT, `${source}-capture`);
  await mkdir(cacheDir, { recursive: true });
  const fileName = `${source}-capture-${Date.now()}-${Math.random().toString(16).slice(2)}.wav`;
  const outputPath = resolve(cacheDir, fileName);

  try {
    await execFileAsync("sh", ["-lc", `${captureCommand} "$1" "$2"`, "--", outputPath, String(durationSeconds)], {
      timeout: Math.max(10_000, durationSeconds * 2000),
      maxBuffer: 1024 * 256
    });
    const buffer = await readFile(outputPath);
    if (buffer.length === 0) {
      throw new Error("Bluetooth capture returned no audio");
    }
    return {
      buffer,
      contentType: "audio/wav",
      filename: fileName
    };
  } finally {
    await unlink(outputPath).catch(() => null);
  }
}

function resetBluetoothRecognitionSession(overrides = {}) {
  bluetoothRecognitionSession = buildBluetoothRecognitionSession(overrides);
}

function syncBluetoothRecognitionSession(sourceSummary, source = "bluetooth") {
  if (sourceSummary?.connectionState !== "connected") {
    resetBluetoothRecognitionSession();
    return null;
  }

  const connectionKey = buildProxyInputConnectionKey(sourceSummary, source);
  if (bluetoothRecognitionSession.connectionKey !== connectionKey) {
    resetBluetoothRecognitionSession({
      connectionKey,
      connectedAtMs: Date.now()
    });
  }
  return bluetoothRecognitionSession;
}

function buildProxyInputRecognitionMessage(source) {
  return `Listening to ${getProxyInputLabel(source)} audio...`;
}

function buildBluetoothRecognizingState(candidate) {
  return buildLyricsState({
    status: "recognizing",
    sourceScope: candidate.sourceScope ?? getProxyInputScope(candidate.source ?? "bluetooth"),
    recognitionMode: "fingerprint",
    recognitionProvider: "acrcloud",
    recognitionConfidence: null,
    title: null,
    artist: candidate.artist ?? null,
    synced: false,
    lines: [],
    message: buildProxyInputRecognitionMessage(candidate.source ?? "bluetooth")
  });
}

async function identifyBluetoothTrack(source = "bluetooth") {
  if (RECOGNITION_PROVIDER !== "acrcloud") {
    throw new Error(`${getProxyInputLabel(source)} recognition provider is not configured`);
  }

  const sample = await captureBluetoothSample(source);
  return recognizeWithAcrCloud({
    host: ACRCLOUD_HOST,
    accessKey: ACRCLOUD_ACCESS_KEY,
    accessSecret: ACRCLOUD_ACCESS_SECRET,
    audioBuffer: sample.buffer,
    contentType: sample.contentType,
    filename: sample.filename
  });
}

function updateLyricsState(nextState) {
  lyricsState = buildLyricsState(nextState);
  return lyricsState;
}

function shouldUpdateActiveLyricsState(candidate, { force = false } = {}) {
  if (force) return true;
  return lyricsState.trackKey === candidate.trackKey && lyricsState.sourceScope === candidate.sourceScope;
}

async function resolveLyricsCandidate(candidate, { force = false, updateCurrentState = false } = {}) {
  if (!candidate?.trackKey) {
    return buildLyricsState({
      status: "idle",
      sourceScope: candidate?.sourceScope ?? "local_playback",
      recognitionMode: candidate?.recognitionMode ?? null,
      recognitionProvider: candidate?.recognitionProvider ?? null,
      title: candidate?.title ?? null,
      artist: candidate?.artist ?? null,
      message: null
    });
  }

  if (!force && lyricsInFlight.has(candidate.trackKey)) {
    const inFlightResult = await lyricsInFlight.get(candidate.trackKey);
    return decorateLyricsState(inFlightResult, candidate);
  }

  const pending = (async () => {
    try {
      const result = await fetchLyricsFromProvider(candidate);
      lyricsResultCache.set(candidate.trackKey, result);
      lyricsRetryAfter.delete(candidate.trackKey);
      return result;
    } catch (error) {
      const fallback = buildLyricsState({
        status: "error",
        trackKey: candidate.trackKey,
        title: candidate.title,
        artist: candidate.artist || null,
        message: lyricsErrorMessage(error)
      });
      lyricsResultCache.set(candidate.trackKey, fallback);
      lyricsRetryAfter.set(candidate.trackKey, Date.now() + LYRICS_ERROR_BACKOFF_MS);
      return fallback;
    } finally {
      lyricsInFlight.delete(candidate.trackKey);
    }
  })();

  lyricsInFlight.set(candidate.trackKey, pending);
  const result = decorateLyricsState(await pending, candidate);
  if (updateCurrentState && shouldUpdateActiveLyricsState(candidate, { force })) {
    updateLyricsState(result);
  }
  return result;
}

function scheduleMetadataLyricsRecognition(candidate, options = {}) {
  if (!candidate.trackKey) {
    return updateLyricsState(decorateLyricsState(buildLyricsState({
      status: "idle",
      title: candidate.title || null,
      artist: candidate.artist || null,
      synced: false,
      lines: [],
      message: null
    }), candidate));
  }

  if (looksLikeUntrustedTrackMetadata(candidate)) {
    return updateLyricsState(decorateLyricsState(buildLyricsState({
      status: "not_found",
      trackKey: candidate.trackKey,
      title: candidate.title || null,
      artist: candidate.artist || null,
      synced: false,
      lines: [],
      message: "Lyrics unavailable for this track"
    }), candidate));
  }

  const cached = lyricsResultCache.get(candidate.trackKey);
  const retryAfter = lyricsRetryAfter.get(candidate.trackKey) ?? 0;
  const shouldForce = options.force === true;
  const canRetry = shouldForce || retryAfter <= Date.now();

  if (cached && cached.status !== "error" && !shouldForce) {
    return updateLyricsState(decorateLyricsState(cached, candidate));
  }

  if (cached && cached.status === "error" && !canRetry) {
    return updateLyricsState(decorateLyricsState(cached, candidate));
  }

  if (lyricsInFlight.has(candidate.trackKey) && !shouldForce) {
    return updateLyricsState(buildLyricsState({
      status: "recognizing",
      sourceScope: candidate.sourceScope,
      recognitionMode: candidate.recognitionMode,
      recognitionProvider: candidate.recognitionProvider,
      trackKey: candidate.trackKey,
      title: candidate.title,
      artist: candidate.artist || null,
      synced: false,
      lines: [],
      message: "Identifying track..."
    }));
  }

  updateLyricsState(buildLyricsState({
    status: "recognizing",
    sourceScope: candidate.sourceScope,
    recognitionMode: candidate.recognitionMode,
    recognitionProvider: candidate.recognitionProvider,
    trackKey: candidate.trackKey,
    title: candidate.title,
    artist: candidate.artist || null,
    synced: false,
    lines: [],
    message: "Identifying track..."
  }));
  void resolveLyricsCandidate(candidate, {
    force: shouldForce,
    updateCurrentState: true
  });
  return lyricsState;
}

async function resolveBluetoothRecognition(candidate, sourceSummary, { force = false } = {}) {
  const source = candidate?.source ?? "bluetooth";
  const sourceScope = candidate?.sourceScope ?? getProxyInputScope(source);
  const session = syncBluetoothRecognitionSession(sourceSummary, source);
  const activeConnectionKey = session?.connectionKey ?? null;
  if (!activeConnectionKey) {
    return buildLyricsState({
      status: "idle",
      sourceScope,
      recognitionMode: "fingerprint",
      recognitionProvider: "acrcloud",
      message: `Waiting for ${getProxyInputLabel(source)} audio`
    });
  }

  try {
    const recognizedTrack = await identifyBluetoothTrack(source);
    if (!recognizedTrack?.title) {
      return buildLyricsState({
        status: "not_found",
        sourceScope,
        recognitionMode: "fingerprint",
        recognitionProvider: "acrcloud",
        title: null,
        artist: sourceSummary.connectedLabel ?? null,
        synced: false,
        lines: [],
        message: "Lyrics unavailable for this track"
      });
    }

    const recognizedCandidate = {
      supported: true,
      source,
      sourceScope,
      recognitionMode: "fingerprint",
      recognitionProvider: "acrcloud",
      recognitionConfidence: recognizedTrack.confidence,
      trackKey: buildPlaybackTrackKey({
        source,
        title: recognizedTrack.title,
        artist: recognizedTrack.artist,
        album: recognizedTrack.album,
        durationSeconds: Number.isFinite(candidate.durationMs) ? candidate.durationMs / 1000 : null
      }),
      title: recognizedTrack.title,
      artist: normalizeMetadataValue(recognizedTrack.artist),
      album: normalizeMetadataValue(recognizedTrack.album),
      durationMs: Number.isFinite(candidate.durationMs) ? candidate.durationMs : null,
      playbackClock: candidate.playbackClock === true
    };

    const resolvedLyrics = await resolveLyricsCandidate(recognizedCandidate, {
      force,
      updateCurrentState: false
    });

    return decorateLyricsState(resolvedLyrics, recognizedCandidate, {
      recognitionConfidence: recognizedTrack.confidence
    });
  } catch (error) {
    console.warn("tikpal-api bluetooth recognition failed:", error instanceof Error ? error.message : error);
    return buildLyricsState({
      status: "error",
      sourceScope,
      recognitionMode: "fingerprint",
      recognitionProvider: "acrcloud",
      recognitionConfidence: null,
      title: null,
      artist: sourceSummary.connectedLabel ?? null,
      synced: false,
      lines: [],
      message: lyricsErrorMessage(error)
    });
  }
}

function scheduleBluetoothLyricsRecognition(snapshot, candidate, options = {}) {
  const source = candidate?.source ?? "bluetooth";
  const sourceScope = candidate?.sourceScope ?? getProxyInputScope(source);
  const sourceSummary = getProxyInputSourceSummary(snapshot.audio, source);
  const session = syncBluetoothRecognitionSession(sourceSummary, source);
  const shouldForce = options.force === true;
  if (!session) {
    return updateLyricsState(buildLyricsState({
      status: "idle",
      sourceScope,
      recognitionMode: "fingerprint",
      recognitionProvider: "acrcloud",
      title: null,
      artist: sourceSummary?.advertisedLabel ?? null,
      synced: false,
      lines: [],
      message: sourceSummary?.armed
        ? `Waiting for ${getProxyInputLabel(source)} audio`
        : `Select ${getProxyInputLabel(source)} to identify incoming audio`
    }));
  }

  if (shouldForce) {
    bluetoothRecognitionSession.resolvedState = null;
    bluetoothRecognitionSession.retryAfterMs = 0;
  }

  if (!shouldForce && bluetoothRecognitionSession.resolvedState) {
    const resolvedState = bluetoothRecognitionSession.resolvedState;
    const retryAfterMs = bluetoothRecognitionSession.retryAfterMs ?? 0;
    if (resolvedState.status === "ready" || retryAfterMs > Date.now()) {
      return updateLyricsState(resolvedState);
    }
    bluetoothRecognitionSession.resolvedState = null;
  }

  const settleUntil = bluetoothRecognitionSession.connectedAtMs + BLUETOOTH_RECOGNITION_SETTLE_MS;
  if (!shouldForce && Date.now() < settleUntil) {
    return updateLyricsState(buildBluetoothRecognizingState(candidate));
  }

  if (!shouldForce && bluetoothRecognitionSession.retryAfterMs > Date.now() && bluetoothRecognitionSession.resolvedState) {
    return updateLyricsState(bluetoothRecognitionSession.resolvedState);
  }

  if (bluetoothRecognitionSession.inFlight && !shouldForce) {
    return updateLyricsState(buildBluetoothRecognizingState(candidate));
  }

  updateLyricsState(buildBluetoothRecognizingState(candidate));
  const activeConnectionKey = bluetoothRecognitionSession.connectionKey;
  const pending = resolveBluetoothRecognition(candidate, sourceSummary, { force: shouldForce })
    .then((result) => {
      if (bluetoothRecognitionSession.connectionKey === activeConnectionKey) {
        bluetoothRecognitionSession.resolvedState = result;
        if (result.status === "error") {
          bluetoothRecognitionSession.retryAfterMs = Date.now() + BLUETOOTH_RECOGNITION_RETRY_MS;
        } else if (result.status === "not_found") {
          bluetoothRecognitionSession.retryAfterMs = Date.now() + BLUETOOTH_RECOGNITION_NOT_FOUND_RETRY_MS;
        } else {
          bluetoothRecognitionSession.retryAfterMs = 0;
        }
        updateLyricsState(result);
      }
      return result;
    })
    .finally(() => {
      if (bluetoothRecognitionSession.connectionKey === activeConnectionKey) {
        bluetoothRecognitionSession.inFlight = null;
      }
    });
  bluetoothRecognitionSession.inFlight = pending;
  return lyricsState;
}

function scheduleLyricsRecognition(snapshot, options = {}) {
  const candidate = getLyricsCandidate(snapshot);

  if (!candidate.supported) {
    return updateLyricsState(buildLyricsState({
      status: "idle",
      sourceScope: candidate.sourceScope ?? "local_playback",
      recognitionMode: isProxyInputSourceScope(candidate.sourceScope) ? "fingerprint" : null,
      recognitionProvider: isProxyInputSourceScope(candidate.sourceScope) ? "acrcloud" : null,
      trackKey: null,
      title: normalizeMetadataValue(snapshot.playback?.title) || null,
      artist: normalizeMetadataValue(snapshot.playback?.artist) || null,
      synced: false,
      lines: [],
      message: candidate.reason
    }));
  }

  if (candidate.recognitionMode === "fingerprint") {
    return scheduleBluetoothLyricsRecognition(snapshot, candidate, options);
  }

  return scheduleMetadataLyricsRecognition(candidate, options);
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

async function applyPlaybackAction(action) {
  syncElapsed();

  if (mockActiveSource === "scene") {
    switch (action.type) {
      case "play_pause":
        scenePlaybackState = scenePlaybackState === "playing" ? "stopped" : "playing";
        return;
      case "play":
        scenePlaybackState = "playing";
        return;
      case "pause":
        scenePlaybackState = "stopped";
        return;
      case "next":
      case "previous":
      case "seek":
      case "favorite_toggle":
      case "play_mode_set":
        return;
      case "volume_set": {
        const percent = Number(action.value);
        if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
          throw new Error("volume_set requires value between 0 and 100");
        }
        system.volume.percent = Math.round(percent);
        system.volume.db = Number((-72 + system.volume.percent * 0.68).toFixed(1));
        return;
      }
      default:
        throw new Error(`Unsupported playback action: ${action.type}`);
    }
  }

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
      if (advanceMockLocalQueue(1)) break;
      clearMockLocalQueue();
      trackIndex = playMode === "shuffle" ? randomMockTrackIndex(trackIndex) : (trackIndex + 1) % tracks.length;
      elapsedSeconds = 0;
      playbackState = "playing";
      lastTickAt = Date.now();
      break;
    case "previous":
      if (advanceMockLocalQueue(-1)) break;
      clearMockLocalQueue();
      trackIndex = (trackIndex + tracks.length - 1) % tracks.length;
      elapsedSeconds = 0;
      playbackState = "playing";
      lastTickAt = Date.now();
      break;
    case "seek": {
      const seconds = Number(action.value);
      const durationSeconds = mockSelectedLocalTrack?.durationSeconds ?? tracks[trackIndex].durationSeconds;
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > durationSeconds) {
        throw new Error(`seek requires value between 0 and ${durationSeconds}`);
      }
      elapsedSeconds = Math.round(seconds);
      lastTickAt = Date.now();
      break;
    }
    case "favorite_toggle":
      await toggleFavoriteTrackPath(mockSelectedLocalTrack?.path);
      break;
    case "play_mode_set":
      playMode = normalizePlaybackMode(action.mode);
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
  await runCommand(command, { allowFailure: false, timeout: 30000 });
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
    case "brightness_set": {
      const percent = Number(action.value);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        throw new Error("brightness_set requires value between 0 and 100");
      }
      system.display.brightnessPercent = Math.round(percent);
      system.display.controllable = true;
      system.display.transport = "mock";
      return;
    }
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
    case "brightness_set": {
      const percent = Number(action.value);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        throw new Error("brightness_set requires value between 0 and 100");
      }
      await setDisplayBrightnessPercent(percent);
      return;
    }
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

async function applyMockSourceSwitch(action) {
  switch (action.target) {
    case "mpd": {
      if (action.localTrackPath) {
        const track = await findLocalAudioLibraryTrackByPath(action.localTrackPath);
        if (!track) {
          throw new Error(`Unknown local library track: ${action.localTrackPath}`);
        }
        setMockLocalQueue([track], 0);
        elapsedSeconds = 0;
      } else {
        clearMockLocalQueue();
      }
      mockArmedSource = null;
      mockActiveSource = "mpd";
      mockAudioArmedAt = 0;
      mockSpotifyArmedAt = 0;
      mockBluetoothArmedAt = 0;
      mockAirplayArmedAt = 0;
      mockUpnpArmedAt = 0;
      stopSceneAudio();
      resetBluetoothRecognitionSession();
      playbackState = "playing";
      lastTickAt = Date.now();
      return;
    }
    case "audio":
      clearMockLocalQueue();
      mockArmedSource = null;
      mockActiveSource = "audio";
      mockAudioArmedAt = Date.now();
      mockSpotifyArmedAt = 0;
      mockBluetoothArmedAt = 0;
      mockAirplayArmedAt = 0;
      mockUpnpArmedAt = 0;
      stopSceneAudio();
      resetBluetoothRecognitionSession();
      playbackState = "playing";
      lastTickAt = Date.now();
      return;
    case "radio":
      clearMockLocalQueue();
      mockArmedSource = null;
      if (action.radioStationId) {
        const station = getMockRadioStations().find((radio) => radio.id === action.radioStationId);
        if (!station) {
          throw new Error(`Unknown radio station: ${action.radioStationId}`);
        }
        mockActiveRadioStationId = station.id;
      }
      mockActiveSource = "radio";
      mockAudioArmedAt = 0;
      mockSpotifyArmedAt = 0;
      mockBluetoothArmedAt = 0;
      mockAirplayArmedAt = 0;
      mockUpnpArmedAt = 0;
      stopSceneAudio();
      resetBluetoothRecognitionSession();
      playbackState = "playing";
      return;
    case "scene":
      clearMockLocalQueue();
      mockArmedSource = null;
      mockActiveSource = "scene";
      mockAudioArmedAt = 0;
      mockSpotifyArmedAt = 0;
      mockBluetoothArmedAt = 0;
      mockAirplayArmedAt = 0;
      mockUpnpArmedAt = 0;
      activateSceneAudio(action);
      resetBluetoothRecognitionSession();
      playbackState = "paused";
      lastTickAt = Date.now();
      return;
    case "spotify":
      clearMockLocalQueue();
      mockArmedSource = "spotify";
      mockActiveSource = "spotify";
      mockAudioArmedAt = 0;
      mockSpotifyArmedAt = Date.now();
      mockBluetoothArmedAt = 0;
      mockAirplayArmedAt = 0;
      mockUpnpArmedAt = 0;
      stopSceneAudio();
      resetBluetoothRecognitionSession();
      playbackState = "paused";
      return;
    case "bluetooth":
      clearMockLocalQueue();
      mockArmedSource = "bluetooth";
      mockActiveSource = "bluetooth";
      mockAudioArmedAt = 0;
      mockSpotifyArmedAt = 0;
      mockBluetoothArmedAt = Date.now();
      mockAirplayArmedAt = 0;
      mockUpnpArmedAt = 0;
      stopSceneAudio();
      resetBluetoothRecognitionSession();
      playbackState = "paused";
      return;
    case "airplay":
      clearMockLocalQueue();
      mockArmedSource = "airplay";
      mockActiveSource = "airplay";
      mockAudioArmedAt = 0;
      mockAirplayArmedAt = Date.now();
      mockSpotifyArmedAt = 0;
      mockBluetoothArmedAt = 0;
      mockUpnpArmedAt = 0;
      stopSceneAudio();
      resetBluetoothRecognitionSession();
      playbackState = "paused";
      return;
    case "upnp":
      clearMockLocalQueue();
      mockArmedSource = "upnp";
      mockActiveSource = "upnp";
      mockAudioArmedAt = 0;
      mockUpnpArmedAt = Date.now();
      mockSpotifyArmedAt = 0;
      mockBluetoothArmedAt = 0;
      mockAirplayArmedAt = 0;
      stopSceneAudio();
      resetBluetoothRecognitionSession();
      playbackState = "paused";
      return;
    default:
      throw new Error(`Unsupported source target: ${action.target}`);
  }
}

async function applyMpcSourceSwitchUnlocked(action) {
  switch (action.target) {
    case "mpd":
      mockArmedSource = null;
      stopSceneAudio();
      resetBluetoothRecognitionSession();
      if (action.localTrackPath) {
        await switchToLocalLibraryTrack(action.localTrackPath);
      } else {
        await enforceConnectionGate("mpd");
        await switchToMpdSource();
      }
      return;
    case "audio":
      stopSceneAudio();
      resetBluetoothRecognitionSession();
      await switchToAudioSource();
      mockArmedSource = "audio";
      return;
    case "radio":
      mockArmedSource = null;
      stopSceneAudio();
      resetBluetoothRecognitionSession();
      await enforceConnectionGate("radio");
      await switchToRadioSource(action);
      return;
    case "scene":
      resetBluetoothRecognitionSession();
      await switchToSceneSource(action);
      mockArmedSource = "scene";
      return;
    case "spotify":
      stopSceneAudio();
      resetBluetoothRecognitionSession();
      await switchToSpotifySource();
      mockArmedSource = "spotify";
      return;
    case "bluetooth":
      stopSceneAudio();
      resetBluetoothRecognitionSession();
      await switchToBluetoothSource();
      mockArmedSource = "bluetooth";
      return;
    case "airplay":
      stopSceneAudio();
      resetBluetoothRecognitionSession();
      await switchToAirplaySource();
      mockArmedSource = "airplay";
      return;
    case "upnp":
      stopSceneAudio();
      resetBluetoothRecognitionSession();
      await switchToUpnpSource();
      mockArmedSource = "upnp";
      return;
    default:
      throw new Error(`Unsupported source target: ${action.target}`);
  }
}

async function applyMpcSourceSwitch(action) {
  return await withMpcMutationLock(() => applyMpcSourceSwitchUnlocked(action));
}

async function syncRoomSceneSoundForSource(target) {
  const current = await readRoomExperienceState();
  const nextTarget = String(target ?? "");

  if (nextTarget === "scene") {
    if (current.mode === "hifi" || current.sceneSoundEnabled) return;
    await writeRoomExperienceState({
      ...current,
      sceneSoundEnabled: true
    });
    return;
  }

  if (!current.sceneSoundEnabled) return;
  await writeRoomExperienceState({
    ...current,
    sceneSoundEnabled: false
  });
}

async function applySourceSwitch(action, { syncSceneSoundState = true } = {}) {
  if (API_MODE === "mpc") {
    await applyMpcSourceSwitch(action);
  } else {
    await applyMockSourceSwitch(action);
  }

  if (syncSceneSoundState) {
    await syncRoomSceneSoundForSource(action?.target);
  }
}

function getRoomModePreset(mode) {
  return ROOM_MODE_PRESETS[normalizeRoomMode(mode)];
}

function getRoomModeFromPresetId(presetId, fallbackMode) {
  const normalizedPresetId = String(presetId ?? "").trim();
  const found = Object.entries(ROOM_MODE_PRESETS).find(([, preset]) => preset.presetId === normalizedPresetId);
  return found?.[0] ?? normalizeRoomMode(fallbackMode);
}

async function resolveSceneAudioVideo(experience) {
  const preset = getRoomModePreset(experience.mode);
  const fallbackVideo = {
    id: preset.sceneVideoId,
    label: preset.sceneVideoLabel,
    src: preset.sceneVideoSrc
  };

  try {
    const catalog = await getAmbientBackgroundVideosPayload();
    const matchedVideo = catalog.videos.find((video) => video.id === experience.sceneVideoId);
    if (matchedVideo?.src) {
      return matchedVideo;
    }
  } catch {
    // Fall through to the room preset scene; switching will still fail if no video exists.
  }

  if (fallbackVideo.src) {
    return fallbackVideo;
  }

  throw new Error("scene sound requires a scene video");
}

async function applyRoomExperienceSideEffects(experience, { applyScene = false, applyLevels = true } = {}) {
  if (applyLevels) {
    try {
      const volumeAction = { type: "volume_set", value: experience.volumePercent };
      if (API_MODE === "mpc") {
        await applyMpcPlaybackAction(volumeAction);
      } else {
        await applyPlaybackAction(volumeAction);
      }
    } catch {
      // Room mode remains useful even when the current audio backend rejects volume changes.
    }

    try {
      await applySystemAction({ type: "brightness_set", value: experience.brightnessPercent });
    } catch {
      // Some target displays do not expose DDC/CI brightness control.
    }
  }

  if (applyScene && experience.sceneSoundEnabled) {
    const sceneVideo = await resolveSceneAudioVideo(experience);
    await applySourceSwitch({
      target: "scene",
      sceneVideoId: sceneVideo.id,
      sceneVideoLabel: sceneVideo.label,
      sceneVideoSrc: sceneVideo.src
    });
  }
}

async function applyRoomExperienceAction(action) {
  const current = await readRoomExperienceState();
  const type = String(action?.type ?? "");
  let next = current;
  let applyScene = false;
  let applyLevels = true;
  let stopScene = false;

  switch (type) {
    case "set_mode": {
      const mode = normalizeRoomMode(action.mode);
      const preset = getRoomModePreset(mode);
      const timerMinutes = normalizeTimerMinutes(action.timerMinutes, preset.timerMinutes);
      const hifiEqPatch = buildHifiEqPatch(action, current.hifiEqPresetId ?? preset.hifiEqPresetId);
      next = {
        ...current,
        mode,
        phase: "idle",
        presetId: preset.presetId,
        sceneVideoId: preset.sceneVideoId,
        ...hifiEqPatch,
        sceneSoundEnabled: mode === "hifi" ? false : action.sceneSoundEnabled === true ? true : preset.sceneSoundEnabled,
        playlistId: action.playlistId === undefined ? preset.playlistId : action.playlistId,
        volumePercent: clampPercent(action.volumePercent, preset.volumePercent),
        brightnessPercent: clampPercent(action.brightnessPercent, preset.brightnessPercent),
        timerMinutes,
        timerEndsAt: null
      };
      applyScene = mode !== "hifi";
      applyLevels = mode !== "hifi";
      stopScene = mode === "hifi";
      break;
    }
    case "apply_preset": {
      const mode = getRoomModeFromPresetId(action.presetId, action.mode ?? current.mode);
      const preset = getRoomModePreset(mode);
      const timerMinutes = normalizeTimerMinutes(action.timerMinutes, preset.timerMinutes);
      const hifiEqPatch = buildHifiEqPatch(action, current.hifiEqPresetId ?? preset.hifiEqPresetId);
      next = {
        ...current,
        mode,
        phase: "preparing",
        presetId: preset.presetId,
        sceneVideoId: String(action.sceneVideoId ?? preset.sceneVideoId).trim() || preset.sceneVideoId,
        ...hifiEqPatch,
        sceneSoundEnabled: mode === "hifi" ? false : action.sceneSoundEnabled === true ? true : preset.sceneSoundEnabled,
        playlistId: action.playlistId === undefined ? preset.playlistId : action.playlistId,
        volumePercent: clampPercent(action.volumePercent, preset.volumePercent),
        brightnessPercent: clampPercent(action.brightnessPercent, preset.brightnessPercent),
        timerMinutes,
        timerEndsAt: null
      };
      applyScene = mode !== "hifi";
      applyLevels = mode !== "hifi";
      stopScene = mode === "hifi";
      break;
    }
    case "start_session": {
      const mode = normalizeRoomMode(action.mode ?? current.mode);
      const preset = getRoomModePreset(mode);
      const timerMinutes = normalizeTimerMinutes(action.timerMinutes, current.timerMinutes);
      const hifiEqPatch = buildHifiEqPatch(action, current.hifiEqPresetId ?? preset.hifiEqPresetId);
      next = {
        ...current,
        mode,
        phase: "active",
        presetId: preset.presetId,
        sceneVideoId: String(action.sceneVideoId ?? current.sceneVideoId ?? preset.sceneVideoId).trim() || preset.sceneVideoId,
        ...hifiEqPatch,
        sceneSoundEnabled: mode === "hifi" ? false : action.sceneSoundEnabled === undefined ? current.sceneSoundEnabled : action.sceneSoundEnabled === true,
        playlistId: action.playlistId === undefined ? current.playlistId : action.playlistId,
        volumePercent: clampPercent(action.volumePercent, current.volumePercent),
        brightnessPercent: clampPercent(action.brightnessPercent, current.brightnessPercent),
        timerMinutes,
        timerEndsAt: buildTimerEndsAt(timerMinutes)
      };
      applyScene = mode !== "hifi";
      applyLevels = mode !== "hifi";
      stopScene = mode === "hifi";
      break;
    }
    case "stop_session":
      next = {
        ...current,
        phase: "idle",
        sceneSoundEnabled: false,
        timerEndsAt: null
      };
      stopScene = true;
      break;
    case "update_timer": {
      const timerMinutes = normalizeTimerMinutes(action.timerMinutes, current.timerMinutes);
      next = {
        ...current,
        timerMinutes,
        timerEndsAt: normalizeTimerEndsAt(action.timerEndsAt)
      };
      break;
    }
    case "set_scene_sound": {
      const enabled = action.sceneSoundEnabled === true;
      if (enabled && current.mode === "hifi") {
        throw new Error("scene sound is not available in Hi-Fi mode");
      }
      next = {
        ...current,
        sceneVideoId: String(action.sceneVideoId ?? current.sceneVideoId).trim() || current.sceneVideoId,
        sceneSoundEnabled: enabled
      };
      if (enabled) {
        await resolveSceneAudioVideo(next);
      }
      applyScene = enabled;
      applyLevels = false;
      stopScene = !enabled;
      break;
    }
    case "set_hifi_eq": {
      const hifiEqPatch = buildHifiEqPatch(action, current.hifiEqPresetId);
      await applyHifiEqPreset(hifiEqPatch.hifiEqPresetId);
      next = {
        ...current,
        ...hifiEqPatch
      };
      applyLevels = false;
      break;
    }
    case "set_hifi_visual": {
      const hifiEqPatch = buildHifiEqPatch(action, current.hifiEqPresetId);
      await applyHifiEqPreset(hifiEqPatch.hifiEqPresetId);
      next = {
        ...current,
        ...hifiEqPatch
      };
      applyLevels = false;
      break;
    }
    case "update_night_schedule": {
      const patch = action.nightSchedule ?? {};
      const merged = {
        ...current.nightSchedule,
        ...patch,
        ...(patch.timeZone !== undefined ? { timeZone: assertValidTimeZone(patch.timeZone) } : {})
      };
      next = {
        ...current,
        nightSchedule: normalizeNightSchedule(merged, current.nightSchedule)
      };
      applyLevels = false;
      break;
    }
    default:
      throw new Error(`Unsupported experience action: ${type}`);
  }

  const saved = await writeRoomExperienceState(next);
  try {
    await applyRoomExperienceSideEffects(saved, { applyScene, applyLevels });
  } catch (error) {
    if (applyScene && saved.sceneSoundEnabled) {
      await writeRoomExperienceState({
        ...saved,
        sceneSoundEnabled: false
      });
    }
    throw error;
  }

  if (stopScene) {
    await stopSceneSourceSafely();
  }

  return await getRoomExperienceState();
}

async function applyPlaybackActionForCurrentBackend(action) {
  if (API_MODE === "mpc") {
    await applyMpcPlaybackAction(action);
    return;
  }
  await applyPlaybackAction(action);
}

function requireRemoteNumber(value, label) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`${label} requires a numeric value`);
  }
  return numeric;
}

function requireRemoteRoomMode(value) {
  const mode = String(value ?? "").trim().toLowerCase();
  if (!ROOM_MODES.has(mode)) {
    throw new Error("room mode must be focus, calm, sleep, or hifi");
  }
  return mode;
}

function requireRemoteSourceTarget(value) {
  const target = String(value ?? "").trim().toLowerCase();
  if (!REMOTE_SOURCE_TARGETS.has(target)) {
    throw new Error("source.set requires target mpd, radio, spotify, bluetooth, airplay, or upnp");
  }
  return target;
}

function requireRemoteHifiEqPresetId(value) {
  const presetId = String(value ?? "").trim();
  if (!HIFI_EQ_PRESET_IDS.has(presetId)) {
    throw new Error("hifi.eq_set requires hifiEqPresetId flat, warm, or vocal");
  }
  return presetId;
}

function requireRemoteBoolean(value, label) {
  if (typeof value !== "boolean") {
    throw new Error(`${label} requires a boolean value`);
  }
  return value;
}

function buildRoomModeCatalog() {
  return Object.entries(ROOM_MODE_PRESETS).map(([id, preset]) => ({
    id,
    label: id === "hifi" ? "Hi-Fi" : `${id.slice(0, 1).toUpperCase()}${id.slice(1)}`,
    presetId: preset.presetId,
    sceneVideoId: preset.sceneVideoId,
    sceneVideoLabel: preset.sceneVideoLabel,
    hifiEqPresetId: preset.hifiEqPresetId,
    hifiVisualPresetId: preset.hifiVisualPresetId,
    sceneSoundEnabled: preset.sceneSoundEnabled,
    volumePercent: preset.volumePercent,
    brightnessPercent: preset.brightnessPercent,
    timerMinutes: preset.timerMinutes
  }));
}

async function buildRemoteStateResponse() {
  const [state, experience, sceneCatalog] = await Promise.all([
    getTikpalState(),
    getRoomExperienceState(),
    getAmbientBackgroundVideosPayload()
  ]);
  const activeSceneVideo = sceneCatalog.videos.find((video) => video.id === experience.sceneVideoId) ?? null;

  return {
    playback: state.playback,
    volume: state.system.volume,
    room: {
      mode: experience.mode,
      phase: experience.phase,
      presetId: experience.presetId,
      timerMinutes: experience.timerMinutes,
      timerEndsAt: experience.timerEndsAt,
      updatedAt: experience.updatedAt
    },
    scene: {
      videoId: experience.sceneVideoId,
      video: activeSceneVideo,
      sceneSoundEnabled: experience.sceneSoundEnabled,
      availableCount: sceneCatalog.total,
      catalogVersion: sceneCatalog.catalogVersion ?? null
    },
    source: {
      current: state.audio.currentSource,
      sources: state.audio.sources
    },
    display: state.system.display,
    hifi: {
      eqPresetId: experience.hifiEqPresetId,
      visualPresetId: experience.hifiVisualPresetId,
      availablePresets: state.system.dspState.availablePresets,
      controllable: state.system.dspState.controllable,
      controlTransport: state.system.dspState.controlTransport
    },
    runtime: state.runtime,
    updatedAt: state.runtime.updatedAt
  };
}

async function buildRemoteCatalogResponse() {
  const [state, sceneCatalog] = await Promise.all([
    getTikpalState(),
    getAmbientBackgroundVideosPayload()
  ]);

  return {
    allowedActions: REMOTE_ALLOWED_ACTIONS,
    playbackModes: Array.from(PLAYBACK_MODES),
    sourceTargets: Array.from(REMOTE_SOURCE_TARGETS),
    sources: state.audio.sources.filter((source) => REMOTE_SOURCE_TARGETS.has(source.id)),
    roomModes: buildRoomModeCatalog(),
    sceneVideos: sceneCatalog.videos,
    hifiEqPresets: state.system.dspState.availablePresets,
    updatedAt: new Date().toISOString()
  };
}

async function findRemoteSceneVideo(sceneVideoId) {
  const catalog = await getAmbientBackgroundVideosPayload();
  const id = String(sceneVideoId ?? "").trim();
  const video = catalog.videos.find((entry) => entry.id === id);
  if (!video) {
    throw new Error("scene.set requires a known sceneVideoId from /api/v1/remote/catalog");
  }
  return video;
}

async function setRemoteSceneVideo(action) {
  const video = await findRemoteSceneVideo(action.sceneVideoId);
  const current = await readRoomExperienceState();
  const saved = await writeRoomExperienceState({
    ...current,
    sceneVideoId: video.id
  });

  if (saved.mode !== "hifi" && saved.sceneSoundEnabled) {
    await applySourceSwitch({
      target: "scene",
      sceneVideoId: video.id,
      sceneVideoLabel: video.label,
      sceneVideoSrc: video.src
    });
  }
}

async function setRemoteSceneSound(action) {
  const enabled = requireRemoteBoolean(action.enabled ?? action.sceneSoundEnabled, "scene.sound_set");
  await applyRoomExperienceAction({
    type: "set_scene_sound",
    sceneSoundEnabled: enabled
  });
}

async function applyRemoteAction(action) {
  const type = String(action?.type ?? "");

  switch (type) {
    case "playback.play_pause":
      await applyPlaybackActionForCurrentBackend({ type: "play_pause" });
      break;
    case "playback.play":
      await applyPlaybackActionForCurrentBackend({ type: "play" });
      break;
    case "playback.pause":
      await applyPlaybackActionForCurrentBackend({ type: "pause" });
      break;
    case "playback.next":
      await applyPlaybackActionForCurrentBackend({ type: "next" });
      break;
    case "playback.previous":
      await applyPlaybackActionForCurrentBackend({ type: "previous" });
      break;
    case "playback.seek":
      await applyPlaybackActionForCurrentBackend({ type: "seek", value: requireRemoteNumber(action.value, "playback.seek") });
      break;
    case "playback.play_mode_set":
      await applyPlaybackActionForCurrentBackend({ type: "play_mode_set", mode: normalizePlaybackMode(action.playbackMode ?? action.mode) });
      break;
    case "volume_set":
      await applyPlaybackActionForCurrentBackend({ type: "volume_set", value: requireRemoteNumber(action.value, "volume_set") });
      break;
    case "source.set":
      await applySourceSwitch({
        target: requireRemoteSourceTarget(action.target),
        radioStationId: action.radioStationId,
        localTrackPath: action.localTrackPath
      });
      break;
    case "room.set_mode":
      await applyRoomExperienceAction({ type: "set_mode", mode: requireRemoteRoomMode(action.mode), sceneSoundEnabled: action.sceneSoundEnabled });
      break;
    case "room.start_session":
      await applyRoomExperienceAction({
        type: "start_session",
        mode: action.mode === undefined ? undefined : requireRemoteRoomMode(action.mode),
        sceneSoundEnabled: action.sceneSoundEnabled,
        timerMinutes: action.timerMinutes
      });
      break;
    case "room.stop_session":
      await applyRoomExperienceAction({ type: "stop_session" });
      break;
    case "room.update_timer":
      await applyRoomExperienceAction({ type: "update_timer", timerMinutes: action.timerMinutes, timerEndsAt: action.timerEndsAt });
      break;
    case "scene.set":
      await setRemoteSceneVideo(action);
      break;
    case "scene.sound_set":
      await setRemoteSceneSound(action);
      break;
    case "hifi.eq_set":
      await applyRoomExperienceAction({ type: "set_hifi_eq", hifiEqPresetId: requireRemoteHifiEqPresetId(action.hifiEqPresetId) });
      break;
    case "display.brightness_set":
      await applySystemAction({ type: "brightness_set", value: requireRemoteNumber(action.value, "display.brightness_set") });
      break;
    case "lyrics.refresh": {
      const state = await getTikpalState();
      scheduleLyricsRecognition(state, { force: true });
      break;
    }
    default:
      throw new Error(`Unsupported remote action: ${type || "missing type"}`);
  }

  await refreshTikpalStateSnapshotAfterMutation();
  return await buildRemoteStateResponse();
}

function buildPortableKeyRequiredBody() {
  return {
    error: "FORBIDDEN",
    message: PORTABLE_API_KEY.trim()
      ? "X-Tikpal-Key is required for portable remote actions"
      : "TIKPAL_PORTABLE_API_KEY is not configured on this device"
  };
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${HOST}:${PORT}`}`);

  if (request.method === "OPTIONS") {
    sendJson(response, 204, {});
    return;
  }

  const accessDecision = getTikpalApiAccessDecision({
    method: request.method,
    pathname: url.pathname,
    headers: request.headers,
    remoteAddress: request.socket.remoteAddress,
    portableApiKey: PORTABLE_API_KEY
  });

  if (!accessDecision.allowed) {
    sendJson(response, accessDecision.status ?? 403, buildAccessDeniedBody(accessDecision));
    return;
  }

  try {
    if (request.method === "GET" && (url.pathname === "/api/v1/openapi.json" || url.pathname === "/api/v1/swagger.json")) {
      sendJson(response, 200, buildOpenApiDocument({ appVersion: APP_VERSION }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/docs") {
      sendHtml(response, 200, buildOpenApiDocsHtml());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/remote/state") {
      sendJson(response, 200, await buildRemoteStateResponse());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/remote/catalog") {
      sendJson(response, 200, await buildRemoteCatalogResponse());
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v1/remote/actions") {
      if (!hasValidTikpalKey(request.headers, PORTABLE_API_KEY)) {
        sendJson(response, 403, buildPortableKeyRequiredBody());
        return;
      }
      sendJson(response, 200, await applyRemoteAction(await readJson(request)));
      return;
    }

    if (request.method === "GET" && (url.pathname === "/api/v1/health" || url.pathname === "/api/v1/system/health")) {
      sendJson(response, 200, { ok: true, service: "tikpal-api", mode: API_MODE });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/system/state") {
      sendJson(response, 200, await getTikpalState());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/experience/state") {
      sendJson(response, 200, await getRoomExperienceState());
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

    if (request.method === "GET" && url.pathname === "/api/v1/lyrics/status") {
      sendJson(response, 200, (await getTikpalState()).lyrics);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/audio/sources") {
      sendJson(response, 200, await getAudioSourcesPayload());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/audio/spectrum") {
      sendJson(response, 200, await getAudioSpectrumFrame());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/audio/radios") {
      sendJson(response, 200, await getRadioCatalogPayload(url.searchParams));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/audio/library") {
      sendJson(response, 200, await getAudioLibraryPayload(url.searchParams));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/audio/playlists") {
      sendJson(response, 200, await buildAudioPlaylistsPayload());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/media/background-videos") {
      sendJson(response, 200, await getAmbientBackgroundVideosPayload());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/media/library-cover") {
      const cover = await resolveExistingLocalLibraryImage(url.searchParams.get("path"));
      if (!cover) {
        sendJson(response, 404, { error: "NOT_FOUND", path: url.pathname });
        return;
      }

      sendBinary(response, 200, cover.mimeType, await readFile(cover.absolutePath));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/media/airplay-artwork") {
      const artwork = await resolveExistingAirplayArtwork(url.searchParams.get("path"));
      if (!artwork) {
        sendJson(response, 404, { error: "NOT_FOUND", path: url.pathname });
        return;
      }

      sendBinary(response, 200, artwork.mimeType, await readFile(artwork.absolutePath));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/media/artwork") {
      const trackToken = url.searchParams.get("track");
      await getTikpalState();

      if (!currentArtworkState || !trackToken || trackToken !== currentArtworkState.token) {
        sendJson(response, 404, { error: "NOT_FOUND", path: url.pathname });
        return;
      }

      if (currentArtworkState.kind === "embedded" && currentArtworkState.mimeType && currentArtworkState.absolutePath) {
        const artwork = await readArtworkBuffer(currentArtworkState.absolutePath);
        if (artwork) {
          sendBinary(response, 200, currentArtworkState.mimeType, artwork);
          return;
        }
      }

      if (currentArtworkState.kind === "remote" && currentArtworkState.remotePath) {
        try {
          const artwork = await readFile(currentArtworkState.remotePath);
          sendBinary(response, 200, currentArtworkState.mimeType, artwork);
          return;
        } catch {
          // Fall back to generated artwork below if the cached file disappears.
        }
      }

      if (currentArtworkState.kind === "local-file" && currentArtworkState.localPath) {
        try {
          const artwork = await readFile(currentArtworkState.localPath);
          sendBinary(response, 200, currentArtworkState.mimeType, artwork);
          return;
        } catch {
          // Fall back to generated artwork below if the local cover disappears.
        }
      }

      const svg = buildGeneratedArtworkSvg(currentArtworkState);
      sendBinary(response, 200, "image/svg+xml; charset=utf-8", Buffer.from(svg));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v1/playback/actions") {
      const action = await readJson(request);
      if (API_MODE === "mpc") {
        await applyMpcPlaybackAction(action);
      } else {
        await applyPlaybackAction(action);
      }
      sendJson(response, 200, await refreshTikpalStateSnapshotAfterMutation());
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v1/system/actions") {
      const action = await readJson(request);
      await applySystemAction(action);
      sendJson(response, 200, await refreshTikpalStateSnapshotAfterMutation());
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v1/experience/actions") {
      sendJson(response, 200, await applyRoomExperienceAction(await readJson(request)));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v1/lyrics/refresh") {
      const state = await getTikpalState();
      const lyrics = scheduleLyricsRecognition(state, { force: true });
      sendJson(response, 200, lyrics);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v1/audio/source") {
      const action = await readJson(request);
      await applySourceSwitch(action);
      sendJson(response, 200, await refreshTikpalStateSnapshotAfterMutation());
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v1/audio/favorites") {
      const action = await readJson(request);
      await setFavoriteTrackPath(action.trackPath, action.favorite !== false);
      sendJson(response, 200, await refreshTikpalStateSnapshotAfterMutation());
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v1/audio/playlists") {
      await createAudioPlaylist(await readJson(request));
      sendJson(response, 200, await buildAudioPlaylistsPayload());
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v1/audio/playlist-actions") {
      await applyAudioPlaylistAction(await readJson(request));
      sendJson(response, 200, await buildAudioPlaylistsPayload());
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
    void primeMpcPlayback().finally(() => {
      startTikpalStateSnapshotCollector();
    });
  }
});

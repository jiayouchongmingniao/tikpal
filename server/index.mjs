import http from "node:http";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, open, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
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
const MPD_RECOVERY_COMMAND = process.env.TIKPAL_MPD_RECOVERY_COMMAND ?? "";
const MPD_RECOVERY_TIMEOUT_MS = parseEnvPositiveInteger(process.env.TIKPAL_MPD_RECOVERY_TIMEOUT_MS, 20_000);
const MPD_RECOVERY_SETTLE_MS = parseEnvPositiveInteger(process.env.TIKPAL_MPD_RECOVERY_SETTLE_MS, 2500);
const MPD_LOG_PATH = process.env.TIKPAL_MPD_LOG_PATH ?? "/var/log/mpd/log";
const STARTUP_SCENE_SOUND_ENABLED = parseEnvBoolean(process.env.TIKPAL_STARTUP_SCENE_SOUND_ENABLED ?? "1");
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
const DDCUTIL_UNAVAILABLE_BACKOFF_MS_RAW = Number(process.env.TIKPAL_DDCUTIL_UNAVAILABLE_BACKOFF_MS ?? 1_800_000);
const DDCUTIL_UNAVAILABLE_BACKOFF_MS = Number.isFinite(DDCUTIL_UNAVAILABLE_BACKOFF_MS_RAW) && DDCUTIL_UNAVAILABLE_BACKOFF_MS_RAW >= DDCUTIL_READ_CACHE_MS
  ? DDCUTIL_UNAVAILABLE_BACKOFF_MS_RAW
  : Math.max(1_800_000, DDCUTIL_READ_CACHE_MS);
const DDCUTIL_SUPPRESS_READ_WARNINGS = parseEnvBoolean(process.env.TIKPAL_DDCUTIL_SUPPRESS_READ_WARNINGS ?? "1");
const DDCUTIL_SUPPRESS_SYSLOG = parseEnvBoolean(process.env.TIKPAL_DDCUTIL_SUPPRESS_SYSLOG ?? "1");
const RUNTIME_DRM_MODE_TIMEOUT_MS_RAW = Number(process.env.TIKPAL_RUNTIME_DRM_MODE_TIMEOUT_MS ?? 500);
const RUNTIME_DRM_MODE_TIMEOUT_MS = Number.isFinite(RUNTIME_DRM_MODE_TIMEOUT_MS_RAW) && RUNTIME_DRM_MODE_TIMEOUT_MS_RAW > 0
  ? RUNTIME_DRM_MODE_TIMEOUT_MS_RAW
  : 500;
const FFPROBE_BIN = process.env.TIKPAL_FFPROBE_BIN ?? "ffprobe";
const FFMPEG_BIN = process.env.TIKPAL_FFMPEG_BIN ?? "ffmpeg";
const RADIO_ACTIVATE_COMMAND = process.env.TIKPAL_RADIO_ACTIVATE_COMMAND ?? "";
const RADIO_DEFAULT_URI = process.env.TIKPAL_RADIO_DEFAULT_URI ?? "";
const RADIO_LABEL = process.env.TIKPAL_RADIO_LABEL ?? "Last Station";
const SQLITE_BIN = process.env.TIKPAL_SQLITE_BIN ?? "sqlite3";
const RADIO_LOGO_DIR = resolve(process.env.TIKPAL_RADIO_LOGO_DIR ?? "/var/local/www/imagesw/radio-logos");
const RADIO_VOLUME_DEFAULT_PERCENT_RAW = Number(process.env.TIKPAL_RADIO_VOLUME_DEFAULT_PERCENT ?? 35);
const RADIO_VOLUME_DEFAULT_PERCENT = Number.isFinite(RADIO_VOLUME_DEFAULT_PERCENT_RAW)
  ? Math.max(1, Math.min(100, Math.round(RADIO_VOLUME_DEFAULT_PERCENT_RAW)))
  : 35;
const RADIO_SWITCH_RETRY_DELAYS_MS = parseEnvIntegerList(process.env.TIKPAL_RADIO_SWITCH_RETRY_DELAYS_MS, [250, 1000, 2000]);
const RADIO_START_VERIFY_WINDOW_MS = parseEnvPositiveInteger(process.env.TIKPAL_RADIO_START_VERIFY_WINDOW_MS, 5000);
const RADIO_START_VERIFY_POLL_MS = parseEnvPositiveInteger(process.env.TIKPAL_RADIO_START_VERIFY_POLL_MS, 500);
const RADIO_POST_START_SETTLE_MS = parseEnvPositiveInteger(process.env.TIKPAL_RADIO_POST_START_SETTLE_MS, 2000);
const RADIO_POST_START_RECOVERY_PLAYS = parseEnvPositiveInteger(process.env.TIKPAL_RADIO_POST_START_RECOVERY_PLAYS, 3);
const RADIO_LATE_PLAY_NUDGE_DELAYS_MS = parseEnvIntegerList(process.env.TIKPAL_RADIO_LATE_PLAY_NUDGE_DELAYS_MS, [1500, 3000, 5000, 8000, 12000, 16000]);
const RADIO_AUTO_SKIP_VERIFY_WINDOW_MS = parseEnvPositiveInteger(process.env.TIKPAL_RADIO_AUTO_SKIP_VERIFY_WINDOW_MS, 1500);
const RADIO_AUTO_SKIP_POST_START_SETTLE_MS = parseEnvPositiveInteger(process.env.TIKPAL_RADIO_AUTO_SKIP_POST_START_SETTLE_MS, 500);
const RADIO_AUTO_SKIP_RETRY_DELAYS_MS = parseEnvIntegerList(process.env.TIKPAL_RADIO_AUTO_SKIP_RETRY_DELAYS_MS, []);
const RADIO_XRUN_GRACE_MS = parseEnvPositiveInteger(process.env.TIKPAL_RADIO_XRUN_GRACE_MS, 15_000);
const RADIO_XRUN_WINDOW_MS = parseEnvPositiveInteger(process.env.TIKPAL_RADIO_XRUN_WINDOW_MS, 45_000);
const RADIO_XRUN_SKIP_THRESHOLD = parseEnvPositiveInteger(process.env.TIKPAL_RADIO_XRUN_SKIP_THRESHOLD, 4);
const RADIO_XRUN_LOG_TAIL_BYTES = parseEnvPositiveInteger(process.env.TIKPAL_RADIO_XRUN_LOG_TAIL_BYTES, 32_768);
const KIOSK_AUDIO_RELEASE_COMMAND = process.env.TIKPAL_KIOSK_AUDIO_RELEASE_COMMAND ?? "";
const KIOSK_AUDIO_RELEASE_SETTLE_MS = parseEnvPositiveInteger(process.env.TIKPAL_KIOSK_AUDIO_RELEASE_SETTLE_MS, 250);
const AUDIO_READY_COMMAND = process.env.TIKPAL_AUDIO_READY_COMMAND ?? "";
const AUDIO_ACTIVE_COMMAND = process.env.TIKPAL_AUDIO_ACTIVE_COMMAND ?? "";
const AUDIO_ACTIVATE_COMMAND = process.env.TIKPAL_AUDIO_ACTIVATE_COMMAND ?? "";
const AUDIO_LABEL_COMMAND = process.env.TIKPAL_AUDIO_LABEL_COMMAND ?? "";
const SPOTIFY_READY_COMMAND = process.env.TIKPAL_SPOTIFY_READY_COMMAND ?? "";
const SPOTIFY_ACTIVE_COMMAND = process.env.TIKPAL_SPOTIFY_ACTIVE_COMMAND ?? "";
const SPOTIFY_ACTIVATE_COMMAND = process.env.TIKPAL_SPOTIFY_ACTIVATE_COMMAND ?? "";
const SPOTIFY_DISABLE_COMMAND = process.env.TIKPAL_SPOTIFY_DISABLE_COMMAND ?? "";
const SPOTIFY_LABEL_COMMAND = process.env.TIKPAL_SPOTIFY_LABEL_COMMAND ?? "";
const SPOTIFY_METADATA_FILE = process.env.TIKPAL_SPOTIFY_METADATA_FILE ?? "/var/local/www/spotmeta.json";
const BLUETOOTH_READY_COMMAND = process.env.TIKPAL_BLUETOOTH_READY_COMMAND ?? "";
const BLUETOOTH_ACTIVE_COMMAND = process.env.TIKPAL_BLUETOOTH_ACTIVE_COMMAND ?? "";
const BLUETOOTH_ENABLE_COMMAND = process.env.TIKPAL_BLUETOOTH_ENABLE_COMMAND ?? "";
const BLUETOOTH_DISABLE_COMMAND = process.env.TIKPAL_BLUETOOTH_DISABLE_COMMAND ?? "";
const BLUETOOTH_LABEL_COMMAND = process.env.TIKPAL_BLUETOOTH_LABEL_COMMAND ?? "";
const BLUETOOTH_METADATA_COMMAND = process.env.TIKPAL_BLUETOOTH_METADATA_COMMAND ?? "";
const BLUETOOTH_TRANSPORT_AVAILABLE_COMMAND = process.env.TIKPAL_BLUETOOTH_TRANSPORT_AVAILABLE_COMMAND ?? "./deploy/moode/tikpal-bluetooth-transport.sh available";
const BLUETOOTH_PLAY_PAUSE_COMMAND = process.env.TIKPAL_BLUETOOTH_PLAY_PAUSE_COMMAND ?? "./deploy/moode/tikpal-bluetooth-transport.sh play-pause";
const BLUETOOTH_PLAY_COMMAND = process.env.TIKPAL_BLUETOOTH_PLAY_COMMAND ?? "./deploy/moode/tikpal-bluetooth-transport.sh play";
const BLUETOOTH_PAUSE_COMMAND = process.env.TIKPAL_BLUETOOTH_PAUSE_COMMAND ?? "./deploy/moode/tikpal-bluetooth-transport.sh pause";
const BLUETOOTH_NEXT_COMMAND = process.env.TIKPAL_BLUETOOTH_NEXT_COMMAND ?? "./deploy/moode/tikpal-bluetooth-transport.sh next";
const BLUETOOTH_PREVIOUS_COMMAND = process.env.TIKPAL_BLUETOOTH_PREVIOUS_COMMAND ?? "./deploy/moode/tikpal-bluetooth-transport.sh previous";
const AIRPLAY_READY_COMMAND = process.env.TIKPAL_AIRPLAY_READY_COMMAND ?? "";
const AIRPLAY_ACTIVE_COMMAND = process.env.TIKPAL_AIRPLAY_ACTIVE_COMMAND ?? "";
const AIRPLAY_ENABLE_COMMAND = process.env.TIKPAL_AIRPLAY_ENABLE_COMMAND ?? "";
const AIRPLAY_DISABLE_COMMAND = process.env.TIKPAL_AIRPLAY_DISABLE_COMMAND ?? "";
const AIRPLAY_LABEL_COMMAND = process.env.TIKPAL_AIRPLAY_LABEL_COMMAND ?? "";
const AIRPLAY_RECEIVER_ACTIVE_COMMAND = process.env.TIKPAL_AIRPLAY_RECEIVER_ACTIVE_COMMAND ?? "sh -lc '(command -v ss >/dev/null 2>&1 && ss -ltn sport = :7000 | grep -q LISTEN) || systemctl is-active --quiet shairport-sync.service'";
const AIRPLAY_METADATA_COMMAND = process.env.TIKPAL_AIRPLAY_METADATA_COMMAND ?? "";
const AIRPLAY_TRANSPORT_AVAILABLE_COMMAND = process.env.TIKPAL_AIRPLAY_TRANSPORT_AVAILABLE_COMMAND ?? "./deploy/moode/tikpal-airplay-transport.sh available";
const AIRPLAY_PLAY_PAUSE_COMMAND = process.env.TIKPAL_AIRPLAY_PLAY_PAUSE_COMMAND ?? "./deploy/moode/tikpal-airplay-transport.sh play-pause";
const AIRPLAY_PLAY_COMMAND = process.env.TIKPAL_AIRPLAY_PLAY_COMMAND ?? "./deploy/moode/tikpal-airplay-transport.sh play";
const AIRPLAY_PAUSE_COMMAND = process.env.TIKPAL_AIRPLAY_PAUSE_COMMAND ?? "./deploy/moode/tikpal-airplay-transport.sh pause";
const AIRPLAY_NEXT_COMMAND = process.env.TIKPAL_AIRPLAY_NEXT_COMMAND ?? "./deploy/moode/tikpal-airplay-transport.sh next";
const AIRPLAY_PREVIOUS_COMMAND = process.env.TIKPAL_AIRPLAY_PREVIOUS_COMMAND ?? "./deploy/moode/tikpal-airplay-transport.sh previous";
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
const HIFI_RUNTIME_RECOVERY_COOLDOWN_MS = 10_000;
const KIOSK_HEARTBEAT_STALE_MS_RAW = Number(process.env.TIKPAL_KIOSK_HEARTBEAT_STALE_MS ?? 30_000);
const KIOSK_HEARTBEAT_STALE_MS = Number.isFinite(KIOSK_HEARTBEAT_STALE_MS_RAW) && KIOSK_HEARTBEAT_STALE_MS_RAW >= 1_000
  ? KIOSK_HEARTBEAT_STALE_MS_RAW
  : 30_000;
const KIOSK_HEARTBEAT_PENDING_STUCK_MS_RAW = Number(process.env.TIKPAL_KIOSK_HEARTBEAT_PENDING_STUCK_MS ?? 45_000);
const KIOSK_HEARTBEAT_PENDING_STUCK_MS = Number.isFinite(KIOSK_HEARTBEAT_PENDING_STUCK_MS_RAW) && KIOSK_HEARTBEAT_PENDING_STUCK_MS_RAW >= 10_000
  ? KIOSK_HEARTBEAT_PENDING_STUCK_MS_RAW
  : 45_000;
const KIOSK_HEARTBEAT_EVENT_LOOP_LAG_MS_RAW = Number(process.env.TIKPAL_KIOSK_HEARTBEAT_EVENT_LOOP_LAG_MS ?? 5_000);
const KIOSK_HEARTBEAT_EVENT_LOOP_LAG_MS = Number.isFinite(KIOSK_HEARTBEAT_EVENT_LOOP_LAG_MS_RAW) && KIOSK_HEARTBEAT_EVENT_LOOP_LAG_MS_RAW >= 1_000
  ? KIOSK_HEARTBEAT_EVENT_LOOP_LAG_MS_RAW
  : 5_000;
const AIRPLAY_DIRECT_METADATA_REFRESH_MIN_MS_RAW = Number(process.env.TIKPAL_AIRPLAY_DIRECT_METADATA_REFRESH_MIN_MS ?? 1000);
const AIRPLAY_DIRECT_METADATA_REFRESH_MIN_MS = Number.isFinite(AIRPLAY_DIRECT_METADATA_REFRESH_MIN_MS_RAW) && AIRPLAY_DIRECT_METADATA_REFRESH_MIN_MS_RAW >= 250
  ? AIRPLAY_DIRECT_METADATA_REFRESH_MIN_MS_RAW
  : 1000;
const RECOGNITION_PROVIDER = (process.env.TIKPAL_RECOGNITION_PROVIDER ?? "").trim().toLowerCase();
const ACRCLOUD_HOST = process.env.TIKPAL_ACRCLOUD_HOST ?? "";
const ACRCLOUD_ACCESS_KEY = process.env.TIKPAL_ACRCLOUD_ACCESS_KEY ?? "";
const ACRCLOUD_ACCESS_SECRET = process.env.TIKPAL_ACRCLOUD_ACCESS_SECRET ?? "";
const BLUETOOTH_CAPTURE_COMMAND = process.env.TIKPAL_BLUETOOTH_CAPTURE_COMMAND ?? "";
const AIRPLAY_CAPTURE_COMMAND = process.env.TIKPAL_AIRPLAY_CAPTURE_COMMAND ?? "";
const AIRPLAY_ARTWORK_ROOT = resolve(process.env.TIKPAL_AIRPLAY_ARTWORK_ROOT ?? "/var/local/www/imagesw/airplay-covers");
const SCENE_CONTEXT_GEO_URL = (process.env.TIKPAL_SCENE_CONTEXT_GEO_URL ?? "https://ipapi.co/json/").trim();
const SCENE_CONTEXT_GEO_TIMEOUT_MS_RAW = Number(process.env.TIKPAL_SCENE_CONTEXT_GEO_TIMEOUT_MS ?? 3000);
const SCENE_CONTEXT_GEO_TIMEOUT_MS = Number.isFinite(SCENE_CONTEXT_GEO_TIMEOUT_MS_RAW) && SCENE_CONTEXT_GEO_TIMEOUT_MS_RAW > 0
  ? SCENE_CONTEXT_GEO_TIMEOUT_MS_RAW
  : 3000;
const SCENE_CONTEXT_GEO_CACHE_MS_RAW = Number(process.env.TIKPAL_SCENE_CONTEXT_GEO_CACHE_MS ?? 3_600_000);
const SCENE_CONTEXT_GEO_CACHE_MS = Number.isFinite(SCENE_CONTEXT_GEO_CACHE_MS_RAW) && SCENE_CONTEXT_GEO_CACHE_MS_RAW >= 60_000
  ? SCENE_CONTEXT_GEO_CACHE_MS_RAW
  : 3_600_000;
const SCENE_CONTEXT_WEATHER_URL = (process.env.TIKPAL_SCENE_CONTEXT_WEATHER_URL ?? "https://api.open-meteo.com/v1/forecast").trim();
const SCENE_CONTEXT_WEATHER_TIMEOUT_MS_RAW = Number(process.env.TIKPAL_SCENE_CONTEXT_WEATHER_TIMEOUT_MS ?? 3000);
const SCENE_CONTEXT_WEATHER_TIMEOUT_MS = Number.isFinite(SCENE_CONTEXT_WEATHER_TIMEOUT_MS_RAW) && SCENE_CONTEXT_WEATHER_TIMEOUT_MS_RAW > 0
  ? SCENE_CONTEXT_WEATHER_TIMEOUT_MS_RAW
  : 3000;
const SCENE_CONTEXT_WEATHER_CACHE_MS_RAW = Number(process.env.TIKPAL_SCENE_CONTEXT_WEATHER_CACHE_MS ?? 900_000);
const SCENE_CONTEXT_WEATHER_CACHE_MS = Number.isFinite(SCENE_CONTEXT_WEATHER_CACHE_MS_RAW) && SCENE_CONTEXT_WEATHER_CACHE_MS_RAW >= 60_000
  ? SCENE_CONTEXT_WEATHER_CACHE_MS_RAW
  : 900_000;
const BLUETOOTH_CAPTURE_DURATION_SECONDS = Number(process.env.TIKPAL_BLUETOOTH_CAPTURE_DURATION_SECONDS ?? 10);
const AIRPLAY_CAPTURE_DURATION_SECONDS = Number(process.env.TIKPAL_AIRPLAY_CAPTURE_DURATION_SECONDS ?? 6);
const BLUETOOTH_RECOGNITION_SETTLE_MS = Number(process.env.TIKPAL_BLUETOOTH_RECOGNITION_SETTLE_MS ?? 4000);
const AIRPLAY_RECOGNITION_SETTLE_MS = Number(process.env.TIKPAL_AIRPLAY_RECOGNITION_SETTLE_MS ?? 1000);
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
const LYRICS_OVH_BASE_URL = process.env.TIKPAL_LYRICS_OVH_BASE_URL ?? "https://api.lyrics.ovh";
const LYRICS_CUSTOM_URL_TEMPLATE = process.env.TIKPAL_LYRICS_CUSTOM_URL_TEMPLATE ?? "";
const LYRICS_CUSTOM_AUTH_HEADER = process.env.TIKPAL_LYRICS_CUSTOM_AUTH_HEADER ?? "";
const THEAUDIODB_BASE_URL = process.env.TIKPAL_THEAUDIODB_BASE_URL ?? "https://www.theaudiodb.com";
const THEAUDIODB_API_KEY = process.env.TIKPAL_THEAUDIODB_API_KEY ?? "123";
const REMOTE_METADATA_TIMEOUT_MS = Number(process.env.TIKPAL_REMOTE_METADATA_TIMEOUT_MS ?? 4500);
const LYRICS_ERROR_BACKOFF_MS = Number(process.env.TIKPAL_LYRICS_ERROR_BACKOFF_MS ?? 90000);
const SUPPORTED_LYRICS_PROVIDERS = new Set(["lrclib", "custom", "lyricsovh"]);
const LYRICS_PROVIDER_CHAIN = normalizeLyricsProviderChain(process.env.TIKPAL_LYRICS_PROVIDER_CHAIN ?? "lrclib,lyricsovh");
const LYRICS_PROVIDER_CACHE_VERSION = createHash("sha1")
  .update(JSON.stringify({
    chain: LYRICS_PROVIDER_CHAIN,
    lyricsOvhBaseUrl: LYRICS_OVH_BASE_URL,
    customUrlTemplate: LYRICS_CUSTOM_URL_TEMPLATE
  }))
  .digest("hex")
  .slice(0, 12);
const BLUETOOTH_LYRICS_MIN_TIMED_DURATION_MS = 30_000;
const BLUETOOTH_LYRICS_DURATION_GRACE_MS = 2_000;
const AIRPLAY_METADATA_POSITION_GRACE_MS = 30_000;
const AIRPLAY_LYRICS_UNRELIABLE_DURATION_MS = 45_000;
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
const AUDIO_VOLUME_STATE_PATH = resolve(process.env.TIKPAL_AUDIO_VOLUME_STATE_PATH ?? resolve(process.cwd(), ".tikpal", "audio-volume-state.json"));
const AUDIO_SOURCE_MEMORY_STATE_PATH = resolve(process.env.TIKPAL_AUDIO_SOURCE_MEMORY_STATE_PATH ?? resolve(process.cwd(), ".tikpal", "audio-source-memory.json"));
const WEB_MODE_SETTINGS_PATH = resolve(process.env.TIKPAL_WEB_MODE_SETTINGS_PATH ?? resolve(process.cwd(), ".tikpal", "web-mode-settings.json"));
const WEB_MODE_STATE_PATH = resolve(process.env.TIKPAL_WEB_MODE_STATE_PATH ?? resolve(process.cwd(), ".tikpal", "web-mode-state.json"));
const WEB_MODE_COMMAND = process.env.TIKPAL_WEB_MODE_COMMAND ?? (API_MODE === "mpc" ? "./deploy/chromium/tikpal-web-mode.sh" : "");
const WEB_MODE_PROXY_TEST_URL = process.env.TIKPAL_WEB_MODE_PROXY_TEST_URL ?? "https://open.spotify.com/";
const WEB_MODE_DEFAULT_PROXY_URL = process.env.TIKPAL_WEB_MODE_DEFAULT_PROXY_URL ?? "http://192.168.10.140:7897";
const WEB_MODE_PROXY_TEST_NETWORK = parseEnvBoolean(process.env.TIKPAL_WEB_MODE_PROXY_TEST_NETWORK ?? "0");
const LOCAL_LIBRARY_COVER_COLUMNS = ["cover_relative_path", "cover_path", "album_art_relative_path", "artwork_relative_path"];
const LOCAL_LIBRARY_COVER_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];
const PUBLIC_ASSETS_ROOT = resolve(process.env.TIKPAL_PUBLIC_ASSETS_ROOT ?? resolve(process.cwd(), "public", "assets"));
const PUBLIC_SCENES_ROOT = resolve(PUBLIC_ASSETS_ROOT, "scenes");
const SCENE_VIDEO_MANIFEST_PATH = resolve(PUBLIC_SCENES_ROOT, "_metadata", "scene_videos.json");
const AMBIENT_BACKGROUND_VIDEO_EXTENSIONS = new Set([".mp4"]);
const SCENE_AUDIO_GAIN_MIN_DB = -24;
const SCENE_AUDIO_GAIN_MAX_DB = 12;
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
const REMEMBERED_AUDIO_SOURCE_TARGETS = new Set(["mpd", "radio", "spotify", "bluetooth", "airplay", "upnp"]);
const COMMAND_HANDOFF_SOURCE_TARGETS = new Set(["spotify", "bluetooth", "airplay", "upnp"]);
const WEB_MODE_PROVIDERS = [
  { id: "suno", label: "Suno", url: "https://suno.com/explore", experimental: false },
  { id: "spotify", label: "Spotify", url: "https://open.spotify.com/", experimental: false },
  { id: "youtube_music", label: "YouTube Music", url: "https://music.youtube.com/", experimental: false },
  { id: "apple_music", label: "Apple Music", url: "https://music.apple.com/", experimental: false },
  { id: "tidal", label: "TIDAL", url: "https://listen.tidal.com/", experimental: false },
  { id: "qobuz", label: "Qobuz", url: "https://play.qobuz.com/", experimental: false },
  { id: "deezer", label: "Deezer", url: "https://www.deezer.com/en/channels/explore/", experimental: false },
  { id: "amazon_music", label: "Amazon Music", url: "https://music.amazon.com/", experimental: false },
  { id: "qq_music", label: "QQ Music", url: "https://y.qq.com/n/ryqq/player", experimental: false },
  { id: "netease_music", label: "NetEase Cloud Music", url: "https://music.163.com/st/webplayer", experimental: false }
];
const WEB_MODE_PROVIDER_IDS = new Set(WEB_MODE_PROVIDERS.map((provider) => provider.id));
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
const RADIO_CATEGORY_ORDER = ["focus", "calm", "sleep", "hifi", "jazz", "classical", "news"];
const RADIO_CATEGORY_LABELS = {
  focus: "Focus",
  calm: "Calm",
  sleep: "Sleep",
  hifi: "Hi-Fi",
  jazz: "Jazz",
  classical: "Classical",
  news: "News"
};
const RADIO_LOGO_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];
const MOCK_RADIO_LOGO_URL = "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22120%22%20height%3D%22120%22%3E%3Crect%20width%3D%22120%22%20height%3D%22120%22%20fill%3D%22%231f2937%22%2F%3E%3Ccircle%20cx%3D%2260%22%20cy%3D%2260%22%20r%3D%2238%22%20fill%3D%22%23d6b761%22%2F%3E%3Ctext%20x%3D%2260%22%20y%3D%2268%22%20font-family%3D%22Arial%22%20font-size%3D%2228%22%20font-weight%3D%22700%22%20text-anchor%3D%22middle%22%20fill%3D%22%231f2937%22%3ER%3C%2Ftext%3E%3C%2Fsvg%3E";
const RADIO_LOGO_ALIASES = new Map([
  ["Tikpal Focus - Radio Paradise Main", "Radio Paradise - Main Mix.jpg"],
  ["Tikpal Focus - FIP", "France Inter Paris (FIP).jpg"],
  ["Tikpal Focus - BBC 6 Music", "BBC Radio 6 music (320K).jpg"],
  ["Tikpal Focus - KEXP Seattle", "KEXP 90.3 FM Seattle.jpg"],
  ["Tikpal Focus - NTS Live 1", "NTS Live 1.jpg"],
  ["Tikpal Focus - Groove Salad", "Soma FM - Groove Salad.jpg"],
  ["Tikpal Focus - Beat Blender", "Soma FM - Beat Blender.jpg"],
  ["Tikpal Focus - Naim Radio", "Naim Radio.jpg"],
  ["Tikpal Calm - FluxFM Chillout", "FluxFM - Chillout Radio.jpg"],
  ["Tikpal Calm - Hi On Line Lounge", "Hi On Line - Lounge.jpg"],
  ["Tikpal Sleep - Ambient Sleeping Pill", "Ambient Sleeping Pill.jpg"],
  ["Tikpal Sleep - Mission Control", "Soma FM - Mission Control.jpg"],
  ["Tikpal HiFi - Hi On Line Pop FLAC", "Hi On Line - Pop (FLAC).jpg"],
  ["Tikpal HiFi - Linn Radio", "Linn Radio.jpg"],
  ["Tikpal HiFi - Linn Classical", "Linn Classical.jpg"],
  ["Tikpal HiFi - Linn Jazz", "Linn Jazz.jpg"],
  ["Tikpal HiFi - Naim Classical", "Naim Classical.jpg"],
  ["Tikpal HiFi - Naim Jazz", "Naim Jazz.jpg"],
  ["Tikpal Jazz - SmoothJazz Global", "SmoothJazz Global.jpg"],
  ["Tikpal Jazz - SwissGroove", "SwissGroove.jpg"],
  ["Tikpal Jazz - France Musique Jazz", "France Musique La Jazz.jpg"],
  ["Tikpal Jazz - DR P8 Jazz", "DR P8 Jazz (320K).jpg"],
  ["Tikpal Jazz - Sonic Universe", "Soma FM - Sonic Universe.jpg"],
  ["Tikpal Classical - WQXR New York", "WQXR New York - Classical Music.jpg"],
  ["Tikpal Classical - Positivly Baroque", "Positivly Baroque.jpg"],
  ["Tikpal News - BBC Radio 4", "BBC Radio 4 FM (320K).jpg"],
  ["Tikpal News - France Culture", "France Culture Live.jpg"],
  ["Tikpal News - DR P1", "DR P1.jpg"],
  ["Tikpal News - Radio SRF 4 News", "Radio SRF 4 News.jpg"]
]);
const HIFI_EQ_PRESET_IDS = new Set(HIFI_EQ_PRESETS.map((preset) => preset.id));
const HIFI_VISUAL_PRESETS = new Set(["spectrum-bars", "waveform", "dual-vu"]);
const DEFAULT_HIFI_EQ_PRESET_ID = "flat";
const DEFAULT_HIFI_VISUAL_PRESET_ID = "spectrum-bars";
const SCENE_MEMORY_ROOM_MODES = new Set(["focus", "calm", "sleep"]);
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
    sceneSoundEnabled: true,
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
    sceneSoundEnabled: true,
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
    sceneSoundEnabled: true,
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

function parseEnvBoolean(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "on", "enabled"].includes(normalized);
}

function parseEnvPositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function parseEnvIntegerList(value, fallback) {
  if (!value) return fallback;
  const parsed = String(value)
    .split(",")
    .map((entry) => parseEnvPositiveInteger(entry.trim(), null))
    .filter((entry) => Number.isFinite(entry));
  return parsed.length > 0 ? parsed : fallback;
}

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
let kioskHeartbeat = null;
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
let displayBrightnessUnavailableUntilMs = 0;
let tikpalStateSnapshotCache = null;
let tikpalStateSnapshotRefreshPromise = null;
let tikpalStateSnapshotRefreshTimer = null;
let tikpalStateSnapshotRefreshQueued = false;
let tikpalStateSnapshotGeneration = 0;
let startupPlaybackPolicyPromise = null;
let hifiRuntimeRecoveryPromise = null;
let hifiRuntimeRecoveryLastAttemptAtMs = 0;
let sourceSwitchInFlightCount = 0;
let mpdRecoveryPromise = null;
let mpcRadioWeakNetworkRecoveryPromise = null;
let mpcRadioWeakNetworkState = null;
let mpcRadioCatalogReadyCache = false;
let mpcRadioCatalogCountCache = 0;
let activeMpcRadioStationCache = null;
let audioSourceMemoryStateCache = null;
let airplayDirectMetadataRefreshPromise = null;
let airplayDirectMetadataRefreshAtMs = 0;
let sceneContextGeoCache = null;
let sceneContextGeoRefreshPromise = null;
let sceneContextWeatherCache = null;
let sceneContextWeatherRefreshPromise = null;

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

function buildSourceSummary({ id, label, availability, active, controllability, secondaryStatus, radioStationId = null }) {
  const summary = {
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
  if (id === "radio") {
    summary.radioStationId = typeof radioStationId === "string" && radioStationId.trim() ? radioStationId.trim() : null;
  }
  return summary;
}

function buildRadioStationSummary({
  id,
  label,
  uri,
  genre,
  bitrateKbps,
  codec,
  secondaryStatus,
  active,
  category = null,
  categoryLabel = null,
  tags = [],
  broadcaster = null,
  logoUrl = null,
  catalogSource = "moode",
  sortOrder = null
}) {
  return {
    id,
    label,
    uri,
    genre: genre ?? "",
    bitrateKbps: bitrateKbps ?? null,
    codec: codec ?? null,
    category,
    categoryLabel,
    tags,
    broadcaster,
    logoUrl,
    catalogSource,
    sortOrder,
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

function asPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function finiteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function setKioskHeartbeat(payload) {
  kioskHeartbeat = {
    receivedAtMs: Date.now(),
    payload: asPlainObject(payload)
  };
  return buildKioskHeartbeatStatus();
}

function buildKioskHeartbeatStatus(now = Date.now()) {
  const thresholds = {
    staleMs: KIOSK_HEARTBEAT_STALE_MS,
    pendingStuckMs: KIOSK_HEARTBEAT_PENDING_STUCK_MS,
    eventLoopLagMs: KIOSK_HEARTBEAT_EVENT_LOOP_LAG_MS
  };

  if (!kioskHeartbeat) {
    return {
      ok: true,
      healthy: false,
      status: "unseen",
      ageMs: null,
      reasons: ["heartbeat-unseen"],
      thresholds,
      receivedAt: null,
      heartbeat: null
    };
  }

  const payload = asPlainObject(kioskHeartbeat.payload);
  const ageMs = now - kioskHeartbeat.receivedAtMs;
  const reasons = [];
  if (ageMs > KIOSK_HEARTBEAT_STALE_MS) {
    reasons.push("heartbeat-stale");
  }

  const status = asPlainObject(payload.status);
  const pending = asPlainObject(status.pending);
  const pendingDurationMs = finiteNumber(pending.durationMs);
  if (pending.active === true && pendingDurationMs !== null && pendingDurationMs > KIOSK_HEARTBEAT_PENDING_STUCK_MS) {
    reasons.push(`pending-stuck:${String(pending.kind ?? "unknown")}`);
  }

  const eventLoop = asPlainObject(payload.eventLoop);
  const eventLoopLagMs = finiteNumber(eventLoop.lagMs);
  if (eventLoopLagMs !== null && eventLoopLagMs > KIOSK_HEARTBEAT_EVENT_LOOP_LAG_MS) {
    reasons.push("event-loop-lag");
  }

  const playback = asPlainObject(payload.playback);
  const scene = asPlainObject(payload.scene);
  const activeSceneVideo = asPlainObject(payload.activeSceneVideo);
  if (playback.source === "scene" && scene.sceneVideoEnabled === true) {
    const sceneTransitionActive = activeSceneVideo.transition === "scene"
      && activeSceneVideo.transitionPhase
      && activeSceneVideo.transitionPhase !== "idle";
    if (activeSceneVideo.present === false && !sceneTransitionActive) {
      reasons.push("scene-video-missing");
    }

    const sceneVideoHealth = String(activeSceneVideo.health ?? "");
    if (sceneVideoHealth === "stalled" || sceneVideoHealth === "fallback" || sceneVideoHealth === "error") {
      reasons.push(`scene-video-${sceneVideoHealth}`);
    }

    const readyState = finiteNumber(activeSceneVideo.readyState);
    if (scene.sceneSoundEnabled === true && readyState !== null && readyState < 2) {
      reasons.push("scene-video-not-ready");
    }
  }

  return {
    ok: true,
    healthy: reasons.length === 0,
    status: reasons.length === 0 ? "fresh" : reasons.includes("heartbeat-stale") ? "stale" : "unhealthy",
    ageMs,
    reasons,
    thresholds,
    receivedAt: new Date(kioskHeartbeat.receivedAtMs).toISOString(),
    heartbeat: payload
  };
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

function getSceneDayPart(hour) {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

function normalizeGeoText(value, maxLength = 48) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  return text ? text.slice(0, maxLength) : "";
}

function normalizeCoordinate(value, { min, max }) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < min || numeric > max) return null;
  return numeric;
}

function normalizeIpGeoBody(body) {
  if (!body || body.success === false || body.status === "fail") return null;

  const city = normalizeGeoText(body.city);
  const region = normalizeGeoText(body.region ?? body.regionName);
  const country = normalizeGeoText(body.country_name ?? body.country);
  const countryCode = normalizeGeoText(body.country_code ?? body.countryCode, 8).toUpperCase() || null;
  const timeZone = normalizeTimeZone(body.timezone ?? body.time_zone);
  const latitude = normalizeCoordinate(body.latitude ?? body.lat, { min: -90, max: 90 });
  const longitude = normalizeCoordinate(body.longitude ?? body.lon, { min: -180, max: 180 });
  const locationLabel = city || region || country || null;

  if (!locationLabel && !countryCode && !timeZone && latitude === null && longitude === null) return null;
  return {
    locationLabel,
    countryCode,
    timeZone,
    latitude,
    longitude
  };
}

function getWeatherConditionFromCode(code, precipitation) {
  if (Number.isFinite(precipitation) && precipitation > 0.1) return "rainy";
  if (!Number.isFinite(code)) return null;
  if (code >= 95) return "stormy";
  if (code >= 71 && code <= 86) return "snowy";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rainy";
  if (code === 45 || code === 48) return "foggy";
  if (code >= 1 && code <= 3) return "cloudy";
  if (code === 0) return "clear";
  return null;
}

function getWeatherLabel(condition) {
  switch (condition) {
    case "clear":
      return "Clear";
    case "cloudy":
      return "Cloudy";
    case "foggy":
      return "Foggy";
    case "rainy":
      return "Rainy";
    case "snowy":
      return "Snowy";
    case "stormy":
      return "Stormy";
    default:
      return null;
  }
}

function normalizeWeatherBody(body) {
  const current = body?.current ?? body?.current_weather ?? {};
  const weatherCode = Number(current.weather_code ?? current.weathercode);
  const precipitationValues = [
    current.precipitation,
    current.rain,
    current.showers,
    current.snowfall
  ].map(Number).filter(Number.isFinite);
  const precipitation = precipitationValues.reduce((total, value) => total + value, 0);
  const condition = getWeatherConditionFromCode(weatherCode, precipitation);
  const label = getWeatherLabel(condition);
  if (!condition || !label) return null;
  return {
    condition,
    label,
    weatherCode: Number.isFinite(weatherCode) ? weatherCode : null,
    precipitation,
    source: "ip_weather"
  };
}

function buildWeatherUrl(latitude, longitude, timeZone) {
  const url = new URL(SCENE_CONTEXT_WEATHER_URL);
  url.searchParams.set("latitude", latitude.toFixed(4));
  url.searchParams.set("longitude", longitude.toFixed(4));
  url.searchParams.set("current", "weather_code,precipitation,rain,showers,snowfall");
  url.searchParams.set("timezone", timeZone || "auto");
  return url.toString();
}

async function resolveSceneContextGeo() {
  const now = Date.now();
  if (sceneContextGeoCache && sceneContextGeoCache.expiresAt > now) {
    return sceneContextGeoCache.value;
  }
  if (sceneContextGeoRefreshPromise) {
    return sceneContextGeoRefreshPromise;
  }
  if (!SCENE_CONTEXT_GEO_URL) {
    return null;
  }

  sceneContextGeoRefreshPromise = (async () => {
    try {
      const { response, body } = await fetchJsonWithTimeout(SCENE_CONTEXT_GEO_URL, {
        timeoutMs: SCENE_CONTEXT_GEO_TIMEOUT_MS,
        headers: {
          Accept: "application/json",
          "User-Agent": `Tikpal/${APP_VERSION}`
        }
      });
      const value = response.ok ? normalizeIpGeoBody(body) : null;
      sceneContextGeoCache = {
        expiresAt: now + SCENE_CONTEXT_GEO_CACHE_MS,
        value
      };
      return value;
    } catch {
      sceneContextGeoCache = {
        expiresAt: now + Math.min(SCENE_CONTEXT_GEO_CACHE_MS, 600_000),
        value: null
      };
      return null;
    } finally {
      sceneContextGeoRefreshPromise = null;
    }
  })();

  return sceneContextGeoRefreshPromise;
}

async function resolveSceneContextWeather(geo, timeZone) {
  if (!geo || geo.latitude === null || geo.longitude === null || !SCENE_CONTEXT_WEATHER_URL) {
    return null;
  }

  const cacheKey = [
    geo.latitude.toFixed(2),
    geo.longitude.toFixed(2),
    timeZone
  ].join(":");
  const now = Date.now();
  if (sceneContextWeatherCache?.key === cacheKey && sceneContextWeatherCache.expiresAt > now) {
    return sceneContextWeatherCache.value;
  }
  if (sceneContextWeatherRefreshPromise?.key === cacheKey) {
    return sceneContextWeatherRefreshPromise.promise;
  }

  const promise = (async () => {
    try {
      const { response, body } = await fetchJsonWithTimeout(buildWeatherUrl(geo.latitude, geo.longitude, timeZone), {
        timeoutMs: SCENE_CONTEXT_WEATHER_TIMEOUT_MS,
        headers: {
          Accept: "application/json",
          "User-Agent": `Tikpal/${APP_VERSION}`
        }
      });
      const value = response.ok ? normalizeWeatherBody(body) : null;
      sceneContextWeatherCache = {
        key: cacheKey,
        expiresAt: now + SCENE_CONTEXT_WEATHER_CACHE_MS,
        value
      };
      return value;
    } catch {
      sceneContextWeatherCache = {
        key: cacheKey,
        expiresAt: now + Math.min(SCENE_CONTEXT_WEATHER_CACHE_MS, 300_000),
        value: null
      };
      return null;
    } finally {
      sceneContextWeatherRefreshPromise = null;
    }
  })();

  sceneContextWeatherRefreshPromise = { key: cacheKey, promise };
  return promise;
}

async function buildSceneContextPayload(searchParams = new URLSearchParams()) {
  const requestedTimeZone = normalizeTimeZone(searchParams.get("timeZone"));
  const geo = await resolveSceneContextGeo();
  const timeZone = geo?.timeZone ?? requestedTimeZone ?? DEFAULT_NIGHT_SCHEDULE.timeZone;
  const localMinutes = getLocalMinutesForTimeZone(new Date(), timeZone);
  const localHour = Math.floor(localMinutes / 60);
  const locationLabel = geo?.locationLabel ?? null;
  const source = locationLabel ? "ip" : requestedTimeZone ? "timezone" : "fallback";
  const weather = await resolveSceneContextWeather(geo, timeZone);

  return {
    timeZone,
    dayPart: getSceneDayPart(localHour),
    localHour,
    locationLabel,
    countryCode: geo?.countryCode ?? null,
    weather,
    source,
    updatedAt: new Date().toISOString()
  };
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

function normalizeSceneVideoByMode(raw, mode, sceneVideoId) {
  const source = asPlainObject(raw?.sceneVideoByMode);
  const byMode = {};
  for (const roomMode of SCENE_MEMORY_ROOM_MODES) {
    const id = String(source[roomMode] ?? "").trim();
    if (id) byMode[roomMode] = id;
  }

  const normalizedMode = normalizeRoomMode(mode);
  const normalizedSceneVideoId = String(sceneVideoId ?? "").trim();
  if (SCENE_MEMORY_ROOM_MODES.has(normalizedMode) && normalizedSceneVideoId) {
    byMode[normalizedMode] = byMode[normalizedMode] ?? normalizedSceneVideoId;
  }

  return byMode;
}

function rememberSceneVideoForRoomMode(state, mode = state?.mode, sceneVideoId = state?.sceneVideoId) {
  const normalizedMode = normalizeRoomMode(mode);
  const normalizedSceneVideoId = String(sceneVideoId ?? "").trim();
  if (!SCENE_MEMORY_ROOM_MODES.has(normalizedMode) || !normalizedSceneVideoId) {
    return state;
  }
  return {
    ...state,
    sceneVideoByMode: {
      ...asPlainObject(state?.sceneVideoByMode),
      [normalizedMode]: normalizedSceneVideoId
    }
  };
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
    sceneVideoByMode: normalizeSceneVideoByMode(raw, base.mode, raw?.sceneVideoId ?? preset.sceneVideoId),
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
          : "No radio route configured",
      radioStationId: radioActive ? activeRadio?.id ?? null : null
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
    sources,
    rememberedSource: getCachedRememberedAudioSource()
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
      label: "Tikpal Focus - Groove Salad",
      uri: "http://ice1.somafm.com/groovesalad-128-aac",
      genre: "Focus, Electronica, Ambient, Down-Tempo",
      bitrateKbps: 128,
      codec: "MP3",
      category: "focus",
      categoryLabel: "Focus",
      tags: ["Electronica", "Ambient", "Down-Tempo"],
      broadcaster: "Soma FM",
      logoUrl: MOCK_RADIO_LOGO_URL,
      catalogSource: "tikpal",
      sortOrder: 1,
      secondaryStatus: "Focus · Soma FM · 128 kbps · MP3",
      active: mockActiveSource === "radio" && mockActiveRadioStationId === "radio-1"
    }),
    buildRadioStationSummary({
      id: "radio-2",
      label: "Tikpal Calm - Radio Paradise Mellow",
      uri: "http://radio.stereoscenic.com/ama-h",
      genre: "Calm, Rock, Mellow Rock",
      bitrateKbps: 256,
      codec: "MP3",
      category: "calm",
      categoryLabel: "Calm",
      tags: ["Rock", "Mellow Rock"],
      broadcaster: "Radio Paradise",
      logoUrl: MOCK_RADIO_LOGO_URL,
      catalogSource: "tikpal",
      sortOrder: 2,
      secondaryStatus: "Calm · Radio Paradise · 256 kbps · MP3",
      active: mockActiveSource === "radio" && mockActiveRadioStationId === "radio-2"
    }),
    buildRadioStationSummary({
      id: "radio-3",
      label: "1.FM - Blues Radio",
      uri: "http://radio.6forty.com:8000/6forty",
      genre: "Blues",
      bitrateKbps: 192,
      codec: "MP3",
      category: null,
      categoryLabel: null,
      tags: ["Blues"],
      broadcaster: "1.FM",
      logoUrl: null,
      catalogSource: "moode",
      sortOrder: 3,
      secondaryStatus: "Blues · 1.FM · 192 kbps · MP3",
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
      killSignal: "SIGKILL",
      maxBuffer: 1024 * 256
    });
    return stdout.trim();
  } catch (error) {
    if (options.allowFailure) return "";
    const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
    const stdout = options.includeStdoutOnFailure && typeof error?.stdout === "string" ? error.stdout.trim() : "";
    const fallback = error instanceof Error ? error.message : `Command failed: ${command}`;
    const message = options.includeStdoutOnFailure
      ? [stderr, stdout, fallback].filter(Boolean).join("\n")
      : stderr || fallback;
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

const AIRPLAY_REMOTE_UNAVAILABLE_REASON = "AirPlay remote control is unavailable from this sender";
const BLUETOOTH_REMOTE_UNAVAILABLE_REASON = "Bluetooth AVRCP control is unavailable from this sender";

function buildPlaybackTransportCapabilities(source, options = {}) {
  const base = {
    playPause: true,
    play: true,
    pause: true,
    next: true,
    previous: true,
    seek: true,
    reason: null
  };

  if (source === "airplay") {
    const available = options.airplayRemoteControlAvailable === true;
    return {
      playPause: available,
      play: available,
      pause: available,
      next: available,
      previous: available,
      seek: false,
      reason: available ? null : AIRPLAY_REMOTE_UNAVAILABLE_REASON
    };
  }

  if (source === "bluetooth") {
    const available = options.bluetoothRemoteControlAvailable === true;
    return {
      playPause: available,
      play: available,
      pause: available,
      next: available,
      previous: available,
      seek: false,
      reason: available ? null : BLUETOOTH_REMOTE_UNAVAILABLE_REASON
    };
  }

  if (source === "scene") {
    return {
      ...base,
      next: false,
      previous: false,
      seek: false,
      reason: null
    };
  }

  if (source === "radio") {
    return {
      ...base,
      seek: false
    };
  }

  if (source === "spotify" || source === "upnp") {
    return {
      playPause: false,
      play: false,
      pause: false,
      next: false,
      previous: false,
      seek: false,
      reason: `${source} transport is controlled by the sender`
    };
  }

  return base;
}

function getCachedBluetoothTransportAvailable() {
  const cachedPlayback = tikpalStateSnapshotCache?.state?.playback;
  if (cachedPlayback?.source !== "bluetooth") return null;
  const capabilities = cachedPlayback.transportCapabilities;
  if (!capabilities) return null;
  return capabilities.playPause === true
    && capabilities.next === true
    && capabilities.previous === true;
}

async function readBluetoothTransportAvailable(includeSlowRuntimeStatus) {
  if (!BLUETOOTH_TRANSPORT_AVAILABLE_COMMAND.trim()) return false;
  if (!includeSlowRuntimeStatus) {
    return getCachedBluetoothTransportAvailable() === true;
  }
  return await commandSucceeds(BLUETOOTH_TRANSPORT_AVAILABLE_COMMAND, { timeout: 2500 });
}

function getCachedAirplayTransportAvailable() {
  const cachedPlayback = tikpalStateSnapshotCache?.state?.playback;
  if (cachedPlayback?.source !== "airplay") return null;
  const capabilities = cachedPlayback.transportCapabilities;
  if (!capabilities) return null;
  return capabilities.playPause === true
    && capabilities.next === true
    && capabilities.previous === true;
}

async function readAirplayTransportAvailable(includeSlowRuntimeStatus) {
  if (!AIRPLAY_TRANSPORT_AVAILABLE_COMMAND.trim()) return false;
  if (!includeSlowRuntimeStatus) {
    return getCachedAirplayTransportAvailable() === true;
  }
  return await commandSucceeds(AIRPLAY_TRANSPORT_AVAILABLE_COMMAND, { timeout: 2500 });
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const timeout = options.timeout ?? 3500;
  try {
    const { stdout } = await execFileAsync(MPC_BIN, ["--host", MPD_HOST, "--port", MPD_PORT, ...args], {
      timeout,
      killSignal: "SIGKILL",
      maxBuffer: 1024 * 256
    });
    return stdout.trimEnd();
  } catch (error) {
    const stdout = typeof error?.stdout === "string" ? error.stdout.trimEnd() : "";
    const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
    if (options.allowFailure) return stdout;
    const timedOut = error?.killed === true || error?.signal === "SIGKILL" || error?.code === "ETIMEDOUT";
    const commandLabel = [MPC_BIN, "--host", MPD_HOST, "--port", MPD_PORT, ...args].join(" ");
    const message = timedOut
      ? `mpc command timed out after ${timeout}ms: ${commandLabel}`
      : stderr || (error instanceof Error ? error.message : "mpc command failed");
    const wrapped = new Error(message);
    wrapped.stdout = stdout;
    wrapped.stderr = stderr;
    wrapped.timedOut = timedOut;
    throw wrapped;
  }
}

function parseMpcStatus(statusRaw) {
  const state = statusRaw.match(/\[(playing|paused|stopped)\]/)?.[1] ?? "stopped";
  const queueMatch = statusRaw.match(/#(\d+)\/(\d+)/);
  const progressMatch = statusRaw.match(/\s([0-9:]+)\/([0-9:]+)\s+\(/);
  const volumeMatch = statusRaw.match(/volume:\s*(\d+)%/);
  const failedDecodeUri = statusRaw.match(/Failed to decode\s+"([^"]+)"/i)?.[1]?.trim() ?? null;
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
    scanning,
    failedStreamUri: failedDecodeUri && isStreamUri(failedDecodeUri) ? failedDecodeUri : null
  };
}

function getEffectiveMpcCurrentFile(currentFile, status) {
  const normalizedFile = String(currentFile ?? "").trim();
  if (normalizedFile) return normalizedFile;
  const failedStreamUri = String(status?.failedStreamUri ?? "").trim();
  return isStreamUri(failedStreamUri) ? failedStreamUri : "";
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
  if (normalized > 0) {
    await rememberNonZeroVolumePercent(normalized);
  }
}

async function restoreMpcRadioVolumeIfMuted() {
  const status = parseMpcStatus(await runMpc(["status"], { allowFailure: true }));
  if (status.volumePercent && status.volumePercent > 0) {
    await rememberNonZeroVolumePercent(status.volumePercent);
    return;
  }
  if (status.volumePercent !== 0) return;
  const nextVolume = await getRadioResumeVolumePercent();
  await runMpc(["volume", String(nextVolume)]);
  await rememberNonZeroVolumePercent(nextVolume);
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

function readMetadataBoolean(metadata, keys) {
  for (const key of keys) {
    const value = metadata[key];
    if (value === true || value === false) return value;
    const normalized = String(value ?? "").trim().toLowerCase();
    if (["true", "1", "yes"].includes(normalized)) return true;
    if (["false", "0", "no"].includes(normalized)) return false;
  }
  return null;
}

function parsePlaybackTimingDiagnostics(metadata) {
  const positionConfidence = normalizeMetadataValue(
    metadata.positionconfidence ?? metadata.positionConfidence ?? metadata.position_confidence
  ).toLowerCase();
  const diagnostics = {
    metadataMtimeMs: readMetadataNumber(metadata, ["metadatamtimems", "metadataMtimeMs", "metadata_mtime_ms"]),
    airplayStartedAtMs: readMetadataNumber(metadata, ["airplaystartedatms", "airplayStartedAtMs", "airplay_started_at_ms"]),
    airplayStoppedAtMs: readMetadataNumber(metadata, ["airplaystoppedatms", "airplayStoppedAtMs", "airplay_stopped_at_ms"]),
    clockStartMs: readMetadataNumber(metadata, ["clockstartms", "clockStartMs", "clock_start_ms"]),
    clockLeadMs: readMetadataNumber(metadata, ["clockleadms", "clockLeadMs", "clock_lead_ms"]),
    effectiveClockStartMs: readMetadataNumber(metadata, ["effectiveclockstartms", "effectiveClockStartMs", "effective_clock_start_ms"]),
    clockStartReason: normalizeMetadataValue(metadata.clockstartreason ?? metadata.clockStartReason ?? metadata.clock_start_reason) || null,
    metadataSource: normalizeMetadataValue(metadata.metadatasource ?? metadata.metadataSource ?? metadata.metadata_source) || null,
    positionTrusted: readMetadataBoolean(metadata, ["positiontrusted", "positionTrusted", "position_trusted"]),
    positionConfidence: ["trusted", "estimated", "none"].includes(positionConfidence) ? positionConfidence : null
  };

  const hasTimingValue = Object.entries(diagnostics).some(([key, value]) => (
    key === "clockStartReason" || key === "metadataSource" || key === "positionConfidence"
      ? Boolean(value)
      : Number.isFinite(value) || typeof value === "boolean"
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
      ?? metadata.coverurl
      ?? metadata.coverUrl
      ?? metadata.cover_url
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
  const timingDiagnostics = parsePlaybackTimingDiagnostics(metadata);

  return {
    title,
    artist: normalizeMetadataValue(metadata.artist ?? metadata.artists) || null,
    album: normalizeMetadataValue(metadata.album) || null,
    status: status || null,
    positionMs: Number.isFinite(positionMs) ? positionMs : null,
    durationMs: Number.isFinite(durationMs) ? durationMs : null,
    artworkUrl: metadataArtworkUrl(metadata),
    positionTrusted: timingDiagnostics?.positionTrusted === true,
    timingDiagnostics
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

function getAirplaySourceSummaryFromState(state) {
  if (state?.audio?.currentSource?.id === "airplay") {
    return state.audio.currentSource;
  }
  return Array.isArray(state?.audio?.sources)
    ? state.audio.sources.find((source) => source.id === "airplay") ?? null
    : null;
}

function shouldRefreshAirplayPlaybackMetadata(state, { force = false } = {}) {
  if (API_MODE !== "mpc" || !AIRPLAY_METADATA_COMMAND.trim()) return false;
  if (state?.playback?.source !== "airplay") return false;

  const airplaySource = getAirplaySourceSummaryFromState(state);
  if (airplaySource?.connectionState !== "connected") return false;
  if (force) return true;
  if (Date.now() - airplayDirectMetadataRefreshAtMs >= AIRPLAY_DIRECT_METADATA_REFRESH_MIN_MS) return true;

  return !state.playback.albumArtUrl
    || !Number.isFinite(state.playback.elapsedSeconds)
    || looksLikeUntrustedTrackMetadata({
      title: state.playback.title,
      artist: state.playback.artist,
      album: state.playback.album
    });
}

function mergeAirplayPlaybackMetadata(state, metadata) {
  const usableMetadata = normalizeAirplayPlaybackMetadata(metadata);
  if (!usableMetadata) return clearAirplayPlaybackMetadata(state);

  const airplaySource = getAirplaySourceSummaryFromState(state);
  if (airplaySource?.connectionState !== "connected") return state;

  const playback = {
    ...state.playback,
    state: mapBluetoothPlaybackState(usableMetadata),
    albumArtUrl: usableMetadata.artworkUrl ?? null,
    title: usableMetadata.title,
    artist: usableMetadata.artist || null,
    album: usableMetadata.album || "AirPlay Source",
    elapsedSeconds: millisecondsToSeconds(usableMetadata.positionMs),
    durationSeconds: millisecondsToSeconds(usableMetadata.durationMs, { allowZero: false }),
    timingDiagnostics: usableMetadata.timingDiagnostics ?? null
  };
  const nextState = {
    ...state,
    playback
  };

  return {
    ...nextState,
    lyrics: scheduleLyricsRecognition(nextState)
  };
}

function clearAirplayPlaybackMetadata(state) {
  if (state?.playback?.source !== "airplay") return state;

  const airplaySource = getAirplaySourceSummaryFromState(state);
  const playback = {
    ...state.playback,
    state: "stopped",
    albumArtUrl: null,
    title: "AirPlay Ready",
    artist: airplaySource?.connectedLabel
      || (airplaySource?.advertisedLabel ? `Choose ${airplaySource.advertisedLabel} from AirPlay` : "Choose Tikpal from AirPlay"),
    album: "AirPlay Source",
    elapsedSeconds: null,
    durationSeconds: null,
    timingDiagnostics: null
  };
  const nextState = {
    ...state,
    playback
  };

  return {
    ...nextState,
    lyrics: scheduleLyricsRecognition(nextState)
  };
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

function isUsableAirplayPlaybackMetadata(metadata) {
  if (!metadata?.title) return false;
  if (metadata.status === "stopped") return false;
  return true;
}

function normalizeAirplayPlaybackMetadata(metadata) {
  if (!isUsableAirplayPlaybackMetadata(metadata)) return null;
  const positionMs = Number(metadata.positionMs);
  const durationMs = Number(metadata.durationMs);
  const metadataSource = String(metadata?.timingDiagnostics?.metadataSource ?? "").trim().toLowerCase();
  if (
    metadata.status === "playing"
    && Number.isFinite(positionMs)
    && Number.isFinite(durationMs)
    && durationMs > 0
    && positionMs > durationMs
  ) {
    if (positionMs > durationMs + AIRPLAY_METADATA_POSITION_GRACE_MS) {
      if (metadataSource === "mpris") {
        return {
          ...metadata,
          positionMs: null,
          positionTrusted: false,
          timingDiagnostics: {
            ...(metadata.timingDiagnostics ?? {}),
            positionTrusted: false,
            positionConfidence: "none"
          }
        };
      }
      return null;
    }
    return {
      ...metadata,
      positionMs: durationMs
    };
  }
  return metadata;
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
  const prefix = DDCUTIL_SUPPRESS_SYSLOG ? ["--syslog=NEVER"] : [];
  return DDCUTIL_DISPLAY ? [...prefix, "--display", DDCUTIL_DISPLAY, ...args] : [...prefix, ...args];
}

function ddcutilReadCommand(args) {
  const command = `${DDCUTIL_BIN} ${ddcutilArgs(args).join(" ")}`;
  return DDCUTIL_SUPPRESS_READ_WARNINGS ? `${command} 2>/dev/null` : command;
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
    ddcutilReadCommand(["getvcp", "10", "--brief"]),
    { allowFailure: true, timeout: DDCUTIL_READ_TIMEOUT_MS }
  );
  const snapshot = parseDisplayBrightnessSnapshot(raw);
  if (snapshot.controllable) {
    displayBrightnessUnavailableUntilMs = 0;
  } else {
    displayBrightnessUnavailableUntilMs = Date.now() + DDCUTIL_UNAVAILABLE_BACKOFF_MS;
  }
  displayBrightnessSnapshotCache = { value: snapshot, updatedAtMs: Date.now() };
  system.display = snapshot;
  return snapshot;
}

function scheduleDisplayBrightnessRefresh() {
  if (displayBrightnessSnapshotCache?.value?.controllable === false && Date.now() < displayBrightnessUnavailableUntilMs) {
    return Promise.resolve(displayBrightnessSnapshotCache.value);
  }
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
  if (displayBrightnessSnapshotCache?.value?.controllable === false && now < displayBrightnessUnavailableUntilMs) {
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
  displayBrightnessUnavailableUntilMs = 0;
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

function normalizeKioskWindow(value) {
  const match = String(value ?? "").trim().match(/^(\d{3,5})x(\d{3,5})$/i);
  return match ? `${Number(match[1])}x${Number(match[2])}` : null;
}

async function getRuntimeSnapshot() {
  const drmMode = await runCommand(
    "for status in /sys/class/drm/card*-*/status; do [ -f \"$status\" ] || continue; if grep -qx connected \"$status\"; then modes=\"${status%/status}/modes\"; [ -s \"$modes\" ] && sed -n '1p' \"$modes\" && exit 0; fi; done",
    { allowFailure: true, timeout: RUNTIME_DRM_MODE_TIMEOUT_MS }
  );
  return buildRuntimeSnapshot(normalizeKioskWindow(drmMode) ?? normalizeKioskWindow(REQUESTED_KIOSK_WINDOW) ?? REQUESTED_KIOSK_WINDOW);
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
    display: system.display,
    library: {
      ...cachedSystem.library,
      source: "MPD",
      trackCount: stats.trackCount,
      lastScan: stats.lastScan,
      scanning: status.scanning || scanRecentlyRequested
    }
  };
}

function normalizeRadioCategory(value) {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[-_\s]+/g, "");
  if (normalized === "hifi" || normalized === "hi-fi") return "hifi";
  if (normalized === "focus") return "focus";
  if (normalized === "calm") return "calm";
  if (normalized === "sleep") return "sleep";
  if (normalized === "jazz") return "jazz";
  if (normalized === "classical") return "classical";
  if (normalized === "news") return "news";
  return null;
}

function parseRadioGenreParts(genre) {
  return String(genre ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function radioCategoryFromStation(label, genreParts) {
  const labelMatch = String(label ?? "").match(/^Tikpal\s+(.+?)\s*-\s*/i);
  return normalizeRadioCategory(labelMatch?.[1]) ?? normalizeRadioCategory(genreParts[0]);
}

function radioCategoryOrder(category) {
  const index = RADIO_CATEGORY_ORDER.indexOf(category);
  return index === -1 ? RADIO_CATEGORY_ORDER.length : index;
}

function buildRadioLogoUrl(stationId, logo) {
  if (!stationId || !String(logo ?? "").trim()) return null;
  return `/api/v1/media/radio-logo?stationId=${encodeURIComponent(stationId)}`;
}

function buildMpcRadioStationSummary(row) {
  const [rawId, rawName, rawStation, rawGenre, rawBroadcaster, rawBitrate, rawFormat, rawLogo] = row;
  const numericId = Number(rawId);
  const stationId = `radio-${rawId}`;
  const label = rawName || `Radio ${rawId}`;
  const genreParts = parseRadioGenreParts(rawGenre);
  const category = radioCategoryFromStation(label, genreParts);
  const categoryLabel = category ? RADIO_CATEGORY_LABELS[category] : null;
  const isTikpalStation = /^Tikpal\s+/i.test(label);
  const tags = genreParts.filter((part, index) => {
    if (index === 0 && normalizeRadioCategory(part) === category) return false;
    return part !== categoryLabel;
  });
  const bitrateKbps = Number.isFinite(Number(rawBitrate)) ? Number(rawBitrate) : null;
  const codec = rawFormat || null;
  const statusBits = [];
  if (categoryLabel) statusBits.push(categoryLabel);
  if (rawBroadcaster) statusBits.push(rawBroadcaster);
  if (bitrateKbps) statusBits.push(`${bitrateKbps} kbps`);
  if (codec) statusBits.push(codec);
  const sourceOrder = isTikpalStation ? 0 : 1;
  const categorySort = isTikpalStation ? radioCategoryOrder(category) : RADIO_CATEGORY_ORDER.length;

  return buildRadioStationSummary({
    id: stationId,
    label,
    uri: rawStation,
    genre: rawGenre || "Unknown",
    bitrateKbps,
    codec,
    category,
    categoryLabel,
    tags,
    broadcaster: rawBroadcaster || null,
    logoUrl: buildRadioLogoUrl(stationId, rawLogo),
    catalogSource: isTikpalStation ? "tikpal" : "moode",
    sortOrder: Number.isFinite(numericId) ? numericId : null,
    secondaryStatus: statusBits.join(" · ") || "Radio preset",
    active: false,
    _sourceOrder: sourceOrder,
    _categorySort: categorySort
  });
}

function sortRadioStations(stations) {
  return [...stations].sort((left, right) => {
    if (left.catalogSource !== right.catalogSource) {
      return left.catalogSource === "tikpal" ? -1 : 1;
    }
    if (left.catalogSource === "tikpal") {
      const categoryDelta = radioCategoryOrder(left.category) - radioCategoryOrder(right.category);
      if (categoryDelta !== 0) return categoryDelta;
    }
    return (left.sortOrder ?? 0) - (right.sortOrder ?? 0);
  });
}

function clearActiveMpcRadioStationCache() {
  activeMpcRadioStationCache = null;
}

function syncCachedTikpalStateActiveRadioStation() {
  const cached = activeMpcRadioStationCache;
  const state = tikpalStateSnapshotCache?.state;
  if (!cached || !state?.audio) return;

  const label = cached.station?.label ?? RADIO_LABEL;
  const albumArtUrl = cached.station?.logoUrl ?? null;
  const radioSource = {
    ...(state.audio.sources?.find((source) => source.id === "radio") ?? buildSourceSummary({
      id: "radio",
      label: "Radio",
      availability: "available",
      active: true,
      controllability: "switchable",
      secondaryStatus: `${label} active`
    })),
    availability: "available",
    active: true,
    controllability: "switchable",
    secondaryStatus: `${label} active`,
    radioStationId: cached.station?.id ?? cached.id ?? null
  };
  const sources = Array.isArray(state.audio.sources)
    ? state.audio.sources.map((source) => source.id === "radio" ? radioSource : { ...source, active: false })
    : [radioSource];

  tikpalStateSnapshotCache = {
    ...tikpalStateSnapshotCache,
    state: {
      ...state,
      audio: {
        ...state.audio,
        currentSource: radioSource,
        sources
      },
      playback: state.playback
        ? {
            ...state.playback,
            albumArtUrl,
            source: "radio",
            title: label,
            station: label
          }
        : state.playback
    }
  };
}

function cacheActiveMpcRadioStation(station, uri) {
  const targetUri = String(uri ?? station?.uri ?? "").trim();
  if (!targetUri && !station) {
    clearActiveMpcRadioStationCache();
    return;
  }

  activeMpcRadioStationCache = {
    id: station?.id ?? null,
    uri: targetUri,
    station: station ? { ...station, active: true } : null,
    updatedAtMs: Date.now()
  };
  syncCachedTikpalStateActiveRadioStation();
}

function findActiveRadioStationFromList(currentFile, stations) {
  const normalizedCurrentFile = String(currentFile ?? "").trim();
  if (!isStreamUri(normalizedCurrentFile)) return null;

  const exact = stations.find((station) => station.uri === normalizedCurrentFile);
  if (exact) {
    const cached = activeMpcRadioStationCache;
    if (!cached || cached.id !== exact.id || cached.uri !== normalizedCurrentFile) {
      activeMpcRadioStationCache = {
        id: exact.id ?? null,
        uri: normalizedCurrentFile,
        station: { ...exact, active: true },
        updatedAtMs: Date.now()
      };
    }
    return exact;
  }

  const cached = activeMpcRadioStationCache;
  if (!cached || Date.now() - cached.updatedAtMs > 12 * 60 * 60 * 1000) return null;
  if (cached.uri && cached.uri !== normalizedCurrentFile) return null;
  if (cached.id) {
    const station = stations.find((entry) => entry.id === cached.id);
    if (station) return station;
  }

  return cached.station;
}

function markActiveRadioStations(stations, currentFile) {
  const activeStation = findActiveRadioStationFromList(currentFile, stations);
  return stations.map((station) => ({
    ...station,
    active: Boolean(activeStation && station.id === activeStation.id)
  }));
}

async function readMpcRadioStations() {
  const query = "SELECT id, name, station, genre, broadcaster, bitrate, format, logo FROM cfg_radio ORDER BY id";
  const raw = await runCommand(`${shellQuote(SQLITE_BIN)} -separator '|' /var/local/www/db/moode-sqlite3.db "${query}"`, { allowFailure: true });
  if (!raw) {
    return [];
  }

  return sortRadioStations(raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => buildMpcRadioStationSummary(line.split("|"))));
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
          category: null,
          categoryLabel: null,
          tags: [],
          broadcaster: null,
          logoUrl: null,
          catalogSource: "fallback",
          sortOrder: null,
          secondaryStatus: "Fallback preset",
          active: false
        })
      ]
    : [];
}

async function getAvailableRadioStations(scope = "all") {
  if (API_MODE !== "mpc") {
    const stations = getMockRadioStations();
    return scope === "tikpal" ? stations.filter((station) => station.catalogSource === "tikpal") : stations;
  }

  const radioStations = await readMpcRadioStations();
  if (radioStations.length > 0) {
    cacheMpcRadioCatalogReady(radioStations.length);
  }
  const scopedStations = scope === "tikpal"
    ? radioStations.filter((station) => station.catalogSource === "tikpal")
    : radioStations;
  return scopedStations.length > 0 ? scopedStations : fallbackRadioStations();
}

function cacheMpcRadioCatalogReady(count) {
  if (!Number.isFinite(count) || count <= 0) return;
  mpcRadioCatalogReadyCache = true;
  mpcRadioCatalogCountCache = Math.max(mpcRadioCatalogCountCache, count);
}

function applyMpcRadioCatalogReadyToState(state) {
  if (API_MODE !== "mpc" || !mpcRadioCatalogReadyCache || mpcRadioCatalogCountCache <= 0) {
    return state;
  }
  if (!state?.audio) return state;

  const sources = Array.isArray(state?.audio?.sources) ? state.audio.sources : [];
  let changed = false;
  const nextSources = sources.map((source) => {
    if (source?.id !== "radio") return source;
    const nextSource = {
      ...source,
      availability: "available",
      controllability: "switchable",
      secondaryStatus: source.secondaryStatus === "No radio route configured"
        ? `Choose from ${mpcRadioCatalogCountCache} presets`
        : source.secondaryStatus
    };
    changed = changed
      || nextSource.availability !== source.availability
      || nextSource.controllability !== source.controllability
      || nextSource.secondaryStatus !== source.secondaryStatus;
    return nextSource;
  });
  if (!changed) return state;

  const currentSource = state.audio.currentSource?.id === "radio"
    ? nextSources.find((source) => source.id === "radio") ?? state.audio.currentSource
    : state.audio.currentSource;

  return {
    ...state,
    audio: {
      ...state.audio,
      currentSource,
      sources: nextSources
    }
  };
}

async function findRadioStationByUri(uri) {
  if (!uri) return null;
  const stations = await getAvailableRadioStations("all");
  return findActiveRadioStationFromList(uri, stations) ?? null;
}

async function resolveRadioLogoCandidate(fileName) {
  const cleanName = String(fileName ?? "").trim();
  if (!cleanName || basename(cleanName) !== cleanName) return null;
  const mimeType = imageMimeTypeFromPath(cleanName);
  if (!mimeType) return null;
  const root = resolve(RADIO_LOGO_DIR);
  const absolutePath = resolve(root, cleanName);
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${sep}`)) return null;
  try {
    const info = await stat(absolutePath);
    if (!info.isFile()) return null;
    return { absolutePath, mimeType };
  } catch {
    return null;
  }
}

async function resolveRadioLogo(stationId) {
  const id = String(stationId ?? "").trim();
  if (!/^radio-\d+$/.test(id)) return null;
  const stations = await getAvailableRadioStations("all");
  const station = stations.find((entry) => entry.id === id);
  if (!station) return null;

  for (const extension of RADIO_LOGO_EXTENSIONS) {
    const exact = await resolveRadioLogoCandidate(`${station.label}${extension}`);
    if (exact) return exact;
  }

  const alias = RADIO_LOGO_ALIASES.get(station.label);
  if (alias) {
    const aliased = await resolveRadioLogoCandidate(alias);
    if (aliased) return aliased;
  }

  return null;
}

function normalizeRadioFilters(searchParams) {
  const q = (searchParams.get("q") ?? "").trim();
  const genre = (searchParams.get("genre") ?? "").trim();
  const bitrate = (searchParams.get("bitrate") ?? "").trim();
  const category = normalizeRadioCategory(searchParams.get("category"));
  const scopeParam = (searchParams.get("scope") ?? "tikpal").trim().toLowerCase();
  const scope = scopeParam === "all" ? "all" : "tikpal";
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
    category,
    scope,
    limit: Math.round(limitRaw),
    offset: Math.round(offsetRaw)
  };
}

function filterRadioStations(stations, filters) {
  return stations.filter((station) => {
    if (filters.q) {
      const haystack = `${station.label} ${station.secondaryStatus} ${station.genre} ${station.categoryLabel ?? ""} ${station.broadcaster ?? ""} ${(station.tags ?? []).join(" ")}`.toLowerCase();
      if (!haystack.includes(filters.q.toLowerCase())) return false;
    }

    if (filters.category && station.category !== filters.category) {
      return false;
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
  const [currentFileRaw, statusRaw] = API_MODE === "mpc"
    ? await Promise.all([
      runMpc(["--format", "%file%", "current"], { allowFailure: true }),
      runMpc(["status"], { allowFailure: true })
    ])
    : ["", ""];
  const currentFile = getEffectiveMpcCurrentFile(currentFileRaw, parseMpcStatus(statusRaw));
  const stations = markActiveRadioStations(await getAvailableRadioStations(filters.scope), currentFile);
  const genres = Array.from(new Set(stations.map((station) => station.genre).filter(Boolean))).sort((left, right) => left.localeCompare(right));
  const categories = RADIO_CATEGORY_ORDER
    .map((category) => ({
      id: category,
      label: RADIO_CATEGORY_LABELS[category],
      count: stations.filter((station) => station.category === category).length
    }))
    .filter((category) => category.count > 0);
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
    categories,
    bitrates,
    filters,
    scope: filters.scope,
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

function normalizeWebModeProviderId(value, fallback = "spotify") {
  const id = String(value ?? "").trim().toLowerCase();
  return WEB_MODE_PROVIDER_IDS.has(id) ? id : fallback;
}

function normalizeWebModeProxyUrl(value) {
  const proxyUrl = String(value ?? "").trim();
  let parsed;
  try {
    parsed = new URL(proxyUrl);
  } catch {
    throw new Error("Explore proxy URL must be http://host:port, https://host:port, or socks5://host:port");
  }
  if (!["http:", "https:", "socks5:"].includes(parsed.protocol) || !parsed.hostname || !parsed.port) {
    throw new Error("Explore proxy URL must be http://host:port, https://host:port, or socks5://host:port");
  }
  parsed.username = "";
  parsed.password = "";
  parsed.pathname = "";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function normalizeWebModeSettings(raw = {}) {
  let proxyUrl = WEB_MODE_DEFAULT_PROXY_URL;
  try {
    proxyUrl = normalizeWebModeProxyUrl(raw.proxyUrl ?? WEB_MODE_DEFAULT_PROXY_URL);
  } catch {
    proxyUrl = normalizeWebModeProxyUrl(WEB_MODE_DEFAULT_PROXY_URL);
  }
  return {
    proxyEnabled: typeof raw.proxyEnabled === "boolean" ? raw.proxyEnabled : true,
    proxyUrl,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null
  };
}

function normalizeWebModeRuntimeState(raw = {}) {
  return {
    activeProvider: raw.activeProvider ? normalizeWebModeProviderId(raw.activeProvider, null) : null,
    lastError: typeof raw.lastError === "string" && raw.lastError.trim() ? raw.lastError.trim() : null,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null
  };
}

async function readWebModeSettings() {
  try {
    return normalizeWebModeSettings(JSON.parse(await readFile(WEB_MODE_SETTINGS_PATH, "utf8")));
  } catch {
    return normalizeWebModeSettings();
  }
}

async function writeWebModeSettings(patch) {
  const current = await readWebModeSettings();
  const next = normalizeWebModeSettings({
    ...current,
    ...patch,
    updatedAt: new Date().toISOString()
  });
  await mkdir(dirname(WEB_MODE_SETTINGS_PATH), { recursive: true });
  await writeFile(WEB_MODE_SETTINGS_PATH, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

async function readWebModeRuntimeState() {
  try {
    return normalizeWebModeRuntimeState(JSON.parse(await readFile(WEB_MODE_STATE_PATH, "utf8")));
  } catch {
    return normalizeWebModeRuntimeState();
  }
}

async function writeWebModeRuntimeState(patch) {
  const current = await readWebModeRuntimeState();
  const next = normalizeWebModeRuntimeState({
    ...current,
    ...patch,
    updatedAt: new Date().toISOString()
  });
  await mkdir(dirname(WEB_MODE_STATE_PATH), { recursive: true });
  await writeFile(WEB_MODE_STATE_PATH, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

async function buildWebModeState() {
  const [settings, runtimeState] = await Promise.all([
    readWebModeSettings(),
    readWebModeRuntimeState()
  ]);
  return {
    enabled: true,
    activeProvider: runtimeState.activeProvider,
    providers: WEB_MODE_PROVIDERS,
    settings,
    lastError: runtimeState.lastError,
    updatedAt: runtimeState.updatedAt ?? settings.updatedAt ?? new Date(0).toISOString()
  };
}

let audioVolumeStateCache = null;

function normalizeRememberedAudioSource(raw = {}) {
  const target = String(raw?.target ?? "").trim().toLowerCase();
  if (!REMEMBERED_AUDIO_SOURCE_TARGETS.has(target)) return null;

  const localTrackPath = normalizeLocalLibraryStateTrackPath(raw.localTrackPath);
  const radioStationId = normalizeRememberedRadioStationId(raw.radioStationId);

  return {
    target,
    ...(localTrackPath ? { localTrackPath } : { localTrackPath: null }),
    ...(radioStationId ? { radioStationId } : { radioStationId: null }),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null
  };
}

function normalizeRememberedRadioStationId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getCachedRememberedAudioSource() {
  if (audioSourceMemoryStateCache !== null) return audioSourceMemoryStateCache;
  try {
    audioSourceMemoryStateCache = normalizeRememberedAudioSource(JSON.parse(readFileSync(AUDIO_SOURCE_MEMORY_STATE_PATH, "utf8")));
  } catch {
    audioSourceMemoryStateCache = null;
  }
  return audioSourceMemoryStateCache;
}

async function writeRememberedAudioSource(source) {
  const normalized = normalizeRememberedAudioSource({
    ...source,
    updatedAt: new Date().toISOString()
  });
  if (!normalized) return null;

  await mkdir(dirname(AUDIO_SOURCE_MEMORY_STATE_PATH), { recursive: true });
  await writeFile(AUDIO_SOURCE_MEMORY_STATE_PATH, `${JSON.stringify(normalized, null, 2)}\n`);
  audioSourceMemoryStateCache = normalized;
  return normalized;
}

function getCachedRememberedLocalTrackPath() {
  return normalizeLocalLibraryStateTrackPath(getCachedRememberedAudioSource()?.localTrackPath);
}

function getCachedRememberedRadioStationId() {
  return normalizeRememberedRadioStationId(getCachedRememberedAudioSource()?.radioStationId);
}

function buildRememberedSourceSwitchAction() {
  const rememberedSource = getCachedRememberedAudioSource();
  if (!rememberedSource?.target) return null;
  return {
    target: rememberedSource.target,
    ...(rememberedSource.radioStationId ? { radioStationId: rememberedSource.radioStationId } : {}),
    ...(rememberedSource.localTrackPath ? { localTrackPath: rememberedSource.localTrackPath } : {})
  };
}

async function resolveExistingRadioStationId(radioStationId) {
  const safeRadioStationId = normalizeRememberedRadioStationId(radioStationId);
  if (!safeRadioStationId) return null;
  try {
    const radioStations = await getAvailableRadioStations();
    return radioStations.some((station) => station.id === safeRadioStationId) ? safeRadioStationId : null;
  } catch {
    return null;
  }
}

async function resolveCurrentOrRememberedRadioStationId(radioStationId = null) {
  const cachedCurrentSource = tikpalStateSnapshotCache?.state?.audio?.currentSource;
  const currentRadioStationId = cachedCurrentSource?.id === "radio"
    ? cachedCurrentSource.radioStationId
    : null;
  const mockRadioStationId = API_MODE !== "mpc" && mockActiveSource === "radio" ? mockActiveRadioStationId : null;
  return await resolveExistingRadioStationId(radioStationId)
    ?? await resolveExistingRadioStationId(currentRadioStationId)
    ?? await resolveExistingRadioStationId(mockRadioStationId)
    ?? await resolveExistingRadioStationId(getCachedRememberedRadioStationId());
}

async function rememberAudioSourceSwitch(action, { allowMpcRadio = false } = {}) {
  const target = String(action?.target ?? "").trim().toLowerCase();
  if (!REMEMBERED_AUDIO_SOURCE_TARGETS.has(target)) return null;
  if (target === "radio" && API_MODE === "mpc" && !allowMpcRadio) return null;

  if (target === "mpd") {
    const localTrackPath = normalizeLocalLibraryStateTrackPath(action.localTrackPath)
      ?? await resolveCurrentLocalLibraryTrackPath();
    const radioStationId = await resolveCurrentOrRememberedRadioStationId(action.radioStationId);
    return await writeRememberedAudioSource({
      target,
      localTrackPath,
      radioStationId
    });
  }

  const localTrackPath = await resolveExistingLocalLibraryTrackPath(action.localTrackPath)
    ?? await resolveCurrentOrRememberedLocalLibraryTrackPath();
  const radioStationId = await resolveCurrentOrRememberedRadioStationId(action.radioStationId);

  if (target === "radio") {
    return await writeRememberedAudioSource({
      target,
      localTrackPath,
      radioStationId
    });
  }

  return await writeRememberedAudioSource({ target, localTrackPath, radioStationId });
}

async function rememberActiveRadioStationSource(station, options = {}) {
  const localTrackPath = await resolveExistingLocalLibraryTrackPath(options.localTrackPath)
    ?? await resolveExistingLocalLibraryTrackPath(getCachedRememberedLocalTrackPath());
  const radioStationId = await resolveExistingRadioStationId(station?.id);
  return await writeRememberedAudioSource({
    target: "radio",
    localTrackPath,
    radioStationId
  });
}

function normalizeAudioVolumeState(raw = {}) {
  const lastNonZeroPercent = clampPercent(raw.lastNonZeroPercent, null);
  return {
    version: 1,
    lastNonZeroPercent: lastNonZeroPercent && lastNonZeroPercent > 0 ? lastNonZeroPercent : null,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null
  };
}

async function readAudioVolumeState() {
  if (audioVolumeStateCache) return audioVolumeStateCache;
  try {
    audioVolumeStateCache = normalizeAudioVolumeState(JSON.parse(await readFile(AUDIO_VOLUME_STATE_PATH, "utf8")));
  } catch {
    audioVolumeStateCache = normalizeAudioVolumeState();
  }
  return audioVolumeStateCache;
}

async function writeAudioVolumeState(state) {
  const saved = {
    ...normalizeAudioVolumeState(state),
    updatedAt: new Date().toISOString()
  };
  await mkdir(dirname(AUDIO_VOLUME_STATE_PATH), { recursive: true });
  await writeFile(AUDIO_VOLUME_STATE_PATH, `${JSON.stringify(saved, null, 2)}\n`);
  audioVolumeStateCache = saved;
  return saved;
}

async function rememberNonZeroVolumePercent(percent) {
  const normalized = clampPercent(percent, null);
  if (!normalized || normalized <= 0) return;
  const current = await readAudioVolumeState();
  if (current.lastNonZeroPercent === normalized) return;
  await writeAudioVolumeState({
    ...current,
    lastNonZeroPercent: normalized
  });
}

async function getRadioResumeVolumePercent() {
  const volumeState = await readAudioVolumeState();
  if (volumeState.lastNonZeroPercent && volumeState.lastNonZeroPercent > 0) {
    return volumeState.lastNonZeroPercent;
  }
  const globalVolumePercent = clampPercent(system.volume?.percent, null);
  if (globalVolumePercent && globalVolumePercent > 0) {
    return globalVolumePercent;
  }
  return RADIO_VOLUME_DEFAULT_PERCENT;
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
    const state = await collectTikpalStateSnapshot({
      includeSlowRuntimeStatus: false,
      includeSourceRuntimeStatus: true,
      includeOutputVolumeStatus: false,
      skipExperienceReconcile: true
    });
    const sourceIsScene = mockArmedSource === "scene" || state.audio.currentSource.id === "scene";
    if (!sourceIsScene) return;

    const fallbackAction = { target: "mpd" };
    const restoreAction = buildRememberedSourceSwitchAction() ?? fallbackAction;

    try {
      await applySourceSwitch(restoreAction, { rememberSource: false });
    } catch {
      if (restoreAction.target !== fallbackAction.target) {
        await applySourceSwitch(fallbackAction, { rememberSource: false });
      }
    }
    await refreshTikpalStateSnapshotAfterMutation({
      includeSourceRuntimeStatus: restoreAction.target === "mpd" || restoreAction.target === "radio" || COMMAND_HANDOFF_SOURCE_TARGETS.has(restoreAction.target),
      includeOutputVolumeStatus: COMMAND_HANDOFF_SOURCE_TARGETS.has(restoreAction.target)
    });
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

function normalizeSceneAudioGainDb(value) {
  if (value === undefined || value === null || value === "") return null;
  const gainDb = Number(value);
  if (!Number.isFinite(gainDb)) return null;
  const clamped = Math.max(SCENE_AUDIO_GAIN_MIN_DB, Math.min(SCENE_AUDIO_GAIN_MAX_DB, gainDb));
  return Number(clamped.toFixed(1));
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
    const audioGainDb = normalizeSceneAudioGainDb(video.audioGainDb);
    videos.push({
      id,
      filename,
      label: String(video.label ?? "").trim() || basename(filename, extname(filename)),
      src: `/assets/scenes/${encodeAssetRelativePath(filename)}`,
      ...(Number.isFinite(Number(video.order)) ? { order: Number(video.order) } : {}),
      ...(video.default === true ? { default: true } : {}),
      ...(roomModes.length > 0 ? { roomModes } : {}),
      ...(audioGainDb !== null ? { audioGainDb } : {}),
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
    .update(videos.map((video) => `${video.id}:${video.src}:${video.label}:${video.order ?? ""}:${video.default ? "1" : "0"}:${(video.roomModes ?? []).join(",")}:${video.audioGainDb ?? ""}`).join("|"))
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

async function resolveExistingLocalLibraryTrackPath(localTrackPath) {
  const track = await findLocalAudioLibraryTrackByPath(localTrackPath);
  return normalizeLocalLibraryStateTrackPath(track?.path);
}

function extractMpcCurrentFile(raw) {
  const line = String(raw ?? "").split("\n").map((entry) => entry.trim()).find(Boolean) ?? "";
  if (!line.includes("\t")) return line;

  const columns = line.split("\t").map((entry) => entry.trim()).filter(Boolean);
  return columns.find((entry) => (
    isStreamUri(entry)
    || /\.(aac|aiff|alac|flac|m4a|mp3|ogg|opus|wav|wma)$/i.test(entry)
  )) ?? columns.at(-1) ?? "";
}

async function resolveMpcCurrentLocalLibraryTrackPath() {
  const raw = await runMpc(["--format", "%file%", "current"], { allowFailure: true });
  const file = extractMpcCurrentFile(raw);
  if (!file || isStreamUri(file)) return null;
  return await resolveExistingLocalLibraryTrackPath(file);
}

async function resolveMockCurrentLocalLibraryTrackPath() {
  return await resolveExistingLocalLibraryTrackPath(mockSelectedLocalTrack?.path);
}

async function resolveCurrentLocalLibraryTrackPath() {
  return API_MODE === "mpc"
    ? await resolveMpcCurrentLocalLibraryTrackPath()
    : await resolveMockCurrentLocalLibraryTrackPath();
}

async function resolveCurrentOrRememberedLocalLibraryTrackPath() {
  return await resolveCurrentLocalLibraryTrackPath()
    ?? await resolveExistingLocalLibraryTrackPath(getCachedRememberedLocalTrackPath());
}

async function rememberCurrentLocalLibraryTrackSource({ allowNull = false } = {}) {
  const localTrackPath = await resolveCurrentLocalLibraryTrackPath();
  if (!localTrackPath && !allowNull) return null;
  const radioStationId = await resolveCurrentOrRememberedRadioStationId();
  return await writeRememberedAudioSource({
    target: "mpd",
    localTrackPath,
    radioStationId
  });
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
  const selectedTrackPath = safePaths[safeStartIndex];
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
    return selectedTrackPath;
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
  return selectedTrackPath;
}

async function applyAudioPlaylistAction(action) {
  if (action?.type === "play") {
    const trackPaths = await findPlaylistTrackPaths(action.playlistId);
    if (!trackPaths) throw new Error("playlist not found");
    const selectedTrackPath = await playTrackPaths(trackPaths, action.startIndex);
    await rememberAudioSourceSwitch({ target: "mpd", localTrackPath: selectedTrackPath });
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
  const nextArmed = gateConnectionUntilArmed && rawConnected ? true : armed;
  const connected = gateConnectionUntilArmed ? nextArmed && rawConnected : rawConnected;

  return {
    supported,
    available: supported ? (nextArmed ? ready || rawConnected || nextArmed : true) : false,
    armed: nextArmed,
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

  const airplayArmed = (armed || rendererActive) && (ready || rendererActive || receiverActive || armed);

  return {
    supported,
    available: supported ? (airplayArmed ? ready || receiverActive || rendererActive || airplayArmed : true) : false,
    armed: airplayArmed,
    connected: airplayArmed && rendererActive,
    connectedLabel: null,
    advertisedLabel: label.trim() || null
  };
}

async function ensureAirplayReceiverState(enabled) {
  if (enabled && await commandSucceeds(AIRPLAY_RECEIVER_ACTIVE_COMMAND, { timeout: 2500 })) {
    return;
  }
  const command = enabled
    ? "sh -lc 'systemctl start shairport-sync.service >/dev/null 2>&1 || sudo -n systemctl start shairport-sync.service >/dev/null 2>&1 || true'"
    : "sh -lc 'systemctl stop shairport-sync.service >/dev/null 2>&1 || sudo -n systemctl stop shairport-sync.service >/dev/null 2>&1 || true; systemctl reset-failed shairport-sync.service >/dev/null 2>&1 || sudo -n systemctl reset-failed shairport-sync.service >/dev/null 2>&1 || true'";
  await runCommand(command, { allowFailure: true, timeout: 5000 });
}

let externalSourceCleanupPromise = null;
let externalSourceCleanupQueued = false;
let externalSourceCleanupTarget = null;
let externalAutoArmSuppressedUntilMs = 0;

function suppressExternalHandoffAutoArm(ms = 10000) {
  externalAutoArmSuppressedUntilMs = Date.now() + ms;
  externalSourceCleanupTarget = null;
}

function allowExternalHandoffAutoArm() {
  externalAutoArmSuppressedUntilMs = 0;
}

function shouldSkipExternalSourceCleanup(source, keepSource) {
  return source === keepSource || source === externalSourceCleanupTarget || source === mockArmedSource;
}

async function disableExternalSourceForCleanup(source, keepSource) {
  if (shouldSkipExternalSourceCleanup(source, keepSource)) return;

  switch (source) {
    case "spotify":
      if (SPOTIFY_DISABLE_COMMAND) {
        await runSystemActionCommand(SPOTIFY_DISABLE_COMMAND, "spotify connect cleanup");
      }
      return;
    case "bluetooth":
      if (BLUETOOTH_DISABLE_COMMAND) {
        await runSystemActionCommand(BLUETOOTH_DISABLE_COMMAND, "bluetooth cleanup");
      }
      return;
    case "airplay":
      if (AIRPLAY_DISABLE_COMMAND) {
        await runSystemActionCommand(AIRPLAY_DISABLE_COMMAND, "airplay cleanup");
      }
      await ensureAirplayReceiverState(false);
      return;
    case "upnp":
      if (UPNP_DISABLE_COMMAND) {
        await runSystemActionCommand(UPNP_DISABLE_COMMAND, "dlna cleanup");
      }
      return;
    default:
      return;
  }
}

async function cleanupExternalSourcesExcept(keepSource) {
  for (const source of COMMAND_HANDOFF_SOURCE_TARGETS) {
    await disableExternalSourceForCleanup(source, keepSource);
  }
}

function scheduleExternalSourceCleanup(keepSource) {
  externalSourceCleanupTarget = keepSource;
  if (externalSourceCleanupPromise) {
    externalSourceCleanupQueued = true;
    return;
  }

  externalSourceCleanupPromise = (async () => {
    try {
      do {
        externalSourceCleanupQueued = false;
        await cleanupExternalSourcesExcept(externalSourceCleanupTarget);
      } while (externalSourceCleanupQueued);
    } catch (error) {
      console.warn(`tikpal-api external source cleanup failed: ${error instanceof Error ? error.message : "unknown error"}`);
    } finally {
      externalSourceCleanupPromise = null;
    }
  })();
}

async function releaseKioskAudioOutputForMpd(target) {
  if (API_MODE !== "mpc" || !["mpd", "radio"].includes(target) || !KIOSK_AUDIO_RELEASE_COMMAND.trim()) return;
  await runCommand(KIOSK_AUDIO_RELEASE_COMMAND, { allowFailure: true, timeout: 2500 });
  if (KIOSK_AUDIO_RELEASE_SETTLE_MS > 0) {
    await wait(KIOSK_AUDIO_RELEASE_SETTLE_MS);
  }
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
    await ensureAirplayReceiverState(false);
    if (UPNP_DISABLE_COMMAND) {
      await runSystemActionCommand(UPNP_DISABLE_COMMAND, "dlna disable");
    }
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
    scheduleExternalSourceCleanup("spotify");
    return;
  }

  if (nextSource === "bluetooth") {
    if (!BLUETOOTH_ENABLE_COMMAND) {
      throw new Error("bluetooth gating is unavailable in this runtime");
    }
    await runSystemActionCommand(BLUETOOTH_ENABLE_COMMAND, "bluetooth enable");
    scheduleExternalSourceCleanup("bluetooth");
    return;
  }

  if (nextSource === "airplay") {
    if (!AIRPLAY_ENABLE_COMMAND) {
      throw new Error("airplay gating is unavailable in this runtime");
    }
    await runSystemActionCommand(AIRPLAY_ENABLE_COMMAND, "airplay enable");
    await ensureAirplayReceiverState(true);
    scheduleExternalSourceCleanup("airplay");
    return;
  }

  if (nextSource === "upnp") {
    if (!UPNP_ENABLE_COMMAND) {
      throw new Error("dlna gating is unavailable in this runtime");
    }
    await runSystemActionCommand(UPNP_ENABLE_COMMAND, "dlna enable");
    scheduleExternalSourceCleanup("upnp");
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

async function getMpcAudioSnapshot(currentFile, status = null) {
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
  const mpcPlaybackState = String(status?.state ?? "").trim().toLowerCase();
  const mpdPlaybackActive = Boolean(currentFile) && mpcPlaybackState !== "stopped";
  const activeMpdSource = mpdPlaybackActive
    ? radioActive
      ? "radio"
      : "mpd"
    : null;
  const canHonorExternalHandoff = Date.now() >= externalAutoArmSuppressedUntilMs;
  const preferredHandoffSource = canHonorExternalHandoff && mockArmedSource && COMMAND_HANDOFF_SOURCE_TARGETS.has(mockArmedSource)
    ? mockArmedSource
    : null;
  const activeSource = mockArmedSource === "scene"
    ? "scene"
    : preferredHandoffSource
      ? preferredHandoffSource
      : activeMpdSource
        ? activeMpdSource
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
  const connectedHandoffSource = (activeSource === "spotify" && spotifyState.connected)
    || (activeSource === "bluetooth" && bluetoothState.connected)
    || (activeSource === "airplay" && airplayState.connected)
    || (activeSource === "upnp" && upnpState.connected);
  if (canHonorExternalHandoff && !mockArmedSource && connectedHandoffSource) {
    mockArmedSource = activeSource;
  }
  const nextRadioStations = radioActive
    ? markActiveRadioStations(radioStations, currentFile)
    : radioStations.map((station) => ({ ...station, active: false }));
  const reportedArmedSource = !canHonorExternalHandoff && COMMAND_HANDOFF_SOURCE_TARGETS.has(mockArmedSource)
    ? null
    : mockArmedSource;

  return buildAudioState({
    activeSource,
    armedSource: reportedArmedSource,
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
  const cachedSource = tikpalStateSnapshotCache?.state?.audio?.sources?.find((entry) => entry.id === source) ?? null;
  const connected = armed && cachedSource?.connectionState === "connected";
  return {
    supported,
    available: supported,
    armed,
    connected,
    connectedLabel: connected ? cachedSource?.connectedLabel ?? null : null,
    advertisedLabel: advertisedLabel ?? cachedSource?.advertisedLabel ?? null
  };
}

function buildMinimalMpcAudioSnapshot(currentFile = "") {
  const cachedRadioSource = tikpalStateSnapshotCache?.state?.audio?.sources?.find((entry) => entry.id === "radio") ?? null;
  const cachedRadioReady = cachedRadioSource?.availability === "available"
    || cachedRadioSource?.controllability === "switchable";
  const catalogRadioReady = mpcRadioCatalogReadyCache && mpcRadioCatalogCountCache > 0;
  const radioActive = isStreamUri(currentFile);
  const cachedActiveRadioStation = radioActive && activeMpcRadioStationCache?.station
    ? { ...activeMpcRadioStationCache.station, active: true }
    : null;
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
    radioReady: Boolean(RADIO_ACTIVATE_COMMAND || RADIO_DEFAULT_URI || cachedRadioReady || catalogRadioReady),
    radioActive,
    radioStations: cachedActiveRadioStation ? [cachedActiveRadioStation] : [],
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

function getCachedMpcPlaybackSource() {
  return tikpalStateSnapshotCache?.state?.audio?.currentSource?.id
    ?? tikpalStateSnapshotCache?.state?.playback?.source
    ?? null;
}

function shouldUseCachedSceneSourceRuntimeStatus(currentFile = "") {
  if (isStreamUri(currentFile)) return false;
  return mockArmedSource === "scene";
}

async function getMpcQueuePreview(status) {
  if (!status.queueLength) return [];

  const playlistRaw = await runMpc([
    "playlist",
    "--format",
    "%position%\t%title%\t%artist%\t%album%\t%time%\t%file%"
  ], { allowFailure: true });

  const playlistLines = playlistRaw
    .split("\n")
    .filter(Boolean);
  const firstPosition = playlistLines
    .map((line) => Number(line.split("\t")[0]))
    .find((position) => Number.isFinite(position));
  const positionOffset = firstPosition === 0 ? 1 : 0;

  const queue = playlistLines.map((line, index) => {
    const [positionRaw, title, artist, album, duration, file] = line.split("\t");
    const rawPosition = Number(positionRaw);
    const position = Number.isFinite(rawPosition) ? rawPosition + positionOffset : null;
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

function shouldUseOutputVolumeForMpcAction() {
  const cachedSource = tikpalStateSnapshotCache?.state?.audio?.currentSource?.id
    ?? tikpalStateSnapshotCache?.state?.playback?.source
    ?? null;
  const source = mockArmedSource ?? cachedSource;
  return source === "scene" || COMMAND_HANDOFF_SOURCE_TARGETS.has(source);
}

function getCurrentMpcSourceId() {
  return mockArmedSource
    ?? tikpalStateSnapshotCache?.state?.audio?.currentSource?.id
    ?? tikpalStateSnapshotCache?.state?.playback?.source
    ?? null;
}

function isCurrentMpcSourceAirplay() {
  return getCurrentMpcSourceId() === "airplay";
}

function isCurrentMpcSourceBluetooth() {
  return getCurrentMpcSourceId() === "bluetooth";
}

function isCurrentMpcSourceRadio() {
  return getCurrentMpcSourceId() === "radio";
}

function isAirplayTransportPlaybackAction(action) {
  return ["play_pause", "play", "pause", "next", "previous"].includes(String(action?.type ?? ""));
}

function isBluetoothTransportPlaybackAction(action) {
  return ["play_pause", "play", "pause", "next", "previous"].includes(String(action?.type ?? ""));
}

function isRadioStationTransportAction(action) {
  return ["next", "previous"].includes(String(action?.type ?? ""));
}

function getAirplayTransportCommand(action) {
  switch (action.type) {
    case "play_pause":
      return { command: AIRPLAY_PLAY_PAUSE_COMMAND, label: "play/pause" };
    case "play":
      return { command: AIRPLAY_PLAY_COMMAND, label: "play" };
    case "pause":
      return { command: AIRPLAY_PAUSE_COMMAND, label: "pause" };
    case "next":
      return { command: AIRPLAY_NEXT_COMMAND, label: "next" };
    case "previous":
      return { command: AIRPLAY_PREVIOUS_COMMAND, label: "previous" };
    default:
      return null;
  }
}

function getBluetoothTransportCommand(action) {
  switch (action.type) {
    case "play_pause":
      return { command: BLUETOOTH_PLAY_PAUSE_COMMAND, label: "play/pause" };
    case "play":
      return { command: BLUETOOTH_PLAY_COMMAND, label: "play" };
    case "pause":
      return { command: BLUETOOTH_PAUSE_COMMAND, label: "pause" };
    case "next":
      return { command: BLUETOOTH_NEXT_COMMAND, label: "next" };
    case "previous":
      return { command: BLUETOOTH_PREVIOUS_COMMAND, label: "previous" };
    default:
      return null;
  }
}

async function applyMpcAirplayPlaybackAction(action) {
  switch (action.type) {
    case "play_pause":
    case "play":
    case "pause":
    case "next":
    case "previous": {
      const transport = getAirplayTransportCommand(action);
      if (!transport?.command?.trim()) {
        throw new Error(`AirPlay ${transport?.label ?? action.type} transport is not configured`);
      }
      if (!await readAirplayTransportAvailable(true)) {
        throw new Error(AIRPLAY_REMOTE_UNAVAILABLE_REASON);
      }
      await runCommand(transport.command, { allowFailure: false, timeout: 5000 });
      return;
    }
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

async function applyMpcBluetoothPlaybackAction(action) {
  switch (action.type) {
    case "play_pause":
    case "play":
    case "pause":
    case "next":
    case "previous": {
      const transport = getBluetoothTransportCommand(action);
      if (!transport?.command?.trim()) {
        throw new Error(`Bluetooth ${transport?.label ?? action.type} transport is not configured`);
      }
      if (!await readBluetoothTransportAvailable(true)) {
        throw new Error(BLUETOOTH_REMOTE_UNAVAILABLE_REASON);
      }
      await runCommand(transport.command, { allowFailure: false, timeout: 5000 });
      return;
    }
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

async function getMpcSnapshot(options = {}) {
  const includeSlowRuntimeStatus = options.includeSlowRuntimeStatus !== false;
  const includeSourceRuntimeStatus = options.includeSourceRuntimeStatus ?? includeSlowRuntimeStatus;
  const includeOutputVolumeStatus = options.includeOutputVolumeStatus ?? includeSlowRuntimeStatus;
  const [currentRaw, statusRaw, statsRaw] = await Promise.all([
    runMpc(["--format", "%title%\t%artist%\t%album%\t%file%\t%time%", "current"], { allowFailure: true }),
    runMpc(["status"], { allowFailure: true }),
    runMpc(["stats"], { allowFailure: true })
  ]);

  const status = parseMpcStatus(statusRaw);
  const currentColumns = currentRaw.split("\t");
  const hasFormattedCurrent = currentColumns.length >= 4;
  const [title, artist, album, rawFile, duration] = hasFormattedCurrent
    ? currentColumns
    : ["", "", "", extractMpcCurrentFile(currentRaw), ""];
  const file = getEffectiveMpcCurrentFile(rawFile, status);
  const hasCurrentTrack = Boolean(currentRaw.trim()) || Boolean(file);
  const durationSeconds = parseDuration(duration) ?? status.durationSeconds;
  const nextSystem = includeSlowRuntimeStatus
    ? await getMpcSystemSnapshot(statusRaw, statsRaw)
    : getCachedMpcSystemSnapshot(statusRaw, statsRaw);
  const useCachedSceneSourceRuntimeStatus = includeSourceRuntimeStatus && shouldUseCachedSceneSourceRuntimeStatus(file);
  const audio = includeSourceRuntimeStatus && !useCachedSceneSourceRuntimeStatus
    ? await getMpcAudioSnapshot(file, status)
    : buildMinimalMpcAudioSnapshot(file);
  const queuePreview = await getMpcQueuePreview(status);
  const playbackSource = audio.sources.find((source) => source.active)?.id ?? audio.currentSource.id;
  const outputVolumePercent = includeOutputVolumeStatus ? await readOutputVolumePercent() : null;
  const isSceneSource = playbackSource === "scene";
  const isExternalHandoffSource = playbackSource === "scene" || playbackSource === "spotify" || playbackSource === "bluetooth" || playbackSource === "airplay" || playbackSource === "upnp";
  const isMpdBackedSource = playbackSource === "mpd" || playbackSource === "audio";
  const volumePercent = isExternalHandoffSource
    ? (outputVolumePercent ?? status.volumePercent ?? system.volume.percent)
    : (status.volumePercent ?? outputVolumePercent ?? system.volume.percent);
  if (volumePercent > 0) {
    void rememberNonZeroVolumePercent(volumePercent).catch(() => null);
  }
  const radioPlaybackMetadata = playbackSource === "radio"
    ? normalizeRadioPlaybackMetadata({ title, artist, album, file, audio })
    : null;
  const activeRadioStation = playbackSource === "radio"
    ? await findRadioStationByUri(file)
    : null;
  if (playbackSource === "radio"
    && status.state === "playing"
    && activeRadioStation?.id
    && !getMpcRadioStreamFailure(statusRaw)
    && getCachedRememberedAudioSource()?.radioStationId !== activeRadioStation.id) {
    await rememberActiveRadioStationSource(activeRadioStation);
  }
  const bluetoothPlaybackMetadata = includeSlowRuntimeStatus && playbackSource === "bluetooth"
    ? await readBluetoothPlaybackMetadata()
    : null;
  const bluetoothTransportAvailable = playbackSource === "bluetooth"
    ? await readBluetoothTransportAvailable(includeSlowRuntimeStatus)
    : null;
  const airplayPlaybackMetadata = includeSlowRuntimeStatus && playbackSource === "airplay"
    ? await readAirplayPlaybackMetadata()
    : null;
  const airplayTransportAvailable = playbackSource === "airplay"
    ? await readAirplayTransportAvailable(includeSlowRuntimeStatus)
    : null;
  const hasBluetoothTrackMetadata = Boolean(bluetoothPlaybackMetadata?.title);
  const airplayConnected = playbackSource === "airplay" && audio.currentSource.connectionState === "connected";
  const trustedAirplayPlaybackMetadata = airplayConnected
    ? normalizeAirplayPlaybackMetadata(airplayPlaybackMetadata)
    : null;
  const hasAirplayTrackMetadata = Boolean(trustedAirplayPlaybackMetadata?.title);
  const bluetoothRemoteArtworkUrl = playbackSource === "bluetooth" && bluetoothPlaybackMetadata?.title && !bluetoothPlaybackMetadata.artworkUrl
    ? await resolveRemotePlaybackArtworkUrl({
        playbackSource,
        title: bluetoothPlaybackMetadata.title,
        artist: bluetoothPlaybackMetadata.artist,
        album: bluetoothPlaybackMetadata.album
      })
    : null;
  const airplayRemoteArtworkUrl = playbackSource === "airplay" && trustedAirplayPlaybackMetadata?.title && !trustedAirplayPlaybackMetadata.artworkUrl
    ? await resolveRemotePlaybackArtworkUrl({
        playbackSource,
        title: trustedAirplayPlaybackMetadata.title,
        artist: trustedAirplayPlaybackMetadata.artist,
        album: trustedAirplayPlaybackMetadata.album
      })
    : null;
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
          ? trustedAirplayPlaybackMetadata ? mapBluetoothPlaybackState(trustedAirplayPlaybackMetadata) : "stopped"
        : playbackSource === "spotify"
          ? audio.currentSource.connectionState === "connected" ? "playing" : "stopped"
        : playbackSource === "upnp"
          ? audio.currentSource.connectionState === "connected" ? "playing" : "stopped"
        : hasCurrentTrack ? status.state : "stopped",
      source: playbackSource,
      albumArtUrl: playbackSource === "bluetooth"
        ? bluetoothPlaybackMetadata?.artworkUrl ?? bluetoothRemoteArtworkUrl
        : playbackSource === "airplay"
          ? trustedAirplayPlaybackMetadata?.artworkUrl ?? airplayRemoteArtworkUrl
          : playbackSource === "radio" && activeRadioStation?.logoUrl
            ? activeRadioStation.logoUrl
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
              ? trustedAirplayPlaybackMetadata?.title || "AirPlay Ready"
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
              ? trustedAirplayPlaybackMetadata?.artist || (hasAirplayTrackMetadata
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
              ? trustedAirplayPlaybackMetadata?.album || "AirPlay Source"
          : hasCurrentTrack ? metadata.album || album || "MPD Queue" : null,
      elapsedSeconds: isSceneSource
        ? null
        : playbackSource === "bluetooth"
        ? millisecondsToSeconds(bluetoothPlaybackMetadata?.positionMs)
        : playbackSource === "airplay"
          ? millisecondsToSeconds(trustedAirplayPlaybackMetadata?.positionMs)
        : playbackSource === "spotify"
          || playbackSource === "upnp"
          ? null
        : isMpdBackedSource && hasCurrentTrack ? status.elapsedSeconds : null,
      durationSeconds: isSceneSource
        ? null
        : playbackSource === "bluetooth"
        ? millisecondsToSeconds(bluetoothPlaybackMetadata?.durationMs, { allowZero: false })
        : playbackSource === "airplay"
          ? millisecondsToSeconds(trustedAirplayPlaybackMetadata?.durationMs, { allowZero: false })
        : playbackSource === "spotify"
          || playbackSource === "upnp"
          ? null
        : isMpdBackedSource && hasCurrentTrack ? durationSeconds : null,
      timingDiagnostics: playbackSource === "bluetooth"
        ? bluetoothPlaybackMetadata?.timingDiagnostics ?? null
        : playbackSource === "airplay"
          ? trustedAirplayPlaybackMetadata?.timingDiagnostics ?? null
          : null,
      transportCapabilities: buildPlaybackTransportCapabilities(playbackSource, {
        airplayRemoteControlAvailable: airplayTransportAvailable,
        bluetoothRemoteControlAvailable: bluetoothTransportAvailable
      }),
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

  for (let attempt = 0; attempt < 6; attempt += 1) {
    let status = parseMpcStatus(await runMpc(["status"], { allowFailure: true }));
    let currentFile = extractMpcCurrentFile(await runMpc(["--format", "%file%", "current"], { allowFailure: true }));
    if (status.queueLength > 0 && status.state === "playing" && currentFile) return;
    if (status.queueLength > 0) {
      await runMpc(["play"]);
      status = parseMpcStatus(await runMpc(["status"], { allowFailure: true }));
      currentFile = extractMpcCurrentFile(await runMpc(["--format", "%file%", "current"], { allowFailure: true }));
      if (status.state === "playing" && currentFile) return;
    }
    await wait(150);
  }

  throw new Error("MPD did not enter playing state after playback start");
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

function getMpcRadioStreamFailure(statusRaw) {
  const raw = String(statusRaw ?? "");
  if (/Failed to decode\s+"[^"]+"/i.test(raw)) {
    return "MPD radio stream failed to decode";
  }
  if (/ERROR:.*(Connection timed out|Timeout was reached|Could not resolve|Name or service not known|Failed to connect|HTTP\s*[45]\d\d)/is.test(raw)) {
    return "MPD radio stream could not connect";
  }
  return null;
}

function isMpcRadioXrunLine(line) {
  return /Decoder is too slow|xrun/i.test(String(line ?? ""));
}

function radioWeakNetworkKey(stationId, uri) {
  const id = String(stationId ?? "").trim();
  const targetUri = String(uri ?? "").trim();
  return `${id || "unknown"}|${targetUri}`;
}

function resetMpcRadioWeakNetworkMonitor(stationId, uri) {
  const key = radioWeakNetworkKey(stationId, uri);
  mpcRadioWeakNetworkState = {
    key,
    startedAtMs: Date.now(),
    primed: false,
    seenLines: new Set(),
    events: []
  };
}

async function readRecentMpcRadioXrunLines() {
  if (!MPD_LOG_PATH || RADIO_XRUN_SKIP_THRESHOLD <= 0) return [];
  let handle = null;
  try {
    const info = await stat(MPD_LOG_PATH);
    if (!info.isFile() || info.size <= 0) return [];
    const length = Math.min(info.size, RADIO_XRUN_LOG_TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    handle = await open(MPD_LOG_PATH, "r");
    await handle.read(buffer, 0, length, info.size - length);
    return buffer
      .toString("utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(isMpcRadioXrunLine);
  } catch {
    return [];
  } finally {
    await handle?.close().catch(() => null);
  }
}

function noteMpcRadioXrunLines(stationId, uri, lines) {
  const key = radioWeakNetworkKey(stationId, uri);
  if (!mpcRadioWeakNetworkState || mpcRadioWeakNetworkState.key !== key) {
    resetMpcRadioWeakNetworkMonitor(stationId, uri);
  }

  const now = Date.now();
  const state = mpcRadioWeakNetworkState;
  if (!state.primed) {
    for (const line of lines) {
      state.seenLines.add(line);
    }
    state.primed = true;
    return false;
  }

  for (const line of lines) {
    if (state.seenLines.has(line)) continue;
    state.seenLines.add(line);
    state.events.push(now);
  }

  if (state.seenLines.size > 200) {
    state.seenLines = new Set(Array.from(state.seenLines).slice(-100));
  }
  state.events = state.events.filter((eventAtMs) => now - eventAtMs <= RADIO_XRUN_WINDOW_MS);

  if (now - state.startedAtMs < RADIO_XRUN_GRACE_MS) return false;
  return state.events.length >= RADIO_XRUN_SKIP_THRESHOLD;
}

function hasMpcAlsaOutputFailure(statusRaw) {
  return /Failed to open ALSA device|Device or resource busy/i.test(String(statusRaw ?? ""));
}

function getMpcRadioStartFailure(statusRaw, status, { requirePlaying = false } = {}) {
  const streamFailure = getMpcRadioStreamFailure(statusRaw);
  if (streamFailure) {
    return streamFailure;
  }
  if (hasMpcAlsaOutputFailure(statusRaw)) {
    return "MPD radio stream reported an ALSA output failure";
  }
  if (/ERROR:/i.test(statusRaw)) {
    return "MPD radio stream reported an error";
  }
  if (status.state && status.state !== "playing") {
    return `MPD radio stream entered ${status.state}`;
  }
  if (requirePlaying && status.state !== "playing") {
    return "MPD radio stream did not report playing";
  }
  return null;
}

async function readMpcRadioStartStatus(options = {}) {
  try {
    const statusRaw = await runMpc(["status"]);
    const status = parseMpcStatus(statusRaw);
    return {
      raw: statusRaw,
      status,
      failure: getMpcRadioStartFailure(statusRaw, status, options),
      error: null
    };
  } catch (error) {
    const raw = typeof error?.stdout === "string" && error.stdout.trim()
      ? error.stdout.trimEnd()
      : typeof error?.stderr === "string" && error.stderr.trim()
        ? error.stderr.trim()
        : "";
    const status = parseMpcStatus(raw);
    return {
      raw,
      status,
      failure: getMpcRadioStartFailure(raw, status, options)
        ?? (error instanceof Error ? error.message : "mpc status failed"),
      error: raw ? null : error
    };
  }
}

async function nudgeMpcPlaybackStart(position = null) {
  const playArgs = position === null ? ["play"] : ["play", String(position)];
  await runMpc(playArgs, { allowFailure: true });
}

function isLikelyRadioStationFailure(error) {
  const message = String(error?.message ?? error ?? "");
  return /failed to decode|could not connect|connection timed out|timeout was reached|failed to connect|did not report playing|entered stopped|mpc command timed out|Timeout while connecting/i.test(message);
}

function isMpcCommunicationFailure(error) {
  const message = String(error?.message ?? error ?? "");
  return /mpc command timed out|Timeout while connecting|Connection refused|No route to host|Connection reset by peer|Broken pipe/i.test(message);
}

async function recoverMpdService(reason) {
  if (!MPD_RECOVERY_COMMAND.trim()) return false;
  if (mpdRecoveryPromise) return await mpdRecoveryPromise;

  const reasonLabel = reason instanceof Error ? reason.message : String(reason ?? "unknown");
  mpdRecoveryPromise = (async () => {
    console.warn(`tikpal-api recovering MPD after mpc communication failure: ${reasonLabel}`);
    await runCommand(MPD_RECOVERY_COMMAND, { allowFailure: false, timeout: MPD_RECOVERY_TIMEOUT_MS });
    await wait(MPD_RECOVERY_SETTLE_MS);
    return true;
  })()
    .catch((error) => {
      console.warn(`tikpal-api MPD recovery failed: ${error instanceof Error ? error.message : "unknown error"}`);
      return false;
    })
    .finally(() => {
      mpdRecoveryPromise = null;
    });

  return await mpdRecoveryPromise;
}

async function stopMpdForExternalSource(target) {
  try {
    await runMpc(["stop"], { timeout: 2500 });
    return;
  } catch (error) {
    if (isMpcCommunicationFailure(error) && await recoverMpdService(error)) {
      await runMpc(["stop"], { allowFailure: true, timeout: 2500 });
      return;
    }
    console.warn(`tikpal-api could not stop MPD before switching to ${target}: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

async function isCurrentExternalSourceOpen(target) {
  try {
    const state = await collectTikpalStateSnapshot({
      includeSlowRuntimeStatus: false,
      includeSourceRuntimeStatus: true,
      includeOutputVolumeStatus: false,
      skipExperienceReconcile: true
    });
    const connectionState = state.audio.currentSource.connectionState;
    return state.audio.currentSource.id === target
      && (connectionState === "armed" || connectionState === "connected");
  } catch {
    return false;
  }
}

async function openExternalSourceIfNeeded(target) {
  if (await isCurrentExternalSourceOpen(target)) {
    scheduleExternalSourceCleanup(target);
    return;
  }
  await enforceConnectionGate(target);
}

function getFastRadioSwitchOptions() {
  return {
    postStartRecoveryPlays: 0,
    postStartSettleMs: RADIO_AUTO_SKIP_POST_START_SETTLE_MS,
    retryDelaysMs: RADIO_AUTO_SKIP_RETRY_DELAYS_MS,
    verifyWindowMs: RADIO_AUTO_SKIP_VERIFY_WINDOW_MS
  };
}

async function verifyMpcRadioStartWindow(options = {}) {
  const verifyWindowMs = options.verifyWindowMs ?? RADIO_START_VERIFY_WINDOW_MS;
  const verifyPollMs = options.verifyPollMs ?? RADIO_START_VERIFY_POLL_MS;
  const deadline = Date.now() + verifyWindowMs;
  let lastStatusRaw = "";
  let lastFailure = null;

  while (Date.now() < deadline) {
    await wait(verifyPollMs);
    const statusSnapshot = await readMpcRadioStartStatus();
    lastStatusRaw = statusSnapshot.raw;

    if (statusSnapshot.status.state === "playing") {
      return;
    }

    lastFailure = statusSnapshot.failure;
    if (statusSnapshot.error && isMpcCommunicationFailure(statusSnapshot.error)) {
      throw statusSnapshot.error;
    }
    if (getMpcRadioStreamFailure(statusSnapshot.raw)) {
      throw new Error(lastFailure ?? "MPD radio stream could not connect");
    }
    if (hasMpcAlsaOutputFailure(statusSnapshot.raw)) {
      await releaseKioskAudioOutputForMpd("radio");
    }
    await nudgeMpcPlaybackStart();
  }

  throw new Error(lastFailure ?? `MPD radio stream did not report playing${lastStatusRaw ? `: ${lastStatusRaw}` : ""}`);
}

async function recoverLateMpcRadioStartFailure(options = {}) {
  const recoveryPlays = options.postStartRecoveryPlays ?? RADIO_POST_START_RECOVERY_PLAYS;
  const settleMs = options.postStartSettleMs ?? RADIO_POST_START_SETTLE_MS;
  let lastFailure = null;

  for (let recovery = 0; recovery <= recoveryPlays; recovery += 1) {
    await wait(settleMs);
    const statusSnapshot = await readMpcRadioStartStatus({ requirePlaying: true });
    if (!statusSnapshot.failure) return;

    lastFailure = statusSnapshot.failure;
    if (statusSnapshot.error && isMpcCommunicationFailure(statusSnapshot.error)) {
      throw statusSnapshot.error;
    }
    if (getMpcRadioStreamFailure(statusSnapshot.raw)) {
      break;
    }
    if (recovery >= recoveryPlays) break;

    if (hasMpcAlsaOutputFailure(statusSnapshot.raw)) {
      await releaseKioskAudioOutputForMpd("radio");
    }
    await nudgeMpcPlaybackStart();
    await verifyMpcRadioStartWindow(options);
  }

  throw new Error(lastFailure ?? "MPD radio stream did not remain playing after recovery");
}

let mpcRadioAutoAdvanceInFlight = false;

async function autoAdvanceMpcRadioStation(currentUri, reason = "radio stream failure") {
  if (mpcRadioAutoAdvanceInFlight) {
    return true;
  }

  mpcRadioAutoAdvanceInFlight = true;
  try {
    console.warn(`tikpal-api auto-advancing Radio after ${reason}`);
    const advanced = await switchRadioStationByOffset(1, {
      currentFileOverride: currentUri,
      requireRadioContext: false,
      switchOptions: getFastRadioSwitchOptions()
    });
    if (advanced) {
      await refreshTikpalStateSnapshotAfterMutation({ includeSourceRuntimeStatus: true });
    }
    return advanced;
  } finally {
    mpcRadioAutoAdvanceInFlight = false;
  }
}

async function tryAutoAdvanceFailedMpcRadio(targetUri, currentUri, statusRaw) {
  if (currentUri !== targetUri || !getMpcRadioStreamFailure(statusRaw)) {
    return false;
  }
  return await autoAdvanceMpcRadioStation(currentUri, "stream decode/connect failure");
}

function scheduleMpcRadioLatePlayNudges(targetUri) {
  for (const delayMs of RADIO_LATE_PLAY_NUDGE_DELAYS_MS) {
    const timer = setTimeout(() => {
      void (async () => {
        const [currentFileRaw, statusRaw] = await Promise.all([
          runMpc(["--format", "%file%", "current"], { allowFailure: true }),
          runMpc(["status"], { allowFailure: true })
        ]);
        const status = parseMpcStatus(statusRaw);
        const currentUri = getEffectiveMpcCurrentFile(currentFileRaw, status);
        if (currentUri !== targetUri) return;
        if (status.state === "paused") return;

        if (await tryAutoAdvanceFailedMpcRadio(targetUri, currentUri, statusRaw)) return;

        const statusSnapshot = {
          raw: statusRaw,
          status,
          failure: getMpcRadioStartFailure(statusRaw, status, { requirePlaying: true })
        };
        if (!statusSnapshot.failure) return;

        if (hasMpcAlsaOutputFailure(statusRaw)) {
          await releaseKioskAudioOutputForMpd("radio");
        }
        await nudgeMpcPlaybackStart();
      })().catch(() => {
        // A delayed nudge is best-effort; the source switch response already carried the real outcome.
      });
    }, delayMs);
    timer.unref?.();
  }
}

function recoverWeakNetworkMpcRadioIfNeeded(snapshot) {
  if (
    API_MODE !== "mpc"
    || mpcRadioWeakNetworkRecoveryPromise
    || mpcRadioAutoAdvanceInFlight
    || sourceSwitchInFlightCount > 0
  ) {
    return null;
  }
  if (snapshot?.playback?.state !== "playing" || snapshot?.playback?.source !== "radio") return null;
  if (snapshot?.audio?.currentSource?.id !== "radio") return null;

  mpcRadioWeakNetworkRecoveryPromise = (async () => {
    const currentFileRaw = await runMpc(["--format", "%file%", "current"], { allowFailure: true });
    const currentUri = extractMpcCurrentFile(currentFileRaw);
    if (!isStreamUri(currentUri)) return false;

    const stationId = snapshot.audio.currentSource.radioStationId ?? activeMpcRadioStationCache?.id ?? null;
    const xrunLines = await readRecentMpcRadioXrunLines();
    if (xrunLines.length === 0) return false;
    if (!noteMpcRadioXrunLines(stationId, currentUri, xrunLines)) return false;
    if (sourceSwitchInFlightCount > 0) return false;

    return await autoAdvanceMpcRadioStation(currentUri, "repeated decoder/xrun stalls");
  })()
    .catch((error) => {
      console.warn(`tikpal-api radio weak-network recovery failed: ${error instanceof Error ? error.message : "unknown error"}`);
      return false;
    })
    .finally(() => {
      mpcRadioWeakNetworkRecoveryPromise = null;
    });

  return mpcRadioWeakNetworkRecoveryPromise;
}

async function startRadioStreamUriOnce(targetUri, options = {}) {
  await runMpc(["clear"]);
  await runMpc(["add", targetUri]);
  await restoreMpcRadioVolumeIfMuted();
  await nudgeMpcPlaybackStart();
  await verifyMpcRadioStartWindow(options);
  await recoverLateMpcRadioStartFailure(options);
}

async function startRadioStreamUri(targetUri, options = {}) {
  try {
    await startRadioStreamUriOnce(targetUri, options);
  } catch (error) {
    if (options.skipMpdRecovery || !isMpcCommunicationFailure(error)) {
      throw error;
    }

    if (!await recoverMpdService(error)) {
      throw error;
    }

    await startRadioStreamUriOnce(targetUri, {
      ...options,
      skipMpdRecovery: true
    });
  }
}

async function switchToRadioSource(action = {}, options = {}) {
  const radioStations = await getAvailableRadioStations();
  const selectedStation = action.radioStationId
    ? radioStations.find((station) => station.id === action.radioStationId)
    : null;

  if (action.radioStationId && !selectedStation) {
    throw new Error(`Unknown radio station: ${action.radioStationId}`);
  }

  const targetUri = selectedStation?.uri ?? radioStations[0]?.uri ?? RADIO_DEFAULT_URI ?? "";
  const targetStation = selectedStation ?? radioStations.find((station) => station.uri === targetUri) ?? null;

  if (!targetUri && RADIO_ACTIVATE_COMMAND) {
    await runSystemActionCommand(RADIO_ACTIVATE_COMMAND, "radio");
    cacheActiveMpcRadioStation(null, "");
    return;
  }

  if (!targetUri) {
    throw new Error("radio is unavailable in this runtime");
  }

  let lastError = null;
  const retryDelaysMs = options.retryDelaysMs ?? RADIO_SWITCH_RETRY_DELAYS_MS;
  try {
    for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
      if (attempt > 0) {
        await wait(retryDelaysMs[attempt - 1]);
      }
      try {
        cacheActiveMpcRadioStation(targetStation, targetUri);
        await startRadioStreamUri(targetUri, options);
        cacheActiveMpcRadioStation(targetStation, targetUri);
        resetMpcRadioWeakNetworkMonitor(targetStation?.id ?? null, targetUri);
        await rememberActiveRadioStationSource(targetStation, { localTrackPath: action.localTrackPath });
        return;
      } catch (error) {
        lastError = error;
      }
    }

    if (options.fallbackOnFailure && targetUri && isLikelyRadioStationFailure(lastError)) {
      if (await switchRadioStationByOffset(1, {
        currentFileOverride: targetUri,
        requireRadioContext: false,
        switchOptions: getFastRadioSwitchOptions()
      })) {
        return;
      }
    }

    throw lastError ?? new Error("MPD radio stream did not remain playing");
  } finally {
    scheduleMpcRadioLatePlayNudges(targetUri);
  }
}

async function primeMpcRadioSourceCache(action = {}) {
  const radioStations = await getAvailableRadioStations();
  const selectedStation = action.radioStationId
    ? radioStations.find((station) => station.id === action.radioStationId)
    : null;
  const targetUri = selectedStation?.uri ?? radioStations[0]?.uri ?? RADIO_DEFAULT_URI ?? "";
  const targetStation = selectedStation ?? radioStations.find((station) => station.uri === targetUri) ?? null;
  if (targetUri) {
    cacheActiveMpcRadioStation(targetStation, targetUri);
  }
}

async function switchRadioStationByOffset(offset, options = {}) {
  let currentFile = String(options.currentFileOverride ?? "").trim();
  if (!currentFile) {
    const [currentFileRaw, statusRaw] = await Promise.all([
      runMpc(["--format", "%file%", "current"], { allowFailure: true }),
      runMpc(["status"], { allowFailure: true })
    ]);
    currentFile = getEffectiveMpcCurrentFile(currentFileRaw, parseMpcStatus(statusRaw));
  }
  if (options.requireRadioContext !== false && !isCurrentMpcSourceRadio() && !isStreamUri(currentFile)) return false;

  const tikpalStations = await getAvailableRadioStations("tikpal");
  const tikpalActiveStation = findActiveRadioStationFromList(currentFile, tikpalStations);
  const tikpalIndex = tikpalActiveStation
    ? tikpalStations.findIndex((station) => station.id === tikpalActiveStation.id)
    : -1;
  const allStations = tikpalIndex >= 0 ? tikpalStations : await getAvailableRadioStations("all");
  const allActiveStation = tikpalIndex >= 0 ? tikpalActiveStation : findActiveRadioStationFromList(currentFile, allStations);
  const allIndex = tikpalIndex >= 0
    ? tikpalIndex
    : allActiveStation
      ? allStations.findIndex((station) => station.id === allActiveStation.id)
      : -1;
  const stations = tikpalIndex >= 0 || allIndex < 0 || allStations[allIndex]?.catalogSource === "tikpal"
    ? tikpalStations
    : allStations;
  if (stations.length === 0) return false;

  const activeStation = tikpalIndex >= 0 ? tikpalActiveStation : allActiveStation;
  const currentIndex = activeStation
    ? stations.findIndex((station) => station.id === activeStation.id)
    : stations.findIndex((station) => station.uri === currentFile);
  const fallbackIndex = offset > 0 ? 0 : stations.length - 1;
  const step = offset < 0 ? -1 : 1;
  const firstCandidateIndex = currentIndex >= 0 ? currentIndex + step : fallbackIndex;
  let lastError = null;
  for (let attempt = 0; attempt < stations.length; attempt += 1) {
    const candidateIndex = ((firstCandidateIndex + step * attempt) % stations.length + stations.length) % stations.length;
    const candidateStation = stations[candidateIndex];
    if (!candidateStation?.id) continue;

    try {
      await switchToRadioSource({ radioStationId: candidateStation.id }, options.switchOptions ?? getFastRadioSwitchOptions());
      await rememberActiveRadioStationSource(candidateStation);
      return true;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("No radio station could be started");
}

async function switchToSpotifySource() {
  await openExternalSourceIfNeeded("spotify");
  await stopMpdForExternalSource("spotify");
}

async function switchToBluetoothSource() {
  await openExternalSourceIfNeeded("bluetooth");
  await stopMpdForExternalSource("bluetooth");
}

async function switchToAirplaySource() {
  await openExternalSourceIfNeeded("airplay");
  await stopMpdForExternalSource("airplay");
}

async function switchToUpnpSource() {
  await openExternalSourceIfNeeded("upnp");
  await stopMpdForExternalSource("upnp");
}

async function switchToSceneSource(action = {}) {
  activateSceneAudio(action);
  await enforceConnectionGate("scene");
  await stopMpdForExternalSource("scene");
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

  if (isCurrentMpcSourceAirplay()) {
    await applyMpcAirplayPlaybackAction(action);
    return;
  }

  if (isCurrentMpcSourceBluetooth()) {
    await applyMpcBluetoothPlaybackAction(action);
    return;
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
      if (await switchRadioStationByOffset(1)) break;
      await ensureMpcQueue();
      await runMpc(["next"]);
      await ensureMpcPlaybackStarted();
      break;
    case "previous":
      if (await switchRadioStationByOffset(-1)) break;
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
      if (shouldUseOutputVolumeForMpcAction()) {
        await setOutputVolumePercent(percent);
      } else {
        await runMpc(["volume", String(Math.round(percent))]);
        if (percent > 0) {
          await rememberNonZeroVolumePercent(percent);
        }
      }
      break;
    }
    default:
      throw new Error(`Unsupported playback action: ${action.type}`);
  }

  if (["next", "previous"].includes(String(action.type))) {
    const currentSource = getCurrentMpcSourceId();
    if (!currentSource || currentSource === "mpd") {
      await rememberCurrentLocalLibraryTrackSource();
    }
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

async function startStartupSceneSoundPlayback() {
  if (!STARTUP_SCENE_SOUND_ENABLED) return false;

  try {
    const current = await readRoomExperienceState();
    if (current.mode === "hifi") return false;

    const sceneVideo = await resolveSceneAudioVideo(current);
    if (!current.sceneSoundEnabled) {
      await writeRoomExperienceState({
        ...current,
        sceneSoundEnabled: true
      });
    } else if (getCurrentMpcSourceId() === "scene") {
      activateSceneAudio({
        sceneVideoId: sceneVideo.id,
        sceneVideoLabel: sceneVideo.label,
        sceneVideoSrc: sceneVideo.src
      });
      mockArmedSource = "scene";
      return true;
    }
    await applySourceSwitch({
      target: "scene",
      sceneVideoId: sceneVideo.id,
      sceneVideoLabel: sceneVideo.label,
      sceneVideoSrc: sceneVideo.src
    });
    return true;
  } catch (error) {
    console.warn(`tikpal-api startup scene sound failed: ${error instanceof Error ? error.message : "unknown error"}`);
    return false;
  }
}

async function getConnectedStartupExternalSource() {
  try {
    const snapshot = await getMpcSnapshot({
      includeSlowRuntimeStatus: false,
      includeSourceRuntimeStatus: true,
      includeOutputVolumeStatus: false
    });
    const currentSource = snapshot.audio.currentSource;
    if (COMMAND_HANDOFF_SOURCE_TARGETS.has(currentSource.id) && currentSource.connectionState === "connected") {
      return currentSource;
    }
  } catch (error) {
    console.warn(`tikpal-api startup source check failed: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  return null;
}

function isRememberedSourceAlreadyPlaying(snapshot, action) {
  if (snapshot?.playback?.state !== "playing") return false;
  const currentSource = snapshot?.audio?.currentSource;
  if (!currentSource || currentSource.id !== action.target) return false;

  if (action.target === "radio" && action.radioStationId) {
    return currentSource.radioStationId === action.radioStationId;
  }

  if (action.target === "mpd" && action.localTrackPath) {
    const rememberedPath = normalizeLocalLibraryStateTrackPath(action.localTrackPath);
    return Boolean(rememberedPath && snapshot.playback.queuePreview?.some((entry) => (
      entry.active && normalizeLocalLibraryStateTrackPath(entry.id) === rememberedPath
    )));
  }

  return action.target === "mpd";
}

function buildHifiRuntimeRecoveryAction(snapshot) {
  const rememberedSource = snapshot?.audio?.rememberedSource ?? getCachedRememberedAudioSource();
  const target = rememberedSource?.target;
  if (target !== "mpd" && target !== "radio") return null;
  return {
    target,
    ...(rememberedSource.radioStationId ? { radioStationId: rememberedSource.radioStationId } : {}),
    ...(rememberedSource.localTrackPath ? { localTrackPath: rememberedSource.localTrackPath } : {})
  };
}

function shouldRecoverHifiRuntimePlayback(snapshot, action) {
  if (!snapshot || !action) return false;
  if (snapshot.playback?.state === "paused") return false;
  if (isRememberedSourceAlreadyPlaying(snapshot, action)) return false;

  const currentSource = snapshot.audio?.currentSource;
  if (currentSource && COMMAND_HANDOFF_SOURCE_TARGETS.has(currentSource.id) && currentSource.connectionState !== "idle") {
    return false;
  }

  if (snapshot.playback?.state === "stopped") return true;
  if (currentSource?.id !== action.target) return true;

  if (snapshot.playback?.state === "playing") {
    if (action.target === "radio") {
      const expectedStationId = normalizeRememberedRadioStationId(action.radioStationId);
      const currentStationId = normalizeRememberedRadioStationId(currentSource?.radioStationId);
      return Boolean(expectedStationId && currentStationId && currentStationId !== expectedStationId);
    }

    if (action.target === "mpd" && action.localTrackPath) {
      const rememberedPath = normalizeLocalLibraryStateTrackPath(action.localTrackPath);
      if (!rememberedPath) return false;
      return !snapshot.playback?.queuePreview?.some((entry) => (
        entry.active && normalizeLocalLibraryStateTrackPath(entry.id) === rememberedPath
      ));
    }
  }

  return false;
}

async function restoreHifiRememberedSourcePlayback() {
  try {
    const experience = await readRoomExperienceState();
    if (experience.mode !== "hifi") return false;

    const restoreAction = buildRememberedSourceSwitchAction();
    if (!restoreAction) return false;

    const snapshot = await getMpcSnapshot({
      includeSlowRuntimeStatus: false,
      includeSourceRuntimeStatus: true,
      includeOutputVolumeStatus: false
    });
    if (isRememberedSourceAlreadyPlaying(snapshot, restoreAction)) return true;

    try {
      await applySourceSwitch(restoreAction, { rememberSource: false });
    } catch (error) {
      if (restoreAction.target !== "mpd" || !restoreAction.localTrackPath) {
        throw error;
      }
      await applySourceSwitch({ target: "mpd" }, { rememberSource: false });
    }

    await refreshTikpalStateSnapshotAfterMutation({
      includeSourceRuntimeStatus: restoreAction.target === "mpd" || restoreAction.target === "radio" || COMMAND_HANDOFF_SOURCE_TARGETS.has(restoreAction.target),
      includeOutputVolumeStatus: COMMAND_HANDOFF_SOURCE_TARGETS.has(restoreAction.target)
    });
    return true;
  } catch (error) {
    console.warn(`tikpal-api startup hifi restore failed: ${error instanceof Error ? error.message : "unknown error"}`);
    return false;
  }
}

function recoverHifiRuntimePlaybackIfNeeded(snapshot) {
  if (API_MODE !== "mpc" || hifiRuntimeRecoveryPromise || sourceSwitchInFlightCount > 0) return null;

  const action = buildHifiRuntimeRecoveryAction(snapshot);
  if (!shouldRecoverHifiRuntimePlayback(snapshot, action)) return null;

  hifiRuntimeRecoveryPromise = (async () => {
    const experience = await readRoomExperienceState();
    if (experience.mode !== "hifi") return false;
    if (sourceSwitchInFlightCount > 0) return false;

    const now = Date.now();
    if (now - hifiRuntimeRecoveryLastAttemptAtMs < HIFI_RUNTIME_RECOVERY_COOLDOWN_MS) return false;
    hifiRuntimeRecoveryLastAttemptAtMs = now;

    try {
      console.warn(`tikpal-api hifi runtime recovery restoring ${action.target}${action.radioStationId ? `:${action.radioStationId}` : ""}${action.localTrackPath ? `:${action.localTrackPath}` : ""}`);
      await applySourceSwitch(action, { rememberSource: false });
    } catch (error) {
      if (action.target !== "mpd" || !action.localTrackPath) {
        throw error;
      }
      await applySourceSwitch({ target: "mpd" }, { rememberSource: false });
    }

    await refreshTikpalStateSnapshotAfterMutation({
      includeSourceRuntimeStatus: true
    });
    return true;
  })()
    .catch((error) => {
      console.warn(`tikpal-api hifi runtime recovery failed: ${error instanceof Error ? error.message : "unknown error"}`);
      return false;
    })
    .finally(() => {
      hifiRuntimeRecoveryPromise = null;
    });

  return hifiRuntimeRecoveryPromise;
}

async function applyStartupPlaybackPolicy() {
  if (await getConnectedStartupExternalSource()) return;
  if (await restoreHifiRememberedSourcePlayback()) return;
  if (await startStartupSceneSoundPlayback()) return;
  await primeMpcPlayback();
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
  return withCurrentVolatileState(applyMpcRadioCatalogReadyToState(tikpalStateSnapshotCache?.state ?? buildFallbackMpcStateSnapshot()));
}

function cacheTikpalStateSnapshot(state) {
  tikpalStateSnapshotCache = {
    state: withCurrentVolatileState(applyMpcRadioCatalogReadyToState(state)),
    updatedAtMs: Date.now(),
    error: null
  };
  return readCachedTikpalState();
}

async function refreshAirplayPlaybackMetadataForState(state, { force = false } = {}) {
  if (!shouldRefreshAirplayPlaybackMetadata(state, { force })) {
    return state;
  }

  if (airplayDirectMetadataRefreshPromise) {
    return await airplayDirectMetadataRefreshPromise;
  }

  const now = Date.now();
  if (!force && now - airplayDirectMetadataRefreshAtMs < AIRPLAY_DIRECT_METADATA_REFRESH_MIN_MS) {
    return state;
  }
  airplayDirectMetadataRefreshAtMs = now;

  airplayDirectMetadataRefreshPromise = (async () => {
    const metadata = await readAirplayPlaybackMetadata();
    if (!metadata?.title) return cacheTikpalStateSnapshot(clearAirplayPlaybackMetadata(state));
    return cacheTikpalStateSnapshot(mergeAirplayPlaybackMetadata(state, metadata));
  })()
    .catch((error) => {
      console.warn(`tikpal-api airplay metadata refresh failed: ${error instanceof Error ? error.message : "unknown error"}`);
      return state;
    })
    .finally(() => {
      airplayDirectMetadataRefreshPromise = null;
    });

  return await airplayDirectMetadataRefreshPromise;
}

async function collectTikpalStateSnapshot(options = {}) {
  if (!options.skipExperienceReconcile) {
    await reconcileRoomExperienceState(await readRoomExperienceState());
  }

  const includeSlowRuntimeStatus = options.includeSlowRuntimeStatus !== false;
  const includeSourceRuntimeStatus = options.includeSourceRuntimeStatus ?? includeSlowRuntimeStatus;
  const includeOutputVolumeStatus = options.includeOutputVolumeStatus ?? includeSlowRuntimeStatus;
  const snapshot = API_MODE === "mpc"
    ? await getMpcSnapshot({ includeSlowRuntimeStatus, includeSourceRuntimeStatus, includeOutputVolumeStatus })
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
    if (force) {
      tikpalStateSnapshotRefreshQueued = true;
    }
    return tikpalStateSnapshotRefreshPromise;
  }

  const refreshGeneration = tikpalStateSnapshotGeneration;
  tikpalStateSnapshotRefreshPromise = collectTikpalStateSnapshot({ includeSlowRuntimeStatus: true })
    .then((state) => {
      if (refreshGeneration !== tikpalStateSnapshotGeneration) {
        return readCachedTikpalState();
      }
      const cachedState = cacheTikpalStateSnapshot(state);
      void recoverWeakNetworkMpcRadioIfNeeded(cachedState);
      void recoverHifiRuntimePlaybackIfNeeded(cachedState);
      return cachedState;
    })
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
      if (tikpalStateSnapshotRefreshQueued) {
        tikpalStateSnapshotRefreshQueued = false;
        void requestTikpalStateSnapshotRefresh({ force: true });
      }
    });

  return tikpalStateSnapshotRefreshPromise;
}

async function refreshTikpalStateSnapshotAfterMutation(options = {}) {
  if (API_MODE !== "mpc") {
    return await collectTikpalStateSnapshot();
  }

  tikpalStateSnapshotGeneration += 1;
  try {
    const state = await collectTikpalStateSnapshot({
      includeSlowRuntimeStatus: false,
      includeSourceRuntimeStatus: options.includeSourceRuntimeStatus === true,
      includeOutputVolumeStatus: options.includeOutputVolumeStatus === true,
      skipExperienceReconcile: true
    });
    cacheTikpalStateSnapshot(state);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.warn(`tikpal-api fast state refresh failed: ${message}`);
  }

  void requestTikpalStateSnapshotRefresh({ force: true });
  const cachedState = readCachedTikpalState();
  return await refreshAirplayPlaybackMetadataForState(cachedState, {
    force: options.forceFreshAirplayMetadata === true
      || shouldRefreshAirplayPlaybackMetadata(cachedState)
  });
}

async function shouldWaitForStartupPlaybackState() {
  if (!startupPlaybackPolicyPromise || tikpalStateSnapshotCache) return false;
  try {
    const experience = await readRoomExperienceState();
    return experience.mode === "hifi" && Boolean(buildRememberedSourceSwitchAction());
  } catch {
    return false;
  }
}

async function getTikpalState(options = {}) {
  if (API_MODE !== "mpc") {
    return await collectTikpalStateSnapshot(options);
  }

  if (await shouldWaitForStartupPlaybackState()) {
    await startupPlaybackPolicyPromise;
  }
  void requestTikpalStateSnapshotRefresh();
  return await refreshAirplayPlaybackMetadataForState(readCachedTikpalState(), {
    force: options.forceFreshAirplayMetadata === true
  });
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
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
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

function sendBinary(response, status, contentType, body, headers = {}) {
  response.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Accept,X-Tikpal-Key,X-Tikpal-Local-Ui",
    ...headers
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

function normalizeLyricsProviderChain(value) {
  const providers = String(value ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => SUPPORTED_LYRICS_PROVIDERS.has(entry));
  const deduped = [];
  for (const provider of providers) {
    if (!deduped.includes(provider)) deduped.push(provider);
  }
  return deduped.length > 0 ? deduped : ["lrclib", "lyricsovh"];
}

function lyricsProviderChainLabel() {
  return LYRICS_PROVIDER_CHAIN.join(", ");
}

function buildLyricsCacheKey(candidate) {
  return [
    candidate?.trackKey ?? "",
    candidate?.sourceScope ?? "",
    candidate?.recognitionMode ?? "",
    candidate?.playbackClock === true ? "clock" : "static",
    LYRICS_PROVIDER_CACHE_VERSION
  ].join("|");
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

function isUnreliableAirplayLyricsDuration(sourceScope, durationMs) {
  return sourceScope === "airplay_input"
    && Number.isFinite(durationMs)
    && durationMs > 0
    && durationMs <= AIRPLAY_LYRICS_UNRELIABLE_DURATION_MS;
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
    recognitionProvider: state.recognitionProvider ?? candidate.recognitionProvider ?? null,
    recognitionConfidence: candidate.recognitionConfidence ?? null,
    ...overrides
  });
}

function buildMetadataLyricsCandidate(playback, overrides = {}) {
  const sourceScope = overrides.sourceScope ?? "local_playback";
  const durationMs = Number.isFinite(playback.durationSeconds) ? Math.round(playback.durationSeconds * 1000) : null;
  const trustedDurationMs = isUnreliableAirplayLyricsDuration(sourceScope, durationMs) ? null : durationMs;
  const playbackClock = overrides.playbackClock ?? Number.isFinite(playback.elapsedSeconds);
  return {
    supported: true,
    source: playback.source,
    sourceScope,
    recognitionMode: "metadata",
    recognitionProvider: LYRICS_PROVIDER_CHAIN[0] ?? "lrclib",
    trackKey: buildPlaybackTrackKey({
      ...playback,
      durationSeconds: Number.isFinite(trustedDurationMs) ? trustedDurationMs / 1000 : null
    }),
    title: normalizeMetadataValue(playback.title),
    artist: normalizeMetadataValue(playback.artist),
    album: normalizeMetadataValue(playback.album),
    durationMs: trustedDurationMs,
    playbackClock
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

    const hasPlaybackClock = source === "airplay"
      ? playback.timingDiagnostics?.positionTrusted === true || playback.timingDiagnostics?.positionConfidence === "estimated"
      : Number.isFinite(playback.elapsedSeconds);
    const metadataCandidate = buildMetadataLyricsCandidate(playback, {
      sourceScope,
      playbackClock: hasPlaybackClock && Number.isFinite(playback.elapsedSeconds)
    });
    if (metadataCandidate.trackKey && !looksLikeUntrustedTrackMetadata(metadataCandidate)) {
      return metadataCandidate;
    }

    if (!getProxyInputCaptureCommand(source).trim()) {
      return {
        supported: false,
        sourceScope,
        recognitionMode: null,
        recognitionProvider: null,
        reason: `${sourceLabel} metadata unavailable for lyrics`
      };
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
      playbackClock: hasPlaybackClock && Number.isFinite(playback.elapsedSeconds)
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

function normalizeLyricsMatchValue(value) {
  return normalizeMetadataValue(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function uniqueLyricsLookupValues(values) {
  const results = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = normalizeMetadataValue(value);
    const key = normalizeLyricsMatchValue(normalized);
    if (!normalized || !key || seen.has(key)) continue;
    seen.add(key);
    results.push(normalized);
  }
  return results;
}

function buildLyricsTitleLookupValues(title) {
  const normalized = normalizeMetadataValue(title);
  const featuredBase = normalized
    .replace(/\s*[\[(]\s*(?:feat\.?|ft\.?|featuring|with)\b[^\])]*[\])]\s*/gi, " ")
    .replace(/\s+(?:feat\.?|ft\.?|featuring|with)\b.*$/i, " ")
    .replace(/\s+/g, " ")
    .trim();
  return uniqueLyricsLookupValues([normalized, featuredBase]);
}

function buildLyricsArtistLookupValues(artist) {
  const normalized = normalizeMetadataValue(artist);
  const splitArtists = normalized
    .split(/\s*(?:,|&|\band\b|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b|\bwith\b|\bx\b)\s*/i)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length >= 2);
  return uniqueLyricsLookupValues([normalized, ...splitArtists]);
}

function buildNormalizedLyricsTitleCandidates(value) {
  return buildLyricsTitleLookupValues(value).map(normalizeLyricsMatchValue).filter(Boolean);
}

function buildNormalizedLyricsArtistCandidates(value) {
  return buildLyricsArtistLookupValues(value).map(normalizeLyricsMatchValue).filter(Boolean);
}

function providerLyricsDurationMs(lyricsBody) {
  const durationSeconds = Number(lyricsBody?.duration ?? lyricsBody?.durationSeconds);
  return Number.isFinite(durationSeconds) && durationSeconds > 0 ? Math.round(durationSeconds * 1000) : null;
}

function strictLyricsProviderMatch(candidate, lyricsBody) {
  const expectedTitles = buildNormalizedLyricsTitleCandidates(candidate.title);
  const actualTitle = normalizeLyricsMatchValue(lyricsBody?.trackName ?? lyricsBody?.title);
  if (expectedTitles.length === 0 || !actualTitle || !expectedTitles.includes(actualTitle)) return false;

  const expectedArtist = normalizeLyricsMatchValue(candidate.artist);
  if (expectedArtist) {
    const actualArtist = normalizeLyricsMatchValue(lyricsBody?.artistName ?? lyricsBody?.artist);
    if (!actualArtist) return false;
    const expectedArtists = buildNormalizedLyricsArtistCandidates(candidate.artist);
    const actualArtists = buildNormalizedLyricsArtistCandidates(lyricsBody?.artistName ?? lyricsBody?.artist);
    const hasArtistMatch = actualArtist === expectedArtist
      || actualArtist.includes(expectedArtist)
      || expectedArtist.includes(actualArtist)
      || expectedArtists.some((expectedEntry) => actualArtists.some((actualEntry) => (
        actualEntry === expectedEntry || actualEntry.includes(expectedEntry) || expectedEntry.includes(actualEntry)
      )));
    if (!hasArtistMatch) {
      return false;
    }
  }

  return true;
}

function shouldUseStrictLyricsProviderMatch(candidate) {
  return isProxyInputSourceScope(candidate?.sourceScope) && candidate?.recognitionMode === "metadata";
}

function shouldUseProviderLyricsDuration(candidate, providerDurationMs) {
  if (candidate?.sourceScope !== "airplay_input") return false;
  if (!Number.isFinite(providerDurationMs) || providerDurationMs < 30_000) return false;

  const candidateDurationMs = Number(candidate.durationMs);
  if (!Number.isFinite(candidateDurationMs) || candidateDurationMs <= 0) return true;

  const toleranceMs = Math.max(8_000, Math.round(providerDurationMs * 0.12));
  return Math.abs(candidateDurationMs - providerDurationMs) > toleranceMs;
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

async function resolveRemotePlaybackArtworkUrl({ playbackSource, title, artist, album }) {
  if (!["bluetooth", "airplay"].includes(playbackSource)) return null;
  const cacheKey = buildArtworkCacheKey({ artist, album });
  if (!cacheKey) return null;

  const cached = await readCachedRemoteArtwork(cacheKey);
  if (cached) {
    currentArtworkState = {
      kind: "remote",
      token: cached.token,
      mimeType: cached.contentType,
      remotePath: cached.filePath,
      absolutePath: null,
      title: title || "External Audio",
      artist: artist || "Unknown Artist",
      album: album || "External Source"
    };
    return `/api/v1/media/artwork?track=${encodeURIComponent(cached.token)}`;
  }

  void fetchRemoteArtworkForAlbum({ artist, album }).catch(() => null);
  return null;
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

function normalizeProviderLyricsBody(candidate, lyricsBody, provider, fallback = {}) {
  if (!lyricsBody) return null;

  if (typeof lyricsBody.lyrics === "string" && !lyricsBody.plainLyrics && !lyricsBody.syncedLyrics) {
    const plainLyrics = lyricsBody.lyrics.trim();
    if (!plainLyrics) return null;
    return {
      trackName: fallback.title ?? candidate.title,
      artistName: fallback.artist ?? candidate.artist,
      albumName: fallback.album ?? candidate.album,
      duration: Number.isFinite(Number(candidate.durationMs)) ? Math.round(Number(candidate.durationMs) / 1000) : undefined,
      syncedLyrics: null,
      plainLyrics
    };
  }

  const hasLyrics = Boolean(normalizeMetadataValue(lyricsBody.plainLyrics) || normalizeMetadataValue(lyricsBody.syncedLyrics));
  if (!hasLyrics) return null;
  if ((lyricsBody.trackName || lyricsBody.title || lyricsBody.artistName || lyricsBody.artist) && !strictLyricsProviderMatch(candidate, lyricsBody)) {
    return null;
  }

  return {
    ...lyricsBody,
    trackName: lyricsBody.trackName ?? lyricsBody.title ?? fallback.title ?? candidate.title,
    artistName: lyricsBody.artistName ?? lyricsBody.artist ?? fallback.artist ?? candidate.artist,
    albumName: lyricsBody.albumName ?? lyricsBody.album ?? fallback.album ?? candidate.album,
    provider
  };
}

async function fetchLyricsBodyFromLrclib(candidate) {
  const useStrictMatch = shouldUseStrictLyricsProviderMatch(candidate);
  const acceptsLyricsBody = (lyricsBody) => (
    lyricsBody && (!useStrictMatch || strictLyricsProviderMatch(candidate, lyricsBody))
  );
  const lookupTimeoutMs = Math.max(1_500, LRCLIB_TIMEOUT_MS);

  const fetchSearchVariant = async (params) => {
    const searchUrl = new URL("/api/search", LRCLIB_BASE_URL);
    for (const [key, value] of Object.entries(params)) {
      if (value) searchUrl.searchParams.set(key, value);
    }
    const { response, body } = await fetchJsonWithTimeout(searchUrl, {
      timeoutMs: lookupTimeoutMs
    });
    if (response.status === 404) {
      return { lyricsBody: null, noMatch: true };
    }
    if (!response.ok) {
      throw new Error(`LRCLIB search failed: ${response.status}`);
    }
    return {
      lyricsBody: Array.isArray(body) ? body.find(acceptsLyricsBody) ?? null : null,
      noMatch: true
    };
  };

  const fetchExactLyrics = async (params = {}) => {
    const exactUrl = new URL("/api/get", LRCLIB_BASE_URL);
    exactUrl.searchParams.set("track_name", params.title ?? candidate.title);
    if (params.artist ?? candidate.artist) exactUrl.searchParams.set("artist_name", params.artist ?? candidate.artist);
    if (params.album ?? candidate.album) exactUrl.searchParams.set("album_name", params.album ?? candidate.album);
    if (candidate.durationMs) exactUrl.searchParams.set("duration", String(Math.round(candidate.durationMs / 1000)));

    const exactResponse = await fetchJsonWithTimeout(exactUrl, {
      timeoutMs: lookupTimeoutMs
    });

    if (exactResponse.response.ok) {
      return {
        lyricsBody: acceptsLyricsBody(exactResponse.body) ? exactResponse.body : null,
        noMatch: true
      };
    }
    if (exactResponse.response.status !== 404) {
      throw new Error(`LRCLIB request failed: ${exactResponse.response.status}`);
    }
    return { lyricsBody: null, noMatch: true };
  };

  const titleVariants = buildLyricsTitleLookupValues(candidate.title);
  const artistVariants = buildLyricsArtistLookupValues(candidate.artist);
  const primaryTitle = titleVariants[0] ?? candidate.title;
  const primaryArtist = artistVariants[0] ?? candidate.artist;
  const lookupTasks = [];
  const lookupKeys = new Set();
  const pushLookupTask = (kind, params) => {
    const key = `${kind}:${JSON.stringify(params)}`;
    if (lookupKeys.has(key)) return;
    lookupKeys.add(key);
    lookupTasks.push(kind === "exact"
      ? () => fetchExactLyrics(params)
      : () => fetchSearchVariant(params));
  };

  for (const title of titleVariants.slice(0, 2)) {
    if (primaryArtist) pushLookupTask("exact", { title, artist: primaryArtist });
    pushLookupTask("exact", { title });
  }

  for (const title of titleVariants.slice(0, 2)) {
    if (primaryArtist) pushLookupTask("search", { track_name: title, artist_name: primaryArtist });
    if (artistVariants[1]) pushLookupTask("search", { track_name: title, artist_name: artistVariants[1] });
    pushLookupTask("search", { track_name: title });
  }

  if (primaryTitle && primaryArtist) {
    pushLookupTask("search", { q: `${primaryTitle} ${primaryArtist}` });
  }

  const fetchLookupBatch = async (tasks) => {
    const results = await Promise.all(tasks.map(async (task) => {
      try {
        return await task();
      } catch (error) {
        return { lyricsBody: null, noMatch: false, error };
      }
    }));
    const matched = results.find((result) => result.lyricsBody)?.lyricsBody;
    if (matched) return matched;
    if (results.some((result) => result.noMatch)) return null;
    const error = results.find((result) => result.error)?.error;
    if (error) throw error;
    return null;
  };

  const lyricsBody = await fetchLookupBatch(lookupTasks);
  return lyricsBody ? normalizeProviderLyricsBody(candidate, lyricsBody, "lrclib") : null;
}

function buildLyricsRequestVariants(candidate) {
  const titleVariants = buildLyricsTitleLookupValues(candidate.title).slice(0, 2);
  const artistVariants = buildLyricsArtistLookupValues(candidate.artist).slice(0, 2);
  const variants = [];
  const seen = new Set();

  for (const title of titleVariants) {
    for (const artist of artistVariants) {
      if (!title || !artist) continue;
      const key = `${normalizeLyricsMatchValue(artist)}|${normalizeLyricsMatchValue(title)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      variants.push({ title, artist, album: candidate.album });
    }
  }
  return variants;
}

async function fetchLyricsBodyFromLyricsOvh(candidate) {
  for (const variant of buildLyricsRequestVariants(candidate)) {
    const lyricsUrl = new URL(
      `/v1/${encodeURIComponent(variant.artist)}/${encodeURIComponent(variant.title)}`,
      LYRICS_OVH_BASE_URL
    );
    const { response, body } = await fetchJsonWithTimeout(lyricsUrl, {
      timeoutMs: Math.max(1_500, LRCLIB_TIMEOUT_MS)
    });
    if (response.status === 404) continue;
    if (!response.ok) throw new Error(`lyrics.ovh request failed: ${response.status}`);
    const normalized = normalizeProviderLyricsBody(candidate, body, "lyricsovh", variant);
    if (normalized) return normalized;
  }
  return null;
}

function renderLyricsCustomUrl(template, variant, candidate) {
  const values = {
    title: variant.title,
    artist: variant.artist,
    album: variant.album ?? "",
    duration: Number.isFinite(Number(candidate.durationMs)) ? String(Math.round(Number(candidate.durationMs) / 1000)) : ""
  };
  let rendered = template;
  for (const [key, value] of Object.entries(values)) {
    rendered = rendered.replaceAll(`{${key}}`, encodeURIComponent(value));
  }
  return rendered;
}

function parseLyricsCustomAuthHeader() {
  const separatorIndex = LYRICS_CUSTOM_AUTH_HEADER.indexOf(":");
  if (separatorIndex <= 0) return null;
  const key = LYRICS_CUSTOM_AUTH_HEADER.slice(0, separatorIndex).trim();
  const value = LYRICS_CUSTOM_AUTH_HEADER.slice(separatorIndex + 1).trim();
  return key && value ? { [key]: value } : null;
}

async function fetchLyricsBodyFromCustom(candidate) {
  if (!LYRICS_CUSTOM_URL_TEMPLATE.trim()) return null;
  const headers = parseLyricsCustomAuthHeader();
  const seenUrls = new Set();
  for (const variant of buildLyricsRequestVariants(candidate)) {
    const renderedUrl = renderLyricsCustomUrl(LYRICS_CUSTOM_URL_TEMPLATE, variant, candidate);
    if (!renderedUrl || seenUrls.has(renderedUrl)) continue;
    seenUrls.add(renderedUrl);
    const { response, body } = await fetchJsonWithTimeout(new URL(renderedUrl), {
      timeoutMs: Math.max(1_500, LRCLIB_TIMEOUT_MS),
      ...(headers ? { headers } : {})
    });
    if (response.status === 404) continue;
    if (!response.ok) throw new Error(`custom lyrics request failed: ${response.status}`);
    const normalized = normalizeProviderLyricsBody(candidate, body, "custom", variant);
    if (normalized) return normalized;
  }
  return null;
}

async function fetchLyricsBodyFromProvider(provider, candidate) {
  switch (provider) {
    case "lrclib":
      return await fetchLyricsBodyFromLrclib(candidate);
    case "lyricsovh":
      return await fetchLyricsBodyFromLyricsOvh(candidate);
    case "custom":
      return await fetchLyricsBodyFromCustom(candidate);
    default:
      return null;
  }
}

function buildLyricsStateFromProviderBody(candidate, lyricsBody, provider) {
  const recognitionProvider = candidate.recognitionMode === "fingerprint"
    ? candidate.recognitionProvider ?? provider
    : provider;

  if (!lyricsBody) {
    return buildLyricsState({
      status: "not_found",
      trackKey: candidate.trackKey,
      title: candidate.title,
      artist: candidate.artist || null,
      message: `Lyrics unavailable from ${lyricsProviderChainLabel()}`
    });
  }

  const providerDurationMs = providerLyricsDurationMs(lyricsBody);
  const candidateDurationMs = Number(candidate.durationMs);
  const candidateWithProviderDuration = {
    ...candidate,
    durationMs: shouldUseProviderLyricsDuration(candidate, providerDurationMs)
      ? providerDurationMs
      : Number.isFinite(candidateDurationMs)
        ? candidateDurationMs
        : providerDurationMs ?? candidate.durationMs
  };
  const { synced, timingStrategy, lines } = buildDisplayableLyricsLines(lyricsBody, candidateWithProviderDuration);

  if (lines.length === 0) {
    return buildLyricsState({
      status: "not_found",
      trackKey: candidate.trackKey,
      title: candidate.title,
      artist: candidate.artist || null,
      recognitionProvider,
      message: `Lyrics unavailable from ${lyricsProviderChainLabel()}`
    });
  }

  return buildLyricsState({
    status: "ready",
    trackKey: candidate.trackKey,
    title: normalizeMetadataValue(lyricsBody?.trackName ?? candidate.title) || candidate.title,
    artist: normalizeMetadataValue(lyricsBody?.artistName ?? candidate.artist) || candidate.artist || null,
    recognitionProvider,
    synced,
    timingStrategy,
    lines,
    message: null
  });
}

async function fetchLyricsFromProvider(candidate) {
  let sawNoMatch = false;
  let firstError = null;

  for (const provider of LYRICS_PROVIDER_CHAIN) {
    try {
      const lyricsBody = await fetchLyricsBodyFromProvider(provider, candidate);
      if (lyricsBody) return buildLyricsStateFromProviderBody(candidate, lyricsBody, provider);
      sawNoMatch = true;
    } catch (error) {
      firstError ??= error;
    }
  }

  if (!sawNoMatch && firstError) throw firstError;
  return buildLyricsStateFromProviderBody(candidate, null, LYRICS_PROVIDER_CHAIN.at(-1) ?? "lrclib");
}

function getProxyInputCaptureCommand(source) {
  return source === "airplay" ? AIRPLAY_CAPTURE_COMMAND : BLUETOOTH_CAPTURE_COMMAND;
}

function getProxyInputCaptureDurationSeconds(source) {
  return source === "airplay" ? AIRPLAY_CAPTURE_DURATION_SECONDS : BLUETOOTH_CAPTURE_DURATION_SECONDS;
}

function getProxyInputRecognitionSettleMs(source) {
  return source === "airplay" ? AIRPLAY_RECOGNITION_SETTLE_MS : BLUETOOTH_RECOGNITION_SETTLE_MS;
}

async function captureBluetoothSample(source = "bluetooth") {
  const captureCommand = getProxyInputCaptureCommand(source);
  const sourceLabel = getProxyInputLabel(source);
  if (!captureCommand.trim()) {
    throw new Error(`${sourceLabel} capture command is not configured`);
  }

  const durationSeconds = Math.max(1, Math.round(getProxyInputCaptureDurationSeconds(source)));
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
      throw new Error(`${sourceLabel} capture returned no audio`);
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

  const cacheKey = buildLyricsCacheKey(candidate);

  if (!force && lyricsInFlight.has(cacheKey)) {
    const inFlightResult = await lyricsInFlight.get(cacheKey);
    return decorateLyricsState(inFlightResult, candidate);
  }

  const pending = (async () => {
    try {
      const result = await fetchLyricsFromProvider(candidate);
      lyricsResultCache.set(cacheKey, result);
      lyricsRetryAfter.delete(cacheKey);
      return result;
    } catch (error) {
      const fallback = buildLyricsState({
        status: "error",
        trackKey: candidate.trackKey,
        title: candidate.title,
        artist: candidate.artist || null,
        message: lyricsErrorMessage(error)
      });
      lyricsResultCache.set(cacheKey, fallback);
      lyricsRetryAfter.set(cacheKey, Date.now() + LYRICS_ERROR_BACKOFF_MS);
      return fallback;
    } finally {
      lyricsInFlight.delete(cacheKey);
    }
  })();

  lyricsInFlight.set(cacheKey, pending);
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

  const cacheKey = buildLyricsCacheKey(candidate);
  const cached = lyricsResultCache.get(cacheKey);
  const retryAfter = lyricsRetryAfter.get(cacheKey) ?? 0;
  const shouldForce = options.force === true;
  const canRetry = shouldForce || retryAfter <= Date.now();

  if (cached && cached.status !== "error" && !shouldForce) {
    return updateLyricsState(decorateLyricsState(cached, candidate));
  }

  if (cached && cached.status === "error" && !canRetry) {
    return updateLyricsState(decorateLyricsState(cached, candidate));
  }

  if (lyricsInFlight.has(cacheKey) && !shouldForce) {
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

  const settleUntil = bluetoothRecognitionSession.connectedAtMs + getProxyInputRecognitionSettleMs(source);
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
      recognitionMode: candidate.recognitionMode ?? null,
      recognitionProvider: candidate.recognitionProvider ?? null,
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

  let shouldRememberLibraryTrack = false;
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
  if (mockActiveSource === "mpd" && ["next", "previous"].includes(String(action.type))) {
    shouldRememberLibraryTrack = true;
  }
  if (shouldRememberLibraryTrack) {
    await rememberCurrentLocalLibraryTrackSource();
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
      const requestedLocalTrackPath = normalizeLocalLibraryStateTrackPath(action.localTrackPath);
      const rememberedSource = getCachedRememberedAudioSource();
      const shouldRestoreRememberedTrack = mockActiveSource !== "mpd" || rememberedSource?.target !== "mpd";
      const rememberedLocalTrackPath = requestedLocalTrackPath ?? (shouldRestoreRememberedTrack ? getCachedRememberedLocalTrackPath() : null);
      if (rememberedLocalTrackPath) {
        const track = await findLocalAudioLibraryTrackByPath(rememberedLocalTrackPath);
        if (!track) {
          if (requestedLocalTrackPath) {
            throw new Error(`Unknown local library track: ${action.localTrackPath}`);
          }
          clearMockLocalQueue();
        } else {
          setMockLocalQueue([track], 0);
          elapsedSeconds = 0;
        }
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
      suppressExternalHandoffAutoArm();
      mockArmedSource = null;
      clearActiveMpcRadioStationCache();
      stopSceneAudio();
      resetBluetoothRecognitionSession();
      await enforceConnectionGate("mpd");
      if (action.localTrackPath) {
        await releaseKioskAudioOutputForMpd("mpd");
        await switchToLocalLibraryTrack(action.localTrackPath);
      } else {
        const currentSource = getCurrentMpcSourceId();
        const rememberedSource = getCachedRememberedAudioSource();
        const shouldRestoreRememberedTrack = currentSource !== "mpd" || rememberedSource?.target !== "mpd";
        const rememberedLocalTrackPath = shouldRestoreRememberedTrack
          ? getCachedRememberedLocalTrackPath()
          : null;
        await releaseKioskAudioOutputForMpd("mpd");
        if (rememberedLocalTrackPath) {
          try {
            await switchToLocalLibraryTrack(rememberedLocalTrackPath);
            return;
          } catch {
            // Fall back to the default MPD queue when remembered local media was removed.
          }
        }
        await switchToMpdSource();
      }
      return;
    case "audio":
      clearActiveMpcRadioStationCache();
      stopSceneAudio();
      resetBluetoothRecognitionSession();
      await switchToAudioSource();
      mockArmedSource = "audio";
      return;
    case "radio":
      suppressExternalHandoffAutoArm();
      mockArmedSource = null;
      stopSceneAudio();
      resetBluetoothRecognitionSession();
      await enforceConnectionGate("radio");
      await primeMpcRadioSourceCache(action);
      await releaseKioskAudioOutputForMpd("radio");
      await switchToRadioSource(action, { fallbackOnFailure: Boolean(action.radioStationId) });
      return;
    case "scene":
      clearActiveMpcRadioStationCache();
      resetBluetoothRecognitionSession();
      await switchToSceneSource(action);
      mockArmedSource = "scene";
      return;
    case "spotify":
      allowExternalHandoffAutoArm();
      clearActiveMpcRadioStationCache();
      stopSceneAudio();
      resetBluetoothRecognitionSession();
      await switchToSpotifySource();
      mockArmedSource = "spotify";
      return;
    case "bluetooth":
      allowExternalHandoffAutoArm();
      clearActiveMpcRadioStationCache();
      stopSceneAudio();
      resetBluetoothRecognitionSession();
      await switchToBluetoothSource();
      mockArmedSource = "bluetooth";
      return;
    case "airplay":
      allowExternalHandoffAutoArm();
      clearActiveMpcRadioStationCache();
      stopSceneAudio();
      resetBluetoothRecognitionSession();
      await switchToAirplaySource();
      mockArmedSource = "airplay";
      return;
    case "upnp":
      allowExternalHandoffAutoArm();
      clearActiveMpcRadioStationCache();
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

async function applySourceSwitch(action, { syncSceneSoundState = true, rememberSource = true } = {}) {
  sourceSwitchInFlightCount += 1;
  try {
    const target = String(action?.target ?? "");
    const localTrackPathBeforeSwitch = rememberSource && target !== "mpd"
      ? await resolveCurrentOrRememberedLocalLibraryTrackPath()
      : null;
    const radioStationIdBeforeSwitch = rememberSource && !normalizeRememberedRadioStationId(action.radioStationId)
      ? await resolveCurrentOrRememberedRadioStationId()
      : null;
    const switchAction = {
      ...action,
      ...(localTrackPathBeforeSwitch ? { localTrackPath: action.localTrackPath ?? localTrackPathBeforeSwitch } : {}),
      ...(radioStationIdBeforeSwitch ? { radioStationId: radioStationIdBeforeSwitch } : {})
    };
    const syncSceneBeforeSwitch = syncSceneSoundState && target !== "scene";
    if (syncSceneBeforeSwitch) {
      await syncRoomSceneSoundForSource(target);
    }

    if (API_MODE === "mpc") {
      await applyMpcSourceSwitch(switchAction);
    } else {
      await applyMockSourceSwitch(switchAction);
    }

    if (syncSceneSoundState && !syncSceneBeforeSwitch) {
      await syncRoomSceneSoundForSource(target);
    }

    if (rememberSource) {
      await rememberAudioSourceSwitch(switchAction);
    }
  } finally {
    sourceSwitchInFlightCount = Math.max(0, sourceSwitchInFlightCount - 1);
  }
}

function getRoomModePreset(mode) {
  return ROOM_MODE_PRESETS[normalizeRoomMode(mode)];
}

function sceneVideoBelongsToRoomMode(video, mode) {
  return normalizeRoomMode(mode) !== "hifi"
    && Boolean(video?.src)
    && Array.isArray(video.roomModes)
    && video.roomModes.includes(normalizeRoomMode(mode));
}

async function isSceneVideoUsableForRoomMode(sceneVideoId, mode) {
  const id = String(sceneVideoId ?? "").trim();
  if (!id) return false;

  const normalizedMode = normalizeRoomMode(mode);
  if (normalizedMode === "hifi") {
    return id === ROOM_MODE_PRESETS.hifi.sceneVideoId;
  }

  try {
    const catalog = await getAmbientBackgroundVideosPayload();
    const video = catalog.videos.find((entry) => entry.id === id);
    if (!video?.src) return false;

    const modeHasSceneVideos = catalog.videos.some((entry) => sceneVideoBelongsToRoomMode(entry, normalizedMode));
    return modeHasSceneVideos ? sceneVideoBelongsToRoomMode(video, normalizedMode) : true;
  } catch {
    return true;
  }
}

async function resolveRoomModeSceneVideoId(current, mode, explicitSceneVideoId) {
  const normalizedMode = normalizeRoomMode(mode);
  const preset = getRoomModePreset(normalizedMode);
  if (normalizedMode === "hifi") return preset.sceneVideoId;

  const rememberedSceneVideoId = asPlainObject(current?.sceneVideoByMode)[normalizedMode];
  const sameModeSceneVideoId = current?.mode === normalizedMode ? current.sceneVideoId : null;
  const candidates = [
    explicitSceneVideoId,
    rememberedSceneVideoId,
    sameModeSceneVideoId,
    preset.sceneVideoId
  ];

  for (const candidate of candidates) {
    const sceneVideoId = String(candidate ?? "").trim();
    if (sceneVideoId && await isSceneVideoUsableForRoomMode(sceneVideoId, normalizedMode)) {
      return sceneVideoId;
    }
  }

  return preset.sceneVideoId;
}

async function findSceneVideoForRoomMode(sceneVideoId, mode) {
  const catalog = await getAmbientBackgroundVideosPayload();
  const id = String(sceneVideoId ?? "").trim();
  const video = catalog.videos.find((entry) => entry.id === id);
  if (!video?.src) {
    throw new Error("set_scene requires a known sceneVideoId");
  }

  const normalizedMode = normalizeRoomMode(mode);
  const modeHasSceneVideos = normalizedMode !== "hifi"
    && catalog.videos.some((entry) => sceneVideoBelongsToRoomMode(entry, normalizedMode));
  if (modeHasSceneVideos && !sceneVideoBelongsToRoomMode(video, normalizedMode)) {
    throw new Error(`set_scene requires a ${normalizedMode} sceneVideoId`);
  }

  return video;
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
      const brightnessTask = applySystemAction({ type: "brightness_set", value: experience.brightnessPercent });
      if (API_MODE === "mpc") {
        void brightnessTask.catch(() => {
          // Room-mode changes should not wait on noisy or unsupported DDC/CI paths.
        });
      } else {
        await brightnessTask;
      }
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
      const rememberedCurrent = rememberSceneVideoForRoomMode(current);
      const sceneVideoId = await resolveRoomModeSceneVideoId(rememberedCurrent, mode, action.sceneVideoId);
      next = {
        ...rememberedCurrent,
        mode,
        phase: "idle",
        presetId: preset.presetId,
        sceneVideoId,
        sceneVideoByMode: rememberSceneVideoForRoomMode(rememberedCurrent, mode, sceneVideoId).sceneVideoByMode,
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
      const rememberedCurrent = rememberSceneVideoForRoomMode(current);
      const sceneVideoId = await resolveRoomModeSceneVideoId(rememberedCurrent, mode, action.sceneVideoId);
      next = {
        ...rememberedCurrent,
        mode,
        phase: "preparing",
        presetId: preset.presetId,
        sceneVideoId,
        sceneVideoByMode: rememberSceneVideoForRoomMode(rememberedCurrent, mode, sceneVideoId).sceneVideoByMode,
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
      const rememberedCurrent = rememberSceneVideoForRoomMode(current);
      const sceneVideoId = await resolveRoomModeSceneVideoId(rememberedCurrent, mode, action.sceneVideoId);
      next = {
        ...rememberedCurrent,
        mode,
        phase: "active",
        presetId: preset.presetId,
        sceneVideoId,
        sceneVideoByMode: rememberSceneVideoForRoomMode(rememberedCurrent, mode, sceneVideoId).sceneVideoByMode,
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
    case "set_scene": {
      if (current.mode === "hifi") {
        throw new Error("set_scene is not available in Hi-Fi mode");
      }
      const sceneVideo = await findSceneVideoForRoomMode(action.sceneVideoId, current.mode);
      next = rememberSceneVideoForRoomMode({
        ...current,
        sceneVideoId: sceneVideo.id
      }, current.mode, sceneVideo.id);
      applyScene = current.sceneSoundEnabled;
      applyLevels = false;
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

async function runWebModeCommand(action, providerId = "") {
  if (!WEB_MODE_COMMAND.trim()) return;
  const command = providerId
    ? `${WEB_MODE_COMMAND} ${shellQuote(action)} ${shellQuote(providerId)}`
    : `${WEB_MODE_COMMAND} ${shellQuote(action)}`;
  await runCommand(command, { allowFailure: false, timeout: 45_000, includeStdoutOnFailure: true });
}

function webModeProviderLabel(providerId) {
  return WEB_MODE_PROVIDERS.find((provider) => provider.id === providerId)?.label ?? "Explore";
}

function formatWebModeCommandError(error, action, providerId = "") {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const firstLine = raw.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
  if (/Explore is already switching/i.test(raw)) return "Explore is already switching";
  if (action === "open") {
    if (/did not open|did not appear|timed out|SIGKILL|Command failed|\[tikpal-web-mode\]/i.test(raw)) {
      return `${webModeProviderLabel(providerId)} did not open`;
    }
    return firstLine.slice(0, 160) || `${webModeProviderLabel(providerId)} did not open`;
  }
  if (action === "close") return firstLine.slice(0, 160) || "Explore close failed";
  if (action === "keyboard") return firstLine.slice(0, 160) || "Keyboard open failed";
  return firstLine.slice(0, 160) || "Explore action failed";
}

async function pauseTikpalForWebMode() {
  try {
    await applyPlaybackActionForCurrentBackend({ type: "pause" });
  } catch {
    // Explore is a browser wrapper; a failed pause should not block opening the login/player page.
  }

  try {
    const room = await readRoomExperienceState();
    if (room.sceneSoundEnabled) {
      await applyRoomExperienceAction({
        type: "set_scene_sound",
        sceneSoundEnabled: false,
        sceneVideoId: room.sceneVideoId
      });
    }
  } catch {
    // The source truth remains owned by the normal room experience refresh.
  }
}

async function applyWebModeAction(action) {
  const type = String(action?.type ?? "").trim().toLowerCase();
  if (type === "close") {
    try {
      await runWebModeCommand("close");
      await writeWebModeRuntimeState({ activeProvider: null, lastError: null });
    } catch (error) {
      await writeWebModeRuntimeState({ lastError: formatWebModeCommandError(error, "close") });
    }
    return await buildWebModeState();
  }

  if (type === "keyboard") {
    try {
      await runWebModeCommand("keyboard");
      await writeWebModeRuntimeState({ lastError: null });
    } catch (error) {
      const message = formatWebModeCommandError(error, "keyboard");
      await writeWebModeRuntimeState({ lastError: message });
      throw new Error(message);
    }
    return await buildWebModeState();
  }

  if (type !== "open") {
    throw new Error("Explore action type must be open, close, or keyboard");
  }

  const providerId = normalizeWebModeProviderId(action.provider);
  await pauseTikpalForWebMode();
  try {
    await runWebModeCommand("open", providerId);
    await writeWebModeRuntimeState({ activeProvider: providerId, lastError: null });
  } catch (error) {
    const message = formatWebModeCommandError(error, "open", providerId);
    await writeWebModeRuntimeState({ lastError: message });
    throw new Error(message);
  }
  return await buildWebModeState();
}

async function patchWebModeSettings(patch) {
  const next = {};
  if (typeof patch?.proxyEnabled === "boolean") {
    next.proxyEnabled = patch.proxyEnabled;
  }
  if (Object.prototype.hasOwnProperty.call(patch ?? {}, "proxyUrl")) {
    next.proxyUrl = normalizeWebModeProxyUrl(patch.proxyUrl);
  }
  await writeWebModeSettings(next);
  return await buildWebModeState();
}

async function testWebModeProxy() {
  const settings = await readWebModeSettings();
  if (!settings.proxyEnabled) {
    return { ok: true, message: "Explore proxy is disabled", proxyUrl: settings.proxyUrl };
  }
  const proxyUrl = normalizeWebModeProxyUrl(settings.proxyUrl);
  if (!WEB_MODE_PROXY_TEST_NETWORK) {
    return { ok: true, message: "Proxy URL format accepted", proxyUrl };
  }
  try {
    await runCommand(
      `command -v curl >/dev/null 2>&1 && curl -I -L -m 5 -x ${shellQuote(proxyUrl)} ${shellQuote(WEB_MODE_PROXY_TEST_URL)} >/dev/null`,
      { allowFailure: false, timeout: 7000 }
    );
    return { ok: true, message: "Proxy connectivity check passed", proxyUrl };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Proxy connectivity check failed", proxyUrl };
  }
}

function buildPlaybackMutationRefreshOptions(action) {
  const isAirplayTransport = API_MODE === "mpc"
    && isCurrentMpcSourceAirplay()
    && isAirplayTransportPlaybackAction(action);
  const isBluetoothTransport = API_MODE === "mpc"
    && isCurrentMpcSourceBluetooth()
    && isBluetoothTransportPlaybackAction(action);
  const isRadioTransport = API_MODE === "mpc"
    && isCurrentMpcSourceRadio()
    && isRadioStationTransportAction(action);
  return {
    includeOutputVolumeStatus: action?.type === "volume_set",
    includeSourceRuntimeStatus: isAirplayTransport || isBluetoothTransport || isRadioTransport,
    forceFreshAirplayMetadata: isAirplayTransport
  };
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
      sources: state.audio.sources,
      rememberedSource: state.audio.rememberedSource ?? null
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
  await findRemoteSceneVideo(action.sceneVideoId);
  await applyRoomExperienceAction({
    type: "set_scene",
    sceneVideoId: action.sceneVideoId
  });
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
  const refreshOptions = {};

  switch (type) {
    case "playback.play_pause":
      await applyPlaybackActionForCurrentBackend({ type: "play_pause" });
      Object.assign(refreshOptions, buildPlaybackMutationRefreshOptions({ type: "play_pause" }));
      break;
    case "playback.play":
      await applyPlaybackActionForCurrentBackend({ type: "play" });
      Object.assign(refreshOptions, buildPlaybackMutationRefreshOptions({ type: "play" }));
      break;
    case "playback.pause":
      await applyPlaybackActionForCurrentBackend({ type: "pause" });
      Object.assign(refreshOptions, buildPlaybackMutationRefreshOptions({ type: "pause" }));
      break;
    case "playback.next":
      await applyPlaybackActionForCurrentBackend({ type: "next" });
      Object.assign(refreshOptions, buildPlaybackMutationRefreshOptions({ type: "next" }));
      break;
    case "playback.previous":
      await applyPlaybackActionForCurrentBackend({ type: "previous" });
      Object.assign(refreshOptions, buildPlaybackMutationRefreshOptions({ type: "previous" }));
      break;
    case "playback.seek":
      await applyPlaybackActionForCurrentBackend({ type: "seek", value: requireRemoteNumber(action.value, "playback.seek") });
      Object.assign(refreshOptions, buildPlaybackMutationRefreshOptions({ type: "seek" }));
      break;
    case "playback.play_mode_set":
      await applyPlaybackActionForCurrentBackend({ type: "play_mode_set", mode: normalizePlaybackMode(action.playbackMode ?? action.mode) });
      Object.assign(refreshOptions, buildPlaybackMutationRefreshOptions({ type: "play_mode_set" }));
      break;
    case "volume_set":
      await applyPlaybackActionForCurrentBackend({ type: "volume_set", value: requireRemoteNumber(action.value, "volume_set") });
      refreshOptions.includeOutputVolumeStatus = true;
      break;
    case "source.set": {
      const target = requireRemoteSourceTarget(action.target);
      await applySourceSwitch({
        target,
        radioStationId: action.radioStationId,
        localTrackPath: action.localTrackPath
      });
      refreshOptions.includeSourceRuntimeStatus = target === "mpd" || target === "radio" || COMMAND_HANDOFF_SOURCE_TARGETS.has(target);
      refreshOptions.includeOutputVolumeStatus = target === "scene" || COMMAND_HANDOFF_SOURCE_TARGETS.has(target);
      break;
    }
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
      const state = await getTikpalState({ forceFreshAirplayMetadata: true });
      scheduleLyricsRecognition(state, { force: true });
      refreshOptions.forceFreshAirplayMetadata = state.playback?.source === "airplay";
      break;
    }
    default:
      throw new Error(`Unsupported remote action: ${type || "missing type"}`);
  }

  await refreshTikpalStateSnapshotAfterMutation(refreshOptions);
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

    if (request.method === "POST" && url.pathname === "/api/v1/kiosk/heartbeat") {
      sendJson(response, 200, setKioskHeartbeat(await readJson(request)));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/kiosk/heartbeat") {
      sendJson(response, 200, buildKioskHeartbeatStatus());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/web-mode/state") {
      sendJson(response, 200, await buildWebModeState());
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v1/web-mode/actions") {
      sendJson(response, 200, await applyWebModeAction(await readJson(request)));
      return;
    }

    if (request.method === "PATCH" && url.pathname === "/api/v1/web-mode/settings") {
      sendJson(response, 200, await patchWebModeSettings(await readJson(request)));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v1/web-mode/proxy-test") {
      sendJson(response, 200, await testWebModeProxy());
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

    if (request.method === "GET" && url.pathname === "/api/v1/scene/context") {
      sendJson(response, 200, await buildSceneContextPayload(url.searchParams));
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

    if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/api/v1/media/radio-logo") {
      const logo = await resolveRadioLogo(url.searchParams.get("stationId"));
      if (!logo) {
        sendJson(response, 404, { error: "NOT_FOUND", path: url.pathname });
        return;
      }

      sendBinary(response, 200, logo.mimeType, request.method === "HEAD" ? null : await readFile(logo.absolutePath), {
        "Cache-Control": "public, max-age=86400"
      });
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
      sendJson(response, 200, await refreshTikpalStateSnapshotAfterMutation(buildPlaybackMutationRefreshOptions(action)));
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
      const state = await getTikpalState({ forceFreshAirplayMetadata: true });
      const lyrics = scheduleLyricsRecognition(state, { force: true });
      sendJson(response, 200, lyrics);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v1/audio/source") {
      const action = await readJson(request);
      await applySourceSwitch(action);
      sendJson(response, 200, await refreshTikpalStateSnapshotAfterMutation({
        includeSourceRuntimeStatus: action?.target === "mpd" || action?.target === "radio" || COMMAND_HANDOFF_SOURCE_TARGETS.has(action?.target),
        includeOutputVolumeStatus: action?.target === "scene" || COMMAND_HANDOFF_SOURCE_TARGETS.has(action?.target)
      }));
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
    startupPlaybackPolicyPromise = applyStartupPlaybackPolicy().finally(() => {
      startupPlaybackPolicyPromise = null;
      startTikpalStateSnapshotCollector();
    });
    void startupPlaybackPolicyPromise;
  }
});

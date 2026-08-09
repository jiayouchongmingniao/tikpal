import http from "node:http";
import { execFile, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { chmod, copyFile, mkdir, open, readFile, readdir, stat, statfs, unlink, writeFile } from "node:fs/promises";
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
const MPC_SEEK_TIMEOUT_MS = parseEnvPositiveInteger(process.env.TIKPAL_MPC_SEEK_TIMEOUT_MS, 10_000);
const MPD_DEFAULT_QUEUE_PATH = process.env.TIKPAL_MPD_DEFAULT_QUEUE_PATH ?? "Codex";
const MPD_STARTUP_VOLUME = Number(process.env.TIKPAL_MPD_STARTUP_VOLUME ?? 30);
const MPD_RECOVERY_COMMAND = process.env.TIKPAL_MPD_RECOVERY_COMMAND ?? "";
const MPD_RECOVERY_TIMEOUT_MS = parseEnvPositiveInteger(process.env.TIKPAL_MPD_RECOVERY_TIMEOUT_MS, 20_000);
const MPD_RECOVERY_SETTLE_MS = parseEnvPositiveInteger(process.env.TIKPAL_MPD_RECOVERY_SETTLE_MS, 2500);
const AUDIO_OUTPUT_RESTORE_MPC_TIMEOUT_MS = parseEnvPositiveInteger(process.env.TIKPAL_AUDIO_OUTPUT_RESTORE_MPC_TIMEOUT_MS, 1000);
const AUDIO_OUTPUT_RESTORE_ATTEMPTS = parseEnvPositiveInteger(process.env.TIKPAL_AUDIO_OUTPUT_RESTORE_ATTEMPTS, 2);
const AUDIO_OUTPUT_RESTORE_SETTLE_MS = parseEnvPositiveInteger(process.env.TIKPAL_AUDIO_OUTPUT_RESTORE_SETTLE_MS, 200);
const MPD_LIBRARY_UPDATE_WAIT_MS = parseEnvPositiveInteger(process.env.TIKPAL_MPD_LIBRARY_UPDATE_WAIT_MS, 8000);
const MPD_LIBRARY_UPDATE_POLL_MS = parseEnvPositiveInteger(process.env.TIKPAL_MPD_LIBRARY_UPDATE_POLL_MS, 350);
const MPD_LOG_PATH = process.env.TIKPAL_MPD_LOG_PATH ?? "/var/log/mpd/log";
const STARTUP_SCENE_SOUND_ENABLED = parseEnvBoolean(process.env.TIKPAL_STARTUP_SCENE_SOUND_ENABLED ?? "1");
const MPD_MUSIC_ROOT = process.env.TIKPAL_MPD_MUSIC_ROOT ?? "/var/lib/mpd/music";
const APP_VERSION = process.env.TIKPAL_APP_VERSION ?? "0.1.0";
const REQUESTED_RENDERER = (process.env.TIKPAL_RENDERER ?? "media").toLowerCase();
const REQUESTED_KIOSK_WINDOW = process.env.TIKPAL_KIOSK_WINDOW ?? "2560x720";
const LIBRARY_SCAN_COMMAND = process.env.TIKPAL_LIBRARY_SCAN_COMMAND ?? "";
const SYSTEM_REBOOT_COMMAND = process.env.TIKPAL_SYSTEM_REBOOT_COMMAND ?? "sudo -n systemctl --no-wall --no-block reboot";
const SYSTEM_SHUTDOWN_COMMAND = process.env.TIKPAL_SYSTEM_SHUTDOWN_COMMAND ?? "sudo -n systemctl --no-wall --no-block poweroff";
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
const TURZX_BRIGHTNESS_COMMAND = process.env.TIKPAL_TURZX_BRIGHTNESS_COMMAND ?? "";
const TURZX_BRIGHTNESS_TIMEOUT_MS = parseEnvPositiveInteger(process.env.TIKPAL_TURZX_BRIGHTNESS_TIMEOUT_MS, 2500);
const RUNTIME_DRM_MODE_ENABLED = parseEnvBoolean(process.env.TIKPAL_RUNTIME_DRM_MODE_ENABLED ?? "1");
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
const UPNP_METADATA_COMMAND = process.env.TIKPAL_UPNP_METADATA_COMMAND ?? "";
const ROONBRIDGE_SERVICE = process.env.TIKPAL_ROONBRIDGE_SERVICE ?? "roonbridge.service";
const ROONBRIDGE_READY_COMMAND = process.env.TIKPAL_ROONBRIDGE_READY_COMMAND ?? "./deploy/moode/tikpal-roonbridge-state.sh ready";
const ROONBRIDGE_ACTIVE_COMMAND = process.env.TIKPAL_ROONBRIDGE_ACTIVE_COMMAND ?? "./deploy/moode/tikpal-roonbridge-state.sh active";
const ROONBRIDGE_ENABLE_COMMAND = process.env.TIKPAL_ROONBRIDGE_ENABLE_COMMAND ?? "./deploy/moode/tikpal-roonbridge-state.sh enable";
const ROONBRIDGE_DISABLE_COMMAND = process.env.TIKPAL_ROONBRIDGE_DISABLE_COMMAND ?? "./deploy/moode/tikpal-roonbridge-state.sh disable";
const ROONBRIDGE_LABEL_COMMAND = process.env.TIKPAL_ROONBRIDGE_LABEL_COMMAND ?? "./deploy/moode/tikpal-roonbridge-state.sh label";
const MULTIROOM_ECOSYSTEM_IDS = ["roon", "lyrion", "tikpal", "music_assistant"];
const MULTIROOM_ECOSYSTEM_CONFIGS = {
  roon: {
    sourceId: "roonbridge",
    label: "Roon Bridge",
    service: process.env.TIKPAL_MULTIROOM_ROON_SERVICE ?? ROONBRIDGE_SERVICE,
    readyCommand: process.env.TIKPAL_MULTIROOM_ROON_READY_COMMAND ?? ROONBRIDGE_READY_COMMAND,
    activeCommand: process.env.TIKPAL_MULTIROOM_ROON_ACTIVE_COMMAND ?? ROONBRIDGE_ACTIVE_COMMAND,
    enableCommand: process.env.TIKPAL_MULTIROOM_ROON_ENABLE_COMMAND ?? ROONBRIDGE_ENABLE_COMMAND,
    disableCommand: process.env.TIKPAL_MULTIROOM_ROON_DISABLE_COMMAND ?? ROONBRIDGE_DISABLE_COMMAND,
    labelCommand: process.env.TIKPAL_MULTIROOM_ROON_LABEL_COMMAND ?? ROONBRIDGE_LABEL_COMMAND,
    controlReason: "Control Roon playback from the Roon app"
  },
  lyrion: {
    sourceId: "lyrion",
    label: "Lyrion",
    service: process.env.TIKPAL_MULTIROOM_LYRION_SERVICE ?? "squeezelite.service",
    readyCommand: process.env.TIKPAL_MULTIROOM_LYRION_READY_COMMAND ?? "./deploy/moode/tikpal-multiroom-state.sh lyrion ready",
    activeCommand: process.env.TIKPAL_MULTIROOM_LYRION_ACTIVE_COMMAND ?? "./deploy/moode/tikpal-multiroom-state.sh lyrion active",
    enableCommand: process.env.TIKPAL_MULTIROOM_LYRION_ENABLE_COMMAND ?? "./deploy/moode/tikpal-multiroom-state.sh lyrion enable",
    disableCommand: process.env.TIKPAL_MULTIROOM_LYRION_DISABLE_COMMAND ?? "./deploy/moode/tikpal-multiroom-state.sh lyrion disable",
    labelCommand: process.env.TIKPAL_MULTIROOM_LYRION_LABEL_COMMAND ?? "./deploy/moode/tikpal-multiroom-state.sh lyrion label",
    controlReason: "Control Lyrion playback from the sender"
  },
  tikpal: {
    sourceId: "tikpal_multiroom",
    label: "Tikpal Multi-room",
    service: process.env.TIKPAL_MULTIROOM_TIKPAL_SERVICE ?? "tikpal-multiroom.service",
    readyCommand: process.env.TIKPAL_MULTIROOM_TIKPAL_READY_COMMAND ?? "./deploy/moode/tikpal-multiroom-state.sh tikpal ready",
    activeCommand: process.env.TIKPAL_MULTIROOM_TIKPAL_ACTIVE_COMMAND ?? "./deploy/moode/tikpal-multiroom-state.sh tikpal active",
    enableCommand: process.env.TIKPAL_MULTIROOM_TIKPAL_ENABLE_COMMAND ?? "./deploy/moode/tikpal-multiroom-state.sh tikpal enable",
    disableCommand: process.env.TIKPAL_MULTIROOM_TIKPAL_DISABLE_COMMAND ?? "./deploy/moode/tikpal-multiroom-state.sh tikpal disable",
    labelCommand: process.env.TIKPAL_MULTIROOM_TIKPAL_LABEL_COMMAND ?? "./deploy/moode/tikpal-multiroom-state.sh tikpal label",
    controlReason: "Control Tikpal Multi-room playback from the group controller"
  },
  music_assistant: {
    sourceId: "music_assistant",
    label: "Music Assistant",
    placeholder: true,
    controlReason: "Music Assistant support is coming soon"
  }
};
const MULTIROOM_SOURCE_TO_ECOSYSTEM = Object.fromEntries(
  MULTIROOM_ECOSYSTEM_IDS
    .map((id) => [MULTIROOM_ECOSYSTEM_CONFIGS[id]?.sourceId, id])
    .filter(([sourceId]) => Boolean(sourceId))
);
const AUDIO_OUTPUT_PROFILE_COMMAND = process.env.TIKPAL_AUDIO_OUTPUT_PROFILE_COMMAND ?? "./deploy/moode/tikpal-audio-output-profile.sh %PROFILE%";
const MPD_BITPERFECT_PROFILE_COMMAND = process.env.TIKPAL_MPD_BITPERFECT_PROFILE_COMMAND ?? "./deploy/moode/tikpal-mpd-bitperfect-profile.sh %MODE%";
const OUTPUT_VOLUME_GET_COMMAND = process.env.TIKPAL_OUTPUT_VOLUME_GET_COMMAND ?? "amixer get PCM";
const OUTPUT_VOLUME_SET_COMMAND = process.env.TIKPAL_OUTPUT_VOLUME_SET_COMMAND ?? "amixer sset PCM %VALUE%%";
const OUTPUT_VOLUME_SET_COMMAND_CONFIGURED = Object.prototype.hasOwnProperty.call(process.env, "TIKPAL_OUTPUT_VOLUME_SET_COMMAND")
  && OUTPUT_VOLUME_SET_COMMAND.trim();
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
const HIFI_RUNTIME_RECOVERY_COOLDOWN_MS = parseEnvPositiveInteger(process.env.TIKPAL_HIFI_RUNTIME_RECOVERY_COOLDOWN_MS, 10_000);
const HIFI_RUNTIME_RECOVERY_MUTATION_QUIET_MS = parseEnvPositiveInteger(process.env.TIKPAL_HIFI_RUNTIME_RECOVERY_MUTATION_QUIET_MS, 8000);
const KIOSK_HEARTBEAT_STALE_MS_RAW = Number(process.env.TIKPAL_KIOSK_HEARTBEAT_STALE_MS ?? 30_000);
const KIOSK_HEARTBEAT_STALE_MS = Number.isFinite(KIOSK_HEARTBEAT_STALE_MS_RAW) && KIOSK_HEARTBEAT_STALE_MS_RAW >= 1_000
  ? KIOSK_HEARTBEAT_STALE_MS_RAW
  : 30_000;
const KIOSK_HEARTBEAT_HIDDEN_STALE_MS_RAW = Number(process.env.TIKPAL_KIOSK_HEARTBEAT_HIDDEN_STALE_MS ?? 120_000);
const KIOSK_HEARTBEAT_HIDDEN_STALE_MS = Number.isFinite(KIOSK_HEARTBEAT_HIDDEN_STALE_MS_RAW)
  && KIOSK_HEARTBEAT_HIDDEN_STALE_MS_RAW >= KIOSK_HEARTBEAT_STALE_MS
  ? KIOSK_HEARTBEAT_HIDDEN_STALE_MS_RAW
  : Math.max(120_000, KIOSK_HEARTBEAT_STALE_MS);
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
const UPNP_CAPTURE_DURATION_SECONDS = Number(process.env.TIKPAL_UPNP_CAPTURE_DURATION_SECONDS ?? 6);
const BLUETOOTH_RECOGNITION_SETTLE_MS = Number(process.env.TIKPAL_BLUETOOTH_RECOGNITION_SETTLE_MS ?? 4000);
const AIRPLAY_RECOGNITION_SETTLE_MS = Number(process.env.TIKPAL_AIRPLAY_RECOGNITION_SETTLE_MS ?? 1000);
const UPNP_RECOGNITION_SETTLE_MS = Number(process.env.TIKPAL_UPNP_RECOGNITION_SETTLE_MS ?? 1000);
const BLUETOOTH_RECOGNITION_RETRY_MS = Number(process.env.TIKPAL_BLUETOOTH_RECOGNITION_RETRY_MS ?? 45000);
const BLUETOOTH_RECOGNITION_NOT_FOUND_RETRY_MS = Number(process.env.TIKPAL_BLUETOOTH_RECOGNITION_NOT_FOUND_RETRY_MS ?? 30000);
const UPNP_CAPTURE_COMMAND = process.env.TIKPAL_UPNP_CAPTURE_COMMAND ?? "";
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
const ITUNES_SEARCH_BASE_URL = process.env.TIKPAL_ITUNES_SEARCH_BASE_URL ?? "https://itunes.apple.com/search";
const REMOTE_METADATA_TIMEOUT_MS = Number(process.env.TIKPAL_REMOTE_METADATA_TIMEOUT_MS ?? 4500);
const LYRICS_ERROR_BACKOFF_MS = Number(process.env.TIKPAL_LYRICS_ERROR_BACKOFF_MS ?? 90000);
const SUPPORTED_LYRICS_PROVIDERS = new Set(["lrclib", "custom", "lyricsovh"]);
const LYRICS_PROVIDER_CHAIN = normalizeLyricsProviderChain(process.env.TIKPAL_LYRICS_PROVIDER_CHAIN ?? "lrclib,lyricsovh");
const LYRICS_PROVIDER_CACHE_VERSION = createHash("sha1")
  .update(JSON.stringify({
    chain: LYRICS_PROVIDER_CHAIN,
    lyricsOvhBaseUrl: LYRICS_OVH_BASE_URL,
    customUrlTemplate: LYRICS_CUSTOM_URL_TEMPLATE,
    matchNormalizer: "unicode-v2",
    externalDurationPolicy: "proxy-provider-duration-v1"
  }))
  .digest("hex")
  .slice(0, 12);
const BLUETOOTH_LYRICS_MIN_TIMED_DURATION_MS = 30_000;
const BLUETOOTH_LYRICS_DURATION_GRACE_MS = 2_000;
const BLUETOOTH_LYRICS_UNRELIABLE_DURATION_MS = Number(process.env.TIKPAL_BLUETOOTH_LYRICS_UNRELIABLE_DURATION_MS ?? 90_000);
const AIRPLAY_METADATA_POSITION_GRACE_MS = 30_000;
const AIRPLAY_LYRICS_UNRELIABLE_DURATION_MS = 45_000;
const REMOTE_MEDIA_CACHE_ROOT = resolve(process.cwd(), ".cache", "remote-media");
const REMOTE_ARTWORK_CACHE_DIR = resolve(REMOTE_MEDIA_CACHE_ROOT, "artwork");
const REMOTE_ARTWORK_INDEX_DIR = resolve(REMOTE_MEDIA_CACHE_ROOT, "artwork-index");
const LOCAL_LIBRARY_MANIFEST_PATH = process.env.TIKPAL_LOCAL_LIBRARY_MANIFEST_PATH
  ?? resolve(process.cwd(), "public", "assets", "music", "_metadata", "library_manifest.json");
const LOCAL_LIBRARY_ROOT = resolve(dirname(LOCAL_LIBRARY_MANIFEST_PATH), "..");
const USB_LIBRARY_ROOTS = parseEnvPathList(process.env.TIKPAL_USB_LIBRARY_ROOTS);
const USB_LIBRARY_AUTO_ROOTS = parseEnvPathList(process.env.TIKPAL_USB_LIBRARY_AUTO_ROOTS || "/media,/run/media");
const USB_LIBRARY_MPD_PREFIX = normalizeSafeRelativePath(process.env.TIKPAL_USB_LIBRARY_MPD_PREFIX ?? "USB") ?? "USB";
const USB_LIBRARY_MAX_TRACKS = parseEnvPositiveInteger(process.env.TIKPAL_USB_LIBRARY_MAX_TRACKS, 500);
const NAS_LIBRARY_ROOTS = parseEnvPathList(process.env.TIKPAL_NAS_LIBRARY_ROOTS);
const NAS_LIBRARY_MPD_PREFIX = normalizeSafeRelativePath(process.env.TIKPAL_NAS_LIBRARY_MPD_PREFIX ?? "NAS") ?? "NAS";
const NAS_LIBRARY_MAX_TRACKS = parseEnvPositiveInteger(process.env.TIKPAL_NAS_LIBRARY_MAX_TRACKS, 500);
const USB_LIBRARY_SCAN_COMMAND = process.env.TIKPAL_USB_LIBRARY_SCAN_COMMAND ?? (API_MODE === "mpc" ? "./deploy/moode/tikpal-usb-library-sync.sh" : "");
const USB_LIBRARY_AUTO_UPDATE = parseEnvBoolean(process.env.TIKPAL_USB_LIBRARY_AUTO_UPDATE ?? "0");
const USB_LIBRARY_AUTO_UPDATE_MIN_MS = parseEnvPositiveInteger(process.env.TIKPAL_USB_LIBRARY_AUTO_UPDATE_MIN_MS, 15_000);
const LOCAL_LIBRARY_IMPORTS_DIR_NAME = normalizeSafeRelativePath(process.env.TIKPAL_LOCAL_LIBRARY_IMPORTS_DIR_NAME ?? "USB Imports") ?? "USB Imports";
const LIBRARY_AUDIO_PROBE_ENABLED = parseEnvBoolean(process.env.TIKPAL_LIBRARY_AUDIO_PROBE_ENABLED ?? "1");
const LIBRARY_AUDIO_PROBE_TIMEOUT_MS = parseEnvPositiveInteger(process.env.TIKPAL_LIBRARY_AUDIO_PROBE_TIMEOUT_MS, 1800);
const LOCAL_PLAYLIST_INDEX_PATH = resolve(LOCAL_LIBRARY_ROOT, "_metadata", "playlist_index.json");
const LOCAL_PLAYLIST_ROOT = resolve(LOCAL_LIBRARY_ROOT, "_playlists");
const MUSIC_LIBRARY_STATE_PATH = resolve(process.env.TIKPAL_MUSIC_LIBRARY_STATE_PATH ?? resolve(process.cwd(), ".tikpal", "music-library-state.json"));
const ROOM_EXPERIENCE_STATE_PATH = resolve(process.env.TIKPAL_ROOM_EXPERIENCE_STATE_PATH ?? resolve(process.cwd(), ".tikpal", "room-experience-state.json"));
const AUDIO_VOLUME_STATE_PATH = resolve(process.env.TIKPAL_AUDIO_VOLUME_STATE_PATH ?? resolve(process.cwd(), ".tikpal", "audio-volume-state.json"));
const AUDIO_SOURCE_MEMORY_STATE_PATH = resolve(process.env.TIKPAL_AUDIO_SOURCE_MEMORY_STATE_PATH ?? resolve(process.cwd(), ".tikpal", "audio-source-memory.json"));
const PLAYBACK_MODE_STATE_PATH = resolve(process.env.TIKPAL_PLAYBACK_MODE_STATE_PATH ?? resolve(process.cwd(), ".tikpal", "playback-mode-state.json"));
const UI_PREFERENCES_STATE_PATH = resolve(process.env.TIKPAL_UI_PREFERENCES_STATE_PATH ?? resolve(process.cwd(), ".tikpal", "ui-preferences.json"));
const NAS_SOURCES_STATE_PATH = resolve(process.env.TIKPAL_NAS_SOURCES_STATE_PATH ?? resolve(process.cwd(), ".tikpal", "nas-sources.json"));
const NAS_CREDENTIALS_DIR = resolve(process.env.TIKPAL_NAS_CREDENTIALS_DIR ?? resolve(process.cwd(), ".tikpal", "nas-credentials"));
const NAS_MOUNT_ROOT = resolve(process.env.TIKPAL_NAS_MOUNT_ROOT ?? "/mnt/tikpal-nas");
const NAS_MPD_ENTRY_ROOT = resolve(process.env.TIKPAL_NAS_MPD_ENTRY_ROOT ?? resolve(MPD_MUSIC_ROOT, NAS_LIBRARY_MPD_PREFIX));
const NAS_AUTO_MOUNT = parseEnvBoolean(process.env.TIKPAL_NAS_AUTO_MOUNT ?? (API_MODE === "mpc" ? "1" : "0"));
const NAS_AUTO_MOUNT_DELAY_MS = parseEnvPositiveInteger(process.env.TIKPAL_NAS_AUTO_MOUNT_DELAY_MS, 1500);
const NAS_AUTO_MOUNT_ATTEMPTS = Math.max(1, Math.min(5, parseEnvPositiveInteger(process.env.TIKPAL_NAS_AUTO_MOUNT_ATTEMPTS, 3)));
const NAS_AUTO_MOUNT_RETRY_DELAY_MS = parseEnvPositiveInteger(process.env.TIKPAL_NAS_AUTO_MOUNT_RETRY_DELAY_MS, 12_000);
const NAS_MOUNT_COMMAND = process.env.TIKPAL_NAS_MOUNT_COMMAND ?? "";
const NAS_UNMOUNT_COMMAND = process.env.TIKPAL_NAS_UNMOUNT_COMMAND ?? "";
const NAS_DISCOVERY_COMMAND = process.env.TIKPAL_NAS_DISCOVERY_COMMAND ?? "";
const NAS_DISCOVERY_HINTS = process.env.TIKPAL_NAS_DISCOVERY_HINTS ?? "";
const WEB_MODE_SETTINGS_PATH = resolve(process.env.TIKPAL_WEB_MODE_SETTINGS_PATH ?? resolve(process.cwd(), ".tikpal", "web-mode-settings.json"));
const WEB_MODE_STATE_PATH = resolve(process.env.TIKPAL_WEB_MODE_STATE_PATH ?? resolve(process.cwd(), ".tikpal", "web-mode-state.json"));
const WEB_MODE_HANDOFF_STATE_PATH = resolve(process.env.TIKPAL_WEB_MODE_HANDOFF_STATE_PATH ?? resolve(process.cwd(), ".tikpal", "web-mode-handoff.json"));
const MULTIROOM_AUDIO_STATE_PATH = resolve(process.env.TIKPAL_MULTIROOM_AUDIO_STATE_PATH ?? resolve(process.cwd(), ".tikpal", "multiroom-audio.json"));
const MULTIROOM_HANDOFF_STATE_PATH = resolve(process.env.TIKPAL_MULTIROOM_HANDOFF_STATE_PATH ?? resolve(process.cwd(), ".tikpal", "multiroom-handoff.json"));
const ROONBRIDGE_HANDOFF_STATE_PATH = resolve(process.env.TIKPAL_ROONBRIDGE_HANDOFF_STATE_PATH ?? resolve(process.cwd(), ".tikpal", "roonbridge-handoff.json"));
const MPD_SHUFFLE_MONITOR_INTERVAL_MS = parseEnvPositiveInteger(process.env.TIKPAL_MPD_SHUFFLE_MONITOR_INTERVAL_MS, 500);
const MPD_SHUFFLE_RECENT_HISTORY_SIZE = parseEnvPositiveInteger(process.env.TIKPAL_MPD_SHUFFLE_RECENT_HISTORY_SIZE, 4);
const MPD_SHUFFLE_POST_JUMP_SETTLE_MS = parseEnvPositiveInteger(process.env.TIKPAL_MPD_SHUFFLE_POST_JUMP_SETTLE_MS, 1500);
const WEB_MODE_COMMAND = process.env.TIKPAL_WEB_MODE_COMMAND ?? (API_MODE === "mpc" ? "./deploy/chromium/tikpal-web-mode.sh" : "");
const WEB_MODE_COMMAND_TIMEOUT_MS = Number(process.env.TIKPAL_WEB_MODE_COMMAND_TIMEOUT_MS ?? 45_000);
const WEB_MODE_OPEN_COMMAND_TIMEOUT_MS = Number(process.env.TIKPAL_WEB_MODE_OPEN_COMMAND_TIMEOUT_MS ?? 110_000);
const WEB_MODE_PROXY_TEST_URL = process.env.TIKPAL_WEB_MODE_PROXY_TEST_URL ?? "https://open.spotify.com/";
const WEB_MODE_DEFAULT_PROXY_URL = process.env.TIKPAL_WEB_MODE_DEFAULT_PROXY_URL ?? "http://127.0.0.1:7897";
const WEB_MODE_PROVIDER_TEXT_SCALE_VALUES = [1, 1.1, 1.2];
function normalizeWebModeProviderTextScale(value, fallback = null) {
  const numeric = typeof value === "number" ? value : Number(String(value ?? "").trim());
  const rounded = Math.round(numeric * 100) / 100;
  const allowed = WEB_MODE_PROVIDER_TEXT_SCALE_VALUES.find((candidate) => Math.abs(candidate - rounded) < 0.001);
  if (allowed !== undefined) return allowed;
  if (fallback !== null) return fallback;
  throw new Error("Explore provider text scale must be 1.00, 1.10, or 1.20");
}
const WEB_MODE_DEFAULT_PROVIDER_TEXT_SCALE = normalizeWebModeProviderTextScale(process.env.TIKPAL_WEB_MODE_PROVIDER_TEXT_SCALE ?? "1.10", 1.1);
const WEB_MODE_PROXY_TEST_NETWORK = parseEnvBoolean(process.env.TIKPAL_WEB_MODE_PROXY_TEST_NETWORK ?? "0");
const WEB_MODE_KEYBOARD_STICKY_PROTECT_MS = parseEnvPositiveInteger(process.env.TIKPAL_WEB_MODE_KEYBOARD_STICKY_PROTECT_MS, 60_000);
const UI_LOCALE_INPUT_METHODS = {
  en: "keyboard-us",
  "zh-CN": "pinyin",
  de: "keyboard-de",
  it: "keyboard-it",
  ko: "hangul",
  ja: "anthy",
  es: "keyboard-es"
};
const UI_LOCALES = new Set(Object.keys(UI_LOCALE_INPUT_METHODS));
const UI_INPUT_METHOD_SYNC_COMMAND = process.env.TIKPAL_UI_INPUT_METHOD_SYNC_COMMAND
  ?? (API_MODE === "mpc" ? "if [ -f /usr/share/onboard/scripts/tikpalImeToggle.py ]; then TIKPAL_APP_DIR=%APP_DIR% TIKPAL_FONT_THEME=%FONT_THEME% python3 /usr/share/onboard/scripts/tikpalImeToggle.py --set-locale %LOCALE%; fi" : "");
const UI_KEYBOARD_VISUAL_SYNC_COMMAND = process.env.TIKPAL_UI_KEYBOARD_VISUAL_SYNC_COMMAND
  ?? (API_MODE === "mpc" ? "if [ -f /usr/share/onboard/scripts/tikpalImeToggle.py ]; then TIKPAL_APP_DIR=%APP_DIR% TIKPAL_FONT_THEME=%FONT_THEME% python3 /usr/share/onboard/scripts/tikpalImeToggle.py --sync; fi" : "");
const FONT_THEMES = new Set(["system", "hardware", "precision", "sans", "serif", "mono"]);
const DEFAULT_FONT_THEME = "system";
const AUDIO_OUTPUT_PROFILES = new Set(["pure", "everyday", "sleep", "custom"]);
const DEFAULT_AUDIO_OUTPUT_PROFILE = "everyday";
const DEFAULT_AUDIO_OUTPUT_CUSTOM_SETTINGS = {
  pureDirect: false,
  volumeNormalization: true,
  smoothTransition: true,
  automaticSampleRate: true,
  dsdMode: false,
  playbackStability: true
};
const MPD_BITPERFECT_MODES = new Set(["standard", "strict"]);
const DEFAULT_MPD_BITPERFECT_MODE = "standard";
const SLEEP_AUDIO_OUTPUT_VOLUME_LIMIT_PERCENT = 45;
const SLEEP_AUDIO_OUTPUT_AUTO_STOP_MS = 60 * 60_000;
const DISPLAY_SLEEP_MINUTES = [5, 10, 15, 30, 60];
const DEFAULT_DISPLAY_SLEEP_MINUTES = 10;
const DISPLAY_SLEEP_STYLES = new Set(["meteor_shower", "clock", "now_playing", "starfield", "signal"]);
const DEFAULT_DISPLAY_SLEEP_STYLE = "meteor_shower";
const LOCAL_LIBRARY_COVER_COLUMNS = ["cover_relative_path", "cover_path", "album_art_relative_path", "artwork_relative_path"];
const LOCAL_LIBRARY_COVER_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];
const USB_LIBRARY_AUDIO_EXTENSIONS = new Set([".aac", ".aif", ".aiff", ".alac", ".flac", ".m4a", ".mp3", ".ogg", ".opus", ".wav", ".wma"]);
const USB_LIBRARY_SKIPPED_MOUNT_NAMES = new Set(["boot", "bootfs", "root", "rootfs"]);
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
const NAS_AUTH_MODES = new Set(["guest", "password"]);
const NAS_STATUS_VALUES = new Set(["ready", "offline", "checking", "check_setup", "manual"]);
const NAS_SMB_VERSIONS = ["3.0", "2.1", "2.0"];
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
  "explore.open",
  "explore.close",
  "explore.proxy_set",
  "lyrics.refresh"
];
const HIFI_EQ_PRESETS = [
  { id: "flat", label: "Flat", intent: "Reference response", hifiVisualPresetId: "spectrum-bars" },
  { id: "warm", label: "Warm", intent: "Gentle low-mid lift", hifiVisualPresetId: "waveform" },
  { id: "vocal", label: "Vocal", intent: "Clearer midrange presence", hifiVisualPresetId: "dual-vu" }
];
const RADIO_RANDOM_CATEGORY_ID = "random";
const RADIO_REAL_CATEGORY_ORDER = ["focus", "calm", "sleep", "jazz", "classical", "news", "hifi", "blues", "rock", "world", "electronic", "podcast"];
const RADIO_CATEGORY_ORDER = [...RADIO_REAL_CATEGORY_ORDER, RADIO_RANDOM_CATEGORY_ID];
const RADIO_CATEGORY_LABELS = {
  focus: "Focus",
  calm: "Calm",
  sleep: "Sleep",
  jazz: "Jazz",
  classical: "Classical",
  news: "News",
  hifi: "Hi-Fi",
  blues: "Blues",
  rock: "Rock",
  world: "World",
  electronic: "Electronic",
  podcast: "Podcast",
  random: "Random"
};
const RADIO_LOGO_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];
const MOCK_RADIO_LOGO_URL = "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22120%22%20height%3D%22120%22%3E%3Crect%20width%3D%22120%22%20height%3D%22120%22%20fill%3D%22%231f2937%22%2F%3E%3Ccircle%20cx%3D%2260%22%20cy%3D%2260%22%20r%3D%2238%22%20fill%3D%22%23d6b761%22%2F%3E%3Ctext%20x%3D%2260%22%20y%3D%2268%22%20font-family%3D%22Arial%22%20font-size%3D%2228%22%20font-weight%3D%22700%22%20text-anchor%3D%22middle%22%20fill%3D%22%231f2937%22%3ER%3C%2Ftext%3E%3C%2Fsvg%3E";
const RADIO_LOGO_ALIASES = new Map([
  ["Focus - Soma FM Cliqhop", "Soma FM - Cliqhop.jpg"],
  ["Focus - Soma FM Beat Blender", "Soma FM - Beat Blender.jpg"],
  ["Focus - Soma FM Groove Salad", "Soma FM - Groove Salad.jpg"],
  ["Calm - Positively Meditation", "Positively Meditation.jpg"],
  ["Calm - Soma FM Fluid", "Soma FM - Fluid.jpg"],
  ["Calm - Soma FM Synphaera", "Soma FM - Synphaera.jpg"],
  ["Sleep - Ambient Sleeping Pill", "Ambient Sleeping Pill.jpg"],
  ["Sleep - Soma FM Drone Zone", "Soma FM - Drone Zone.jpg"],
  ["Sleep - Soma FM Deep Space One", "Soma FM - Deep Space One.jpg"],
  ["Jazz - Jazz24", "Jazz24.jpg"],
  ["Jazz - The Jazz Groove", "The Jazz Groove.jpg"],
  ["Jazz - Linn Jazz", "Linn Jazz.jpg"],
  ["Blues - 1.FM Blues Radio", "1.FM - Blues Radio.jpg"],
  ["Blues - WDCB Chicago Jazz & Blues", "WDCB Chicago FM 90.9 - Jazz & Blues.jpg"],
  ["Blues - WWOZ New Orleans", "WWOZ New Orleans FM 90.7 - Various Artists.jpg"],
  ["Rock - Radio Paradise Rock", "Radio Paradise - Rock.jpg"],
  ["Rock - Radio Caroline", "Radio Caroline.jpg"],
  ["Rock - Soma FM Digitalis", "Soma FM - Digitalis.jpg"],
  ["World - Radio Paradise World", "Radio Paradise - World.jpg"],
  ["World - Hi On Line World", "Hi On Line - World.jpg"],
  ["World - Soma FM Suburbs of Goa", "Soma FM - Suburbs of Goa.jpg"],
  ["Electronic - FluxFM ElectroFlux", "FluxFM - ElectroFlux.jpg"],
  ["Electronic - FluxFM Techno Underground", "FluxFM - Techno Underground.jpg"],
  ["Electronic - Soma FM PopTron", "Soma FM - PopTron.jpg"],
  ["Podcast - BBC Radio 4", "BBC Radio 4 FM (320K).jpg"],
  ["Podcast - France Culture Live", "France Culture Live.jpg"],
  ["Podcast - NPR Program Stream", "NPR Program Stream.jpg"],
  ["Classical - BR-Klassik", "BR-Klassik.jpg"],
  ["Classical - NPO Klassiek", "NPO Klassiek.jpg"],
  ["Classical - Linn Classical", "Linn Classical.jpg"],
  ["News - NPR Program Stream", "NPR Program Stream.jpg"],
  ["News - DR P1", "DR P1.jpg"],
  ["News - Radio SRF 4 News", "Radio SRF 4 News.jpg"],
  ["Hi-Fi - Radio Paradise FLAC", "Radio Paradise - Main Mix.jpg"],
  ["Hi-Fi - Naim Radio", "Naim Radio.jpg"],
  ["Hi-Fi - Linn Radio", "Linn Radio.jpg"],
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

function parseEnvPathList(value) {
  return String(value ?? "")
    .split(/[,:]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
const libraryAudioInfoCache = new Map();
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
let upnpMpdReleasedAtMs = 0;
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
let hifiRuntimeRecoveryQuietUntilMs = 0;
let webModeOpenInFlight = false;
let webModeCloseInFlight = false;
let webModeClosePromise = null;
let sourceSwitchInFlightCount = 0;
let mpdRecoveryPromise = null;
let mpcRadioWeakNetworkRecoveryPromise = null;
let mpcRadioWeakNetworkState = null;
let mpcRadioCatalogReadyCache = false;
let mpcRadioCatalogCountCache = 0;
let activeMpcRadioStationCache = null;
let multiroomMpdReleaseAtMs = 0;
let audioOutputProfileAutoStopTimer = null;
let audioSourceMemoryStateCache = null;
let airplayDirectMetadataRefreshPromise = null;
let airplayDirectMetadataRefreshAtMs = 0;
let usbLibraryScanPromise = null;
let lastUsbLibraryAutoUpdateCheckAt = 0;
let lastUsbLibraryAutoUpdateSignature = "";
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
  multiroom: {
    ecosystems: {
      roon: {
        id: "roon",
        enabled: false,
        ready: false,
        active: false,
        serviceActive: false,
        label: "Roon Bridge",
        lastError: null,
        updatedAt: new Date().toISOString()
      },
      lyrion: {
        id: "lyrion",
        enabled: false,
        ready: false,
        active: false,
        serviceActive: false,
        label: "Lyrion",
        lastError: null,
        updatedAt: new Date().toISOString()
      },
      tikpal: {
        id: "tikpal",
        enabled: false,
        ready: false,
        active: false,
        serviceActive: false,
        label: "Tikpal Multi-room",
        lastError: null,
        updatedAt: new Date().toISOString()
      },
      music_assistant: {
        id: "music_assistant",
        enabled: false,
        ready: false,
        active: false,
        serviceActive: false,
        label: "Music Assistant",
        lastError: "Coming soon",
        comingSoon: true,
        updatedAt: new Date().toISOString()
      }
    },
    activeEcosystemId: null,
    updatedAt: new Date().toISOString()
  },
  roonBridge: {
    enabled: false,
    ready: false,
    active: false,
    serviceActive: false,
    label: "Roon Bridge",
    lastError: null,
    updatedAt: new Date().toISOString()
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

function isHiddenPageHeartbeat(payload) {
  return String(payload?.visibility ?? "").toLowerCase() === "hidden";
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
    hiddenStaleMs: KIOSK_HEARTBEAT_HIDDEN_STALE_MS,
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
      ignoredReasons: [],
      thresholds,
      receivedAt: null,
      heartbeat: null
    };
  }

  const payload = asPlainObject(kioskHeartbeat.payload);
  const ageMs = now - kioskHeartbeat.receivedAtMs;
  const reasons = [];
  const ignoredReasons = [];
  const hiddenPageHeartbeat = isHiddenPageHeartbeat(payload);
  const staleThresholdMs = hiddenPageHeartbeat ? KIOSK_HEARTBEAT_HIDDEN_STALE_MS : KIOSK_HEARTBEAT_STALE_MS;
  if (ageMs > staleThresholdMs) {
    reasons.push("heartbeat-stale");
  } else if (hiddenPageHeartbeat && ageMs > KIOSK_HEARTBEAT_STALE_MS) {
    ignoredReasons.push("heartbeat-stale:hidden-page");
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
    if (hiddenPageHeartbeat) {
      ignoredReasons.push("event-loop-lag:hidden-page");
    } else {
      reasons.push("event-loop-lag");
    }
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
    ignoredReasons,
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
  const temperatureCelsius = Number(current.temperature_2m ?? current.temperature);
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
    temperatureCelsius: Number.isFinite(temperatureCelsius) ? Math.round(temperatureCelsius) : null,
    source: "ip_weather"
  };
}

function buildWeatherUrl(latitude, longitude, timeZone) {
  const url = new URL(SCENE_CONTEXT_WEATHER_URL);
  url.searchParams.set("latitude", latitude.toFixed(4));
  url.searchParams.set("longitude", longitude.toFixed(4));
  url.searchParams.set("current", "temperature_2m,weather_code,precipitation,rain,showers,snowfall");
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

function buildAudioState({ activeSource, armedSource = null, radioReady, radioActive, radioStations = [], audioSourceState, spotifyState, bluetoothState, airplayState, roonBridgeState, multiroomState, upnpState }) {
  audioSourceState = buildSourceRuntimeState(audioSourceState);
  spotifyState = buildSourceRuntimeState(spotifyState);
  bluetoothState = buildSourceRuntimeState(bluetoothState);
  airplayState = buildSourceRuntimeState(airplayState);
  multiroomState = buildDefaultMultiroomState(multiroomState ?? {
    ecosystems: {
      roon: {
        ...roonBridgeState,
        id: "roon"
      }
    },
    activeEcosystemId: roonBridgeState?.active ? "roon" : null
  });
  roonBridgeState = multiroomState.ecosystems.roon;
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
    ...["roon", "lyrion", "tikpal"].map((ecosystemId) => {
      const state = multiroomState.ecosystems[ecosystemId];
      const config = getMultiroomEcosystemConfig(ecosystemId);
      const sourceId = config?.sourceId ?? ecosystemId;
      const label = state?.label ?? config?.label ?? "Multi-room Audio";
      return {
        ...buildSourceSummary({
          id: sourceId,
          label,
          availability: state?.ready ? (state?.active ? "available" : "waiting") : "unavailable",
          active: activeSource === sourceId,
          controllability: "status-only",
          secondaryStatus: state?.active
            ? `Playing from ${label.replace(/\s*Bridge$/i, "")}.`
            : state?.ready
              ? `Start playback from ${label.replace(/\s*Bridge$/i, "")}.`
              : "Check setup."
        }),
        armed: state?.enabled || state?.serviceActive,
        connectionState: state?.active ? "connected" : state?.ready ? "armed" : "blocked",
        connectedLabel: state?.active ? label : null,
        advertisedLabel: label
      };
    }),
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

  const activeCurrentSource = sources.find((source) => source.active) ?? null;
  const preferredCurrentSource = !activeCurrentSource
    && armedSource
    && (armedSource === "scene" || armedSource === "audio" || armedSource === "spotify" || armedSource === "bluetooth" || armedSource === "airplay" || isMultiroomSourceId(armedSource) || armedSource === "upnp")
      ? sources.find((source) => source.id === armedSource)
      : null;

  return {
    currentSource:
      activeCurrentSource
      ?? preferredCurrentSource
      ?? sources.find((source) => source.id === armedSource)
      ?? sources[0],
    sources,
    rememberedSource: getCachedRememberedAudioSource()
  };
}

function promoteCurrentSourceConnectedFromPlaybackMetadata(audio, source) {
  if (!audio?.currentSource || audio.currentSource.id !== source) return audio;

  const fallbackLabel = source === "bluetooth"
    ? "Bluetooth audio"
    : source === "airplay"
      ? "AirPlay audio"
      : source === "upnp"
        ? "DLNA audio"
        : "External audio";
  const patchSource = (entry) => {
    if (entry.id !== source) return entry;
    const connectedLabel = entry.connectedLabel ?? null;
    return {
      ...entry,
      availability: "available",
      connectionState: "connected",
      connectedLabel,
      secondaryStatus: `${connectedLabel ?? fallbackLabel} connected`
    };
  };

  return {
    ...audio,
    currentSource: patchSource(audio.currentSource),
    sources: Array.isArray(audio.sources) ? audio.sources.map(patchSource) : audio.sources
  };
}

function demoteCurrentSourceToArmed(audio, source, secondaryStatus = null) {
  if (!audio?.currentSource || audio.currentSource.id !== source) return audio;

  const patchSource = (entry) => {
    if (entry.id !== source) return entry;
    return {
      ...entry,
      availability: entry.armed ? "waiting" : entry.availability,
      connectionState: entry.armed ? "armed" : "blocked",
      connectedLabel: null,
      secondaryStatus: secondaryStatus ?? entry.secondaryStatus
    };
  };

  return {
    ...audio,
    currentSource: patchSource(audio.currentSource),
    sources: Array.isArray(audio.sources) ? audio.sources.map(patchSource) : audio.sources
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
      albumArtUrl: activeRadio?.logoUrl ?? null,
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
    ["radio-1", "1.FM - Blues Radio", "http://radio.example/blues", "Blues", 192, "MP3", null, null, ["Blues"], "1.FM", "moode", 1],
    ["radio-500", "Focus - Soma FM Cliqhop", "http://radio.example/focus-cliqhop", "Focus, IDM, Downtempo, Study Beats", 128, "MP3", "focus", "Focus", ["IDM", "Downtempo"], "Soma FM", "tikpal", 500],
    ["radio-510", "Calm - Positively Meditation", "http://radio.example/calm-meditation", "Calm, Meditation, Healing", 128, "MP3", "calm", "Calm", ["Meditation", "Healing"], "Positivity Radio", "tikpal", 510],
    ["radio-520", "Sleep - Ambient Sleeping Pill", "http://radio.example/sleep-ambient", "Sleep, Ambient", 256, "MP3", "sleep", "Sleep", ["Ambient"], "Stereoscenic", "tikpal", 520],
    ["radio-530", "Jazz - Jazz24", "http://radio.example/jazz24", "Jazz", 256, "AAC", "jazz", "Jazz", [], "Jazz24.org", "tikpal", 530],
    ["radio-531", "Jazz - The Jazz Groove", "http://radio.example/the-jazz-groove", "Jazz", 128, "MP3", "jazz", "Jazz", [], "The Jazz Groove", "tikpal", 531],
    ["radio-532", "Jazz - Linn Jazz", "http://radio.example/linn-jazz", "Jazz", 320, "MP3", "jazz", "Jazz", [], "Linn", "tikpal", 532],
    ["radio-590", "Classical - BR-Klassik", "http://radio.example/br-klassik", "Classical", 192, "MP3", "classical", "Classical", [], "Bayern Radio", "tikpal", 590],
    ["radio-591", "Classical - NPO Klassiek", "http://radio.example/npo-klassiek", "Classical", 192, "MP3", "classical", "Classical", [], "NPO", "tikpal", 591],
    ["radio-592", "Classical - Linn Classical", "http://radio.example/linn-classical", "Classical", 320, "MP3", "classical", "Classical", [], "Linn", "tikpal", 592],
    ["radio-600", "News - NPR Program Stream", "http://radio.example/npr-news", "News, Public Radio, Talk", 128, "MP3", "news", "News", ["Public Radio", "Talk"], "NPR", "tikpal", 600],
    ["radio-601", "News - DR P1", "http://radio.example/dr-p1", "News, Talk", 128, "MP3", "news", "News", ["Talk"], "DR", "tikpal", 601],
    ["radio-602", "News - Radio SRF 4 News", "http://radio.example/srf-news", "News, Current Affairs", 128, "MP3", "news", "News", ["Current Affairs"], "SRF", "tikpal", 602],
    ["radio-610", "Hi-Fi - Radio Paradise FLAC", "http://radio.example/hifi-rp", "Hi-Fi, Eclectic", 900, "FLAC", "hifi", "Hi-Fi", ["Eclectic"], "Radio Paradise", "tikpal", 610],
    ["radio-611", "Hi-Fi - Naim Radio", "http://radio.example/naim-radio", "Hi-Fi, Eclectic", 320, "AAC", "hifi", "Hi-Fi", ["Eclectic"], "Naim", "tikpal", 611],
    ["radio-612", "Hi-Fi - Linn Radio", "http://radio.example/linn-radio", "Hi-Fi, Eclectic", 320, "MP3", "hifi", "Hi-Fi", ["Eclectic"], "Linn", "tikpal", 612],
    ["radio-540", "Blues - 1.FM Blues Radio", "http://radio.example/blues", "Blues", 192, "MP3", "blues", "Blues", [], "1.FM", "tikpal", 540],
    ["radio-541", "Blues - WDCB Chicago Jazz & Blues", "http://radio.example/wdcb", "Blues, Jazz", 128, "MP3", "blues", "Blues", ["Jazz"], "DuPage College", "tikpal", 541],
    ["radio-542", "Blues - WWOZ New Orleans", "http://radio.example/wwoz", "Blues, Jazz, Funk", 128, "MP3", "blues", "Blues", ["Jazz", "Funk"], "WWOZ", "tikpal", 542],
    ["radio-550", "Rock - Radio Paradise Rock", "http://radio.example/rp-rock", "Rock", 900, "FLAC", "rock", "Rock", [], "Radio Paradise", "tikpal", 550],
    ["radio-551", "Rock - Radio Caroline", "http://radio.example/radio-caroline", "Rock, Classic Rock", 96, "MP3", "rock", "Rock", ["Classic Rock"], "Radio Caroline", "tikpal", 551],
    ["radio-552", "Rock - Soma FM Digitalis", "http://radio.example/digitalis", "Rock, Indie", 128, "AAC", "rock", "Rock", ["Indie"], "Soma FM", "tikpal", 552],
    ["radio-560", "World - Radio Paradise World", "http://radio.example/rp-world", "World, World Music", 900, "FLAC", "world", "World", [], "Radio Paradise", "tikpal", 560],
    ["radio-561", "World - Hi On Line World", "http://radio.example/hionline-world", "World, World Music", 320, "MP3", "world", "World", [], "Hi.Fine", "tikpal", 561],
    ["radio-562", "World - Soma FM Suburbs of Goa", "http://radio.example/suburbs-of-goa", "World, World Music, Desi", 128, "AAC", "world", "World", ["Desi"], "Soma FM", "tikpal", 562],
    ["radio-570", "Electronic - FluxFM ElectroFlux", "http://radio.example/electroflux", "Electronic, Pop", 256, "MP3", "electronic", "Electronic", ["Pop"], "FluxFM", "tikpal", 570],
    ["radio-571", "Electronic - FluxFM Techno Underground", "http://radio.example/techno-underground", "Electronic, Techno", 256, "MP3", "electronic", "Electronic", ["Techno"], "FluxFM", "tikpal", 571],
    ["radio-572", "Electronic - Soma FM PopTron", "http://radio.example/poptron", "Electronic, Electro-Pop", 128, "AAC", "electronic", "Electronic", ["Electro-Pop"], "Soma FM", "tikpal", 572],
    ["radio-580", "Podcast - BBC Radio 4", "http://radio.example/bbc-radio-4", "Podcast, Spoken Word, Talk", 96, "AAC-LC", "podcast", "Podcast", ["Spoken Word", "Talk"], "BBC", "tikpal", 580],
    ["radio-581", "Podcast - France Culture Live", "http://radio.example/france-culture", "Podcast, Spoken Word, Current Affairs", 128, "MP3", "podcast", "Podcast", ["Spoken Word"], "Radio France", "tikpal", 581],
    ["radio-582", "Podcast - NPR Program Stream", "http://radio.example/npr", "Podcast, Public Radio, Talk", 128, "MP3", "podcast", "Podcast", ["Public Radio", "Talk"], "NPR", "tikpal", 582]
  ].map(([id, label, uri, genre, bitrateKbps, codec, category, categoryLabel, tags, broadcaster, catalogSource, sortOrder]) => (
    buildRadioStationSummary({
      id,
      label,
      uri,
      genre,
      bitrateKbps,
      codec,
      category,
      categoryLabel,
      tags,
      broadcaster,
      logoUrl: catalogSource === "tikpal" ? MOCK_RADIO_LOGO_URL : null,
      catalogSource,
      sortOrder,
      secondaryStatus: [
        categoryLabel,
        broadcaster,
        bitrateKbps ? `${bitrateKbps} kbps` : "",
        codec
      ].filter(Boolean).join(" · ") || "Radio preset",
      active: mockActiveSource === "radio" && mockActiveRadioStationId === id
    })
  ));
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
      maxBuffer: options.maxBuffer ?? 1024 * 256,
      env: options.env ? { ...process.env, ...options.env } : process.env
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
const NAS_SEEK_UNAVAILABLE_REASON = "NAS playback does not support reliable seeking";
const MULTIROOM_CONTROL_UNAVAILABLE_REASON = "Control multi-room playback from the source app";

function buildPlaybackTransportCapabilities(source, options = {}) {
  const base = {
    playPause: true,
    play: true,
    pause: true,
    next: true,
    previous: true,
    seek: options.seekAvailable !== false,
    reason: options.seekAvailable === false ? options.reason ?? null : null
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

  if (isMultiroomSourceId(source)) {
    return {
      playPause: false,
      play: false,
      pause: false,
      next: false,
      previous: false,
      seek: false,
      reason: getMultiroomEcosystemConfig(getMultiroomEcosystemIdFromSource(source))?.controlReason ?? MULTIROOM_CONTROL_UNAVAILABLE_REASON
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

function markHifiRuntimeRecoveryQuietWindow() {
  hifiRuntimeRecoveryQuietUntilMs = Math.max(
    hifiRuntimeRecoveryQuietUntilMs,
    Date.now() + HIFI_RUNTIME_RECOVERY_MUTATION_QUIET_MS
  );
}

function isHifiRuntimeRecoveryQuiet() {
  return Date.now() < hifiRuntimeRecoveryQuietUntilMs;
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

async function setOutputVolumePercent(percent, options = {}) {
  const { remember = true } = options;
  const normalized = Math.max(0, Math.min(100, Math.round(Number(percent))));
  if (!Number.isFinite(normalized)) {
    throw new Error("output volume requires value between 0 and 100");
  }
  if (!OUTPUT_VOLUME_SET_COMMAND.trim()) {
    throw new Error("output volume control is unavailable in this runtime");
  }
  const command = OUTPUT_VOLUME_SET_COMMAND.replace(/%VALUE%/g, String(normalized));
  await runCommand(command, { allowFailure: false, timeout: 2500 });
  if (remember && normalized > 0) {
    await rememberNonZeroVolumePercent(normalized);
  }
}

async function setMpcAndOutputVolumePercent(percent) {
  const normalized = Math.max(0, Math.min(100, Math.round(Number(percent))));
  await runMpc(["volume", String(normalized)]);
  if (normalized > 0) {
    await rememberNonZeroVolumePercent(normalized);
  }
  if (OUTPUT_VOLUME_SET_COMMAND_CONFIGURED) {
    await setOutputVolumePercent(normalized);
  }
}

async function getMpdResumeVolumePercent() {
  const volumeState = await readAudioVolumeState();
  if (volumeState.lastNonZeroPercent && volumeState.lastNonZeroPercent > 0) {
    return volumeState.lastNonZeroPercent;
  }
  const globalVolumePercent = clampPercent(system.volume?.percent, null);
  if (globalVolumePercent && globalVolumePercent > 0) {
    return globalVolumePercent;
  }
  if (Number.isFinite(MPD_STARTUP_VOLUME) && MPD_STARTUP_VOLUME > 0 && MPD_STARTUP_VOLUME <= 100) {
    return Math.round(MPD_STARTUP_VOLUME);
  }
  return RADIO_VOLUME_DEFAULT_PERCENT;
}

async function restoreMpdOutputVolumeAfterProfileSwitch(profile, customSettings = DEFAULT_AUDIO_OUTPUT_CUSTOM_SETTINGS) {
  if (API_MODE !== "mpc" || !audioOutputProfileCanRestoreVolume(profile, customSettings)) return;
  const status = parseMpcStatus(await runMpc(["status"], { allowFailure: true, timeout: 2500 }));
  if (status.state !== "playing") return;
  const outputVolumePercent = OUTPUT_VOLUME_SET_COMMAND_CONFIGURED
    ? await readOutputVolumePercent()
    : null;
  const mpcMuted = status.volumePercent === 0;
  const outputMuted = OUTPUT_VOLUME_SET_COMMAND_CONFIGURED && outputVolumePercent === 0;
  if (!mpcMuted && !outputMuted) {
    if (status.volumePercent && status.volumePercent > 0) {
      await rememberNonZeroVolumePercent(status.volumePercent);
    }
    if (outputVolumePercent && outputVolumePercent > 0) {
      await rememberNonZeroVolumePercent(outputVolumePercent);
    }
    return;
  }

  const nextVolume = await getMpdResumeVolumePercent();
  try {
    if (mpcMuted) {
      await runMpc(["volume", String(nextVolume)], { allowFailure: true, timeout: 2500 });
    }
    if (outputMuted) {
      await setOutputVolumePercent(nextVolume);
    }
    await rememberNonZeroVolumePercent(nextVolume);
  } catch (error) {
    console.warn(`tikpal-api could not restore volume after audio output profile switch: ${error instanceof Error ? error.message : "unknown error"}`);
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
  const streamAvailable = readMetadataBoolean(metadata, [
    "streamavailable",
    "streamAvailable",
    "stream_available",
    "playbackavailable",
    "playbackAvailable",
    "playback_available"
  ]);
  const metadataOnly = readMetadataBoolean(metadata, [
    "metadataonly",
    "metadataOnly",
    "metadata_only"
  ]);

  return {
    title,
    artist: normalizeMetadataValue(metadata.artist ?? metadata.artists) || null,
    album: normalizeMetadataValue(metadata.album) || null,
    status: status || null,
    positionMs: Number.isFinite(positionMs) ? positionMs : null,
    durationMs: Number.isFinite(durationMs) ? durationMs : null,
    artworkUrl: metadataArtworkUrl(metadata),
    streamAvailable,
    metadataOnly,
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

async function readUpnpPlaybackMetadata() {
  if (!UPNP_METADATA_COMMAND.trim()) return null;
  const raw = await runCommand(UPNP_METADATA_COMMAND, { allowFailure: true, timeout: 3500 });
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

function splitAirplayCompoundTrackArtistLabel(rawArtist) {
  const value = normalizeMetadataValue(rawArtist);
  for (const separator of [" — ", " – "]) {
    const parts = value.split(separator).map((part) => normalizeMetadataValue(part)).filter(Boolean);
    if (parts.length === 2) {
      return {
        title: parts[0],
        artist: parts[1]
      };
    }
  }
  return null;
}

function containsCjk(value) {
  return /[\u3400-\u9fff]/.test(String(value ?? ""));
}

function latinWordCount(value) {
  return String(value ?? "").match(/[A-Za-z0-9]+/g)?.length ?? 0;
}

function looksLikeAirplayCompoundTrackTitle(value) {
  const normalized = normalizeMetadataValue(value);
  if (!normalized) return false;
  if (containsCjk(normalized)) return normalized.replace(/[^\u3400-\u9fff]/g, "").length >= 2;
  return latinWordCount(normalized) >= 2 || /[[(]/.test(normalized);
}

function normalizeAirplayCompoundTrackMetadata(metadata) {
  const splitLabel = splitAirplayCompoundTrackArtistLabel(metadata?.artist);
  if (!splitLabel) return metadata;
  if (!looksLikeAirplayCompoundTrackTitle(splitLabel.title)) return metadata;

  const currentTitleKey = normalizeLyricsMatchValue(metadata.title);
  const splitTitleKey = normalizeLyricsMatchValue(splitLabel.title);
  const titleAlreadyMatches = currentTitleKey && splitTitleKey && currentTitleKey === splitTitleKey;
  if (!titleAlreadyMatches && !currentTitleKey) return metadata;

  return {
    ...metadata,
    title: splitLabel.title,
    artist: splitLabel.artist
  };
}

function normalizeAirplayPlaybackMetadata(metadata) {
  if (!isUsableAirplayPlaybackMetadata(metadata)) return null;
  metadata = normalizeAirplayCompoundTrackMetadata(metadata);
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

function normalizeUpnpPlaybackMetadata(metadata) {
  if (!isUsableAirplayPlaybackMetadata(metadata)) return null;
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

function parsePositiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeAudioFileCodec(value, fallbackPath) {
  const raw = String(value ?? "").trim();
  if (raw) return raw.toLowerCase();
  const extension = extname(String(fallbackPath ?? "")).replace(/^\./, "").trim();
  return extension ? extension.toLowerCase() : null;
}

function normalizeAudioFileContainer(value, fallbackPath) {
  const raw = String(value ?? "").trim();
  if (raw) return raw.split(",").map((entry) => entry.trim()).filter(Boolean)[0]?.toLowerCase() ?? null;
  const extension = extname(String(fallbackPath ?? "")).replace(/^\./, "").trim();
  return extension ? extension.toLowerCase() : null;
}

function audioInfoFromFileStat(absolutePath, fileStat) {
  return {
    fileSizeBytes: fileStat?.size ?? null,
    codec: normalizeAudioFileCodec(null, absolutePath),
    container: normalizeAudioFileContainer(null, absolutePath),
    sampleRateHz: null,
    bitrateKbps: null,
    bitDepth: null,
    channels: null,
    durationSeconds: null,
    title: null,
    artist: null,
    album: null
  };
}

function normalizeAudioFileTag(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function readAudioFileTag(tags, key) {
  return normalizeAudioFileTag(tags?.[key]) ?? normalizeAudioFileTag(tags?.[key.toUpperCase()]);
}

async function readAudioFileInfo(absolutePath) {
  let fileStat;
  try {
    fileStat = await stat(absolutePath);
  } catch {
    return audioInfoFromFileStat(absolutePath, null);
  }

  const cached = libraryAudioInfoCache.get(absolutePath);
  if (cached?.mtimeMs === fileStat.mtimeMs && cached?.size === fileStat.size) {
    return cached.info;
  }

  const fallback = audioInfoFromFileStat(absolutePath, fileStat);
  if (!LIBRARY_AUDIO_PROBE_ENABLED) {
    libraryAudioInfoCache.set(absolutePath, { mtimeMs: fileStat.mtimeMs, size: fileStat.size, info: fallback });
    return fallback;
  }

  let probe = {};
  try {
    const { stdout } = await execFileAsync(
      FFPROBE_BIN,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration,bit_rate,format_name:format_tags=title,artist,album:stream=codec_name,codec_type,sample_rate,channels,bits_per_sample,bits_per_raw_sample,bit_rate",
        "-of",
        "json",
        absolutePath
      ],
      {
        timeout: LIBRARY_AUDIO_PROBE_TIMEOUT_MS,
        maxBuffer: 1024 * 512
      }
    );
    probe = JSON.parse(stdout);
  } catch {
    probe = {};
  }

  const audioStream = Array.isArray(probe?.streams)
    ? probe.streams.find((stream) => stream?.codec_type === "audio") ?? null
    : null;
  const tags = probe?.format?.tags ?? {};
  const durationSeconds = parsePositiveNumber(probe?.format?.duration);
  const streamBitrate = parsePositiveNumber(audioStream?.bit_rate);
  const formatBitrate = parsePositiveNumber(probe?.format?.bit_rate);
  const sampleRateHz = parsePositiveNumber(audioStream?.sample_rate);
  const channels = parsePositiveNumber(audioStream?.channels);
  const bitDepth = parsePositiveNumber(audioStream?.bits_per_sample) ?? parsePositiveNumber(audioStream?.bits_per_raw_sample);
  const bitrate = streamBitrate ?? formatBitrate;

  const info = {
    fileSizeBytes: fallback.fileSizeBytes,
    codec: normalizeAudioFileCodec(audioStream?.codec_name, absolutePath),
    container: normalizeAudioFileContainer(probe?.format?.format_name, absolutePath),
    sampleRateHz: sampleRateHz ? Math.round(sampleRateHz) : null,
    bitrateKbps: bitrate ? Math.round(bitrate / 1000) : null,
    bitDepth: bitDepth ? Math.round(bitDepth) : null,
    channels: channels ? Math.round(channels) : null,
    durationSeconds: durationSeconds ? Math.round(durationSeconds) : null,
    title: readAudioFileTag(tags, "title"),
    artist: readAudioFileTag(tags, "artist"),
    album: readAudioFileTag(tags, "album")
  };

  libraryAudioInfoCache.set(absolutePath, { mtimeMs: fileStat.mtimeMs, size: fileStat.size, info });
  return info;
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

function parseTurzxBrightnessSnapshot(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.available || !parsed?.primaryIsTurzx) return null;
    const savedPercent = Math.max(0, clampPercent(parsed.brightnessPercent, system.display.brightnessPercent || 45));
    const hardwarePercent = Number(parsed.hardwareBrightnessPercent);
    const hasHardwareReadback = Number.isFinite(hardwarePercent) && hardwarePercent > 0;
    const hardwareActualPercent = hasHardwareReadback ? Math.max(1, clampPercent(hardwarePercent, savedPercent)) : savedPercent;
    const readbackMatches = !hasHardwareReadback || Math.abs(hardwareActualPercent - savedPercent) <= 2;
    const softwarePercent = Number(parsed.softwareBrightnessPercent);
    const hasSoftBrightness = parsed.softBrightnessActive === true && Number.isFinite(softwarePercent) && softwarePercent > 0;
    const actualPercent = readbackMatches
      ? hardwareActualPercent
      : hasSoftBrightness ? Math.max(1, clampPercent(softwarePercent, savedPercent)) : hardwareActualPercent;
    return {
      brightnessPercent: actualPercent,
      controllable: readbackMatches || hasSoftBrightness,
      transport: readbackMatches ? "turzx-hid" : hasSoftBrightness ? "turzx-soft" : "turzx-hid"
    };
  } catch {
    return null;
  }
}

async function readTurzxBrightnessSnapshot() {
  if (!TURZX_BRIGHTNESS_COMMAND.trim()) return null;
  const raw = await runCommand(`${TURZX_BRIGHTNESS_COMMAND} status`, {
    allowFailure: true,
    timeout: TURZX_BRIGHTNESS_TIMEOUT_MS
  });
  return parseTurzxBrightnessSnapshot(raw);
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
  const turzxSnapshot = await readTurzxBrightnessSnapshot();
  if (turzxSnapshot) {
    displayBrightnessSnapshotCache = { value: turzxSnapshot, updatedAtMs: now };
    displayBrightnessUnavailableUntilMs = 0;
    system.display = turzxSnapshot;
    return turzxSnapshot;
  }

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

  const turzxSnapshot = await readTurzxBrightnessSnapshot();
  if (turzxSnapshot) {
    const safePercent = Math.max(0, nextPercent);
    await runCommand(`${TURZX_BRIGHTNESS_COMMAND} set ${safePercent}`, {
      allowFailure: false,
      timeout: TURZX_BRIGHTNESS_TIMEOUT_MS
    });
    const verifiedSnapshot = await readTurzxBrightnessSnapshot();
    if (verifiedSnapshot && !verifiedSnapshot.controllable) {
      displayBrightnessSnapshotCache = { value: verifiedSnapshot, updatedAtMs: Date.now() };
      displayBrightnessUnavailableUntilMs = Date.now() + DDCUTIL_UNAVAILABLE_BACKOFF_MS;
      system.display = verifiedSnapshot;
      invalidateTikpalStateSnapshotCache();
      throw new Error("TURZX backlight did not accept brightness command");
    }
    const nextSnapshot = verifiedSnapshot?.controllable
      ? verifiedSnapshot
      : {
          brightnessPercent: safePercent,
          controllable: true,
          transport: "turzx-hid"
        };
    displayBrightnessSnapshotCache = {
      value: nextSnapshot,
      updatedAtMs: Date.now()
    };
    displayBrightnessUnavailableUntilMs = 0;
    system.display = displayBrightnessSnapshotCache.value;
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
  if (!RUNTIME_DRM_MODE_ENABLED) {
    return buildRuntimeSnapshot(normalizeKioskWindow(REQUESTED_KIOSK_WINDOW) ?? REQUESTED_KIOSK_WINDOW);
  }

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
  const status = applyTikpalPlaybackModeToStatus(parseMpcStatus(statusRaw));
  const stats = parseMpcStats(statsRaw);
  const [network, display, outputDevice, dspState, cpuTemp, uptime, multiroom] = await Promise.all([
    getNetworkSnapshot(),
    readDisplayBrightnessSnapshot(),
    getOutputDeviceSnapshot(),
    getDspSnapshot(),
    getCpuTempSnapshot(),
    getUptimeSnapshot(),
    readMultiroomState({ releaseMpd: false })
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
    multiroom,
    roonBridge: multiroom.ecosystems.roon,
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
  const status = applyTikpalPlaybackModeToStatus(parseMpcStatus(statusRaw));
  const stats = parseMpcStats(statsRaw);
  const scanRecentlyRequested = Date.now() - lastSystemLibraryScanRequestedAt < 15000;

  return {
    ...cachedSystem,
    display: system.display,
    multiroom: cachedSystem.multiroom ?? system.multiroom,
    roonBridge: cachedSystem.roonBridge ?? system.roonBridge,
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
  if (normalized === "focus") return "focus";
  if (normalized === "calm") return "calm";
  if (normalized === "sleep") return "sleep";
  if (normalized === "jazz") return "jazz";
  if (normalized === "classical") return "classical";
  if (normalized === "news") return "news";
  if (normalized === "hifi" || normalized === "highfidelity") return "hifi";
  if (normalized === "blues") return "blues";
  if (normalized === "rock") return "rock";
  if (normalized === "world" || normalized === "worldmusic") return "world";
  if (normalized === "electronic" || normalized === "electronica") return "electronic";
  if (normalized === "podcast" || normalized === "spokenword" || normalized === "talk") return "podcast";
  if (normalized === RADIO_RANDOM_CATEGORY_ID) return RADIO_RANDOM_CATEGORY_ID;
  return null;
}

function parseRadioGenreParts(genre) {
  return String(genre ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function radioCategoryFromStationLabel(label) {
  const match = String(label ?? "").match(/^(?:Tikpal\s+)?(.+?)\s*-\s*/i);
  return normalizeRadioCategory(match?.[1]);
}

function radioCategoryFromStation(label, genreParts) {
  return radioCategoryFromStationLabel(label) ?? normalizeRadioCategory(genreParts[0]);
}

function isCuratedRadioStation(rawId, label, category) {
  if (/^Tikpal\s+/i.test(String(label ?? ""))) return true;
  const numericId = Number(rawId);
  return Number.isFinite(numericId) && numericId >= 500 && Boolean(radioCategoryFromStationLabel(label) ?? category);
}

function radioCategoryOrder(category) {
  const index = RADIO_REAL_CATEGORY_ORDER.indexOf(category);
  return index === -1 ? RADIO_REAL_CATEGORY_ORDER.length : index;
}

function randomizeRadioStations(stations) {
  return [...stations]
    .map((station) => ({ station, rank: Math.random() }))
    .sort((left, right) => left.rank - right.rank)
    .map((entry) => entry.station);
}

function pickRandomRadioStations(stations, limit) {
  const boundedLimit = Math.max(0, Math.min(Math.round(limit), 3));
  if (boundedLimit === 0) return [];
  return randomizeRadioStations(stations).slice(0, boundedLimit);
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
  const isTikpalStation = isCuratedRadioStation(rawId, label, category);
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

async function getAvailableRadioStations(scope = "tikpal") {
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

function buildRadioCategorySummaries(stations) {
  const realCategoryStations = stations.filter((station) => (
    station.catalogSource === "tikpal"
    && station.category
    && RADIO_REAL_CATEGORY_ORDER.includes(station.category)
  ));

  return RADIO_CATEGORY_ORDER
    .map((category) => ({
      id: category,
      label: RADIO_CATEGORY_LABELS[category],
      count: category === RADIO_RANDOM_CATEGORY_ID
        ? Math.min(3, realCategoryStations.length)
        : stations.filter((station) => station.category === category).length
    }))
    .filter((category) => category.count > 0);
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
  const categories = buildRadioCategorySummaries(stations);
  const bitrates = Array.from(
    new Set(
      stations
        .map((station) => (station.bitrateKbps === null ? "" : `${station.bitrateKbps} kbps`))
        .filter(Boolean)
    )
  ).sort((left, right) => Number.parseInt(left, 10) - Number.parseInt(right, 10));
  const randomCategorySelected = filters.category === RADIO_RANDOM_CATEGORY_ID;
  const filtered = randomCategorySelected
    ? pickRandomRadioStations(
        filterRadioStations(stations, { ...filters, category: null })
          .filter((station) => (
            station.catalogSource === "tikpal"
            && station.category
            && RADIO_REAL_CATEGORY_ORDER.includes(station.category)
          )),
        filters.limit
      )
    : filterRadioStations(stations, filters);
  const paged = randomCategorySelected
    ? filtered
    : filtered.slice(filters.offset, filters.offset + filters.limit);

  return {
    stations: paged,
    total: randomCategorySelected ? paged.length : filtered.length,
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
    deletedTrackPaths: [],
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
  state.deletedTrackPaths = uniqueSafeTrackPaths(Array.isArray(raw?.deletedTrackPaths) ? raw.deletedTrackPaths : []);
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

function emptyNasSourcesState() {
  return {
    version: 1,
    sources: []
  };
}

function normalizeNasId(value, fallbackSeed = "") {
  const raw = String(value ?? fallbackSeed ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const id = raw || `nas-${Date.now().toString(36)}`;
  return id.startsWith("nas-") ? id : `nas-${id}`;
}

function normalizeNasDisplayName(value, fallback = "NAS") {
  return String(value ?? fallback)
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 48)
    || fallback;
}

function normalizeNasMountName(value, fallback = "NAS") {
  const normalized = String(value ?? fallback)
    .trim()
    .replace(/[\\/]+/g, "-")
    .replace(/[^A-Za-z0-9._ -]+/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 48);
  return normalized || fallback;
}

function normalizeNasHost(value) {
  const host = String(value ?? "").trim().replace(/^\/+|\/+$/g, "");
  if (!host || /[\\/]/.test(host)) return "";
  return host;
}

function normalizeNasShare(value) {
  return String(value ?? "")
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .split(/[\\/]+/)
    .filter(Boolean)
    .at(0)
    ?? "";
}

function normalizeNasFolderPath(value) {
  const safePath = normalizeSafeRelativePath(value);
  return safePath ?? "";
}

function normalizeNasPort(value) {
  const port = Number(value ?? 445);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return 445;
  return port;
}

function normalizeNasAuthMode(value) {
  const mode = String(value ?? "").trim().toLowerCase();
  return NAS_AUTH_MODES.has(mode) ? mode : "guest";
}

function parseNasLocator(value) {
  const raw = String(value ?? "").trim();
  if (!raw || (!raw.startsWith("//") && !raw.toLowerCase().startsWith("smb://"))) return null;
  try {
    const parsed = new URL(raw.startsWith("//") ? `smb:${raw}` : raw);
    const parts = parsed.pathname
      .split("/")
      .map((part) => decodeURIComponent(part).trim())
      .filter(Boolean);
    if (!parsed.hostname || parts.length === 0) return null;
    return {
      host: parsed.hostname,
      port: parsed.port ? normalizeNasPort(parsed.port) : 445,
      share: parts[0],
      path: normalizeNasFolderPath(parts.slice(1).join("/"))
    };
  } catch {
    return null;
  }
}

function normalizeNasLastStatus(raw, fallbackStatus = "offline") {
  const status = NAS_STATUS_VALUES.has(String(raw?.status ?? raw?.state ?? "").trim())
    ? String(raw.status ?? raw.state).trim()
    : fallbackStatus;
  const storedError = typeof raw?.lastError === "string" && raw.lastError.trim() ? raw.lastError.trim() : null;
  const storedRawError = typeof raw?.lastRawError === "string" && raw.lastRawError.trim() ? raw.lastRawError.trim() : null;
  const errorInfo = formatNasMountErrorForUser(storedRawError ?? storedError);
  return {
    status,
    checkedAt: typeof raw?.checkedAt === "string" ? raw.checkedAt : null,
    lastError: errorInfo.message,
    lastRawError: errorInfo.rawMessage
  };
}

function compactNasRawError(raw) {
  const value = String(raw ?? "")
    .replace(/credentials=([^,'"\s]+)/gi, "credentials=<saved>")
    .replace(/password=([^,'"\s]*)/gi, "password=<hidden>")
    .replace(/\s+\n/g, "\n")
    .trim();
  if (!value) return null;
  return value.length > 1400 ? `${value.slice(0, 1400).trim()}...` : value;
}

function formatNasMountErrorForUser(raw) {
  const rawMessage = compactNasRawError(raw);
  if (!rawMessage) return { message: null, rawMessage: null };
  const normalized = rawMessage.toLowerCase();
  const friendlyMessages = new Set([
    "Password is not saved. Re-enter username and password.",
    "NAS mount helper is not allowed. Check Tikpal setup.",
    "File sharing support is missing on this device.",
    "Server not found. Check Server/IP.",
    "NAS is not reachable. Check network and port.",
    "NAS did not respond. Check power and network.",
    "NAS refused the connection. Check SMB sharing and port.",
    "Login failed. Check username, password, or Guest access.",
    "Share or Folder not found. Check Share and Folder.",
    "SMB version did not work. Enable SMB 2 or 3 on the NAS.",
    "NAS is busy. Unmount and try again.",
    "Could not mount NAS. Check Server/IP, Share, and login."
  ]);
  if (friendlyMessages.has(rawMessage)) {
    return { message: rawMessage, rawMessage: null };
  }
  let message = "Could not mount NAS. Check Server/IP, Share, and login.";
  if (/credential file is not readable|credentials are not saved|credential file is required/.test(normalized)) {
    message = "Password is not saved. Re-enter username and password.";
  } else if (/sudo:|a password is required|not in the sudoers|operation not permitted/.test(normalized)) {
    message = "NAS mount helper is not allowed. Check Tikpal setup.";
  } else if (/mount\.cifs: not found|unknown filesystem type ['"]?cifs|bad option;.*mount\.cifs|cifs filesystem not supported/.test(normalized)) {
    message = "File sharing support is missing on this device.";
  } else if (/could not resolve address|name or service not known|temporary failure in name resolution|nodename nor servname/.test(normalized)) {
    message = "Server not found. Check Server/IP.";
  } else if (/no route to host|network is unreachable|connection timed out|operation timed out|unable to find suitable address|mount error\(110\)/.test(normalized)) {
    message = "NAS is not reachable. Check network and port.";
  } else if (/host is down|mount error\(112\)/.test(normalized)) {
    message = "NAS did not respond. Check power and network.";
  } else if (/connection refused|mount error\(111\)/.test(normalized)) {
    message = "NAS refused the connection. Check SMB sharing and port.";
  } else if (/permission denied|access denied|logon failure|status_logon_failure|status_access_denied|mount error\(13\)/.test(normalized)) {
    message = "Login failed. Check username, password, or Guest access.";
  } else if (/bad network name|status_bad_network_name|tree connect failed|no such file or directory|nas folder is not readable/.test(normalized)) {
    message = "Share or Folder not found. Check Share and Folder.";
  } else if (/protocol negotiation failed|operation not supported|mount error\(95\)|invalid argument|mount error\(22\)/.test(normalized)) {
    message = "SMB version did not work. Enable SMB 2 or 3 on the NAS.";
  } else if (/busy|target is busy|mount point is busy/.test(normalized)) {
    message = "NAS is busy. Unmount and try again.";
  }
  return { message, rawMessage: rawMessage === message ? null : rawMessage };
}

function createNasMountError(raw) {
  const errorInfo = formatNasMountErrorForUser(raw);
  const error = new Error(errorInfo.message ?? "Could not mount NAS.");
  error.lastRawError = errorInfo.rawMessage;
  return error;
}

function normalizeNasSource(raw, existing = null) {
  const locator = parseNasLocator(raw?.url ?? raw?.server ?? raw?.host);
  const host = normalizeNasHost(raw?.host ?? locator?.host);
  const share = normalizeNasShare(raw?.share ?? locator?.share);
  if (!host) throw new Error("NAS server is required");
  if (!share) throw new Error("NAS share is required");

  const now = new Date().toISOString();
  const port = normalizeNasPort(raw?.port ?? locator?.port);
  const path = normalizeNasFolderPath(raw?.path ?? raw?.folder ?? locator?.path);
  const name = normalizeNasDisplayName(raw?.name, existing?.name || share);
  const mountName = normalizeNasMountName(raw?.mountName, existing?.mountName || name);
  const id = normalizeNasId(raw?.id ?? existing?.id, `${host}-${share}-${mountName}`);
  const authMode = normalizeNasAuthMode(raw?.authMode);
  const username = authMode === "password"
    ? String(raw?.username ?? existing?.username ?? "").trim().slice(0, 128)
    : "";

  return {
    id,
    name,
    host,
    port,
    share,
    path,
    authMode,
    username,
    enabled: raw?.enabled === undefined ? existing?.enabled !== false : raw.enabled !== false,
    mountName,
    smbVersion: NAS_SMB_VERSIONS.includes(String(raw?.smbVersion ?? existing?.smbVersion ?? "").trim())
      ? String(raw?.smbVersion ?? existing?.smbVersion).trim()
      : null,
    lastStatus: normalizeNasLastStatus(raw?.lastStatus ?? existing?.lastStatus, existing?.lastStatus?.status ?? "offline"),
    lastScanAt: typeof raw?.lastScanAt === "string" ? raw.lastScanAt : existing?.lastScanAt ?? null,
    createdAt: typeof existing?.createdAt === "string" ? existing.createdAt : now,
    updatedAt: now
  };
}

function normalizeNasSourcesState(raw) {
  const state = emptyNasSourcesState();
  const seenIds = new Set();
  for (const entry of Array.isArray(raw?.sources) ? raw.sources : []) {
    try {
      const source = normalizeNasSource(entry);
      if (seenIds.has(source.id)) continue;
      seenIds.add(source.id);
      state.sources.push(source);
    } catch {
      // Skip malformed NAS entries rather than blocking the rest of the library.
    }
  }
  return state;
}

async function readNasSourcesState() {
  try {
    return normalizeNasSourcesState(JSON.parse(await readFile(NAS_SOURCES_STATE_PATH, "utf8")));
  } catch {
    return emptyNasSourcesState();
  }
}

async function writeNasSourcesState(state) {
  const normalized = normalizeNasSourcesState(state);
  await mkdir(dirname(NAS_SOURCES_STATE_PATH), { recursive: true });
  await writeFile(NAS_SOURCES_STATE_PATH, `${JSON.stringify(normalized, null, 2)}\n`);
  return normalized;
}

function normalizeUiLocale(value) {
  const raw = String(value ?? "").trim();
  if (UI_LOCALES.has(raw)) return raw;
  const lower = raw.toLowerCase().replace("_", "-");
  if (lower === "zh" || lower === "zh-cn" || lower === "cn") return "zh-CN";
  if (lower === "en" || lower.startsWith("en-")) return "en";
  if (lower === "de" || lower.startsWith("de-")) return "de";
  if (lower === "it" || lower.startsWith("it-")) return "it";
  if (lower === "ko" || lower.startsWith("ko-")) return "ko";
  if (lower === "ja" || lower.startsWith("ja-")) return "ja";
  if (lower === "es" || lower.startsWith("es-")) return "es";
  return null;
}

function normalizeDisplaySleepMinutes(value, fallback = DEFAULT_DISPLAY_SLEEP_MINUTES) {
  const numeric = Number(String(value ?? "").trim());
  return DISPLAY_SLEEP_MINUTES.includes(numeric) ? numeric : fallback;
}

function normalizeDisplaySleepStyle(value, fallback = DEFAULT_DISPLAY_SLEEP_STYLE) {
  const normalized = String(value ?? "").trim().toLowerCase().replaceAll("-", "_");
  const migrated = normalized === "blank" || normalized === "dim_waves" ? "meteor_shower" : normalized === "dvd" || normalized === "dvd_bounce" ? "signal" : normalized;
  return DISPLAY_SLEEP_STYLES.has(migrated) ? migrated : fallback;
}

function normalizeFontTheme(value, fallback = DEFAULT_FONT_THEME) {
  const normalized = String(value ?? "").trim().toLowerCase().replaceAll("-", "_");
  return FONT_THEMES.has(normalized) ? normalized : fallback;
}

function normalizeMpdBitPerfectMode(value, fallback = DEFAULT_MPD_BITPERFECT_MODE) {
  const normalized = String(value ?? "").trim().toLowerCase().replaceAll("-", "_");
  return MPD_BITPERFECT_MODES.has(normalized) ? normalized : fallback;
}

function normalizeAudioOutputProfile(value, fallback = DEFAULT_AUDIO_OUTPUT_PROFILE) {
  const normalized = String(value ?? "").trim().toLowerCase().replaceAll("-", "_");
  if (normalized === "strict" || normalized === "bit_perfect" || normalized === "bitperfect") return "pure";
  if (normalized === "standard") return "everyday";
  if (normalized === "meditation" || normalized === "sleep_meditation") return "sleep";
  return AUDIO_OUTPUT_PROFILES.has(normalized) ? normalized : fallback;
}

function normalizeAudioOutputCustomSettings(value = {}, fallback = DEFAULT_AUDIO_OUTPUT_CUSTOM_SETTINGS) {
  const source = value && typeof value === "object" ? value : {};
  return {
    pureDirect: source.pureDirect === undefined ? fallback.pureDirect : source.pureDirect === true,
    volumeNormalization: source.volumeNormalization === undefined ? fallback.volumeNormalization : source.volumeNormalization === true,
    smoothTransition: source.smoothTransition === undefined ? fallback.smoothTransition : source.smoothTransition === true,
    automaticSampleRate: source.automaticSampleRate === undefined ? fallback.automaticSampleRate : source.automaticSampleRate === true,
    dsdMode: source.dsdMode === undefined ? fallback.dsdMode : source.dsdMode === true,
    playbackStability: source.playbackStability === undefined ? fallback.playbackStability : source.playbackStability === true
  };
}

function audioOutputProfileToMpdBitPerfectMode(profile) {
  return normalizeAudioOutputProfile(profile) === "pure" ? "strict" : "standard";
}

function mpdBitPerfectModeToAudioOutputProfile(mode) {
  return normalizeMpdBitPerfectMode(mode) === "strict" ? "pure" : "everyday";
}

function buildUiPreferences(locale = "en", updatedAt = null, warning = null, displaySleep = {}, fontTheme = DEFAULT_FONT_THEME, mpdBitPerfectMode = DEFAULT_MPD_BITPERFECT_MODE, audioOutputProfile = null, audioOutputCustomSettings = DEFAULT_AUDIO_OUTPUT_CUSTOM_SETTINGS) {
  const normalizedLocale = normalizeUiLocale(locale) ?? "en";
  const displaySleepMinutes = normalizeDisplaySleepMinutes(displaySleep?.displaySleepMinutes);
  const displaySleepStyle = normalizeDisplaySleepStyle(displaySleep?.displaySleepStyle);
  const normalizedProfile = normalizeAudioOutputProfile(audioOutputProfile, mpdBitPerfectModeToAudioOutputProfile(mpdBitPerfectMode));
  return {
    locale: normalizedLocale,
    inputMethodId: "keyboard-us",
    fontTheme: normalizeFontTheme(fontTheme),
    audioOutputProfile: normalizedProfile,
    audioOutputCustomSettings: normalizeAudioOutputCustomSettings(audioOutputCustomSettings),
    mpdBitPerfectMode: audioOutputProfileToMpdBitPerfectMode(normalizedProfile),
    displaySleepEnabled: displaySleep?.displaySleepEnabled === undefined ? true : displaySleep.displaySleepEnabled !== false,
    displaySleepMinutes,
    displaySleepStyle,
    updatedAt,
    warning
  };
}

function normalizeUiPreferencesState(raw = {}) {
  return buildUiPreferences(raw?.locale, typeof raw?.updatedAt === "string" ? raw.updatedAt : null, null, {
    displaySleepEnabled: raw?.displaySleepEnabled,
    displaySleepMinutes: raw?.displaySleepMinutes,
    displaySleepStyle: raw?.displaySleepStyle
  }, raw?.fontTheme, raw?.mpdBitPerfectMode, raw?.audioOutputProfile, raw?.audioOutputCustomSettings);
}

async function readUiPreferences() {
  try {
    return normalizeUiPreferencesState(JSON.parse(await readFile(UI_PREFERENCES_STATE_PATH, "utf8")));
  } catch {
    return buildUiPreferences();
  }
}

async function isMpdBitPerfectStrictModeActive() {
  const preferences = await readUiPreferences();
  return preferences.audioOutputProfile === "pure"
    || (preferences.audioOutputProfile === "custom" && preferences.audioOutputCustomSettings.pureDirect === true);
}

async function getMpdVolumeLimitPercent() {
  return (await readUiPreferences()).audioOutputProfile === "sleep" ? SLEEP_AUDIO_OUTPUT_VOLUME_LIMIT_PERCENT : null;
}

function audioOutputProfileCanRestoreVolume(profile, customSettings = DEFAULT_AUDIO_OUTPUT_CUSTOM_SETTINGS) {
  const normalizedProfile = normalizeAudioOutputProfile(profile);
  if (normalizedProfile === "pure") return false;
  if (normalizedProfile === "custom") {
    return normalizeAudioOutputCustomSettings(customSettings).pureDirect !== true;
  }
  return true;
}

function isMpdAudioOutputProfileRestoreSource(sourceId) {
  const normalized = String(sourceId ?? "").trim().toLowerCase();
  if (!normalized) return true;
  return [
    "mpd",
    "library",
    "audio",
    "local",
    "nas",
    "usb",
    "favorites",
    "recently_added",
    "radio"
  ].includes(normalized);
}

function expandUiInputMethodSyncCommand(command, preferences) {
  return command
    .replaceAll("%LOCALE%", shellQuote(preferences.locale))
    .replaceAll("%INPUT_METHOD%", shellQuote(preferences.inputMethodId))
    .replaceAll("%FONT_THEME%", shellQuote(preferences.fontTheme ?? DEFAULT_FONT_THEME))
    .replaceAll("%APP_DIR%", shellQuote(process.cwd()));
}

async function syncUiInputMethod(preferences) {
  if (!UI_INPUT_METHOD_SYNC_COMMAND.trim()) return null;
  try {
    await runCommand(expandUiInputMethodSyncCommand(UI_INPUT_METHOD_SYNC_COMMAND, preferences), {
      allowFailure: false,
      timeout: 2500
    });
    return null;
  } catch (error) {
    const warning = error instanceof Error ? error.message : "Input method sync failed";
    console.warn(`tikpal-api input method sync failed: ${warning}`);
    return warning;
  }
}

async function syncUiKeyboardVisual(preferences) {
  if (!UI_KEYBOARD_VISUAL_SYNC_COMMAND.trim()) return null;
  try {
    await runCommand(expandUiInputMethodSyncCommand(UI_KEYBOARD_VISUAL_SYNC_COMMAND, preferences), {
      allowFailure: false,
      timeout: 2500
    });
    return null;
  } catch (error) {
    const warning = error instanceof Error ? error.message : "Keyboard visual sync failed";
    console.warn(`tikpal-api keyboard visual sync failed: ${warning}`);
    return warning;
  }
}

function expandMpdBitPerfectProfileCommand(command, mode) {
  return command
    .replaceAll("%MODE%", shellQuote(mode))
    .replaceAll("%PROFILE%", shellQuote(mpdBitPerfectModeToAudioOutputProfile(mode)))
    .replaceAll("%APP_DIR%", shellQuote(process.cwd()));
}

function expandAudioOutputProfileCommand(command, profile) {
  const normalizedProfile = normalizeAudioOutputProfile(profile);
  return command
    .replaceAll("%PROFILE%", shellQuote(normalizedProfile))
    .replaceAll("%MODE%", shellQuote(audioOutputProfileToMpdBitPerfectMode(normalizedProfile)))
    .replaceAll("%APP_DIR%", shellQuote(process.cwd()));
}

function buildAudioOutputCustomSettingsEnv(settings = DEFAULT_AUDIO_OUTPUT_CUSTOM_SETTINGS) {
  const normalized = normalizeAudioOutputCustomSettings(settings);
  const flag = (value) => (value ? "1" : "0");
  return {
    TIKPAL_MPD_CUSTOM_PURE_DIRECT: flag(normalized.pureDirect),
    TIKPAL_MPD_CUSTOM_VOLUME_NORMALIZATION: flag(normalized.volumeNormalization),
    TIKPAL_MPD_CUSTOM_SMOOTH_TRANSITION: flag(normalized.smoothTransition),
    TIKPAL_MPD_CUSTOM_AUTOMATIC_SAMPLE_RATE: flag(normalized.automaticSampleRate),
    TIKPAL_MPD_CUSTOM_DSD_MODE: flag(normalized.dsdMode),
    TIKPAL_MPD_CUSTOM_PLAYBACK_STABILITY: flag(normalized.playbackStability)
  };
}

function expandAudioOutputDiagnosticsCommand(command) {
  return command
    .replaceAll("%PROFILE%", shellQuote("diagnostics"))
    .replaceAll("%MODE%", shellQuote("status"))
    .replaceAll("%APP_DIR%", shellQuote(process.cwd()));
}

async function readAudioOutputDiagnostics() {
  const preferences = await readUiPreferences();
  if (API_MODE !== "mpc" || !AUDIO_OUTPUT_PROFILE_COMMAND.trim()) {
    return {
      profile: preferences.audioOutputProfile,
      text: `profile=${preferences.audioOutputProfile}\ntransport=${API_MODE}`,
      updatedAt: new Date().toISOString()
    };
  }
  const text = await runCommand(expandAudioOutputDiagnosticsCommand(AUDIO_OUTPUT_PROFILE_COMMAND), {
    allowFailure: true,
    timeout: 5000,
    maxBuffer: 1024 * 128
  });
  return {
    profile: preferences.audioOutputProfile,
    text: text || `profile=${preferences.audioOutputProfile}`,
    updatedAt: new Date().toISOString()
  };
}

function clearAudioOutputProfileAutoStop() {
  if (audioOutputProfileAutoStopTimer !== null) {
    clearTimeout(audioOutputProfileAutoStopTimer);
    audioOutputProfileAutoStopTimer = null;
  }
}

function scheduleAudioOutputProfileAutoStop(profile) {
  clearAudioOutputProfileAutoStop();
  if (API_MODE !== "mpc" || normalizeAudioOutputProfile(profile) !== "sleep") return;
  audioOutputProfileAutoStopTimer = setTimeout(() => {
    runMpc(["stop"], { allowFailure: true, timeout: 2500 }).catch((error) => {
      console.warn(`tikpal-api sleep audio profile auto-stop failed: ${error instanceof Error ? error.message : "unknown error"}`);
    });
  }, SLEEP_AUDIO_OUTPUT_AUTO_STOP_MS);
  audioOutputProfileAutoStopTimer.unref?.();
}

async function applyAudioOutputProfile(profile, customSettings = DEFAULT_AUDIO_OUTPUT_CUSTOM_SETTINGS) {
  const normalizedProfile = normalizeAudioOutputProfile(profile, null);
  if (!AUDIO_OUTPUT_PROFILES.has(normalizedProfile)) {
    throw new Error("Audio output profile must be pure, everyday, sleep, or custom");
  }
  if (API_MODE !== "mpc") {
    scheduleAudioOutputProfileAutoStop(normalizedProfile);
    return;
  }
  await withMpcMutationLock(async () => {
    const playbackRestoreState = await captureMpdBitPerfectPlaybackRestoreState();
    const command = AUDIO_OUTPUT_PROFILE_COMMAND.trim()
      ? expandAudioOutputProfileCommand(AUDIO_OUTPUT_PROFILE_COMMAND, normalizedProfile)
      : expandMpdBitPerfectProfileCommand(MPD_BITPERFECT_PROFILE_COMMAND, audioOutputProfileToMpdBitPerfectMode(normalizedProfile));
    const env = normalizedProfile === "custom" ? buildAudioOutputCustomSettingsEnv(customSettings) : undefined;
    await runCommand(command, { allowFailure: false, timeout: 20_000, env });
    scheduleAudioOutputProfileAutoStop(normalizedProfile);
    await restoreMpdBitPerfectPlayback(playbackRestoreState);
    await restoreMpdOutputVolumeAfterProfileSwitch(normalizedProfile, customSettings);
  });
}

async function applyMpdBitPerfectMode(mode) {
  await applyAudioOutputProfile(mpdBitPerfectModeToAudioOutputProfile(mode));
}

async function captureMpdBitPerfectPlaybackRestoreState() {
  if (API_MODE !== "mpc") return null;
  const currentSourceId = getCurrentMpcSourceId();
  if (!isMpdAudioOutputProfileRestoreSource(currentSourceId)) return null;

  try {
    const status = await readMpcStatusWithTikpalPlaybackMode({ allowFailure: true, timeout: 2500 });
    if (status.state !== "playing" || status.queueLength <= 0) return null;
    return {
      source: currentSourceId ?? "mpd",
      position: status.currentTrackIndex > 0 ? status.currentTrackIndex : null,
      queueLength: status.queueLength
    };
  } catch (error) {
    console.warn(`tikpal-api could not capture MPD playback before quality switch: ${error instanceof Error ? error.message : "unknown error"}`);
    return null;
  }
}

async function restoreMpdBitPerfectPlayback(snapshot) {
  if (!snapshot) return;
  try {
    const latestStatus = parseMpcStatus(await runMpc(["status"], {
      allowFailure: true,
      timeout: AUDIO_OUTPUT_RESTORE_MPC_TIMEOUT_MS
    }));
    const queueLength = Number(latestStatus.queueLength || snapshot.queueLength || 0);
    const position = Number(snapshot.position);
    const playArgs = Number.isInteger(position) && position >= 1 && position <= queueLength
      ? ["play", String(position)]
      : ["play"];

    for (let attempt = 0; attempt < AUDIO_OUTPUT_RESTORE_ATTEMPTS; attempt += 1) {
      await runMpc(playArgs, { allowFailure: true, timeout: AUDIO_OUTPUT_RESTORE_MPC_TIMEOUT_MS });
      await wait(AUDIO_OUTPUT_RESTORE_SETTLE_MS);
      const status = parseMpcStatus(await runMpc(["status"], {
        allowFailure: true,
        timeout: AUDIO_OUTPUT_RESTORE_MPC_TIMEOUT_MS
      }));
      if (status.state === "playing") return;
    }

    console.warn(`tikpal-api left MPD ${latestStatus.state ?? "unknown"} after audio output profile switch; playback polling will refresh shortly`);
  } catch (error) {
    console.warn(`tikpal-api could not restore MPD playback after quality switch: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

async function writeUiPreferences(patch, options = {}) {
  const current = await readUiPreferences();
  const hasLocalePatch = Object.prototype.hasOwnProperty.call(patch ?? {}, "locale");
  const locale = hasLocalePatch ? normalizeUiLocale(patch?.locale) : current.locale;
  if (!locale) {
    throw new Error("Language must be en, zh-CN, de, it, ko, ja, or es");
  }
  const hasDisplaySleepMinutesPatch = Object.prototype.hasOwnProperty.call(patch ?? {}, "displaySleepMinutes");
  const displaySleepMinutes = hasDisplaySleepMinutesPatch
    ? normalizeDisplaySleepMinutes(patch.displaySleepMinutes, null)
    : current.displaySleepMinutes;
  if (!DISPLAY_SLEEP_MINUTES.includes(displaySleepMinutes)) {
    throw new Error("Screen sleep time must be 5, 10, 15, 30, or 60 minutes");
  }
  const hasDisplaySleepStylePatch = Object.prototype.hasOwnProperty.call(patch ?? {}, "displaySleepStyle");
  const displaySleepStyle = hasDisplaySleepStylePatch
    ? normalizeDisplaySleepStyle(patch.displaySleepStyle, null)
    : current.displaySleepStyle;
  if (!DISPLAY_SLEEP_STYLES.has(displaySleepStyle)) {
    throw new Error("Screen sleep style must be meteor_shower, clock, now_playing, starfield, or signal");
  }
  const hasFontThemePatch = Object.prototype.hasOwnProperty.call(patch ?? {}, "fontTheme");
  const fontTheme = hasFontThemePatch ? normalizeFontTheme(patch.fontTheme, null) : current.fontTheme;
  if (!FONT_THEMES.has(fontTheme)) {
    throw new Error("Font theme must be system, hardware, precision, sans, serif, or mono");
  }
  const hasAudioOutputProfilePatch = Object.prototype.hasOwnProperty.call(patch ?? {}, "audioOutputProfile");
  const hasMpdBitPerfectModePatch = Object.prototype.hasOwnProperty.call(patch ?? {}, "mpdBitPerfectMode");
  const legacyMpdBitPerfectMode = hasMpdBitPerfectModePatch ? normalizeMpdBitPerfectMode(patch.mpdBitPerfectMode, null) : current.mpdBitPerfectMode;
  if (hasMpdBitPerfectModePatch && !MPD_BITPERFECT_MODES.has(legacyMpdBitPerfectMode)) {
    throw new Error("MPD quality must be standard or strict");
  }
  const audioOutputProfile = hasAudioOutputProfilePatch
    ? normalizeAudioOutputProfile(patch.audioOutputProfile, null)
    : hasMpdBitPerfectModePatch
      ? mpdBitPerfectModeToAudioOutputProfile(legacyMpdBitPerfectMode)
      : current.audioOutputProfile;
  if (!AUDIO_OUTPUT_PROFILES.has(audioOutputProfile)) {
    throw new Error("Audio output profile must be pure, everyday, sleep, or custom");
  }
  const hasAudioOutputCustomSettingsPatch = Object.prototype.hasOwnProperty.call(patch ?? {}, "audioOutputCustomSettings");
  const audioOutputCustomSettings = hasAudioOutputCustomSettingsPatch
    ? normalizeAudioOutputCustomSettings({
      ...current.audioOutputCustomSettings,
      ...patch.audioOutputCustomSettings
    }, current.audioOutputCustomSettings)
    : current.audioOutputCustomSettings;
  if (
    ((hasAudioOutputProfilePatch || hasMpdBitPerfectModePatch) && audioOutputProfile !== current.audioOutputProfile)
    || (hasAudioOutputCustomSettingsPatch && audioOutputProfile === "custom")
  ) {
    await applyAudioOutputProfile(audioOutputProfile, audioOutputCustomSettings);
  }
  const mpdBitPerfectMode = audioOutputProfileToMpdBitPerfectMode(audioOutputProfile);
  const next = buildUiPreferences(locale, new Date().toISOString(), null, {
    displaySleepEnabled: Object.prototype.hasOwnProperty.call(patch ?? {}, "displaySleepEnabled")
      ? patch.displaySleepEnabled !== false
      : current.displaySleepEnabled,
    displaySleepMinutes,
    displaySleepStyle
  }, fontTheme, mpdBitPerfectMode, audioOutputProfile, audioOutputCustomSettings);
  await mkdir(dirname(UI_PREFERENCES_STATE_PATH), { recursive: true });
  await writeFile(UI_PREFERENCES_STATE_PATH, `${JSON.stringify(next, null, 2)}\n`);
  const shouldSyncInputMethod = options.syncInputMethod !== false && hasLocalePatch;
  const shouldSyncKeyboardVisual = options.syncInputMethod !== false && hasFontThemePatch;
  const warning = shouldSyncInputMethod
    ? await syncUiInputMethod(next)
    : shouldSyncKeyboardVisual
      ? await syncUiKeyboardVisual(next)
      : null;
  return warning ? { ...next, warning } : next;
}

async function attachUiPreferences(state) {
  return {
    ...state,
    preferences: await readUiPreferences()
  };
}

function nasCredentialPath(sourceId) {
  const id = normalizeNasId(sourceId);
  return resolve(NAS_CREDENTIALS_DIR, `${id}.cred`);
}

async function readNasCredential(sourceId) {
  try {
    const text = await readFile(nasCredentialPath(sourceId), "utf8");
    const values = Object.fromEntries(text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const index = line.indexOf("=");
        return index === -1 ? [line, ""] : [line.slice(0, index), line.slice(index + 1)];
      }));
    return {
      username: values.username ?? "",
      password: values.password ?? ""
    };
  } catch {
    return null;
  }
}

async function writeNasCredentialFile(filePath, username, password) {
  const safeUsername = String(username ?? "").replace(/[\r\n]/g, "").trim();
  const safePassword = String(password ?? "").replace(/[\r\n]/g, "");
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `username=${safeUsername}\npassword=${safePassword}\n`, { mode: 0o600 });
  await chmod(filePath, 0o600);
  return filePath;
}

async function writeNasCredential(sourceId, username, password) {
  await mkdir(NAS_CREDENTIALS_DIR, { recursive: true });
  return await writeNasCredentialFile(nasCredentialPath(sourceId), username, password);
}

async function deleteNasCredential(sourceId) {
  try {
    await unlink(nasCredentialPath(sourceId));
  } catch {
    // Credentials may not exist for guest shares.
  }
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

function normalizeWebModeProviderId(value, fallback = "qq_music") {
  const id = String(value ?? "").trim().toLowerCase();
  return WEB_MODE_PROVIDER_IDS.has(id) ? id : fallback;
}

function normalizeWebModeProxyUrl(value) {
  const proxyUrl = String(value ?? "").trim();
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(proxyUrl) ? proxyUrl : `http://${proxyUrl}`;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("Explore proxy URL must be host:port, http://host:port, https://host:port, or socks5://host:port");
  }
  if (!["http:", "https:", "socks5:"].includes(parsed.protocol) || !parsed.hostname || !parsed.port) {
    throw new Error("Explore proxy URL must be host:port, http://host:port, https://host:port, or socks5://host:port");
  }
  parsed.username = "";
  parsed.password = "";
  parsed.pathname = "";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function normalizeWebModeKeyboardPosition(value) {
  if (value === undefined) return null;
  if (typeof value !== "string") {
    throw new Error("Explore keyboard position must be x,y");
  }
  const match = value.trim().match(/^(\d{1,4}),(\d{1,4})$/);
  if (!match) {
    throw new Error("Explore keyboard position must be x,y");
  }
  const x = Number(match[1]);
  const y = Number(match[2]);
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x > 3840 || y > 2160) {
    throw new Error("Explore keyboard position must be inside the kiosk display");
  }
  return `${x},${y}`;
}

function normalizeWebModeKeyboardWindow(value) {
  if (value === undefined) return null;
  if (typeof value !== "string") {
    throw new Error("Explore keyboard window must be WIDTHxHEIGHT");
  }
  const match = value.trim().match(/^(\d{2,4})x(\d{2,4})$/);
  if (!match) {
    throw new Error("Explore keyboard window must be WIDTHxHEIGHT");
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width < 320
    || height < 120
    || width > 2560
    || height > 1440
  ) {
    throw new Error("Explore keyboard window must fit the kiosk display");
  }
  return `${width}x${height}`;
}

function normalizeWebModeKeyboardTarget(value) {
  const target = String(value ?? "auto").trim().toLowerCase();
  if (target === "auto" || target === "kiosk" || target === "provider") return target;
  throw new Error("Explore keyboard target must be auto, kiosk, or provider");
}

function normalizeWebModeSettings(raw = {}) {
  let proxyUrl = WEB_MODE_DEFAULT_PROXY_URL;
  try {
    proxyUrl = normalizeWebModeProxyUrl(raw.proxyUrl ?? WEB_MODE_DEFAULT_PROXY_URL);
  } catch {
    proxyUrl = normalizeWebModeProxyUrl(WEB_MODE_DEFAULT_PROXY_URL);
  }
  const providerTextScale = normalizeWebModeProviderTextScale(raw.providerTextScale ?? WEB_MODE_DEFAULT_PROVIDER_TEXT_SCALE, WEB_MODE_DEFAULT_PROVIDER_TEXT_SCALE);
  return {
    proxyEnabled: typeof raw.proxyEnabled === "boolean" ? raw.proxyEnabled : true,
    proxyUrl,
    providerTextScale,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null
  };
}

function normalizeWebModeVisibleError(error) {
  const message = typeof error === "string" && error.trim() ? error.trim() : null;
  if (!message) return null;
  return message.replace(/\bneeds Proxy On\b/gi, "needs proxy");
}

function normalizeWebModeRuntimeState(raw = {}) {
  const residentProviders = {};
  const rawResidentProviders = raw.residentProviders && typeof raw.residentProviders === "object"
    ? raw.residentProviders
    : {};
  const allowedProviderStatuses = new Set(["opening", "prewarming", "ready", "active", "check_setup", "check_proxy", "closed"]);
  for (const provider of WEB_MODE_PROVIDERS) {
    const value = rawResidentProviders[provider.id];
    if (!value || typeof value !== "object") continue;
    const status = String(value.status ?? "").trim().toLowerCase();
    if (!allowedProviderStatuses.has(status) || status === "closed") continue;
    residentProviders[provider.id] = {
      status,
      lastError: normalizeWebModeVisibleError(value.lastError),
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null
    };
  }
  return {
    activeProvider: raw.activeProvider ? normalizeWebModeProviderId(raw.activeProvider, null) : null,
    residentProviders,
    lastError: normalizeWebModeVisibleError(raw.lastError),
    closeRequestId: typeof raw.closeRequestId === "string" ? raw.closeRequestId : null,
    proxyAppliedSettingsUpdatedAt: typeof raw.proxyAppliedSettingsUpdatedAt === "string" ? raw.proxyAppliedSettingsUpdatedAt : null,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null
  };
}

function normalizeWebModeHandoffState(raw = {}) {
  const sourceId = String(raw?.sourceId ?? "").trim().toLowerCase();
  const playbackState = String(raw?.playbackState ?? "").trim().toLowerCase();
  const elapsedSeconds = Number(raw?.elapsedSeconds);
  return {
    sourceId: sourceId || null,
    playbackState: ["playing", "paused", "stopped"].includes(playbackState) ? playbackState : "stopped",
    localTrackPath: normalizeLocalLibraryStateTrackPath(raw?.localTrackPath),
    radioStationId: normalizeRememberedRadioStationId(raw?.radioStationId),
    elapsedSeconds: Number.isFinite(elapsedSeconds) && elapsedSeconds >= 0 ? elapsedSeconds : null,
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

async function ensureWebModeSettings() {
  const settings = await readWebModeSettings();
  return settings.updatedAt ? settings : await writeWebModeSettings(settings);
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

async function shouldSuspendMpcRadioBackgroundRecovery() {
  return webModeOpenInFlight || webModeCloseInFlight || Boolean((await readWebModeRuntimeState()).activeProvider);
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

async function readWebModeHandoffState() {
  try {
    return normalizeWebModeHandoffState(JSON.parse(await readFile(WEB_MODE_HANDOFF_STATE_PATH, "utf8")));
  } catch {
    return normalizeWebModeHandoffState();
  }
}

async function writeWebModeHandoffState(patch) {
  const next = normalizeWebModeHandoffState({
    ...patch,
    updatedAt: new Date().toISOString()
  });
  await mkdir(dirname(WEB_MODE_HANDOFF_STATE_PATH), { recursive: true });
  await writeFile(WEB_MODE_HANDOFF_STATE_PATH, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

async function clearWebModeHandoffState() {
  try {
    await unlink(WEB_MODE_HANDOFF_STATE_PATH);
  } catch {
    // Runtime handoff state is best-effort and safe to recreate on the next Explore open.
  }
}

function normalizeMultiroomEcosystemId(value, fallback = null) {
  const normalized = String(value ?? "").trim().toLowerCase().replaceAll("-", "_");
  return MULTIROOM_ECOSYSTEM_IDS.includes(normalized) ? normalized : fallback;
}

function normalizeMultiroomEcosystemState(id, raw = {}) {
  const config = MULTIROOM_ECOSYSTEM_CONFIGS[id] ?? {};
  return {
    id,
    enabled: raw?.enabled === true,
    ready: raw?.ready === true,
    active: raw?.active === true,
    serviceActive: raw?.serviceActive === true,
    label: typeof raw?.label === "string" && raw.label.trim() ? raw.label.trim() : config.label ?? id,
    lastError: typeof raw?.lastError === "string" && raw.lastError.trim() ? raw.lastError.trim() : null,
    comingSoon: raw?.comingSoon === true || config.placeholder === true,
    updatedAt: typeof raw?.updatedAt === "string" ? raw.updatedAt : new Date().toISOString()
  };
}

function buildDefaultMultiroomState(overrides = {}) {
  const ecosystems = {};
  for (const id of MULTIROOM_ECOSYSTEM_IDS) {
    ecosystems[id] = normalizeMultiroomEcosystemState(id, overrides.ecosystems?.[id]);
  }
  const activeEcosystemId = normalizeMultiroomEcosystemId(overrides.activeEcosystemId);
  return {
    ecosystems,
    activeEcosystemId: activeEcosystemId && ecosystems[activeEcosystemId]?.active ? activeEcosystemId : null,
    updatedAt: typeof overrides.updatedAt === "string" ? overrides.updatedAt : new Date().toISOString()
  };
}

function normalizeMultiroomIntentState(raw = {}) {
  const ecosystems = {};
  for (const id of MULTIROOM_ECOSYSTEM_IDS) {
    ecosystems[id] = {
      enabled: raw?.ecosystems?.[id]?.enabled === true,
      updatedAt: typeof raw?.ecosystems?.[id]?.updatedAt === "string" ? raw.ecosystems[id].updatedAt : null
    };
  }
  return {
    ecosystems,
    updatedAt: typeof raw?.updatedAt === "string" ? raw.updatedAt : null
  };
}

async function readMultiroomIntentState() {
  try {
    return normalizeMultiroomIntentState(JSON.parse(await readFile(MULTIROOM_AUDIO_STATE_PATH, "utf8")));
  } catch {
    return normalizeMultiroomIntentState();
  }
}

async function writeMultiroomIntentState(patch = {}) {
  const current = await readMultiroomIntentState();
  const now = new Date().toISOString();
  const ecosystems = { ...current.ecosystems };
  for (const id of MULTIROOM_ECOSYSTEM_IDS) {
    const nextEnabled = patch?.ecosystems?.[id]?.enabled;
    ecosystems[id] = {
      ...ecosystems[id],
      ...(typeof nextEnabled === "boolean" ? { enabled: nextEnabled, updatedAt: now } : {})
    };
  }
  const next = normalizeMultiroomIntentState({
    ecosystems,
    updatedAt: now
  });
  await mkdir(dirname(MULTIROOM_AUDIO_STATE_PATH), { recursive: true });
  await writeFile(MULTIROOM_AUDIO_STATE_PATH, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

function normalizeMultiroomHandoffState(raw = {}) {
  const ecosystemId = normalizeMultiroomEcosystemId(raw?.ecosystemId, "roon");
  const sourceId = String(raw?.sourceId ?? "").trim().toLowerCase();
  const playbackState = String(raw?.playbackState ?? "").trim().toLowerCase();
  const queuePosition = Number(raw?.queuePosition);
  const queueLength = Number(raw?.queueLength);
  return {
    ecosystemId,
    sourceId: sourceId || null,
    playbackState: ["playing", "paused", "stopped"].includes(playbackState) ? playbackState : "stopped",
    queuePosition: Number.isInteger(queuePosition) && queuePosition > 0 ? queuePosition : null,
    queueLength: Number.isInteger(queueLength) && queueLength > 0 ? queueLength : null,
    currentFile: typeof raw?.currentFile === "string" && raw.currentFile.trim() ? raw.currentFile.trim() : null,
    localTrackPath: normalizeLocalLibraryStateTrackPath(raw?.localTrackPath),
    radioStationId: normalizeRememberedRadioStationId(raw?.radioStationId),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null
  };
}

async function readMultiroomHandoffState() {
  try {
    return normalizeMultiroomHandoffState(JSON.parse(await readFile(MULTIROOM_HANDOFF_STATE_PATH, "utf8")));
  } catch {
    try {
      const migrated = normalizeMultiroomHandoffState({
        ...JSON.parse(await readFile(ROONBRIDGE_HANDOFF_STATE_PATH, "utf8")),
        ecosystemId: "roon"
      });
      await writeMultiroomHandoffState(migrated);
      try {
        await unlink(ROONBRIDGE_HANDOFF_STATE_PATH);
      } catch {
        // Legacy state migration is best-effort; a stale file is harmless.
      }
      return migrated;
    } catch {
      return normalizeMultiroomHandoffState();
    }
  }
}

async function writeMultiroomHandoffState(patch) {
  const next = normalizeMultiroomHandoffState({
    ...patch,
    updatedAt: new Date().toISOString()
  });
  await mkdir(dirname(MULTIROOM_HANDOFF_STATE_PATH), { recursive: true });
  await writeFile(MULTIROOM_HANDOFF_STATE_PATH, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

async function clearMultiroomHandoffState() {
  try {
    await unlink(MULTIROOM_HANDOFF_STATE_PATH);
  } catch {
    // Runtime handoff state is best-effort and safe to recreate on the next multi-room handoff.
  }
  try {
    await unlink(ROONBRIDGE_HANDOFF_STATE_PATH);
  } catch {
    // The legacy Roon handoff path is kept only for migration.
  }
}

const normalizeRoonBridgeHandoffState = normalizeMultiroomHandoffState;
const readRoonBridgeHandoffState = readMultiroomHandoffState;
const writeRoonBridgeHandoffState = writeMultiroomHandoffState;
const clearRoonBridgeHandoffState = clearMultiroomHandoffState;

async function buildWebModeState() {
  const [settings, runtimeState, preferences] = await Promise.all([
    ensureWebModeSettings(),
    readWebModeRuntimeState(),
    readUiPreferences()
  ]);
  return {
    enabled: true,
    activeProvider: runtimeState.activeProvider,
    providers: WEB_MODE_PROVIDERS,
    residentProviders: runtimeState.residentProviders,
    settings,
    preferences,
    lastError: runtimeState.lastError,
    updatedAt: runtimeState.updatedAt ?? settings.updatedAt ?? new Date(0).toISOString()
  };
}

let audioVolumeStateCache = null;
let playbackModeStateCache = null;

function normalizePlaybackModeState(raw = {}) {
  const mode = String(raw?.mode ?? "").trim().toLowerCase();
  return {
    mode: PLAYBACK_MODES.has(mode) ? mode : null,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null
  };
}

function getCachedPlaybackModeState() {
  if (playbackModeStateCache !== null) return playbackModeStateCache;
  try {
    playbackModeStateCache = normalizePlaybackModeState(JSON.parse(readFileSync(PLAYBACK_MODE_STATE_PATH, "utf8")));
  } catch {
    playbackModeStateCache = normalizePlaybackModeState();
  }
  return playbackModeStateCache;
}

async function writePlaybackModeState(mode) {
  const normalizedMode = normalizePlaybackMode(mode);
  const next = normalizePlaybackModeState({
    mode: normalizedMode,
    updatedAt: new Date().toISOString()
  });
  await mkdir(dirname(PLAYBACK_MODE_STATE_PATH), { recursive: true });
  await writeFile(PLAYBACK_MODE_STATE_PATH, `${JSON.stringify(next, null, 2)}\n`);
  playbackModeStateCache = next;
  return next;
}

function applyTikpalPlaybackModeToStatus(status) {
  const mode = getCachedPlaybackModeState().mode ?? status?.settings?.playMode ?? "sequence";
  return {
    ...status,
    settings: {
      ...(status?.settings ?? {}),
      playMode: mode
    }
  };
}

async function readMpcStatusWithTikpalPlaybackMode(options = {}) {
  return applyTikpalPlaybackModeToStatus(parseMpcStatus(await runMpc(["status"], options)));
}

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
    const radioStations = await getAvailableRadioStations("all");
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

async function readLocalLibraryTrackAudioInfo(trackPath) {
  const candidates = buildMpdLocalLibraryTrackPathCandidates(trackPath);
  for (const candidate of candidates) {
    const absolutePath = resolveMpdFilePath(candidate);
    if (!absolutePath) continue;
    try {
      const info = await stat(absolutePath);
      if (info.isFile()) return await readAudioFileInfo(absolutePath);
    } catch {
      // Try the next MPD-visible candidate.
    }
  }
  return audioInfoFromFileStat(trackPath, null);
}

async function readLocalAudioLibraryTracks(options = {}) {
  let manifestRows = [];
  const musicState = options.musicState ?? readMusicLibraryStateSync();
  const deletedPaths = new Set(musicState.deletedTrackPaths ?? []);
  try {
    manifestRows = readJsonRowsFromText(await readFile(LOCAL_LIBRARY_MANIFEST_PATH, "utf8"), "Music library manifest");
  } catch {
    manifestRows = [];
  }
  const favoritePaths = new Set(musicState.favorites.trackPaths);

  const manifestTracks = await Promise.all(manifestRows
    .map(async (row) => {
      const categoryId = resolveLocalLibraryCategory(row);
      if (!categoryId) return null;

      const title = row.title?.trim() || row.final_filename?.trim() || "Untitled";
      const artist = row.artist_or_author?.trim() || "Unknown Artist";
      const subCategory = row.category_level_2?.trim() || libraryCategoryLabel(categoryId);
      const path = normalizeSafeRelativePath(row.final_relative_path) ?? null;
      if (path && deletedPaths.has(path)) return null;
      const cover = await resolveLocalLibraryCover(row, {
        categoryLabel: row.category_level_1?.trim() || libraryCategoryLabel(categoryId),
        subCategory,
        trackPath: path
      });
      const audioInfo = path ? await readLocalLibraryTrackAudioInfo(path) : audioInfoFromFileStat(row.final_filename, null);

      return appendAudioFileInfo({
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
      }, audioInfo);
    }));

  return [
    ...manifestTracks.filter(Boolean),
    ...await readImportedLocalAudioLibraryTracks({ musicState })
  ];
}

function decodeProcMountField(value) {
  return String(value ?? "").replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
}

function isPathWithin(root, candidate) {
  const safeRoot = resolve(root);
  const safeCandidate = resolve(candidate);
  return safeCandidate === safeRoot || safeCandidate.startsWith(`${safeRoot}${sep}`);
}

function buildLibraryMountId(rootPath, usedIds, preferredName = "") {
  const fallback = `drive-${usedIds.size + 1}`;
  const sourceName = basename(String(preferredName || "").replace(/\\/g, "/"));
  const rawName = sourceName || basename(resolve(rootPath)) || fallback;
  let id = rawName
    .replace(/[\\/]+/g, "-")
    .replace(/^\.+$/, "")
    .trim()
    || fallback;
  let candidate = id;
  for (let suffix = 2; usedIds.has(candidate); suffix += 1) {
    candidate = `${id}-${suffix}`;
  }
  usedIds.add(candidate);
  return candidate;
}

function buildUsbMountId(rootPath, usedIds) {
  return buildLibraryMountId(rootPath, usedIds);
}

async function readProcMountEntries() {
  try {
    return (await readFile("/proc/mounts", "utf8"))
      .split("\n")
      .map((line) => line.trim().split(/\s+/))
      .filter((parts) => parts[1])
      .map((parts) => ({
        source: decodeProcMountField(parts[0]),
        target: decodeProcMountField(parts[1]),
        type: parts[2] ?? ""
      }));
  } catch {
    return [];
  }
}

async function readMountedPaths() {
  return (await readProcMountEntries()).map((entry) => entry.target);
}

async function readMountSourceForPath(pathValue) {
  const safePath = resolve(pathValue);
  const matches = (await readProcMountEntries()).filter((entry) => resolve(entry.target) === safePath);
  return matches.at(-1)?.source ?? null;
}

function shouldSkipUsbLibraryRoot(rootPath) {
  const mountName = basename(resolve(rootPath));
  return !mountName
    || mountName.startsWith(".")
    || USB_LIBRARY_SKIPPED_MOUNT_NAMES.has(mountName.toLowerCase());
}

async function resolveReadableDirectory(pathValue) {
  const absolutePath = resolve(pathValue);
  try {
    const info = await stat(absolutePath);
    return info.isDirectory() ? absolutePath : null;
  } catch {
    return null;
  }
}

async function discoverUsbLibraryRoots() {
  const explicitRoots = [];
  for (const rootPath of USB_LIBRARY_ROOTS) {
    const absolutePath = await resolveReadableDirectory(rootPath);
    if (absolutePath && !shouldSkipUsbLibraryRoot(absolutePath)) {
      explicitRoots.push(absolutePath);
    }
  }
  if (explicitRoots.length > 0) {
    return Array.from(new Set(explicitRoots)).sort((left, right) => left.localeCompare(right));
  }

  const mountPaths = await readMountedPaths();
  const candidates = [];
  for (const mountPath of mountPaths) {
    if (!USB_LIBRARY_AUTO_ROOTS.some((baseRoot) => isPathWithin(baseRoot, mountPath))) continue;
    if (USB_LIBRARY_AUTO_ROOTS.some((baseRoot) => resolve(baseRoot) === resolve(mountPath))) continue;
    if (shouldSkipUsbLibraryRoot(mountPath)) continue;
    const absolutePath = await resolveReadableDirectory(mountPath);
    if (absolutePath) candidates.push(absolutePath);
  }

  return Array.from(new Set(candidates)).sort((left, right) => left.localeCompare(right));
}

function resolveNasSourceMountPoint(source) {
  return resolve(NAS_MOUNT_ROOT, normalizeNasId(source?.id));
}

function resolveNasSourceContentRoot(source) {
  const mountPoint = resolveNasSourceMountPoint(source);
  const folder = normalizeNasFolderPath(source?.path);
  return folder ? resolve(mountPoint, ...folder.split("/")) : mountPoint;
}

function resolveNasSourceMpdEntryPath(source) {
  return resolve(NAS_MPD_ENTRY_ROOT, normalizeNasMountName(source?.mountName, source?.name || "NAS"));
}

function buildNasRemoteShare(source) {
  return `//${source.host}/${source.share}`;
}

function nasMpdUpdateTarget(source) {
  const mountName = normalizeNasMountName(source?.mountName, source?.name || "NAS");
  return normalizeSafeRelativePath(posix.join(NAS_LIBRARY_MPD_PREFIX, mountName));
}

async function discoverNasLibraryRootEntries() {
  const entries = [];
  const configuredState = await readNasSourcesState();
  for (const source of configuredState.sources) {
    if (source.enabled === false) continue;
    const mpdEntry = await resolveReadableDirectory(resolveNasSourceMpdEntryPath(source));
    if (!mpdEntry) continue;
    entries.push({
      rootPath: mpdEntry,
      mountId: normalizeNasMountName(source.mountName, source.name),
      sourceId: source.id,
      sourceKind: "configured"
    });
  }

  for (const rootPath of NAS_LIBRARY_ROOTS) {
    const absolutePath = await resolveReadableDirectory(rootPath);
    if (absolutePath) {
      entries.push({
        rootPath: absolutePath,
        mountId: null,
        sourceId: null,
        sourceKind: "manual"
      });
    }
  }

  const seen = new Set();
  return entries
    .filter((entry) => {
      const key = resolve(entry.rootPath);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => left.rootPath.localeCompare(right.rootPath));
}

async function discoverNasLibraryRoots() {
  return (await discoverNasLibraryRootEntries()).map((entry) => entry.rootPath);
}

async function buildNasMountId(rootPath, usedIds) {
  return buildLibraryMountId(rootPath, usedIds, await readMountSourceForPath(rootPath));
}

async function collectUsbAudioFiles(rootPath, options = {}) {
  const limit = options.limit ?? USB_LIBRARY_MAX_TRACKS;
  const files = [];
  const stack = [{ path: rootPath, depth: 0 }];
  const maxDepth = 10;

  while (stack.length > 0 && files.length < limit) {
    const current = stack.pop();
    let entries;
    try {
      entries = await readdir(current.path, { withFileTypes: true });
    } catch {
      continue;
    }

    entries
      .sort((left, right) => left.name.localeCompare(right.name))
      .reverse()
      .forEach((entry) => {
        if (files.length >= limit) return;
        if (!entry.name || entry.name.startsWith(".") || entry.name.startsWith("._")) return;
        const absolutePath = resolve(current.path, entry.name);
        if (!isPathWithin(rootPath, absolutePath)) return;
        if (entry.isDirectory()) {
          if (current.depth < maxDepth) {
            stack.push({ path: absolutePath, depth: current.depth + 1 });
          }
          return;
        }
        if (!entry.isFile()) return;
        if (!USB_LIBRARY_AUDIO_EXTENSIONS.has(extname(entry.name).toLowerCase())) return;
        files.push(absolutePath);
      });
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function usbTrackTitleFromPath(filePath) {
  return basename(filePath, extname(filePath))
    .replace(/\s+-\s+\d{2}m\d{2}s\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    || "Untitled";
}

function appendAudioFileInfo(track, audioInfo) {
  return {
    ...track,
    durationSeconds: track.durationSeconds ?? audioInfo.durationSeconds,
    fileSizeBytes: audioInfo.fileSizeBytes,
    codec: audioInfo.codec,
    container: audioInfo.container,
    sampleRateHz: audioInfo.sampleRateHz,
    bitrateKbps: audioInfo.bitrateKbps,
    bitDepth: audioInfo.bitDepth,
    channels: audioInfo.channels
  };
}

async function readImportedLocalAudioLibraryTracks(options = {}) {
  const favoritePaths = new Set((options.musicState ?? readMusicLibraryStateSync()).favorites.trackPaths);
  const mpdPrefix = normalizeSafeRelativePath(MPD_DEFAULT_QUEUE_PATH);
  const importsMpdPath = normalizeSafeRelativePath(mpdPrefix ? posix.join(mpdPrefix, LOCAL_LIBRARY_IMPORTS_DIR_NAME) : LOCAL_LIBRARY_IMPORTS_DIR_NAME);
  const importsRoot = resolveMpdFilePath(importsMpdPath);
  if (!importsRoot) return [];

  try {
    const info = await stat(importsRoot);
    if (!info.isDirectory()) return [];
  } catch {
    return [];
  }

  const files = await collectUsbAudioFiles(importsRoot, { limit: USB_LIBRARY_MAX_TRACKS });
  const tracks = [];
  for (const absolutePath of files) {
    const relativeFilePath = normalizeSafeRelativePath(relative(importsRoot, absolutePath).split(sep).join("/"));
    if (!relativeFilePath) continue;
    const localTrackPath = normalizeSafeRelativePath(posix.join(LOCAL_LIBRARY_IMPORTS_DIR_NAME, relativeFilePath));
    if (!localTrackPath) continue;
    const audioInfo = await readAudioFileInfo(absolutePath);
    const sourceGroup = localTrackPath.split("/")[1] || LOCAL_LIBRARY_IMPORTS_DIR_NAME;
    const idHash = createHash("sha1").update(localTrackPath).digest("hex").slice(0, 12);
    tracks.push(appendAudioFileInfo({
      id: `local-import-${idHash}`,
      title: audioInfo.title || usbTrackTitleFromPath(absolutePath),
      artist: audioInfo.artist || "Unknown Artist",
      album: audioInfo.album || `Local / ${LOCAL_LIBRARY_IMPORTS_DIR_NAME}`,
      storage: "local",
      categoryId: "focus",
      subCategory: sourceGroup,
      durationSeconds: audioInfo.durationSeconds,
      path: localTrackPath,
      albumArtUrl: null,
      albumArtLabel: null,
      albumArtScope: null,
      active: false,
      favorite: favoritePaths.has(localTrackPath)
    }, audioInfo));
  }

  return tracks;
}

async function readUsbAudioLibraryTracks(options = {}) {
  const roots = await discoverUsbLibraryRoots();
  const favoritePaths = new Set((options.musicState ?? readMusicLibraryStateSync()).favorites.trackPaths);
  const usedIds = new Set();
  const tracks = [];

  for (const rootPath of roots) {
    const mountId = buildUsbMountId(rootPath, usedIds);
    const files = await collectUsbAudioFiles(rootPath, { limit: Math.max(0, USB_LIBRARY_MAX_TRACKS - tracks.length) });
    for (const absolutePath of files) {
      if (tracks.length >= USB_LIBRARY_MAX_TRACKS) break;
      const relativeFilePath = normalizeSafeRelativePath(relative(rootPath, absolutePath).split(sep).join("/"));
      if (!relativeFilePath) continue;
      const mpdPath = normalizeSafeRelativePath(posix.join(USB_LIBRARY_MPD_PREFIX, mountId, relativeFilePath));
      if (!mpdPath) continue;
      const idHash = createHash("sha1").update(`${rootPath}\0${relativeFilePath}`).digest("hex").slice(0, 12);
      const audioInfo = await readAudioFileInfo(absolutePath);
      tracks.push(appendAudioFileInfo({
        id: `usb-${mountId}-${idHash}`,
        title: audioInfo.title || usbTrackTitleFromPath(absolutePath),
        artist: audioInfo.artist || "Unknown Artist",
        album: audioInfo.album || `USB / ${mountId}`,
        storage: "usb",
        categoryId: "usb",
        subCategory: mountId,
        durationSeconds: audioInfo.durationSeconds,
        path: mpdPath,
        albumArtUrl: null,
        albumArtLabel: null,
        albumArtScope: null,
        active: false,
        favorite: favoritePaths.has(mpdPath),
        ...(options.includeAbsolutePath ? { _absolutePath: absolutePath, _sourceRelativePath: relativeFilePath } : {})
      }, audioInfo));
    }
  }

  return tracks;
}

async function readNasAudioLibraryTracks(options = {}) {
  const roots = await discoverNasLibraryRootEntries();
  const favoritePaths = new Set((options.musicState ?? readMusicLibraryStateSync()).favorites.trackPaths);
  const usedIds = new Set();
  const tracks = [];

  for (const rootEntry of roots) {
    const rootPath = rootEntry.rootPath;
    const mountId = rootEntry.mountId
      ? buildLibraryMountId(rootPath, usedIds, rootEntry.mountId)
      : await buildNasMountId(rootPath, usedIds);
    const files = await collectUsbAudioFiles(rootPath, { limit: Math.max(0, NAS_LIBRARY_MAX_TRACKS - tracks.length) });
    for (const absolutePath of files) {
      if (tracks.length >= NAS_LIBRARY_MAX_TRACKS) break;
      const relativeFilePath = normalizeSafeRelativePath(relative(rootPath, absolutePath).split(sep).join("/"));
      if (!relativeFilePath) continue;
      const mpdPath = normalizeSafeRelativePath(posix.join(NAS_LIBRARY_MPD_PREFIX, mountId, relativeFilePath));
      if (!mpdPath) continue;
      const idHash = createHash("sha1").update(`${rootPath}\0${relativeFilePath}`).digest("hex").slice(0, 12);
      const audioInfo = await readAudioFileInfo(absolutePath);
      tracks.push(appendAudioFileInfo({
        id: `nas-${mountId}-${idHash}`,
        title: audioInfo.title || usbTrackTitleFromPath(absolutePath),
        artist: audioInfo.artist || "Unknown Artist",
        album: audioInfo.album || `NAS / ${mountId}`,
        storage: "nas",
        categoryId: "nas",
        subCategory: mountId,
        durationSeconds: audioInfo.durationSeconds,
        path: mpdPath,
        albumArtUrl: null,
        albumArtLabel: null,
        albumArtScope: null,
        active: false,
        favorite: favoritePaths.has(mpdPath),
        ...(rootEntry.sourceId ? { sourceId: rootEntry.sourceId } : {}),
        ...(rootEntry.sourceKind ? { sourceKind: rootEntry.sourceKind } : {})
      }, audioInfo));
    }
  }

  return tracks;
}

function publicNasStatus(source) {
  const lastStatus = normalizeNasLastStatus(source?.lastStatus, source?.sourceKind === "manual" ? "manual" : "offline");
  return {
    status: lastStatus.status,
    checkedAt: lastStatus.checkedAt,
    lastError: lastStatus.lastError,
    lastRawError: lastStatus.lastRawError
  };
}

async function buildPublicNasSource(source, tracks = []) {
  const sourceId = source.id;
  const mountName = normalizeNasMountName(source.mountName, source.name);
  const trackCount = tracks.filter((track) => (
    track.sourceId === sourceId || (!track.sourceId && track.subCategory === mountName)
  )).length;
  const credential = source.authMode === "password" ? await readNasCredential(source.id) : null;
  return {
    id: source.id,
    name: source.name,
    host: source.host,
    port: source.port,
    share: source.share,
    path: source.path,
    authMode: source.authMode,
    username: source.authMode === "password" ? source.username : "",
    enabled: source.enabled !== false,
    mountName,
    mountPoint: resolveNasSourceMountPoint(source),
    mpdPath: nasMpdUpdateTarget(source),
    smbVersion: source.smbVersion,
    status: publicNasStatus(source).status,
    lastStatus: publicNasStatus(source),
    lastError: publicNasStatus(source).lastError,
    lastRawError: publicNasStatus(source).lastRawError,
    lastScanAt: source.lastScanAt ?? null,
    trackCount,
    sourceKind: source.sourceKind ?? "configured",
    readOnly: source.readOnly === true,
    hasCredentials: Boolean(credential?.password)
  };
}

async function buildManualNasSources(tracks = []) {
  const entries = (await discoverNasLibraryRootEntries()).filter((entry) => entry.sourceKind === "manual");
  const usedIds = new Set();
  const sources = [];
  for (const entry of entries) {
    const mountName = await buildNasMountId(entry.rootPath, usedIds);
    const idHash = createHash("sha1").update(entry.rootPath).digest("hex").slice(0, 10);
    sources.push({
      id: `manual-${idHash}`,
      name: mountName,
      host: "",
      port: 0,
      share: "",
      path: entry.rootPath,
      authMode: "manual",
      username: "",
      enabled: true,
      mountName,
      mountPoint: entry.rootPath,
      mpdPath: normalizeSafeRelativePath(posix.join(NAS_LIBRARY_MPD_PREFIX, mountName)),
      smbVersion: null,
      status: "manual",
      lastStatus: { status: "manual", checkedAt: null, lastError: null },
      lastError: null,
      lastScanAt: null,
      trackCount: tracks.filter((track) => track.subCategory === mountName).length,
      sourceKind: "manual",
      readOnly: true,
      hasCredentials: false
    });
  }
  return sources;
}

async function buildNasSourcesPayload(options = {}) {
  const state = await readNasSourcesState();
  const tracks = options.tracks ?? await readNasAudioLibraryTracks();
  const configuredSources = await Promise.all(state.sources.map((source) => buildPublicNasSource(source, tracks)));
  const manualSources = await buildManualNasSources(tracks);
  return {
    sources: [...configuredSources, ...manualSources],
    configuredCount: configuredSources.length,
    legacyCount: manualSources.length,
    updatedAt: new Date().toISOString()
  };
}

async function saveNasSource(payload) {
  const state = await readNasSourcesState();
  const existing = payload?.id ? state.sources.find((source) => source.id === normalizeNasId(payload.id)) : null;
  const source = normalizeNasSource(payload, existing);
  if (source.authMode === "password") {
    const hasIncomingPassword = payload && Object.hasOwn(payload, "password");
    if (hasIncomingPassword) {
      await writeNasCredential(source.id, source.username, payload.password);
    } else {
      const previousCredential = await readNasCredential(source.id);
      if (!previousCredential?.password) {
        throw new Error("NAS password is required for username/password access");
      }
      if (previousCredential.username !== source.username) {
        await writeNasCredential(source.id, source.username, previousCredential.password);
      }
    }
  } else {
    await deleteNasCredential(source.id);
  }

  const nextSources = state.sources.filter((entry) => entry.id !== source.id);
  nextSources.push(source);
  await writeNasSourcesState({ ...state, sources: nextSources });
  return await buildNasSourcesPayload();
}

async function updateNasSourceRuntimeStatus(sourceId, patch) {
  const state = await readNasSourcesState();
  const index = state.sources.findIndex((source) => source.id === sourceId);
  if (index === -1) return null;
  const current = state.sources[index];
  const next = {
    ...current,
    ...patch,
    lastStatus: normalizeNasLastStatus(patch.lastStatus ?? current.lastStatus, current.lastStatus?.status ?? "offline"),
    updatedAt: new Date().toISOString()
  };
  state.sources.splice(index, 1, next);
  await writeNasSourcesState(state);
  return next;
}

async function findNasSourceForAction(sourceId, payload = null) {
  if (sourceId === "_draft" || sourceId === "draft") {
    return normalizeNasSource(payload ?? {});
  }
  const state = await readNasSourcesState();
  const source = state.sources.find((entry) => entry.id === normalizeNasId(sourceId));
  if (!source) throw new Error("NAS source not found");
  return payload && Object.keys(payload).length > 0
    ? normalizeNasSource({ ...source, ...payload, id: source.id }, source)
    : source;
}

async function buildNasCredentialForAction(source, payload = null) {
  if (source.authMode !== "password") return { credentialPath: null, cleanup: async () => {} };
  const hasIncomingPassword = payload && Object.hasOwn(payload, "password");
  const username = String(payload?.username ?? source.username ?? "").trim();
  if (hasIncomingPassword) {
    const tempPath = resolve(NAS_CREDENTIALS_DIR, `.${source.id}-${Date.now().toString(36)}.cred`);
    await writeNasCredentialFile(tempPath, username, payload.password);
    return {
      credentialPath: tempPath,
      cleanup: async () => {
        try {
          await unlink(tempPath);
        } catch {
          // Best effort cleanup for temporary test credentials.
        }
      }
    };
  }

  const credential = await readNasCredential(source.id);
  if (!credential?.password) throw new Error("NAS credentials are not saved");
  return { credentialPath: nasCredentialPath(source.id), cleanup: async () => {} };
}

function buildNasMountEnv(source, options = {}) {
  return {
    TIKPAL_NAS_ID: source.id,
    TIKPAL_NAS_NAME: source.name,
    TIKPAL_NAS_HOST: source.host,
    TIKPAL_NAS_PORT: String(source.port),
    TIKPAL_NAS_SHARE: source.share,
    TIKPAL_NAS_PATH: source.path,
    TIKPAL_NAS_AUTH_MODE: source.authMode,
    TIKPAL_NAS_USERNAME: source.username ?? "",
    TIKPAL_NAS_CREDENTIALS: options.credentialPath ?? "",
    TIKPAL_NAS_REMOTE: buildNasRemoteShare(source),
    TIKPAL_NAS_MOUNT_POINT: resolveNasSourceMountPoint(source),
    TIKPAL_NAS_CONTENT_ROOT: resolveNasSourceContentRoot(source),
    TIKPAL_NAS_MPD_ENTRY: resolveNasSourceMpdEntryPath(source),
    TIKPAL_NAS_MPD_PATH: nasMpdUpdateTarget(source) ?? "",
    TIKPAL_NAS_SMB_VERSION: options.smbVersion ?? source.smbVersion ?? "3.0"
  };
}

function buildDefaultNasMountOptions(source, smbVersion, credentialPath) {
  const options = [
    "ro",
    "uid=mpd",
    "gid=audio",
    "iocharset=utf8",
    "nounix",
    "soft",
    `port=${source.port}`,
    `vers=${smbVersion}`
  ];
  if (source.authMode === "password") {
    if (!credentialPath) throw new Error("NAS credential file is required");
    options.push(`credentials=${credentialPath}`);
  } else {
    options.push("guest", "username=guest", "password=");
  }
  return options.join(",");
}

async function runDefaultNasMount(source, options = {}) {
  if (API_MODE !== "mpc") return;
  const smbVersion = options.smbVersion ?? source.smbVersion ?? "3.0";
  const mountPoint = resolveNasSourceMountPoint(source);
  const contentRoot = resolveNasSourceContentRoot(source);
  const mpdEntry = resolveNasSourceMpdEntryPath(source);
  const mountOptions = buildDefaultNasMountOptions(source, smbVersion, options.credentialPath);
  await runCommand([
    `sudo -n mkdir -p ${shellQuote(mountPoint)} ${shellQuote(dirname(mpdEntry))}`,
    `if ! findmnt -rn --mountpoint ${shellQuote(mountPoint)} >/dev/null 2>&1; then sudo -n mount -t cifs ${shellQuote(buildNasRemoteShare(source))} ${shellQuote(mountPoint)} -o ${shellQuote(mountOptions)}; fi`,
    `test -d ${shellQuote(contentRoot)}`,
    `sudo -n mkdir -p ${shellQuote(mpdEntry)}`,
    `if ! findmnt -rn --mountpoint ${shellQuote(mpdEntry)} >/dev/null 2>&1; then sudo -n mount --bind ${shellQuote(contentRoot)} ${shellQuote(mpdEntry)}; fi`
  ].join(" && "), { timeout: 30_000, includeStdoutOnFailure: true });
}

async function runDefaultNasUnmount(source) {
  if (API_MODE !== "mpc") return;
  const mountPoint = resolveNasSourceMountPoint(source);
  const mpdEntry = resolveNasSourceMpdEntryPath(source);
  await runCommand([
    `if findmnt -rn --mountpoint ${shellQuote(mpdEntry)} >/dev/null 2>&1; then sudo -n umount ${shellQuote(mpdEntry)}; fi`,
    `if findmnt -rn --mountpoint ${shellQuote(mountPoint)} >/dev/null 2>&1; then sudo -n umount ${shellQuote(mountPoint)}; fi`
  ].join(" && "), { timeout: 15_000, allowFailure: true });
}

async function runNasMountCommand(source, options = {}) {
  const env = buildNasMountEnv(source, options);
  if (NAS_MOUNT_COMMAND.trim()) {
    await runCommand(NAS_MOUNT_COMMAND, { timeout: 30_000, env, includeStdoutOnFailure: true });
    return;
  }
  await runDefaultNasMount(source, options);
}

async function runNasUnmountCommand(source) {
  const env = buildNasMountEnv(source);
  if (NAS_UNMOUNT_COMMAND.trim()) {
    await runCommand(NAS_UNMOUNT_COMMAND, { timeout: 15_000, env, allowFailure: true, includeStdoutOnFailure: true });
    return;
  }
  await runDefaultNasUnmount(source);
}

async function updateMpdForNasSource(source) {
  const target = nasMpdUpdateTarget(source);
  if (API_MODE === "mpc" && target) {
    await runMpc(["update", target], { timeout: 8000, allowFailure: true });
  }
  return target;
}

async function mountNasSource(source, payload = null) {
  const credential = await buildNasCredentialForAction(source, payload);
  const versions = source.smbVersion ? [source.smbVersion, ...NAS_SMB_VERSIONS.filter((version) => version !== source.smbVersion)] : NAS_SMB_VERSIONS;
  let lastError = null;
  try {
    for (const smbVersion of versions) {
      try {
        await runNasMountCommand(source, { credentialPath: credential.credentialPath, smbVersion });
        const mpdPath = await updateMpdForNasSource(source);
        const scanRoot = await resolveReadableDirectory(resolveNasSourceMpdEntryPath(source));
        const trackCount = scanRoot ? (await collectUsbAudioFiles(scanRoot, { limit: NAS_LIBRARY_MAX_TRACKS })).length : 0;
        const updated = await updateNasSourceRuntimeStatus(source.id, {
          smbVersion,
          lastScanAt: new Date().toISOString(),
          lastStatus: { status: "ready", checkedAt: new Date().toISOString(), lastError: null, lastRawError: null }
        });
        return {
          ok: true,
          source: updated ?? { ...source, smbVersion, lastStatus: { status: "ready", checkedAt: new Date().toISOString(), lastError: null, lastRawError: null } },
          mpdPath,
          trackCount,
          smbVersion
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    throw createNasMountError(lastError || "NAS mount failed");
  } finally {
    await credential.cleanup();
  }
}

async function testNasSource(sourceId, payload = null) {
  const source = await findNasSourceForAction(sourceId, payload);
  try {
    const result = await mountNasSource(source, payload);
    return {
      ok: true,
      status: "ready",
      source: await buildPublicNasSource(result.source, await readNasAudioLibraryTracks()),
      mpdPath: result.mpdPath,
      trackCount: result.trackCount,
      smbVersion: result.smbVersion
    };
  } catch (error) {
    const rawMessage = error?.lastRawError ?? (error instanceof Error ? error.message : String(error));
    const errorInfo = formatNasMountErrorForUser(rawMessage);
    const message = errorInfo.message ?? "Could not mount NAS.";
    if (sourceId !== "_draft" && sourceId !== "draft") {
      await updateNasSourceRuntimeStatus(source.id, {
        lastStatus: { status: "check_setup", checkedAt: new Date().toISOString(), lastError: message, lastRawError: errorInfo.rawMessage }
      });
    }
    return {
      ok: false,
      status: "check_setup",
      lastError: message,
      lastRawError: errorInfo.rawMessage,
      source: await buildPublicNasSource({
        ...source,
        lastStatus: { status: "check_setup", checkedAt: new Date().toISOString(), lastError: message, lastRawError: errorInfo.rawMessage }
      }, [])
    };
  }
}

async function mountSavedNasSource(sourceId, payload = null) {
  const source = await findNasSourceForAction(sourceId, payload);
  try {
    await mountNasSource(source, payload);
  } catch (error) {
    const rawMessage = error?.lastRawError ?? (error instanceof Error ? error.message : String(error));
    const errorInfo = formatNasMountErrorForUser(rawMessage);
    const message = errorInfo.message ?? "Could not mount NAS.";
    await updateNasSourceRuntimeStatus(source.id, {
      lastStatus: { status: "check_setup", checkedAt: new Date().toISOString(), lastError: message, lastRawError: errorInfo.rawMessage }
    });
    const wrapped = new Error(message);
    wrapped.lastRawError = errorInfo.rawMessage;
    throw wrapped;
  }
  return await buildNasSourcesPayload();
}

async function mountEnabledNasSourcesOnStartup() {
  if (API_MODE !== "mpc" || !NAS_AUTO_MOUNT) return;
  const state = await readNasSourcesState();
  const sources = state.sources.filter((source) => source.enabled !== false);
  if (sources.length === 0) return;
  for (const source of sources) {
    let finalErrorInfo = null;
    await updateNasSourceRuntimeStatus(source.id, {
      lastStatus: { status: "checking", checkedAt: new Date().toISOString(), lastError: null, lastRawError: null }
    });

    for (let attempt = 1; attempt <= NAS_AUTO_MOUNT_ATTEMPTS; attempt += 1) {
      if (attempt > 1) {
        await waitMs(NAS_AUTO_MOUNT_RETRY_DELAY_MS);
      }
      try {
        const result = await mountNasSource(source);
        console.log(`tikpal-api mounted NAS ${source.name} at ${result.mpdPath ?? "NAS"} on attempt ${attempt}/${NAS_AUTO_MOUNT_ATTEMPTS}`);
        finalErrorInfo = null;
        break;
      } catch (error) {
        const rawMessage = error?.lastRawError ?? (error instanceof Error ? error.message : String(error));
        finalErrorInfo = formatNasMountErrorForUser(rawMessage);
        const message = finalErrorInfo.message ?? "Could not mount NAS.";
        const retrying = attempt < NAS_AUTO_MOUNT_ATTEMPTS;
        console.warn(`tikpal-api could not auto-mount NAS ${source.name} on attempt ${attempt}/${NAS_AUTO_MOUNT_ATTEMPTS}: ${message}${retrying ? "; retrying" : "; skipping"}${finalErrorInfo.rawMessage ? ` (${finalErrorInfo.rawMessage})` : ""}`);
      }
    }

    if (finalErrorInfo) {
      const message = finalErrorInfo.message ?? "Could not mount NAS.";
      await updateNasSourceRuntimeStatus(source.id, {
        lastStatus: { status: "check_setup", checkedAt: new Date().toISOString(), lastError: message, lastRawError: finalErrorInfo.rawMessage }
      });
    }
  }
}

async function unmountNasSource(sourceId) {
  const source = await findNasSourceForAction(sourceId);
  await runNasUnmountCommand(source);
  await updateNasSourceRuntimeStatus(source.id, {
    lastStatus: { status: "offline", checkedAt: new Date().toISOString(), lastError: null }
  });
  return await buildNasSourcesPayload();
}

async function deleteNasSource(sourceId) {
  const state = await readNasSourcesState();
  const id = normalizeNasId(sourceId);
  const source = state.sources.find((entry) => entry.id === id);
  if (source) {
    await runNasUnmountCommand(source);
    await deleteNasCredential(id);
  }
  await writeNasSourcesState({ ...state, sources: state.sources.filter((entry) => entry.id !== id) });
  return await buildNasSourcesPayload();
}

function normalizeNasCandidate(raw, source = "scan") {
  const locator = parseNasLocator(raw?.url ?? raw?.server ?? raw?.host ?? raw);
  const host = normalizeNasHost(raw?.host ?? locator?.host);
  const share = normalizeNasShare(raw?.share ?? locator?.share);
  if (!host || !share) return null;
  const port = normalizeNasPort(raw?.port ?? locator?.port);
  const path = normalizeNasFolderPath(raw?.path ?? raw?.folder ?? locator?.path);
  const name = normalizeNasDisplayName(raw?.name, share);
  const mountName = normalizeNasMountName(raw?.mountName, name);
  return {
    id: normalizeNasId(raw?.id, `${host}-${share}-${mountName}`),
    name,
    host,
    port,
    share,
    path,
    authMode: normalizeNasAuthMode(raw?.authMode),
    mountName,
    source
  };
}

function parseNasCandidateLine(line, source = "scan") {
  const trimmed = String(line ?? "").trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) {
    try {
      return normalizeNasCandidate(JSON.parse(trimmed), source);
    } catch {
      return null;
    }
  }
  if (trimmed.startsWith("//") || trimmed.toLowerCase().startsWith("smb://")) {
    return normalizeNasCandidate(trimmed, source);
  }
  const [name, host, port, share, path] = trimmed.split("|").map((part) => part.trim());
  return normalizeNasCandidate({ name, host, port, share, path }, source);
}

async function discoverNasCandidates(payload = {}) {
  const candidates = [];
  const pushCandidate = (candidate) => {
    if (!candidate) return;
    const key = `${candidate.host}:${candidate.port}/${candidate.share}/${candidate.path}`;
    if (!candidates.some((entry) => `${entry.host}:${entry.port}/${entry.share}/${entry.path}` === key)) {
      candidates.push(candidate);
    }
  };

  const hintLines = [
    ...String(NAS_DISCOVERY_HINTS).split(/[\n,]+/),
    ...(Array.isArray(payload?.hints) ? payload.hints : [])
  ];
  for (const line of hintLines) {
    pushCandidate(parseNasCandidateLine(line, "hint"));
  }

  if (NAS_DISCOVERY_COMMAND.trim()) {
    const output = await runCommand(NAS_DISCOVERY_COMMAND, { timeout: 12_000, allowFailure: true, maxBuffer: 1024 * 512 });
    const trimmed = output.trim();
    if (trimmed.startsWith("[")) {
      try {
        for (const entry of JSON.parse(trimmed)) {
          pushCandidate(normalizeNasCandidate(entry, "scan"));
        }
      } catch {
        // Fall back to line parsing below.
      }
    }
    for (const line of trimmed.split(/\r?\n/)) {
      pushCandidate(parseNasCandidateLine(line, "scan"));
    }
  }

  return {
    candidates,
    total: candidates.length,
    updatedAt: new Date().toISOString()
  };
}

async function findUsbAudioLibraryTrackForCopy(trackPath) {
  const safePath = normalizeSafeRelativePath(trackPath);
  if (!safePath || !isPlayableUsbLibraryMpdPath(safePath)) {
    throw new Error("copy_to_local requires a playable USB library track path");
  }
  const usbTracks = await readUsbAudioLibraryTracks({ includeAbsolutePath: true });
  const track = usbTracks.find((candidate) => normalizeSafeRelativePath(candidate.path) === safePath);
  if (!track?._absolutePath) throw new Error("USB track is not available");
  return track;
}

function buildLocalImportTrackPathForUsbTrack(track) {
  const safePath = normalizeSafeRelativePath(track?.path);
  if (!safePath) throw new Error("USB track path is required");
  const parts = safePath.split("/");
  const sourceRelativePath = normalizeSafeRelativePath(track?._sourceRelativePath ?? parts.slice(2).join("/"));
  if (!sourceRelativePath) throw new Error("USB track relative path is not safe");
  return normalizeSafeRelativePath(posix.join(LOCAL_LIBRARY_IMPORTS_DIR_NAME, track.subCategory || "USB", sourceRelativePath));
}

function buildMpdImportTrackPath(localTrackPath) {
  const safePath = normalizeSafeRelativePath(localTrackPath);
  if (!safePath) throw new Error("Local import path is not safe");
  const mpdPrefix = normalizeSafeRelativePath(MPD_DEFAULT_QUEUE_PATH);
  return normalizeSafeRelativePath(mpdPrefix ? posix.join(mpdPrefix, safePath) : safePath);
}

function buildMpdUpdateTargetsForTrack(mpdTrackPath) {
  const safePath = normalizeSafeRelativePath(mpdTrackPath);
  if (!safePath) return [];
  const targets = [];
  const pushTarget = (target) => {
    const safeTarget = normalizeSafeRelativePath(target);
    if (safeTarget && !targets.includes(safeTarget)) targets.push(safeTarget);
  };

  let current = posix.dirname(safePath);
  while (current && current !== ".") {
    pushTarget(current);
    current = posix.dirname(current);
  }
  pushTarget(MPD_DEFAULT_QUEUE_PATH);
  return targets;
}

async function isMpdTrackIndexed(mpdTrackPath) {
  const safePath = normalizeSafeRelativePath(mpdTrackPath);
  if (!safePath) return false;
  const listed = await runMpc(["listall", safePath], { allowFailure: true });
  return listed.split("\n").map((line) => line.trim()).includes(safePath);
}

async function refreshMpdTrackIndex(mpdTrackPath) {
  if (API_MODE !== "mpc") return true;
  const safePath = normalizeSafeRelativePath(mpdTrackPath);
  if (!safePath) return false;
  if (await isMpdTrackIndexed(safePath)) return true;

  for (const target of buildMpdUpdateTargetsForTrack(safePath)) {
    await runMpc(["update", target], { allowFailure: true, timeout: 5000 });
  }

  const deadline = Date.now() + MPD_LIBRARY_UPDATE_WAIT_MS;
  while (Date.now() < deadline) {
    if (await isMpdTrackIndexed(safePath)) return true;
    await wait(MPD_LIBRARY_UPDATE_POLL_MS);
  }
  return await isMpdTrackIndexed(safePath);
}

async function pathExists(pathValue) {
  try {
    await stat(pathValue);
    return true;
  } catch {
    return false;
  }
}

async function copyUsbLibraryTrackToLocal(trackPath) {
  const usbTrack = await findUsbAudioLibraryTrackForCopy(trackPath);
  const localTrackPath = buildLocalImportTrackPathForUsbTrack(usbTrack);
  const mpdTrackPath = buildMpdImportTrackPath(localTrackPath);
  const destinationPath = resolveMpdFilePath(mpdTrackPath);
  if (!destinationPath) throw new Error("Local import destination is not safe");

  if (await pathExists(destinationPath)) {
    await refreshMpdTrackIndex(mpdTrackPath);
    return { copied: false, copiedTrackPath: localTrackPath };
  }

  await mkdir(dirname(destinationPath), { recursive: true });
  await copyFile(usbTrack._absolutePath, destinationPath);
  await refreshMpdTrackIndex(mpdTrackPath);
  return { copied: true, copiedTrackPath: localTrackPath };
}

async function findLocalAudioLibraryTrackForDelete(trackPath) {
  const safePath = normalizeLocalLibraryStateTrackPath(trackPath);
  if (!safePath || isUsbLibraryTrackPath(safePath)) {
    throw new Error("delete_local requires a local library track path");
  }

  const localTracks = await readLocalAudioLibraryTracks();
  const track = localTracks.find((candidate) => normalizeLocalLibraryStateTrackPath(candidate.path) === safePath);
  if (!track) throw new Error("Local track is not available");

  for (const candidate of buildMpdLocalLibraryTrackPathCandidates(safePath)) {
    if (isUsbLibraryTrackPath(candidate)) continue;
    const absolutePath = resolveMpdFilePath(candidate);
    if (!absolutePath) continue;
    try {
      const info = await stat(absolutePath);
      if (info.isFile()) {
        return { track, safePath, mpdTrackPath: candidate, absolutePath };
      }
    } catch {
      // A manifest-backed row can still be hidden below even if the file is already gone.
    }
  }

  return { track, safePath, mpdTrackPath: buildMpdLocalLibraryTrackPathCandidates(safePath)[0] ?? safePath, absolutePath: null };
}

async function removeTrackPathFromMusicLibraryState(trackPath) {
  const safePath = normalizeLocalLibraryStateTrackPath(trackPath);
  if (!safePath) return await readMusicLibraryState();
  const state = await readMusicLibraryState();
  state.favorites.trackPaths = state.favorites.trackPaths.filter((candidate) => candidate !== safePath);
  state.deletedTrackPaths = uniqueSafeTrackPaths([...(state.deletedTrackPaths ?? []), safePath]);
  state.playlists = state.playlists.map((playlist) => ({
    ...playlist,
    trackPaths: playlist.trackPaths.filter((candidate) => candidate !== safePath),
    updatedAt: playlist.trackPaths.includes(safePath) ? new Date().toISOString() : playlist.updatedAt
  }));
  return await writeMusicLibraryState(state);
}

async function deleteLocalLibraryTrack(trackPath) {
  const target = await findLocalAudioLibraryTrackForDelete(trackPath);
  if (target.absolutePath) {
    await unlink(target.absolutePath);
  }
  await removeTrackPathFromMusicLibraryState(target.safePath);
  if (API_MODE === "mpc" && target.mpdTrackPath) {
    await runMpc(["update", dirname(target.mpdTrackPath)], { allowFailure: true });
  }
  return { deleted: true, deletedTrackPath: target.safePath };
}

async function findLocalAudioLibraryTrackByPath(localTrackPath) {
  const safePath = normalizeLocalLibraryStateTrackPath(localTrackPath);
  if (!safePath) return null;

  const tracks = [
    ...await readLocalAudioLibraryTracks(),
    ...await readUsbAudioLibraryTracks(),
    ...await readNasAudioLibraryTracks()
  ];
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
  if (mpdPrefix && !safePath.startsWith(`${mpdPrefix}/`) && !isExternalLibraryTrackPath(safePath)) {
    pushCandidate(posix.join(mpdPrefix, safePath));
  }
  pushCandidate(safePath);
  return candidates;
}

function isUsbLibraryTrackPath(trackPath) {
  const safePath = normalizeSafeRelativePath(trackPath);
  return Boolean(safePath && USB_LIBRARY_MPD_PREFIX && (
    safePath === USB_LIBRARY_MPD_PREFIX || safePath.startsWith(`${USB_LIBRARY_MPD_PREFIX}/`)
  ));
}

function isNasLibraryTrackPath(trackPath) {
  const safePath = normalizeSafeRelativePath(trackPath);
  return Boolean(safePath && NAS_LIBRARY_MPD_PREFIX && (
    safePath === NAS_LIBRARY_MPD_PREFIX || safePath.startsWith(`${NAS_LIBRARY_MPD_PREFIX}/`)
  ));
}

function isExternalLibraryTrackPath(trackPath) {
  return isUsbLibraryTrackPath(trackPath) || isNasLibraryTrackPath(trackPath);
}

function isLocalImportedLibraryTrackPath(trackPath) {
  const safePath = normalizeSafeRelativePath(trackPath);
  return Boolean(safePath && (
    safePath === LOCAL_LIBRARY_IMPORTS_DIR_NAME || safePath.startsWith(`${LOCAL_LIBRARY_IMPORTS_DIR_NAME}/`)
  ));
}

function isPlayableUsbLibraryMpdPath(trackPath) {
  const safePath = normalizeSafeRelativePath(trackPath);
  if (!safePath || !isUsbLibraryTrackPath(safePath)) return false;
  const fileName = posix.basename(safePath);
  return Boolean(fileName && !fileName.startsWith(".") && !fileName.startsWith("._") && USB_LIBRARY_AUDIO_EXTENSIONS.has(posix.extname(safePath).toLowerCase()));
}

function isPlayableNasLibraryMpdPath(trackPath) {
  const safePath = normalizeSafeRelativePath(trackPath);
  if (!safePath || !isNasLibraryTrackPath(safePath)) return false;
  const fileName = posix.basename(safePath);
  return Boolean(fileName && !fileName.startsWith(".") && !fileName.startsWith("._") && USB_LIBRARY_AUDIO_EXTENSIONS.has(posix.extname(safePath).toLowerCase()));
}

function buildUsbLibraryMpdRootsFromTracks(usbTracks) {
  const roots = [];
  const seen = new Set();
  for (const track of usbTracks) {
    const safePath = normalizeSafeRelativePath(track?.path);
    if (!safePath || !isUsbLibraryTrackPath(safePath)) continue;
    const parts = safePath.split("/");
    const rootPath = parts.length >= 2 ? posix.join(parts[0], parts[1]) : parts[0];
    if (rootPath && !seen.has(rootPath)) {
      seen.add(rootPath);
      roots.push(rootPath);
    }
  }
  return roots;
}

async function hasMpdUsbLibraryRoot(rootPath) {
  const safeRoot = normalizeSafeRelativePath(rootPath);
  if (!safeRoot || !isUsbLibraryTrackPath(safeRoot)) return false;
  const listed = await runMpc(["listall", safeRoot], { allowFailure: true });
  return listed
    .split("\n")
    .map((line) => line.trim())
    .some((line) => line === safeRoot || line.startsWith(`${safeRoot}/`));
}

async function runUsbLibraryScanCommand(label, { allowFailure = false } = {}) {
  if (API_MODE !== "mpc") return false;
  if (usbLibraryScanPromise) {
    try {
      await usbLibraryScanPromise;
      return true;
    } catch (error) {
      if (!allowFailure) throw error;
      return false;
    }
  }

  lastSystemLibraryScanRequestedAt = Date.now();
  const command = USB_LIBRARY_SCAN_COMMAND.trim();
  usbLibraryScanPromise = (async () => {
    if (command) {
      await runSystemActionCommand(command, label);
    } else {
      await runMpc(["update", USB_LIBRARY_MPD_PREFIX]);
    }
  })();

  try {
    await usbLibraryScanPromise;
    return true;
  } catch (error) {
    if (!allowFailure) throw error;
    console.warn(`tikpal-api ${label} failed: ${error instanceof Error ? error.message : "unknown error"}`);
    return false;
  } finally {
    usbLibraryScanPromise = null;
  }
}

function maybeScheduleUsbLibraryAutoUpdate(usbTracks) {
  if (API_MODE !== "mpc" || !USB_LIBRARY_AUTO_UPDATE || usbTracks.length === 0) return;
  const roots = buildUsbLibraryMpdRootsFromTracks(usbTracks);
  if (roots.length === 0) return;
  const signature = `${roots.join("|")}:${usbTracks.length}`;
  const now = Date.now();
  if (signature === lastUsbLibraryAutoUpdateSignature && now - lastUsbLibraryAutoUpdateCheckAt < USB_LIBRARY_AUTO_UPDATE_MIN_MS) {
    return;
  }
  lastUsbLibraryAutoUpdateSignature = signature;
  lastUsbLibraryAutoUpdateCheckAt = now;

  void (async () => {
    const missingRoots = [];
    for (const root of roots) {
      if (!await hasMpdUsbLibraryRoot(root)) missingRoots.push(root);
    }
    if (missingRoots.length === 0) return;
    await runUsbLibraryScanCommand(`usb library auto update (${missingRoots.join(", ")})`, { allowFailure: true });
  })().catch((error) => {
    console.warn(`tikpal-api USB library auto update failed: ${error instanceof Error ? error.message : "unknown error"}`);
  });
}

async function resolveMpdLocalLibraryTrackPath(localTrackPath, options = {}) {
  const candidates = buildMpdLocalLibraryTrackPathCandidates(localTrackPath);
  for (const candidate of candidates) {
    const listed = await runMpc(["listall", candidate], { allowFailure: true });
    if (listed.split("\n").map((line) => line.trim()).includes(candidate)) {
      return candidate;
    }
  }
  if (options.allowUsbRefresh !== false && isUsbLibraryTrackPath(localTrackPath)) {
    await runUsbLibraryScanCommand("usb library track refresh", { allowFailure: true });
    return await resolveMpdLocalLibraryTrackPath(localTrackPath, { ...options, allowUsbRefresh: false });
  }
  return null;
}

function buildMpdLibraryQueueRootCandidates(startTrackPath) {
  const safeStartPath = normalizeLocalLibraryStateTrackPath(startTrackPath);
  if (!safeStartPath) return [];
  const roots = [];
  const pushRoot = (rootPath) => {
    const safeRoot = normalizeSafeRelativePath(rootPath);
    if (safeRoot && !roots.includes(safeRoot)) roots.push(safeRoot);
  };

  if (isExternalLibraryTrackPath(safeStartPath)) {
    const [prefix, mountId] = safeStartPath.split("/");
    pushRoot(mountId ? posix.join(prefix, mountId) : prefix);
    pushRoot(prefix);
    return roots;
  }

  const mpdPrefix = normalizeSafeRelativePath(MPD_DEFAULT_QUEUE_PATH);
  if (mpdPrefix) {
    pushRoot(mpdPrefix);
  } else {
    roots.push("");
  }
  return roots;
}

async function resolveMpdLocalLibraryQueue(startTrackPath, options = {}) {
  const safeStartPath = normalizeLocalLibraryStateTrackPath(startTrackPath);
  if (!safeStartPath) return null;

  const startCandidates = buildMpdLocalLibraryTrackPathCandidates(safeStartPath);
  const isUsbQueue = isUsbLibraryTrackPath(safeStartPath);
  const isNasQueue = isNasLibraryTrackPath(safeStartPath);
  for (const rootPath of buildMpdLibraryQueueRootCandidates(safeStartPath)) {
    const listedTracks = (await runMpc(rootPath ? ["listall", rootPath] : ["listall"], { allowFailure: true }))
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const queueTracks = isUsbQueue
      ? listedTracks.filter(isPlayableUsbLibraryMpdPath)
      : isNasQueue
        ? listedTracks.filter(isPlayableNasLibraryMpdPath)
        : listedTracks;
    if (queueTracks.length === 0) continue;

    const listedTrackSet = new Set(queueTracks);
    const startTrack = startCandidates.find((candidate) => listedTrackSet.has(candidate));
    if (!startTrack) continue;

    return {
      addRootPath: isExternalLibraryTrackPath(safeStartPath) ? null : rootPath,
      mpdTrackPaths: queueTracks,
      startIndex: queueTracks.indexOf(startTrack)
    };
  }

  if (isUsbQueue && options.allowUsbRefresh !== false) {
    await runUsbLibraryScanCommand("usb library queue refresh", { allowFailure: true });
    return await resolveMpdLocalLibraryQueue(safeStartPath, { ...options, allowUsbRefresh: false });
  }

  if (!isUsbQueue && isLocalImportedLibraryTrackPath(safeStartPath) && options.allowLocalImportRefresh !== false) {
    await refreshMpdTrackIndex(buildMpdImportTrackPath(safeStartPath));
    return await resolveMpdLocalLibraryQueue(safeStartPath, { ...options, allowLocalImportRefresh: false });
  }

  return null;
}

function isNasLibrarySource(source) {
  return /\b(nas|smb|nfs)\b/i.test(String(source ?? ""));
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

async function getLocalLibraryStorageSummary() {
  try {
    const info = await statfs(MPD_MUSIC_ROOT);
    const blockSize = Number(info.bsize);
    const blocks = Number(info.blocks);
    const availableBlocks = Number(info.bavail);
    if (!Number.isFinite(blockSize) || !Number.isFinite(blocks) || !Number.isFinite(availableBlocks) || blockSize <= 0 || blocks <= 0) {
      throw new Error("invalid statfs result");
    }
    const totalBytes = blocks * blockSize;
    const freeBytes = Math.max(0, availableBlocks * blockSize);
    const usedBytes = Math.max(0, totalBytes - freeBytes);
    return {
      rootPath: MPD_MUSIC_ROOT,
      totalBytes,
      usedBytes,
      freeBytes,
      usedPercent: Math.max(0, Math.min(100, Math.round((usedBytes / totalBytes) * 100)))
    };
  } catch {
    return {
      rootPath: MPD_MUSIC_ROOT,
      totalBytes: null,
      usedBytes: null,
      freeBytes: null,
      usedPercent: null
    };
  }
}

async function getAudioLibraryPayload(searchParams) {
  const filters = normalizeAudioLibraryFilters(searchParams);
  const state = await getTikpalState();
  const musicState = readMusicLibraryStateSync();
  const localTracks = await readLocalAudioLibraryTracks({ musicState });
  const usbTracks = await readUsbAudioLibraryTracks({ musicState });
  const scannedNasTracks = await readNasAudioLibraryTracks({ musicState });
  maybeScheduleUsbLibraryAutoUpdate(usbTracks);
  const nasTracks = scannedNasTracks.length > 0
    ? scannedNasTracks
    : isNasLibrarySource(state.system.library.source)
    ? buildNasAudioLibraryTracks(state.playback)
    : [];
  const favoriteTracks = [...localTracks, ...nasTracks, ...usbTracks]
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
            ? usbTracks
            : [...localTracks, ...nasTracks, ...usbTracks, ...favoriteTracks, ...recentlyAddedTracks];
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
        trackCount: nasTracks.length,
        categories: []
      },
      {
        id: "usb",
        label: "USB",
        trackCount: usbTracks.length,
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
    localStorage: await getLocalLibraryStorageSummary(),
    updatedAt: state.runtime.updatedAt
  };
}

async function applyAudioLibraryAction(action) {
  if (action?.type !== "copy_to_local" && action?.type !== "delete_local") {
    throw new Error("unsupported audio library action");
  }
  const result = action.type === "copy_to_local"
    ? await copyUsbLibraryTrackToLocal(action.trackPath)
    : await deleteLocalLibraryTrack(action.trackPath);
  const params = new URLSearchParams();
  params.set("storage", "all");
  params.set("limit", "500");
  return {
    ok: true,
    ...(Object.hasOwn(result, "copied") ? { copied: result.copied, copiedTrackPath: result.copiedTrackPath } : {}),
    ...(Object.hasOwn(result, "deleted") ? { deleted: result.deleted, deletedTrackPath: result.deletedTrackPath } : {}),
    library: await getAudioLibraryPayload(params)
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

function getMultiroomEcosystemConfig(id) {
  return MULTIROOM_ECOSYSTEM_CONFIGS[normalizeMultiroomEcosystemId(id)] ?? null;
}

function getMultiroomSourceId(ecosystemId) {
  return getMultiroomEcosystemConfig(ecosystemId)?.sourceId ?? null;
}

function getMultiroomEcosystemIdFromSource(sourceId) {
  return MULTIROOM_SOURCE_TO_ECOSYSTEM[String(sourceId ?? "")] ?? null;
}

function isMultiroomSourceId(sourceId) {
  return Boolean(getMultiroomEcosystemIdFromSource(sourceId));
}

function getMultiroomPlaybackLabel(sourceId) {
  const ecosystemId = getMultiroomEcosystemIdFromSource(sourceId);
  return getMultiroomEcosystemConfig(ecosystemId)?.label ?? "Multi-room Audio";
}

function getActiveMultiroomEcosystem(multiroomState) {
  const activeId = normalizeMultiroomEcosystemId(multiroomState?.activeEcosystemId);
  if (activeId && multiroomState?.ecosystems?.[activeId]?.active) {
    return multiroomState.ecosystems[activeId];
  }
  return MULTIROOM_ECOSYSTEM_IDS
    .map((id) => multiroomState?.ecosystems?.[id])
    .find((state) => state?.active && !state?.comingSoon) ?? null;
}

async function getMultiroomEcosystemRuntimeState(id, intents = null) {
  id = normalizeMultiroomEcosystemId(id);
  const config = getMultiroomEcosystemConfig(id);
  if (!id || !config) {
    throw new Error("Unknown multi-room ecosystem");
  }
  const now = new Date().toISOString();
  if (config.placeholder) {
    return normalizeMultiroomEcosystemState(id, {
      label: config.label,
      lastError: "Coming soon",
      comingSoon: true,
      updatedAt: now
    });
  }

  const persisted = intents?.ecosystems?.[id] ?? null;
  if (API_MODE !== "mpc") {
    return normalizeMultiroomEcosystemState(id, {
      ...(system.multiroom?.ecosystems?.[id] ?? {}),
      enabled: persisted?.enabled ?? system.multiroom?.ecosystems?.[id]?.enabled ?? false,
      label: config.label,
      updatedAt: now
    });
  }

  const serviceName = shellQuote(config.service ?? "");
  const serviceActiveCommand = `systemctl is-active --quiet ${serviceName}`;
  const serviceEnabledCommand = `systemctl is-enabled --quiet ${serviceName}`;
  const [serviceActive, serviceEnabled, ready, active, label] = await Promise.all([
    config.service ? commandSucceeds(serviceActiveCommand, { timeout: 2500 }) : Promise.resolve(false),
    config.service ? commandSucceeds(serviceEnabledCommand, { timeout: 2500 }) : Promise.resolve(false),
    config.readyCommand?.trim() ? commandSucceeds(config.readyCommand, { timeout: 2500 }) : Promise.resolve(false),
    config.activeCommand?.trim() ? commandSucceeds(config.activeCommand, { timeout: 2500 }) : Promise.resolve(false),
    config.labelCommand?.trim() ? runCommand(config.labelCommand, { allowFailure: true, timeout: 2500 }) : Promise.resolve("")
  ]);

  const supported = Boolean(
    config.service
    || config.readyCommand
    || config.activeCommand
    || config.enableCommand
    || config.disableCommand
    || config.labelCommand
  );
  const installed = ready || serviceActive || serviceEnabled;
  const enabled = persisted?.enabled === true || serviceActive || serviceEnabled;
  const lastError = supported && !installed ? "Check setup" : null;

  return normalizeMultiroomEcosystemState(id, {
    enabled,
    ready: installed,
    active,
    serviceActive,
    label: label.trim() || config.label,
    lastError,
    updatedAt: now
  });
}

async function getRoonBridgeRuntimeState() {
  return await getMultiroomEcosystemRuntimeState("roon", await readMultiroomIntentState());
}

async function releaseMpdForMultiroomEcosystem(ecosystemId, state, { force = false, overwriteHandoff = false } = {}) {
  ecosystemId = normalizeMultiroomEcosystemId(ecosystemId, "roon");
  if (API_MODE !== "mpc" || (!force && !state?.active)) return false;
  const now = Date.now();
  if (!force && now - multiroomMpdReleaseAtMs < 5000) return false;
  multiroomMpdReleaseAtMs = now;

  try {
    const [statusRaw, currentRaw] = await Promise.all([
      runMpc(["status"], { allowFailure: true, timeout: 2500 }),
      runMpc(["--format", "%file%", "current"], { allowFailure: true, timeout: 2500 })
    ]);
    const status = parseMpcStatus(statusRaw);
    const existingHandoff = await readMultiroomHandoffState();
    if (status.state !== "playing") {
      if (force && existingHandoff.ecosystemId === ecosystemId) {
        await clearMultiroomHandoffState();
      }
      return false;
    }
    const currentFile = getEffectiveMpcCurrentFile(extractMpcCurrentFile(currentRaw), status);
    const shouldWriteHandoff = overwriteHandoff || existingHandoff.playbackState !== "playing";
    if (shouldWriteHandoff) {
      await writeMultiroomHandoffState({
        ecosystemId,
        sourceId: isStreamUri(currentFile) ? "radio" : "mpd",
        playbackState: "playing",
        queuePosition: status.currentTrackIndex,
        queueLength: status.queueLength,
        currentFile,
        localTrackPath: isStreamUri(currentFile) ? null : await resolveCurrentLocalLibraryTrackPath(),
        radioStationId: isStreamUri(currentFile) ? await resolveCurrentOrRememberedRadioStationId() : null
      });
    }
    await runMpc([isStreamUri(currentFile) ? "stop" : "pause"], { allowFailure: true, timeout: 2500 });
    return true;
  } catch (error) {
    const label = getMultiroomEcosystemConfig(ecosystemId)?.label ?? "Multi-room Audio";
    console.warn(`tikpal-api could not release MPD for ${label}: ${error instanceof Error ? error.message : "unknown error"}`);
    return false;
  }
}

async function releaseMpdForRoonBridge(state, options = {}) {
  return await releaseMpdForMultiroomEcosystem("roon", state, options);
}

async function restoreMultiroomPlaybackHandoff(ecosystemId = null) {
  ecosystemId = normalizeMultiroomEcosystemId(ecosystemId);
  const handoff = await readMultiroomHandoffState();
  try {
    if (handoff.playbackState !== "playing") return false;
    if (ecosystemId && handoff.ecosystemId !== ecosystemId) return false;

    const status = await readMpcStatusWithTikpalPlaybackMode({ allowFailure: true, timeout: 2500 });
    if (status.queueLength > 0) {
      const queuePosition = Number(handoff.queuePosition);
      const playArgs = Number.isInteger(queuePosition) && queuePosition >= 1 && queuePosition <= status.queueLength
        ? ["play", String(queuePosition)]
        : ["play"];
      await runMpc(playArgs, { allowFailure: true, timeout: 2500 });
      return true;
    }

    if (handoff.sourceId === "radio") {
      await applySourceSwitch({
        target: "radio",
        ...(handoff.radioStationId ? { radioStationId: handoff.radioStationId } : {})
      }, { rememberSource: false });
      return true;
    }

    if (handoff.sourceId === "mpd") {
      await applySourceSwitch({
        target: "mpd",
        ...(handoff.localTrackPath ? { localTrackPath: handoff.localTrackPath } : {})
      }, { rememberSource: false });
      return true;
    }

    return false;
  } catch (error) {
    console.warn(`tikpal-api could not restore MPD after multi-room switch: ${error instanceof Error ? error.message : "unknown error"}`);
    return false;
  } finally {
    await clearMultiroomHandoffState();
  }
}

async function restoreRoonBridgePlaybackHandoff() {
  return await restoreMultiroomPlaybackHandoff("roon");
}

async function readMultiroomState({ releaseMpd = true } = {}) {
  const intents = await readMultiroomIntentState();
  const entries = await Promise.all(MULTIROOM_ECOSYSTEM_IDS.map((id) => getMultiroomEcosystemRuntimeState(id, intents)));
  const ecosystems = Object.fromEntries(entries.map((entry) => [entry.id, entry]));
  const activeEcosystem = getActiveMultiroomEcosystem({ ecosystems });
  if (releaseMpd) {
    await releaseMpdForMultiroomEcosystem(activeEcosystem?.id, activeEcosystem);
  }
  return buildDefaultMultiroomState({
    ecosystems,
    activeEcosystemId: activeEcosystem?.id ?? null,
    updatedAt: new Date().toISOString()
  });
}

async function readRoonBridgeState({ releaseMpd = true } = {}) {
  const state = await readMultiroomState({ releaseMpd });
  return state.ecosystems.roon;
}

async function hasOtherActiveMultiroomEcosystem(ecosystemId) {
  const state = await readMultiroomState({ releaseMpd: false });
  return MULTIROOM_ECOSYSTEM_IDS.some((id) => id !== ecosystemId && state.ecosystems[id]?.active);
}

async function updateMultiroomEcosystemState(ecosystemId, patch = {}) {
  ecosystemId = normalizeMultiroomEcosystemId(ecosystemId);
  const config = getMultiroomEcosystemConfig(ecosystemId);
  if (!ecosystemId || !config) {
    throw new Error("Unknown multi-room ecosystem");
  }
  if (typeof patch.enabled !== "boolean") {
    throw new Error("Multi-room enabled must be true or false");
  }
  if (config.placeholder) {
    throw new Error("Music Assistant is coming soon");
  }
  const command = patch.enabled ? config.enableCommand : config.disableCommand;
  if (API_MODE === "mpc") {
    if (!command?.trim()) {
      throw new Error(patch.enabled ? "Multi-room enable command is not configured" : "Multi-room disable command is not configured");
    }
    if (patch.enabled) {
      const releasedMpd = await releaseMpdForMultiroomEcosystem(ecosystemId, null, { force: true, overwriteHandoff: true });
      try {
        await runSystemActionCommand(command, `${config.label} enable`);
        await writeMultiroomIntentState({ ecosystems: { [ecosystemId]: { enabled: true } } });
      } catch (error) {
        if (releasedMpd) {
          await restoreMultiroomPlaybackHandoff(ecosystemId);
        }
        throw error;
      }
    } else {
      await runSystemActionCommand(command, `${config.label} disable`);
      await writeMultiroomIntentState({ ecosystems: { [ecosystemId]: { enabled: false } } });
      if (!(await hasOtherActiveMultiroomEcosystem(ecosystemId))) {
        await restoreMultiroomPlaybackHandoff(ecosystemId);
      }
    }
  } else {
    const nextState = normalizeMultiroomEcosystemState(ecosystemId, {
      ...(system.multiroom?.ecosystems?.[ecosystemId] ?? {}),
      enabled: patch.enabled,
      serviceActive: patch.enabled,
      ready: patch.enabled,
      active: false,
      label: config.label,
      updatedAt: new Date().toISOString()
    });
    system.multiroom.ecosystems[ecosystemId] = nextState;
    system.multiroom.activeEcosystemId = getActiveMultiroomEcosystem(system.multiroom)?.id ?? null;
    system.multiroom.updatedAt = new Date().toISOString();
    system.roonBridge = system.multiroom.ecosystems.roon;
  }
  return await readMultiroomState({ releaseMpd: false });
}

async function updateRoonBridgeState(patch = {}) {
  const state = await updateMultiroomEcosystemState("roon", patch);
  return state.ecosystems.roon;
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
  clearUpnpMpdReleaseMarker();
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

function markUpnpMpdReleased() {
  upnpMpdReleasedAtMs = Date.now();
}

function clearUpnpMpdReleaseMarker() {
  upnpMpdReleasedAtMs = 0;
}

function hasUpnpMpdReleaseMarker() {
  return upnpMpdReleasedAtMs > 0;
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

async function getMpcAudioSnapshot(currentFile, status = null, options = {}) {
  const radioStations = await getAvailableRadioStations();
  const [audioSourceState, spotifyState, bluetoothState, airplayState, multiroomState, upnpState] = await Promise.all([
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
    readMultiroomState(),
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
  const activeMultiroomEcosystem = getActiveMultiroomEcosystem(multiroomState);
  const activeMultiroomSource = activeMultiroomEcosystem ? getMultiroomSourceId(activeMultiroomEcosystem.id) : null;
  const radioReady = Boolean(RADIO_ACTIVATE_COMMAND || RADIO_DEFAULT_URI || radioStations.length > 0);
  const radioActive = isStreamUri(currentFile);
  const mpcPlaybackState = String(status?.state ?? "").trim().toLowerCase();
  const mpdPlaybackActive = Boolean(currentFile) && mpcPlaybackState !== "stopped";
  const hasUpnpPlaybackMetadata = Boolean(options.upnpPlaybackMetadata?.title);
  const canUseUpnpPlaybackMetadata = hasUpnpPlaybackMetadata
    && (mockArmedSource === "upnp" || upnpState.armed || upnpState.connected || hasUpnpMpdReleaseMarker());
  const upnpMpdPlaybackActive = mockArmedSource === "upnp"
    && mpdPlaybackActive
    && hasUpnpMpdReleaseMarker()
    && canUseUpnpPlaybackMetadata;
  const effectiveUpnpState = upnpMpdPlaybackActive
    ? {
        ...upnpState,
        available: true,
        armed: true,
        connected: true
      }
    : upnpState;
  const activeMpdSource = mpdPlaybackActive
    ? upnpMpdPlaybackActive
      ? "upnp"
      : radioActive
      ? "radio"
      : "mpd"
    : null;
  const canHonorExternalHandoff = Date.now() >= externalAutoArmSuppressedUntilMs;
  const rawConnectedExternalSource = spotifyState.connected
    ? "spotify"
    : bluetoothState.connected
      ? "bluetooth"
      : airplayState.connected
        ? "airplay"
        : effectiveUpnpState.connected
          ? "upnp"
          : null;
  const connectedExternalSource = !mockArmedSource || rawConnectedExternalSource === mockArmedSource
    ? rawConnectedExternalSource
    : null;
  const preferredHandoffSource = canHonorExternalHandoff
    && mockArmedSource
    && COMMAND_HANDOFF_SOURCE_TARGETS.has(mockArmedSource)
    && !activeMpdSource
    ? mockArmedSource
    : null;
  let activeSource = "mpd";
  if (mockArmedSource === "scene") {
    activeSource = "scene";
  } else if (activeMultiroomSource) {
    activeSource = activeMultiroomSource;
  } else if (activeMpdSource) {
    activeSource = activeMpdSource;
  } else if (canHonorExternalHandoff && connectedExternalSource) {
    activeSource = connectedExternalSource;
  } else if (preferredHandoffSource) {
    activeSource = preferredHandoffSource;
  } else if (audioSourceState.connected || audioSourceState.armed) {
    activeSource = "audio";
  } else if (spotifyState.armed) {
    activeSource = "spotify";
  } else if (bluetoothState.armed) {
    activeSource = "bluetooth";
  } else if (airplayState.armed) {
    activeSource = "airplay";
  } else if (effectiveUpnpState.armed) {
    activeSource = "upnp";
  } else if (radioActive) {
    activeSource = "radio";
  }
  const connectedHandoffSource = (activeSource === "spotify" && spotifyState.connected)
    || (activeSource === "bluetooth" && bluetoothState.connected)
    || (activeSource === "airplay" && airplayState.connected)
    || (activeSource === "upnp" && effectiveUpnpState.connected);
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
    multiroomState,
    upnpState: effectiveUpnpState
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
  const mpdPlaybackActive = Boolean(currentFile);
  const cachedConnectedSource = ["spotify", "bluetooth", "airplay", "upnp"].find((source) => (
    mockArmedSource === source
      && tikpalStateSnapshotCache?.state?.audio?.sources?.find((entry) => entry.id === source)?.connectionState === "connected"
  )) ?? null;
  const cachedMultiroomSystem = buildDefaultMultiroomState(
    tikpalStateSnapshotCache?.state?.system?.multiroom
    ?? {
      ecosystems: {
        roon: tikpalStateSnapshotCache?.state?.system?.roonBridge ?? null
      },
      activeEcosystemId: tikpalStateSnapshotCache?.state?.system?.roonBridge?.active ? "roon" : null
    }
  );
  const cachedMultiroomActiveEcosystem = getActiveMultiroomEcosystem(cachedMultiroomSystem);
  const cachedMultiroomActiveSource = cachedMultiroomActiveEcosystem ? getMultiroomSourceId(cachedMultiroomActiveEcosystem.id) : null;
  const canHonorExternalHandoff = Date.now() >= externalAutoArmSuppressedUntilMs;
  const preferredHandoffSource = canHonorExternalHandoff
    && mockArmedSource
    && ["spotify", "bluetooth", "airplay", "upnp"].includes(mockArmedSource)
    && !mpdPlaybackActive
    ? mockArmedSource
    : null;
  let activeSource = "mpd";
  if (mockArmedSource === "scene") {
    activeSource = "scene";
  } else if (cachedMultiroomActiveSource) {
    activeSource = cachedMultiroomActiveSource;
  } else if (preferredHandoffSource) {
    activeSource = preferredHandoffSource;
  } else if (radioActive) {
    activeSource = "radio";
  } else if (mpdPlaybackActive) {
    activeSource = "mpd";
  } else if (canHonorExternalHandoff && cachedConnectedSource) {
    activeSource = cachedConnectedSource;
  } else if (mockArmedSource && ["audio", "spotify", "bluetooth", "airplay", "upnp"].includes(mockArmedSource)) {
    activeSource = mockArmedSource;
  }

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
    multiroomState: cachedMultiroomSystem,
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

async function shouldUseOutputVolumeForMpcAction() {
  const webModeActive = Boolean((await readWebModeRuntimeState()).activeProvider);
  const cachedSource = tikpalStateSnapshotCache?.state?.audio?.currentSource?.id
    ?? tikpalStateSnapshotCache?.state?.playback?.source
    ?? null;
  const source = mockArmedSource ?? cachedSource;
  return webModeActive || source === "scene" || isMultiroomSourceId(source) || COMMAND_HANDOFF_SOURCE_TARGETS.has(source);
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

function isCurrentMpcSourceMultiroom() {
  return isMultiroomSourceId(getCurrentMpcSourceId());
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

async function applyMpcMultiroomPlaybackAction(action) {
  switch (action.type) {
    case "volume_set": {
      const percent = Number(action.value);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        throw new Error("volume_set requires value between 0 and 100");
      }
      await setOutputVolumePercent(percent);
      return;
    }
    case "play_pause":
    case "play":
    case "pause":
    case "next":
    case "previous":
    case "seek":
    case "favorite_toggle":
    case "play_mode_set":
      return;
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

  const status = applyTikpalPlaybackModeToStatus(parseMpcStatus(statusRaw));
  const currentColumns = currentRaw.split("\t");
  const hasFormattedCurrent = currentColumns.length >= 4;
  const [title, artist, album, rawFile, duration] = hasFormattedCurrent
    ? currentColumns
    : ["", "", "", extractMpcCurrentFile(currentRaw), ""];
  const file = getEffectiveMpcCurrentFile(rawFile, status);
  const hasCurrentTrack = Boolean(currentRaw.trim()) || Boolean(file);
  const durationSeconds = parseDuration(duration) ?? status.durationSeconds;
  const upnpPlaybackMetadata = includeSlowRuntimeStatus
    ? await readUpnpPlaybackMetadata()
    : null;
  const trustedUpnpPlaybackMetadata = normalizeUpnpPlaybackMetadata(upnpPlaybackMetadata);
  const nextSystem = includeSlowRuntimeStatus
    ? await getMpcSystemSnapshot(statusRaw, statsRaw)
    : getCachedMpcSystemSnapshot(statusRaw, statsRaw);
  const useCachedSceneSourceRuntimeStatus = includeSourceRuntimeStatus && shouldUseCachedSceneSourceRuntimeStatus(file);
  const audio = includeSourceRuntimeStatus && !useCachedSceneSourceRuntimeStatus
    ? await getMpcAudioSnapshot(file, status, { upnpPlaybackMetadata: trustedUpnpPlaybackMetadata })
    : buildMinimalMpcAudioSnapshot(file);
  const queuePreview = await getMpcQueuePreview(status);
  const playbackSource = audio.sources.find((source) => source.active)?.id ?? audio.currentSource.id;
  const outputVolumePercent = includeOutputVolumeStatus ? await readOutputVolumePercent() : null;
  const webModeActive = includeOutputVolumeStatus && Boolean((await readWebModeRuntimeState()).activeProvider);
  const isSceneSource = playbackSource === "scene";
  const isMultiroomSource = isMultiroomSourceId(playbackSource);
  const multiroomPlaybackLabel = isMultiroomSource ? getMultiroomPlaybackLabel(playbackSource) : null;
  const multiroomPlaybackBrand = multiroomPlaybackLabel?.replace(/\s*Bridge$/i, "") ?? "Multi-room Audio";
  const isExternalOutputSource = playbackSource === "scene" || playbackSource === "spotify" || playbackSource === "bluetooth" || playbackSource === "airplay" || isMultiroomSource;
  const isMpdBackedSource = playbackSource === "mpd" || playbackSource === "audio" || playbackSource === "upnp";
  const hasConfiguredOutputVolume = Boolean(OUTPUT_VOLUME_SET_COMMAND_CONFIGURED && outputVolumePercent !== null);
  const volumePercent = isExternalOutputSource || webModeActive || hasConfiguredOutputVolume
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
  const activeUpnpPlaybackMetadata = playbackSource === "upnp" ? trustedUpnpPlaybackMetadata : null;
  const hasUpnpTrackMetadata = Boolean(activeUpnpPlaybackMetadata?.title);
  const upnpMetadataHasAudibleStream = hasCurrentTrack || activeUpnpPlaybackMetadata?.streamAvailable === true;
  const upnpMetadataOnlyWithoutStream = playbackSource === "upnp" && hasUpnpTrackMetadata && !upnpMetadataHasAudibleStream;
  const rawPlaybackAudio = playbackSource === "bluetooth" && hasBluetoothTrackMetadata
    ? promoteCurrentSourceConnectedFromPlaybackMetadata(audio, "bluetooth")
    : playbackSource === "upnp" && hasUpnpTrackMetadata && upnpMetadataHasAudibleStream
      ? promoteCurrentSourceConnectedFromPlaybackMetadata(audio, "upnp")
    : audio;
  const playbackAudio = upnpMetadataOnlyWithoutStream
    ? demoteCurrentSourceToArmed(rawPlaybackAudio, "upnp", "DLNA metadata received; waiting for audio stream")
    : rawPlaybackAudio;
  const airplayConnected = playbackSource === "airplay" && playbackAudio.currentSource.connectionState === "connected";
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
  const upnpRemoteArtworkUrl = playbackSource === "upnp" && activeUpnpPlaybackMetadata?.title && !activeUpnpPlaybackMetadata.artworkUrl
    ? await resolveRemotePlaybackArtworkUrl({
        playbackSource,
        title: activeUpnpPlaybackMetadata.title,
        artist: activeUpnpPlaybackMetadata.artist,
        album: activeUpnpPlaybackMetadata.album
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

  if (includeSlowRuntimeStatus && !isExternalOutputSource) {
    currentArtworkState = hasCurrentTrack
      ? await resolveCurrentArtworkState({
          playbackSource,
          metadata,
          fallbackTitle: activeUpnpPlaybackMetadata?.title || radioPlaybackMetadata?.title || title || trackTitleFromFile(file),
          fallbackArtist: activeUpnpPlaybackMetadata?.artist || radioPlaybackMetadata?.artist || artist || "Unknown Artist",
          fallbackAlbum: activeUpnpPlaybackMetadata?.album || radioPlaybackMetadata?.album || album || "MPD Queue"
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
          ? playbackAudio.currentSource.connectionState === "connected" ? "playing" : "stopped"
        : isMultiroomSource
          ? "playing"
        : playbackSource === "upnp"
          ? activeUpnpPlaybackMetadata && upnpMetadataHasAudibleStream
            ? mapBluetoothPlaybackState(activeUpnpPlaybackMetadata)
            : hasCurrentTrack ? status.state : playbackAudio.currentSource.connectionState === "connected" ? "playing" : "stopped"
        : hasCurrentTrack ? status.state : "stopped",
      source: playbackSource,
      albumArtUrl: playbackSource === "bluetooth"
        ? bluetoothPlaybackMetadata?.artworkUrl ?? bluetoothRemoteArtworkUrl
        : playbackSource === "airplay"
          ? trustedAirplayPlaybackMetadata?.artworkUrl ?? airplayRemoteArtworkUrl
        : playbackSource === "upnp"
          ? activeUpnpPlaybackMetadata?.artworkUrl
            ?? upnpRemoteArtworkUrl
            ?? (hasCurrentTrack && includeSlowRuntimeStatus && currentArtworkState ? `/api/v1/media/artwork?track=${encodeURIComponent(currentArtworkState.token)}` : null)
          : isMultiroomSource
            ? null
          : playbackSource === "radio" && activeRadioStation?.logoUrl
            ? activeRadioStation.logoUrl
          : !isExternalOutputSource && hasCurrentTrack && includeSlowRuntimeStatus && currentArtworkState ? `/api/v1/media/artwork?track=${encodeURIComponent(currentArtworkState.token)}` : null,
      title: isSceneSource
          ? "Scene Audio"
          : playbackSource === "radio"
          ? radioPlaybackMetadata?.title || metadata.title || title || RADIO_LABEL
          : playbackSource === "spotify"
            ? "Spotify Connect Ready"
          : isMultiroomSource
            ? multiroomPlaybackLabel
          : playbackSource === "upnp"
            ? activeUpnpPlaybackMetadata?.title || (hasCurrentTrack ? metadata.title || title || trackTitleFromFile(file) : "DLNA Ready")
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
            ? playbackAudio.currentSource.connectedLabel
              || (playbackAudio.currentSource.advertisedLabel ? `Choose ${playbackAudio.currentSource.advertisedLabel} in Spotify` : "Choose Tikpal in Spotify")
          : isMultiroomSource
            ? `Playing from ${multiroomPlaybackBrand}.`
          : playbackSource === "upnp"
            ? activeUpnpPlaybackMetadata?.artist || (hasCurrentTrack
              ? metadata.artist || artist || null
              : playbackAudio.currentSource.connectedLabel
                || (playbackAudio.currentSource.advertisedLabel ? `Cast to ${playbackAudio.currentSource.advertisedLabel} with DLNA` : "Cast to Tikpal with DLNA"))
          : playbackSource === "bluetooth"
            ? bluetoothPlaybackMetadata?.artist || (hasBluetoothTrackMetadata
              ? null
              : playbackAudio.currentSource.connectedLabel
                || (playbackAudio.currentSource.advertisedLabel ? `Find ${playbackAudio.currentSource.advertisedLabel} in Bluetooth` : "Pair a device to start playback"))
          : playbackSource === "airplay"
              ? trustedAirplayPlaybackMetadata?.artist || (hasAirplayTrackMetadata
                ? null
                : playbackAudio.currentSource.connectedLabel
                  || (playbackAudio.currentSource.advertisedLabel ? `Choose ${playbackAudio.currentSource.advertisedLabel} from AirPlay` : "Choose Tikpal from AirPlay"))
          : hasCurrentTrack ? metadata.artist || artist || "Unknown Artist" : null,
      album: isSceneSource
          ? currentSceneVideo.label
          : playbackSource === "radio"
          ? radioPlaybackMetadata?.album || metadata.album || album || "Radio"
          : playbackSource === "spotify"
            ? "Spotify Connect"
          : isMultiroomSource
            ? multiroomPlaybackLabel
          : playbackSource === "upnp"
            ? activeUpnpPlaybackMetadata?.album || (hasCurrentTrack ? metadata.album || album || "DLNA Source" : "DLNA Source")
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
        : playbackSource === "upnp"
          ? millisecondsToSeconds(activeUpnpPlaybackMetadata?.positionMs) ?? (isMpdBackedSource && hasCurrentTrack ? status.elapsedSeconds : null)
        : playbackSource === "spotify" || isMultiroomSource
          ? null
        : isMpdBackedSource && hasCurrentTrack ? status.elapsedSeconds : null,
      durationSeconds: isSceneSource
        ? null
        : playbackSource === "bluetooth"
        ? millisecondsToSeconds(bluetoothPlaybackMetadata?.durationMs, { allowZero: false })
        : playbackSource === "airplay"
          ? millisecondsToSeconds(trustedAirplayPlaybackMetadata?.durationMs, { allowZero: false })
        : playbackSource === "upnp"
          ? millisecondsToSeconds(activeUpnpPlaybackMetadata?.durationMs, { allowZero: false }) ?? (isMpdBackedSource && hasCurrentTrack ? durationSeconds : null)
        : playbackSource === "spotify" || isMultiroomSource
          ? null
        : isMpdBackedSource && hasCurrentTrack ? durationSeconds : null,
      timingDiagnostics: playbackSource === "bluetooth"
        ? bluetoothPlaybackMetadata?.timingDiagnostics ?? null
        : playbackSource === "airplay"
          ? trustedAirplayPlaybackMetadata?.timingDiagnostics ?? null
          : playbackSource === "upnp"
            ? activeUpnpPlaybackMetadata?.timingDiagnostics ?? null
          : null,
      transportCapabilities: buildPlaybackTransportCapabilities(playbackSource, {
        airplayRemoteControlAvailable: airplayTransportAvailable,
        bluetoothRemoteControlAvailable: bluetoothTransportAvailable,
        seekAvailable: playbackSource === "mpd" && isNasLibraryTrackPath(file) ? false : true,
        reason: playbackSource === "mpd" && isNasLibraryTrackPath(file) ? NAS_SEEK_UNAVAILABLE_REASON : null
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
    audio: playbackAudio
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

function getMpcLogLineTimeMs(line) {
  const match = String(line ?? "").match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
  if (!match) return null;
  const parsed = Date.parse(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function getMpcPlayedUriFromLogLine(line) {
  const match = String(line ?? "").match(/\bplayer:\s+played\s+"([^"]+)"/i);
  return match?.[1]?.trim() || null;
}

function getRecentMpcRadioStartedAtMs(uri, lines, fallbackMs) {
  const targetUri = String(uri ?? "").trim();
  if (!targetUri) return fallbackMs;
  let startedAtMs = null;
  for (const line of lines) {
    if (getMpcPlayedUriFromLogLine(line) !== targetUri) continue;
    const lineAtMs = getMpcLogLineTimeMs(line);
    if (lineAtMs !== null) {
      startedAtMs = lineAtMs;
    }
  }
  return startedAtMs ?? fallbackMs;
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

async function readRecentMpcRadioLogLines() {
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
      .filter(Boolean);
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
  const wasPrimed = state.primed;
  const stationStartedAtMs = getRecentMpcRadioStartedAtMs(uri, lines, state.startedAtMs);
  for (const line of lines) {
    if (!isMpcRadioXrunLine(line)) continue;
    if (state.seenLines.has(line)) continue;
    state.seenLines.add(line);

    const lineAtMs = getMpcLogLineTimeMs(line);
    if (lineAtMs !== null) {
      if (lineAtMs + 1000 >= stationStartedAtMs && now - lineAtMs <= RADIO_XRUN_WINDOW_MS) {
        state.events.push(lineAtMs);
      }
      continue;
    }

    if (wasPrimed) {
      state.events.push(now);
    }
  }
  state.primed = true;

  if (state.seenLines.size > 200) {
    state.seenLines = new Set(Array.from(state.seenLines).slice(-100));
  }
  state.events = state.events.filter((eventAtMs) => now - eventAtMs <= RADIO_XRUN_WINDOW_MS);

  if (now - stationStartedAtMs < RADIO_XRUN_GRACE_MS) return false;
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
    if (target === "upnp") markUpnpMpdReleased();
    return true;
  } catch (error) {
    if (isMpcCommunicationFailure(error) && await recoverMpdService(error)) {
      await runMpc(["stop"], { allowFailure: true, timeout: 2500 });
      if (target === "upnp") markUpnpMpdReleased();
      return true;
    }
    console.warn(`tikpal-api could not stop MPD before switching to ${target}: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  return false;
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

async function autoAdvanceMpcRadioStation(currentUri, reason = "radio stream failure", options = {}) {
  if (await shouldSuspendMpcRadioBackgroundRecovery()) return false;
  if (mpcRadioAutoAdvanceInFlight) {
    return true;
  }

  mpcRadioAutoAdvanceInFlight = true;
  try {
    console.warn(`tikpal-api auto-advancing Radio after ${reason}`);
    const advanced = await switchRadioStationByOffset(1, {
      currentFileOverride: currentUri,
      currentStationIdOverride: options.currentStationId ?? null,
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
        if (await shouldSuspendMpcRadioBackgroundRecovery()) return;
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
    const recentMpdLogLines = await readRecentMpcRadioLogLines();
    if (!recentMpdLogLines.some(isMpcRadioXrunLine)) return false;
    if (!noteMpcRadioXrunLines(stationId, currentUri, recentMpdLogLines)) return false;
    if (await shouldSuspendMpcRadioBackgroundRecovery()) return false;
    if (sourceSwitchInFlightCount > 0) return false;

    return await autoAdvanceMpcRadioStation(currentUri, "repeated decoder/xrun stalls", { currentStationId: stationId });
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
  const allRadioStations = action.radioStationId ? await getAvailableRadioStations("all") : radioStations;
  const selectedStation = action.radioStationId
    ? allRadioStations.find((station) => station.id === action.radioStationId)
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
  const allRadioStations = action.radioStationId ? await getAvailableRadioStations("all") : radioStations;
  const selectedStation = action.radioStationId
    ? allRadioStations.find((station) => station.id === action.radioStationId)
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
  const currentStationId = String(options.currentStationIdOverride ?? "").trim();
  const tikpalActiveStation = currentStationId
    ? tikpalStations.find((station) => station.id === currentStationId) ?? findActiveRadioStationFromList(currentFile, tikpalStations)
    : findActiveRadioStationFromList(currentFile, tikpalStations);
  const tikpalIndex = tikpalActiveStation
    ? tikpalStations.findIndex((station) => station.id === tikpalActiveStation.id)
    : -1;
  const categoryStations = tikpalActiveStation?.category
    ? tikpalStations.filter((station) => station.category === tikpalActiveStation.category)
    : [];
  const categoryIndex = categoryStations.length > 0 && tikpalActiveStation
    ? categoryStations.findIndex((station) => station.id === tikpalActiveStation.id)
    : -1;
  const allStations = tikpalIndex >= 0 ? tikpalStations : await getAvailableRadioStations("all");
  const allActiveStation = tikpalIndex >= 0 ? tikpalActiveStation : findActiveRadioStationFromList(currentFile, allStations);
  const allIndex = tikpalIndex >= 0
    ? tikpalIndex
    : allActiveStation
      ? allStations.findIndex((station) => station.id === allActiveStation.id)
      : -1;
  const stations = categoryStations.length > 0
    ? categoryStations
    : tikpalIndex >= 0 || allIndex < 0 || allStations[allIndex]?.catalogSource === "tikpal"
      ? tikpalStations
      : allStations;
  if (stations.length === 0) return false;

  const activeStation = tikpalIndex >= 0 ? tikpalActiveStation : allActiveStation;
  const currentIndex = categoryIndex >= 0
    ? categoryIndex
    : activeStation
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
    if (stations.length > 1 && currentFile && candidateStation.uri === currentFile) continue;

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
  if (await isCurrentExternalSourceOpen("upnp")) {
    scheduleExternalSourceCleanup("upnp");
    return;
  }
  await stopMpdForExternalSource("upnp");
  await openExternalSourceIfNeeded("upnp");
}

async function switchToSceneSource(action = {}) {
  activateSceneAudio(action);
  await enforceConnectionGate("scene");
  await stopMpdForExternalSource("scene");
}

async function applyMpcPlayMode(mode) {
  const normalizedMode = normalizePlaybackMode(mode);
  switch (normalizedMode) {
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
      // Tikpal owns shuffle jumps explicitly. MPD's built-in random can replay
      // the previous/current queue position on short tracks, which feels like
      // the new song was cut off.
      await runMpc(["random", "off"]);
      await runMpc(["repeat", "off"]);
      await runMpc(["single", "on"]);
      break;
    default:
      throw new Error(`Unsupported playback mode: ${mode}`);
  }
  await writePlaybackModeState(normalizedMode);
}

let mpcShuffleMonitorTimer = null;
let mpcShuffleMonitorInFlight = false;
let mpcShuffleRecentPositions = [];
let mpcShuffleLastObservedFile = null;
let mpcShuffleLastObservedPosition = 0;
let mpcShuffleLastObservedNearEnd = false;
let mpcShuffleLastJumpAtMs = 0;

function rememberMpcShufflePosition(position) {
  const normalized = Math.round(Number(position));
  if (!Number.isFinite(normalized) || normalized < 1) return;
  mpcShuffleRecentPositions = [
    normalized,
    ...mpcShuffleRecentPositions.filter((candidate) => candidate !== normalized)
  ].slice(0, MPD_SHUFFLE_RECENT_HISTORY_SIZE);
}

function getDifferentRandomMpcQueuePosition(status, options = {}) {
  const queueLength = Number(status?.queueLength);
  const currentPosition = Number(status?.currentTrackIndex);
  if (!Number.isFinite(queueLength) || queueLength <= 1) return null;

  const current = Number.isFinite(currentPosition) && currentPosition >= 1 && currentPosition <= queueLength
    ? Math.round(currentPosition)
    : 1;
  const hardExcluded = new Set([current, ...(options.hardExcludedPositions ?? [])]
    .map((position) => Math.round(Number(position)))
    .filter((position) => Number.isFinite(position) && position >= 1 && position <= queueLength));
  const excluded = new Set([...hardExcluded, ...(options.excludedPositions ?? [])]
    .map((position) => Math.round(Number(position)))
    .filter((position) => Number.isFinite(position) && position >= 1 && position <= queueLength));
  const allowedPositions = Array.from({ length: queueLength }, (_, index) => index + 1)
    .filter((position) => !excluded.has(position));
  if (allowedPositions.length > 0) {
    return allowedPositions[Math.floor(Math.random() * allowedPositions.length)];
  }
  const fallbackAllowedPositions = Array.from({ length: queueLength }, (_, index) => index + 1)
    .filter((position) => !hardExcluded.has(position));
  if (fallbackAllowedPositions.length > 0) {
    return fallbackAllowedPositions[Math.floor(Math.random() * fallbackAllowedPositions.length)];
  }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = Math.floor(Math.random() * queueLength) + 1;
    if (candidate !== current) return candidate;
  }
  return current >= queueLength ? 1 : current + 1;
}

function isMpcStatusNearTrackEnd(status) {
  const elapsed = Number(status?.elapsedSeconds);
  const duration = Number(status?.durationSeconds);
  if (!Number.isFinite(elapsed) || !Number.isFinite(duration) || duration <= 0) return false;
  return elapsed >= Math.max(0, duration - 3);
}

function isMpcStatusNearTrackStart(status) {
  const elapsed = Number(status?.elapsedSeconds);
  const duration = Number(status?.durationSeconds);
  if (!Number.isFinite(elapsed) || elapsed < 0) return false;
  if (Number.isFinite(duration) && duration > 0 && elapsed > duration) return false;
  return elapsed <= 3;
}

function isMpcStatusAtTrackEnd(status) {
  const elapsed = Number(status?.elapsedSeconds);
  const duration = Number(status?.durationSeconds);
  if (!Number.isFinite(elapsed) || !Number.isFinite(duration) || duration <= 0) return false;
  return elapsed >= duration;
}

function getMostRecentDifferentMpcShufflePosition(position) {
  const current = Math.round(Number(position));
  if (!Number.isFinite(current) || current < 1) return null;
  return mpcShuffleRecentPositions.find((candidate) => candidate !== current) ?? null;
}

async function playDifferentRandomMpcQueueTrack(status = null, options = {}) {
  const currentStatus = status ?? await readMpcStatusWithTikpalPlaybackMode({ allowFailure: true });
  const nextPosition = getDifferentRandomMpcQueuePosition(currentStatus, options);
  if (!nextPosition) return false;
  await runMpc(["play", String(nextPosition)]);
  mpcShuffleLastJumpAtMs = Date.now();
  rememberMpcShufflePosition(currentStatus.currentTrackIndex);
  rememberMpcShufflePosition(nextPosition);
  const [nextStatus, nextFile] = await Promise.all([
    readMpcStatusWithTikpalPlaybackMode({ allowFailure: true }),
    runMpc(["--format", "%file%", "current"], { allowFailure: true })
  ]);
  mpcShuffleLastObservedFile = extractMpcCurrentFile(nextFile);
  mpcShuffleLastObservedPosition = nextStatus.currentTrackIndex || nextPosition;
  // Give MPD a brief settle window after explicit `play <position>`. Some
  // backends report the previous near-end status for one poll, which can make
  // the shuffle monitor jump again before the new track really starts.
  mpcShuffleLastObservedNearEnd = false;
  return true;
}

function shouldRandomJumpCurrentMpcQueue() {
  const currentSource = getCurrentMpcSourceId();
  return !currentSource || currentSource === "mpd" || currentSource === "audio";
}

async function maybeJumpToRandomMpcTrackAfterShuffleEnabled() {
  if (!shouldRandomJumpCurrentMpcQueue()) return false;
  await ensureMpcQueue();
  const status = await readMpcStatusWithTikpalPlaybackMode({ allowFailure: true });
  if (status.state !== "playing") return false;
  return await playDifferentRandomMpcQueueTrack(status, { excludedPositions: mpcShuffleRecentPositions });
}

async function reconcileMpcShuffleNaturalAdvance() {
  const mode = getCachedPlaybackModeState().mode;
  if (mode !== "shuffle" || !shouldRandomJumpCurrentMpcQueue()) {
    mpcShuffleLastObservedFile = null;
    mpcShuffleLastObservedPosition = 0;
    mpcShuffleLastObservedNearEnd = false;
    return false;
  }

  await withMpcMutationLock(async () => {
    const status = await readMpcStatusWithTikpalPlaybackMode({ allowFailure: true });
    if (status.settings.playMode !== "shuffle" || status.queueLength <= 1) {
      return;
    }

    const currentFile = extractMpcCurrentFile(await runMpc(["--format", "%file%", "current"], { allowFailure: true }));
    if (!currentFile) return;
    const currentPosition = status.currentTrackIndex;
    if (Date.now() - mpcShuffleLastJumpAtMs < MPD_SHUFFLE_POST_JUMP_SETTLE_MS) {
      mpcShuffleLastObservedFile = currentFile;
      mpcShuffleLastObservedPosition = currentPosition;
      mpcShuffleLastObservedNearEnd = false;
      rememberMpcShufflePosition(currentPosition);
      return;
    }
    if (status.state !== "playing") {
      if (mpcShuffleLastObservedNearEnd || isMpcStatusAtTrackEnd(status)) {
        const jumped = await playDifferentRandomMpcQueueTrack(status, {
          excludedPositions: mpcShuffleRecentPositions,
          hardExcludedPositions: [getMostRecentDifferentMpcShufflePosition(currentPosition)]
        });
        if (jumped) {
          await rememberCurrentLocalLibraryTrackSource();
          tikpalStateSnapshotGeneration += 1;
          void requestTikpalStateSnapshotRefresh({ force: true });
        }
      }
      return;
    }

    const repeatedSingleTrack = Boolean(
      mpcShuffleLastObservedFile
        && mpcShuffleLastObservedNearEnd
        && currentFile === mpcShuffleLastObservedFile
        && currentPosition === mpcShuffleLastObservedPosition
        && isMpcStatusNearTrackStart(status)
    );
    if (repeatedSingleTrack) {
      const jumped = await playDifferentRandomMpcQueueTrack(status, {
        excludedPositions: mpcShuffleRecentPositions,
        hardExcludedPositions: [currentPosition]
      });
      if (jumped) {
        await rememberCurrentLocalLibraryTrackSource();
        tikpalStateSnapshotGeneration += 1;
        void requestTikpalStateSnapshotRefresh({ force: true });
        return;
      }
    }

    const naturallyAdvanced = Boolean(
      mpcShuffleLastObservedFile
        && mpcShuffleLastObservedNearEnd
        && currentFile !== mpcShuffleLastObservedFile
        && currentPosition !== mpcShuffleLastObservedPosition
    );

    if (!naturallyAdvanced) {
      if (isMpcStatusAtTrackEnd(status)) {
        const jumped = await playDifferentRandomMpcQueueTrack(status, {
          excludedPositions: mpcShuffleRecentPositions,
          hardExcludedPositions: [getMostRecentDifferentMpcShufflePosition(currentPosition)]
        });
        if (jumped) {
          await rememberCurrentLocalLibraryTrackSource();
          tikpalStateSnapshotGeneration += 1;
          void requestTikpalStateSnapshotRefresh({ force: true });
          return;
        }
      }

      mpcShuffleLastObservedFile = currentFile;
      mpcShuffleLastObservedPosition = currentPosition;
      mpcShuffleLastObservedNearEnd = isMpcStatusNearTrackEnd(status);
      rememberMpcShufflePosition(currentPosition);
      return;
    }

    const previousPosition = mpcShuffleLastObservedPosition;
    const jumped = await playDifferentRandomMpcQueueTrack(status, {
      excludedPositions: mpcShuffleRecentPositions,
      hardExcludedPositions: [previousPosition]
    });
    if (!jumped) {
      mpcShuffleLastObservedFile = currentFile;
      mpcShuffleLastObservedPosition = currentPosition;
      mpcShuffleLastObservedNearEnd = isMpcStatusNearTrackEnd(status);
      rememberMpcShufflePosition(currentPosition);
      return;
    }

    const nextStatus = await readMpcStatusWithTikpalPlaybackMode({ allowFailure: true });
    const nextFile = extractMpcCurrentFile(await runMpc(["--format", "%file%", "current"], { allowFailure: true }));
    mpcShuffleLastObservedFile = nextFile || currentFile;
    mpcShuffleLastObservedPosition = nextStatus.currentTrackIndex || currentPosition;
    mpcShuffleLastObservedNearEnd = isMpcStatusNearTrackEnd(nextStatus);
    await rememberCurrentLocalLibraryTrackSource();
    tikpalStateSnapshotGeneration += 1;
    void requestTikpalStateSnapshotRefresh({ force: true });
  });
  return true;
}

function startMpcShuffleMonitor() {
  if (API_MODE !== "mpc" || mpcShuffleMonitorTimer || MPD_SHUFFLE_MONITOR_INTERVAL_MS <= 0) return;
  mpcShuffleMonitorTimer = setInterval(() => {
    if (mpcShuffleMonitorInFlight) return;
    mpcShuffleMonitorInFlight = true;
    reconcileMpcShuffleNaturalAdvance()
      .catch((error) => {
        console.warn(`tikpal-api mpc shuffle monitor failed: ${error instanceof Error ? error.message : "unknown error"}`);
      })
      .finally(() => {
        mpcShuffleMonitorInFlight = false;
      });
  }, MPD_SHUFFLE_MONITOR_INTERVAL_MS);
  mpcShuffleMonitorTimer.unref?.();
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

  if (isCurrentMpcSourceMultiroom()) {
    await applyMpcMultiroomPlaybackAction(action);
    return;
  }

  let shouldRememberLibraryTrack = false;
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
      {
        const status = await readMpcStatusWithTikpalPlaybackMode({ allowFailure: true });
        const randomJumped = status.settings.playMode === "shuffle"
          ? await playDifferentRandomMpcQueueTrack(status, { excludedPositions: mpcShuffleRecentPositions })
          : false;
        if (!randomJumped) {
          await runMpc(["next"]);
        }
      }
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
      const currentFile = extractMpcCurrentFile(await runMpc(["--format", "%file%", "current"], { allowFailure: true, timeout: 2500 }));
      if (isNasLibraryTrackPath(currentFile)) {
        throw new Error(NAS_SEEK_UNAVAILABLE_REASON);
      }
      await runMpc(["seek", formatMpcSeek(seconds)], { timeout: MPC_SEEK_TIMEOUT_MS });
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
      if (mode === "shuffle") {
        shouldRememberLibraryTrack = await maybeJumpToRandomMpcTrackAfterShuffleEnabled();
      }
      break;
    }
    case "volume_set": {
      const percent = Number(action.value);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        throw new Error("volume_set requires value between 0 and 100");
      }
      const currentSourceId = getCurrentMpcSourceId();
      if ((currentSourceId === "mpd" || currentSourceId === "radio") && await isMpdBitPerfectStrictModeActive()) {
        if (OUTPUT_VOLUME_SET_COMMAND_CONFIGURED) {
          await setOutputVolumePercent(percent);
        }
        return;
      }
      const volumeLimitPercent = currentSourceId === "mpd" || currentSourceId === "radio"
        ? await getMpdVolumeLimitPercent()
        : null;
      const effectivePercent = Number.isFinite(volumeLimitPercent)
        ? Math.min(percent, volumeLimitPercent)
        : percent;
      if (await shouldUseOutputVolumeForMpcAction()) {
        await setOutputVolumePercent(effectivePercent);
      } else {
        await setMpcAndOutputVolumePercent(effectivePercent);
      }
      break;
    }
    default:
      throw new Error(`Unsupported playback action: ${action.type}`);
  }

  if (shouldRememberLibraryTrack || ["next", "previous"].includes(String(action.type))) {
    const currentSource = getCurrentMpcSourceId();
    if (!currentSource || currentSource === "mpd") {
      await rememberCurrentLocalLibraryTrackSource();
    }
  }
}

async function applyMpcPlaybackAction(action) {
  markHifiRuntimeRecoveryQuietWindow();
  try {
    const result = await withMpcMutationLock(() => applyMpcPlaybackActionUnlocked(action));
    if (!["volume_set", "seek", "favorite_toggle"].includes(String(action?.type ?? ""))) {
      const preferences = await readUiPreferences();
      if (preferences.audioOutputProfile === "sleep") {
        const status = await readMpcStatusWithTikpalPlaybackMode({ allowFailure: true, timeout: 2500 });
        if (status.state === "playing") scheduleAudioOutputProfileAutoStop("sleep");
      }
    }
    return result;
  } finally {
    markHifiRuntimeRecoveryQuietWindow();
  }
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

function getStartupVolumePercent() {
  if (Number.isFinite(MPD_STARTUP_VOLUME) && MPD_STARTUP_VOLUME >= 0 && MPD_STARTUP_VOLUME <= 100) {
    return Math.round(MPD_STARTUP_VOLUME);
  }
  return null;
}

async function applyStartupVolumeGuard() {
  const startupVolume = getStartupVolumePercent();
  if (startupVolume === null) return;

  try {
    await runMpc(["volume", String(startupVolume)], { allowFailure: true, timeout: 2500 });
  } catch (error) {
    console.warn(`tikpal-api startup MPD volume guard failed: ${error instanceof Error ? error.message : "unknown error"}`);
  }

  if (!OUTPUT_VOLUME_SET_COMMAND.trim()) return;
  try {
    await setOutputVolumePercent(startupVolume, { remember: false });
  } catch (error) {
    console.warn(`tikpal-api startup output volume guard failed: ${error instanceof Error ? error.message : "unknown error"}`);
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
  const rememberedSource = getCachedRememberedAudioSource() ?? snapshot?.audio?.rememberedSource;
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
    if (
      action.target === "mpd"
      && currentSource?.id === "mpd"
      && snapshot.playback?.settings?.playMode === "shuffle"
    ) {
      return false;
    }

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
  if (
    API_MODE !== "mpc"
    || hifiRuntimeRecoveryPromise
    || mpcRadioAutoAdvanceInFlight
    || mpcRadioWeakNetworkRecoveryPromise
    || sourceSwitchInFlightCount > 0
    || webModeOpenInFlight
    || isHifiRuntimeRecoveryQuiet()
  ) return null;

  const action = buildHifiRuntimeRecoveryAction(snapshot);
  if (!shouldRecoverHifiRuntimePlayback(snapshot, action)) return null;

  hifiRuntimeRecoveryPromise = (async () => {
    const webModeRuntime = await readWebModeRuntimeState();
    if (webModeRuntime.activeProvider) return false;
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
  await applyStartupVolumeGuard();
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

function invalidateTikpalStateSnapshotCache() {
  tikpalStateSnapshotGeneration += 1;
  tikpalStateSnapshotCache = null;
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
    return await attachUiPreferences(await collectTikpalStateSnapshot(options));
  }

  if (await shouldWaitForStartupPlaybackState()) {
    await startupPlaybackPolicyPromise;
  }
  void requestTikpalStateSnapshotRefresh();
  let cachedState = readCachedTikpalState();
  if (cachedState.playback?.source === "upnp" && UPNP_METADATA_COMMAND.trim()) {
    cachedState = await requestTikpalStateSnapshotRefresh({ force: true }) ?? readCachedTikpalState();
  }
  void recoverWeakNetworkMpcRadioIfNeeded(cachedState);
  void recoverHifiRuntimePlaybackIfNeeded(cachedState);
  return await attachUiPreferences(await refreshAirplayPlaybackMetadataForState(cachedState, {
    force: options.forceFreshAirplayMetadata === true
  }));
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

function truncateSvgText(value, maxLength) {
  const trimmed = String(value ?? "").trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

const GENERATED_ARTWORK_FONT_FAMILIES = {
  system: "SF Pro Display, SF Pro Text, Inter, Helvetica Neue, PingFang SC, sans-serif",
  hardware: "Avenir Next, DIN Alternate, DIN Condensed, SF Pro Display, PingFang SC, sans-serif",
  precision: "SF Mono, Roboto Mono, IBM Plex Mono, JetBrains Mono, PingFang SC, monospace",
  sans: "Inter, SF Pro Display, Helvetica Neue, PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif",
  serif: "Iowan Old Style, Palatino Linotype, Book Antiqua, Georgia, Times New Roman, Songti SC, serif",
  mono: "SF Mono, IBM Plex Mono, JetBrains Mono, Cascadia Mono, Fira Code, Source Han Mono SC, monospace"
};

function normalizeGeneratedArtworkFontTheme(value) {
  const theme = String(value ?? "").trim();
  return Object.hasOwn(GENERATED_ARTWORK_FONT_FAMILIES, theme) ? theme : "system";
}

function buildGeneratedArtworkSvg({ title, artist, album }, fontTheme = "system") {
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
  const fontFamily = escapeXml(GENERATED_ARTWORK_FONT_FAMILIES[normalizeGeneratedArtworkFontTheme(fontTheme)]);
  const safeTitle = escapeXml(truncateSvgText(title || "Not Playing", 22));
  const safeArtist = escapeXml(truncateSvgText(artist || "Unknown Artist", 28));
  const safeAlbum = escapeXml(truncateSvgText(album || "MPD Queue", 28));

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200" role="img" aria-label="${escapeXml(title || "Tikpal")}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="hsl(${hueA} 42% 24%)"/>
      <stop offset="58%" stop-color="hsl(${hueB} 36% 18%)"/>
      <stop offset="100%" stop-color="hsl(${hueB} 32% 11%)"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="1200" fill="url(#bg)"/>
  <circle cx="600" cy="420" r="230" fill="rgba(255,255,255,0.055)"/>
  <circle cx="600" cy="420" r="150" fill="rgba(0,0,0,0.12)"/>
  <text x="600" y="490" text-anchor="middle" fill="rgba(255,255,255,0.94)" font-family="${fontFamily}" font-size="210" font-weight="700">${escapeXml(label || "TK")}</text>
  <path d="M430 640h340" stroke="rgba(255,255,255,0.2)" stroke-width="5" stroke-linecap="round"/>
  <text x="600" y="780" text-anchor="middle" fill="rgba(255,255,255,0.96)" font-family="${fontFamily}" font-size="68" font-weight="700">${safeTitle}</text>
  <text x="600" y="850" text-anchor="middle" fill="rgba(255,255,255,0.72)" font-family="${fontFamily}" font-size="40">${safeArtist}</text>
  <text x="600" y="908" text-anchor="middle" fill="rgba(255,255,255,0.54)" font-family="${fontFamily}" font-size="34">${safeAlbum}</text>
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
  return source === "bluetooth" || source === "airplay" || source === "upnp";
}

function isProxyInputSourceScope(sourceScope) {
  return sourceScope === "bluetooth_input" || sourceScope === "airplay_input" || sourceScope === "upnp_input";
}

function getProxyInputScope(source) {
  if (source === "airplay") return "airplay_input";
  if (source === "upnp") return "upnp_input";
  return "bluetooth_input";
}

function getProxyInputLabel(source) {
  if (source === "airplay") return "AirPlay";
  if (source === "upnp") return "DLNA";
  return "Bluetooth";
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

function isUnreliableProxyLyricsDuration(sourceScope, durationMs) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return false;
  if (sourceScope === "airplay_input") {
    return durationMs <= AIRPLAY_LYRICS_UNRELIABLE_DURATION_MS;
  }
  if (sourceScope === "bluetooth_input") {
    return durationMs <= BLUETOOTH_LYRICS_UNRELIABLE_DURATION_MS;
  }
  return false;
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
  const trustedDurationMs = isUnreliableProxyLyricsDuration(sourceScope, durationMs) ? null : durationMs;
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
    "dlna ready",
    "dlna waiting",
    "bluetooth source",
    "airplay source",
    "dlna source",
    "pair a device to start playback",
    "waiting for bluetooth audio",
    "waiting for airplay audio",
    "waiting for dlna audio"
  ]);
  const guidePrefixes = ["find ", "choose ", "select ", "look for "];
  const metadataFields = [title, artist, album].filter(Boolean);
  const metadataLooksPlaceholder = metadataFields.some((value) => {
    if (placeholderPhrases.has(value)) return true;
    if (guidePrefixes.some((prefix) => value.startsWith(prefix))) return true;
    const mentionsProxySource = value.includes("bluetooth") || value.includes("airplay") || value.includes("dlna");
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
    if (lowerMessage.includes("dlna capture")) {
      return "DLNA audio capture unavailable";
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
    .replace(/[^\p{L}\p{N}]+/gu, " ")
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
    .replace(/\s*[\[(（【]\s*(?:feat\.?|ft\.?|featuring|with|合唱|伴唱)[^\])）】]*[\])）】]\s*/gi, " ")
    .replace(/\s+(?:feat\.?|ft\.?|featuring|with)\b.*$/i, " ")
    .replace(/\s*[\[(（【]\s*(?:live|remaster(?:ed)?|version|伴奏|纯音乐|现场|演唱会)[^\])）】]*[\])）】]\s*/gi, " ")
    .replace(/\s+[-–—]\s*(?:live|remaster(?:ed)?|version|伴奏|纯音乐|现场|演唱会).*$/i, " ")
    .replace(/\s+/g, " ")
    .trim();
  return uniqueLyricsLookupValues([normalized, featuredBase]);
}

function buildLyricsArtistLookupValues(artist) {
  const normalized = normalizeMetadataValue(artist);
  const splitArtists = normalized
    .split(/\s*(?:,|，|、|\/|／|;|；|\+|＋|&|\band\b|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b|\bwith\b|\bx\b|和|与)\s*/i)
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
  if (!isProxyInputSourceScope(candidate?.sourceScope)) return false;
  if (!Number.isFinite(providerDurationMs) || providerDurationMs < 30_000) return false;

  const candidateDurationMs = Number(candidate.durationMs);
  if (!Number.isFinite(candidateDurationMs) || candidateDurationMs <= 0) return true;
  if (isUnreliableProxyLyricsDuration(candidate.sourceScope, candidateDurationMs)) return true;

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

function highResolutionItunesArtworkUrl(value) {
  return normalizeMetadataValue(value).replace(/\/100x100bb(?=\.(?:jpg|png)(?:$|\?))/i, "/600x600bb");
}

async function fetchItunesArtworkUrl({ title, artist, album }) {
  const searchUrl = new URL(ITUNES_SEARCH_BASE_URL);
  searchUrl.searchParams.set("term", [artist, title].filter(Boolean).join(" "));
  searchUrl.searchParams.set("entity", "song");
  searchUrl.searchParams.set("limit", "10");

  const { response, body } = await fetchJsonWithTimeout(searchUrl, {
    timeoutMs: REMOTE_METADATA_TIMEOUT_MS
  });
  if (!response.ok) return null;

  const matches = Array.isArray(body?.results)
    ? body.results.filter((entry) => strictLyricsProviderMatch({ title, artist }, entry))
    : [];
  const normalizedAlbum = normalizeLyricsMatchValue(album);
  const entry = matches.find((candidate) => (
    normalizedAlbum && normalizeLyricsMatchValue(candidate?.collectionName) === normalizedAlbum
  )) ?? matches[0];
  return highResolutionItunesArtworkUrl(entry?.artworkUrl100) || null;
}

async function fetchRemoteArtworkForAlbum({ title, artist, album }) {
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

    const albumEntry = await fetchJsonWithTimeout(searchUrl, {
      timeoutMs: REMOTE_METADATA_TIMEOUT_MS
    }).then(({ response, body }) => (
      response.ok && Array.isArray(body?.album)
        ? body.album.find((entry) => entry?.strAlbumThumb) ?? null
        : null
    )).catch(() => null);
    const imageUrl = albumEntry?.strAlbumThumb
      || await fetchItunesArtworkUrl({ title, artist, album }).catch(() => null);
    if (!imageUrl) return null;
    return cacheRemoteArtwork({
      cacheKey,
      imageUrl
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

  void fetchRemoteArtworkForAlbum({ title, artist, album }).catch(() => null);
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
    const matches = Array.isArray(body) ? body.filter(acceptsLyricsBody) : [];
    return {
      lyricsBody: matches.find((entry) => parseSyncedLyrics(entry?.syncedLyrics).length > 0) ?? matches[0] ?? null,
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
    const matches = results.map((result) => result.lyricsBody).filter(Boolean);
    const matched = matches.find((entry) => parseSyncedLyrics(entry?.syncedLyrics).length > 0) ?? matches[0];
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
  if (source === "airplay") return AIRPLAY_CAPTURE_COMMAND;
  if (source === "upnp") return UPNP_CAPTURE_COMMAND;
  return BLUETOOTH_CAPTURE_COMMAND;
}

function getProxyInputCaptureDurationSeconds(source) {
  if (source === "airplay") return AIRPLAY_CAPTURE_DURATION_SECONDS;
  if (source === "upnp") return UPNP_CAPTURE_DURATION_SECONDS;
  return BLUETOOTH_CAPTURE_DURATION_SECONDS;
}

function getProxyInputRecognitionSettleMs(source) {
  if (source === "airplay") return AIRPLAY_RECOGNITION_SETTLE_MS;
  if (source === "upnp") return UPNP_RECOGNITION_SETTLE_MS;
  return BLUETOOTH_RECOGNITION_SETTLE_MS;
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

function scheduleSystemPowerCommand(command, label) {
  if (!command.trim()) {
    throw new Error(`${label} is not supported in this runtime`);
  }
  const child = spawn("sh", ["-lc", `sleep 0.2; ${command}`], {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
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
      scheduleSystemPowerCommand(SYSTEM_REBOOT_COMMAND, "reboot");
      return;
    case "shutdown":
      scheduleSystemPowerCommand(SYSTEM_SHUTDOWN_COMMAND, "shutdown");
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
      clearUpnpMpdReleaseMarker();
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
      clearUpnpMpdReleaseMarker();
      clearActiveMpcRadioStationCache();
      resetBluetoothRecognitionSession();
      await switchToSceneSource(action);
      mockArmedSource = "scene";
      return;
    case "spotify":
      allowExternalHandoffAutoArm();
      clearUpnpMpdReleaseMarker();
      clearActiveMpcRadioStationCache();
      stopSceneAudio();
      resetBluetoothRecognitionSession();
      await switchToSpotifySource();
      mockArmedSource = "spotify";
      return;
    case "bluetooth":
      allowExternalHandoffAutoArm();
      clearUpnpMpdReleaseMarker();
      clearActiveMpcRadioStationCache();
      stopSceneAudio();
      resetBluetoothRecognitionSession();
      await switchToBluetoothSource();
      mockArmedSource = "bluetooth";
      return;
    case "airplay":
      allowExternalHandoffAutoArm();
      clearUpnpMpdReleaseMarker();
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

    if (API_MODE === "mpc" && (target === "mpd" || target === "radio")) {
      const preferences = await readUiPreferences();
      if (preferences.audioOutputProfile === "sleep") {
        const status = await readMpcStatusWithTikpalPlaybackMode({ allowFailure: true, timeout: 2500 });
        if (status.state === "playing") scheduleAudioOutputProfileAutoStop("sleep");
      }
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

function resolveRoomActionSceneSoundEnabled(action, current, mode, fallbackEnabled = false) {
  if (mode === "hifi") return false;
  if (action.sceneSoundEnabled !== undefined) return action.sceneSoundEnabled === true;
  return fallbackEnabled === true && current.mode !== "hifi";
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
      const sceneSoundEnabled = resolveRoomActionSceneSoundEnabled(action, current, mode);
      next = {
        ...rememberedCurrent,
        mode,
        phase: "idle",
        presetId: preset.presetId,
        sceneVideoId,
        sceneVideoByMode: rememberSceneVideoForRoomMode(rememberedCurrent, mode, sceneVideoId).sceneVideoByMode,
        ...hifiEqPatch,
        sceneSoundEnabled,
        playlistId: action.playlistId === undefined ? preset.playlistId : action.playlistId,
        volumePercent: clampPercent(action.volumePercent, preset.volumePercent),
        brightnessPercent: clampPercent(action.brightnessPercent, preset.brightnessPercent),
        timerMinutes,
        timerEndsAt: null
      };
      applyScene = sceneSoundEnabled;
      applyLevels = mode !== "hifi";
      stopScene = !sceneSoundEnabled;
      break;
    }
    case "apply_preset": {
      const mode = getRoomModeFromPresetId(action.presetId, action.mode ?? current.mode);
      const preset = getRoomModePreset(mode);
      const timerMinutes = normalizeTimerMinutes(action.timerMinutes, preset.timerMinutes);
      const hifiEqPatch = buildHifiEqPatch(action, current.hifiEqPresetId ?? preset.hifiEqPresetId);
      const rememberedCurrent = rememberSceneVideoForRoomMode(current);
      const sceneVideoId = await resolveRoomModeSceneVideoId(rememberedCurrent, mode, action.sceneVideoId);
      const sceneSoundEnabled = resolveRoomActionSceneSoundEnabled(action, current, mode);
      next = {
        ...rememberedCurrent,
        mode,
        phase: "preparing",
        presetId: preset.presetId,
        sceneVideoId,
        sceneVideoByMode: rememberSceneVideoForRoomMode(rememberedCurrent, mode, sceneVideoId).sceneVideoByMode,
        ...hifiEqPatch,
        sceneSoundEnabled,
        playlistId: action.playlistId === undefined ? preset.playlistId : action.playlistId,
        volumePercent: clampPercent(action.volumePercent, preset.volumePercent),
        brightnessPercent: clampPercent(action.brightnessPercent, preset.brightnessPercent),
        timerMinutes,
        timerEndsAt: null
      };
      applyScene = sceneSoundEnabled;
      applyLevels = mode !== "hifi";
      stopScene = !sceneSoundEnabled;
      break;
    }
    case "start_session": {
      const mode = normalizeRoomMode(action.mode ?? current.mode);
      const preset = getRoomModePreset(mode);
      const timerMinutes = normalizeTimerMinutes(action.timerMinutes, current.timerMinutes);
      const hifiEqPatch = buildHifiEqPatch(action, current.hifiEqPresetId ?? preset.hifiEqPresetId);
      const rememberedCurrent = rememberSceneVideoForRoomMode(current);
      const sceneVideoId = await resolveRoomModeSceneVideoId(rememberedCurrent, mode, action.sceneVideoId);
      const sceneSoundEnabled = resolveRoomActionSceneSoundEnabled(action, current, mode, current.sceneSoundEnabled);
      next = {
        ...rememberedCurrent,
        mode,
        phase: "active",
        presetId: preset.presetId,
        sceneVideoId,
        sceneVideoByMode: rememberSceneVideoForRoomMode(rememberedCurrent, mode, sceneVideoId).sceneVideoByMode,
        ...hifiEqPatch,
        sceneSoundEnabled,
        playlistId: action.playlistId === undefined ? current.playlistId : action.playlistId,
        volumePercent: clampPercent(action.volumePercent, current.volumePercent),
        brightnessPercent: clampPercent(action.brightnessPercent, current.brightnessPercent),
        timerMinutes,
        timerEndsAt: buildTimerEndsAt(timerMinutes)
      };
      applyScene = sceneSoundEnabled;
      applyLevels = mode !== "hifi";
      stopScene = !sceneSoundEnabled;
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

async function runWebModeCommand(action, providerId = "", env = {}) {
  if (!WEB_MODE_COMMAND.trim()) return;
  const envPrefix = Object.entries(env)
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "")
    .map(([key, value]) => `${key}=${shellQuote(value)}`)
    .join(" ");
  const command = providerId
    ? `${WEB_MODE_COMMAND} ${shellQuote(action)} ${shellQuote(providerId)}`
    : `${WEB_MODE_COMMAND} ${shellQuote(action)}`;
  const commandWithEnv = envPrefix ? `${envPrefix} ${command}` : command;
  await runCommand(commandWithEnv, {
    allowFailure: false,
    timeout: action === "open" ? WEB_MODE_OPEN_COMMAND_TIMEOUT_MS : WEB_MODE_COMMAND_TIMEOUT_MS,
    includeStdoutOnFailure: true
  });
}

async function webModeCloseRequestIsCurrent(closeRequestId) {
  if (!closeRequestId) return true;
  const runtimeState = await readWebModeRuntimeState();
  return runtimeState.closeRequestId === closeRequestId && !runtimeState.activeProvider;
}

function runWebModeCloseInBackground(roomMode, closeRequestId = "", activeProvider = "") {
  if (webModeClosePromise) {
    return webModeClosePromise;
  }
  webModeCloseInFlight = true;
  webModeClosePromise = (async () => {
    let restoreError = null;
    try {
      await runWebModeCommand("close", "", {
        TIKPAL_WEB_MODE_EXIT_ROOM_MODE: roomMode,
        TIKPAL_WEB_MODE_CLOSE_ACTIVE_PROVIDER: activeProvider,
        TIKPAL_WEB_MODE_LOCK_TIMEOUT_SECONDS: "10"
      });
      if (await webModeCloseRequestIsCurrent(closeRequestId)) {
        try {
          const restoredPlayback = await restoreWebModePlaybackHandoff();
          if (restoredPlayback) {
            await refreshTikpalStateSnapshotAfterMutation({
              includeSourceRuntimeStatus: true
            });
          }
        } catch (error) {
          restoreError = `Explore closed; playback restore failed: ${error instanceof Error ? error.message : "unknown error"}`;
        }
      }
    } catch (error) {
      restoreError = formatWebModeCommandError(error, "close");
    } finally {
      webModeCloseInFlight = false;
      if (await webModeCloseRequestIsCurrent(closeRequestId).catch(() => false)) {
        await writeWebModeRuntimeState({
          activeProvider: null,
          residentProviders: {},
          lastError: restoreError,
          closeRequestId: null
        }).catch(() => {});
      }
      webModeClosePromise = null;
    }
  })();
  return webModeClosePromise;
}

function isWebModeSwitchingError(error) {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  return /Explore is already switching/i.test(raw);
}

async function runWebModeKeyboardCommand(keyboardCommand, keyboardEnv = {}) {
  let lastError = null;
  for (const retryDelayMs of [0, 500, 1200, 2000]) {
    if (retryDelayMs > 0) await wait(retryDelayMs);
    try {
      await runWebModeCommand("keyboard", keyboardCommand, keyboardEnv);
      return;
    } catch (error) {
      lastError = error;
      if (!isWebModeSwitchingError(error)) throw error;
    }
  }
  throw lastError;
}

function webModeProviderLabel(providerId) {
  return WEB_MODE_PROVIDERS.find((provider) => provider.id === providerId)?.label ?? "Explore";
}

function formatWebModeCommandError(error, action, providerId = "") {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const firstLine = raw.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
  if (isWebModeSwitchingError(error)) return "Explore is already switching";
  if (action === "open") {
    if (/needs proxy(?: on)?/i.test(raw)) {
      return `${webModeProviderLabel(providerId)} needs proxy`;
    }
    if (/did not open|did not appear|timed out|SIGKILL|Command failed|\[tikpal-web-mode\]/i.test(raw)) {
      return `${webModeProviderLabel(providerId)} did not open`;
    }
    return firstLine.slice(0, 160) || `${webModeProviderLabel(providerId)} did not open`;
  }
  if (action === "close") return firstLine.slice(0, 160) || "Explore close failed";
  if (action === "keyboard") return firstLine.slice(0, 160) || "Keyboard update failed";
  if (action === "proxy") {
    if (/needs proxy(?: on)?/i.test(raw)) {
      return `${webModeProviderLabel(providerId)} needs proxy`;
    }
    if (/proxy did not connect|proxy was not applied|timed out|SIGKILL|Command failed|\[tikpal-web-mode\]/i.test(raw)) {
      return "Proxy did not connect. Try again.";
    }
    return firstLine.slice(0, 160) || "Proxy did not connect. Try again.";
  }
  if (action === "provider_text_scale") return firstLine.slice(0, 160) || "Explore text scale update failed";
  return firstLine.slice(0, 160) || "Explore action failed";
}

async function captureWebModePlaybackHandoff() {
  const snapshot = await collectTikpalStateSnapshot({
    includeSlowRuntimeStatus: false,
    includeSourceRuntimeStatus: true,
    includeOutputVolumeStatus: false,
    skipExperienceReconcile: true
  });
  const sourceId = String(snapshot.audio?.currentSource?.id ?? snapshot.playback?.source ?? "").trim().toLowerCase();
  const activeQueueTrackPath = normalizeLocalLibraryStateTrackPath(
    snapshot.playback?.queuePreview?.find((entry) => entry.active)?.id
  );
  const localTrackPath = sourceId === "mpd"
    ? activeQueueTrackPath ?? await resolveCurrentLocalLibraryTrackPath()
    : null;
  const radioStationId = sourceId === "radio"
    ? normalizeRememberedRadioStationId(snapshot.audio?.currentSource?.radioStationId)
      ?? await resolveCurrentOrRememberedRadioStationId()
    : null;

  return await writeWebModeHandoffState({
    sourceId,
    playbackState: snapshot.playback?.state,
    localTrackPath,
    radioStationId,
    elapsedSeconds: snapshot.playback?.elapsedSeconds
  });
}

async function restoreMpdWebModeLibraryHandoff(handoff) {
  const localTrackPath = normalizeLocalLibraryStateTrackPath(handoff.localTrackPath);
  if (localTrackPath) {
    const [statusRaw, currentTrackPath] = await Promise.all([
      runMpc(["status"], { allowFailure: true, timeout: 2500 }),
      resolveCurrentLocalLibraryTrackPath()
    ]);
    const status = parseMpcStatus(statusRaw);
    if (status.queueLength > 0 && normalizeLocalLibraryStateTrackPath(currentTrackPath) === localTrackPath) {
      if (status.state !== "playing") {
        await runMpc(["play"], { timeout: 2500 });
      }
      return true;
    }
  }

  const restoreAction = {
    target: "mpd",
    ...(localTrackPath ? { localTrackPath } : {})
  };
  try {
    await applySourceSwitch(restoreAction, { rememberSource: false });
  } catch (error) {
    if (!localTrackPath) throw error;
    await applySourceSwitch({ target: "mpd" }, { rememberSource: false });
  }
  return true;
}

async function restoreWebModePlaybackHandoff() {
  const handoff = await readWebModeHandoffState();
  try {
    if (handoff.playbackState !== "playing") return false;

    if (handoff.sourceId === "mpd") {
      return await restoreMpdWebModeLibraryHandoff(handoff);
    }

    if (handoff.sourceId === "radio") {
      await applySourceSwitch({
        target: "radio",
        ...(handoff.radioStationId ? { radioStationId: handoff.radioStationId } : {})
      }, { rememberSource: false });
      return true;
    }

    return false;
  } finally {
    await clearWebModeHandoffState();
  }
}

async function pauseTikpalForWebMode() {
  const room = await readRoomExperienceState();
  if (room.sceneSoundEnabled) {
    await applyRoomExperienceAction({
      type: "set_scene_sound",
      sceneSoundEnabled: false,
      sceneVideoId: room.sceneVideoId
    });
  }

  if (API_MODE === "mpc") {
    await withMpcMutationLock(async () => {
      const before = parseMpcStatus(await runMpc(["status"], { timeout: 2500 }));
      const currentFile = (await runMpc(["--format", "%file%", "current"], { allowFailure: true, timeout: 2500 })).trim();
      if (before.state === "playing") {
        await runMpc([isStreamUri(currentFile) ? "stop" : "pause"], { timeout: 2500 });
      }
      const after = parseMpcStatus(await runMpc(["status"], { timeout: 2500 }));
      if (after.state === "playing") {
        throw new Error("Tikpal playback did not pause before Explore opened");
      }
    });
    suppressExternalHandoffAutoArm(60 * 60 * 1000);
    await enforceConnectionGate("web_mode");
    return;
  }

  await applyPlaybackActionForCurrentBackend({ type: "pause" });
}

let webModeKeyboardStickyUntilMs = 0;

async function applyWebModeAction(action) {
  const type = String(action?.type ?? "").trim().toLowerCase();
  if (type === "close") {
    const room = await readRoomExperienceState();
    if (webModeClosePromise) {
      const runtimeState = await readWebModeRuntimeState();
      if (!runtimeState.activeProvider && runtimeState.closeRequestId) {
        await writeWebModeRuntimeState({ closeRequestId: null });
      }
      return await buildWebModeState();
    }
    const closeRequestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const runtimeState = await readWebModeRuntimeState();
    const activeProvider = typeof runtimeState.activeProvider === "string" ? runtimeState.activeProvider : "";
    await writeWebModeRuntimeState({
      activeProvider: null,
      residentProviders: {},
      lastError: null,
      closeRequestId
    });
    runWebModeCloseInBackground(room.mode, closeRequestId, activeProvider);
    return await buildWebModeState();
  }

  if (type === "keyboard") {
    if (action?.enabled !== undefined && typeof action.enabled !== "boolean") {
      throw new Error("Explore keyboard enabled value must be boolean");
    }
    if (action?.force !== undefined && typeof action.force !== "boolean") {
      throw new Error("Explore keyboard force value must be boolean");
    }
    if (action?.keepAlive !== undefined && typeof action.keepAlive !== "boolean") {
      throw new Error("Explore keyboard keepAlive value must be boolean");
    }
    if (action?.sticky !== undefined && typeof action.sticky !== "boolean") {
      throw new Error("Explore keyboard sticky value must be boolean");
    }
    if (action?.dismissSticky !== undefined && typeof action.dismissSticky !== "boolean") {
      throw new Error("Explore keyboard dismissSticky value must be boolean");
    }
    if (action?.preload !== undefined && typeof action.preload !== "boolean") {
      throw new Error("Explore keyboard preload value must be boolean");
    }
    const keyboardPosition = normalizeWebModeKeyboardPosition(action?.keyboardPosition);
    const keyboardWindow = normalizeWebModeKeyboardWindow(action?.keyboardWindow);
    const keyboardTarget = normalizeWebModeKeyboardTarget(action?.keyboardTarget);
    const keyboardMode = action.preload === true ? "preload" : action.enabled === true ? "show" : action.enabled === false ? "hide" : "toggle";
    if (keyboardMode === "show" && action.sticky === true) {
      webModeKeyboardStickyUntilMs = Date.now() + WEB_MODE_KEYBOARD_STICKY_PROTECT_MS;
    }
    if (keyboardMode === "hide" && action.dismissSticky !== true && Date.now() < webModeKeyboardStickyUntilMs) {
      await writeWebModeRuntimeState({ lastError: null });
      return await buildWebModeState();
    }
    if (keyboardMode === "hide" && action.dismissSticky === true) {
      webModeKeyboardStickyUntilMs = 0;
    }
    const keyboardCommand = keyboardMode === "show" && action.keepAlive === true
      ? "keepalive"
      : keyboardMode === "show" && action.force === true
        ? "show-force"
        : keyboardMode;
    const shouldApplyKeyboardPlacement = keyboardMode === "show" && action.keepAlive !== true && Boolean(keyboardPosition || keyboardWindow);
    const keyboardEnv = keyboardMode === "hide" || keyboardMode === "preload" || (!keyboardPosition && !keyboardWindow && keyboardTarget === "auto")
      ? {}
      : {
          ...(keyboardTarget !== "auto" ? { TIKPAL_WEB_MODE_KEYBOARD_TARGET: keyboardTarget } : {}),
          ...(shouldApplyKeyboardPlacement ? { TIKPAL_WEB_MODE_ONBOARD_REQUESTED_POSITION: "1" } : {}),
          ...(keyboardPosition ? { TIKPAL_WEB_MODE_ONBOARD_ACTION_POSITION: keyboardPosition, TIKPAL_WEB_MODE_ONBOARD_POSITION: keyboardPosition } : {}),
          ...(keyboardWindow ? { TIKPAL_WEB_MODE_ONBOARD_ACTION_WINDOW: keyboardWindow, TIKPAL_WEB_MODE_ONBOARD_WINDOW: keyboardWindow } : {})
        };
    try {
      await runWebModeKeyboardCommand(keyboardCommand, keyboardEnv);
      await writeWebModeRuntimeState({ lastError: null });
    } catch (error) {
      const message = formatWebModeCommandError(error, "keyboard");
      await writeWebModeRuntimeState({ lastError: message });
      throw new Error(message);
    }
    return await buildWebModeState();
  }

  if (type === "proxy") {
    if (typeof action?.enabled !== "boolean") {
      throw new Error("Explore proxy action requires a boolean enabled value");
    }
    const previousSettings = await ensureWebModeSettings();
    const runtimeState = await readWebModeRuntimeState();
    await writeWebModeSettings({ proxyEnabled: action.enabled });
    await writeWebModeRuntimeState({ proxyAppliedSettingsUpdatedAt: null, lastError: null });
    if (!runtimeState.activeProvider) return await buildWebModeState();

    try {
      await runWebModeCommand("proxy", runtimeState.activeProvider);
      await writeWebModeRuntimeState({ lastError: null });
    } catch (error) {
      await writeWebModeSettings({
        proxyEnabled: previousSettings.proxyEnabled,
        proxyUrl: previousSettings.proxyUrl
      });
      const message = formatWebModeCommandError(error, "proxy", runtimeState.activeProvider);
      await writeWebModeRuntimeState({ proxyAppliedSettingsUpdatedAt: null, lastError: message });
      throw new Error(message);
    }
    return await buildWebModeState();
  }

  if (type === "provider_text_scale") {
    const providerTextScale = normalizeWebModeProviderTextScale(action?.providerTextScale);
    await writeWebModeSettings({ providerTextScale });
    await writeWebModeRuntimeState({ lastError: null });
    return await buildWebModeState();
  }

  if (type !== "open") {
    throw new Error("Explore action type must be open, close, keyboard, proxy, or provider_text_scale");
  }

  const providerId = normalizeWebModeProviderId(action.provider);
  const previousRuntimeState = await readWebModeRuntimeState();
  let providerOpenCommandStarted = false;
  webModeOpenInFlight = true;
  try {
    if (!previousRuntimeState.activeProvider) {
      await captureWebModePlaybackHandoff();
      await pauseTikpalForWebMode();
    }
    providerOpenCommandStarted = true;
    await runWebModeCommand("open", providerId);
    await writeWebModeRuntimeState({ activeProvider: providerId, lastError: null, closeRequestId: null });
  } catch (error) {
    const message = formatWebModeCommandError(error, "open", providerId);
    const clearFailedCurrentProvider = providerOpenCommandStarted
      && previousRuntimeState.activeProvider === providerId
      && /\bdid not open\b|\bdid not enter\b|\bdid not become ready\b/i.test(message);
    await writeWebModeRuntimeState({
      activeProvider: previousRuntimeState.activeProvider && !clearFailedCurrentProvider
        ? previousRuntimeState.activeProvider
        : null,
      lastError: message
    });
    throw new Error(message);
  } finally {
    webModeOpenInFlight = false;
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
  if (Object.prototype.hasOwnProperty.call(patch ?? {}, "providerTextScale")) {
    next.providerTextScale = normalizeWebModeProviderTextScale(patch.providerTextScale);
  }
  await writeWebModeSettings(next);
  return await buildWebModeState();
}

async function confirmWebModeProxyApplied(payload) {
  const settings = await ensureWebModeSettings();
  const settingsUpdatedAt = typeof payload?.settingsUpdatedAt === "string" ? payload.settingsUpdatedAt : "";
  if (!settingsUpdatedAt || settingsUpdatedAt !== settings.updatedAt) {
    throw new Error("Explore proxy confirmation does not match the current settings revision");
  }
  await writeWebModeRuntimeState({ proxyAppliedSettingsUpdatedAt: settingsUpdatedAt });
  return { ok: true, settingsUpdatedAt };
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
  const [state, experience, sceneCatalog, webMode, preferences] = await Promise.all([
    getTikpalState(),
    getRoomExperienceState(),
    getAmbientBackgroundVideosPayload(),
    buildWebModeState(),
    readUiPreferences()
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
    explore: {
      activeProvider: webMode.activeProvider,
      activeProviderLabel: webMode.activeProvider ? webModeProviderLabel(webMode.activeProvider) : null,
      proxyEnabled: webMode.settings.proxyEnabled,
      lastError: webMode.lastError
    },
    runtime: state.runtime,
    preferences,
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
    case "explore.open":
      await applyWebModeAction({ type: "open", provider: "qq_music" });
      break;
    case "explore.close":
      await applyWebModeAction({ type: "close" });
      break;
    case "explore.proxy_set": {
      await applyWebModeAction({
        type: "proxy",
        enabled: requireRemoteBoolean(action.enabled, "explore.proxy_set")
      });
      break;
    }
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

    if (request.method === "GET" && url.pathname === "/api/v1/preferences") {
      sendJson(response, 200, await readUiPreferences());
      return;
    }

    if (request.method === "PATCH" && url.pathname === "/api/v1/preferences") {
      sendJson(response, 200, await writeUiPreferences(await readJson(request)));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/audio/output-diagnostics") {
      sendJson(response, 200, await readAudioOutputDiagnostics());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/multiroom") {
      sendJson(response, 200, await readMultiroomState({ releaseMpd: false }));
      return;
    }

    const multiroomEcosystemMatch = url.pathname.match(/^\/api\/v1\/multiroom\/ecosystems\/([^/]+)$/);
    if (request.method === "PATCH" && multiroomEcosystemMatch) {
      const ecosystemId = decodeURIComponent(multiroomEcosystemMatch[1] ?? "");
      sendJson(response, 200, await updateMultiroomEcosystemState(ecosystemId, await readJson(request)));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/roonbridge") {
      sendJson(response, 200, await readRoonBridgeState({ releaseMpd: false }));
      return;
    }

    if (request.method === "PATCH" && url.pathname === "/api/v1/roonbridge") {
      await updateRoonBridgeState(await readJson(request));
      sendJson(response, 200, await readRoonBridgeState({ releaseMpd: true }));
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

    if (request.method === "POST" && url.pathname === "/api/v1/web-mode/proxy-applied") {
      sendJson(response, 200, await confirmWebModeProxyApplied(await readJson(request)));
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

    if (request.method === "GET" && url.pathname === "/api/v1/nas/sources") {
      sendJson(response, 200, await buildNasSourcesPayload());
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v1/nas/sources") {
      sendJson(response, 200, await saveNasSource(await readJson(request)));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v1/nas/discover") {
      sendJson(response, 200, await discoverNasCandidates(await readJson(request)));
      return;
    }

    {
      const nasSourceMatch = url.pathname.match(/^\/api\/v1\/nas\/sources\/([^/]+)(?:\/([^/]+))?$/);
      if (nasSourceMatch) {
        const sourceId = decodeURIComponent(nasSourceMatch[1]);
        const action = nasSourceMatch[2] ? decodeURIComponent(nasSourceMatch[2]) : "";
        if (request.method === "DELETE" && !action) {
          sendJson(response, 200, await deleteNasSource(sourceId));
          return;
        }
        if (request.method === "POST" && action === "test") {
          sendJson(response, 200, await testNasSource(sourceId, await readJson(request)));
          return;
        }
        if (request.method === "POST" && action === "mount") {
          sendJson(response, 200, await mountSavedNasSource(sourceId, await readJson(request)));
          return;
        }
        if (request.method === "POST" && action === "unmount") {
          sendJson(response, 200, await unmountNasSource(sourceId));
          return;
        }
      }
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

      const svg = buildGeneratedArtworkSvg(currentArtworkState, url.searchParams.get("fontTheme"));
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

    if (request.method === "POST" && url.pathname === "/api/v1/audio/library-actions") {
      sendJson(response, 200, await applyAudioLibraryAction(await readJson(request)));
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
    setTimeout(() => {
      void mountEnabledNasSourcesOnStartup();
    }, NAS_AUTO_MOUNT_DELAY_MS);
    startupPlaybackPolicyPromise = applyStartupPlaybackPolicy().finally(() => {
      startupPlaybackPolicyPromise = null;
      startTikpalStateSnapshotCollector();
      startMpcShuffleMonitor();
      void readUiPreferences()
        .then((preferences) => scheduleAudioOutputProfileAutoStop(preferences.audioOutputProfile))
        .catch(() => undefined);
    });
    void startupPlaybackPolicyPromise;
  }
});

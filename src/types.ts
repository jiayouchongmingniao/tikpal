export type AppMode = "ambient" | "player" | "playlist" | "quickSettings" | "quickMenu";
export type FontTheme = "system" | "hardware" | "precision" | "sans" | "serif" | "mono";
export type SurfaceTheme = "warm-gold" | "graphite-silver" | "ivory-studio";
export type LyricsFontSize = "small" | "medium" | "large";
export type RoomMode = "focus" | "calm" | "sleep" | "hifi";
export type RoomSessionPhase = "idle" | "preparing" | "active" | "windDown";
export type HifiEqPresetId = "flat" | "warm" | "vocal";
export type HifiVisualPresetId = "spectrum-bars" | "waveform" | "dual-vu";

export type PlaybackState = "playing" | "paused" | "stopped";
export type PlaybackMode = "sequence" | "repeat_one" | "shuffle";

export type SourceState =
  | "audio"
  | "scene"
  | "mpd"
  | "airplay"
  | "spotify"
  | "bluetooth"
  | "roonbridge"
  | "upnp"
  | "radio";

export type SourceAvailability = "available" | "waiting" | "unavailable";
export type SourceControllability = "switchable" | "handoff" | "status-only";
export type SourceSwitchTarget = "mpd" | "audio" | "scene" | "radio" | "spotify" | "bluetooth" | "airplay" | "upnp";
export type SourceConnectionState = "idle" | "armed" | "connected" | "blocked";

export interface RadioStationSummary {
  id: string;
  label: string;
  uri: string;
  genre: string;
  bitrateKbps: number | null;
  codec: string | null;
  secondaryStatus: string;
  active: boolean;
}

export interface SourceSummary {
  id: SourceState;
  label: string;
  kind: SourceState;
  availability: SourceAvailability;
  active: boolean;
  controllability: SourceControllability;
  armed: boolean;
  connectionState: SourceConnectionState;
  connectedLabel: string | null;
  advertisedLabel: string | null;
  secondaryStatus: string;
}

export interface AudioState {
  currentSource: SourceSummary;
  sources: SourceSummary[];
}

export interface AudioSpectrumFrame {
  bands: number[];
  peaks: {
    left: number;
    right: number;
  };
  source: "mock" | "command" | "fallback";
  bandCount: number;
  updatedAt: string;
}

export interface RadioCatalogFilters {
  q?: string;
  genre?: string;
  bitrate?: string;
  limit?: number;
  offset?: number;
}

export interface RadioCatalogResponse {
  stations: RadioStationSummary[];
  total: number;
  genres: string[];
  bitrates: string[];
  filters: {
    q: string;
    genre: string;
    bitrate: string;
    limit: number;
    offset: number;
  };
  updatedAt: string;
}

export type AudioLibraryStorageId = "local" | "nas" | "usb" | "favorites" | "recently_added";
export type AudioLibraryCategoryId = "focus" | "meditation" | "rest";
export type AudioLibraryTrackCategoryId = AudioLibraryCategoryId | "nas";

export interface AudioLibrarySubCategorySummary {
  id: string;
  label: string;
  trackCount: number;
}

export interface AudioLibraryCategorySummary {
  id: AudioLibraryCategoryId;
  label: string;
  trackCount: number;
  subCategories: AudioLibrarySubCategorySummary[];
}

export interface AudioLibraryStorageSummary {
  id: AudioLibraryStorageId;
  label: string;
  trackCount: number;
  categories: AudioLibraryCategorySummary[];
}

export interface AudioLibraryTrackSummary {
  id: string;
  title: string;
  artist: string;
  album: string;
  storage: AudioLibraryStorageId;
  categoryId: AudioLibraryTrackCategoryId;
  subCategory: string;
  durationSeconds: number | null;
  path: string | null;
  albumArtUrl: string | null;
  albumArtLabel: string | null;
  albumArtScope: string | null;
  active: boolean;
  favorite: boolean;
}

export interface AudioLibraryFilters {
  storage?: AudioLibraryStorageId | "all";
  category?: AudioLibraryCategoryId;
  subCategory?: string;
  limit?: number;
  offset?: number;
}

export interface AudioLibraryResponse {
  sources: Array<{
    id: "library" | "radio" | "spotify" | "airplay" | "bluetooth" | "upnp";
    label: string;
  }>;
  storages: AudioLibraryStorageSummary[];
  tracks: AudioLibraryTrackSummary[];
  total: number;
  filters: {
    storage: AudioLibraryStorageId | "all";
    category: AudioLibraryCategoryId | "";
    subCategory: string;
    limit: number;
    offset: number;
  };
  updatedAt: string;
}

export type AudioPlaylistSource = "user" | "curated";
export type AudioPlaylistCoverType = "gradient" | "scene" | "collage" | "custom";

export interface AudioPlaylistTrackSummary extends AudioLibraryTrackSummary {
  position: number;
}

export interface AudioPlaylistSummary {
  id: string;
  name: string;
  source: AudioPlaylistSource;
  readOnly: boolean;
  description?: string;
  moodTags: string[];
  coverType: AudioPlaylistCoverType;
  coverValue?: string | null;
  trackCount: number;
  durationSeconds: number | null;
  createdAt?: string | null;
  updatedAt: string | null;
  tracks: AudioPlaylistTrackSummary[];
}

export interface AudioPlaylistResponse {
  playlists: AudioPlaylistSummary[];
  updatedAt: string;
}

export type AudioPlaylistActionType =
  | "rename"
  | "delete"
  | "add_track"
  | "remove_track"
  | "move_track"
  | "replace_tracks"
  | "duplicate"
  | "update_metadata"
  | "play";

export interface AudioPlaylistActionRequest {
  type: AudioPlaylistActionType;
  playlistId: string;
  name?: string;
  description?: string;
  moodTags?: string[];
  coverType?: AudioPlaylistCoverType;
  coverValue?: string | null;
  trackPath?: string;
  trackPaths?: string[];
  fromIndex?: number;
  toIndex?: number;
  startIndex?: number;
}

export interface AudioPlaylistCreateRequest {
  name: string;
  description?: string;
  moodTags?: string[];
  coverType?: AudioPlaylistCoverType;
  coverValue?: string | null;
  trackPaths?: string[];
}

export interface BackgroundVideoSummary {
  id: string;
  filename: string;
  label: string;
  src: string;
  order?: number;
  default?: boolean;
  source?: "legacy" | "scene";
  roomModes?: RoomMode[];
}

export interface BackgroundVideoCatalogResponse {
  videos: BackgroundVideoSummary[];
  total: number;
  updatedAt: string;
  catalogVersion?: string | null;
  defaultVideoId?: string | null;
}

export interface VolumeState {
  db: number;
  percent: number;
  muted: boolean;
}

export interface NetworkState {
  kind: "ethernet" | "wifi" | "offline";
  label: string;
  ip: string;
  speed: string;
}

export interface OutputDeviceState {
  kind: "usb" | "i2s" | "hdmi" | "bluetooth" | "none";
  label: string;
  detail: string;
}

export interface DisplayState {
  brightnessPercent: number;
  controllable: boolean;
  transport: "ddcci" | "mock" | "unavailable";
}

export interface AudioFormatState {
  codec: string;
  bitDepth: number | null;
  sampleRate: number | null;
  container: string;
}

export interface HifiEqPresetSummary {
  id: HifiEqPresetId;
  label: string;
  intent: string;
  hifiVisualPresetId: HifiVisualPresetId;
}

export interface DspState {
  enabled: boolean;
  preset: string;
  presetId: HifiEqPresetId;
  presetLabel: string;
  controllable: boolean;
  controlTransport: "mock" | "command" | "unavailable";
  availablePresets: HifiEqPresetSummary[];
}

export interface SystemState {
  network: NetworkState;
  display: DisplayState;
  outputDevice: OutputDeviceState;
  volume: VolumeState;
  audioFormat: AudioFormatState;
  sampleRate: number | null;
  bitDepth: number | null;
  cpuTemp: number | null;
  dspState: DspState;
  library: {
    source: string;
    trackCount: number;
    lastScan: string;
    scanning: boolean;
  };
  uptime: string;
}

export interface PlaybackSummary {
  state: PlaybackState;
  source: SourceState;
  albumArtUrl: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  elapsedSeconds: number | null;
  durationSeconds: number | null;
  timingDiagnostics: PlaybackTimingDiagnostics | null;
  currentTrackIndex: number;
  queueLength: number;
  favorite: boolean;
  settings: PlaybackSettings;
  queuePreview: QueueEntrySummary[];
}

export interface PlaybackSettings {
  playMode: PlaybackMode;
}

export interface PlaybackTimingDiagnostics {
  metadataMtimeMs: number | null;
  airplayStartedAtMs: number | null;
  airplayStoppedAtMs: number | null;
  clockStartMs: number | null;
  clockLeadMs: number | null;
  effectiveClockStartMs: number | null;
  clockStartReason: "airplay_event" | "metadata_mtime" | string | null;
}

export interface QueueEntrySummary {
  id: string;
  position: number;
  title: string;
  artist: string;
  album: string;
  durationSeconds: number | null;
  active: boolean;
}

export interface RuntimeState {
  rendererType: "media" | "webgl" | "fallback" | "unknown";
  requestedRenderer: string;
  kioskWindow: "2560x720";
  appVersion: string;
  apiMode: "mock" | "mpc";
  updatedAt: string;
}

export interface LyricsLine {
  text: string;
  startMs: number | null;
  endMs: number | null;
}

export type LyricsTimingStrategy =
  | "provider_synced"
  | "bluez_duration_clipped"
  | "estimated_plain"
  | "plain_static"
  | "static_duration_mismatch"
  | null;

export interface LyricsState {
  status: "idle" | "recognizing" | "ready" | "not_found" | "error";
  sourceScope: "local_playback" | "bluetooth_input" | "airplay_input";
  providerMode: "online";
  recognitionMode: "metadata" | "fingerprint" | null;
  recognitionProvider: "lrclib" | "acrcloud" | null;
  recognitionConfidence: number | null;
  trackKey: string | null;
  title: string | null;
  artist: string | null;
  synced: boolean;
  timingStrategy: LyricsTimingStrategy;
  activeLineIndex: number | null;
  lines: LyricsLine[];
  message: string | null;
  updatedAt: string;
}

export interface TikpalState {
  playback: PlaybackSummary;
  system: SystemState;
  runtime: RuntimeState;
  audio: AudioState;
  lyrics: LyricsState;
}

export interface RoomExperienceState {
  mode: RoomMode;
  phase: RoomSessionPhase;
  presetId: string;
  sceneVideoId: string;
  hifiEqPresetId: HifiEqPresetId;
  hifiVisualPresetId: HifiVisualPresetId;
  sceneSoundEnabled: boolean;
  playlistId: string | null;
  volumePercent: number;
  brightnessPercent: number;
  timerMinutes: number | null;
  timerEndsAt: string | null;
  nightSchedule: NightScheduleState;
  updatedAt: string;
}

export interface NightScheduleState {
  enabled: boolean;
  timeZone: string;
  start: string;
  end: string;
  brightnessPercent: number;
  active: boolean;
  preNightBrightnessPercent: number | null;
}

export type RoomExperienceActionType =
  | "set_mode"
  | "start_session"
  | "stop_session"
  | "update_timer"
  | "apply_preset"
  | "set_scene_sound"
  | "set_hifi_eq"
  | "set_hifi_visual"
  | "update_night_schedule";

export interface RoomExperienceActionRequest {
  type: RoomExperienceActionType;
  mode?: RoomMode;
  presetId?: string;
  sceneVideoId?: string;
  hifiEqPresetId?: HifiEqPresetId;
  hifiVisualPresetId?: HifiVisualPresetId;
  sceneSoundEnabled?: boolean;
  playlistId?: string | null;
  volumePercent?: number;
  brightnessPercent?: number;
  timerMinutes?: number | null;
  timerEndsAt?: string | null;
  nightSchedule?: Partial<NightScheduleState>;
}

export type PlaybackActionType =
  | "play_pause"
  | "play"
  | "pause"
  | "next"
  | "previous"
  | "seek"
  | "favorite_toggle"
  | "play_mode_set"
  | "volume_set";
export type SystemActionType = "library_scan" | "reboot" | "shutdown" | "brightness_set";

export interface PlaybackActionRequest {
  type: PlaybackActionType;
  value?: number;
  mode?: PlaybackMode;
}

export interface SystemActionRequest {
  type: SystemActionType;
  value?: number;
}

export interface SourceSwitchRequest {
  target: SourceSwitchTarget;
  radioStationId?: string;
  localTrackPath?: string;
  sceneVideoId?: string;
  sceneVideoLabel?: string;
  sceneVideoSrc?: string;
}

export type RemoteActionType =
  | "playback.play_pause"
  | "playback.play"
  | "playback.pause"
  | "playback.next"
  | "playback.previous"
  | "playback.seek"
  | "playback.play_mode_set"
  | "volume_set"
  | "source.set"
  | "room.set_mode"
  | "room.start_session"
  | "room.stop_session"
  | "room.update_timer"
  | "scene.set"
  | "scene.sound_set"
  | "hifi.eq_set"
  | "display.brightness_set"
  | "lyrics.refresh";

export interface RemoteActionRequest {
  type: RemoteActionType;
  value?: number;
  mode?: RoomMode;
  playbackMode?: PlaybackMode;
  target?: Exclude<SourceSwitchTarget, "audio" | "scene">;
  radioStationId?: string;
  localTrackPath?: string;
  sceneVideoId?: string;
  sceneVideoLabel?: string;
  sceneVideoSrc?: string;
  sceneSoundEnabled?: boolean;
  enabled?: boolean;
  hifiEqPresetId?: HifiEqPresetId;
  timerMinutes?: number | null;
  timerEndsAt?: string | null;
}

export interface RemoteStateResponse {
  playback: PlaybackSummary;
  volume: VolumeState;
  room: {
    mode: RoomMode;
    phase: RoomSessionPhase;
    presetId: string;
    timerMinutes: number | null;
    timerEndsAt: string | null;
    updatedAt: string;
  };
  scene: {
    videoId: string;
    video: BackgroundVideoSummary | null;
    sceneSoundEnabled: boolean;
    availableCount: number;
    catalogVersion: string | null;
  };
  source: {
    current: SourceSummary;
    sources: SourceSummary[];
  };
  display: DisplayState;
  hifi: {
    eqPresetId: HifiEqPresetId;
    visualPresetId: HifiVisualPresetId;
    availablePresets: HifiEqPresetSummary[];
    controllable: boolean;
    controlTransport: DspState["controlTransport"];
  };
  runtime: RuntimeState;
  updatedAt: string;
}

export interface RemoteCatalogResponse {
  allowedActions: RemoteActionType[];
  playbackModes: PlaybackMode[];
  sourceTargets: Array<Exclude<SourceSwitchTarget, "audio" | "scene">>;
  sources: SourceSummary[];
  roomModes: Array<{
    id: RoomMode;
    label: string;
    presetId: string;
    sceneVideoId: string;
    sceneVideoLabel: string;
    hifiEqPresetId: HifiEqPresetId;
    hifiVisualPresetId: HifiVisualPresetId;
    sceneSoundEnabled: boolean;
    volumePercent: number;
    brightnessPercent: number;
    timerMinutes: number | null;
  }>;
  sceneVideos: BackgroundVideoSummary[];
  hifiEqPresets: HifiEqPresetSummary[];
  updatedAt: string;
}

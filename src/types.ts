export type AppMode = "ambient" | "player" | "quickSettings" | "quickMenu";
export type FontTheme = "system" | "hardware" | "precision" | "sans" | "serif" | "mono";
export type SurfaceTheme = "warm-gold" | "graphite-silver" | "ivory-studio";
export type LyricsFontSize = "small" | "medium" | "large";
export type RoomMode = "focus" | "calm" | "sleep" | "hifi";
export type RoomSessionPhase = "idle" | "preparing" | "active" | "windDown";
export type HifiEqPresetId = "flat" | "warm" | "vocal";
export type HifiVisualPresetId = "spectrum-bars" | "waveform" | "dual-vu";
export type UiLocale = "en" | "zh-CN" | "de" | "it" | "ko" | "ja" | "es";
export type UiInputMethodId = "keyboard-us" | "pinyin" | "keyboard-de" | "keyboard-it" | "hangul" | "anthy" | "keyboard-es";
export type DisplaySleepStyle = "meteor_shower" | "clock" | "now_playing" | "starfield" | "signal";
export type MpdBitPerfectMode = "standard" | "strict";
export type AudioOutputProfile = "pure" | "everyday" | "sleep" | "custom";
export type AudioOutputCustomSettingId =
  | "pureDirect"
  | "volumeNormalization"
  | "smoothTransition"
  | "automaticSampleRate"
  | "dsdMode"
  | "playbackStability";

export type AudioOutputCustomSettings = Record<AudioOutputCustomSettingId, boolean>;

export interface AudioOutputCapabilities {
  purePath: "native" | "resampled" | "unknown";
  targetRateHz: number | null;
}

export interface UiPreferences {
  locale: UiLocale;
  inputMethodId: UiInputMethodId;
  fontTheme: FontTheme;
  audioOutputProfile: AudioOutputProfile;
  audioOutputCustomSettings: AudioOutputCustomSettings;
  audioOutputCapabilities: AudioOutputCapabilities;
  mpdBitPerfectMode: MpdBitPerfectMode;
  displaySleepEnabled: boolean;
  displaySleepMinutes: 5 | 10 | 15 | 30 | 60;
  displaySleepStyle: DisplaySleepStyle;
  updatedAt: string | null;
  warning?: string | null;
}

export interface UiPreferencesPatch {
  locale?: UiLocale;
  fontTheme?: FontTheme;
  audioOutputProfile?: AudioOutputProfile;
  audioOutputCustomSettings?: Partial<AudioOutputCustomSettings>;
  mpdBitPerfectMode?: MpdBitPerfectMode;
  displaySleepEnabled?: boolean;
  displaySleepMinutes?: 5 | 10 | 15 | 30 | 60;
  displaySleepStyle?: DisplaySleepStyle;
}

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
  | "lyrion"
  | "tikpal_multiroom"
  | "music_assistant"
  | "upnp"
  | "radio";

export type SourceAvailability = "available" | "waiting" | "unavailable";
export type SourceControllability = "switchable" | "handoff" | "status-only";
export type SourceSwitchTarget = "mpd" | "audio" | "scene" | "radio" | "spotify" | "bluetooth" | "airplay" | "roonbridge" | "upnp";
export type SourceConnectionState = "idle" | "armed" | "connected" | "blocked";
export type RememberedAudioSourceTarget = Exclude<SourceSwitchTarget, "audio" | "scene">;
export type WebModeProviderId =
  | "suno"
  | "spotify"
  | "youtube_music"
  | "apple_music"
  | "tidal"
  | "qobuz"
  | "deezer"
  | "amazon_music"
  | "qq_music"
  | "netease_music";

export interface WebModeProviderSummary {
  id: WebModeProviderId;
  label: string;
  url: string;
  experimental: boolean;
}

export type WebModeResidentProviderStatus = "opening" | "prewarming" | "ready" | "active" | "check_setup" | "check_proxy" | "region_unavailable";

export interface WebModeResidentProviderState {
  status: WebModeResidentProviderStatus;
  lastError: string | null;
  updatedAt: string | null;
}

export interface WebModeSettings {
  proxyEnabled: boolean;
  proxyUrl: string;
  providerTextScale: number;
  updatedAt: string | null;
}

export interface WebModeState {
  enabled: boolean;
  activeProvider: WebModeProviderId | null;
  openingProvider: WebModeProviderId | null;
  openRequestId: string | null;
  openStartedAt: string | null;
  openXSessionGeneration: string | null;
  lastProvider: WebModeProviderId | null;
  providers: WebModeProviderSummary[];
  residentProviders: Partial<Record<WebModeProviderId, WebModeResidentProviderState>>;
  prewarmComplete: boolean;
  settings: WebModeSettings;
  preferences: UiPreferences;
  lastError: string | null;
  updatedAt: string;
  activationPhase?: "pending" | "ready" | null;
}

export interface WebModeActionRequest {
  type: "open" | "close" | "keyboard" | "proxy" | "provider_text_scale";
  provider?: WebModeProviderId;
  openRequestId?: string;
  enabled?: boolean;
  force?: boolean;
  keepAlive?: boolean;
  sticky?: boolean;
  dismissSticky?: boolean;
  preload?: boolean;
  keyboardTarget?: "auto" | "kiosk" | "provider";
  keyboardPosition?: string;
  keyboardWindow?: string;
  providerTextScale?: number;
}

export interface WebModeSettingsPatch {
  proxyEnabled?: boolean;
  proxyUrl?: string;
  providerTextScale?: number;
}

export interface WebModeProxyTestCheck {
  id: "google" | "apple_music" | "spotify";
  label: string;
  url: string;
  ok: boolean;
}

export interface WebModeProxyTestResponse {
  ok: boolean;
  message: string;
  proxyUrl: string;
  checks: WebModeProxyTestCheck[];
}

export interface WebModeOwnershipCheck {
  supported: boolean;
  ok: boolean;
  repaired: boolean;
  mismatches: string[];
  repairedPaths: string[];
  blockedPaths: string[];
  message: string;
}

export interface RadioStationSummary {
  id: string;
  label: string;
  uri: string;
  genre: string;
  bitrateKbps: number | null;
  codec: string | null;
  category: string | null;
  categoryLabel: string | null;
  tags: string[];
  broadcaster: string | null;
  logoUrl: string | null;
  catalogSource: "tikpal" | "moode" | "fallback";
  sortOrder: number | null;
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
  radioStationId?: string | null;
}

export interface RememberedAudioSource {
  target: RememberedAudioSourceTarget;
  localTrackPath?: string | null;
  radioStationId?: string | null;
  updatedAt: string | null;
}

export interface AudioState {
  currentSource: SourceSummary;
  sources: SourceSummary[];
  rememberedSource?: RememberedAudioSource | null;
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
  category?: string;
  scope?: "tikpal" | "all";
  limit?: number;
  offset?: number;
}

export interface RadioCatalogResponse {
  stations: RadioStationSummary[];
  total: number;
  genres: string[];
  categories: Array<{
    id: string;
    label: string;
    count: number;
  }>;
  bitrates: string[];
  filters: {
    q: string;
    genre: string;
    bitrate: string;
    category: string | null;
    scope: "tikpal" | "all";
    limit: number;
    offset: number;
  };
  scope: "tikpal" | "all";
  updatedAt: string;
}

export type AudioLibraryStorageId = "local" | "nas" | "usb" | "favorites" | "recently_added";
export type AudioLibraryCategoryId = "focus" | "meditation" | "rest";
export type AudioLibraryTrackCategoryId = AudioLibraryCategoryId | "nas" | "usb";

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

export interface AudioLibraryDiskSummary {
  rootPath: string;
  totalBytes: number | null;
  usedBytes: number | null;
  freeBytes: number | null;
  usedPercent: number | null;
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
  fileSizeBytes?: number | null;
  codec?: string | null;
  container?: string | null;
  sampleRateHz?: number | null;
  bitrateKbps?: number | null;
  bitDepth?: number | null;
  channels?: number | null;
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
  localStorage?: AudioLibraryDiskSummary;
  updatedAt: string;
}

export interface AudioLibraryActionRequest {
  type: "copy_to_local" | "delete_local";
  trackPath: string;
}

export interface AudioLibraryActionResponse {
  ok: boolean;
  copied?: boolean;
  deleted?: boolean;
  copiedTrackPath?: string | null;
  deletedTrackPath?: string | null;
  library: AudioLibraryResponse;
}

export type NasAuthMode = "guest" | "password" | "manual";
export type NasSourceStatus = "ready" | "offline" | "checking" | "check_setup" | "manual";
export type NasSourceKind = "configured" | "manual";

export interface NasSourceStatusSummary {
  status: NasSourceStatus;
  checkedAt: string | null;
  lastError: string | null;
  lastRawError?: string | null;
}

export interface NasSourceSummary {
  id: string;
  name: string;
  host: string;
  port: number;
  share: string;
  path: string;
  authMode: NasAuthMode;
  username: string;
  enabled: boolean;
  mountName: string;
  mountPoint: string;
  mpdPath: string | null;
  smbVersion: string | null;
  status: NasSourceStatus;
  lastStatus: NasSourceStatusSummary;
  lastError: string | null;
  lastRawError?: string | null;
  lastScanAt: string | null;
  trackCount: number;
  sourceKind: NasSourceKind;
  readOnly: boolean;
  hasCredentials: boolean;
}

export interface NasSourcesResponse {
  sources: NasSourceSummary[];
  configuredCount: number;
  legacyCount: number;
  updatedAt: string;
}

export interface NasSourceInput {
  id?: string;
  name: string;
  host: string;
  port?: number;
  share: string;
  path?: string;
  authMode: Exclude<NasAuthMode, "manual">;
  username?: string;
  password?: string;
  enabled?: boolean;
  mountName?: string;
}

export interface NasSourceTestResponse {
  ok: boolean;
  status: NasSourceStatus;
  source?: NasSourceSummary;
  mpdPath?: string | null;
  trackCount?: number;
  smbVersion?: string | null;
  lastError?: string | null;
  lastRawError?: string | null;
}

export interface NasDiscoverCandidate {
  id: string;
  name: string;
  host: string;
  port: number;
  share: string;
  path: string;
  authMode: Exclude<NasAuthMode, "manual">;
  mountName: string;
  source: "hint" | "scan";
}

export interface NasDiscoverResponse {
  candidates: NasDiscoverCandidate[];
  total: number;
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
  thumbnailSrc?: string;
  order?: number;
  default?: boolean;
  source?: "legacy" | "scene";
  roomModes?: RoomMode[];
  audioGainDb?: number;
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
  transport: "ddcci" | "mock" | "turzx" | "turzx-soft" | "unavailable";
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

export interface RoonBridgeState {
  id?: "roon";
  enabled: boolean;
  ready: boolean;
  active: boolean;
  serviceActive: boolean;
  label: string;
  lastError: string | null;
  updatedAt: string;
}

export interface RoonBridgeUpdateRequest {
  enabled: boolean;
}

export type MultiroomEcosystemId = "roon" | "lyrion" | "tikpal" | "music_assistant";

export interface MultiroomEcosystemState {
  id: MultiroomEcosystemId;
  enabled: boolean;
  ready: boolean;
  active: boolean;
  serviceActive: boolean;
  label: string;
  lastError: string | null;
  comingSoon?: boolean;
  updatedAt: string;
}

export interface MultiroomAudioState {
  ecosystems: Record<MultiroomEcosystemId, MultiroomEcosystemState>;
  activeEcosystemId: MultiroomEcosystemId | null;
  updatedAt: string;
}

export interface MultiroomUpdateRequest {
  enabled: boolean;
}

export interface AudioOutputDiagnostics {
  profile: AudioOutputProfile;
  text: string;
  updatedAt: string;
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
  multiroom: MultiroomAudioState;
  roonBridge: RoonBridgeState;
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
  transportCapabilities?: PlaybackTransportCapabilities;
}

export interface PlaybackTransportCapabilities {
  playPause: boolean;
  play: boolean;
  pause: boolean;
  next: boolean;
  previous: boolean;
  seek: boolean;
  reason: string | null;
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
  metadataSource?: string | null;
  positionTrusted?: boolean | null;
  positionConfidence?: "trusted" | "estimated" | "none" | string | null;
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
  sourceScope: "local_playback" | "bluetooth_input" | "airplay_input" | "upnp_input";
  providerMode: "online";
  recognitionMode: "metadata" | "fingerprint" | null;
  recognitionProvider: "lrclib" | "lyricsovh" | "custom" | "acrcloud" | null;
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
  preferences: UiPreferences;
}

export interface RoomExperienceState {
  mode: RoomMode;
  phase: RoomSessionPhase;
  presetId: string;
  sceneVideoId: string;
  sceneVideoByMode?: Partial<Record<Exclude<RoomMode, "hifi">, string>>;
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

export type SceneDayPart = "morning" | "afternoon" | "evening" | "night";
export type SceneWeatherCondition = "clear" | "cloudy" | "foggy" | "rainy" | "snowy" | "stormy";

export interface SceneWeatherSummary {
  condition: SceneWeatherCondition;
  label: string;
  weatherCode: number | null;
  precipitation: number;
  temperatureCelsius: number | null;
  source: "ip_weather";
}

export interface SceneContextSummary {
  timeZone: string;
  dayPart: SceneDayPart;
  localHour: number;
  locationLabel: string | null;
  countryCode: string | null;
  weather: SceneWeatherSummary | null;
  source: "ip" | "timezone" | "fallback";
  updatedAt: string;
}

export type RoomExperienceActionType =
  | "set_mode"
  | "start_session"
  | "stop_session"
  | "update_timer"
  | "apply_preset"
  | "set_scene"
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
  | "explore.open"
  | "explore.close"
  | "explore.proxy_set"
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
  explore: {
    activeProvider: WebModeProviderId | null;
    activeProviderLabel: string | null;
    proxyEnabled: boolean;
    lastError: string | null;
  };
  runtime: RuntimeState;
  preferences: UiPreferences;
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

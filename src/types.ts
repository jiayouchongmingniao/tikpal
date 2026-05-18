export type AppMode = "ambient" | "player" | "quickSettings" | "quickMenu";
export type FontTheme = "sans" | "serif" | "mono";

export type PlaybackState = "playing" | "paused" | "stopped";

export type SourceState =
  | "mpd"
  | "airplay"
  | "spotify"
  | "bluetooth"
  | "roonbridge"
  | "upnp"
  | "radio";

export type SourceAvailability = "available" | "waiting" | "unavailable";
export type SourceControllability = "switchable" | "handoff" | "status-only";
export type SourceSwitchTarget = "mpd" | "radio" | "bluetooth" | "airplay";
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

export interface DspState {
  enabled: boolean;
  preset: string;
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
  currentTrackIndex: number;
  queueLength: number;
  favorite: boolean;
  queuePreview: QueueEntrySummary[];
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
  rendererType: "webgl" | "fallback" | "unknown";
  requestedRenderer: "webgl";
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
  sourceScope: "local_playback" | "bluetooth_input";
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

export type PlaybackActionType = "play_pause" | "play" | "pause" | "next" | "previous" | "seek" | "favorite_toggle" | "volume_set";
export type SystemActionType = "library_scan" | "reboot" | "shutdown" | "brightness_set";

export interface PlaybackActionRequest {
  type: PlaybackActionType;
  value?: number;
}

export interface SystemActionRequest {
  type: SystemActionType;
  value?: number;
}

export interface SourceSwitchRequest {
  target: SourceSwitchTarget;
  radioStationId?: string;
}

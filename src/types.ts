export type AppMode = "ambient" | "player" | "quickSettings" | "quickMenu";

export type PlaybackState = "playing" | "paused" | "stopped";

export type SourceState =
  | "mpd"
  | "airplay"
  | "spotify"
  | "bluetooth"
  | "roonbridge"
  | "upnp"
  | "radio";

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
}

export interface RuntimeState {
  rendererType: "webgl" | "fallback" | "unknown";
  requestedRenderer: "webgl";
  kioskWindow: "2560x720";
  appVersion: string;
  apiMode: "mock";
  updatedAt: string;
}

export interface TikpalState {
  playback: PlaybackSummary;
  system: SystemState;
  runtime: RuntimeState;
}

export type PlaybackActionType = "play_pause" | "play" | "pause" | "next" | "previous" | "seek" | "favorite_toggle" | "volume_set";

export interface PlaybackActionRequest {
  type: PlaybackActionType;
  value?: number;
}

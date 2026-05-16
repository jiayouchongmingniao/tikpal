import type { AudioState, PlaybackSummary, RadioStationSummary, SourceSummary, SystemState, TikpalState } from "./types";

export const playback: PlaybackSummary = {
  state: "playing",
  source: "mpd",
  albumArtUrl: null,
  title: "Get Lucky (feat. Pharrell Williams)",
  artist: "Daft Punk",
  album: "Random Access Memories",
  elapsedSeconds: 84,
  durationSeconds: 369,
  currentTrackIndex: 1,
  queueLength: 13,
  favorite: false
};

export const systemState: SystemState = {
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

function buildSourceSummary(summary: SourceSummary): SourceSummary {
  return summary;
}

function buildRadioStation(summary: RadioStationSummary): RadioStationSummary {
  return summary;
}

export const audioState: AudioState = {
  currentSource: buildSourceSummary({
    id: "mpd",
    label: "Library",
    kind: "mpd",
    availability: "available",
    active: true,
    controllability: "switchable",
    secondaryStatus: "Local queue ready"
  }),
  sources: [
    buildSourceSummary({
      id: "mpd",
      label: "Library",
      kind: "mpd",
      availability: "available",
      active: true,
      controllability: "switchable",
      secondaryStatus: "Local queue ready"
    }),
    buildSourceSummary({
      id: "spotify",
      label: "Spotify",
      kind: "spotify",
      availability: "waiting",
      active: false,
      controllability: "handoff",
      secondaryStatus: "Renderer ready"
    }),
    buildSourceSummary({
      id: "radio",
      label: "Radio",
      kind: "radio",
      availability: "available",
      active: false,
      controllability: "switchable",
      secondaryStatus: "Resume last station"
    })
  ],
  radios: [
    buildRadioStation({
      id: "radio-1",
      label: "1.FM - Blues Radio",
      uri: "http://strm112.1.fm/blues_mobile_mp3",
      secondaryStatus: "Blues · 192 kbps MP3",
      active: false
    }),
    buildRadioStation({
      id: "radio-2",
      label: "A.M. Ambient",
      uri: "http://radio.stereoscenic.com/ama-h",
      secondaryStatus: "Ambient · 256 kbps MP3",
      active: false
    }),
    buildRadioStation({
      id: "radio-3",
      label: "6forty Radio",
      uri: "http://radio.6forty.com:8000/6forty",
      secondaryStatus: "Alternative · 192 kbps MP3",
      active: false
    })
  ]
};

export const fallbackTikpalState: TikpalState = {
  playback,
  system: systemState,
  runtime: {
    rendererType: "unknown",
    requestedRenderer: "webgl",
    kioskWindow: "2560x720",
    appVersion: "0.1.0",
    apiMode: "mock",
    updatedAt: new Date().toISOString()
  },
  audio: audioState
};

export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "--:--";
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

export function formatSampleRate(rate: number | null): string {
  if (!rate) return "--";
  if (rate >= 1000) return `${Math.round(rate / 1000)}kHz`;
  return `${rate}Hz`;
}

import type { AudioState, LyricsState, PlaybackSummary, RadioStationSummary, SourceSummary, SystemState, TikpalState } from "./types";

export const playback: PlaybackSummary = {
  state: "playing",
  source: "mpd",
  albumArtUrl: null,
  title: "Get Lucky (feat. Pharrell Williams)",
  artist: "Daft Punk",
  album: "Random Access Memories",
  elapsedSeconds: 84,
  durationSeconds: 369,
  timingDiagnostics: null,
  currentTrackIndex: 1,
  queueLength: 13,
  favorite: false,
  settings: {
    playMode: "sequence"
  },
  queuePreview: [
    {
      id: "mock-queue-1",
      position: 1,
      title: "Get Lucky (feat. Pharrell Williams)",
      artist: "Daft Punk",
      album: "Random Access Memories",
      durationSeconds: 369,
      active: true
    },
    {
      id: "mock-queue-2",
      position: 2,
      title: "Instant Crush",
      artist: "Daft Punk",
      album: "Random Access Memories",
      durationSeconds: 337,
      active: false
    },
    {
      id: "mock-queue-3",
      position: 3,
      title: "Lose Yourself to Dance",
      artist: "Daft Punk",
      album: "Random Access Memories",
      durationSeconds: 353,
      active: false
    },
    {
      id: "mock-queue-4",
      position: 4,
      title: "Get Lucky (feat. Pharrell Williams)",
      artist: "Daft Punk",
      album: "Random Access Memories",
      durationSeconds: 369,
      active: false
    },
    {
      id: "mock-queue-5",
      position: 5,
      title: "Instant Crush",
      artist: "Daft Punk",
      album: "Random Access Memories",
      durationSeconds: 337,
      active: false
    }
  ]
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
    preset: "Flat",
    presetId: "flat",
    presetLabel: "Flat",
    controllable: true,
    controlTransport: "mock",
    availablePresets: [
      { id: "flat", label: "Flat", intent: "Reference response", hifiVisualPresetId: "spectrum-bars" },
      { id: "warm", label: "Warm", intent: "Gentle low-mid lift", hifiVisualPresetId: "waveform" },
      { id: "vocal", label: "Vocal", intent: "Clearer midrange presence", hifiVisualPresetId: "dual-vu" }
    ]
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
    armed: false,
    connectionState: "idle",
    connectedLabel: null,
    advertisedLabel: null,
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
      armed: false,
      connectionState: "idle",
      connectedLabel: null,
      advertisedLabel: null,
      secondaryStatus: "Local queue ready"
    }),
    buildSourceSummary({
      id: "radio",
      label: "Radio",
      kind: "radio",
      availability: "available",
      active: false,
      controllability: "switchable",
      armed: false,
      connectionState: "idle",
      connectedLabel: null,
      advertisedLabel: null,
      secondaryStatus: "Browse 240 stations"
    }),
    buildSourceSummary({
      id: "audio",
      label: "Audio",
      kind: "audio",
      availability: "available",
      active: false,
      controllability: "switchable",
      armed: false,
      connectionState: "idle",
      connectedLabel: "USB Audio",
      advertisedLabel: null,
      secondaryStatus: "USB Audio / PCM 24bit 96 kHz"
    }),
    buildSourceSummary({
      id: "spotify",
      label: "Spotify Connect",
      kind: "spotify",
      availability: "waiting",
      active: false,
      controllability: "handoff",
      armed: false,
      connectionState: "blocked",
      connectedLabel: null,
      advertisedLabel: "Tikpal Speaker",
      secondaryStatus: "Closed until you open Spotify Connect as Tikpal Speaker"
    }),
    buildSourceSummary({
      id: "bluetooth",
      label: "Bluetooth",
      kind: "bluetooth",
      availability: "waiting",
      active: false,
      controllability: "switchable",
      armed: false,
      connectionState: "blocked",
      connectedLabel: null,
      advertisedLabel: "Tikpal Speaker",
      secondaryStatus: "Closed until you open pairing as Tikpal Speaker"
    }),
    buildSourceSummary({
      id: "airplay",
      label: "AirPlay",
      kind: "airplay",
      availability: "waiting",
      active: false,
      controllability: "switchable",
      armed: false,
      connectionState: "blocked",
      connectedLabel: null,
      advertisedLabel: "Tikpal Speaker",
      secondaryStatus: "Closed until you open AirPlay as Tikpal Speaker"
    }),
    buildSourceSummary({
      id: "upnp",
      label: "DLNA",
      kind: "upnp",
      availability: "waiting",
      active: false,
      controllability: "switchable",
      armed: false,
      connectionState: "blocked",
      connectedLabel: null,
      advertisedLabel: "Tikpal Speaker",
      secondaryStatus: "Closed until you open DLNA as Tikpal Speaker"
    })
  ]
};

export const radioStations: RadioStationSummary[] = [
    buildRadioStation({
      id: "radio-1",
      label: "1.FM - Blues Radio",
      uri: "http://strm112.1.fm/blues_mobile_mp3",
      genre: "Blues",
      bitrateKbps: 192,
      codec: "MP3",
      secondaryStatus: "Blues · 192 kbps MP3",
      active: false
    }),
    buildRadioStation({
      id: "radio-2",
      label: "A.M. Ambient",
      uri: "http://radio.stereoscenic.com/ama-h",
      genre: "Ambient",
      bitrateKbps: 256,
      codec: "MP3",
      secondaryStatus: "Ambient · 256 kbps MP3",
      active: false
    }),
    buildRadioStation({
      id: "radio-3",
      label: "6forty Radio",
      uri: "http://radio.6forty.com:8000/6forty",
      genre: "Alternative",
      bitrateKbps: 192,
      codec: "MP3",
      secondaryStatus: "Alternative · 192 kbps MP3",
      active: false
    })
];

export const lyricsState: LyricsState = {
  status: "ready",
  sourceScope: "local_playback",
  providerMode: "online",
  recognitionMode: "metadata",
  recognitionProvider: "lrclib",
  recognitionConfidence: null,
  trackKey: "mock:get-lucky:daft-punk",
  title: "Get Lucky (feat. Pharrell Williams)",
  artist: "Daft Punk",
  synced: true,
  timingStrategy: "provider_synced",
  activeLineIndex: null,
  lines: [
    { text: "Like the legend of the phoenix", startMs: 12000, endMs: 18000 },
    { text: "All ends with beginnings", startMs: 18000, endMs: 23500 },
    { text: "What keeps the planet spinning", startMs: 23500, endMs: 30000 },
    { text: "The force from the beginning", startMs: 30000, endMs: 36000 }
  ],
  message: null,
  updatedAt: new Date().toISOString()
};

export const fallbackTikpalState: TikpalState = {
  playback,
  system: systemState,
  runtime: {
    rendererType: "media",
    requestedRenderer: "media",
    kioskWindow: "2560x720",
    appVersion: "0.1.0",
    apiMode: "mock",
    updatedAt: new Date().toISOString()
  },
  audio: audioState,
  lyrics: lyricsState
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

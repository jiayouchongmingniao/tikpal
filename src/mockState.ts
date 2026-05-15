import type { PlaybackSummary, SystemState } from "./types";

export const playback: PlaybackSummary = {
  state: "playing",
  source: "mpd",
  title: "Get Lucky (feat. Pharrell Williams)",
  artist: "Daft Punk",
  album: "Random Access Memories",
  elapsedSeconds: 84,
  durationSeconds: 369,
  favorite: false
};

export const systemState: SystemState = {
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

export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

export function formatSampleRate(rate: number | null): string {
  if (!rate) return "--";
  if (rate >= 1000) return `${Math.round(rate / 1000)}kHz`;
  return `${rate}Hz`;
}

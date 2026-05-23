import { buildGeneratedCoverArtUrl } from "./coverArt";
import type { AudioState, FontTheme, PlaybackSummary, SourceState, SourceSummary } from "./types";

const SOURCE_LABELS: Record<SourceState, string> = {
  audio: "Audio",
  mpd: "Library",
  airplay: "AirPlay",
  spotify: "Spotify Connect",
  bluetooth: "Bluetooth",
  roonbridge: "Roon Bridge",
  upnp: "UPnP",
  radio: "Radio"
};

export interface PlaybackDisplayTruth {
  title: string;
  artist: string;
  album: string;
  sourceLabel: string;
  albumArtUrl: string;
  hasPlaybackArtwork: boolean;
  elapsedSeconds: number | null;
  durationSeconds: number | null;
  progress: number;
  queuePositionLabel: string;
}

export function getPlaybackSourceSummary(playback: PlaybackSummary, audio: AudioState): SourceSummary | undefined {
  return audio.sources.find((source) => source.id === playback.source)
    ?? (audio.currentSource.id === playback.source ? audio.currentSource : undefined);
}

export function getPlaybackDisplayTruth(playback: PlaybackSummary, audio: AudioState, fontTheme: FontTheme): PlaybackDisplayTruth {
  const title = playback.title ?? "Not Playing";
  const artist = playback.artist ?? "Unknown Artist";
  const album = playback.album ?? "No Album";
  const sourceLabel = getPlaybackSourceSummary(playback, audio)?.label ?? SOURCE_LABELS[playback.source] ?? "Unknown Source";
  const hasPlaybackArtwork = Boolean(playback.albumArtUrl);
  const elapsedSeconds = Number.isFinite(playback.elapsedSeconds) ? playback.elapsedSeconds : null;
  const durationSeconds = Number.isFinite(playback.durationSeconds) && (playback.durationSeconds ?? 0) > 0
    ? playback.durationSeconds
    : null;
  const progress = elapsedSeconds !== null && durationSeconds !== null
    ? Math.max(0, Math.min(1, elapsedSeconds / durationSeconds))
    : 0;

  return {
    title,
    artist,
    album,
    sourceLabel,
    albumArtUrl: playback.albumArtUrl ?? buildGeneratedCoverArtUrl(title, artist, album, fontTheme),
    hasPlaybackArtwork,
    elapsedSeconds,
    durationSeconds,
    progress,
    queuePositionLabel: playback.queueLength > 0 ? `${playback.currentTrackIndex} of ${playback.queueLength}` : "No active queue"
  };
}

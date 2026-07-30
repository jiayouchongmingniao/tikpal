import { buildGeneratedCoverArtUrl } from "./coverArt";
import { buildBluetoothGeneratedCoverArtUrl } from "./hifiLyricsVisual";
import { playbackFallbackCopy } from "./uiCopy";
import type { AudioState, FontTheme, PlaybackSummary, SourceState, SourceSummary } from "./types";

const SOURCE_LABELS: Record<SourceState, string> = {
  audio: "Audio",
  scene: "Scene Sound",
  mpd: "Library",
  airplay: "AirPlay",
  spotify: "Spotify Connect",
  bluetooth: "Bluetooth",
  roonbridge: "Roon Bridge",
  upnp: "DLNA",
  radio: "Radio"
};

const GENERATED_ARTWORK_PATH = "/api/v1/media/artwork";

export interface PlaybackDisplayTruth {
  title: string;
  artist: string;
  album: string;
  sourceLabel: string;
  albumArtUrl: string;
  fallbackAlbumArtUrl: string;
  hasPlaybackArtwork: boolean;
  isGeneratedBluetoothCover: boolean;
  elapsedSeconds: number | null;
  durationSeconds: number | null;
  progress: number;
  queuePositionLabel: string;
}

export function getPlaybackSourceSummary(playback: PlaybackSummary, audio: AudioState): SourceSummary | undefined {
  return audio.sources.find((source) => source.id === playback.source)
    ?? (audio.currentSource.id === playback.source ? audio.currentSource : undefined);
}

function withGeneratedArtworkFontTheme(albumArtUrl: string | null | undefined, fontTheme: FontTheme) {
  if (!albumArtUrl) return null;

  try {
    const baseUrl = typeof window === "undefined" ? "http://localhost/" : window.location.href;
    const parsed = new URL(albumArtUrl, baseUrl);
    if (parsed.pathname !== GENERATED_ARTWORK_PATH) return albumArtUrl;
    parsed.searchParams.set("fontTheme", fontTheme);
    return albumArtUrl.startsWith("/") ? `${parsed.pathname}${parsed.search}${parsed.hash}` : parsed.toString();
  } catch {
    return albumArtUrl;
  }
}

export function getPlaybackDisplayTruth(playback: PlaybackSummary, audio: AudioState, fontTheme: FontTheme): PlaybackDisplayTruth {
  const title = playback.title ?? playbackFallbackCopy.title;
  const artist = playback.artist ?? playbackFallbackCopy.artist;
  const album = playback.album ?? playbackFallbackCopy.album;
  const sourceLabel = getPlaybackSourceSummary(playback, audio)?.label ?? SOURCE_LABELS[playback.source] ?? playbackFallbackCopy.source;
  const hasPlaybackArtwork = Boolean(playback.albumArtUrl);
  const isGeneratedBluetoothCover = playback.source === "bluetooth" && !hasPlaybackArtwork;
  const fallbackAlbumArtUrl = isGeneratedBluetoothCover
    ? buildBluetoothGeneratedCoverArtUrl(title, artist, album)
    : buildGeneratedCoverArtUrl(title, artist, album, fontTheme);
  const albumArtUrl = withGeneratedArtworkFontTheme(playback.albumArtUrl, fontTheme);
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
    albumArtUrl: albumArtUrl ?? fallbackAlbumArtUrl,
    fallbackAlbumArtUrl,
    hasPlaybackArtwork,
    isGeneratedBluetoothCover,
    elapsedSeconds,
    durationSeconds,
    progress,
    queuePositionLabel: playback.queueLength > 0 ? `${playback.currentTrackIndex} of ${playback.queueLength}` : "No active queue"
  };
}

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
  lyrion: "Lyrion",
  tikpal_multiroom: "Tikpal Multi-room",
  music_assistant: "Music Assistant",
  upnp: "DLNA",
  radio: "Radio"
};

const GENERATED_ARTWORK_PATH = "/api/v1/media/artwork";

export interface PlaybackDisplayTruth {
  title: string | null;
  artist: string | null;
  album: string | null;
  sourceLabel: string;
  albumArtUrl: string;
  fallbackAlbumArtUrl: string;
  hasPlaybackArtwork: boolean;
  isGeneratedBluetoothCover: boolean;
  elapsedSeconds: number | null;
  durationSeconds: number | null;
  progress: number;
  queuePositionLabel: string | null;
  isLive: boolean;
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

const PLACEHOLDER_METADATA = new Set([
  "unknown",
  "unknown artist",
  "unknown album",
  "untitled",
  "no title",
  "no album",
  "n/a",
  "none",
  "-"
]);

function cleanMetadata(value: string | null | undefined) {
  const trimmed = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!trimmed || PLACEHOLDER_METADATA.has(trimmed.toLowerCase())) return null;
  if (/[/\\]/.test(trimmed) || /^https?:/i.test(trimmed)) return null;
  if (/\.(?:mp3|m4a|flac|wav|aac|ogg|opus|aiff|alac)$/i.test(trimmed)) return null;
  return trimmed;
}

function parseFilename(value: string | null | undefined) {
  if (!value || /^https?:/i.test(value)) return { title: null, artist: null, album: null };
  const filename = value.split(/[\\/]/).pop()?.replace(/\?.*$/, "").replace(/#.*$/, "") ?? "";
  const stem = filename.replace(/\.(?:mp3|m4a|flac|wav|aac|ogg|opus|aiff|alac)$/i, "").replace(/[_]+/g, " ").trim();
  if (!stem || stem === filename || PLACEHOLDER_METADATA.has(stem.toLowerCase())) return { title: null, artist: null, album: null };
  const withoutTrackNumber = stem.replace(/^\d{1,3}\s*[-._]\s*/, "");
  const parts = withoutTrackNumber.split(/\s+-\s+/).map(cleanMetadata).filter((part): part is string => Boolean(part));
  if (parts.length >= 2) return { artist: parts[0], title: parts[parts.length - 1], album: parts.length > 2 ? parts[1] : null };
  return { title: cleanMetadata(withoutTrackNumber), artist: null, album: null };
}

function resolveMetadata(playback: PlaybackSummary, source: SourceSummary | undefined) {
  const activeQueueEntry = playback.queuePreview.find((entry) => entry.active) ?? null;
  const filenameMetadata = parseFilename(activeQueueEntry?.id);
  const queueMetadata = activeQueueEntry ? {
    title: cleanMetadata(activeQueueEntry.title),
    artist: cleanMetadata(activeQueueEntry.artist),
    album: cleanMetadata(activeQueueEntry.album)
  } : null;
  const sourceTitle = source?.connectedLabel ?? source?.advertisedLabel ?? null;

  return {
    title: cleanMetadata(playback.title) ?? queueMetadata?.title ?? filenameMetadata.title ?? cleanMetadata(sourceTitle),
    artist: cleanMetadata(playback.artist) ?? queueMetadata?.artist ?? filenameMetadata.artist,
    album: cleanMetadata(playback.album) ?? queueMetadata?.album ?? filenameMetadata.album
  };
}

export function getPlaybackDisplayTruth(playback: PlaybackSummary, audio: AudioState, fontTheme: FontTheme): PlaybackDisplayTruth {
  const source = getPlaybackSourceSummary(playback, audio);
  const { title, artist, album } = resolveMetadata(playback, source);
  const sourceLabel = source?.label ?? SOURCE_LABELS[playback.source] ?? playbackFallbackCopy.source;
  const hasPlaybackArtwork = Boolean(playback.albumArtUrl);
  const isGeneratedBluetoothCover = playback.source === "bluetooth" && !hasPlaybackArtwork;
  const fallbackAlbumArtUrl = isGeneratedBluetoothCover
    ? buildBluetoothGeneratedCoverArtUrl(title ?? "Tikpal", artist ?? "", album ?? "")
    : buildGeneratedCoverArtUrl(title ?? "Tikpal", artist ?? "", album ?? "", fontTheme);
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
    queuePositionLabel: playback.queueLength > 0 ? `${playback.currentTrackIndex} of ${playback.queueLength}` : null,
    isLive: playback.state === "playing" && durationSeconds === null
  };
}

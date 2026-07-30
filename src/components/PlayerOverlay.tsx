import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import {
  Bluetooth,
  Cast,
  Check,
  Clock,
  Copy,
  Globe2,
  HardDrive,
  Heart,
  LibraryBig,
  LoaderCircle,
  Music2,
  Network,
  PanelRightClose,
  Pause,
  Play,
  Radio as RadioIcon,
  Server,
  SkipBack,
  SkipForward,
  Trash2,
  Usb
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { copyLibraryTrackToLocal, deleteLibraryTrackFromLocal, fetchAudioLibrary, fetchRadioCatalog, sendFavoriteTrack } from "../api/tikpalClient";
import { getPlaybackDisplayTruth, getPlaybackSourceSummary } from "../playbackTruth";
import { getSourceDisplayStatusLabel } from "../sourceStatus";
import { dataSyncLabel, friendlyUiError } from "../uiCopy";
import type { TikpalDataStatus } from "../hooks/useTikpalState";
import { formatDuration } from "../mockState";
import { useOverlayReturnGesture } from "../hooks/useOverlayReturnGesture";
import type {
  AudioLibraryDiskSummary,
  AudioLibraryTrackSummary,
  AudioState,
  FontTheme,
  PlaybackActionType,
  PlaybackSummary,
  RadioStationSummary,
  SourceSwitchTarget,
  SystemState,
  TikpalState
} from "../types";

interface PlayerOverlayProps {
  active: boolean;
  playback: PlaybackSummary;
  audio: AudioState;
  system: SystemState;
  status: TikpalDataStatus;
  fontTheme: FontTheme;
  onPlaybackAction: (type: PlaybackActionType, value?: number) => Promise<TikpalState>;
  onSourceSwitch: (target: SourceSwitchTarget, radioStationId?: string, localTrackPath?: string) => Promise<TikpalState>;
  onOpenWebMode: () => Promise<void>;
  onReturnAmbient: () => void;
}

type PrimaryPanelId = "library" | "radio" | "spotify" | "airplay" | "bluetooth" | "upnp";
type ExternalPanelId = Exclude<PrimaryPanelId, "library" | "radio">;
type LibraryFilterId = "local" | "nas" | "usb" | "favorites" | "recently_added";

interface VolumeRequestState {
  inFlight: boolean;
  queued: number | null;
  lastSent: number | null;
}

const primaryPanels: Array<{ id: PrimaryPanelId; label: string; Icon: LucideIcon }> = [
  { id: "library", label: "Library", Icon: LibraryBig },
  { id: "radio", label: "Radio", Icon: RadioIcon },
  { id: "spotify", label: "Spotify", Icon: Music2 },
  { id: "airplay", label: "AirPlay", Icon: Cast },
  { id: "bluetooth", label: "Bluetooth", Icon: Bluetooth },
  { id: "upnp", label: "DLNA", Icon: Network }
];
const handoffSourceIds = new Set(["spotify", "airplay", "bluetooth", "upnp"]);
const radioCategoryTabs = [
  { id: "focus", label: "Focus" },
  { id: "calm", label: "Calm" },
  { id: "sleep", label: "Sleep" },
  { id: "jazz", label: "Jazz" },
  { id: "classical", label: "Classical" },
  { id: "news", label: "News" },
  { id: "hifi", label: "Hi-Fi" },
  { id: "blues", label: "Blues" },
  { id: "rock", label: "Rock" },
  { id: "world", label: "World" },
  { id: "electronic", label: "Electronic" },
  { id: "podcast", label: "Podcast" },
  { id: "random", label: "Random" }
];
const CONTROL_COMMIT_DELAY_MS = 140;
const LIBRARY_FAST_SCROLL_MIN_THUMB_PERCENT = 18;
const LIBRARY_FAST_SCROLL_MAX_THUMB_PERCENT = 72;

const storageTabs: Array<{ id: LibraryFilterId; label: string; Icon: LucideIcon }> = [
  { id: "local", label: "Local", Icon: HardDrive },
  { id: "nas", label: "NAS", Icon: Server },
  { id: "usb", label: "USB", Icon: Usb },
  { id: "favorites", label: "Favorites", Icon: Heart },
  { id: "recently_added", label: "Recently Added", Icon: Clock }
];

function sourceStatusLabel(source: AudioState["currentSource"] | undefined, pending: boolean) {
  return getSourceDisplayStatusLabel(source, { pending });
}

function isHandoffSourceId(sourceId: string | null | undefined): sourceId is ExternalPanelId {
  return Boolean(sourceId && handoffSourceIds.has(sourceId));
}

function getHandoffSourceLabel(panelId: ExternalPanelId, source: AudioState["currentSource"] | undefined) {
  if (source?.label) return source.label;
  return primaryPanels.find((entry) => entry.id === panelId)?.label ?? "Source";
}

function getPanelForSourceId(sourceId: string): PrimaryPanelId {
  if (sourceId === "radio" || sourceId === "spotify" || sourceId === "airplay" || sourceId === "bluetooth" || sourceId === "upnp") {
    return sourceId;
  }
  return "library";
}

function clampVolumePercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function clampUnit(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

interface LibraryFastScrollMetrics {
  available: boolean;
  progress: number;
  thumbPercent: number;
  thumbTopPercent: number;
  currentIndex: number;
}

const defaultLibraryFastScrollMetrics: LibraryFastScrollMetrics = {
  available: false,
  progress: 0,
  thumbPercent: 100,
  thumbTopPercent: 0,
  currentIndex: 0
};

function formatFileSize(bytes: number | null | undefined) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(value / 1024))} KB`;
}

function formatSampleRate(sampleRateHz: number | null | undefined) {
  const value = Number(sampleRateHz);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value >= 1000 ? `${Number((value / 1000).toFixed(1))} kHz` : `${value} Hz`;
}

function formatLibraryAudioInfo(track: AudioLibraryTrackSummary) {
  const parts = [
    track.codec?.toUpperCase() ?? track.container?.toUpperCase() ?? null,
    formatSampleRate(track.sampleRateHz),
    track.bitDepth ? `${track.bitDepth}-bit` : null,
    track.channels ? `${track.channels}ch` : null,
    track.bitrateKbps ? `${track.bitrateKbps} kbps` : null,
    formatFileSize(track.fileSizeBytes)
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "Audio file";
}

function formatDiskSize(bytes: number | null | undefined) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return "Unavailable";
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (value >= 1024 * 1024) return `${Math.round(value / 1024 / 1024)} MB`;
  return `${Math.max(1, Math.round(value / 1024))} KB`;
}

function normalizeDiskUsedPercent(storage: AudioLibraryDiskSummary | null) {
  const percent = Number(storage?.usedPercent);
  return Number.isFinite(percent) ? Math.max(0, Math.min(100, Math.round(percent))) : null;
}

function libraryPlaybackHint(storage: AudioLibraryTrackSummary["storage"] | null | undefined) {
  if (storage === "nas") return "Playing from NAS.";
  if (storage === "usb") return "Playing from USB.";
  if (storage === "local") return "Playing from Local.";
  return "Library ready. Pick a track.";
}

export function PlayerOverlay({
  active,
  playback,
  audio,
  system,
  status,
  fontTheme,
  onPlaybackAction,
  onSourceSwitch,
  onOpenWebMode,
  onReturnAmbient
}: PlayerOverlayProps) {
  const overlayReturnGesture = useOverlayReturnGesture(onReturnAmbient);
  const [seekDraftSeconds, setSeekDraftSeconds] = useState<number | null>(null);
  const [seekPendingSeconds, setSeekPendingSeconds] = useState<number | null>(null);
  const [seekError, setSeekError] = useState<string | null>(null);
  const [selectedPrimaryPanel, setSelectedPrimaryPanel] = useState<PrimaryPanelId>("library");
  const [selectedLibraryStorage, setSelectedLibraryStorage] = useState<LibraryFilterId>("local");
  const [selectedLibraryTrackId, setSelectedLibraryTrackId] = useState<string | null>(null);
  const [manualPanelSelection, setManualPanelSelection] = useState(false);
  const [localLibraryTracks, setLocalLibraryTracks] = useState<AudioLibraryTrackSummary[]>([]);
  const [nasLibraryTracks, setNasLibraryTracks] = useState<AudioLibraryTrackSummary[]>([]);
  const [usbLibraryTracks, setUsbLibraryTracks] = useState<AudioLibraryTrackSummary[]>([]);
  const [localLibraryStorage, setLocalLibraryStorage] = useState<AudioLibraryDiskSummary | null>(null);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [copyingLibraryTrackId, setCopyingLibraryTrackId] = useState<string | null>(null);
  const [deletingLibraryTrackId, setDeletingLibraryTrackId] = useState<string | null>(null);
  const [confirmingDeleteLibraryTrackId, setConfirmingDeleteLibraryTrackId] = useState<string | null>(null);
  const [radioStations, setRadioStations] = useState<RadioStationSummary[]>([]);
  const [radioCategories, setRadioCategories] = useState<Array<{ id: string; label: string; count: number }>>([]);
  const [selectedRadioCategory, setSelectedRadioCategory] = useState("focus");
  const [radioLoading, setRadioLoading] = useState(false);
  const [radioError, setRadioError] = useState<string | null>(null);
  const [failedRadioLogoIds, setFailedRadioLogoIds] = useState<Set<string>>(() => new Set());
  const [pendingSource, setPendingSource] = useState<SourceSwitchTarget | null>(null);
  const [webModePending, setWebModePending] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [sourceHint, setSourceHint] = useState<string | null>(null);
  const [volumeDraftPercent, setVolumeDraftPercent] = useState<number | null>(null);
  const [volumeError, setVolumeError] = useState<string | null>(null);
  const volumeRequestStateRef = useRef<VolumeRequestState>({
    inFlight: false,
    queued: null,
    lastSent: system.volume.percent
  });
  const volumeCommitTimerRef = useRef<number | null>(null);
  const libraryTrackListRef = useRef<HTMLDivElement | null>(null);
  const libraryFastScrollTrackRef = useRef<HTMLSpanElement | null>(null);
  const libraryFastScrollPointerIdRef = useRef<number | null>(null);
  const libraryFastScrollDraggingRef = useRef(false);
  const [libraryFastScrollDragging, setLibraryFastScrollDragging] = useState(false);
  const [libraryFastScrollMetrics, setLibraryFastScrollMetrics] = useState<LibraryFastScrollMetrics>(defaultLibraryFastScrollMetrics);
  const playbackTruth = getPlaybackDisplayTruth(playback, audio, fontTheme);
  const [failedAlbumArtUrl, setFailedAlbumArtUrl] = useState<string | null>(null);
  const displayedAlbumArtUrl = playbackTruth.hasPlaybackArtwork && failedAlbumArtUrl === playbackTruth.albumArtUrl
    ? playbackTruth.fallbackAlbumArtUrl
    : playbackTruth.albumArtUrl;
  const usingGeneratedCoverFallback = !playbackTruth.hasPlaybackArtwork || displayedAlbumArtUrl === playbackTruth.fallbackAlbumArtUrl;
  const elapsedSeconds = playbackTruth.elapsedSeconds ?? 0;
  const durationSeconds = playbackTruth.durationSeconds ?? 0;
  const isPlaying = playback.state === "playing";
  const transportCapabilities = playback.transportCapabilities;
  const transportUnavailableTitle = transportCapabilities?.reason ?? "Playback control unavailable";
  const previousDisabled = status.pending || transportCapabilities?.previous === false;
  const playPauseDisabled = status.pending || transportCapabilities?.playPause === false;
  const nextDisabled = status.pending || transportCapabilities?.next === false;
  const previousTitle = transportCapabilities?.previous === false ? transportUnavailableTitle : "Previous";
  const playPauseTitle = transportCapabilities?.playPause === false ? transportUnavailableTitle : isPlaying ? "Pause" : "Play";
  const nextTitle = transportCapabilities?.next === false ? transportUnavailableTitle : "Next";
  const currentSource = audio.currentSource;
  const selectedPanelConfig = primaryPanels.find((panel) => panel.id === selectedPrimaryPanel) ?? primaryPanels[0];
  const playbackSource = getPlaybackSourceSummary(playback, audio);
  const favoriteLibraryTracks = useMemo(() => (
    [...localLibraryTracks, ...usbLibraryTracks].filter((track) => track.favorite)
  ), [localLibraryTracks, usbLibraryTracks]);
  const visibleLibraryTracks = useMemo(() => {
    switch (selectedLibraryStorage) {
      case "nas":
        return nasLibraryTracks;
      case "local":
        return localLibraryTracks;
      case "usb":
        return usbLibraryTracks;
      case "recently_added":
        return localLibraryTracks.slice(0, 12);
      case "favorites":
        return favoriteLibraryTracks;
      default:
        return localLibraryTracks;
    }
  }, [favoriteLibraryTracks, localLibraryTracks, nasLibraryTracks, selectedLibraryStorage, usbLibraryTracks]);
  const selectedLibraryTrack = visibleLibraryTracks.find((track) => track.id === selectedLibraryTrackId) ?? null;
  const seekSupported = playback.source === "mpd" && durationSeconds > 0 && transportCapabilities?.seek !== false;
  const displayedElapsedSeconds = seekSupported
    ? seekDraftSeconds ?? seekPendingSeconds ?? elapsedSeconds
    : playbackTruth.elapsedSeconds;
  const displayedDurationSeconds = seekSupported
    ? durationSeconds
    : playbackTruth.durationSeconds;
  const progress = displayedElapsedSeconds !== null && displayedDurationSeconds && displayedDurationSeconds > 0
    ? Math.min(1, displayedElapsedSeconds / displayedDurationSeconds)
    : 0;
  const displayedVolumePercent = clampVolumePercent(volumeDraftPercent ?? system.volume.percent);

  const localDiskUsedPercent = normalizeDiskUsedPercent(localLibraryStorage);
  const localDiskFreeLabel = formatDiskSize(localLibraryStorage?.freeBytes);
  const sourceLine = [
    playbackTruth.sourceLabel,
    sourceStatusLabel(playbackSource, pendingSource === playback.source),
    dataSyncLabel(status)
  ];

  function readLibraryFastScrollMetrics(): LibraryFastScrollMetrics {
    const list = libraryTrackListRef.current;
    if (!list || selectedPrimaryPanel !== "library") {
      return defaultLibraryFastScrollMetrics;
    }

    const maxScrollTop = Math.max(0, list.scrollHeight - list.clientHeight);
    const available = visibleLibraryTracks.length > 0 && maxScrollTop > 8;
    if (!available) {
      return defaultLibraryFastScrollMetrics;
    }

    const progress = clampUnit(list.scrollTop / maxScrollTop);
    const visibleRatio = clampUnit(list.clientHeight / Math.max(list.clientHeight, list.scrollHeight));
    const thumbPercent = Math.max(
      LIBRARY_FAST_SCROLL_MIN_THUMB_PERCENT,
      Math.min(LIBRARY_FAST_SCROLL_MAX_THUMB_PERCENT, visibleRatio * 100)
    );
    const thumbTopPercent = progress * (100 - thumbPercent);
    const currentIndex = Math.min(
      visibleLibraryTracks.length,
      Math.max(1, Math.round(progress * (visibleLibraryTracks.length - 1)) + 1)
    );

    return {
      available,
      progress,
      thumbPercent,
      thumbTopPercent,
      currentIndex
    };
  }

  function updateLibraryFastScrollMetrics() {
    const nextMetrics = readLibraryFastScrollMetrics();
    setLibraryFastScrollMetrics((current) => (
      current.available === nextMetrics.available
        && current.currentIndex === nextMetrics.currentIndex
        && Math.abs(current.progress - nextMetrics.progress) < 0.001
        && Math.abs(current.thumbPercent - nextMetrics.thumbPercent) < 0.001
        && Math.abs(current.thumbTopPercent - nextMetrics.thumbTopPercent) < 0.001
        ? current
        : nextMetrics
    ));
    return nextMetrics;
  }

  function resetLibraryFastScrollDrag() {
    libraryFastScrollPointerIdRef.current = null;
    libraryFastScrollDraggingRef.current = false;
    setLibraryFastScrollDragging(false);
  }

  function scrollLibraryFastScrollToClientY(clientY: number) {
    const list = libraryTrackListRef.current;
    const track = libraryFastScrollTrackRef.current;
    if (!list || !track) return;
    const maxScrollTop = Math.max(0, list.scrollHeight - list.clientHeight);
    if (maxScrollTop <= 0) return;
    const rect = track.getBoundingClientRect();
    const progress = clampUnit((clientY - rect.top) / Math.max(1, rect.height));
    list.scrollTop = progress * maxScrollTop;
    updateLibraryFastScrollMetrics();
  }

  function handleLibraryTrackListScroll() {
    updateLibraryFastScrollMetrics();
  }

  function handleLibraryTrackListWheel() {
    updateLibraryFastScrollMetrics();
  }

  function handleLibraryFastScrollPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!libraryFastScrollMetrics.available) return;
    event.preventDefault();
    event.stopPropagation();
    libraryFastScrollPointerIdRef.current = event.pointerId;
    libraryFastScrollDraggingRef.current = true;
    setLibraryFastScrollDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    scrollLibraryFastScrollToClientY(event.clientY);
  }

  function handleLibraryFastScrollPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (libraryFastScrollPointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    scrollLibraryFastScrollToClientY(event.clientY);
  }

  function finishLibraryFastScrollDrag(event: PointerEvent<HTMLDivElement>) {
    if (libraryFastScrollPointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    libraryFastScrollPointerIdRef.current = null;
    libraryFastScrollDraggingRef.current = false;
    setLibraryFastScrollDragging(false);
    updateLibraryFastScrollMetrics();
  }

  useEffect(() => {
    if (!active) {
      if (volumeCommitTimerRef.current !== null) {
        window.clearTimeout(volumeCommitTimerRef.current);
        volumeCommitTimerRef.current = null;
      }
      volumeRequestStateRef.current.queued = null;
      setSeekDraftSeconds(null);
      setSeekPendingSeconds(null);
      setSeekError(null);
      setPendingSource(null);
      setSourceError(null);
      setSourceHint(null);
      setVolumeDraftPercent(null);
      setVolumeError(null);
      setManualPanelSelection(false);
      setConfirmingDeleteLibraryTrackId(null);
      resetLibraryFastScrollDrag();
    }
  }, [active]);

  useEffect(() => {
    if (!active || selectedPrimaryPanel !== "library") {
      resetLibraryFastScrollDrag();
      return;
    }
    const animationFrame = window.requestAnimationFrame(() => {
      updateLibraryFastScrollMetrics();
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [active, selectedLibraryStorage, selectedPrimaryPanel, visibleLibraryTracks.length]);

  useEffect(() => {
    const requestState = volumeRequestStateRef.current;
    requestState.lastSent = system.volume.percent;
    if (!requestState.inFlight && requestState.queued === null) {
      setVolumeDraftPercent(null);
    }
  }, [system.volume.percent]);

  const flushVolumeChange = useCallback(
    () => {
      const requestState = volumeRequestStateRef.current;
      if (requestState.inFlight) return;

      requestState.inFlight = true;

      const sendNext = async () => {
        const target = requestState.queued;
        requestState.queued = null;

        if (target === null || target === requestState.lastSent) {
          requestState.inFlight = false;
          if (requestState.queued === null && volumeCommitTimerRef.current === null) {
            setVolumeDraftPercent(null);
          }
          return;
        }

        try {
          const nextState = await onPlaybackAction("volume_set", target);
          requestState.lastSent = nextState.system.volume.percent;
          setVolumeError(null);
        } catch (error) {
          setVolumeError(error instanceof Error ? error.message : "Volume adjustment failed");
        }

        if (requestState.queued !== null && requestState.queued !== requestState.lastSent) {
          await sendNext();
          return;
        }

        requestState.inFlight = false;
        if (requestState.queued === null && volumeCommitTimerRef.current === null) {
          setVolumeDraftPercent(null);
        }
      };

      void sendNext();
    },
    [onPlaybackAction]
  );

  const scheduleVolumeChange = useCallback(
    (percent: number) => {
      const nextPercent = clampVolumePercent(percent);
      const requestState = volumeRequestStateRef.current;
      requestState.queued = nextPercent;
      setVolumeDraftPercent(nextPercent);
      setVolumeError(null);

      if (volumeCommitTimerRef.current !== null) {
        window.clearTimeout(volumeCommitTimerRef.current);
      }
      volumeCommitTimerRef.current = window.setTimeout(() => {
        volumeCommitTimerRef.current = null;
        flushVolumeChange();
      }, CONTROL_COMMIT_DELAY_MS);
    },
    [flushVolumeChange]
  );

  const commitVolumeChange = useCallback(() => {
    if (volumeCommitTimerRef.current !== null) {
      window.clearTimeout(volumeCommitTimerRef.current);
      volumeCommitTimerRef.current = null;
    }
    flushVolumeChange();
  }, [flushVolumeChange]);

  function handleVolumeSliderChange(value: string) {
    scheduleVolumeChange(Number(value));
  }

  useEffect(() => {
    if (!active || manualPanelSelection) return;

    if (currentSource.id === "radio" || currentSource.id === "spotify" || currentSource.id === "bluetooth" || currentSource.id === "airplay" || currentSource.id === "upnp") {
      setSelectedPrimaryPanel(currentSource.id);
      setSelectedLibraryTrackId(null);
      return;
    }

    if (currentSource.id === "mpd") {
      setSelectedPrimaryPanel("library");
    }
  }, [active, currentSource.id, manualPanelSelection]);

  const refreshLocalLibrary = useCallback((signal?: AbortSignal) => {
    const controller = new AbortController();
    setLibraryLoading(true);
    setLibraryError(null);

    const requestSignal = signal ?? controller.signal;
    void fetchAudioLibrary({ storage: "all", limit: 500 }, requestSignal)
      .then((library) => {
        setLocalLibraryTracks(library.tracks.filter((track) => track.storage === "local"));
        setNasLibraryTracks(library.tracks.filter((track) => track.storage === "nas"));
        setUsbLibraryTracks(library.tracks.filter((track) => track.storage === "usb"));
        setLocalLibraryStorage(library.localStorage ?? null);
      })
      .catch((error) => {
        if (requestSignal.aborted) return;
        setLibraryError(error instanceof Error ? error.message : "Local music manifest is not available");
      })
      .finally(() => {
        if (!requestSignal.aborted) {
          setLibraryLoading(false);
        }
      });

    return controller;
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    const controller = new AbortController();
    refreshLocalLibrary(controller.signal);
    return () => controller.abort();
  }, [active, playback.favorite, refreshLocalLibrary]);

  useEffect(() => {
    if (!active || selectedPrimaryPanel !== "radio") return undefined;

    const controller = new AbortController();
    setRadioLoading(true);
    setRadioError(null);

    void fetchRadioCatalog({
      category: selectedRadioCategory || undefined,
      limit: 250
    }, controller.signal)
      .then((catalog) => {
        setRadioStations(catalog.stations);
        setRadioCategories(catalog.categories);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setRadioError(error instanceof Error ? error.message : "Radio catalog is not available");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setRadioLoading(false);
        }
      });

    return () => controller.abort();
  }, [active, selectedPrimaryPanel, selectedRadioCategory]);

  useEffect(() => {
    setFailedRadioLogoIds(new Set());
  }, [selectedRadioCategory]);

  useEffect(() => {
    if (!active || selectedPrimaryPanel !== "library") return;
    const preferredTrack = visibleLibraryTracks.find((track) => track.active) ?? visibleLibraryTracks[0] ?? null;
    if (!preferredTrack) {
      if (selectedLibraryTrackId) setSelectedLibraryTrackId(null);
      return;
    }
    if (!visibleLibraryTracks.some((track) => track.id === selectedLibraryTrackId)) {
      setSelectedLibraryTrackId(preferredTrack.id);
    }
  }, [active, selectedLibraryTrackId, selectedPrimaryPanel, visibleLibraryTracks]);

  useEffect(() => {
    if (!seekSupported) {
      setSeekDraftSeconds(null);
      setSeekPendingSeconds(null);
      setSeekError(null);
    }
  }, [seekSupported]);

  async function commitSeek(nextSeconds: number | null) {
    if (!seekSupported || nextSeconds === null || status.pending) {
      setSeekDraftSeconds(null);
      return;
    }

    const clampedSeconds = Math.max(0, Math.min(durationSeconds, Math.round(nextSeconds)));
    setSeekDraftSeconds(null);
    setSeekPendingSeconds(clampedSeconds);
    setSeekError(null);

    try {
      await onPlaybackAction("seek", clampedSeconds);
    } catch (error) {
      setSeekError(error instanceof Error ? error.message : "Seek failed");
    } finally {
      setSeekPendingSeconds(null);
    }
  }

  function handleSeekDraft(value: string) {
    setSeekDraftSeconds(Number(value));
    setSeekError(null);
  }

  function libraryFilterCount(filterId: LibraryFilterId) {
    switch (filterId) {
      case "local":
        return localLibraryTracks.length;
      case "nas":
        return nasLibraryTracks.length;
      case "usb":
        return usbLibraryTracks.length;
      case "favorites":
        return favoriteLibraryTracks.length;
      case "recently_added":
        return Math.min(12, localLibraryTracks.length);
      default:
        return 0;
    }
  }

  function panelMeta(panelId: PrimaryPanelId) {
    if (panelId === "library") {
      switch (selectedLibraryStorage) {
        case "local":
          return `${libraryFilterCount("local")} local`;
        case "nas":
          return `${libraryFilterCount("nas")} NAS`;
        case "usb":
          return `${libraryFilterCount("usb")} USB`;
        case "favorites":
          return `${libraryFilterCount("favorites")} saved`;
        case "recently_added":
          return `${libraryFilterCount("recently_added")} new`;
        default:
          return "";
      }
    }
    const source = audio.sources.find((entry) => entry.id === panelId);
    return sourceStatusLabel(source, pendingSource === panelId);
  }

  async function switchSource(target: SourceSwitchTarget, radioStationId?: string, localTrackPath?: string, libraryStorage?: AudioLibraryTrackSummary["storage"]) {
    if (status.pending || pendingSource) return;
    const rollbackPanel = getPanelForSourceId(currentSource.id);
    setPendingSource(target);
    setSourceError(null);
    setSourceHint(null);

    try {
      const nextState = await onSourceSwitch(target, radioStationId, localTrackPath);
      const nextSource = nextState.audio.sources.find((source) => source.id === target);
      if (target === "mpd" && localTrackPath) {
        setSourceHint(libraryPlaybackHint(libraryStorage));
      } else if (target === "mpd") {
        setSourceHint("Library ready. Pick a track.");
      } else if (target === "radio") {
        setSourceHint(null);
      } else if (nextSource?.connectedLabel) {
        setSourceHint(`${nextSource.label}: ${nextSource.connectedLabel}.`);
      } else if (nextSource?.advertisedLabel) {
        setSourceHint(`${nextSource.label} ready as ${nextSource.advertisedLabel}.`);
      } else {
        setSourceHint(`${nextSource?.label ?? target} ready.`);
      }
    } catch (error) {
      if (isHandoffSourceId(target)) {
        setSelectedPrimaryPanel(rollbackPanel);
      }
      setSourceError(error instanceof Error ? error.message : "Source switch failed");
    } finally {
      setPendingSource(null);
    }
  }

  async function openWebMode() {
    if (pendingSource || webModePending) return;
    setWebModePending(true);
    setSourceError(null);
    try {
      await onOpenWebMode();
    } catch (error) {
      setSourceError(error instanceof Error ? error.message : "Explore failed to open");
    } finally {
      setWebModePending(false);
    }
  }

  async function handleLibraryTrackSelect(track: AudioLibraryTrackSummary) {
    setSelectedLibraryTrackId(track.id);
    setConfirmingDeleteLibraryTrackId(null);
    if ((track.storage === "local" || track.storage === "nas" || track.storage === "usb") && track.path) {
      await switchSource("mpd", undefined, track.path, track.storage);
    }
  }

  function handlePrimaryPanelSelect(panelId: PrimaryPanelId) {
    setManualPanelSelection(true);
    setSelectedPrimaryPanel(panelId);
    setSelectedLibraryTrackId(null);
    setSourceError(null);
    setSourceHint(null);
    setConfirmingDeleteLibraryTrackId(null);
    resetLibraryFastScrollDrag();

    if (panelId === "library") {
      if (currentSource.id !== "mpd") void switchSource("mpd");
      return;
    }

    void switchSource(panelId);
  }

  function handleStorageSelect(storageId: LibraryFilterId) {
    setManualPanelSelection(true);
    setSelectedLibraryStorage(storageId);
    setSelectedLibraryTrackId(null);
    setSourceError(null);
    setSourceHint(null);
    setConfirmingDeleteLibraryTrackId(null);
    resetLibraryFastScrollDrag();
  }

  async function handleFavoriteTrack(track: AudioLibraryTrackSummary) {
    if (!track.path || favoriteBusy) return;
    setFavoriteBusy(true);
    setSourceError(null);
    setSourceHint(null);
    try {
      await sendFavoriteTrack(track.path, !track.favorite);
      refreshLocalLibrary();
      setSourceHint(!track.favorite ? "Saved to Favorites." : "Removed from Favorites.");
    } catch (error) {
      setSourceError(error instanceof Error ? error.message : "Favorite update failed");
    } finally {
      setFavoriteBusy(false);
    }
  }

  async function handleCopyUsbTrackToLocal(track: AudioLibraryTrackSummary) {
    if (track.storage !== "usb" || !track.path || copyingLibraryTrackId) return;
    setCopyingLibraryTrackId(track.id);
    setSourceError(null);
    setSourceHint(null);
    try {
      const result = await copyLibraryTrackToLocal(track.path);
      setLocalLibraryTracks(result.library.tracks.filter((entry) => entry.storage === "local"));
      setNasLibraryTracks(result.library.tracks.filter((entry) => entry.storage === "nas"));
      setUsbLibraryTracks(result.library.tracks.filter((entry) => entry.storage === "usb"));
      setLocalLibraryStorage(result.library.localStorage ?? null);
      setSourceHint(result.copied ? "Saved to Local." : "Already saved locally.");
    } catch (error) {
      setSourceError(error instanceof Error ? error.message : "Copy to Local failed");
    } finally {
      setCopyingLibraryTrackId(null);
    }
  }

  function handleDeleteLocalTrackRequest(track: AudioLibraryTrackSummary) {
    if (track.storage !== "local" || !track.path || deletingLibraryTrackId) return;
    setConfirmingDeleteLibraryTrackId(track.id);
    setSourceError(null);
    setSourceHint(null);
  }

  function handleDeleteLocalTrackCancel(track: AudioLibraryTrackSummary) {
    if (confirmingDeleteLibraryTrackId === track.id) {
      setConfirmingDeleteLibraryTrackId(null);
    }
  }

  async function handleDeleteLocalTrackConfirm(track: AudioLibraryTrackSummary) {
    if (track.storage !== "local" || !track.path || deletingLibraryTrackId) return;
    setDeletingLibraryTrackId(track.id);
    setSourceError(null);
    setSourceHint(null);
    try {
      const result = await deleteLibraryTrackFromLocal(track.path);
      setLocalLibraryTracks(result.library.tracks.filter((entry) => entry.storage === "local"));
      setNasLibraryTracks(result.library.tracks.filter((entry) => entry.storage === "nas"));
      setUsbLibraryTracks(result.library.tracks.filter((entry) => entry.storage === "usb"));
      setLocalLibraryStorage(result.library.localStorage ?? null);
      if (selectedLibraryTrackId === track.id) {
        setSelectedLibraryTrackId(null);
      }
      setSourceHint("Removed from Local.");
    } catch (error) {
      setSourceError(error instanceof Error ? error.message : "Delete local track failed");
    } finally {
      setDeletingLibraryTrackId(null);
      setConfirmingDeleteLibraryTrackId(null);
    }
  }

  async function handlePlayerFavoriteAction() {
    await onPlaybackAction("favorite_toggle");
    refreshLocalLibrary();
  }

  function externalSourceActionLabel(panelId: ExternalPanelId, sourceActive: boolean) {
    if (sourceActive) return "Active";
    if (panelId === "spotify") return "Open Spotify";
    if (panelId === "bluetooth") return "Pair phone";
    if (panelId === "upnp") return "Open DLNA";
    return "Open AirPlay";
  }

  function renderRadioSourcePanel() {
    const source = audio.sources.find((entry) => entry.id === "radio");
    const sourcePending = pendingSource === "radio";
    const canSwitch = source?.controllability !== "status-only" && source?.availability !== "unavailable";

    return (
      <section className="source-panel source-panel-radio" aria-label="Radio source">
        <div className="source-hero-card">
          <div className="source-hero-icon" aria-hidden="true">
            <RadioIcon size={28} />
          </div>
          <div className="source-hero-copy">
            <span className="source-panel-kicker">{source?.label ?? "Radio"}</span>
            <strong>{sourceStatusLabel(source, sourcePending)}</strong>
            <p>{selectedRadioCategory === "random" ? "Three fresh picks. Tap one to play." : source?.secondaryStatus ?? "Radio presets"}</p>
          </div>
          <button
            className={`source-hero-action ${source?.active ? "is-active" : ""}`}
            type="button"
            disabled={status.pending || pendingSource !== null || !canSwitch}
            data-gesture-control
            onClick={() => void switchSource("radio")}
          >
            {sourcePending ? <LoaderCircle size={18} className="is-spinning" /> : <RadioIcon size={18} />}
            <span>{source?.active ? "Active" : "Enable Radio"}</span>
          </button>
        </div>

        <div className="radio-category-tabs" role="tablist" aria-label="Radio categories">
          {radioCategoryTabs.map((category) => {
            const count = radioCategories.find((entry) => entry.id === category.id)?.count ?? 0;
            return (
              <button
                className={selectedRadioCategory === category.id ? "is-active" : ""}
                key={category.id}
                type="button"
                role="tab"
                aria-selected={selectedRadioCategory === category.id}
                data-gesture-control
                data-radio-category={category.id}
                data-radio-category-count={count}
                onClick={() => setSelectedRadioCategory(category.id)}
              >
                {category.label}
              </button>
            );
          })}
        </div>

        {radioLoading ? (
          <div className="source-result-meta" data-radio-loading-status>
            <span>Loading stations...</span>
          </div>
        ) : null}

        {radioError ? <p className="source-panel-error" title={radioError}>{friendlyUiError(radioError, "Radio is not ready. Try another station.")}</p> : null}

        <div className="radio-catalog-list">
          {radioStations.map((station) => {
            const stationPending = sourcePending && !station.active;
            const showLogo = Boolean(station.logoUrl) && !failedRadioLogoIds.has(station.id);
            return (
              <button
                className={`radio-catalog-item ${station.active ? "is-active" : ""}`}
                key={station.id}
                type="button"
                disabled={status.pending || pendingSource !== null || !canSwitch}
                data-gesture-control
                onClick={() => void switchSource("radio", station.id)}
              >
                <span className="radio-station-logo" aria-hidden="true">
                  {showLogo ? (
                    <img
                      src={station.logoUrl ?? ""}
                      alt=""
                      data-radio-station-logo={station.id}
                      onError={() => {
                        setFailedRadioLogoIds((current) => {
                          const next = new Set(current);
                          next.add(station.id);
                          return next;
                        });
                      }}
                    />
                  ) : (
                    <span>{(station.categoryLabel ?? station.label).slice(0, 2).toUpperCase()}</span>
                  )}
                </span>
                <span className="radio-catalog-copy">
                  <strong>{station.label}</strong>
                  <p>{station.broadcaster || station.secondaryStatus}</p>
                </span>
                <span className="radio-catalog-meta">
                  {station.categoryLabel ? <span data-radio-station-category={station.category}>{station.categoryLabel}</span> : null}
                  {station.tags?.[0] ? <span>{station.tags[0]}</span> : null}
                  {station.bitrateKbps ? <span>{station.bitrateKbps} kbps</span> : null}
                  {station.codec ? <span>{station.codec}</span> : null}
                </span>
                <span className="radio-station-state" aria-hidden="true">
                  {stationPending ? <LoaderCircle size={16} className="is-spinning" /> : station.active ? <Check size={16} /> : null}
                </span>
              </button>
            );
          })}
          {!radioLoading && radioStations.length === 0 ? (
            <p className="queue-panel-empty">No stations here. Try Random.</p>
          ) : null}
        </div>
      </section>
    );
  }

  function renderExternalSourcePanel(panelId: ExternalPanelId) {
    const source = audio.sources.find((entry) => entry.id === panelId);
    const panel = primaryPanels.find((entry) => entry.id === panelId) ?? selectedPanelConfig;
    const Icon = panel.Icon;
    const sourcePending = pendingSource === panelId;
    const canSwitch = source?.controllability !== "status-only" && source?.availability !== "unavailable";

    return (
      <section className="external-source-panel" aria-label={`${panelId} source`}>
        <div className="external-source-card">
          <div className="external-source-icon" aria-hidden="true">
            <Icon size={28} />
          </div>
          <div className="external-source-copy">
            <span className="source-panel-kicker">{source?.label ?? selectedPanelConfig.label}</span>
            <strong>{sourceStatusLabel(source, sourcePending)}</strong>
            <p>{source?.connectedLabel ?? source?.advertisedLabel ?? source?.secondaryStatus ?? panel.label}</p>
          </div>
          <button
            className={`external-source-action ${source?.active ? "is-active" : ""}`}
            type="button"
            disabled={status.pending || pendingSource !== null || !canSwitch}
            data-gesture-control
            onClick={() => void switchSource(panelId)}
          >
            {sourcePending ? <LoaderCircle size={18} className="is-spinning" /> : <Icon size={18} />}
            <span>{sourcePending && isHandoffSourceId(panelId) ? "Waiting" : externalSourceActionLabel(panelId, Boolean(source?.active))}</span>
          </button>
        </div>
      </section>
    );
  }

  function renderHandoffPanel(panelId: ExternalPanelId) {
    const source = audio.sources.find((entry) => entry.id === panelId);
    const sourceLabel = getHandoffSourceLabel(panelId, source);

    return (
      <section className="external-source-panel" aria-label={`${sourceLabel} connection handoff`}>
        <div
          className="dlna-handoff-card player-dlna-handoff-card"
          role="status"
          data-source-handoff-waiting={panelId}
          data-dlna-handoff-waiting={panelId === "upnp" ? "" : undefined}
        >
          <span className="dlna-handoff-icon" aria-hidden="true">
            <LoaderCircle size={26} className="is-spinning" />
          </span>
          <span className="source-panel-kicker">{sourceLabel}</span>
          <strong>Connecting</strong>
          <p>Connect from your phone. This returns when playback starts.</p>
        </div>
      </section>
    );
  }

  const handoffPendingPanel = isHandoffSourceId(pendingSource) ? pendingSource : null;

  return (
    <section className={`overlay player-overlay ${active ? "is-active" : ""}`} aria-label="Player controls" aria-hidden={!active}>
      <button className="overlay-backdrop" type="button" tabIndex={active ? 0 : -1} aria-label="Return to ambient" onClick={onReturnAmbient} />
      <div className="player-shell" role="dialog" aria-modal="true" data-gesture-protected {...overlayReturnGesture}>
        <div className="player-now-playing-pane" data-player-now-playing-pane>
          <div className="cover-zone">
            <div className="cover-art" data-generated-cover-fallback={usingGeneratedCoverFallback ? true : undefined}>
              <img
                src={displayedAlbumArtUrl}
                alt=""
                data-generated-cover-fallback={usingGeneratedCoverFallback ? true : undefined}
                onError={() => {
                  if (playbackTruth.hasPlaybackArtwork) {
                    setFailedAlbumArtUrl(playbackTruth.albumArtUrl);
                  }
                }}
              />
            </div>
          </div>

          <div className="playback-zone">
            <div className="source-line">
              {sourceLine.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </div>

            <div className="track-stack">
              <h1>{playbackTruth.title}</h1>
              <p className="artist">{playbackTruth.artist}</p>
              <p>{playbackTruth.album}</p>
              <p>{playbackTruth.queuePositionLabel}</p>
            </div>

            <div className="progress-row">
              <span>{formatDuration(displayedElapsedSeconds)}</span>
              <div className={`progress-control ${seekSupported ? "is-interactive" : "is-readonly"}`}>
                <div className="progress-bar" aria-hidden="true">
                  <span style={{ width: `${progress * 100}%` }} />
                </div>
                {seekSupported ? (
                  <input
                    className="progress-slider"
                    type="range"
                    min={0}
                    max={durationSeconds}
                    step={1}
                    value={seekDraftSeconds ?? seekPendingSeconds ?? elapsedSeconds}
                    aria-label="Seek position"
                    disabled={status.pending}
                    onChange={(event) => handleSeekDraft(event.currentTarget.value)}
                    onPointerUp={() => void commitSeek(seekDraftSeconds)}
                    onPointerCancel={() => setSeekDraftSeconds(null)}
                    onBlur={() => void commitSeek(seekDraftSeconds)}
                    onKeyUp={(event) => {
                      if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home" || event.key === "End" || event.key === "PageUp" || event.key === "PageDown") {
                        void commitSeek(seekDraftSeconds);
                      }
                    }}
                  />
                ) : null}
              </div>
              <span>{formatDuration(displayedDurationSeconds)}</span>
            </div>
            {seekError ? <p className="player-inline-message is-error">{seekError}</p> : null}
            {!seekError && seekPendingSeconds !== null ? <p className="player-inline-message">Seeking to {formatDuration(seekPendingSeconds)}...</p> : null}

            <div className="transport-row" aria-label="Playback controls">
              <button className="icon-button" type="button" aria-label="Previous" title={previousTitle} disabled={previousDisabled} onClick={() => void onPlaybackAction("previous")}>
                <SkipBack size={34} fill="currentColor" />
              </button>
              <button className="play-button" type="button" aria-label={isPlaying ? "Pause" : "Play"} title={playPauseTitle} disabled={playPauseDisabled} onClick={() => void onPlaybackAction("play_pause")}>
                {isPlaying ? <Pause size={40} fill="currentColor" /> : <Play size={40} fill="currentColor" />}
              </button>
              <button className="icon-button" type="button" aria-label="Next" title={nextTitle} disabled={nextDisabled} onClick={() => void onPlaybackAction("next")}>
                <SkipForward size={34} fill="currentColor" />
              </button>
              <button
                className={`icon-button ${playback.favorite ? "is-active" : ""}`}
                type="button"
                aria-label={playback.favorite ? "Remove favorite" : "Favorite"}
                title={playback.favorite ? "Remove favorite" : "Favorite"}
                aria-pressed={playback.favorite}
                disabled={status.pending}
                onClick={() => void handlePlayerFavoriteAction()}
              >
                <Heart size={30} fill={playback.favorite ? "currentColor" : "none"} />
              </button>
            </div>
          </div>
        </div>

        <aside className="library-zone" aria-label="Audio source browser" data-player-library-pane data-player-source-panel={selectedPrimaryPanel}>
          <div className="library-browser-header">
            <div className="library-browser-title">
              <div>
                <span className="source-panel-kicker">Source</span>
                <strong>{selectedPanelConfig.label}</strong>
              </div>
            </div>
            <div className="library-volume-actions" data-player-volume-control title={volumeError ?? "Volume"}>
              <span className="library-volume-label">Volume</span>
              <div className="library-volume-slider-control">
                <div className="library-volume-track" aria-hidden="true">
                  <span style={{ width: `${displayedVolumePercent}%` }} />
                </div>
                <input
                  className="library-volume-slider"
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={displayedVolumePercent}
                  aria-label="Volume"
                  aria-valuetext={`${displayedVolumePercent}%`}
                  data-player-volume-slider
                  data-gesture-control
                  onChange={(event) => handleVolumeSliderChange(event.currentTarget.value)}
                  onPointerUp={commitVolumeChange}
                  onTouchEnd={commitVolumeChange}
                  onKeyUp={commitVolumeChange}
                  onBlur={commitVolumeChange}
                />
              </div>
              <span className={`library-volume-percent ${volumeError ? "is-error" : ""}`} data-player-volume-percent>{displayedVolumePercent}%</span>
              <div
                className={`library-local-storage-meter ${localDiskUsedPercent === null ? "is-unavailable" : ""}`}
                aria-label={`Local storage: ${localDiskFreeLabel} free`}
                title={localDiskUsedPercent === null ? "Local storage unavailable" : `${localDiskFreeLabel} free`}
                data-library-local-storage
              >
                <span className="library-local-storage-copy">
                  <b>Local</b>
                  <strong>{localDiskFreeLabel} free</strong>
                </span>
                <span className="library-local-storage-track" aria-hidden="true">
                  <i style={{ width: `${localDiskUsedPercent ?? 0}%` }} />
                </span>
              </div>
              <button
                className="library-volume-back"
                type="button"
                data-gesture-control
                data-player-volume-back
                aria-label="Back to main screen"
                onClick={onReturnAmbient}
              >
                <PanelRightClose size={15} />
                <span>Back</span>
              </button>
            </div>
          </div>

          {!handoffPendingPanel ? (
            <nav className="library-primary-tabs" aria-label="Audio sources" data-source-panel>
              {primaryPanels.map((panel) => {
                const Icon = panel.Icon;
                const isSelected = selectedPrimaryPanel === panel.id;
                const isPending = pendingSource === panel.id;
                return (
                  <button
                    className={`library-primary-tab ${isSelected ? "is-selected" : ""} ${panel.id === currentSource.id || (panel.id === "library" && currentSource.id === "mpd") ? "is-active" : ""}`}
                    key={panel.id}
                    type="button"
                    aria-pressed={isSelected}
                    data-source-item={panel.id === "library" ? "mpd" : panel.id}
                    data-gesture-control
                    onClick={() => handlePrimaryPanelSelect(panel.id)}
                  >
                    <Icon size={20} />
                    <strong>{panel.label}</strong>
                    <span>{isPending ? "Opening" : panelMeta(panel.id)}</span>
                  </button>
                );
              })}
              <button
                className={`library-primary-tab ${webModePending ? "is-selected" : ""}`}
                type="button"
                data-source-item="web-mode"
                data-gesture-control
                disabled={Boolean(pendingSource || webModePending)}
                onClick={() => void openWebMode()}
              >
                <Globe2 size={20} />
                <strong>Explore</strong>
                <span>{webModePending ? "Opening" : "Web players"}</span>
              </button>
            </nav>
          ) : null}

          {handoffPendingPanel ? renderHandoffPanel(handoffPendingPanel) : selectedPrimaryPanel === "library" ? (
            <>
              <nav className="library-storage-tabs" aria-label="Library storage">
                {storageTabs.map((storage) => {
                  const Icon = storage.Icon;
                  const isSelected = selectedLibraryStorage === storage.id;
                  const count = libraryFilterCount(storage.id);
                  return (
                    <button
                      className={`library-storage-tab ${isSelected ? "is-selected" : ""}`}
                      key={storage.id}
                      type="button"
                      aria-pressed={isSelected}
                      data-library-storage={storage.id}
                      data-gesture-control
                      onClick={() => handleStorageSelect(storage.id)}
                    >
                      <Icon size={18} />
                      <strong>{storage.label}</strong>
                      <span>{count}</span>
                    </button>
                  );
                })}
              </nav>

              {libraryError && (selectedLibraryStorage === "local" || selectedLibraryStorage === "usb") ? (
                <p className="source-panel-error" title={libraryError}>{friendlyUiError(libraryError, "Library is not ready. Scan or retry.")}</p>
              ) : null}

              <div
                className={`library-track-list-shell ${libraryFastScrollMetrics.available ? "has-fast-scroll" : ""}`}
                data-library-track-list-shell
              >
                <div
                  className="library-track-list"
                  data-library-track-list
                  data-gesture-control
                  ref={libraryTrackListRef}
                  onScroll={handleLibraryTrackListScroll}
                  onWheel={handleLibraryTrackListWheel}
                >
                  {visibleLibraryTracks.map((track, index) => {
                    const selected = selectedLibraryTrack?.id === track.id;
                    const isLocalTrack = selectedLibraryStorage === "local" && track.storage === "local";
                    const isUsbTrack = selectedLibraryStorage === "usb" && track.storage === "usb";
                    const hasRowAction = isLocalTrack || isUsbTrack;
                    const copyBusy = copyingLibraryTrackId === track.id;
                    const deleteBusy = deletingLibraryTrackId === track.id;
                    const deleteConfirming = confirmingDeleteLibraryTrackId === track.id;
                    const audioInfo = track.storage === "local" || track.storage === "nas" || track.storage === "usb" ? formatLibraryAudioInfo(track) : null;
                    return (
                      <article
                        className={`library-track-item ${hasRowAction ? "has-row-action" : ""} ${selected ? "is-selected" : ""} ${track.active ? "is-active" : ""}`}
                        key={track.id}
                        data-library-track={track.id}
                      >
                        <button
                          className="library-track-main"
                          type="button"
                          aria-pressed={selected}
                          data-gesture-control
                          onClick={() => void handleLibraryTrackSelect(track)}
                        >
                          <span className="library-track-index">
                            {track.albumArtUrl ? <img src={track.albumArtUrl} alt="" /> : String(index + 1).padStart(2, "0")}
                          </span>
                          <span className="library-track-copy">
                            <strong>{track.title}</strong>
                            <em>{track.artist}</em>
                          </span>
                          <span className="library-track-meta">
                            <i>{track.subCategory}</i>
                            <b>{formatDuration(track.durationSeconds)}</b>
                            {audioInfo ? <small className="library-track-audio-info">{audioInfo}</small> : null}
                          </span>
                          <span className="library-track-state" aria-hidden="true">
                            {selected || track.active ? <Check size={16} /> : null}
                          </span>
                        </button>
                        <button
                          className={`library-track-favorite ${track.favorite ? "is-active" : ""}`}
                          type="button"
                          aria-label={track.favorite ? `Remove ${track.title} from favorites` : `Add ${track.title} to favorites`}
                          title={track.favorite ? "Remove favorite" : "Favorite"}
                          aria-pressed={track.favorite}
                          disabled={favoriteBusy || !track.path}
                          data-gesture-control
                          onClick={() => void handleFavoriteTrack(track)}
                        >
                          <Heart size={17} fill={track.favorite ? "currentColor" : "none"} />
                        </button>
                        {isUsbTrack ? (
                          <button
                            className="library-track-copy-local"
                            type="button"
                            aria-label={`Copy ${track.title} to Local`}
                            title="Copy to Local"
                            disabled={copyingLibraryTrackId !== null || !track.path}
                            data-library-copy-local
                            data-gesture-control
                            onClick={() => void handleCopyUsbTrackToLocal(track)}
                          >
                            {copyBusy ? <LoaderCircle size={15} className="is-spinning" /> : <Copy size={15} />}
                            <span>Copy to Local</span>
                          </button>
                        ) : null}
                        {isLocalTrack && deleteConfirming ? (
                          <span className="library-track-delete-confirm" data-library-delete-confirm data-gesture-control>
                            <span className="library-track-delete-confirm-label">Delete?</span>
                            <button
                              className="library-track-delete-confirm-button is-yes"
                              type="button"
                              aria-label={`Yes, delete ${track.title} from Local`}
                              title="Yes, delete"
                              disabled={deletingLibraryTrackId !== null || !track.path}
                              data-library-delete-confirm-yes
                              data-gesture-control
                              onClick={() => void handleDeleteLocalTrackConfirm(track)}
                            >
                              {deleteBusy ? <LoaderCircle size={14} className="is-spinning" /> : null}
                              <span>Yes</span>
                            </button>
                            <button
                              className="library-track-delete-confirm-button is-no"
                              type="button"
                              aria-label={`No, keep ${track.title}`}
                              title="No, keep"
                              disabled={deletingLibraryTrackId !== null}
                              data-library-delete-confirm-no
                              data-gesture-control
                              onClick={() => handleDeleteLocalTrackCancel(track)}
                            >
                              No
                            </button>
                          </span>
                        ) : isLocalTrack ? (
                          <button
                            className="library-track-delete-local"
                            type="button"
                            aria-label={`Delete ${track.title} from Local`}
                            title="Delete from Local"
                            disabled={deletingLibraryTrackId !== null || !track.path}
                            data-library-delete-local
                            data-gesture-control
                            onClick={() => handleDeleteLocalTrackRequest(track)}
                          >
                            <Trash2 size={15} />
                            <span>Delete</span>
                          </button>
                        ) : null}
                      </article>
                    );
                  })}
                  {libraryLoading && (selectedLibraryStorage === "local" || selectedLibraryStorage === "usb") ? (
                    <p className="queue-panel-empty">Loading music library...</p>
                  ) : null}
                  {!libraryLoading && visibleLibraryTracks.length === 0 ? (
                    <p className="queue-panel-empty">
                      {selectedLibraryStorage === "nas"
                        ? "Add NAS in Settings."
                        : selectedLibraryStorage === "usb"
                          ? "No USB tracks found. Check the drive, then scan."
                          : selectedLibraryStorage === "favorites"
                            ? "No favorites yet. Tap the heart on a track."
                            : selectedLibraryStorage === "recently_added"
                              ? "No recent tracks yet."
                              : "No local tracks yet. Copy from USB or scan."}
                    </p>
                  ) : null}
                </div>
                {libraryFastScrollMetrics.available ? (
                  <div
                    className={`library-fast-scroll ${libraryFastScrollDragging ? "is-dragging" : ""}`}
                    data-library-fast-scroll
                    data-gesture-control
                    role="scrollbar"
                    aria-label="Library fast scroll"
                    aria-orientation="vertical"
                    aria-valuemin={1}
                    aria-valuemax={visibleLibraryTracks.length}
                    aria-valuenow={libraryFastScrollMetrics.currentIndex}
                    onPointerDown={handleLibraryFastScrollPointerDown}
                    onPointerMove={handleLibraryFastScrollPointerMove}
                    onPointerUp={finishLibraryFastScrollDrag}
                    onPointerCancel={finishLibraryFastScrollDrag}
                  >
                    <span className="library-fast-scroll-count">
                      {libraryFastScrollMetrics.currentIndex}
                      <small>/ {visibleLibraryTracks.length}</small>
                    </span>
                    <span className="library-fast-scroll-track" ref={libraryFastScrollTrackRef}>
                      <span
                        className="library-fast-scroll-thumb"
                        data-library-fast-scroll-thumb
                        style={{
                          height: `${libraryFastScrollMetrics.thumbPercent}%`,
                          top: `${libraryFastScrollMetrics.thumbTopPercent}%`
                        }}
                      />
                    </span>
                  </div>
                ) : null}
              </div>
            </>
          ) : selectedPrimaryPanel === "radio" ? renderRadioSourcePanel() : renderExternalSourcePanel(selectedPrimaryPanel)}

          {sourceError ? <p className="source-panel-error" title={sourceError}>{friendlyUiError(sourceError)}</p> : null}
          {!sourceError && sourceHint && selectedPrimaryPanel !== "radio" ? <p className="source-panel-hint">{sourceHint}</p> : null}
        </aside>
      </div>
    </section>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bluetooth,
  Cast,
  Check,
  Clock,
  HardDrive,
  Heart,
  LibraryBig,
  ListMusic,
  LoaderCircle,
  Music2,
  Network,
  Pause,
  Play,
  Radio as RadioIcon,
  Search,
  Server,
  SkipBack,
  SkipForward,
  Usb
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { fetchAudioLibrary, fetchRadioCatalog, sendFavoriteTrack } from "../api/tikpalClient";
import { getPlaybackDisplayTruth, getPlaybackSourceSummary } from "../playbackTruth";
import type { TikpalDataStatus } from "../hooks/useTikpalState";
import { formatDuration } from "../mockState";
import { useOverlayReturnGesture } from "../hooks/useOverlayReturnGesture";
import type {
  AudioLibraryCategoryId,
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
  onOpenPlaylist: () => void;
  onReturnAmbient: () => void;
}

type PrimaryPanelId = "library" | "radio" | "spotify" | "airplay" | "bluetooth" | "upnp";
type ExternalPanelId = Exclude<PrimaryPanelId, "library" | "radio">;
type LibraryFilterId = "local" | "nas" | "usb" | "favorites" | "recently_added";

interface LocalCategory {
  id: AudioLibraryCategoryId;
  label: string;
}

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

const storageTabs: Array<{ id: LibraryFilterId; label: string; Icon: LucideIcon }> = [
  { id: "local", label: "Local", Icon: HardDrive },
  { id: "nas", label: "NAS", Icon: Server },
  { id: "usb", label: "USB", Icon: Usb },
  { id: "favorites", label: "Favorites", Icon: Heart },
  { id: "recently_added", label: "Recently Added", Icon: Clock }
];

const localCategories: LocalCategory[] = [
  { id: "focus", label: "Focus" },
  { id: "meditation", label: "Meditation" },
  { id: "rest", label: "Rest" }
];

const localSubCategoryOrder: Record<AudioLibraryCategoryId, string[]> = {
  focus: [
    "Lo-fi / Ambient",
    "Classical / Piano",
    "Binaural / Alpha / Theta",
    "White Noise / Brown Noise"
  ],
  meditation: [
    "Guided Meditation",
    "Breathing",
    "Singing Bowl",
    "Nature Sounds"
  ],
  rest: [
    "Nap",
    "Sleep",
    "Rain / Ocean / Forest",
    "Deep Sleep Long Tracks"
  ]
};

function categoryLabel(categoryId: AudioLibraryCategoryId) {
  return localCategories.find((category) => category.id === categoryId)?.label ?? "Library";
}

function subCategorySortIndex(categoryId: AudioLibraryCategoryId, label: string) {
  const index = localSubCategoryOrder[categoryId].indexOf(label);
  return index === -1 ? localSubCategoryOrder[categoryId].length : index;
}

function sourceStatusLabel(source: AudioState["currentSource"] | undefined, pending: boolean) {
  if (pending && isHandoffSourceId(source?.id)) return "Waiting for connection";
  if (pending) return "Opening";
  if (!source) return "Unavailable";
  if (source.active) return "Active";
  if (source.connectionState === "connected") return "Connected";
  if (source.connectionState === "armed") return "Ready";
  if (source.connectionState === "blocked") return "Closed";
  if (source.availability === "unavailable") return "Unavailable";
  return "Ready";
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

export function PlayerOverlay({
  active,
  playback,
  audio,
  system,
  status,
  fontTheme,
  onPlaybackAction,
  onSourceSwitch,
  onOpenPlaylist,
  onReturnAmbient
}: PlayerOverlayProps) {
  const overlayReturnGesture = useOverlayReturnGesture(onReturnAmbient);
  const [seekDraftSeconds, setSeekDraftSeconds] = useState<number | null>(null);
  const [seekPendingSeconds, setSeekPendingSeconds] = useState<number | null>(null);
  const [seekError, setSeekError] = useState<string | null>(null);
  const [selectedPrimaryPanel, setSelectedPrimaryPanel] = useState<PrimaryPanelId>("library");
  const [selectedLibraryStorage, setSelectedLibraryStorage] = useState<LibraryFilterId>("local");
  const [selectedLocalCategory, setSelectedLocalCategory] = useState<AudioLibraryCategoryId>("focus");
  const [selectedLocalSubCategory, setSelectedLocalSubCategory] = useState("all");
  const [selectedLibraryTrackId, setSelectedLibraryTrackId] = useState<string | null>(null);
  const [manualPanelSelection, setManualPanelSelection] = useState(false);
  const [localLibraryTracks, setLocalLibraryTracks] = useState<AudioLibraryTrackSummary[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [radioStations, setRadioStations] = useState<RadioStationSummary[]>([]);
  const [radioTotal, setRadioTotal] = useState(0);
  const [radioGenres, setRadioGenres] = useState<string[]>([]);
  const [radioBitrates, setRadioBitrates] = useState<string[]>([]);
  const [radioQuery, setRadioQuery] = useState("");
  const [selectedRadioGenre, setSelectedRadioGenre] = useState("");
  const [selectedRadioBitrate, setSelectedRadioBitrate] = useState("");
  const [radioLoading, setRadioLoading] = useState(false);
  const [radioError, setRadioError] = useState<string | null>(null);
  const [pendingSource, setPendingSource] = useState<SourceSwitchTarget | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [sourceHint, setSourceHint] = useState<string | null>(null);
  const [volumeDraftPercent, setVolumeDraftPercent] = useState<number | null>(null);
  const [volumeError, setVolumeError] = useState<string | null>(null);
  const volumeRequestStateRef = useRef<VolumeRequestState>({
    inFlight: false,
    queued: null,
    lastSent: system.volume.percent
  });
  const playbackTruth = getPlaybackDisplayTruth(playback, audio, fontTheme);
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
  const nasLibraryTracks = useMemo<AudioLibraryTrackSummary[]>(() => (
    playback.queuePreview.map((entry) => ({
      id: `nas-${entry.id}`,
      title: entry.title,
      artist: entry.artist,
      album: entry.album || "NAS Library",
      categoryId: "nas",
      subCategory: entry.active ? "Now Playing" : "Queue",
      durationSeconds: entry.durationSeconds,
      path: null,
      albumArtUrl: null,
      albumArtLabel: null,
      albumArtScope: null,
      active: entry.active,
      storage: "nas",
      favorite: false
    }))
  ), [playback.queuePreview]);
  const localCategoryCounts = useMemo(() => (
    localLibraryTracks.reduce<Record<AudioLibraryCategoryId, number>>(
      (counts, track) => {
        if (track.categoryId === "focus" || track.categoryId === "meditation" || track.categoryId === "rest") {
          counts[track.categoryId] += 1;
        }
        return counts;
      },
      { focus: 0, meditation: 0, rest: 0 }
    )
  ), [localLibraryTracks]);
  const localCategoryTracks = useMemo(() => (
    localLibraryTracks.filter((track) => track.categoryId === selectedLocalCategory)
  ), [localLibraryTracks, selectedLocalCategory]);
  const localSubCategoryTabs = useMemo(() => {
    const counts = new Map<string, number>();
    localCategoryTracks.forEach((track) => {
      counts.set(track.subCategory, (counts.get(track.subCategory) ?? 0) + 1);
    });
    return Array.from(counts.entries())
      .sort(([leftLabel], [rightLabel]) => (
        subCategorySortIndex(selectedLocalCategory, leftLabel) - subCategorySortIndex(selectedLocalCategory, rightLabel)
        || leftLabel.localeCompare(rightLabel)
      ))
      .map(([label, count]) => ({ label, count }));
  }, [localCategoryTracks, selectedLocalCategory]);
  const selectedSubCategoryIsAvailable = selectedLocalSubCategory === "all"
    || localSubCategoryTabs.some((tab) => tab.label === selectedLocalSubCategory);
  const selectedLocalTracks = useMemo(() => (
    selectedLocalSubCategory === "all" || !selectedSubCategoryIsAvailable
      ? localCategoryTracks
      : localCategoryTracks.filter((track) => track.subCategory === selectedLocalSubCategory)
  ), [localCategoryTracks, selectedLocalSubCategory, selectedSubCategoryIsAvailable]);
  const visibleLibraryTracks = useMemo(() => {
    switch (selectedLibraryStorage) {
      case "nas":
        return nasLibraryTracks;
      case "local":
        return selectedLocalTracks;
      case "usb":
      case "recently_added":
        return localLibraryTracks.slice(0, 12);
      case "favorites":
        return localLibraryTracks.filter((track) => track.favorite);
      default:
        return localLibraryTracks;
    }
  }, [localLibraryTracks, nasLibraryTracks, selectedLibraryStorage, selectedLocalTracks]);
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

  const selectedLocalCategoryLabel = categoryLabel(selectedLocalCategory);
  const sourceLine = [
    playbackTruth.sourceLabel,
    sourceStatusLabel(playbackSource, pendingSource === playback.source),
    status.pending ? "Syncing" : status.source === "api" ? "API Confirmed" : "Fallback Data"
  ];

  useEffect(() => {
    if (!active) {
      setSeekDraftSeconds(null);
      setSeekPendingSeconds(null);
      setSeekError(null);
      setPendingSource(null);
      setSourceError(null);
      setSourceHint(null);
      setVolumeDraftPercent(null);
      setVolumeError(null);
      setManualPanelSelection(false);
    }
  }, [active]);

  useEffect(() => {
    const requestState = volumeRequestStateRef.current;
    requestState.lastSent = system.volume.percent;
    if (!requestState.inFlight && requestState.queued === null) {
      setVolumeDraftPercent(null);
    }
  }, [system.volume.percent]);

  const dispatchVolumeChange = useCallback(
    (percent: number) => {
      const nextPercent = clampVolumePercent(percent);
      const requestState = volumeRequestStateRef.current;
      requestState.queued = nextPercent;
      setVolumeDraftPercent(nextPercent);
      setVolumeError(null);

      if (requestState.inFlight) return;

      requestState.inFlight = true;

      const sendNext = async () => {
        const target = requestState.queued;
        requestState.queued = null;

        if (target === null || target === requestState.lastSent) {
          requestState.inFlight = false;
          setVolumeDraftPercent(null);
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
        if (requestState.queued === null) {
          setVolumeDraftPercent(null);
        }
      };

      void sendNext();
    },
    [onPlaybackAction]
  );

  function handleVolumeSliderChange(value: string) {
    dispatchVolumeChange(Number(value));
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
    void fetchAudioLibrary({ storage: "local", limit: 500 }, requestSignal)
      .then((library) => {
        setLocalLibraryTracks(library.tracks.filter((track) => track.storage === "local"));
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
      q: radioQuery,
      genre: selectedRadioGenre || undefined,
      bitrate: selectedRadioBitrate || undefined,
      limit: 250
    }, controller.signal)
      .then((catalog) => {
        setRadioStations(catalog.stations);
        setRadioTotal(catalog.total);
        setRadioGenres(catalog.genres);
        setRadioBitrates(catalog.bitrates);
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
  }, [active, radioQuery, selectedPrimaryPanel, selectedRadioBitrate, selectedRadioGenre]);

  useEffect(() => {
    if (!selectedSubCategoryIsAvailable) {
      setSelectedLocalSubCategory("all");
    }
  }, [selectedSubCategoryIsAvailable]);

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
        return system.library.trackCount || nasLibraryTracks.length;
      case "usb":
        return 0;
      case "favorites":
        return localLibraryTracks.filter((track) => track.favorite).length;
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

  async function switchSource(target: SourceSwitchTarget, radioStationId?: string, localTrackPath?: string) {
    if (status.pending || pendingSource) return;
    const rollbackPanel = getPanelForSourceId(currentSource.id);
    setPendingSource(target);
    setSourceError(null);
    setSourceHint(null);

    try {
      const nextState = await onSourceSwitch(target, radioStationId, localTrackPath);
      const nextSource = nextState.audio.sources.find((source) => source.id === target);
      if (target === "mpd" && localTrackPath) {
        setSourceHint("Local track ready.");
      } else if (target === "mpd") {
        setSourceHint("Library source ready.");
      } else if (target === "radio") {
        setSourceHint(`${nextSource?.secondaryStatus ?? "Radio ready."}`);
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

  function handleLibraryTrackSelect(track: AudioLibraryTrackSummary) {
    setSelectedLibraryTrackId(track.id);
    if (track.storage === "local" && track.path) {
      void switchSource("mpd", undefined, track.path);
    }
  }

  function handlePrimaryPanelSelect(panelId: PrimaryPanelId) {
    setManualPanelSelection(true);
    setSelectedPrimaryPanel(panelId);
    setSelectedLibraryTrackId(null);
    setSourceError(null);
    setSourceHint(null);

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
    setSelectedLocalSubCategory("all");
    setSourceError(null);
    setSourceHint(null);
    if (storageId === "nas") {
      void switchSource("mpd");
    }
  }

  async function handleFavoriteTrack(track: AudioLibraryTrackSummary) {
    if (!track.path || favoriteBusy) return;
    setFavoriteBusy(true);
    setSourceError(null);
    setSourceHint(null);
    try {
      await sendFavoriteTrack(track.path, !track.favorite);
      refreshLocalLibrary();
      setSourceHint(!track.favorite ? "Added to Favorites." : "Removed from Favorites.");
    } catch (error) {
      setSourceError(error instanceof Error ? error.message : "Favorite update failed");
    } finally {
      setFavoriteBusy(false);
    }
  }

  async function handlePlayerFavoriteAction() {
    await onPlaybackAction("favorite_toggle");
    refreshLocalLibrary();
  }

  function externalSourceActionLabel(panelId: ExternalPanelId, sourceActive: boolean) {
    if (sourceActive) return "Active";
    if (panelId === "spotify") return "Enable Spotify";
    if (panelId === "bluetooth") return "Enable pairing";
    if (panelId === "upnp") return "Enable DLNA";
    return "Enable AirPlay";
  }

  function renderRadioSourcePanel() {
    const source = audio.sources.find((entry) => entry.id === "radio");
    const sourcePending = pendingSource === "radio";
    const canSwitch = source?.controllability !== "status-only" && source?.availability !== "unavailable";

    return (
      <section className="source-panel" aria-label="Radio source">
        <div className="source-hero-card">
          <div className="source-hero-icon" aria-hidden="true">
            <RadioIcon size={28} />
          </div>
          <div className="source-hero-copy">
            <span className="source-panel-kicker">{source?.label ?? "Radio"}</span>
            <strong>{sourceStatusLabel(source, sourcePending)}</strong>
            <p>{source?.secondaryStatus ?? "Radio presets"}</p>
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

        <div className="radio-filter-row">
          <label className="source-search-field">
            <Search size={18} aria-hidden="true" />
            <input
              value={radioQuery}
              placeholder="Search stations"
              aria-label="Search radio stations"
              data-gesture-control
              onChange={(event) => setRadioQuery(event.currentTarget.value)}
            />
          </label>
          <label className="source-filter-field">
            <span>Genre</span>
            <select
              value={selectedRadioGenre}
              aria-label="Radio genre"
              data-gesture-control
              onChange={(event) => setSelectedRadioGenre(event.currentTarget.value)}
            >
              <option value="">All genres</option>
              {radioGenres.map((genre) => (
                <option value={genre} key={genre}>{genre}</option>
              ))}
            </select>
          </label>
          <label className="source-filter-field">
            <span>Bitrate</span>
            <select
              value={selectedRadioBitrate}
              aria-label="Radio bitrate"
              data-gesture-control
              onChange={(event) => setSelectedRadioBitrate(event.currentTarget.value)}
            >
              <option value="">All bitrates</option>
              {radioBitrates.map((bitrate) => (
                <option value={bitrate} key={bitrate}>{bitrate}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="source-result-meta">
          <span>
            {radioLoading
              ? "Loading stations..."
              : radioTotal > radioStations.length
                ? `${radioStations.length} / ${radioTotal} stations`
                : `${radioTotal || radioStations.length} stations`}
          </span>
          <span>{radioError ? "Catalog unavailable" : selectedRadioGenre || selectedRadioBitrate || "All presets"}</span>
        </div>

        {radioError ? <p className="source-panel-error">{radioError}</p> : null}

        <div className="radio-catalog-list">
          {radioStations.map((station) => {
            const stationPending = sourcePending && !station.active;
            return (
              <button
                className={`radio-catalog-item ${station.active ? "is-active" : ""}`}
                key={station.id}
                type="button"
                disabled={status.pending || pendingSource !== null || !canSwitch}
                data-gesture-control
                onClick={() => void switchSource("radio", station.id)}
              >
                <span className="radio-catalog-copy">
                  <strong>{station.label}</strong>
                  <p>{station.secondaryStatus}</p>
                </span>
                <span className="radio-catalog-meta">
                  {station.genre ? <span>{station.genre}</span> : null}
                  {station.bitrateKbps ? <span>{station.bitrateKbps} kbps</span> : null}
                </span>
                <span className="radio-station-state" aria-hidden="true">
                  {stationPending ? <LoaderCircle size={16} className="is-spinning" /> : station.active ? <Check size={16} /> : null}
                </span>
              </button>
            );
          })}
          {!radioLoading && radioStations.length === 0 ? (
            <p className="queue-panel-empty">No radio stations found.</p>
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
          <strong>Waiting for connection</strong>
          <p>Tikpal is open for {sourceLabel}. This panel will return when the device connects or the handoff times out.</p>
        </div>
      </section>
    );
  }

  const handoffPendingPanel = isHandoffSourceId(pendingSource) ? pendingSource : null;

  return (
    <section className={`overlay player-overlay ${active ? "is-active" : ""}`} aria-label="Player controls" aria-hidden={!active}>
      <button className="overlay-backdrop" type="button" tabIndex={active ? 0 : -1} aria-label="Return to ambient" onClick={onReturnAmbient} />
      <div className="player-shell" role="dialog" aria-modal="true" data-gesture-protected {...overlayReturnGesture}>
        <div className="cover-zone">
          <div className="cover-art">
            <img src={playbackTruth.albumArtUrl} alt="" />
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
            <button
              className="icon-button"
              type="button"
              aria-label="Open playlist"
              title="Playlist"
              data-player-playlist-entry
              data-gesture-control
              onClick={onOpenPlaylist}
            >
              <ListMusic size={30} />
            </button>
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

        <aside className="library-zone" aria-label="Audio source browser">
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
                />
              </div>
              <span className={`library-volume-percent ${volumeError ? "is-error" : ""}`} data-player-volume-percent>{displayedVolumePercent}%</span>
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

              {selectedLibraryStorage === "local" ? (
                <nav className="library-category-tabs" aria-label="Local library categories">
                  {localCategories.map((category) => {
                    const isSelected = selectedLocalCategory === category.id;
                    return (
                      <button
                        className={`library-category-tab ${isSelected ? "is-selected" : ""}`}
                        key={category.id}
                        type="button"
                        aria-pressed={isSelected}
                        data-library-category={category.id}
                        data-gesture-control
                        onClick={() => {
                          setManualPanelSelection(true);
                          setSelectedLocalCategory(category.id);
                          setSelectedLocalSubCategory("all");
                          setSelectedLibraryTrackId(null);
                          setSourceError(null);
                          setSourceHint(null);
                        }}
                      >
                        <strong>{category.label}</strong>
                        <span>{localCategoryCounts[category.id]}</span>
                      </button>
                    );
                  })}
                </nav>
              ) : null}

              {selectedLibraryStorage === "local" && localSubCategoryTabs.length > 0 ? (
                <nav className="library-subcategory-tabs" aria-label={`${selectedLocalCategoryLabel} subfolders`}>
                  <button
                    className={`library-subcategory-tab ${selectedLocalSubCategory === "all" ? "is-selected" : ""}`}
                    type="button"
                    aria-pressed={selectedLocalSubCategory === "all"}
                    data-gesture-control
                    onClick={() => {
                      setManualPanelSelection(true);
                      setSelectedLocalSubCategory("all");
                      setSelectedLibraryTrackId(null);
                    }}
                  >
                    <strong>All</strong>
                    <span>{localCategoryTracks.length}</span>
                  </button>
                  {localSubCategoryTabs.map((subCategory) => {
                    const isSelected = selectedLocalSubCategory === subCategory.label;
                    return (
                      <button
                        className={`library-subcategory-tab ${isSelected ? "is-selected" : ""}`}
                        key={subCategory.label}
                        type="button"
                        aria-pressed={isSelected}
                        data-gesture-control
                        onClick={() => {
                          setManualPanelSelection(true);
                          setSelectedLocalSubCategory(subCategory.label);
                          setSelectedLibraryTrackId(null);
                        }}
                      >
                        <strong>{subCategory.label}</strong>
                        <span>{subCategory.count}</span>
                      </button>
                    );
                  })}
                </nav>
              ) : null}

              {libraryError && selectedLibraryStorage === "local" ? <p className="source-panel-error">{libraryError}</p> : null}

              <div className="library-track-list" data-library-track-list>
                {visibleLibraryTracks.map((track, index) => {
                  const selected = selectedLibraryTrack?.id === track.id;
                  return (
                    <article
                      className={`library-track-item ${selected ? "is-selected" : ""} ${track.active ? "is-active" : ""}`}
                      key={track.id}
                      data-library-track={track.id}
                    >
                      <button
                        className="library-track-main"
                        type="button"
                        aria-pressed={selected}
                        data-gesture-control
                        onClick={() => handleLibraryTrackSelect(track)}
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
                    </article>
                  );
                })}
                {libraryLoading && selectedLibraryStorage === "local" ? (
                  <p className="queue-panel-empty">Loading local music library...</p>
                ) : null}
                {!libraryLoading && visibleLibraryTracks.length === 0 ? (
                  <p className="queue-panel-empty">
                    {selectedLibraryStorage === "nas"
                      ? "NAS queue is empty."
                      : selectedLibraryStorage === "usb"
                        ? "USB library is empty."
                        : selectedLibraryStorage === "favorites"
                          ? "No favorite tracks yet."
                          : selectedLibraryStorage === "recently_added"
                            ? "No recently added tracks yet."
                            : "No local tracks found."}
                  </p>
                ) : null}
              </div>
            </>
          ) : selectedPrimaryPanel === "radio" ? renderRadioSourcePanel() : renderExternalSourcePanel(selectedPrimaryPanel)}

          {sourceError ? <p className="source-panel-error">{sourceError}</p> : null}
          {!sourceError && sourceHint ? <p className="source-panel-hint">{sourceHint}</p> : null}
        </aside>
      </div>
    </section>
  );
}

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  type ReactNode
} from "react";
import {
  Check,
  ChevronLeft,
  Copy,
  GripVertical,
  Heart,
  Image,
  Layers,
  ListChecks,
  ListMusic,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Search,
  Trash2,
  X
} from "lucide-react";
import { createAudioPlaylist, fetchAudioLibrary, fetchAudioPlaylists, sendAudioPlaylistAction } from "../api/tikpalClient";
import type { TikpalDataStatus } from "../hooks/useTikpalState";
import { formatDuration } from "../mockState";
import { useOverlayReturnGesture } from "../hooks/useOverlayReturnGesture";
import type {
  AudioLibraryTrackSummary,
  AudioPlaylistActionRequest,
  AudioPlaylistCoverType,
  AudioPlaylistSummary,
  AudioPlaylistTrackSummary,
  PlaybackSummary
} from "../types";

type PlaylistPageMode =
  | "browse"
  | "actions"
  | "create"
  | "addSongs"
  | "reorderSongs"
  | "removeSongs"
  | "rename"
  | "changeCover"
  | "confirmDelete"
  | "created";

type AddSourceId = "local" | "favorites" | "queue" | "recent" | "radio" | "ai";
type SwipeKind = "playlist" | "track";
type PlaylistLayoutFocus = "library" | "actions" | "current";

interface PlaylistDraft {
  name: string;
  moodTags: string[];
  coverType: AudioPlaylistCoverType;
  coverValue: string;
  trackPaths: string[];
  step: 1 | 2 | 3;
}

interface PlaylistUiState {
  mode: PlaylistPageMode;
  selectedPlaylistId: string | null;
  searchQuery: string;
  swipePlaylistId: string | null;
  swipeTrackKey: string | null;
  addSource: AddSourceId;
  addQuery: string;
  pendingAddPaths: string[];
  reorderPaths: string[];
  removePaths: string[];
  renameDraft: string;
  coverDraft: {
    coverType: AudioPlaylistCoverType;
    coverValue: string;
  };
  draft: PlaylistDraft;
  createdPlaylistId: string | null;
  toast: string | null;
}

type PlaylistUiAction =
  | { type: "PLAYLISTS_REFRESHED"; playlists: AudioPlaylistSummary[] }
  | { type: "SELECT_PLAYLIST"; playlistId: string }
  | { type: "SET_SEARCH"; value: string }
  | { type: "SET_SWIPE"; kind: SwipeKind; id: string | null }
  | { type: "OPEN_CREATE" }
  | { type: "SET_CREATE_STEP"; step: 1 | 2 | 3 }
  | { type: "PATCH_DRAFT"; draft: Partial<PlaylistDraft> }
  | { type: "TOGGLE_DRAFT_TRACK"; trackPath: string }
  | { type: "OPEN_ACTIONS" }
  | { type: "OPEN_ADD_SONGS" }
  | { type: "SET_ADD_SOURCE"; source: AddSourceId }
  | { type: "SET_ADD_QUERY"; value: string }
  | { type: "TOGGLE_PENDING_ADD"; trackPath: string }
  | { type: "OPEN_REORDER"; trackPaths: string[] }
  | { type: "MOVE_REORDER_PATH"; fromIndex: number; toIndex: number }
  | { type: "OPEN_REMOVE" }
  | { type: "TOGGLE_REMOVE"; trackPath: string }
  | { type: "OPEN_RENAME"; name: string }
  | { type: "SET_RENAME"; value: string }
  | { type: "OPEN_COVER"; coverType: AudioPlaylistCoverType; coverValue: string }
  | { type: "SET_COVER"; coverType: AudioPlaylistCoverType; coverValue: string }
  | { type: "OPEN_CONFIRM_DELETE" }
  | { type: "CREATED"; playlistId: string | null }
  | { type: "SET_TOAST"; value: string | null };

interface PlaylistOverlayProps {
  active: boolean;
  playback: PlaybackSummary;
  status: TikpalDataStatus;
  onPlaybackRefresh: () => Promise<void>;
  onReturnAmbient: () => void;
}

const moodOptions = ["Focus", "Flow", "Calm", "Sleep", "Fireplace", "Meditation", "Reading", "Morning"];

const quickTemplates = [
  { label: "Focus", name: "Deep Focus", mood: "Focus", cover: "focus" },
  { label: "Sleep", name: "Quiet Sleep", mood: "Sleep", cover: "sleep" },
  { label: "Calm", name: "Calm Room", mood: "Calm", cover: "calm" },
  { label: "Fireplace", name: "Warm Fireplace", mood: "Fireplace", cover: "fireplace" },
  { label: "Morning", name: "Morning Start", mood: "Morning", cover: "morning" }
];

const coverChoices: Array<{
  label: string;
  detail: string;
  coverType: AudioPlaylistCoverType;
  coverValue: string;
  disabled?: boolean;
}> = [
  { label: "Warm Gradient", detail: "Soft amber system cover", coverType: "gradient", coverValue: "warm-gradient" },
  { label: "Fireplace", detail: "Scene cover from Ambient fireplace", coverType: "scene", coverValue: "fireplace" },
  { label: "Forest", detail: "Calm green scene cover", coverType: "scene", coverValue: "forest" },
  { label: "Rain", detail: "Rain window scene cover", coverType: "scene", coverValue: "rain" },
  { label: "Album Collage", detail: "Use playlist track artwork", coverType: "collage", coverValue: "album-collage" },
  { label: "Custom", detail: "Custom uploads are a later device flow", coverType: "custom", coverValue: "custom", disabled: true }
];

const addSources: Array<{ id: AddSourceId; label: string; detail: string }> = [
  { id: "local", label: "Local Library", detail: "Manifest-backed local tracks" },
  { id: "favorites", label: "Favorites", detail: "Tracks marked as favorites" },
  { id: "queue", label: "Current Queue", detail: "Current playback queue when paths can be matched" },
  { id: "recent", label: "Recently Played", detail: "No history source yet" },
  { id: "radio", label: "Radio History", detail: "No station history source yet" },
  { id: "ai", label: "AI Generated Tracks", detail: "No generated track source yet" }
];

const TRACKPAD_SWIPE_THRESHOLD = 72;
const TRACKPAD_SWIPE_RESET_MS = 260;

const emptyDraft: PlaylistDraft = {
  name: "Untitled Playlist",
  moodTags: ["Focus"],
  coverType: "gradient",
  coverValue: "focus",
  trackPaths: [],
  step: 1
};

const initialUiState: PlaylistUiState = {
  mode: "browse",
  selectedPlaylistId: null,
  searchQuery: "",
  swipePlaylistId: null,
  swipeTrackKey: null,
  addSource: "local",
  addQuery: "",
  pendingAddPaths: [],
  reorderPaths: [],
  removePaths: [],
  renameDraft: "",
  coverDraft: {
    coverType: "gradient",
    coverValue: "focus"
  },
  draft: emptyDraft,
  createdPlaylistId: null,
  toast: null
};

function moveArrayItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= items.length) return items;
  const boundedToIndex = Math.max(0, Math.min(items.length - 1, toIndex));
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  next.splice(boundedToIndex, 0, item);
  return next;
}

function playlistUiReducer(state: PlaylistUiState, action: PlaylistUiAction): PlaylistUiState {
  switch (action.type) {
    case "PLAYLISTS_REFRESHED":
      return {
        ...state,
        selectedPlaylistId: state.selectedPlaylistId && action.playlists.some((playlist) => playlist.id === state.selectedPlaylistId)
          ? state.selectedPlaylistId
          : null
      };
    case "SELECT_PLAYLIST":
      return {
        ...state,
        mode: "actions",
        selectedPlaylistId: action.playlistId,
        swipePlaylistId: null,
        swipeTrackKey: null,
        pendingAddPaths: [],
        removePaths: []
      };
    case "SET_SEARCH":
      return { ...state, searchQuery: action.value };
    case "SET_SWIPE":
      return {
        ...state,
        swipePlaylistId: action.kind === "playlist" ? action.id : state.swipePlaylistId,
        swipeTrackKey: action.kind === "track" ? action.id : state.swipeTrackKey
      };
    case "OPEN_CREATE":
      return {
        ...state,
        mode: "create",
        draft: { ...emptyDraft, trackPaths: [] },
        pendingAddPaths: [],
        createdPlaylistId: null,
        toast: null
      };
    case "SET_CREATE_STEP":
      return { ...state, draft: { ...state.draft, step: action.step } };
    case "PATCH_DRAFT":
      return { ...state, draft: { ...state.draft, ...action.draft } };
    case "TOGGLE_DRAFT_TRACK": {
      const exists = state.draft.trackPaths.includes(action.trackPath);
      return {
        ...state,
        draft: {
          ...state.draft,
          trackPaths: exists
            ? state.draft.trackPaths.filter((path) => path !== action.trackPath)
            : [...state.draft.trackPaths, action.trackPath]
        }
      };
    }
    case "OPEN_ACTIONS":
      return {
        ...state,
        mode: state.selectedPlaylistId ? "actions" : "browse",
        pendingAddPaths: [],
        removePaths: [],
        swipePlaylistId: null,
        swipeTrackKey: null
      };
    case "OPEN_ADD_SONGS":
      return { ...state, mode: "addSongs", addSource: "local", addQuery: "", pendingAddPaths: [] };
    case "SET_ADD_SOURCE":
      return { ...state, addSource: action.source, pendingAddPaths: [], addQuery: "" };
    case "SET_ADD_QUERY":
      return { ...state, addQuery: action.value };
    case "TOGGLE_PENDING_ADD": {
      const exists = state.pendingAddPaths.includes(action.trackPath);
      return {
        ...state,
        pendingAddPaths: exists
          ? state.pendingAddPaths.filter((path) => path !== action.trackPath)
          : [...state.pendingAddPaths, action.trackPath]
      };
    }
    case "OPEN_REORDER":
      return { ...state, mode: "reorderSongs", reorderPaths: action.trackPaths, toast: null };
    case "MOVE_REORDER_PATH":
      return { ...state, reorderPaths: moveArrayItem(state.reorderPaths, action.fromIndex, action.toIndex) };
    case "OPEN_REMOVE":
      return { ...state, mode: "removeSongs", removePaths: [], swipeTrackKey: null };
    case "TOGGLE_REMOVE": {
      const exists = state.removePaths.includes(action.trackPath);
      return {
        ...state,
        removePaths: exists
          ? state.removePaths.filter((path) => path !== action.trackPath)
          : [...state.removePaths, action.trackPath]
      };
    }
    case "OPEN_RENAME":
      return { ...state, mode: "rename", renameDraft: action.name };
    case "SET_RENAME":
      return { ...state, renameDraft: action.value };
    case "OPEN_COVER":
      return { ...state, mode: "changeCover", coverDraft: { coverType: action.coverType, coverValue: action.coverValue } };
    case "SET_COVER":
      return { ...state, coverDraft: { coverType: action.coverType, coverValue: action.coverValue } };
    case "OPEN_CONFIRM_DELETE":
      return { ...state, mode: "confirmDelete" };
    case "CREATED":
      return {
        ...state,
        mode: "created",
        selectedPlaylistId: action.playlistId,
        createdPlaylistId: action.playlistId,
        pendingAddPaths: [],
        toast: "Playlist created."
      };
    case "SET_TOAST":
      return { ...state, toast: action.value };
    default:
      return state;
  }
}

function formatPlaylistDuration(seconds: number | null) {
  return typeof seconds === "number" ? formatDuration(seconds) : "--:--";
}

function playlistTrackPaths(playlist: AudioPlaylistSummary | null): string[] {
  return playlist?.tracks.map((track) => track.path).filter((path): path is string => Boolean(path)) ?? [];
}

function trackKey(track: Pick<AudioPlaylistTrackSummary, "id" | "path" | "position">, index: number) {
  return track.path ?? `${track.id}-${track.position}-${index}`;
}

function rowTrackKey(track: AudioPlaylistTrackSummary | AudioLibraryTrackSummary, index: number) {
  return "position" in track && typeof track.position === "number"
    ? trackKey(track, index)
    : track.path ?? `${track.id}-${index}`;
}

function trackMatchesQuery(track: Pick<AudioLibraryTrackSummary, "title" | "artist" | "album">, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [track.title, track.artist, track.album].some((value) => value.toLowerCase().includes(normalized));
}

function playlistMatchesQuery(playlist: AudioPlaylistSummary, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [
    playlist.name,
    playlist.description ?? "",
    playlist.source,
    ...playlist.moodTags,
    ...playlist.tracks.flatMap((track) => [track.title, track.artist, track.album])
  ].some((value) => value.toLowerCase().includes(normalized));
}

function buildQueueTracks(playback: PlaybackSummary, libraryTracks: AudioLibraryTrackSummary[]): AudioLibraryTrackSummary[] {
  return playback.queuePreview.map((entry) => {
    const matchedLocalTrack = libraryTracks.find((track) => (
      track.path
      && track.title === entry.title
      && track.artist === entry.artist
    ));
    if (matchedLocalTrack) {
      return { ...matchedLocalTrack, active: entry.active };
    }

    return {
      id: `queue-${entry.id}`,
      title: entry.title,
      artist: entry.artist,
      album: entry.album || "Current Queue",
      storage: "nas",
      categoryId: "nas",
      subCategory: entry.active ? "Now Playing" : "Queue",
      durationSeconds: entry.durationSeconds,
      path: null,
      albumArtUrl: null,
      albumArtLabel: null,
      albumArtScope: null,
      active: entry.active,
      favorite: false
    };
  });
}

export function PlaylistOverlay({
  active,
  playback,
  status,
  onPlaybackRefresh,
  onReturnAmbient
}: PlaylistOverlayProps) {
  const overlayReturnGesture = useOverlayReturnGesture(onReturnAmbient);
  const [ui, dispatch] = useReducer(playlistUiReducer, initialUiState);
  const [playlists, setPlaylists] = useState<AudioPlaylistSummary[]>([]);
  const [playlistLoading, setPlaylistLoading] = useState(false);
  const [playlistError, setPlaylistError] = useState<string | null>(null);
  const [playlistBusy, setPlaylistBusy] = useState(false);
  const [libraryTracks, setLibraryTracks] = useState<AudioLibraryTrackSummary[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [draggingTrackPath, setDraggingTrackPath] = useState<string | null>(null);
  const [reorderDropTargetIndex, setReorderDropTargetIndex] = useState<number | null>(null);
  const swipeStartRef = useRef<{ kind: SwipeKind; id: string; x: number; y: number } | null>(null);
  const suppressedClickRef = useRef(false);
  const playlistLongPressRef = useRef<number | null>(null);
  const trackpadSwipeRef = useRef<{ kind: SwipeKind; id: string; deltaX: number } | null>(null);
  const trackpadSwipeResetRef = useRef<number | null>(null);
  const reorderPressRef = useRef<number | null>(null);
  const reorderDragPathRef = useRef<string | null>(null);
  const nativeReorderCleanupRef = useRef<(() => void) | null>(null);

  const selectedPlaylist = playlists.find((playlist) => playlist.id === ui.selectedPlaylistId) ?? null;
  const editable = Boolean(selectedPlaylist && !selectedPlaylist.readOnly);
  const selectedPlaylistPathSet = useMemo(() => new Set(playlistTrackPaths(selectedPlaylist)), [selectedPlaylist]);
  const queueTracks = useMemo(() => buildQueueTracks(playback, libraryTracks), [libraryTracks, playback]);
  const visibleLeftTracks = selectedPlaylist?.tracks ?? queueTracks;
  const layoutFocus = useMemo<PlaylistLayoutFocus>(() => {
    if (ui.searchQuery.trim()) return "library";
    if (ui.mode === "actions" || ui.mode === "create" || ui.mode === "addSongs" || ui.mode === "reorderSongs" || ui.mode === "removeSongs" || ui.mode === "rename" || ui.mode === "changeCover" || ui.mode === "confirmDelete" || ui.mode === "created") return "actions";
    if (ui.mode === "browse" || !selectedPlaylist) return "library";
    return "current";
  }, [selectedPlaylist, ui.mode, ui.searchQuery]);
  const leftTitle = selectedPlaylist ? "Current Playlist" : "Current Queue";
  const leftSubtitle = selectedPlaylist
    ? `${selectedPlaylist.name} - ${selectedPlaylist.trackCount} songs - ${formatPlaylistDuration(selectedPlaylist.durationSeconds)}`
    : `${playback.queueLength} queued - ${playback.source.toUpperCase()}`;

  const filteredPlaylists = useMemo(() => (
    playlists.filter((playlist) => playlistMatchesQuery(playlist, ui.searchQuery))
  ), [playlists, ui.searchQuery]);

  const myPlaylists = filteredPlaylists.filter((playlist) => playlist.source === "user");
  const scenePlaylists = filteredPlaylists.filter((playlist) => (
    playlist.source === "curated"
    && playlist.moodTags.some((tag) => ["Fireplace", "Calm", "Sleep"].includes(tag))
  ));
  const scenePlaylistIds = new Set(scenePlaylists.map((playlist) => playlist.id));
  const curatedPlaylists = filteredPlaylists.filter((playlist) => playlist.source === "curated" && !scenePlaylistIds.has(playlist.id));

  const favoriteTracks = useMemo(() => libraryTracks.filter((track) => track.favorite && track.path), [libraryTracks]);
  const localTracks = useMemo(() => libraryTracks.filter((track) => track.storage === "local" && track.path), [libraryTracks]);
  const queueAddableTracks = useMemo(() => queueTracks.filter((track) => track.path), [queueTracks]);

  const addSourceTracks = useMemo(() => {
    switch (ui.addSource) {
      case "favorites":
        return favoriteTracks;
      case "queue":
        return queueAddableTracks;
      case "local":
        return localTracks;
      default:
        return [];
    }
  }, [favoriteTracks, localTracks, queueAddableTracks, ui.addSource]);

  const addableTracks = useMemo(() => (
    addSourceTracks
      .filter((track) => track.path && !selectedPlaylistPathSet.has(track.path))
      .filter((track) => trackMatchesQuery(track, ui.addQuery))
      .slice(0, 120)
  ), [addSourceTracks, selectedPlaylistPathSet, ui.addQuery]);

  const draftAddableTracks = useMemo(() => (
    localTracks
      .filter((track) => track.path)
      .filter((track) => trackMatchesQuery(track, ui.addQuery))
      .slice(0, 80)
  ), [localTracks, ui.addQuery, ui.draft.trackPaths]);

  const reorderTracks = useMemo(() => {
    if (!selectedPlaylist) return [];
    const tracksByPath = new Map(selectedPlaylist.tracks.map((track) => [track.path, track]));
    return ui.reorderPaths.map((path) => tracksByPath.get(path)).filter((track): track is AudioPlaylistTrackSummary => Boolean(track));
  }, [selectedPlaylist, ui.reorderPaths]);

  const refreshPlaylists = useCallback((signal?: AbortSignal) => {
    const controller = new AbortController();
    const requestSignal = signal ?? controller.signal;
    setPlaylistLoading(true);
    setPlaylistError(null);

    void fetchAudioPlaylists(requestSignal)
      .then((payload) => {
        setPlaylists(payload.playlists);
        dispatch({ type: "PLAYLISTS_REFRESHED", playlists: payload.playlists });
      })
      .catch((error) => {
        if (requestSignal.aborted) return;
        setPlaylistError(error instanceof Error ? error.message : "Playlists are not available");
      })
      .finally(() => {
        if (!requestSignal.aborted) setPlaylistLoading(false);
      });

    return controller;
  }, []);

  const refreshLibrary = useCallback((signal?: AbortSignal) => {
    const controller = new AbortController();
    const requestSignal = signal ?? controller.signal;
    setLibraryLoading(true);
    setLibraryError(null);

    void fetchAudioLibrary({ storage: "all", limit: 500 }, requestSignal)
      .then((library) => {
        setLibraryTracks(library.tracks);
      })
      .catch((error) => {
        if (requestSignal.aborted) return;
        setLibraryError(error instanceof Error ? error.message : "Music library is not available");
      })
      .finally(() => {
        if (!requestSignal.aborted) setLibraryLoading(false);
      });

    return controller;
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    const playlistController = new AbortController();
    const libraryController = new AbortController();
    refreshPlaylists(playlistController.signal);
    refreshLibrary(libraryController.signal);
    return () => {
      playlistController.abort();
      libraryController.abort();
    };
  }, [active, refreshLibrary, refreshPlaylists]);

  useEffect(() => {
    if (!ui.toast) return undefined;
    const timeout = window.setTimeout(() => dispatch({ type: "SET_TOAST", value: null }), 2600);
    return () => window.clearTimeout(timeout);
  }, [ui.toast]);

  const applyPlaylistPayload = useCallback((payload: { playlists: AudioPlaylistSummary[] }) => {
    setPlaylists(payload.playlists);
    dispatch({ type: "PLAYLISTS_REFRESHED", playlists: payload.playlists });
    return payload.playlists;
  }, []);

  async function handlePlaylistActionForPlaylist(
    targetPlaylist: AudioPlaylistSummary | null,
    action: Omit<AudioPlaylistActionRequest, "playlistId">,
    options: { toast?: string; selectNew?: boolean } = {}
  ) {
    if (!targetPlaylist || playlistBusy) return null;
    setPlaylistBusy(true);
    setPlaylistError(null);
    const previousIds = new Set(playlists.map((playlist) => playlist.id));

    try {
      const payload = await sendAudioPlaylistAction({
        playlistId: targetPlaylist.id,
        ...action
      });
      const nextPlaylists = applyPlaylistPayload(payload);
      if (options.selectNew) {
        const newPlaylist = nextPlaylists.find((playlist) => !previousIds.has(playlist.id)) ?? null;
        if (newPlaylist) dispatch({ type: "SELECT_PLAYLIST", playlistId: newPlaylist.id });
      }
      if (action.type === "delete") {
        dispatch({ type: "SET_TOAST", value: options.toast ?? "Playlist deleted." });
      } else if (action.type === "play") {
        dispatch({ type: "SET_TOAST", value: options.toast ?? "Playlist loaded." });
        await onPlaybackRefresh();
      } else {
        dispatch({ type: "SET_TOAST", value: options.toast ?? "Playlist updated." });
      }
      return nextPlaylists;
    } catch (error) {
      setPlaylistError(error instanceof Error ? error.message : "Playlist action failed");
      return null;
    } finally {
      setPlaylistBusy(false);
    }
  }

  async function handlePlaylistAction(action: Omit<AudioPlaylistActionRequest, "playlistId">, options: { toast?: string; selectNew?: boolean } = {}) {
    return await handlePlaylistActionForPlaylist(selectedPlaylist, action, options);
  }

  async function handleCreatePlaylist() {
    const name = ui.draft.name.trim();
    if (playlistBusy || !name) return;
    setPlaylistBusy(true);
    setPlaylistError(null);

    try {
      const previousIds = new Set(playlists.map((playlist) => playlist.id));
      const payload = await createAudioPlaylist({
        name,
        moodTags: ui.draft.moodTags,
        coverType: ui.draft.coverType,
        coverValue: ui.draft.coverValue,
        trackPaths: ui.draft.trackPaths
      });
      const nextPlaylists = applyPlaylistPayload(payload);
      const createdPlaylist = nextPlaylists.find((playlist) => !previousIds.has(playlist.id)) ?? null;
      dispatch({ type: "CREATED", playlistId: createdPlaylist?.id ?? null });
    } catch (error) {
      setPlaylistError(error instanceof Error ? error.message : "Playlist creation failed");
    } finally {
      setPlaylistBusy(false);
    }
  }

  function suppressNextClick() {
    suppressedClickRef.current = true;
    window.setTimeout(() => {
      suppressedClickRef.current = false;
    }, 120);
  }

  function consumeSuppressedClick() {
    if (!suppressedClickRef.current) return false;
    suppressedClickRef.current = false;
    return true;
  }

  function clearPlaylistLongPress() {
    if (playlistLongPressRef.current !== null) {
      window.clearTimeout(playlistLongPressRef.current);
      playlistLongPressRef.current = null;
    }
  }

  function clearTrackpadSwipeReset() {
    if (trackpadSwipeResetRef.current !== null) {
      window.clearTimeout(trackpadSwipeResetRef.current);
      trackpadSwipeResetRef.current = null;
    }
  }

  function resetTrackpadSwipeSoon() {
    clearTrackpadSwipeReset();
    trackpadSwipeResetRef.current = window.setTimeout(() => {
      trackpadSwipeRef.current = null;
      trackpadSwipeResetRef.current = null;
    }, TRACKPAD_SWIPE_RESET_MS);
  }

  function handleTrackpadSwipe(kind: SwipeKind, id: string, event: ReactWheelEvent<HTMLElement>) {
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY) || Math.abs(event.deltaX) < 4) return;

    event.preventDefault();
    event.stopPropagation();
    clearPlaylistLongPress();

    const current = trackpadSwipeRef.current;
    const deltaX = current && current.kind === kind && current.id === id
      ? current.deltaX + event.deltaX
      : event.deltaX;
    trackpadSwipeRef.current = { kind, id, deltaX };
    resetTrackpadSwipeSoon();

    if (deltaX < -TRACKPAD_SWIPE_THRESHOLD) {
      dispatch({ type: "SET_SWIPE", kind, id });
      suppressNextClick();
      trackpadSwipeRef.current = null;
      clearTrackpadSwipeReset();
    }
  }

  function beginSwipe(kind: SwipeKind, id: string, event: ReactPointerEvent<HTMLElement>) {
    swipeStartRef.current = { kind, id, x: event.clientX, y: event.clientY };
  }

  function endSwipe(kind: SwipeKind, id: string, event: ReactPointerEvent<HTMLElement>) {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start || start.kind !== kind || start.id !== id) return false;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (deltaX < -58 && Math.abs(deltaY) < 44) {
      dispatch({ type: "SET_SWIPE", kind, id });
      suppressNextClick();
      return true;
    }
    return false;
  }

  function beginPlaylistPress(playlist: AudioPlaylistSummary, event: ReactPointerEvent<HTMLElement>) {
    beginSwipe("playlist", playlist.id, event);
    clearPlaylistLongPress();
    playlistLongPressRef.current = window.setTimeout(() => {
      dispatch({ type: "SELECT_PLAYLIST", playlistId: playlist.id });
      dispatch({ type: "SET_SWIPE", kind: "playlist", id: playlist.id });
      suppressNextClick();
    }, 550);
  }

  function movePlaylistPress(event: ReactPointerEvent<HTMLElement>) {
    const start = swipeStartRef.current;
    if (!start || start.kind !== "playlist") return;
    if (Math.abs(event.clientX - start.x) > 14 || Math.abs(event.clientY - start.y) > 14) {
      clearPlaylistLongPress();
    }
  }

  function endPlaylistPress(playlistId: string, event: ReactPointerEvent<HTMLElement>) {
    clearPlaylistLongPress();
    endSwipe("playlist", playlistId, event);
  }

  function clearReorderTimer() {
    if (reorderPressRef.current !== null) {
      window.clearTimeout(reorderPressRef.current);
      reorderPressRef.current = null;
    }
  }

  function clearNativeReorderListeners() {
    nativeReorderCleanupRef.current?.();
    nativeReorderCleanupRef.current = null;
  }

  function scheduleReorderDrag(trackPath: string | null) {
    if (!trackPath) return;
    clearReorderTimer();
    reorderDragPathRef.current = trackPath;
    reorderPressRef.current = window.setTimeout(() => {
      setDraggingTrackPath(trackPath);
    }, 500);
  }

  function startReorderPointer(trackPath: string | null, event: ReactPointerEvent<HTMLElement>) {
    scheduleReorderDrag(trackPath);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function startReorderMouse(trackPath: string | null) {
    scheduleReorderDrag(trackPath);
    clearNativeReorderListeners();
    const handleMouseMove = (event: MouseEvent) => moveReorderAt(event.clientX, event.clientY);
    const handleMouseUp = (event: MouseEvent) => stopReorderAt(event.clientX, event.clientY);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp, { once: true });
    nativeReorderCleanupRef.current = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }

  function moveReorderAt(clientX: number, clientY: number) {
    const dragPath = reorderDragPathRef.current;
    if (!dragPath) return;
    const target = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-reorder-index]");
    if (!target) return;
    const targetIndex = Number(target.dataset.reorderIndex);
    const fromIndex = ui.reorderPaths.indexOf(dragPath);
    if (!Number.isInteger(targetIndex) || fromIndex === -1 || fromIndex === targetIndex) return;
    setReorderDropTargetIndex(targetIndex);
    dispatch({ type: "MOVE_REORDER_PATH", fromIndex, toIndex: targetIndex });
  }

  function moveReorderPointer(event: ReactPointerEvent<HTMLElement>) {
    moveReorderAt(event.clientX, event.clientY);
  }

  function moveReorderMouse(event: ReactMouseEvent<HTMLElement>) {
    moveReorderAt(event.clientX, event.clientY);
  }

  function stopReorderAt(clientX?: number, clientY?: number) {
    if (typeof clientX === "number" && typeof clientY === "number") moveReorderAt(clientX, clientY);
    clearNativeReorderListeners();
    clearReorderTimer();
    reorderDragPathRef.current = null;
    setDraggingTrackPath(null);
    setReorderDropTargetIndex(null);
  }

  function stopReorderPointer(event?: ReactPointerEvent<HTMLElement> | ReactMouseEvent<HTMLElement>) {
    stopReorderAt(event?.clientX, event?.clientY);
  }

  function renderErrorAndHint() {
    return (
      <>
        {playlistError ? <p className="playlist-feedback is-error">{playlistError}</p> : null}
        {!playlistError && libraryError ? <p className="playlist-feedback is-error">{libraryError}</p> : null}
        {!playlistError && !libraryError && ui.toast ? <p className="playlist-feedback">{ui.toast}</p> : null}
      </>
    );
  }

  function renderTrackRow(track: AudioPlaylistTrackSummary | AudioLibraryTrackSummary, index: number, options: {
    selectable?: boolean;
    selected?: boolean;
    active?: boolean;
    disabled?: boolean;
    onClick?: () => void;
    action?: ReactNode;
    swipeActions?: ReactNode;
  } = {}) {
    const key = rowTrackKey(track, index);
    const swipeOpen = Boolean(options.swipeActions);
    return (
      <div
        className={`playlist-song-row-wrap ${swipeOpen ? "has-actions" : ""}`}
        key={key}
        data-track-row={key}
        onWheel={(event) => handleTrackpadSwipe("track", key, event)}
      >
        <button
          className={`playlist-song-row ${options.active ? "is-playing" : ""} ${options.selected ? "is-selected" : ""}`}
          type="button"
          disabled={options.disabled}
          data-gesture-control
          onClick={(event) => {
            if (consumeSuppressedClick()) {
              event.preventDefault();
              return;
            }
            options.onClick?.();
          }}
          onPointerDown={(event) => beginSwipe("track", key, event)}
          onPointerUp={(event) => endSwipe("track", key, event)}
        >
          <span className="playlist-song-art">{options.active ? <Play size={19} fill="currentColor" /> : String(index + 1).padStart(2, "0")}</span>
          <span className="playlist-song-copy">
            <strong>{track.title}</strong>
            <em>{track.artist} / {track.album}</em>
          </span>
          <span className="playlist-song-duration">{formatPlaylistDuration(track.durationSeconds)}</span>
          {options.action ? <span className="playlist-song-action">{options.action}</span> : null}
        </button>
        {swipeOpen ? <div className="playlist-song-swipe-actions">{options.swipeActions}</div> : null}
      </div>
    );
  }

  function renderPlaylistCard(playlist: AudioPlaylistSummary) {
    const selected = playlist.id === selectedPlaylist?.id;
    const swipeOpen = ui.swipePlaylistId === playlist.id;
    return (
      <article
        className={`playlist-card ${selected ? "is-selected" : ""} ${swipeOpen ? "has-actions" : ""}`}
        key={playlist.id}
        data-playlist-card={playlist.id}
        onPointerDown={(event) => beginPlaylistPress(playlist, event)}
        onPointerMove={movePlaylistPress}
        onPointerUp={(event) => endPlaylistPress(playlist.id, event)}
        onPointerCancel={clearPlaylistLongPress}
        onWheel={(event) => handleTrackpadSwipe("playlist", playlist.id, event)}
      >
        <button
          className="playlist-card-main"
          type="button"
          data-gesture-control
          onClick={(event) => {
            if (consumeSuppressedClick()) {
              event.preventDefault();
              return;
            }
            dispatch({ type: "SELECT_PLAYLIST", playlistId: playlist.id });
          }}
        >
          <span className={`playlist-cover-token is-${playlist.coverType}`}>
            {playlist.coverType === "collage" ? <Layers size={22} /> : playlist.coverType === "scene" ? <Image size={22} /> : <ListMusic size={22} />}
          </span>
          <span className="playlist-card-copy">
            <strong>{playlist.name}</strong>
            <em>{playlist.trackCount} songs / {formatPlaylistDuration(playlist.durationSeconds)}</em>
            <span>{playlist.moodTags.join(" / ") || (playlist.source === "curated" ? "Curated" : "User")}</span>
          </span>
        </button>
        <button
          className="playlist-touch-icon is-primary"
          type="button"
          aria-label={`Play ${playlist.name}`}
          disabled={playlistBusy || status.pending || playlist.trackCount === 0}
          data-gesture-control
          onClick={() => {
            dispatch({ type: "SELECT_PLAYLIST", playlistId: playlist.id });
            void handlePlaylistActionForPlaylist(playlist, { type: "play" }, { toast: "Playlist loaded." });
          }}
        >
          <Play size={20} fill="currentColor" />
        </button>
        {swipeOpen ? (
          <div className="playlist-card-swipe-actions">
            <button
              type="button"
              data-gesture-control
              onClick={() => {
                dispatch({ type: "SELECT_PLAYLIST", playlistId: playlist.id });
                dispatch({ type: "OPEN_RENAME", name: playlist.name });
              }}
              disabled={playlist.readOnly}
            >
              <Pencil size={18} />
              <span>Edit</span>
            </button>
            <button type="button" data-gesture-control onClick={() => void handlePlaylistActionForPlaylist(playlist, { type: "duplicate" }, { toast: "Playlist duplicated.", selectNew: true })}>
              <Copy size={18} />
              <span>Duplicate</span>
            </button>
            <button
              type="button"
              data-gesture-control
              className="is-danger"
              onClick={() => {
                dispatch({ type: "SELECT_PLAYLIST", playlistId: playlist.id });
                dispatch({ type: "OPEN_CONFIRM_DELETE" });
              }}
              disabled={playlist.readOnly}
            >
              <Trash2 size={18} />
              <span>Delete</span>
            </button>
          </div>
        ) : null}
      </article>
    );
  }

  function renderPlaylistGroup(label: string, items: AudioPlaylistSummary[]) {
    if (items.length === 0) return null;
    return (
      <section className="playlist-group" aria-label={label}>
        <div className="playlist-group-title">
          <span>{label}</span>
          <b>{items.length}</b>
        </div>
        {items.map(renderPlaylistCard)}
      </section>
    );
  }

  function renderCurrentTrackSwipeActions(track: AudioPlaylistTrackSummary | AudioLibraryTrackSummary) {
    if (!selectedPlaylist) return null;
    const trackPath = track.path;
    return (
      <>
        <button
          type="button"
          className="is-danger"
          disabled={!editable || !trackPath || playlistBusy}
          data-gesture-control
          onClick={() => {
            if (!editable || !trackPath) return;
            void handlePlaylistAction({ type: "remove_track", trackPath }, { toast: "Song removed." })
              .then((result) => {
                if (result) dispatch({ type: "SET_SWIPE", kind: "track", id: null });
              });
          }}
        >
          <Trash2 size={18} />
          <span>Remove</span>
        </button>
        <button
          type="button"
          data-gesture-control
          onClick={() => {
            dispatch({ type: "SET_SWIPE", kind: "track", id: null });
            if (editable) {
              dispatch({ type: "OPEN_REMOVE" });
            } else {
              dispatch({ type: "SET_TOAST", value: "Duplicate this curated playlist before editing." });
              dispatch({ type: "OPEN_ACTIONS" });
            }
          }}
        >
          <MoreHorizontal size={18} />
          <span>More</span>
        </button>
      </>
    );
  }

  function renderCreatePanel() {
    const nameIsValid = ui.draft.name.trim().length > 0 && ui.draft.name.trim().length <= 40;
    return (
      <div className="playlist-task-panel" data-playlist-mode="create">
        <div className="playlist-task-header">
          <button className="playlist-touch-icon" type="button" aria-label="Back" onClick={() => dispatch({ type: "OPEN_ACTIONS" })}>
            <ChevronLeft size={21} />
          </button>
          <div>
            <span className="source-panel-kicker">Create Playlist</span>
            <strong>Step {ui.draft.step} of 3</strong>
          </div>
        </div>

        {ui.draft.step === 1 ? (
          <div className="playlist-task-body">
            <label className="playlist-field">
              <span>Playlist name</span>
              <input
                value={ui.draft.name}
                maxLength={40}
                data-gesture-control
                onChange={(event) => dispatch({ type: "PATCH_DRAFT", draft: { name: event.currentTarget.value } })}
              />
            </label>
            <div className="playlist-chip-grid">
              {quickTemplates.map((template) => (
                <button
                  key={template.label}
                  type="button"
                  data-gesture-control
                  onClick={() => dispatch({
                    type: "PATCH_DRAFT",
                    draft: {
                      name: template.name,
                      moodTags: [template.mood],
                      coverType: template.mood === "Fireplace" ? "scene" : "gradient",
                      coverValue: template.cover
                    }
                  })}
                >
                  {template.label}
                </button>
              ))}
            </div>
            <button className="playlist-primary-button" type="button" disabled={!nameIsValid} data-gesture-control onClick={() => dispatch({ type: "SET_CREATE_STEP", step: 2 })}>
              Next
            </button>
          </div>
        ) : null}

        {ui.draft.step === 2 ? (
          <div className="playlist-task-body">
            <div className="playlist-choice-grid">
              {moodOptions.map((mood) => {
                const activeMood = ui.draft.moodTags.includes(mood);
                return (
                  <button
                    className={activeMood ? "is-selected" : ""}
                    key={mood}
                    type="button"
                    data-gesture-control
                    onClick={() => dispatch({ type: "PATCH_DRAFT", draft: { moodTags: [mood], coverValue: mood.toLowerCase() } })}
                  >
                    <span>{mood}</span>
                  </button>
                );
              })}
            </div>
            <div className="playlist-task-footer">
              <button className="playlist-secondary-button" type="button" onClick={() => dispatch({ type: "SET_CREATE_STEP", step: 1 })}>Back</button>
              <button className="playlist-primary-button" type="button" onClick={() => dispatch({ type: "SET_CREATE_STEP", step: 3 })}>Next</button>
            </div>
          </div>
        ) : null}

        {ui.draft.step === 3 ? (
          <div className="playlist-task-body">
            <label className="playlist-field">
              <span>Search songs</span>
              <input
                value={ui.addQuery}
                placeholder="Search local library..."
                data-gesture-control
                onChange={(event) => dispatch({ type: "SET_ADD_QUERY", value: event.currentTarget.value })}
              />
            </label>
            <div className="playlist-task-list">
              {draftAddableTracks.map((track, index) => renderTrackRow(track, index, {
                selected: Boolean(track.path && ui.draft.trackPaths.includes(track.path)),
                action: <Plus size={18} />,
                onClick: () => track.path && dispatch({ type: "TOGGLE_DRAFT_TRACK", trackPath: track.path })
              }))}
              {draftAddableTracks.length === 0 ? <p className="playlist-empty">No local tracks available.</p> : null}
            </div>
            <div className="playlist-task-footer">
              <button className="playlist-secondary-button" type="button" onClick={() => dispatch({ type: "SET_CREATE_STEP", step: 2 })}>Back</button>
              <button className="playlist-primary-button" type="button" disabled={playlistBusy || !nameIsValid} onClick={() => void handleCreatePlaylist()}>
                {playlistBusy ? <LoaderCircle size={18} className="is-spinning" /> : <Check size={18} />}
                <span>Create Playlist</span>
              </button>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  function renderAddSongsPanel() {
    const source = addSources.find((item) => item.id === ui.addSource) ?? addSources[0];
    return (
      <div className="playlist-task-panel" data-playlist-mode="addSongs">
        <div className="playlist-task-header">
          <button className="playlist-touch-icon" type="button" aria-label="Back" onClick={() => dispatch({ type: "OPEN_ACTIONS" })}>
            <ChevronLeft size={21} />
          </button>
          <div>
            <span className="source-panel-kicker">Add Songs</span>
            <strong>{selectedPlaylist?.name ?? "Playlist"}</strong>
          </div>
        </div>
        <label className="playlist-field">
          <span>Search songs</span>
          <input
            value={ui.addQuery}
            placeholder="Search songs..."
            data-gesture-control
            onChange={(event) => dispatch({ type: "SET_ADD_QUERY", value: event.currentTarget.value })}
          />
        </label>
        <div className="playlist-source-tabs">
          {addSources.map((item) => (
            <button
              className={item.id === ui.addSource ? "is-selected" : ""}
              key={item.id}
              type="button"
              data-gesture-control
              onClick={() => dispatch({ type: "SET_ADD_SOURCE", source: item.id })}
            >
              <span>{item.label}</span>
            </button>
          ))}
        </div>
        <div className="playlist-task-list">
          {addableTracks.map((track, index) => renderTrackRow(track, index, {
            selected: Boolean(track.path && ui.pendingAddPaths.includes(track.path)),
            action: track.path && ui.pendingAddPaths.includes(track.path) ? <Check size={18} /> : <Plus size={18} />,
            onClick: () => track.path && dispatch({ type: "TOGGLE_PENDING_ADD", trackPath: track.path })
          }))}
          {addableTracks.length === 0 ? (
            <p className="playlist-empty">{source.id === "recent" || source.id === "radio" || source.id === "ai" ? `${source.label} has no real data source yet.` : `No addable tracks from ${source.label}.`}</p>
          ) : null}
        </div>
        <div className="playlist-task-footer">
          <button className="playlist-secondary-button" type="button" onClick={() => dispatch({ type: "OPEN_ACTIONS" })}>Cancel</button>
          <button
            className="playlist-primary-button"
            type="button"
            disabled={!editable || playlistBusy || ui.pendingAddPaths.length === 0}
            onClick={() => {
              const nextPaths = [...playlistTrackPaths(selectedPlaylist), ...ui.pendingAddPaths];
              void handlePlaylistAction({ type: "replace_tracks", trackPaths: nextPaths }, { toast: `Added ${ui.pendingAddPaths.length} songs.` })
                .then((result) => {
                  if (result) dispatch({ type: "OPEN_ACTIONS" });
                });
            }}
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  function renderReorderPanel() {
    return (
      <div className="playlist-task-panel" data-playlist-mode="reorderSongs">
        <div className="playlist-task-header">
          <button className="playlist-touch-icon" type="button" aria-label="Back" onClick={() => dispatch({ type: "OPEN_ACTIONS" })}>
            <ChevronLeft size={21} />
          </button>
          <div>
            <span className="source-panel-kicker">Reorder Songs</span>
            <strong>{selectedPlaylist?.name ?? "Playlist"}</strong>
          </div>
        </div>
        <div className="playlist-task-list is-reorder">
          {reorderTracks.map((track, index) => (
            <article
              className={`playlist-reorder-row ${draggingTrackPath === track.path ? "is-dragging" : ""} ${reorderDropTargetIndex === index && draggingTrackPath !== track.path ? "is-drop-target" : ""}`}
              key={track.path ?? track.id}
              data-reorder-index={index}
              onPointerDown={(event) => startReorderPointer(track.path, event)}
              onPointerMove={moveReorderPointer}
              onPointerUp={(event) => stopReorderPointer(event)}
              onPointerCancel={() => stopReorderPointer()}
              onMouseDown={() => startReorderMouse(track.path)}
              onMouseMove={moveReorderMouse}
              onMouseUp={(event) => stopReorderPointer(event)}
              onMouseLeave={clearReorderTimer}
            >
              <GripVertical size={25} />
              <span>
                <strong>{track.title}</strong>
                <em>{track.artist}</em>
              </span>
            </article>
          ))}
          {reorderTracks.length === 0 ? <p className="playlist-empty">No songs to reorder.</p> : null}
        </div>
        <div className="playlist-task-footer">
          <button className="playlist-secondary-button" type="button" onClick={() => dispatch({ type: "OPEN_ACTIONS" })}>Cancel</button>
          <button
            className="playlist-primary-button"
            type="button"
            disabled={!editable || playlistBusy}
            onClick={() => {
              void handlePlaylistAction({ type: "replace_tracks", trackPaths: ui.reorderPaths }, { toast: "Order updated." })
                .then((result) => {
                  if (result) dispatch({ type: "OPEN_ACTIONS" });
                });
            }}
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  function renderRemovePanel() {
    return (
      <div className="playlist-task-panel" data-playlist-mode="removeSongs">
        <div className="playlist-task-header">
          <button className="playlist-touch-icon" type="button" aria-label="Back" onClick={() => dispatch({ type: "OPEN_ACTIONS" })}>
            <ChevronLeft size={21} />
          </button>
          <div>
            <span className="source-panel-kicker">Remove Songs</span>
            <strong>{selectedPlaylist?.name ?? "Playlist"}</strong>
          </div>
        </div>
        <div className="playlist-task-list">
          {selectedPlaylist?.tracks.map((track, index) => renderTrackRow(track, index, {
            selected: Boolean(track.path && ui.removePaths.includes(track.path)),
            disabled: !track.path,
            action: track.path && ui.removePaths.includes(track.path) ? <Check size={18} /> : null,
            onClick: () => track.path && dispatch({ type: "TOGGLE_REMOVE", trackPath: track.path })
          }))}
          {selectedPlaylist?.tracks.length === 0 ? <p className="playlist-empty">No songs to remove.</p> : null}
        </div>
        <div className="playlist-task-footer">
          <span className="playlist-selection-count">{ui.removePaths.length} selected</span>
          <button className="playlist-secondary-button" type="button" onClick={() => dispatch({ type: "OPEN_ACTIONS" })}>Cancel</button>
          <button
            className="playlist-danger-button"
            type="button"
            disabled={!editable || playlistBusy || ui.removePaths.length === 0}
            onClick={() => {
              const removeSet = new Set(ui.removePaths);
              const nextPaths = playlistTrackPaths(selectedPlaylist).filter((path) => !removeSet.has(path));
              void handlePlaylistAction({ type: "replace_tracks", trackPaths: nextPaths }, { toast: `Removed ${ui.removePaths.length} songs.` })
                .then((result) => {
                  if (result) dispatch({ type: "OPEN_ACTIONS" });
                });
            }}
          >
            Remove Selected
          </button>
        </div>
      </div>
    );
  }

  function renderRenamePanel() {
    const valid = ui.renameDraft.trim().length > 0 && ui.renameDraft.trim().length <= 40;
    return (
      <div className="playlist-task-panel" data-playlist-mode="rename">
        <div className="playlist-task-header">
          <button className="playlist-touch-icon" type="button" aria-label="Back" onClick={() => dispatch({ type: "OPEN_ACTIONS" })}>
            <ChevronLeft size={21} />
          </button>
          <div>
            <span className="source-panel-kicker">Rename Playlist</span>
            <strong>{selectedPlaylist?.name ?? "Playlist"}</strong>
          </div>
        </div>
        <label className="playlist-field">
          <span>Playlist name</span>
          <input
            value={ui.renameDraft}
            maxLength={40}
            data-gesture-control
            onChange={(event) => dispatch({ type: "SET_RENAME", value: event.currentTarget.value })}
          />
        </label>
        <div className="playlist-task-footer">
          <button className="playlist-secondary-button" type="button" onClick={() => dispatch({ type: "OPEN_ACTIONS" })}>Cancel</button>
          <button
            className="playlist-primary-button"
            type="button"
            disabled={!editable || playlistBusy || !valid}
            onClick={() => {
              void handlePlaylistAction({ type: "update_metadata", name: ui.renameDraft.trim() }, { toast: "Playlist renamed." })
                .then((result) => {
                  if (result) dispatch({ type: "OPEN_ACTIONS" });
                });
            }}
          >
            Save
          </button>
        </div>
      </div>
    );
  }

  function renderCoverPanel() {
    return (
      <div className="playlist-task-panel" data-playlist-mode="changeCover">
        <div className="playlist-task-header">
          <button className="playlist-touch-icon" type="button" aria-label="Back" onClick={() => dispatch({ type: "OPEN_ACTIONS" })}>
            <ChevronLeft size={21} />
          </button>
          <div>
            <span className="source-panel-kicker">Change Cover</span>
            <strong>{selectedPlaylist?.name ?? "Playlist"}</strong>
          </div>
        </div>
        <div className="playlist-cover-grid">
          {coverChoices.map((choice) => {
            const selected = ui.coverDraft.coverType === choice.coverType && ui.coverDraft.coverValue === choice.coverValue;
            return (
              <button
                className={selected ? "is-selected" : ""}
                key={`${choice.coverType}-${choice.coverValue}`}
                type="button"
                disabled={choice.disabled}
                data-gesture-control
                onClick={() => dispatch({ type: "SET_COVER", coverType: choice.coverType, coverValue: choice.coverValue })}
              >
                <span className={`playlist-cover-token is-${choice.coverType}`}>
                  {choice.coverType === "collage" ? <Layers size={20} /> : <Image size={20} />}
                </span>
                <span>
                  <strong>{choice.label}</strong>
                  <em>{choice.detail}</em>
                </span>
              </button>
            );
          })}
        </div>
        <div className="playlist-task-footer">
          <button className="playlist-secondary-button" type="button" onClick={() => dispatch({ type: "OPEN_ACTIONS" })}>Cancel</button>
          <button
            className="playlist-primary-button"
            type="button"
            disabled={!editable || playlistBusy || ui.coverDraft.coverType === "custom"}
            onClick={() => {
              void handlePlaylistAction({
                type: "update_metadata",
                coverType: ui.coverDraft.coverType,
                coverValue: ui.coverDraft.coverValue
              }, { toast: "Cover updated." }).then((result) => {
                if (result) dispatch({ type: "OPEN_ACTIONS" });
              });
            }}
          >
            Save
          </button>
        </div>
      </div>
    );
  }

  function renderActionsPanel() {
    if (ui.mode === "create") return renderCreatePanel();
    if (ui.mode === "addSongs") return renderAddSongsPanel();
    if (ui.mode === "reorderSongs") return renderReorderPanel();
    if (ui.mode === "removeSongs") return renderRemovePanel();
    if (ui.mode === "rename") return renderRenamePanel();
    if (ui.mode === "changeCover") return renderCoverPanel();

    if (ui.mode === "created") {
      return (
        <div className="playlist-task-panel" data-playlist-mode="created">
          <div className="playlist-created-state">
            <Check size={34} />
            <span className="source-panel-kicker">Created</span>
            <strong>{selectedPlaylist?.name ?? "Playlist"}</strong>
            <button className="playlist-primary-button" type="button" disabled={!selectedPlaylist || playlistBusy} onClick={() => void handlePlaylistAction({ type: "play" })}>
              <Play size={18} fill="currentColor" />
              <span>Play Now</span>
            </button>
            <button className="playlist-secondary-button" type="button" onClick={() => dispatch({ type: "OPEN_ACTIONS" })}>Keep Editing</button>
          </div>
        </div>
      );
    }

    if (ui.mode === "confirmDelete") {
      return (
        <div className="playlist-task-panel" data-playlist-mode="confirmDelete">
          <div className="playlist-confirm-card">
            <Trash2 size={34} />
            <strong>Delete this playlist?</strong>
            <p>This action cannot be undone. Current playback will keep running from the already loaded queue.</p>
            <div className="playlist-task-footer">
              <button className="playlist-secondary-button" type="button" onClick={() => dispatch({ type: "OPEN_ACTIONS" })}>Cancel</button>
              <button
                className="playlist-danger-button"
                type="button"
                disabled={!editable || playlistBusy}
                onClick={() => {
                  void handlePlaylistAction({ type: "delete" }, { toast: "Playlist deleted." })
                    .then((result) => {
                      if (result) dispatch({ type: "OPEN_ACTIONS" });
                    });
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (!selectedPlaylist) {
      return (
        <div className="playlist-empty-actions" data-playlist-mode="browse">
          <ListMusic size={38} />
          <strong>Select a playlist</strong>
          <p>Tap a playlist to view songs. Swipe left to edit, duplicate, or delete. Or create a new playlist.</p>
          <button className="playlist-primary-button" type="button" data-gesture-control onClick={() => dispatch({ type: "OPEN_CREATE" })}>
            <Plus size={18} />
            <span>New Playlist</span>
          </button>
        </div>
      );
    }

    return (
      <div className="playlist-actions-stack" data-playlist-mode="actions">
        <div className="playlist-action-summary">
          <span className={`playlist-cover-token is-${selectedPlaylist.coverType}`}>
            {selectedPlaylist.coverType === "collage" ? <Layers size={25} /> : <Image size={25} />}
          </span>
          <div>
            <span className="source-panel-kicker">Playlist Actions</span>
            <strong>{selectedPlaylist.name}</strong>
            <p>{selectedPlaylist.trackCount} songs - {formatPlaylistDuration(selectedPlaylist.durationSeconds)}</p>
            <em>{selectedPlaylist.moodTags.join(" / ")}</em>
          </div>
        </div>
        <button className="playlist-primary-button" type="button" disabled={playlistBusy || selectedPlaylist.trackCount === 0} onClick={() => void handlePlaylistAction({ type: "play" })}>
          <Play size={19} fill="currentColor" />
          <span>Play Now</span>
        </button>
        <button className="playlist-action-button" type="button" disabled={!editable} onClick={() => dispatch({ type: "OPEN_ADD_SONGS" })}>
          <Plus size={19} />
          <span>Add Songs</span>
        </button>
        <button className="playlist-action-button" type="button" disabled={!editable || selectedPlaylist.trackCount < 2} onClick={() => dispatch({ type: "OPEN_REORDER", trackPaths: playlistTrackPaths(selectedPlaylist) })}>
          <GripVertical size={19} />
          <span>Reorder Songs</span>
        </button>
        <button className="playlist-action-button" type="button" disabled={!editable || selectedPlaylist.trackCount === 0} onClick={() => dispatch({ type: "OPEN_REMOVE" })}>
          <ListChecks size={19} />
          <span>Remove Songs</span>
        </button>
        <button className="playlist-action-button" type="button" disabled={!editable} onClick={() => dispatch({ type: "OPEN_RENAME", name: selectedPlaylist.name })}>
          <Pencil size={19} />
          <span>Rename</span>
        </button>
        <button className="playlist-action-button" type="button" disabled={!editable} onClick={() => dispatch({ type: "OPEN_COVER", coverType: selectedPlaylist.coverType, coverValue: selectedPlaylist.coverValue ?? "warm-gradient" })}>
          <Image size={19} />
          <span>Change Cover</span>
        </button>
        <button className="playlist-action-button" type="button" onClick={() => void handlePlaylistAction({ type: "duplicate" }, { toast: "Playlist duplicated.", selectNew: true })}>
          <Copy size={19} />
          <span>Duplicate</span>
        </button>
        <button className="playlist-action-button is-danger" type="button" disabled={!editable} onClick={() => dispatch({ type: "OPEN_CONFIRM_DELETE" })}>
          <Trash2 size={19} />
          <span>Delete Playlist</span>
        </button>
        {!editable ? <p className="playlist-empty">Curated playlists are read-only. Duplicate one to edit it.</p> : null}
      </div>
    );
  }

  return (
    <section className={`overlay playlist-overlay ${active ? "is-active" : ""}`} aria-label="Playlist Hub" aria-hidden={!active}>
      <button className="overlay-backdrop" type="button" tabIndex={active ? 0 : -1} aria-label="Return to ambient" onClick={onReturnAmbient} />
      <div className="playlist-shell" role="dialog" aria-modal="true" data-gesture-protected data-playlist-page {...overlayReturnGesture}>
        <header className="playlist-page-header">
          <div>
            <span className="source-panel-kicker">Playlist Hub</span>
            <strong>Music Lists</strong>
          </div>
          <label className="playlist-search-field">
            <Search size={19} aria-hidden="true" />
            <input
              value={ui.searchQuery}
              placeholder="Search playlists / songs..."
              aria-label="Search playlists and songs"
              data-gesture-control
              onChange={(event) => dispatch({ type: "SET_SEARCH", value: event.currentTarget.value })}
            />
          </label>
          <button className="playlist-touch-icon" type="button" aria-label="Close playlist" onClick={onReturnAmbient}>
            <X size={21} />
          </button>
        </header>

        {renderErrorAndHint()}

        <section className="playlist-hub-layout" data-layout-focus={layoutFocus}>
          <aside className="playlist-column playlist-current-panel" data-playlist-left aria-label="Current playlist">
            <div className="playlist-column-header">
              <div>
                <span className="source-panel-kicker">{leftTitle}</span>
                <strong>{selectedPlaylist?.name ?? playback.title ?? "Now Playing"}</strong>
                <p>{leftSubtitle}</p>
              </div>
              <Heart size={20} className={playback.favorite ? "is-favorite" : ""} />
            </div>
            <div className="playlist-song-list">
              {visibleLeftTracks.map((track, index) => {
                const rowKey = rowTrackKey(track, index);
                const swipeOpen = ui.swipeTrackKey === rowKey;
                const active = Boolean(track.active)
                  || (Boolean(selectedPlaylist) && playback.title === track.title && playback.artist === track.artist);
                return renderTrackRow(track, index, {
                  active,
                  action: swipeOpen
                    ? <MoreHorizontal size={18} />
                    : null,
                  swipeActions: swipeOpen ? renderCurrentTrackSwipeActions(track) : null,
                  onClick: () => {
                    if (selectedPlaylist && track.path) void handlePlaylistAction({ type: "play", startIndex: index });
                  }
                });
              })}
              {visibleLeftTracks.length === 0 ? (
                <p className="playlist-empty">No songs yet. Add songs from your library, current queue, or favorites.</p>
              ) : null}
            </div>
          </aside>

          <section className="playlist-column playlist-library-panel" data-playlist-library aria-label="Playlist library">
            <div className="playlist-column-header">
              <div>
                <span className="source-panel-kicker">Playlist Library</span>
                <strong>{playlistLoading ? "Loading playlists" : `${filteredPlaylists.length} playlists`}</strong>
                <p>{status.pending ? "Syncing" : status.source === "api" ? "API Confirmed" : "Fallback Data"}</p>
              </div>
              <button className="playlist-primary-button is-compact" type="button" data-gesture-control onClick={() => dispatch({ type: "OPEN_CREATE" })}>
                <Plus size={18} />
                <span>New Playlist</span>
              </button>
            </div>
            <div className="playlist-library-scroll">
              {ui.mode === "create" ? (
                <section className="playlist-group" aria-label="Draft Playlist">
                  <div className="playlist-group-title">
                    <span>Draft Playlist</span>
                    <b>{ui.draft.trackPaths.length}</b>
                  </div>
                  <article className="playlist-card is-draft">
                    <div className="playlist-card-main">
                      <span className={`playlist-cover-token is-${ui.draft.coverType}`}><ListMusic size={22} /></span>
                      <span className="playlist-card-copy">
                        <strong>{ui.draft.name}</strong>
                        <em>{ui.draft.trackPaths.length} selected songs</em>
                        <span>{ui.draft.moodTags.join(" / ")}</span>
                      </span>
                    </div>
                  </article>
                </section>
              ) : null}
              {renderPlaylistGroup("My Playlists", myPlaylists)}
              {renderPlaylistGroup("Scene Playlists", scenePlaylists)}
              {renderPlaylistGroup("Curated", curatedPlaylists)}
              {!playlistLoading && filteredPlaylists.length === 0 ? (
                <p className="playlist-empty">No results found. Try another keyword.</p>
              ) : null}
            </div>
          </section>

          <aside className="playlist-column playlist-actions-panel" data-playlist-actions aria-label="Playlist actions">
            {renderActionsPanel()}
          </aside>
        </section>
      </div>
    </section>
  );
}

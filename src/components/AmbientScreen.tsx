import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Bluetooth, Captions, CaptionsOff, Cast, GalleryHorizontalEnd, Globe2, Heart, LibraryBig, ListMusic, LoaderCircle, LogOut, Moon, Music2, Network, Pause, Play, Radio as RadioIcon, Repeat1, Settings, Shuffle, SkipBack, SkipForward, SlidersHorizontal, SunMedium, Target, Volume2, VolumeX, Waves } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { fetchBackgroundVideos, fetchSceneContext } from "../api/tikpalClient";
import { EqVisualScene, type HifiLyricsPanel } from "./EqVisualScene";
import { FlameScene } from "./FlameScene";
import { roomModeOptions } from "../roomExperienceTruth";
import { getSourceDisplayStatusLabel } from "../sourceStatus";
import type { TikpalDataStatus } from "../hooks/useTikpalState";
import type { AudioState, BackgroundVideoSummary, FontTheme, LyricsFontSize, LyricsState, PlaybackActionType, PlaybackMode, PlaybackSummary, RoomExperienceActionRequest, RoomExperienceState, RoomMode, SceneContextSummary, SceneDayPart, SourceSwitchTarget, SystemActionType, SystemState, TikpalState } from "../types";

interface AmbientScreenProps {
  hudVisible: boolean;
  timeLabel: string;
  dateLabel: string;
  playback: PlaybackSummary;
  lyrics: LyricsState;
  lyricsVisible: boolean;
  lyricsFontSize: LyricsFontSize;
  fontTheme: FontTheme;
  audio: AudioState;
  system: SystemState;
  status: TikpalDataStatus;
  sceneVideoEnabled: boolean;
  sceneVideoStableLoop: boolean;
  sceneSoundEnabled: boolean;
  sceneSoundPending: boolean;
  sourcePickerOpenRequest: number;
  clockVisible: boolean;
  onPlaybackAction: (type: PlaybackActionType, value?: number, mode?: PlaybackMode) => Promise<TikpalState>;
  onSystemAction: (type: SystemActionType, value?: number) => Promise<TikpalState>;
  onSourceSwitch: (target: SourceSwitchTarget) => Promise<TikpalState>;
  onOpenWebMode: () => Promise<void>;
  onSourcePickerOpenChange?: (open: boolean) => void;
  onHudActivity: () => void;
  onLyricsVisibleChange: (visible: boolean) => void;
  onCurrentSceneVideoChange: (video: BackgroundVideoSummary) => void;
  onSceneSoundEnabledChange: (enabled: boolean) => void;
  onOpenPlayer: () => void;
  onOpenSettings: () => void;
  roomExperience: RoomExperienceState;
  onExperienceAction: (action: RoomExperienceActionRequest) => Promise<RoomExperienceState>;
}

type AmbientAdjustChannel = "volume" | "brightness";
type AmbientMusicSourceTarget = Exclude<SourceSwitchTarget, "audio" | "scene">;
const BACKGROUND_VIDEO_REFRESH_MS = 30_000;
const BACKGROUND_VIDEO_REFRESH_EVENT = "tikpal:background-videos-refresh";
const SCENE_CONTEXT_REFRESH_MS = 30 * 60_000;
const SOURCE_PICKER_AUTO_CLOSE_MS = 5_000;
const SOURCE_PICKER_SCENE_AUDIO_RELEASE_MS = 150;
const ADJUST_COMMIT_DELAY_MS = 140;
const SCENE_VIDEO_THERMAL_PAUSE_C = 76;
const SCENE_VIDEO_THERMAL_RESUME_C = 68;
const LYRICS_CLOCK_TICK_MS = 250;
const LYRICS_CLOCK_REWIND_TOLERANCE_SECONDS = 4;

interface DragState {
  channel: AmbientAdjustChannel;
  pointerId: number;
  startY: number;
  startPercent: number;
  input: "pointer" | "touch";
}

interface AdjustOverlayState {
  channel: AmbientAdjustChannel;
  percent: number;
  error: string | null;
}

interface LyricsClockAnchor {
  key: string;
  elapsedSeconds: number;
  capturedAtMs: number;
  playing: boolean;
}

const DRAG_PIXELS_PER_PERCENT = 4;
const WHEEL_PIXELS_PER_PERCENT = 9;
const DEFAULT_BACKGROUND_VIDEO: BackgroundVideoSummary = {
  id: "scene-empty",
  filename: "",
  label: "No scene video",
  src: ""
};

const roomModeIcons = {
  focus: Target,
  calm: Waves,
  sleep: Moon,
  hifi: SlidersHorizontal
} satisfies Record<RoomMode, typeof Target>;

const ambientMusicSources: Array<{ id: AmbientMusicSourceTarget; label: string; Icon: LucideIcon }> = [
  { id: "mpd", label: "Library", Icon: LibraryBig },
  { id: "radio", label: "Radio", Icon: RadioIcon },
  { id: "spotify", label: "Spotify", Icon: Music2 },
  { id: "airplay", label: "AirPlay", Icon: Cast },
  { id: "bluetooth", label: "Bluetooth", Icon: Bluetooth },
  { id: "upnp", label: "DLNA", Icon: Network }
];
const ambientHandoffSourceTargets = new Set<AmbientMusicSourceTarget>(["spotify", "airplay", "bluetooth", "upnp"]);

const ambientClockModeWord = {
  focus: "focused",
  calm: "calm",
  sleep: "quiet",
  hifi: "listening room"
} satisfies Record<RoomMode, string>;

const sceneCopyStopWords = new Set(["loop", "room", "scene", "video", "window"]);

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function getAmbientSourceLabel(sourceId: SourceSwitchTarget) {
  return ambientMusicSources.find((source) => source.id === sourceId)?.label ?? "Source";
}

function getAmbientSourceStatusLabel(source: AudioState["currentSource"] | undefined, pending: boolean) {
  return getSourceDisplayStatusLabel(source, { pending });
}

function isAmbientHandoffSourceTarget(sourceId: AmbientMusicSourceTarget | null): sourceId is AmbientMusicSourceTarget {
  return sourceId !== null && ambientHandoffSourceTargets.has(sourceId);
}

function getAmbientHandoffSourceLabel(sourceId: AmbientMusicSourceTarget, source: AudioState["currentSource"] | undefined) {
  if (source?.label) return source.label;
  if (sourceId === "spotify") return "Spotify Connect";
  return getAmbientSourceLabel(sourceId);
}

function getAmbientSourceIcon(sourceId: AmbientMusicSourceTarget | null) {
  return ambientMusicSources.find((source) => source.id === sourceId)?.Icon ?? Music2;
}

function getAmbientSourcePillDetail(
  sourceId: AmbientMusicSourceTarget,
  source: AudioState["currentSource"] | undefined,
  playback: PlaybackSummary,
  pending: boolean
) {
  const waiting = pending || (ambientHandoffSourceTargets.has(sourceId) && source?.connectionState === "armed");
  if (waiting) {
    return source?.advertisedLabel ? `Connecting as ${source.advertisedLabel}` : "Connecting";
  }

  if (sourceId === "mpd" || sourceId === "radio") {
    return [playback.title, playback.artist].filter(Boolean).join(" - ") || source?.secondaryStatus || "Playing";
  }

  if (source?.connectionState === "connected") {
    return source.connectedLabel ? `Connected to ${source.connectedLabel}` : "Connected";
  }

  return source?.secondaryStatus || "Ready";
}

function videoBelongsToRoomMode(video: BackgroundVideoSummary, mode: RoomMode) {
  return mode !== "hifi" && Boolean(video.src) && Array.isArray(video.roomModes) && video.roomModes.includes(mode);
}

function getSceneCopyKeyword(video: BackgroundVideoSummary) {
  if (!video.src) return "";

  const keyword = video.label
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .find((word) => word && !sceneCopyStopWords.has(word.toLowerCase()));

  if (!keyword) return "";
  return `${keyword.charAt(0).toUpperCase()}${keyword.slice(1).toLowerCase()}`;
}

function getSceneDayPartForHour(hour: number): SceneDayPart {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

function getLocalHourForTimeZone(timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      hour12: false
    }).formatToParts(new Date());
    return Number(parts.find((part) => part.type === "hour")?.value ?? new Date().getHours()) % 24;
  } catch {
    return new Date().getHours();
  }
}

function getSceneDayPart(sceneContext: SceneContextSummary | null, timeZone: string) {
  return sceneContext?.dayPart ?? getSceneDayPartForHour(getLocalHourForTimeZone(timeZone));
}

function getAmbientClockSceneCopy(
  video: BackgroundVideoSummary,
  mode: RoomMode,
  sceneContext: SceneContextSummary | null,
  timeZone: string
) {
  const dayPart = getSceneDayPart(sceneContext, timeZone);
  const contextKeyword = sceneContext?.weather?.label ?? getSceneCopyKeyword(video);

  if (mode === "hifi") {
    return contextKeyword ? `${contextKeyword} Hi-Fi listening ${dayPart}` : `Hi-Fi listening ${dayPart}`;
  }

  const modeCopy = ambientClockModeWord[mode];
  if (contextKeyword) return `${contextKeyword} ${modeCopy} ${dayPart}`;
  return `${modeCopy.charAt(0).toUpperCase()}${modeCopy.slice(1)} ${dayPart}`;
}

function findActiveLyricsLineIndex(lyrics: LyricsState, elapsedSeconds: number | null) {
  if (!lyrics.synced || lyrics.lines.length === 0 || !Number.isFinite(elapsedSeconds)) {
    return null;
  }

  const elapsedMs = normalizeLyricsElapsedMs(lyrics, Math.max(0, Math.round((elapsedSeconds ?? 0) * 1000)));
  for (let index = lyrics.lines.length - 1; index >= 0; index -= 1) {
    const line = lyrics.lines[index];
    if (line.startMs === null) continue;
    if (elapsedMs >= line.startMs) {
      if (line.endMs === null || elapsedMs < line.endMs) {
        return index;
      }
      if (elapsedMs >= line.endMs) {
        return Math.min(index + 1, lyrics.lines.length - 1);
      }
    }
  }

  return 0;
}

function isProxyInputLyricsSource(sourceScope: LyricsState["sourceScope"]) {
  return sourceScope === "bluetooth_input" || sourceScope === "airplay_input" || sourceScope === "upnp_input";
}

function getLyricsTimelineMs(lyrics: LyricsState) {
  const timedLines = lyrics.lines.filter((line) => Number.isFinite(line.startMs));
  if (timedLines.length === 0) return null;

  const lastLine = timedLines[timedLines.length - 1];
  const lastStartMs = lastLine.startMs ?? 0;
  if (Number.isFinite(lastLine.endMs)) {
    return Math.max(lastLine.endMs ?? 0, lastStartMs);
  }

  const previousLine = timedLines[timedLines.length - 2];
  const previousStartMs = previousLine?.startMs ?? null;
  const estimatedFinalLineMs = Number.isFinite(previousStartMs)
    ? Math.max(4_000, Math.min(12_000, lastStartMs - (previousStartMs ?? 0)))
    : 8_000;
  return lastStartMs + estimatedFinalLineMs;
}

function normalizeLyricsElapsedMs(lyrics: LyricsState, elapsedMs: number) {
  if (lyrics.sourceScope !== "airplay_input") {
    return elapsedMs;
  }

  const timelineMs = getLyricsTimelineMs(lyrics);
  if (!Number.isFinite(timelineMs) || (timelineMs ?? 0) < 30_000) {
    return elapsedMs;
  }

  const loopThresholdMs = (timelineMs ?? 0) + 15_000;
  if (elapsedMs <= loopThresholdMs) {
    return elapsedMs;
  }

  return elapsedMs % (timelineMs ?? elapsedMs);
}

function waitForSceneAudioRelease() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      window.setTimeout(resolve, SOURCE_PICKER_SCENE_AUDIO_RELEASE_MS);
    });
  });
}

export function AmbientScreen({
  hudVisible,
  timeLabel,
  dateLabel,
  playback,
  lyrics,
  lyricsVisible,
  lyricsFontSize,
  fontTheme,
  audio,
  system,
  status,
  sceneVideoEnabled,
  sceneVideoStableLoop,
  sceneSoundEnabled,
  sceneSoundPending,
  sourcePickerOpenRequest,
  clockVisible,
  onPlaybackAction,
  onSystemAction,
  onSourceSwitch,
  onOpenWebMode,
  onSourcePickerOpenChange,
  onHudActivity,
  onLyricsVisibleChange,
  onCurrentSceneVideoChange,
  onSceneSoundEnabledChange,
  onOpenPlayer,
  onOpenSettings,
  roomExperience,
  onExperienceAction
}: AmbientScreenProps) {
  const dragStateRef = useRef<DragState | null>(null);
  const sourcePickerRef = useRef<HTMLDivElement | null>(null);
  const lastSourcePickerOpenRequestRef = useRef(sourcePickerOpenRequest);
  const lastRoomSceneIdRef = useRef<string | null>(null);
  const selectedBackgroundVideoSrcRef = useRef(DEFAULT_BACKGROUND_VIDEO.src);
  const adjustCommitTimersRef = useRef<Record<AmbientAdjustChannel, number | null>>({
    volume: null,
    brightness: null
  });
  const requestStateRef = useRef<Record<AmbientAdjustChannel, { inFlight: boolean; queued: number | null; lastSent: number | null }>>({
    volume: { inFlight: false, queued: null, lastSent: null },
    brightness: { inFlight: false, queued: null, lastSent: null }
  });
  const [adjustOverlay, setAdjustOverlay] = useState<AdjustOverlayState | null>(null);
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const [pendingAmbientSource, setPendingAmbientSource] = useState<AmbientMusicSourceTarget | null>(null);
  const [webModePending, setWebModePending] = useState(false);
  const [ambientSourceError, setAmbientSourceError] = useState<string | null>(null);
  const [backgroundVideos, setBackgroundVideos] = useState<BackgroundVideoSummary[]>([DEFAULT_BACKGROUND_VIDEO]);
  const [backgroundVideoIndex, setBackgroundVideoIndex] = useState(0);
  const [frozenLyricsLineIndex, setFrozenLyricsLineIndex] = useState<number | null>(null);
  const [staticLyricsLineIndex, setStaticLyricsLineIndex] = useState(0);
  const [lyricsClockNowMs, setLyricsClockNowMs] = useState(() => Date.now());
  const [lyricsClockAnchor, setLyricsClockAnchor] = useState<LyricsClockAnchor | null>(null);
  const [sceneContext, setSceneContext] = useState<SceneContextSummary | null>(null);
  const [sceneVideoThermalPaused, setSceneVideoThermalPaused] = useState(false);
  const [ambientSceneAudioSuppressed, setAmbientSceneAudioSuppressed] = useState(false);
  const indexedBackgroundVideo = backgroundVideos[backgroundVideoIndex] ?? DEFAULT_BACKGROUND_VIDEO;
  const isHifiMode = roomExperience.mode === "hifi";
  const playbackClockKey = useMemo(() => [
    playback.source,
    playback.title ?? "",
    playback.artist ?? "",
    playback.album ?? "",
    playback.currentTrackIndex,
    playback.durationSeconds ?? ""
  ].join("|"), [
    playback.album,
    playback.artist,
    playback.currentTrackIndex,
    playback.durationSeconds,
    playback.source,
    playback.title
  ]);
  const activeTimeZone = roomExperience.nightSchedule.timeZone;
  const modeBackgroundVideos = useMemo(() => (
    backgroundVideos.filter((video) => videoBelongsToRoomMode(video, roomExperience.mode))
  ), [backgroundVideos, roomExperience.mode]);
  const currentBackgroundVideo = useMemo(() => {
    if (isHifiMode || videoBelongsToRoomMode(indexedBackgroundVideo, roomExperience.mode)) {
      return indexedBackgroundVideo;
    }

    const roomSceneVideo = backgroundVideos.find((video) => video.id === roomExperience.sceneVideoId);
    if (roomSceneVideo && videoBelongsToRoomMode(roomSceneVideo, roomExperience.mode)) {
      return roomSceneVideo;
    }

    return modeBackgroundVideos[0] ?? indexedBackgroundVideo;
  }, [backgroundVideos, indexedBackgroundVideo, isHifiMode, modeBackgroundVideos, roomExperience.mode, roomExperience.sceneVideoId]);
  const ambientClockSceneCopy = getAmbientClockSceneCopy(currentBackgroundVideo, roomExperience.mode, sceneContext, activeTimeZone);
  const switchableBackgroundVideos = modeBackgroundVideos.length > 0
    ? modeBackgroundVideos
    : backgroundVideos.filter((video) => Boolean(video.src));
  const hasSceneVideo = Boolean(currentBackgroundVideo.src);
  const brightnessPercent = system.display.brightnessPercent;
  const audioProtectionMode = playback.source === "airplay" && playback.state === "playing";
  const sceneVideoThermalGuardActive = sceneVideoThermalPaused && !isHifiMode;
  const shouldRenderSceneVideo = sceneVideoEnabled && hasSceneVideo && !sceneVideoThermalGuardActive;
  const sceneVisualLowPower = audioProtectionMode || sceneVideoThermalGuardActive;
  const sceneAudioEnabled = shouldRenderSceneVideo && sceneSoundEnabled && !ambientSceneAudioSuppressed && playback.source === "scene" && playback.state === "playing";
  const useStableSceneLoop = sceneVideoStableLoop && shouldRenderSceneVideo && !isHifiMode;
  const proxyLyricsClockUsable = playback.timingDiagnostics?.positionTrusted === true
    || playback.timingDiagnostics?.positionConfidence === "estimated";
  const playbackLyricsClockTrusted = Number.isFinite(playback.elapsedSeconds)
    && ((playback.source !== "airplay" && playback.source !== "upnp") || proxyLyricsClockUsable);
  const canAdvanceLyrics = lyrics.synced
    && (playback.source === "mpd" || playback.source === "radio" || playback.source === "bluetooth" || playback.source === "airplay" || playback.source === "upnp")
    && playback.state === "playing"
    && playbackLyricsClockTrusted;
  const lyricsElapsedSeconds = useMemo(() => {
    if (!canAdvanceLyrics || lyricsClockAnchor?.key !== playbackClockKey) return playback.elapsedSeconds;

    const projectedSeconds = lyricsClockAnchor.elapsedSeconds + Math.max(0, lyricsClockNowMs - lyricsClockAnchor.capturedAtMs) / 1000;
    if (Number.isFinite(playback.durationSeconds)) {
      return Math.min(Math.max(0, projectedSeconds), playback.durationSeconds ?? projectedSeconds);
    }

    return Math.max(0, projectedSeconds);
  }, [canAdvanceLyrics, lyricsClockAnchor, lyricsClockNowMs, playback.durationSeconds, playback.elapsedSeconds, playbackClockKey]);
  const computedLyricsLineIndex = canAdvanceLyrics ? findActiveLyricsLineIndex(lyrics, lyricsElapsedSeconds) : null;
  const activeLyricsLineIndex = canAdvanceLyrics ? computedLyricsLineIndex : frozenLyricsLineIndex;
  const activeLyricsLine = activeLyricsLineIndex !== null ? lyrics.lines[activeLyricsLineIndex] ?? null : null;
  const staticLyricsLines = lyrics.lines.map((line) => line.text.trim()).filter(Boolean);
  const staticLyricsText = staticLyricsLines.length > 0
    ? staticLyricsLines[staticLyricsLineIndex % staticLyricsLines.length] ?? ""
    : "";
  const hasReadyLyrics = lyrics.status === "ready" && lyrics.lines.length > 0;
  const hifiLyricsPanel = useMemo<HifiLyricsPanel | null>(() => {
    if (!lyricsVisible || !hasReadyLyrics) return null;

    const lyricEntries = lyrics.lines
      .map((line, index) => ({ index, text: line.text.trim() }))
      .filter((line) => Boolean(line.text));
    if (lyricEntries.length === 0) return null;

    const syncedActiveIndex = lyrics.synced && activeLyricsLineIndex !== null
      ? lyricEntries.findIndex((line) => line.index === activeLyricsLineIndex)
      : -1;
    const activeIndex = syncedActiveIndex >= 0
      ? syncedActiveIndex
      : staticLyricsLineIndex % lyricEntries.length;
    const synced = syncedActiveIndex >= 0;

    return {
      activeIndex,
      synced,
      lines: lyricEntries.map((line, index) => ({
        id: `${lyrics.trackKey ?? "lyrics"}-${line.index}`,
        text: line.text,
        active: synced && index === activeIndex,
        distance: Math.abs(index - activeIndex)
      }))
    };
  }, [activeLyricsLineIndex, hasReadyLyrics, lyrics.lines, lyrics.synced, lyrics.trackKey, lyricsVisible, staticLyricsLineIndex]);
  const roomModeLabel = roomModeOptions.find((option) => option.mode === roomExperience.mode)?.label ?? "Calm";
  const roomModeIntent = roomModeOptions.find((option) => option.mode === roomExperience.mode)?.intent ?? "Unwind & relax";
  const showSyncedLyrics = hasReadyLyrics && lyrics.synced && canAdvanceLyrics && Boolean(activeLyricsLine);
  const showStaticLyrics = hasReadyLyrics && Boolean(staticLyricsText) && (!lyrics.synced || !canAdvanceLyrics || !activeLyricsLine);
  const showIdentifiedTrack = (lyrics.status === "not_found" || lyrics.status === "error") && Boolean(lyrics.title || lyrics.artist);
  const recognizingMessage = isProxyInputLyricsSource(lyrics.sourceScope)
    ? `Listening to ${lyrics.sourceScope === "airplay_input" ? "AirPlay" : lyrics.sourceScope === "upnp_input" ? "DLNA" : "Bluetooth"} audio...`
    : "Identifying track...";
  const tickerText = showSyncedLyrics
    ? activeLyricsLine?.text ?? ""
    : showStaticLyrics
      ? staticLyricsText
      : showIdentifiedTrack
        ? [lyrics.title, lyrics.artist].filter(Boolean).join(" - ")
        : lyrics.status === "recognizing"
          ? recognizingMessage
          : (lyrics.status === "idle" || lyrics.status === "not_found" || lyrics.status === "error")
            ? lyrics.message ?? ""
            : "";
  const shouldScrollTicker = tickerText.length > 56;
  const marqueeDurationSeconds = shouldScrollTicker
    ? Math.max(34, Math.min(96, Math.ceil(tickerText.length * 0.45)))
    : 0;
  const tickerStyle = shouldScrollTicker
    ? ({ "--ambient-lyrics-marquee-duration": `${marqueeDurationSeconds}s` } as CSSProperties)
    : undefined;
  const canShowLyricsLayer = !isHifiMode && lyricsVisible;
  const showLyricsLayer = canShowLyricsLayer && hasReadyLyrics && Boolean(tickerText);
  const isPlaybackPending = status.pending;
  const isPlaying = playback.state === "playing";
  const transportCapabilities = playback.transportCapabilities;
  const transportUnavailableTitle = transportCapabilities?.reason ?? "Playback control unavailable";
  const previousTrackDisabled = isPlaybackPending || transportCapabilities?.previous === false;
  const playPauseDisabled = isPlaybackPending || transportCapabilities?.playPause === false;
  const nextTrackDisabled = isPlaybackPending || transportCapabilities?.next === false;
  const previousTrackTitle = transportCapabilities?.previous === false ? transportUnavailableTitle : "Previous track";
  const playPauseTitle = transportCapabilities?.playPause === false ? transportUnavailableTitle : isPlaying ? "Pause" : "Play";
  const nextTrackTitle = transportCapabilities?.next === false ? transportUnavailableTitle : "Next track";
  const playbackSettings = playback.settings ?? { playMode: "sequence" };
  const playMode = playbackSettings.playMode;
  const currentAmbientSource = audio.currentSource.id === "upnp"
    || audio.currentSource.id === "mpd"
    || audio.currentSource.id === "radio"
    || audio.currentSource.id === "spotify"
    || audio.currentSource.id === "airplay"
    || audio.currentSource.id === "bluetooth"
    ? audio.currentSource.id
    : null;
  const currentAmbientSourceLabel = currentAmbientSource
    ? getAmbientSourceLabel(currentAmbientSource)
    : audio.currentSource.label;
  const handoffPendingSource = isAmbientHandoffSourceTarget(pendingAmbientSource) ? pendingAmbientSource : null;
  const handoffPendingSourceSummary = handoffPendingSource
    ? audio.sources.find((entry) => entry.id === handoffPendingSource)
    : undefined;
  const handoffPendingSourceLabel = handoffPendingSource
    ? getAmbientHandoffSourceLabel(handoffPendingSource, handoffPendingSourceSummary)
    : "";
  const ambientHudVisible = hudVisible || (isHifiMode && handoffPendingSource !== null);
  const ambientSourcePillSourceId = !isHifiMode
    ? handoffPendingSource ?? currentAmbientSource
    : null;
  const ambientSourcePillSource = ambientSourcePillSourceId
    ? audio.sources.find((entry) => entry.id === ambientSourcePillSourceId)
    : undefined;
  const ambientSourcePillVisible = Boolean(
    ambientSourcePillSourceId
      && !(sceneSoundEnabled && !isHifiMode)
      && (handoffPendingSource !== null || (audio.currentSource.id !== "scene" && audio.currentSource.id !== "audio"))
  );
  const ambientSourcePillWaiting = Boolean(
    ambientSourcePillSourceId
      && (handoffPendingSource === ambientSourcePillSourceId
        || (ambientHandoffSourceTargets.has(ambientSourcePillSourceId) && ambientSourcePillSource?.connectionState === "armed"))
  );
  const AmbientSourcePillIcon = getAmbientSourceIcon(ambientSourcePillSourceId);
  const ambientSourcePillLabel = ambientSourcePillSourceId
    ? getAmbientSourceLabel(ambientSourcePillSourceId)
    : "";
  const ambientSourcePillDetail = ambientSourcePillSourceId
    ? getAmbientSourcePillDetail(ambientSourcePillSourceId, ambientSourcePillSource, playback, ambientSourcePillWaiting)
    : "";

  const refreshBackgroundVideos = useCallback((signal?: AbortSignal) => {
    void fetchBackgroundVideos(signal)
      .then((payload) => {
        if (payload.videos.length === 0) {
          setBackgroundVideos([DEFAULT_BACKGROUND_VIDEO]);
          setBackgroundVideoIndex(0);
          return;
        }

        const selectedSrc = selectedBackgroundVideoSrcRef.current;
        const preferredIndex = payload.videos.findIndex((video) => video.src === selectedSrc);
        const defaultIndex = payload.defaultVideoId
          ? payload.videos.findIndex((video) => video.id === payload.defaultVideoId)
          : -1;
        const fallbackIndex = payload.videos.findIndex((video) => video.src === DEFAULT_BACKGROUND_VIDEO.src);
        setBackgroundVideos(payload.videos);
        setBackgroundVideoIndex(preferredIndex !== -1
          ? preferredIndex
          : Math.max(0, defaultIndex !== -1 ? defaultIndex : fallbackIndex));
      })
      .catch(() => {
        // Keep the currently mounted video list when the API is temporarily unavailable.
      });
  }, []);

  useEffect(() => {
    const cpuTemp = system.cpuTemp;
    if (cpuTemp === null || !Number.isFinite(cpuTemp)) return;

    setSceneVideoThermalPaused((paused) => {
      if (cpuTemp >= SCENE_VIDEO_THERMAL_PAUSE_C) return true;
      if (paused && cpuTemp <= SCENE_VIDEO_THERMAL_RESUME_C) return false;
      return paused;
    });
  }, [system.cpuTemp]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    setSceneContext(null);
    const refreshSceneContext = (signal?: AbortSignal) => {
      void fetchSceneContext(activeTimeZone, signal)
        .then((payload) => {
          if (active) setSceneContext(payload);
        })
        .catch(() => {
          if (active) setSceneContext(null);
        });
    };

    refreshSceneContext(controller.signal);
    const interval = window.setInterval(() => refreshSceneContext(), SCENE_CONTEXT_REFRESH_MS);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(interval);
    };
  }, [activeTimeZone]);

  useEffect(() => {
    selectedBackgroundVideoSrcRef.current = currentBackgroundVideo.src;
    onCurrentSceneVideoChange(currentBackgroundVideo);
  }, [currentBackgroundVideo, onCurrentSceneVideoChange]);

  useEffect(() => {
    if (!roomExperience.sceneVideoId || roomExperience.sceneVideoId === lastRoomSceneIdRef.current) return;
    const preferredIndex = backgroundVideos.findIndex((video) => video.id === roomExperience.sceneVideoId);
    if (preferredIndex === -1) return;
    lastRoomSceneIdRef.current = roomExperience.sceneVideoId;
    setBackgroundVideoIndex(preferredIndex);
  }, [backgroundVideos, roomExperience.sceneVideoId]);

  useEffect(() => {
    if (isHifiMode || modeBackgroundVideos.length === 0) return;
    if (modeBackgroundVideos.some((video) => video.id === currentBackgroundVideo.id)) return;

    const preferredVideo = modeBackgroundVideos.find((video) => video.id === roomExperience.sceneVideoId) ?? modeBackgroundVideos[0];
    const preferredIndex = backgroundVideos.findIndex((video) => video.id === preferredVideo?.id);
    if (preferredIndex !== -1) {
      setBackgroundVideoIndex(preferredIndex);
    }
  }, [backgroundVideos, currentBackgroundVideo.id, isHifiMode, modeBackgroundVideos, roomExperience.sceneVideoId]);

  useEffect(() => {
    const controller = new AbortController();
    refreshBackgroundVideos(controller.signal);

    const refreshTimer = window.setInterval(() => {
      refreshBackgroundVideos();
    }, BACKGROUND_VIDEO_REFRESH_MS);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshBackgroundVideos();
      }
    };
    const handleManualRefresh = () => refreshBackgroundVideos();

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener(BACKGROUND_VIDEO_REFRESH_EVENT, handleManualRefresh);

    return () => {
      controller.abort();
      window.clearInterval(refreshTimer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener(BACKGROUND_VIDEO_REFRESH_EVENT, handleManualRefresh);
    };
  }, [refreshBackgroundVideos]);

  function switchBackgroundVideo(direction: -1 | 1) {
    onHudActivity();
    if (isHifiMode) {
      return;
    }
    if (switchableBackgroundVideos.length <= 1) return;
    const currentIndex = Math.max(0, switchableBackgroundVideos.findIndex((video) => video.id === currentBackgroundVideo.id));
    const nextVideo = switchableBackgroundVideos[(currentIndex + direction + switchableBackgroundVideos.length) % switchableBackgroundVideos.length];
    const nextIndex = backgroundVideos.findIndex((video) => video.id === nextVideo?.id);
    if (nextVideo && nextIndex !== -1) {
      setBackgroundVideoIndex(nextIndex);
      void onExperienceAction({ type: "set_scene", sceneVideoId: nextVideo.id });
    }
  }

  function handleAmbientPlaybackAction(type: PlaybackActionType) {
    onHudActivity();
    if (isPlaybackPending) return;
    if (type === "previous" && transportCapabilities?.previous === false) return;
    if (type === "next" && transportCapabilities?.next === false) return;
    if (type === "play_pause" && transportCapabilities?.playPause === false) return;
    void onPlaybackAction(type);
  }

  function handlePlayModeChange(mode: PlaybackMode) {
    onHudActivity();
    if (isPlaybackPending) return;
    if (mode === playMode) {
      if (mode === "shuffle" && transportCapabilities?.next !== false) {
        void onPlaybackAction("next");
      }
      return;
    }
    void onPlaybackAction("play_mode_set", undefined, mode);
  }

  function handleOpenPlayerClick() {
    onHudActivity();
    setSourcePickerOpen(false);
    onOpenPlayer();
  }

  function handleSceneSoundToggle() {
    onHudActivity();
    if (sceneSoundPending || !hasSceneVideo) return;
    onSceneSoundEnabledChange(!sceneSoundEnabled);
  }

  function handleAmbientSourceToggle() {
    onHudActivity();
    setAmbientSourceError(null);
    setSourcePickerOpen((open) => !open);
  }

  const hifiLyricsControls = isHifiMode && hifiLyricsPanel ? (
    <>
      <button
        className="hifi-lyrics-control"
        type="button"
        aria-label="Previous track"
        title={previousTrackTitle}
        disabled={previousTrackDisabled}
        onClick={() => handleAmbientPlaybackAction("previous")}
      >
        <SkipBack size={34} fill="currentColor" strokeWidth={1.6} />
      </button>
      <button
        className="hifi-lyrics-control hifi-lyrics-control-play"
        type="button"
        aria-label={isPlaying ? "Pause" : "Play"}
        title={playPauseTitle}
        disabled={playPauseDisabled}
        onClick={() => handleAmbientPlaybackAction("play_pause")}
      >
        {isPlaying ? <Pause size={42} fill="currentColor" strokeWidth={1.5} /> : <Play size={42} fill="currentColor" strokeWidth={1.5} />}
      </button>
      <button
        className="hifi-lyrics-control"
        type="button"
        aria-label="Next track"
        title={nextTrackTitle}
        disabled={nextTrackDisabled}
        onClick={() => handleAmbientPlaybackAction("next")}
      >
        <SkipForward size={34} fill="currentColor" strokeWidth={1.6} />
      </button>
    </>
  ) : null;

  async function handleAmbientSourceSelect(sourceId: AmbientMusicSourceTarget) {
    onHudActivity();
    if (status.pending || pendingAmbientSource) return;
    const source = audio.sources.find((entry) => entry.id === sourceId);
    if (source?.availability === "unavailable" || source?.controllability === "status-only") return;

    setPendingAmbientSource(sourceId);
    setAmbientSourceError(null);
    const shouldReleaseSceneAudio = sceneAudioEnabled;
    const shouldUseAmbientStatusPill = !isHifiMode && ambientHandoffSourceTargets.has(sourceId);
    try {
      if (shouldReleaseSceneAudio) {
        setAmbientSceneAudioSuppressed(true);
        await waitForSceneAudioRelease();
      }
      if (shouldUseAmbientStatusPill) {
        setSourcePickerOpen(false);
      }
      await onSourceSwitch(sourceId);
      setSourcePickerOpen(false);
    } catch (error) {
      if (shouldReleaseSceneAudio) {
        setAmbientSceneAudioSuppressed(false);
      }
      if (shouldUseAmbientStatusPill) {
        setSourcePickerOpen(true);
      }
      setAmbientSourceError(error instanceof Error ? error.message : "Source switch failed");
    } finally {
      setPendingAmbientSource(null);
    }
  }

  async function handleOpenWebModeClick() {
    onHudActivity();
    if (status.pending || pendingAmbientSource || webModePending) return;
    setWebModePending(true);
    setAmbientSourceError(null);
    try {
      await onOpenWebMode();
      setSourcePickerOpen(false);
      onSourcePickerOpenChange?.(false);
    } catch (error) {
      setAmbientSourceError(error instanceof Error ? error.message : "Explore failed to open");
    } finally {
      setWebModePending(false);
    }
  }

  function handleRoomModeChange(mode: RoomMode) {
    onHudActivity();
    if (mode === roomExperience.mode) return;
    void onExperienceAction({ type: "set_mode", mode });
  }

  function toggleLyricsLayer() {
    onHudActivity();
    onLyricsVisibleChange(!lyricsVisible);
  }

  useEffect(() => {
    if (!hudVisible) return undefined;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, button")) return;

      if (event.key === "ArrowUp") {
        event.preventDefault();
        switchBackgroundVideo(-1);
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        switchBackgroundVideo(1);
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (!isHifiMode) {
          switchBackgroundVideo(-1);
          return;
        }
        handleAmbientPlaybackAction("previous");
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        if (!isHifiMode) {
          switchBackgroundVideo(1);
          return;
        }
        handleAmbientPlaybackAction("next");
        return;
      }
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        if (!isHifiMode) {
          handleSceneSoundToggle();
          return;
        }
        handleAmbientPlaybackAction("play_pause");
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [backgroundVideos.length, currentBackgroundVideo.id, hasSceneVideo, hudVisible, isHifiMode, isPlaybackPending, nextTrackDisabled, onExperienceAction, onHudActivity, onPlaybackAction, onSceneSoundEnabledChange, playPauseDisabled, previousTrackDisabled, sceneSoundEnabled, sceneSoundPending, switchableBackgroundVideos.length]);

  useEffect(() => {
    if (!sourcePickerOpen || pendingAmbientSource || ambientSourceError) return undefined;

    const timer = window.setTimeout(() => {
      setSourcePickerOpen(false);
    }, SOURCE_PICKER_AUTO_CLOSE_MS);

    return () => window.clearTimeout(timer);
  }, [ambientSourceError, pendingAmbientSource, sourcePickerOpen]);

  useEffect(() => {
    onSourcePickerOpenChange?.(sourcePickerOpen);
  }, [onSourcePickerOpenChange, sourcePickerOpen]);

  useEffect(() => {
    if (!ambientSceneAudioSuppressed) return;
    if (playback.source !== "scene" || !sceneSoundEnabled) {
      setAmbientSceneAudioSuppressed(false);
    }
  }, [ambientSceneAudioSuppressed, playback.source, sceneSoundEnabled]);

  useEffect(() => {
    if (!isHifiMode || !pendingAmbientSource || status.pending) return;
    if (audio.currentSource.id !== pendingAmbientSource) return;
    setPendingAmbientSource(null);
    setSourcePickerOpen(false);
  }, [audio.currentSource.id, isHifiMode, pendingAmbientSource, status.pending]);

  useEffect(() => {
    if (sourcePickerOpenRequest === lastSourcePickerOpenRequestRef.current) return;
    lastSourcePickerOpenRequestRef.current = sourcePickerOpenRequest;
    if (sourcePickerOpenRequest <= 0 || isHifiMode) return;

    setAmbientSourceError(null);
    setSourcePickerOpen(true);
  }, [isHifiMode, sourcePickerOpenRequest]);

  useEffect(() => {
    if (!sourcePickerOpen || handoffPendingSource) return undefined;

    function handleDocumentPointerDown(event: PointerEvent) {
      if (sourcePickerRef.current?.contains(event.target as Node)) return;
      setSourcePickerOpen(false);
    }

    function handleSourcePickerKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setSourcePickerOpen(false);
    }

    document.addEventListener("pointerdown", handleDocumentPointerDown);
    window.addEventListener("keydown", handleSourcePickerKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handleDocumentPointerDown);
      window.removeEventListener("keydown", handleSourcePickerKeyDown);
    };
  }, [handoffPendingSource, sourcePickerOpen]);

  function clearAdjustCommitTimer(channel: AmbientAdjustChannel) {
    const timer = adjustCommitTimersRef.current[channel];
    if (timer !== null) {
      window.clearTimeout(timer);
      adjustCommitTimersRef.current[channel] = null;
    }
  }

  useEffect(() => () => {
    clearAdjustCommitTimer("volume");
    clearAdjustCommitTimer("brightness");
  }, []);

  useEffect(() => {
    if (!playbackLyricsClockTrusted) {
      setLyricsClockAnchor(null);
      return;
    }

    const capturedAtMs = Date.now();
    const nextElapsedSeconds = Math.max(0, playback.elapsedSeconds ?? 0);
    const isPlaying = playback.state === "playing";
    setLyricsClockAnchor((current) => {
      if (!current || current.key !== playbackClockKey || !isPlaying || current.playing !== true) {
        return { key: playbackClockKey, elapsedSeconds: nextElapsedSeconds, capturedAtMs, playing: isPlaying };
      }

      const projectedSeconds = current.elapsedSeconds + Math.max(0, capturedAtMs - current.capturedAtMs) / 1000;
      const rewindSeconds = projectedSeconds - nextElapsedSeconds;
      const shouldKeepLocalClock = rewindSeconds > 0 && rewindSeconds <= LYRICS_CLOCK_REWIND_TOLERANCE_SECONDS;
      return {
        key: playbackClockKey,
        elapsedSeconds: shouldKeepLocalClock ? projectedSeconds : nextElapsedSeconds,
        capturedAtMs,
        playing: true
      };
    });
  }, [playback.elapsedSeconds, playback.state, playbackClockKey, playbackLyricsClockTrusted]);

  useEffect(() => {
    if (!canAdvanceLyrics || lyricsClockAnchor?.key !== playbackClockKey) return undefined;

    setLyricsClockNowMs(Date.now());
    const interval = window.setInterval(() => {
      setLyricsClockNowMs(Date.now());
    }, LYRICS_CLOCK_TICK_MS);

    return () => window.clearInterval(interval);
  }, [canAdvanceLyrics, lyricsClockAnchor?.key, playbackClockKey]);

  useEffect(() => {
    if (computedLyricsLineIndex !== null) {
      setFrozenLyricsLineIndex(computedLyricsLineIndex);
      return;
    }

    if (!lyrics.synced) {
      setFrozenLyricsLineIndex(null);
    }
  }, [computedLyricsLineIndex, lyrics.synced, lyrics.trackKey]);

  useEffect(() => {
    setStaticLyricsLineIndex(0);
  }, [lyrics.status, lyrics.sourceScope, lyrics.trackKey]);

  useEffect(() => {
    if (lyrics.status !== "ready" || staticLyricsLines.length <= 1 || (lyrics.synced && canAdvanceLyrics)) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      setStaticLyricsLineIndex((current) => (current + 1) % staticLyricsLines.length);
    }, isProxyInputLyricsSource(lyrics.sourceScope) ? 8500 : 7000);

    return () => window.clearInterval(interval);
  }, [canAdvanceLyrics, lyrics.sourceScope, lyrics.status, lyrics.synced, lyrics.trackKey, staticLyricsLines.length]);

  useEffect(() => {
    requestStateRef.current.volume.lastSent = system.volume.percent;
  }, [system.volume.percent]);

  useEffect(() => {
    requestStateRef.current.brightness.lastSent = system.display.brightnessPercent;
  }, [system.display.brightnessPercent]);

  const dispatchAdjust = useCallback(
    (channel: AmbientAdjustChannel, percent: number) => {
      const nextPercent = clampPercent(percent);
      const requestState = requestStateRef.current[channel];
      requestState.queued = nextPercent;

      if (requestState.inFlight) {
        return;
      }

      requestState.inFlight = true;

      const sendNext = async () => {
        const target = requestState.queued;
        requestState.queued = null;

        if (target === null) {
          requestState.inFlight = false;
          return;
        }

        try {
          const nextState = channel === "volume"
            ? await onPlaybackAction("volume_set", target)
            : await onSystemAction("brightness_set", target);
          requestState.lastSent = channel === "volume"
            ? nextState.system.volume.percent
            : nextState.system.display.brightnessPercent;

          setAdjustOverlay((current) => (
            current && current.channel === channel && requestState.queued === null
              ? { ...current, percent: target, error: null }
              : current
          ));
        } catch (error) {
          const message = error instanceof Error ? error.message : "Adjustment failed";
          setAdjustOverlay((current) => (
            current && current.channel === channel
              ? { ...current, error: message }
              : current
          ));
        }

        if (requestState.queued !== null) {
          await sendNext();
          return;
        }

        requestState.inFlight = false;
      };

      void sendNext();
    },
    [onPlaybackAction, onSystemAction]
  );

  function scheduleAdjustDispatch(channel: AmbientAdjustChannel, percent: number) {
    const nextPercent = clampPercent(percent);
    requestStateRef.current[channel].queued = nextPercent;
    clearAdjustCommitTimer(channel);
    adjustCommitTimersRef.current[channel] = window.setTimeout(() => {
      adjustCommitTimersRef.current[channel] = null;
      const queued = requestStateRef.current[channel].queued;
      if (queued !== null) {
        dispatchAdjust(channel, queued);
      }
    }, ADJUST_COMMIT_DELAY_MS);
  }

  function flushAdjustDispatch(channel: AmbientAdjustChannel) {
    clearAdjustCommitTimer(channel);
    const queued = requestStateRef.current[channel].queued;
    if (queued !== null) {
      dispatchAdjust(channel, queued);
    }
  }

  function startAdjust(channel: AmbientAdjustChannel, pointerId: number, startY: number, input: DragState["input"] = "pointer") {
    const startPercent = channel === "volume" ? system.volume.percent : brightnessPercent;
    dragStateRef.current = {
      channel,
      pointerId,
      startY,
      startPercent,
      input
    };
    setAdjustOverlay({
      channel,
      percent: startPercent,
      error: null
    });
  }

  function updateAdjust(clientY: number) {
    const dragState = dragStateRef.current;
    if (!dragState) return;
    const deltaPercent = Math.round((dragState.startY - clientY) / DRAG_PIXELS_PER_PERCENT);
    const nextPercent = clampPercent(dragState.startPercent + deltaPercent);
    setAdjustOverlay((current) => (
      current
        ? { ...current, percent: nextPercent, error: null }
        : { channel: dragState.channel, percent: nextPercent, error: null }
    ));
    scheduleAdjustDispatch(dragState.channel, nextPercent);
  }

  function finishAdjust() {
    const dragState = dragStateRef.current;
    if (dragState) {
      flushAdjustDispatch(dragState.channel);
    }
    dragStateRef.current = null;
  }

  function currentAdjustPercent(channel: AmbientAdjustChannel) {
    const requestState = requestStateRef.current[channel];
    if (requestState.queued !== null) return requestState.queued;
    if (adjustOverlay?.channel === channel) return adjustOverlay.percent;
    return channel === "volume" ? system.volume.percent : brightnessPercent;
  }

  function applyWheelAdjust(channel: AmbientAdjustChannel, event: React.WheelEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();

    if (channel === "brightness" && !system.display.controllable) {
      setAdjustOverlay({
        channel,
        percent: brightnessPercent,
        error: "Unavailable"
      });
      return;
    }

    const rawDeltaPercent = -event.deltaY / WHEEL_PIXELS_PER_PERCENT;
    const deltaPercent = Math.abs(rawDeltaPercent) < 1
      ? Math.sign(rawDeltaPercent)
      : Math.round(rawDeltaPercent);
    if (deltaPercent === 0) return;

    const nextPercent = clampPercent(currentAdjustPercent(channel) + deltaPercent);
    setAdjustOverlay({
      channel,
      percent: nextPercent,
      error: null
    });
    scheduleAdjustDispatch(channel, nextPercent);
  }

  function handleAmbientWheelCapture(event: React.WheelEvent<HTMLElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const edgeWidth = Math.min(560, Math.max(120, rect.width * 0.32));
    const localX = event.clientX - rect.left;
    if (localX <= edgeWidth) {
      applyWheelAdjust("brightness", event);
      return;
    }
    if (localX >= rect.width - edgeWidth) {
      applyWheelAdjust("volume", event);
    }
  }

  function handleZoneWheel(channel: AmbientAdjustChannel): React.WheelEventHandler<HTMLDivElement> {
    return (event) => applyWheelAdjust(channel, event);
  }

  function handleZonePointerDown(channel: AmbientAdjustChannel): React.PointerEventHandler<HTMLDivElement> {
    return (event) => {
      if (channel === "brightness" && !system.display.controllable) {
        event.preventDefault();
        event.stopPropagation();
        setAdjustOverlay({
          channel,
          percent: brightnessPercent,
          error: "Unavailable"
        });
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (dragStateRef.current) return;
      if (event.currentTarget.setPointerCapture) {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      startAdjust(channel, event.pointerId, event.clientY, "pointer");
    };
  }

  const handleZonePointerMove = useCallback<React.PointerEventHandler<HTMLDivElement>>((event) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.input !== "pointer" || dragState.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    updateAdjust(event.clientY);
  }, [dispatchAdjust]);

  const handleZonePointerUp = useCallback<React.PointerEventHandler<HTMLDivElement>>((event) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.input !== "pointer" || dragState.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    updateAdjust(event.clientY);
    finishAdjust();
  }, [dispatchAdjust]);

  const handleZonePointerCancel = useCallback<React.PointerEventHandler<HTMLDivElement>>((event) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.input !== "pointer" || dragState.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    finishAdjust();
  }, []);

  function getChangedTouch(event: React.TouchEvent<HTMLDivElement>) {
    return event.changedTouches[0] ?? event.touches[0] ?? null;
  }

  function findTrackedTouch(event: React.TouchEvent<HTMLDivElement>, pointerId: number) {
    return [...Array.from(event.touches), ...Array.from(event.changedTouches)].find((touch) => touch.identifier === pointerId) ?? null;
  }

  function handleZoneTouchStart(channel: AmbientAdjustChannel): React.TouchEventHandler<HTMLDivElement> {
    return (event) => {
      if (channel === "brightness" && !system.display.controllable) {
        event.preventDefault();
        event.stopPropagation();
        setAdjustOverlay({
          channel,
          percent: brightnessPercent,
          error: "Unavailable"
        });
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (dragStateRef.current) return;

      const touch = getChangedTouch(event);
      if (!touch) return;
      startAdjust(channel, touch.identifier, touch.clientY, "touch");
    };
  }

  const handleZoneTouchMove = useCallback<React.TouchEventHandler<HTMLDivElement>>((event) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.input !== "touch") return;
    const touch = findTrackedTouch(event, dragState.pointerId);
    if (!touch) return;
    event.preventDefault();
    event.stopPropagation();
    updateAdjust(touch.clientY);
  }, [dispatchAdjust]);

  const handleZoneTouchEnd = useCallback<React.TouchEventHandler<HTMLDivElement>>((event) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.input !== "touch") return;
    const touch = findTrackedTouch(event, dragState.pointerId);
    if (!touch) return;
    event.preventDefault();
    event.stopPropagation();
    updateAdjust(touch.clientY);
    finishAdjust();
  }, [dispatchAdjust]);

  const handleZoneTouchCancel = useCallback<React.TouchEventHandler<HTMLDivElement>>((event) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.input !== "touch") return;
    const touch = findTrackedTouch(event, dragState.pointerId);
    if (!touch) return;
    event.preventDefault();
    event.stopPropagation();
    finishAdjust();
  }, []);

  function handleAdjustBack(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    const channel = adjustOverlay?.channel;
    if (channel) {
      flushAdjustDispatch(channel);
    }
    dragStateRef.current = null;
    setAdjustOverlay(null);
  }

  const sourcePickerControl = (
    <div className="ambient-source-picker" ref={sourcePickerRef}>
      <button
        className={`ambient-transport-button ambient-transport-setting ambient-source-toggle ${sourcePickerOpen ? "is-active" : ""}`}
        type="button"
        aria-label="Choose audio source"
        title={`Source: ${currentAmbientSourceLabel}`}
        aria-expanded={sourcePickerOpen}
        data-ambient-source-toggle
        tabIndex={ambientHudVisible ? 0 : -1}
        disabled={status.pending || pendingAmbientSource !== null}
        onClick={handleAmbientSourceToggle}
      >
        <Music2 size={25} strokeWidth={1.8} />
      </button>
      {sourcePickerOpen ? (
        <div className="ambient-source-picker-popover" role="menu" aria-label="Audio source picker" data-ambient-source-picker>
          {handoffPendingSource ? (
            <div
              className="dlna-handoff-card ambient-dlna-handoff-card"
              role="status"
              data-source-handoff-waiting={handoffPendingSource}
              data-dlna-handoff-waiting={handoffPendingSource === "upnp" ? "" : undefined}
            >
              <span className="dlna-handoff-icon" aria-hidden="true">
                <LoaderCircle size={24} className="is-spinning" />
              </span>
              <span className="source-panel-kicker">{handoffPendingSourceLabel}</span>
              <strong>Connecting</strong>
              <p>Tikpal is open for {handoffPendingSourceLabel}. This will close when the device connects or the handoff times out.</p>
            </div>
          ) : (
            <div className="ambient-source-picker-grid">
              {ambientMusicSources.map(({ id, label, Icon }) => {
                const source = audio.sources.find((entry) => entry.id === id);
                const pending = pendingAmbientSource === id;
                const active = audio.currentSource.id === id;
                const disabled = status.pending
                  || pendingAmbientSource !== null
                  || source?.availability === "unavailable"
                  || source?.controllability === "status-only";
                return (
                  <button
                    className={`ambient-source-option ${active ? "is-active" : ""}`}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    disabled={disabled}
                    data-ambient-source-option={id}
                    key={id}
                    onClick={() => void handleAmbientSourceSelect(id)}
                  >
                    <span className="ambient-source-option-icon" aria-hidden="true">
                      {pending ? <LoaderCircle size={27} className="is-spinning" /> : <Icon size={27} strokeWidth={1.8} />}
                    </span>
                    <strong>{label}</strong>
                    <span>{getAmbientSourceStatusLabel(source, pending)}</span>
                  </button>
                );
              })}
              <button
                className="ambient-source-option ambient-source-option-web"
                type="button"
                role="menuitem"
                disabled={status.pending || pendingAmbientSource !== null || webModePending}
                data-ambient-source-option="web-mode"
                onClick={() => void handleOpenWebModeClick()}
              >
                <span className="ambient-source-option-icon" aria-hidden="true">
                  {webModePending ? <LoaderCircle size={27} className="is-spinning" /> : <Globe2 size={27} strokeWidth={1.8} />}
                </span>
                <strong>Explore</strong>
                <span>{webModePending ? "Opening" : "Web players"}</span>
              </button>
            </div>
          )}
          {ambientSourceError ? <div className="ambient-source-error" role="status">{ambientSourceError}</div> : null}
        </div>
      ) : null}
    </div>
  );

  return (
    <section
      className={`ambient-screen ${ambientHudVisible ? "is-hud-visible" : "is-hud-hidden"}`}
      data-room-mode={roomExperience.mode}
      aria-label="Ambient flame screen"
      onWheelCapture={handleAmbientWheelCapture}
    >
      {isHifiMode ? (
        <EqVisualScene
          presetId={roomExperience.hifiEqPresetId}
          playback={playback}
          audio={audio}
          system={system}
          fontTheme={fontTheme}
          lyricsPanel={hifiLyricsPanel}
          lyricsControls={hifiLyricsControls}
        />
      ) : (
        <FlameScene
          lowPower={sceneVisualLowPower || useStableSceneLoop}
          playback={playback}
          singleLoop={useStableSceneLoop}
          videoSrc={currentBackgroundVideo.src}
          staticOnly={sceneVideoThermalGuardActive && sceneVideoEnabled && hasSceneVideo}
          videoEnabled={shouldRenderSceneVideo}
          audioEnabled={sceneAudioEnabled}
          audioSuspended={ambientSceneAudioSuppressed}
          volumePercent={system.volume.percent}
          audioGainDb={currentBackgroundVideo.audioGainDb}
        />
      )}
      {!isHifiMode && sceneVideoEnabled && hasSceneVideo ? <div className="ambient-vignette" /> : null}
      <div
        className={`ambient-adjust-zone ambient-adjust-zone-left ${system.display.controllable ? "" : "is-disabled"}`}
        data-ambient-adjust-zone="brightness"
        data-gesture-protected
        aria-label="Swipe or scroll to change brightness"
        onPointerDown={handleZonePointerDown("brightness")}
        onPointerMove={handleZonePointerMove}
        onPointerUp={handleZonePointerUp}
        onPointerCancel={handleZonePointerCancel}
        onTouchStart={handleZoneTouchStart("brightness")}
        onTouchMove={handleZoneTouchMove}
        onTouchEnd={handleZoneTouchEnd}
        onTouchCancel={handleZoneTouchCancel}
        onWheel={handleZoneWheel("brightness")}
      />
      <div
        className="ambient-adjust-zone ambient-adjust-zone-right"
        data-ambient-adjust-zone="volume"
        data-gesture-protected
        aria-label="Swipe or scroll to change volume"
        onPointerDown={handleZonePointerDown("volume")}
        onPointerMove={handleZonePointerMove}
        onPointerUp={handleZonePointerUp}
        onPointerCancel={handleZonePointerCancel}
        onTouchStart={handleZoneTouchStart("volume")}
        onTouchMove={handleZoneTouchMove}
        onTouchEnd={handleZoneTouchEnd}
        onTouchCancel={handleZoneTouchCancel}
        onWheel={handleZoneWheel("volume")}
      />

      <button className="icon-button ambient-settings" type="button" data-gesture-protected onClick={onOpenSettings} aria-label="Open console" title="Console">
        <Settings size={26} strokeWidth={1.8} />
      </button>

      <div
        className={`ambient-transport ${isHifiMode ? "is-hifi" : "is-room-mode"}`}
        data-gesture-protected
        aria-hidden={!ambientHudVisible}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => {
          event.stopPropagation();
          onHudActivity();
        }}
        onPointerMove={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
        onPointerCancel={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
      >
        <div className="ambient-transport-main">
          {!isHifiMode ? (
            <button
              className="ambient-transport-button ambient-transport-scene ambient-transport-scene-previous"
              type="button"
              aria-label="Previous scene"
              title="Previous scene"
              tabIndex={ambientHudVisible ? 0 : -1}
              disabled={switchableBackgroundVideos.length <= 1}
              onClick={() => switchBackgroundVideo(-1)}
            >
              <GalleryHorizontalEnd size={30} strokeWidth={1.8} />
            </button>
          ) : null}
          {isHifiMode ? (
            <>
              <div className="ambient-play-mode" role="group" aria-label="Player and playback mode">
                <button
                  className="ambient-play-mode-button"
                  type="button"
                  aria-label="Open player"
                  title="Player"
                  data-hifi-player-entry
                  tabIndex={ambientHudVisible ? 0 : -1}
                  onClick={handleOpenPlayerClick}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    handleOpenPlayerClick();
                  }}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    handleOpenPlayerClick();
                  }}
                >
                  <ListMusic size={22} strokeWidth={1.8} />
                </button>
                <button
                  className={`ambient-play-mode-button ${playMode === "repeat_one" ? "is-active" : ""}`}
                  type="button"
                  aria-label="Repeat current track"
                  title="Repeat current track"
                  aria-pressed={playMode === "repeat_one"}
                  tabIndex={ambientHudVisible ? 0 : -1}
                  disabled={isPlaybackPending}
                  onClick={() => handlePlayModeChange("repeat_one")}
                >
                  <Repeat1 size={22} strokeWidth={1.8} />
                </button>
                <button
                  className={`ambient-play-mode-button ${playMode === "shuffle" ? "is-active" : ""}`}
                  type="button"
                  aria-label="Shuffle playback"
                  title="Shuffle playback"
                  aria-pressed={playMode === "shuffle"}
                  tabIndex={ambientHudVisible ? 0 : -1}
                  disabled={isPlaybackPending}
                  onClick={() => handlePlayModeChange("shuffle")}
                >
                  <Shuffle size={22} strokeWidth={1.8} />
                </button>
              </div>
              {sourcePickerControl}
              <button
                className="ambient-transport-button ambient-transport-track ambient-transport-left"
                type="button"
                aria-label="Previous track"
                title={previousTrackTitle}
                tabIndex={ambientHudVisible ? 0 : -1}
                disabled={previousTrackDisabled}
                onClick={() => handleAmbientPlaybackAction("previous")}
              >
                <SkipBack size={33} fill="currentColor" strokeWidth={1.6} />
              </button>
              <button
                className="ambient-transport-button ambient-transport-play"
                type="button"
                aria-label={isPlaying ? "Pause" : "Play"}
                title={playPauseTitle}
                tabIndex={ambientHudVisible ? 0 : -1}
                disabled={playPauseDisabled}
                onClick={() => handleAmbientPlaybackAction("play_pause")}
              >
                {isPlaying ? <Pause size={34} fill="currentColor" strokeWidth={1.6} /> : <Play size={34} fill="currentColor" strokeWidth={1.6} />}
              </button>
              <button
                className="ambient-transport-button ambient-transport-track ambient-transport-right"
                type="button"
                aria-label="Next track"
                title={nextTrackTitle}
                tabIndex={ambientHudVisible ? 0 : -1}
                disabled={nextTrackDisabled}
                onClick={() => handleAmbientPlaybackAction("next")}
              >
                <SkipForward size={33} fill="currentColor" strokeWidth={1.6} />
              </button>
              <button
                className={`ambient-transport-button ambient-transport-setting ${playback.favorite ? "is-active" : ""}`}
                type="button"
                aria-label={playback.favorite ? "Remove favorite" : "Favorite"}
                title={playback.favorite ? "Remove favorite" : "Favorite"}
                aria-pressed={playback.favorite}
                tabIndex={ambientHudVisible ? 0 : -1}
                disabled={isPlaybackPending}
                onClick={() => handleAmbientPlaybackAction("favorite_toggle")}
              >
                <Heart size={25} fill={playback.favorite ? "currentColor" : "none"} strokeWidth={1.8} />
              </button>
              <button
                className={`ambient-transport-button ambient-transport-setting ${lyricsVisible ? "is-active" : ""}`}
                type="button"
                aria-label={lyricsVisible ? "Hide lyrics" : "Show lyrics"}
                title={lyricsVisible ? "Hide lyrics" : "Show lyrics"}
                aria-pressed={lyricsVisible}
                tabIndex={ambientHudVisible ? 0 : -1}
                onClick={toggleLyricsLayer}
              >
                {lyricsVisible ? <Captions size={25} strokeWidth={1.8} /> : <CaptionsOff size={25} strokeWidth={1.8} />}
              </button>
            </>
          ) : (
            <>
              <div className="ambient-transport-mode-copy" aria-live="polite">
                <strong>{roomModeLabel}</strong>
                <span>{roomModeIntent}</span>
              </div>
              {sourcePickerControl}
              <button
                className={`ambient-transport-button ambient-transport-setting ambient-transport-sound ${sceneSoundEnabled ? "is-active" : ""}`}
                type="button"
                aria-label={sceneSoundEnabled ? "Mute scene sound" : "Unmute scene sound"}
                title={sceneSoundEnabled ? "Mute scene sound" : "Unmute scene sound"}
                aria-pressed={sceneSoundEnabled}
                tabIndex={ambientHudVisible ? 0 : -1}
                disabled={sceneSoundPending || !hasSceneVideo}
                onClick={handleSceneSoundToggle}
              >
                {sceneSoundEnabled ? <Volume2 size={27} strokeWidth={1.8} /> : <VolumeX size={27} strokeWidth={1.8} />}
              </button>
            </>
          )}
          {!isHifiMode ? (
            <button
              className="ambient-transport-button ambient-transport-scene ambient-transport-scene-next"
              type="button"
              aria-label="Next scene"
              title="Next scene"
              tabIndex={ambientHudVisible ? 0 : -1}
              disabled={switchableBackgroundVideos.length <= 1}
              onClick={() => switchBackgroundVideo(1)}
            >
              <GalleryHorizontalEnd size={30} strokeWidth={1.8} />
            </button>
          ) : null}
        </div>
      </div>

      {clockVisible ? (
        <div className="ambient-clock" aria-label="Current time">
          <div className="ambient-time">{timeLabel}</div>
          <div className="ambient-date">{dateLabel}</div>
          <div className="ambient-scene-copy">{ambientClockSceneCopy}</div>
        </div>
      ) : null}

      <div className={`ambient-lyrics-layer lyrics-size-${lyricsFontSize}`} aria-live={showLyricsLayer ? "polite" : "off"} aria-hidden={!showLyricsLayer} data-ambient-lyrics>
        {showLyricsLayer ? (
          <div
            className={`ambient-lyrics-ticker ${shouldScrollTicker ? "is-scrolling" : "is-static"} ${lyrics.status === "error" ? "is-error" : ""}`}
            data-lyrics-state={lyrics.status}
            style={tickerStyle}
          >
            <div className="ambient-lyrics-marquee">
              <div className="ambient-lyrics-marquee-track">
                <span className="ambient-lyrics-text">{tickerText}</span>
                {shouldScrollTicker ? <span className="ambient-lyrics-text" aria-hidden="true">{tickerText}</span> : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {ambientSourcePillVisible && ambientSourcePillSourceId ? (
        <div
          className={`ambient-source-status-pill ${ambientSourcePillWaiting ? "is-waiting" : ""}`}
          role="status"
          aria-live="polite"
          data-ambient-source-status-pill
          data-ambient-source-status-source={ambientSourcePillSourceId}
        >
          <span className="ambient-source-status-icon" aria-hidden="true">
            {ambientSourcePillWaiting ? <LoaderCircle size={18} className="is-spinning" /> : <AmbientSourcePillIcon size={18} strokeWidth={1.9} />}
          </span>
          <span className="ambient-source-status-copy">
            <strong>{ambientSourcePillLabel}</strong>
            <span>{ambientSourcePillDetail}</span>
          </span>
        </div>
      ) : null}

      <div className="ambient-hud" aria-label="Mood switcher" data-room-mode={roomExperience.mode}>
        <div className="ambient-room-mode" aria-label="Mood">
          <div className="ambient-room-mode-buttons" role="group" aria-label="Choose room mode">
            {roomModeOptions.map((option) => {
              const Icon = roomModeIcons[option.mode];
              return (
                <button
                  className={roomExperience.mode === option.mode ? "is-active" : ""}
                  data-gesture-protected
                  key={option.mode}
                  type="button"
                  aria-label={`${option.label} room mode`}
                  aria-pressed={roomExperience.mode === option.mode}
                  title={`${option.label} - ${option.intent}`}
                  tabIndex={ambientHudVisible ? 0 : -1}
                  onClick={() => handleRoomModeChange(option.mode)}
                >
                  <Icon size={18} strokeWidth={1.8} />
                  <span>{option.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {adjustOverlay ? (
        <div className={`ambient-adjust-indicator ambient-adjust-${adjustOverlay.channel}`} aria-live="polite">
          <div className="ambient-adjust-indicator-icon">
            {adjustOverlay.channel === "volume" ? <Volume2 size={22} /> : <SunMedium size={22} />}
          </div>
          <div className="ambient-adjust-indicator-copy">
            <strong>{adjustOverlay.channel === "volume" ? "Volume" : "Brightness"}</strong>
            <span>{adjustOverlay.percent}%</span>
            {adjustOverlay.error || adjustOverlay.channel === "brightness" ? (
              <p>{adjustOverlay.error ?? "DDC/CI display level"}</p>
            ) : null}
          </div>
          <button
            className="ambient-adjust-back"
            type="button"
            data-gesture-protected
            data-ambient-adjust-back
            aria-label={`Close ${adjustOverlay.channel === "volume" ? "volume" : "brightness"} adjustment`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={handleAdjustBack}
          >
            <LogOut size={16} />
            <span>Back</span>
          </button>
        </div>
      ) : null}
    </section>
  );
}

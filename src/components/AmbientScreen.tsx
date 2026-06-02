import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Bluetooth, Captions, CaptionsOff, Cast, GalleryHorizontalEnd, Heart, LibraryBig, ListMusic, ListPlus, LoaderCircle, Moon, Music2, Network, Pause, Play, Radio as RadioIcon, Repeat1, Settings, Shuffle, SkipBack, SkipForward, SlidersHorizontal, SunMedium, Target, Volume2, VolumeX, Waves } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { fetchBackgroundVideos } from "../api/tikpalClient";
import { EqVisualScene } from "./EqVisualScene";
import { FlameScene } from "./FlameScene";
import { roomModeOptions } from "../roomExperienceTruth";
import type { TikpalDataStatus } from "../hooks/useTikpalState";
import type { AudioState, BackgroundVideoSummary, FontTheme, LyricsFontSize, LyricsState, PlaybackActionType, PlaybackMode, PlaybackSummary, RoomExperienceActionRequest, RoomExperienceState, RoomMode, SourceSwitchTarget, SystemActionType, SystemState, TikpalState } from "../types";

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
  sceneSoundEnabled: boolean;
  sceneSoundPending: boolean;
  sourcePickerOpenRequest: number;
  clockVisible: boolean;
  onPlaybackAction: (type: PlaybackActionType, value?: number, mode?: PlaybackMode) => Promise<TikpalState>;
  onSystemAction: (type: SystemActionType, value?: number) => Promise<TikpalState>;
  onSourceSwitch: (target: SourceSwitchTarget) => Promise<TikpalState>;
  onSourcePickerOpenChange?: (open: boolean) => void;
  onHudActivity: () => void;
  onLyricsVisibleChange: (visible: boolean) => void;
  onCurrentSceneVideoChange: (video: BackgroundVideoSummary) => void;
  onSceneSoundEnabledChange: (enabled: boolean) => void;
  onOpenSettings: () => void;
  onOpenPlaylist: () => void;
  roomExperience: RoomExperienceState;
  onExperienceAction: (action: RoomExperienceActionRequest) => Promise<RoomExperienceState>;
}

type AmbientAdjustChannel = "volume" | "brightness";
type AmbientMusicSourceTarget = Exclude<SourceSwitchTarget, "audio" | "scene">;
const BACKGROUND_VIDEO_REFRESH_MS = 30_000;
const BACKGROUND_VIDEO_REFRESH_EVENT = "tikpal:background-videos-refresh";
const SOURCE_PICKER_AUTO_CLOSE_MS = 5_000;

interface DragState {
  channel: AmbientAdjustChannel;
  pointerId: number;
  startY: number;
  startPercent: number;
}

interface AdjustOverlayState {
  channel: AmbientAdjustChannel;
  percent: number;
  error: string | null;
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

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function getAmbientSourceLabel(sourceId: SourceSwitchTarget) {
  return ambientMusicSources.find((source) => source.id === sourceId)?.label ?? "Source";
}

function getAmbientSourceStatusLabel(source: AudioState["currentSource"] | undefined, pending: boolean) {
  if (pending) return "Opening";
  if (!source) return "Unavailable";
  if (source.active) return "Active";
  if (source.connectionState === "connected") return "Connected";
  if (source.connectionState === "armed") return "Ready";
  if (source.connectionState === "blocked") return "Closed";
  if (source.availability === "unavailable") return "Unavailable";
  return "Ready";
}

function videoBelongsToRoomMode(video: BackgroundVideoSummary, mode: RoomMode) {
  return mode !== "hifi" && Boolean(video.src) && Array.isArray(video.roomModes) && video.roomModes.includes(mode);
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
  return sourceScope === "bluetooth_input" || sourceScope === "airplay_input";
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
  sceneSoundEnabled,
  sceneSoundPending,
  sourcePickerOpenRequest,
  clockVisible,
  onPlaybackAction,
  onSystemAction,
  onSourceSwitch,
  onSourcePickerOpenChange,
  onHudActivity,
  onLyricsVisibleChange,
  onCurrentSceneVideoChange,
  onSceneSoundEnabledChange,
  onOpenSettings,
  onOpenPlaylist,
  roomExperience,
  onExperienceAction
}: AmbientScreenProps) {
  const dragStateRef = useRef<DragState | null>(null);
  const adjustDismissTimerRef = useRef<number | null>(null);
  const sourcePickerRef = useRef<HTMLDivElement | null>(null);
  const lastSourcePickerOpenRequestRef = useRef(sourcePickerOpenRequest);
  const lastRoomSceneIdRef = useRef<string | null>(null);
  const selectedBackgroundVideoSrcRef = useRef(DEFAULT_BACKGROUND_VIDEO.src);
  const requestStateRef = useRef<Record<AmbientAdjustChannel, { inFlight: boolean; queued: number | null; lastSent: number | null }>>({
    volume: { inFlight: false, queued: null, lastSent: null },
    brightness: { inFlight: false, queued: null, lastSent: null }
  });
  const [adjustOverlay, setAdjustOverlay] = useState<AdjustOverlayState | null>(null);
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const [pendingAmbientSource, setPendingAmbientSource] = useState<AmbientMusicSourceTarget | null>(null);
  const [ambientSourceError, setAmbientSourceError] = useState<string | null>(null);
  const [backgroundVideos, setBackgroundVideos] = useState<BackgroundVideoSummary[]>([DEFAULT_BACKGROUND_VIDEO]);
  const [backgroundVideoIndex, setBackgroundVideoIndex] = useState(0);
  const [frozenLyricsLineIndex, setFrozenLyricsLineIndex] = useState<number | null>(null);
  const [staticLyricsLineIndex, setStaticLyricsLineIndex] = useState(0);
  const currentBackgroundVideo = backgroundVideos[backgroundVideoIndex] ?? DEFAULT_BACKGROUND_VIDEO;
  const isHifiMode = roomExperience.mode === "hifi";
  const modeBackgroundVideos = useMemo(() => (
    backgroundVideos.filter((video) => videoBelongsToRoomMode(video, roomExperience.mode))
  ), [backgroundVideos, roomExperience.mode]);
  const switchableBackgroundVideos = modeBackgroundVideos.length > 0
    ? modeBackgroundVideos
    : backgroundVideos.filter((video) => Boolean(video.src));
  const hasSceneVideo = Boolean(currentBackgroundVideo.src);
  const brightnessPercent = system.display.brightnessPercent;
  const audioProtectionMode = playback.source === "airplay" && playback.state === "playing";
  const canAdvanceLyrics = lyrics.synced
    && (playback.source === "mpd" || playback.source === "radio" || playback.source === "bluetooth" || playback.source === "airplay")
    && playback.state === "playing";
  const computedLyricsLineIndex = canAdvanceLyrics ? findActiveLyricsLineIndex(lyrics, playback.elapsedSeconds) : null;
  const activeLyricsLineIndex = canAdvanceLyrics ? computedLyricsLineIndex : frozenLyricsLineIndex;
  const activeLyricsLine = activeLyricsLineIndex !== null ? lyrics.lines[activeLyricsLineIndex] ?? null : null;
  const staticLyricsLines = lyrics.lines.map((line) => line.text.trim()).filter(Boolean);
  const staticLyricsText = staticLyricsLines.length > 0
    ? staticLyricsLines[staticLyricsLineIndex % staticLyricsLines.length] ?? ""
    : "";
  const roomModeLabel = roomModeOptions.find((option) => option.mode === roomExperience.mode)?.label ?? "Calm";
  const roomModeIntent = roomModeOptions.find((option) => option.mode === roomExperience.mode)?.intent ?? "Unwind & relax";
  const showSyncedLyrics = lyrics.status === "ready" && lyrics.synced && canAdvanceLyrics && Boolean(activeLyricsLine);
  const showStaticLyrics = lyrics.status === "ready" && Boolean(staticLyricsText) && (!lyrics.synced || !canAdvanceLyrics);
  const showIdentifiedTrack = (lyrics.status === "not_found" || lyrics.status === "error") && Boolean(lyrics.title || lyrics.artist);
  const recognizingMessage = isProxyInputLyricsSource(lyrics.sourceScope)
    ? `Listening to ${lyrics.sourceScope === "airplay_input" ? "AirPlay" : "Bluetooth"} audio...`
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
  const canShowLyricsLayer = isHifiMode && lyricsVisible;
  const showLyricsLayer = canShowLyricsLayer && Boolean(tickerText);
  const isPlaybackPending = status.pending;
  const isPlaying = playback.state === "playing";
  const playbackSettings = playback.settings ?? { playMode: "sequence" };
  const playMode = playbackSettings.playMode;
  const sceneAudioEnabled = hasSceneVideo && sceneVideoEnabled && sceneSoundEnabled && playback.source === "scene" && playback.state === "playing";
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
    if (nextIndex !== -1) {
      setBackgroundVideoIndex(nextIndex);
    }
  }

  function handleAmbientPlaybackAction(type: PlaybackActionType) {
    onHudActivity();
    if (isPlaybackPending) return;
    void onPlaybackAction(type);
  }

  function handlePlayModeChange(mode: PlaybackMode) {
    onHudActivity();
    if (isPlaybackPending || mode === playMode) return;
    void onPlaybackAction("play_mode_set", undefined, mode);
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

  async function handleAmbientSourceSelect(sourceId: AmbientMusicSourceTarget) {
    onHudActivity();
    if (status.pending || pendingAmbientSource) return;
    const source = audio.sources.find((entry) => entry.id === sourceId);
    if (source?.availability === "unavailable" || source?.controllability === "status-only") return;

    setPendingAmbientSource(sourceId);
    setAmbientSourceError(null);
    try {
      await onSourceSwitch(sourceId);
      setSourcePickerOpen(false);
    } catch (error) {
      setAmbientSourceError(error instanceof Error ? error.message : "Source switch failed");
    } finally {
      setPendingAmbientSource(null);
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
  }, [backgroundVideos.length, currentBackgroundVideo.id, hasSceneVideo, hudVisible, isHifiMode, isPlaybackPending, onHudActivity, onPlaybackAction, onSceneSoundEnabledChange, sceneSoundEnabled, sceneSoundPending, switchableBackgroundVideos.length]);

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
    if (sourcePickerOpenRequest === lastSourcePickerOpenRequestRef.current) return;
    lastSourcePickerOpenRequestRef.current = sourcePickerOpenRequest;
    if (sourcePickerOpenRequest <= 0 || isHifiMode) return;

    setAmbientSourceError(null);
    setSourcePickerOpen(true);
  }, [isHifiMode, sourcePickerOpenRequest]);

  useEffect(() => {
    if (!sourcePickerOpen) return undefined;

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
  }, [sourcePickerOpen]);

  function clearAdjustDismissTimer() {
    if (adjustDismissTimerRef.current !== null) {
      window.clearTimeout(adjustDismissTimerRef.current);
      adjustDismissTimerRef.current = null;
    }
  }

  function scheduleAdjustDismiss() {
    clearAdjustDismissTimer();
    adjustDismissTimerRef.current = window.setTimeout(() => {
      adjustDismissTimerRef.current = null;
      setAdjustOverlay((current) => (dragStateRef.current ? current : null));
    }, 850);
  }

  useEffect(() => () => {
    clearAdjustDismissTimer();
  }, []);

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

        if (target === null || target === requestState.lastSent) {
          requestState.inFlight = false;
          return;
        }

        try {
          requestState.lastSent = target;
          if (channel === "volume") {
            await onPlaybackAction("volume_set", target);
          } else {
            await onSystemAction("brightness_set", target);
          }

          setAdjustOverlay((current) => (
            current && current.channel === channel
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

        if (requestState.queued !== null && requestState.queued !== requestState.lastSent) {
          await sendNext();
          return;
        }

        requestState.inFlight = false;
      };

      void sendNext();
    },
    [onPlaybackAction, onSystemAction]
  );

  function startAdjust(channel: AmbientAdjustChannel, pointerId: number, startY: number) {
    const startPercent = channel === "volume" ? system.volume.percent : brightnessPercent;
    clearAdjustDismissTimer();
    dragStateRef.current = {
      channel,
      pointerId,
      startY,
      startPercent
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
    dispatchAdjust(dragState.channel, nextPercent);
  }

  function finishAdjust() {
    dragStateRef.current = null;
    scheduleAdjustDismiss();
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
        error: "DDC/CI brightness unavailable"
      });
      scheduleAdjustDismiss();
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
    dispatchAdjust(channel, nextPercent);
    scheduleAdjustDismiss();
  }

  function handleAmbientWheelCapture(event: React.WheelEvent<HTMLElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const edgeWidth = Math.min(560, Math.max(120, rect.width * 0.32));
    const localX = event.clientX - rect.left;
    if (localX <= edgeWidth) {
      applyWheelAdjust("volume", event);
      return;
    }
    if (localX >= rect.width - edgeWidth) {
      applyWheelAdjust("brightness", event);
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
          error: "DDC/CI brightness unavailable"
        });
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (event.currentTarget.setPointerCapture) {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      startAdjust(channel, event.pointerId, event.clientY);
    };
  }

  const handleZonePointerMove = useCallback<React.PointerEventHandler<HTMLDivElement>>((event) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    updateAdjust(event.clientY);
  }, [dispatchAdjust]);

  const handleZonePointerUp = useCallback<React.PointerEventHandler<HTMLDivElement>>((event) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    updateAdjust(event.clientY);
    finishAdjust();
  }, [dispatchAdjust]);

  const handleZonePointerCancel = useCallback<React.PointerEventHandler<HTMLDivElement>>((event) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    finishAdjust();
  }, []);

  const sourcePickerControl = (
    <div className="ambient-source-picker" ref={sourcePickerRef}>
      <button
        className={`ambient-transport-button ambient-transport-setting ambient-source-toggle ${sourcePickerOpen ? "is-active" : ""}`}
        type="button"
        aria-label="Choose audio source"
        title={`Source: ${currentAmbientSourceLabel}`}
        aria-expanded={sourcePickerOpen}
        data-ambient-source-toggle
        tabIndex={hudVisible ? 0 : -1}
        disabled={status.pending || pendingAmbientSource !== null}
        onClick={handleAmbientSourceToggle}
      >
        <Music2 size={25} strokeWidth={1.8} />
      </button>
      {sourcePickerOpen ? (
        <div className="ambient-source-picker-popover" role="menu" aria-label="Audio source picker" data-ambient-source-picker>
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
                    {pending ? <LoaderCircle size={23} className="is-spinning" /> : <Icon size={23} strokeWidth={1.8} />}
                  </span>
                  <strong>{label}</strong>
                  <span>{getAmbientSourceStatusLabel(source, pending)}</span>
                </button>
              );
            })}
          </div>
          {ambientSourceError ? <div className="ambient-source-error" role="status">{ambientSourceError}</div> : null}
        </div>
      ) : null}
    </div>
  );

  return (
    <section
      className={`ambient-screen ${hudVisible ? "is-hud-visible" : "is-hud-hidden"}`}
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
        />
      ) : (
        <FlameScene
          lowPower={audioProtectionMode}
          playback={playback}
          videoSrc={currentBackgroundVideo.src}
          videoEnabled={sceneVideoEnabled && hasSceneVideo}
          audioEnabled={sceneAudioEnabled}
          volumePercent={system.volume.percent}
        />
      )}
      {!isHifiMode && sceneVideoEnabled && hasSceneVideo ? <div className="ambient-vignette" /> : null}
      <div
        className="ambient-adjust-zone ambient-adjust-zone-left"
        data-gesture-protected
        aria-label="Swipe or scroll to change volume"
        onPointerDown={handleZonePointerDown("volume")}
        onPointerMove={handleZonePointerMove}
        onPointerUp={handleZonePointerUp}
        onPointerCancel={handleZonePointerCancel}
        onWheel={handleZoneWheel("volume")}
      />
      <div
        className={`ambient-adjust-zone ambient-adjust-zone-right ${system.display.controllable ? "" : "is-disabled"}`}
        data-gesture-protected
        aria-label="Swipe or scroll to change brightness"
        onPointerDown={handleZonePointerDown("brightness")}
        onPointerMove={handleZonePointerMove}
        onPointerUp={handleZonePointerUp}
        onPointerCancel={handleZonePointerCancel}
        onWheel={handleZoneWheel("brightness")}
      />

      <button className="icon-button ambient-settings" type="button" data-gesture-protected onClick={onOpenSettings} aria-label="Open settings" title="Settings">
        <Settings size={26} strokeWidth={1.8} />
      </button>

      <div
        className={`ambient-transport ${isHifiMode ? "is-hifi" : "is-room-mode"}`}
        data-gesture-protected
        aria-hidden={!hudVisible}
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
              tabIndex={hudVisible ? 0 : -1}
              disabled={switchableBackgroundVideos.length <= 1}
              onClick={() => switchBackgroundVideo(-1)}
            >
              <GalleryHorizontalEnd size={30} strokeWidth={1.8} />
            </button>
          ) : null}
          {isHifiMode ? (
            <>
              <div className="ambient-play-mode" role="group" aria-label="Playback mode">
                <button
                  className={`ambient-play-mode-button ${playMode === "sequence" ? "is-active" : ""}`}
                  type="button"
                  aria-label="Sequence playback"
                  title="Sequence playback"
                  aria-pressed={playMode === "sequence"}
                  tabIndex={hudVisible ? 0 : -1}
                  disabled={isPlaybackPending}
                  onClick={() => handlePlayModeChange("sequence")}
                >
                  <ListMusic size={22} strokeWidth={1.8} />
                </button>
                <button
                  className={`ambient-play-mode-button ${playMode === "repeat_one" ? "is-active" : ""}`}
                  type="button"
                  aria-label="Repeat current track"
                  title="Repeat current track"
                  aria-pressed={playMode === "repeat_one"}
                  tabIndex={hudVisible ? 0 : -1}
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
                  tabIndex={hudVisible ? 0 : -1}
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
                title="Previous track"
                tabIndex={hudVisible ? 0 : -1}
                disabled={isPlaybackPending}
                onClick={() => handleAmbientPlaybackAction("previous")}
              >
                <SkipBack size={33} fill="currentColor" strokeWidth={1.6} />
              </button>
              <button
                className="ambient-transport-button ambient-transport-play"
                type="button"
                aria-label={isPlaying ? "Pause" : "Play"}
                title={isPlaying ? "Pause" : "Play"}
                tabIndex={hudVisible ? 0 : -1}
                disabled={isPlaybackPending}
                onClick={() => handleAmbientPlaybackAction("play_pause")}
              >
                {isPlaying ? <Pause size={34} fill="currentColor" strokeWidth={1.6} /> : <Play size={34} fill="currentColor" strokeWidth={1.6} />}
              </button>
              <button
                className="ambient-transport-button ambient-transport-track ambient-transport-right"
                type="button"
                aria-label="Next track"
                title="Next track"
                tabIndex={hudVisible ? 0 : -1}
                disabled={isPlaybackPending}
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
                tabIndex={hudVisible ? 0 : -1}
                disabled={isPlaybackPending}
                onClick={() => handleAmbientPlaybackAction("favorite_toggle")}
              >
                <Heart size={25} fill={playback.favorite ? "currentColor" : "none"} strokeWidth={1.8} />
              </button>
              <button
                className="ambient-transport-button ambient-transport-setting"
                type="button"
                aria-label="Open playlist"
                title="Playlist"
                data-hifi-playlist-entry
                tabIndex={hudVisible ? 0 : -1}
                onClick={() => {
                  onHudActivity();
                  onOpenPlaylist();
                }}
              >
                <ListPlus size={25} strokeWidth={1.8} />
              </button>
              <button
                className={`ambient-transport-button ambient-transport-setting ${lyricsVisible ? "is-active" : ""}`}
                type="button"
                aria-label={lyricsVisible ? "Hide lyrics" : "Show lyrics"}
                title={lyricsVisible ? "Hide lyrics" : "Show lyrics"}
                aria-pressed={lyricsVisible}
                tabIndex={hudVisible ? 0 : -1}
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
                tabIndex={hudVisible ? 0 : -1}
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
              tabIndex={hudVisible ? 0 : -1}
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
                  tabIndex={hudVisible ? 0 : -1}
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
            <p>{adjustOverlay.error ?? (adjustOverlay.channel === "volume" ? "moOde live level" : "DDC/CI display level")}</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}

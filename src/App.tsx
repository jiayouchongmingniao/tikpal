import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AmbientScreen } from "./components/AmbientScreen";
import { PlayerOverlay } from "./components/PlayerOverlay";
import { PlaylistOverlay } from "./components/PlaylistOverlay";
import { QuickMenu } from "./components/QuickMenu";
import { QuickSettingsOverlay } from "./components/QuickSettingsOverlay";
import { StartupModeChooser } from "./components/StartupModeChooser";
import { useAppMode } from "./hooks/useAppMode";
import { useBrowserKioskGuard } from "./hooks/useBrowserKioskGuard";
import { useKioskGestures } from "./hooks/useKioskGestures";
import { useRoomExperience } from "./hooks/useRoomExperience";
import { useTikpalState } from "./hooks/useTikpalState";
import { sendKioskHeartbeat } from "./api/tikpalClient";
import type { AppMode, BackgroundVideoSummary, FontTheme, LyricsFontSize, RememberedAudioSource, RoomExperienceActionRequest, RoomMode, SourceSwitchTarget, SurfaceTheme, TikpalState } from "./types";

const FONT_THEME_STORAGE_KEY = "tikpal.fontTheme";
const SURFACE_THEME_STORAGE_KEY = "tikpal.surfaceTheme";
const LYRICS_VISIBLE_STORAGE_KEY = "tikpal.lyricsVisible.v3";
const LYRICS_FONT_SIZE_STORAGE_KEY = "tikpal.lyricsFontSize";
const SCENE_VIDEO_ENABLED_STORAGE_KEY = "tikpal.sceneVideoEnabled";
const CLOCK_VISIBLE_STORAGE_KEY = "tikpal.clockVisible";
const EXTERNAL_HANDOFF_TIMEOUT_MS = 60_000;
const EXTERNAL_HANDOFF_POLL_MS = 1_000;
const KIOSK_HEARTBEAT_MS = 10_000;
const EVENT_LOOP_LAG_SAMPLE_MS = 1_000;
const SOURCE_SWITCH_TARGETS = new Set<SourceSwitchTarget>(["mpd", "audio", "scene", "radio", "spotify", "bluetooth", "airplay", "upnp"]);
const EXTERNAL_HANDOFF_TARGETS = new Set<SourceSwitchTarget>(["spotify", "bluetooth", "airplay", "upnp"]);

const DEFAULT_SCENE_VIDEO: BackgroundVideoSummary = {
  id: "scene-empty",
  filename: "",
  label: "No scene video",
  src: ""
};

function readInitialMode(): AppMode {
  const mode = new URLSearchParams(window.location.search).get("mode");
  if (mode === "player" || mode === "playlist" || mode === "quickSettings" || mode === "quickMenu") return mode;
  return "ambient";
}

function readInitialFontTheme(): FontTheme {
  const savedTheme = window.localStorage.getItem(FONT_THEME_STORAGE_KEY);
  if (
    savedTheme === "system"
    || savedTheme === "hardware"
    || savedTheme === "precision"
    || savedTheme === "sans"
    || savedTheme === "serif"
    || savedTheme === "mono"
  ) {
    return savedTheme;
  }
  return "system";
}

function readInitialSurfaceTheme(): SurfaceTheme {
  const savedTheme = window.localStorage.getItem(SURFACE_THEME_STORAGE_KEY);
  if (savedTheme === "warm-gold" || savedTheme === "graphite-silver" || savedTheme === "ivory-studio") {
    return savedTheme;
  }
  return "warm-gold";
}

function readInitialLyricsVisible() {
  return readStoredBoolean(LYRICS_VISIBLE_STORAGE_KEY, true);
}

function readInitialLyricsFontSize(): LyricsFontSize {
  const savedSize = window.localStorage.getItem(LYRICS_FONT_SIZE_STORAGE_KEY);
  if (savedSize === "small" || savedSize === "medium" || savedSize === "large") {
    return savedSize;
  }
  return "medium";
}

function readStoredBoolean(key: string, fallback: boolean) {
  const savedValue = window.localStorage.getItem(key);
  if (savedValue === "true") return true;
  if (savedValue === "false") return false;
  return fallback;
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isSourceSwitchTarget(sourceId: string): sourceId is SourceSwitchTarget {
  return SOURCE_SWITCH_TARGETS.has(sourceId as SourceSwitchTarget);
}

function getSourceLabel(sourceId: SourceSwitchTarget) {
  switch (sourceId) {
    case "mpd":
      return "Library";
    case "audio":
      return "Audio";
    case "scene":
      return "Scene Sound";
    case "radio":
      return "Radio";
    case "spotify":
      return "Spotify Connect";
    case "bluetooth":
      return "Bluetooth";
    case "airplay":
      return "AirPlay";
    case "upnp":
      return "DLNA";
    default:
      return "source";
  }
}

function isExternalHandoffTarget(sourceId: SourceSwitchTarget): boolean {
  return EXTERNAL_HANDOFF_TARGETS.has(sourceId);
}

function isSourceHandoffReady(state: TikpalState, sourceId: SourceSwitchTarget) {
  const source = state.audio.sources.find((entry) => entry.id === sourceId);
  if (sourceId === "upnp") {
    return source?.connectionState === "connected" || source?.connectionState === "armed";
  }
  return source?.connectionState === "connected";
}

function getRollbackSourceTarget(state: TikpalState): SourceSwitchTarget {
  const currentSource = state.audio.currentSource;
  if (!isSourceSwitchTarget(currentSource.id)) return "mpd";
  if (isExternalHandoffTarget(currentSource.id) && currentSource.connectionState !== "connected") return "mpd";
  return currentSource.id;
}

function getRememberedSourceKey(source: RememberedAudioSource | null | undefined) {
  if (!source) return "";
  return [
    source.target,
    source.localTrackPath ?? "",
    source.radioStationId ?? "",
    source.updatedAt ?? ""
  ].join("|");
}

function shouldRestoreRememberedSource(state: TikpalState, rememberedSource: RememberedAudioSource | null | undefined) {
  if (!rememberedSource || !isSourceSwitchTarget(rememberedSource.target)) return false;
  if (rememberedSource.target === "mpd" && rememberedSource.localTrackPath) return true;
  if (state.audio.currentSource.id === rememberedSource.target) return false;
  return true;
}

function readActiveSceneVideoSnapshot() {
  const scene = document.querySelector(".flame-scene");
  const video = document.querySelector("video.flame-video.is-active")
    ?? document.querySelector("video.flame-video[data-flame-layer=\"active\"][data-flame-loop-role=\"active\"]")
    ?? document.querySelector(".flame-video-layer.is-active video.flame-video");
  if (!(video instanceof HTMLVideoElement)) {
    return {
      present: false,
      scenePresent: Boolean(scene),
      transition: scene?.getAttribute("data-flame-transition") ?? null,
      transitionPhase: scene?.getAttribute("data-flame-transition-phase") ?? null,
      sceneClass: scene?.className ?? null
    };
  }

  return {
    present: true,
    scenePresent: Boolean(scene),
    transition: scene?.getAttribute("data-flame-transition") ?? null,
    transitionPhase: scene?.getAttribute("data-flame-transition-phase") ?? null,
    src: video.currentSrc || video.src || null,
    currentTime: Number.isFinite(video.currentTime) ? video.currentTime : null,
    duration: Number.isFinite(video.duration) ? video.duration : null,
    readyState: video.readyState,
    networkState: video.networkState,
    paused: video.paused,
    ended: video.ended,
    muted: video.muted,
    health: video.dataset.flameVideoHealth ?? null,
    frameReady: video.dataset.flameFrameReady ?? null,
    sceneVolume: Number.isFinite(Number(video.dataset.sceneVolume)) ? Number(video.dataset.sceneVolume) : null
  };
}

export default function App() {
  const [now, setNow] = useState(() => new Date());
  const [fontTheme, setFontTheme] = useState<FontTheme>(readInitialFontTheme);
  const [surfaceTheme, setSurfaceTheme] = useState<SurfaceTheme>(readInitialSurfaceTheme);
  const [lyricsVisible, setLyricsVisible] = useState(readInitialLyricsVisible);
  const [lyricsFontSize, setLyricsFontSize] = useState<LyricsFontSize>(readInitialLyricsFontSize);
  const [sceneVideoEnabled, setSceneVideoEnabled] = useState(() => readStoredBoolean(SCENE_VIDEO_ENABLED_STORAGE_KEY, true));
  const [clockVisible, setClockVisible] = useState(() => readStoredBoolean(CLOCK_VISIBLE_STORAGE_KEY, true));
  const [sceneSoundPending, setSceneSoundPending] = useState(false);
  const [ambientSourcePickerRequest, setAmbientSourcePickerRequest] = useState(0);
  const [ambientSourcePickerOpen, setAmbientSourcePickerOpen] = useState(false);
  const [startupChooserVisible, setStartupChooserVisible] = useState(() => readInitialMode() === "ambient");
  const [activeSceneVideo, setActiveSceneVideo] = useState<BackgroundVideoSummary>(DEFAULT_SCENE_VIDEO);
  const sceneSoundPendingSinceRef = useRef<number | null>(null);
  const eventLoopLagRef = useRef(0);
  const heartbeatStateRef = useRef<Record<string, unknown>>({});
  const previousRoomModeRef = useRef<RoomMode | null>(null);
  const hifiRestoreKeyRef = useRef<string>("");
  const hifiRestoreInFlightRef = useRef(false);
  const { mode, hudVisible, idleTotalMs, idleRemainingMs, showHud, toggleHud, changeMode, returnAmbient, resetIdleTimer } = useAppMode(readInitialMode());
  const { state: tikpalState, status: tikpalStatus, refresh, sendPlaybackAction, sendSystemAction, sendSourceSwitch } = useTikpalState();
  const { experience: roomExperience, status: roomExperienceStatus, refresh: refreshRoomExperience, sendExperienceAction } = useRoomExperience();

  useBrowserKioskGuard();

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let expectedAt = window.performance.now() + EVENT_LOOP_LAG_SAMPLE_MS;
    const interval = window.setInterval(() => {
      const nowMs = window.performance.now();
      eventLoopLagRef.current = Math.max(0, nowMs - expectedAt);
      expectedAt = nowMs + EVENT_LOOP_LAG_SAMPLE_MS;
    }, EVENT_LOOP_LAG_SAMPLE_MS);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    heartbeatStateRef.current = {
      mode,
      roomMode: roomExperience.mode,
      roomPhase: roomExperience.phase,
      roomUpdatedAt: roomExperience.updatedAt,
      sceneVideoId: roomExperience.sceneVideoId,
      sceneSoundEnabled: roomExperience.sceneSoundEnabled,
      sceneVideoEnabled,
      playbackSource: tikpalState.playback.source,
      playbackState: tikpalState.playback.state,
      playbackTitle: tikpalState.playback.title,
      audioSourceId: tikpalState.audio.currentSource.id,
      activeSceneVideoId: activeSceneVideo.id,
      activeSceneVideoLabel: activeSceneVideo.label,
      activeSceneVideoSrc: activeSceneVideo.src,
      tikpalStatus,
      roomExperienceStatus,
      sceneSoundPending,
      sceneSoundPendingSinceMs: sceneSoundPendingSinceRef.current
    };
  });

  useEffect(() => {
    function buildPendingSnapshot(nowMs: number) {
      const snapshot = heartbeatStateRef.current;
      const sceneSoundPendingSnapshot = snapshot.sceneSoundPending === true;
      const sceneSoundPendingSinceMs = typeof snapshot.sceneSoundPendingSinceMs === "number"
        ? snapshot.sceneSoundPendingSinceMs
        : null;
      const tikpalStatusSnapshot = snapshot.tikpalStatus as typeof tikpalStatus | undefined;
      const roomStatusSnapshot = snapshot.roomExperienceStatus as typeof roomExperienceStatus | undefined;

      if (sceneSoundPendingSnapshot) {
        return {
          active: true,
          kind: "scene_sound",
          sinceMs: sceneSoundPendingSinceMs,
          durationMs: sceneSoundPendingSinceMs ? nowMs - sceneSoundPendingSinceMs : null
        };
      }

      if (tikpalStatusSnapshot?.pending) {
        const sinceMs = tikpalStatusSnapshot.pendingSinceMs;
        return {
          active: true,
          kind: tikpalStatusSnapshot.pendingAction ?? "tikpal",
          sinceMs,
          durationMs: sinceMs ? nowMs - sinceMs : null
        };
      }

      if (roomStatusSnapshot?.pending) {
        const sinceMs = roomStatusSnapshot.pendingSinceMs;
        return {
          active: true,
          kind: roomStatusSnapshot.pendingAction ?? "experience",
          sinceMs,
          durationMs: sinceMs ? nowMs - sinceMs : null
        };
      }

      return {
        active: false,
        kind: null,
        sinceMs: null,
        durationMs: null
      };
    }

    function postHeartbeat() {
      const nowMs = Date.now();
      const snapshot = heartbeatStateRef.current;
      const tikpalStatusSnapshot = snapshot.tikpalStatus as typeof tikpalStatus | undefined;
      const roomStatusSnapshot = snapshot.roomExperienceStatus as typeof roomExperienceStatus | undefined;

      void sendKioskHeartbeat({
        clientSentAtMs: nowMs,
        path: window.location.pathname,
        visibility: document.visibilityState,
        pageMode: snapshot.mode ?? "ambient",
        room: {
          mode: snapshot.roomMode ?? "calm",
          phase: snapshot.roomPhase ?? "idle",
          updatedAt: snapshot.roomUpdatedAt ?? null
        },
        playback: {
          source: snapshot.playbackSource ?? null,
          state: snapshot.playbackState ?? null,
          title: snapshot.playbackTitle ?? null
        },
        source: {
          current: snapshot.audioSourceId ?? null
        },
        scene: {
          videoId: snapshot.sceneVideoId ?? null,
          activeVideoId: snapshot.activeSceneVideoId ?? null,
          activeVideoLabel: snapshot.activeSceneVideoLabel ?? null,
          activeVideoSrc: snapshot.activeSceneVideoSrc ?? null,
          sceneSoundEnabled: snapshot.sceneSoundEnabled === true,
          sceneVideoEnabled: snapshot.sceneVideoEnabled === true
        },
        status: {
          systemStateSource: tikpalStatusSnapshot?.source ?? "fallback",
          systemStateError: tikpalStatusSnapshot?.error ?? null,
          lastSystemStateSuccessAtMs: tikpalStatusSnapshot?.lastSuccessAtMs ?? null,
          roomStateSource: roomStatusSnapshot?.source ?? "fallback",
          roomStateError: roomStatusSnapshot?.error ?? null,
          lastRoomStateSuccessAtMs: roomStatusSnapshot?.lastSuccessAtMs ?? null,
          pending: buildPendingSnapshot(nowMs)
        },
        eventLoop: {
          lagMs: eventLoopLagRef.current
        },
        activeSceneVideo: readActiveSceneVideoSnapshot()
      }).catch(() => {
        // The kiosk watchdog treats stale heartbeats as unhealthy; the UI should not surface this.
      });
    }

    const initialTimer = window.setTimeout(postHeartbeat, 1500);
    const interval = window.setInterval(postHeartbeat, KIOSK_HEARTBEAT_MS);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.fontTheme = fontTheme;
    window.localStorage.setItem(FONT_THEME_STORAGE_KEY, fontTheme);
  }, [fontTheme]);

  useEffect(() => {
    document.documentElement.dataset.surfaceTheme = surfaceTheme;
    window.localStorage.setItem(SURFACE_THEME_STORAGE_KEY, surfaceTheme);
  }, [surfaceTheme]);

  useEffect(() => {
    window.localStorage.setItem(LYRICS_VISIBLE_STORAGE_KEY, lyricsVisible ? "true" : "false");
  }, [lyricsVisible]);

  useEffect(() => {
    window.localStorage.setItem(LYRICS_FONT_SIZE_STORAGE_KEY, lyricsFontSize);
  }, [lyricsFontSize]);

  useEffect(() => {
    window.localStorage.setItem(SCENE_VIDEO_ENABLED_STORAGE_KEY, sceneVideoEnabled ? "true" : "false");
  }, [sceneVideoEnabled]);

  useEffect(() => {
    window.localStorage.setItem(CLOCK_VISIBLE_STORAGE_KEY, clockVisible ? "true" : "false");
  }, [clockVisible]);

  const activeTimeZone = roomExperience.nightSchedule.timeZone;
  const timeFormatter = useMemo(() => new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: activeTimeZone
  }), [activeTimeZone]);
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
    timeZone: activeTimeZone
  }), [activeTimeZone]);
  const timeLabel = useMemo(() => timeFormatter.format(now), [now, timeFormatter]);
  const dateLabel = useMemo(() => dateFormatter.format(now), [dateFormatter, now]);

  const handleCurrentSceneVideoChange = useCallback((video: BackgroundVideoSummary) => {
    setActiveSceneVideo(video);
  }, []);

  const handleSourceSwitch = useCallback(async (
    target: SourceSwitchTarget,
    radioStationId?: string,
    localTrackPath?: string,
    sceneVideo?: BackgroundVideoSummary
  ) => {
    const previousTarget = getRollbackSourceTarget(tikpalState);
    const nextState = await sendSourceSwitch(target, radioStationId, localTrackPath, sceneVideo);

    if (isExternalHandoffTarget(target) && !isSourceHandoffReady(nextState, target)) {
      const deadline = Date.now() + EXTERNAL_HANDOFF_TIMEOUT_MS;
      let latestState = nextState;

      while (Date.now() < deadline) {
        await delay(EXTERNAL_HANDOFF_POLL_MS);
        const refreshedState = await refresh();
        if (!refreshedState) continue;
        latestState = refreshedState;
        if (isSourceHandoffReady(latestState, target)) {
          await refreshRoomExperience();
          return latestState;
        }
      }

      try {
        await sendSourceSwitch(previousTarget);
        if (previousTarget !== "scene") {
          await refreshRoomExperience();
        }
      } catch {
        await refresh();
      }

      throw new Error(`No ${getSourceLabel(target)} connection detected. Returned to ${getSourceLabel(previousTarget)}.`);
    }

    if (target !== "scene") {
      await refreshRoomExperience();
    }
    return nextState;
  }, [refresh, refreshRoomExperience, sendSourceSwitch, tikpalState.audio.currentSource.connectionState, tikpalState.audio.currentSource.id]);

  useEffect(() => {
    const previousMode = previousRoomModeRef.current;
    previousRoomModeRef.current = roomExperience.mode;
    if (roomExperience.mode !== "hifi") {
      hifiRestoreKeyRef.current = "";
      return;
    }

    const rememberedSource = tikpalState.audio.rememberedSource;
    if (!rememberedSource) return;
    const restoreKey = getRememberedSourceKey(rememberedSource);
    const enteredHifi = previousMode !== "hifi";
    if (!enteredHifi || !restoreKey || hifiRestoreKeyRef.current === restoreKey || hifiRestoreInFlightRef.current) return;
    if (!shouldRestoreRememberedSource(tikpalState, rememberedSource)) return;

    hifiRestoreKeyRef.current = restoreKey;
    hifiRestoreInFlightRef.current = true;
    void (async () => {
      try {
        await handleSourceSwitch(
          rememberedSource.target,
          rememberedSource.radioStationId ?? undefined,
          rememberedSource.localTrackPath ?? undefined
        );
      } catch (error) {
        if (rememberedSource.target === "mpd" && rememberedSource.localTrackPath) {
          try {
            await handleSourceSwitch("mpd");
          } catch {
            // The normal status refresh will surface any remaining backend problem.
          }
        }
      } finally {
        hifiRestoreInFlightRef.current = false;
      }
    })();
  }, [handleSourceSwitch, roomExperience.mode, tikpalState]);

  async function handleSceneSoundEnabledChange(enabled: boolean) {
    if (sceneSoundPending) return;
    if (enabled && roomExperience.mode === "hifi") {
      return;
    }
    sceneSoundPendingSinceRef.current = Date.now();
    setSceneSoundPending(true);

    try {
      if (enabled) {
        setSceneVideoEnabled(true);
      }
      await handleRoomExperienceAction({
        type: "set_scene_sound",
        sceneSoundEnabled: enabled,
        sceneVideoId: activeSceneVideo.id
      });
    } catch {
      // The next API refresh will surface the backend error state if the Pi rejects the switch.
    } finally {
      sceneSoundPendingSinceRef.current = null;
      setSceneSoundPending(false);
    }
  }

  function handleSceneVideoEnabledChange(enabled: boolean) {
    if (!enabled && roomExperience.sceneSoundEnabled) {
      setSceneVideoEnabled(false);
      void handleSceneSoundEnabledChange(false);
      return;
    }

    setSceneVideoEnabled(enabled);
  }

  const handleRoomExperienceAction = useCallback(
    async (action: RoomExperienceActionRequest) => {
      const nextExperience = await sendExperienceAction(action);
      await refresh();
      return nextExperience;
    },
    [refresh, sendExperienceAction]
  );

  const handleStartupModeSelect = useCallback(async (nextMode: RoomMode) => {
    setStartupChooserVisible(false);
    try {
      await handleRoomExperienceAction({ type: "set_mode", mode: nextMode });
    } catch {
      setStartupChooserVisible(true);
    }
  }, [handleRoomExperienceAction]);
  const handleStartupModeAutoDismiss = useCallback(() => {
    setStartupChooserVisible(false);
  }, []);

  const handleAmbientTap = useCallback(() => {
    if (mode === "ambient" && roomExperience.mode !== "hifi") {
      showHud();
      if (!ambientSourcePickerOpen) {
        setAmbientSourcePickerRequest((request) => request + 1);
      }
      return;
    }

    toggleHud();
  }, [ambientSourcePickerOpen, mode, roomExperience.mode, showHud, toggleHud]);

  const { gesturePreview, ...gestureHandlers } = useKioskGestures({
    mode,
    onOpenPlayer: () => changeMode("player"),
    onOpenPlaylist: () => changeMode("playlist"),
    onOpenMenu: () => changeMode("quickMenu"),
    onReturnAmbient: returnAmbient,
    onToggleHud: handleAmbientTap,
    onActivity: () => resetIdleTimer(mode)
  });

  return (
    <main className="app-root" {...gestureHandlers}>
      <AmbientScreen
        hudVisible={hudVisible}
        timeLabel={timeLabel}
        dateLabel={dateLabel}
        playback={tikpalState.playback}
        lyrics={tikpalState.lyrics}
        lyricsVisible={lyricsVisible}
        lyricsFontSize={lyricsFontSize}
        fontTheme={fontTheme}
        audio={tikpalState.audio}
        system={tikpalState.system}
        status={tikpalStatus}
        sceneVideoEnabled={sceneVideoEnabled}
        sceneVideoStableLoop={tikpalState.runtime.apiMode === "mpc"}
        sceneSoundEnabled={roomExperience.sceneSoundEnabled}
        sceneSoundPending={sceneSoundPending || tikpalStatus.pending}
        sourcePickerOpenRequest={ambientSourcePickerRequest}
        clockVisible={clockVisible}
        onPlaybackAction={sendPlaybackAction}
        onSystemAction={sendSystemAction}
        onSourceSwitch={handleSourceSwitch}
        onSourcePickerOpenChange={setAmbientSourcePickerOpen}
        onHudActivity={showHud}
        onLyricsVisibleChange={setLyricsVisible}
        onCurrentSceneVideoChange={handleCurrentSceneVideoChange}
        onSceneSoundEnabledChange={(enabled) => void handleSceneSoundEnabledChange(enabled)}
        onOpenSettings={() => changeMode("quickSettings")}
        onOpenPlaylist={() => changeMode("playlist")}
        roomExperience={roomExperience}
        onExperienceAction={handleRoomExperienceAction}
      />
      <StartupModeChooser
        active={startupChooserVisible && mode === "ambient"}
        pending={tikpalStatus.pending}
        selectedMode={roomExperience.mode}
        onAutoDismiss={handleStartupModeAutoDismiss}
        onSelectMode={handleStartupModeSelect}
      />

      <PlayerOverlay
        active={mode === "player"}
        playback={tikpalState.playback}
        audio={tikpalState.audio}
        system={tikpalState.system}
        status={tikpalStatus}
        fontTheme={fontTheme}
        onPlaybackAction={sendPlaybackAction}
        onSourceSwitch={handleSourceSwitch}
        onOpenPlaylist={() => changeMode("playlist")}
        onReturnAmbient={returnAmbient}
      />
      <PlaylistOverlay
        active={mode === "playlist"}
        playback={tikpalState.playback}
        roomExperience={roomExperience}
        status={tikpalStatus}
        onExperienceAction={handleRoomExperienceAction}
        onPlaybackRefresh={async () => {
          await refresh();
        }}
        onReturnAmbient={returnAmbient}
      />
      <QuickSettingsOverlay
        active={mode === "quickSettings"}
        system={tikpalState.system}
        runtime={tikpalState.runtime}
        status={tikpalStatus}
        fontTheme={fontTheme}
        surfaceTheme={surfaceTheme}
        lyricsVisible={lyricsVisible}
        lyricsFontSize={lyricsFontSize}
        roomExperience={roomExperience}
        onFontThemeChange={setFontTheme}
        onSurfaceThemeChange={setSurfaceTheme}
        onLyricsVisibleChange={setLyricsVisible}
        onLyricsFontSizeChange={setLyricsFontSize}
        onExperienceAction={handleRoomExperienceAction}
        onSystemAction={sendSystemAction}
        onReturnAmbient={returnAmbient}
      />
      <QuickMenu
        active={mode === "quickMenu"}
        sceneVideoEnabled={sceneVideoEnabled}
        clockVisible={clockVisible}
        sceneSoundEnabled={roomExperience.sceneSoundEnabled}
        sceneSoundPending={sceneSoundPending || tikpalStatus.pending}
        roomMode={roomExperience.mode}
        onSceneVideoEnabledChange={handleSceneVideoEnabledChange}
        onClockVisibleChange={setClockVisible}
        onSceneSoundEnabledChange={(enabled) => void handleSceneSoundEnabledChange(enabled)}
        onClose={returnAmbient}
      />

      <div className={`gesture-cue ${gesturePreview ? "is-visible" : ""}`} aria-hidden={!gesturePreview}>
        <span>{gesturePreview?.label ?? ""}</span>
        <div className="gesture-cue-track">
          <i style={{ width: `${(gesturePreview?.progress ?? 0) * 100}%` }} />
        </div>
      </div>

      <div className={`idle-meter ${idleTotalMs && mode !== "ambient" ? "is-visible" : ""}`} aria-hidden={mode === "ambient"}>
        <span>{Math.ceil((idleRemainingMs ?? 0) / 1000)}s</span>
        <div className="idle-meter-track">
          <i style={{ width: `${idleTotalMs ? 100 - ((idleRemainingMs ?? 0) / idleTotalMs) * 100 : 0}%` }} />
        </div>
      </div>
    </main>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
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
import type { AppMode, BackgroundVideoSummary, FontTheme, LyricsFontSize, RoomExperienceActionRequest, RoomMode, SourceSwitchTarget, SurfaceTheme, TikpalState } from "./types";

const FONT_THEME_STORAGE_KEY = "tikpal.fontTheme";
const SURFACE_THEME_STORAGE_KEY = "tikpal.surfaceTheme";
const LYRICS_VISIBLE_STORAGE_KEY = "tikpal.lyricsVisible.v2";
const LYRICS_FONT_SIZE_STORAGE_KEY = "tikpal.lyricsFontSize";
const SCENE_VIDEO_ENABLED_STORAGE_KEY = "tikpal.sceneVideoEnabled";
const CLOCK_VISIBLE_STORAGE_KEY = "tikpal.clockVisible";
const EXTERNAL_HANDOFF_TIMEOUT_MS = 60_000;
const EXTERNAL_HANDOFF_POLL_MS = 1_000;
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
  return window.localStorage.getItem(LYRICS_VISIBLE_STORAGE_KEY) === "true";
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
  return source?.connectionState === "connected";
}

function getRollbackSourceTarget(state: TikpalState): SourceSwitchTarget {
  const currentSource = state.audio.currentSource;
  if (!isSourceSwitchTarget(currentSource.id)) return "mpd";
  if (isExternalHandoffTarget(currentSource.id) && currentSource.connectionState !== "connected") return "mpd";
  return currentSource.id;
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
  const { mode, hudVisible, idleTotalMs, idleRemainingMs, showHud, toggleHud, changeMode, returnAmbient, resetIdleTimer } = useAppMode(readInitialMode());
  const { state: tikpalState, status: tikpalStatus, refresh, sendPlaybackAction, sendSystemAction, sendSourceSwitch } = useTikpalState();
  const { experience: roomExperience, refresh: refreshRoomExperience, sendExperienceAction } = useRoomExperience();

  useBrowserKioskGuard();

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(interval);
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

  async function handleSceneSoundEnabledChange(enabled: boolean) {
    if (sceneSoundPending) return;
    if (enabled && roomExperience.mode === "hifi") {
      return;
    }
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

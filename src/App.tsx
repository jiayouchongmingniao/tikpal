import { useCallback, useEffect, useMemo, useState } from "react";
import { AmbientScreen } from "./components/AmbientScreen";
import { PlayerOverlay } from "./components/PlayerOverlay";
import { QuickMenu } from "./components/QuickMenu";
import { QuickSettingsOverlay } from "./components/QuickSettingsOverlay";
import { useAppMode } from "./hooks/useAppMode";
import { useBrowserKioskGuard } from "./hooks/useBrowserKioskGuard";
import { useKioskGestures } from "./hooks/useKioskGestures";
import { useTikpalState } from "./hooks/useTikpalState";
import type { AppMode, BackgroundVideoSummary, FontTheme, LyricsFontSize, SurfaceTheme } from "./types";

const FONT_THEME_STORAGE_KEY = "tikpal.fontTheme";
const SURFACE_THEME_STORAGE_KEY = "tikpal.surfaceTheme";
const LYRICS_VISIBLE_STORAGE_KEY = "tikpal.lyricsVisible.v2";
const LYRICS_FONT_SIZE_STORAGE_KEY = "tikpal.lyricsFontSize";
const SCENE_VIDEO_ENABLED_STORAGE_KEY = "tikpal.sceneVideoEnabled";
const CLOCK_VISIBLE_STORAGE_KEY = "tikpal.clockVisible";

const DEFAULT_SCENE_VIDEO: BackgroundVideoSummary = {
  id: "output_2560x720-4k",
  filename: "output_2560x720-4k.mp4",
  label: "output_2560x720-4k.mp4",
  src: "/assets/output_2560x720-4k.mp4"
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "2-digit",
  day: "2-digit",
  weekday: "long"
});

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

function readInitialMode(): AppMode {
  const mode = new URLSearchParams(window.location.search).get("mode");
  if (mode === "player" || mode === "quickSettings" || mode === "quickMenu") return mode;
  return "ambient";
}

function readInitialFontTheme(): FontTheme {
  const savedTheme = window.localStorage.getItem(FONT_THEME_STORAGE_KEY);
  if (savedTheme === "sans" || savedTheme === "serif" || savedTheme === "mono") {
    return savedTheme;
  }
  return "sans";
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

export default function App() {
  const [now, setNow] = useState(() => new Date());
  const [fontTheme, setFontTheme] = useState<FontTheme>(readInitialFontTheme);
  const [surfaceTheme, setSurfaceTheme] = useState<SurfaceTheme>(readInitialSurfaceTheme);
  const [lyricsVisible, setLyricsVisible] = useState(readInitialLyricsVisible);
  const [lyricsFontSize, setLyricsFontSize] = useState<LyricsFontSize>(readInitialLyricsFontSize);
  const [sceneVideoEnabled, setSceneVideoEnabled] = useState(() => readStoredBoolean(SCENE_VIDEO_ENABLED_STORAGE_KEY, true));
  const [clockVisible, setClockVisible] = useState(() => readStoredBoolean(CLOCK_VISIBLE_STORAGE_KEY, true));
  const [sceneSoundEnabled, setSceneSoundEnabled] = useState(false);
  const [sceneSoundPending, setSceneSoundPending] = useState(false);
  const [activeSceneVideo, setActiveSceneVideo] = useState<BackgroundVideoSummary>(DEFAULT_SCENE_VIDEO);
  const { mode, hudVisible, idleTotalMs, idleRemainingMs, showHud, toggleHud, changeMode, returnAmbient, resetIdleTimer } = useAppMode(readInitialMode());
  const { state: tikpalState, status: tikpalStatus, sendPlaybackAction, sendSystemAction, sendSourceSwitch } = useTikpalState();

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

  useEffect(() => {
    if (sceneSoundEnabled && (tikpalState.playback.source !== "scene" || tikpalState.playback.state !== "playing")) {
      setSceneSoundEnabled(false);
    }
  }, [sceneSoundEnabled, tikpalState.playback.source, tikpalState.playback.state]);

  const timeLabel = useMemo(() => timeFormatter.format(now), [now]);
  const dateLabel = useMemo(() => dateFormatter.format(now), [now]);

  const handleCurrentSceneVideoChange = useCallback((video: BackgroundVideoSummary) => {
    setActiveSceneVideo(video);
  }, []);

  const stopSceneSound = useCallback(async () => {
    setSceneSoundEnabled(false);
    if (tikpalState.playback.source !== "scene") return;
    try {
      await sendSourceSwitch("mpd");
    } catch {
      // The local video is already muted; the next API refresh will reconcile source state.
    }
  }, [sendSourceSwitch, tikpalState.playback.source]);

  async function handleSceneSoundEnabledChange(enabled: boolean) {
    if (sceneSoundPending) return;
    setSceneSoundPending(true);

    try {
      if (!enabled) {
        await stopSceneSound();
        return;
      }

      setSceneVideoEnabled(true);
      const nextState = await sendSourceSwitch("scene", undefined, undefined, activeSceneVideo);
      setSceneSoundEnabled(nextState.playback.source === "scene" && nextState.playback.state === "playing");
    } catch {
      setSceneSoundEnabled(false);
    } finally {
      setSceneSoundPending(false);
    }
  }

  function handleSceneVideoEnabledChange(enabled: boolean) {
    if (!enabled && sceneSoundEnabled) {
      setSceneSoundEnabled(false);
      setSceneVideoEnabled(false);
      void stopSceneSound();
      return;
    }

    setSceneVideoEnabled(enabled);
  }

  const { gesturePreview, ...gestureHandlers } = useKioskGestures({
    mode,
    onOpenPlayer: () => changeMode("player"),
    onOpenSettings: () => changeMode("quickSettings"),
    onOpenMenu: () => changeMode("quickMenu"),
    onReturnAmbient: returnAmbient,
    onToggleHud: toggleHud,
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
        sceneSoundEnabled={sceneSoundEnabled}
        clockVisible={clockVisible}
        onPlaybackAction={sendPlaybackAction}
        onSystemAction={sendSystemAction}
        onHudActivity={showHud}
        onLyricsVisibleChange={setLyricsVisible}
        onCurrentSceneVideoChange={handleCurrentSceneVideoChange}
        onOpenSettings={() => changeMode("quickSettings")}
      />

      <PlayerOverlay
        active={mode === "player"}
        playback={tikpalState.playback}
        audio={tikpalState.audio}
        system={tikpalState.system}
        status={tikpalStatus}
        fontTheme={fontTheme}
        onPlaybackAction={sendPlaybackAction}
        onSourceSwitch={sendSourceSwitch}
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
        onFontThemeChange={setFontTheme}
        onSurfaceThemeChange={setSurfaceTheme}
        onLyricsVisibleChange={setLyricsVisible}
        onLyricsFontSizeChange={setLyricsFontSize}
        onSystemAction={sendSystemAction}
        onReturnAmbient={returnAmbient}
      />
      <QuickMenu
        active={mode === "quickMenu"}
        sceneVideoEnabled={sceneVideoEnabled}
        clockVisible={clockVisible}
        sceneSoundEnabled={sceneSoundEnabled}
        sceneSoundPending={sceneSoundPending || tikpalStatus.pending}
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

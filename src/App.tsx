import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AmbientScreen } from "./components/AmbientScreen";
import { PlayerOverlay } from "./components/PlayerOverlay";
import { QuickMenu } from "./components/QuickMenu";
import { QuickSettingsOverlay } from "./components/QuickSettingsOverlay";
import { StartupModeChooser } from "./components/StartupModeChooser";
import { OnboardingGuide } from "./components/OnboardingGuide";
import { HUD_AUTO_HIDE_MS, HUD_SOURCE_PICKER_AUTO_HIDE_MS, useAppMode } from "./hooks/useAppMode";
import { useBrowserKioskGuard } from "./hooks/useBrowserKioskGuard";
import { useKioskGestures } from "./hooks/useKioskGestures";
import { useRoomExperience } from "./hooks/useRoomExperience";
import { useTikpalState } from "./hooks/useTikpalState";
import { fetchWebModeState, sendKioskHeartbeat, sendWebModeAction } from "./api/tikpalClient";
import { createExploreOpenRequestId, ExploreOpenVeilController } from "./exploreOpenVeil";
import { useI18n } from "./i18n";
import type { AppMode, BackgroundVideoSummary, DisplaySleepStyle, LyricsFontSize, RememberedAudioSource, RoomExperienceActionRequest, RoomExperienceState, RoomMode, SourceSwitchTarget, SurfaceTheme, TikpalState, WebModeState } from "./types";

const SURFACE_THEME_STORAGE_KEY = "tikpal.surfaceTheme";
const LYRICS_VISIBLE_STORAGE_KEY = "tikpal.lyricsVisible.v3";
const LYRICS_VISIBLE_AUTO_RESTORE_KEY = "tikpal.lyricsVisible.autoRestored.v1";
const LYRICS_VISIBLE_READY_RESTORE_KEY = "tikpal.lyricsVisible.readyRestored.v1";
const LYRICS_FONT_SIZE_STORAGE_KEY = "tikpal.lyricsFontSize";
const SCENE_VIDEO_ENABLED_STORAGE_KEY = "tikpal.sceneVideoEnabled";
const CLOCK_VISIBLE_STORAGE_KEY = "tikpal.clockVisible";
const QUICK_MENU_VOLUME_RESTORE_STORAGE_KEY = "tikpal.quickMenuVolumeRestore";
const QUICK_MENU_BRIGHTNESS_RESTORE_STORAGE_KEY = "tikpal.quickMenuBrightnessRestore";
const ONBOARDING_STORAGE_KEY = "tikpal.onboardingDismissed.v1";
const DEFAULT_QUICK_MENU_RESTORE_VOLUME_PERCENT = 35;
const DEFAULT_QUICK_MENU_RESTORE_BRIGHTNESS_PERCENT = 72;
const EXTERNAL_HANDOFF_TIMEOUT_MS = 60_000;
const EXTERNAL_HANDOFF_POLL_MS = 1_000;
const KIOSK_HEARTBEAT_MS = 10_000;
const EXPLORE_OPEN_OVERLAY_MAX_MS = 8_000;
const EVENT_LOOP_LAG_SAMPLE_MS = 1_000;
const DISPLAY_SLEEP_CHECK_MS = 5_000;
const SCREEN_SAVER_PREVIEW_INTERVAL_MS = 8_000;

function logExploreOpenVeil(stage: string, requestId: string, detail = "") {
  console.info(`[tikpal-explore-veil] ${JSON.stringify({ stage, requestId, ...(detail ? { detail } : {}), timestamp: new Date().toISOString() })}`);
}
const WEB_MODE_IDLE_POLL_MS = 2_000;
const WEB_MODE_ACTIVE_POLL_MS = 350;
const SOURCE_SWITCH_TARGETS = new Set<SourceSwitchTarget>(["mpd", "audio", "scene", "radio", "spotify", "bluetooth", "airplay", "upnp"]);
const EXTERNAL_HANDOFF_TARGETS = new Set<SourceSwitchTarget>(["spotify", "bluetooth", "airplay", "upnp"]);
const VISIBLE_LISTENING_SOURCE_TARGETS = new Set<SourceSwitchTarget>(["mpd", "radio", "spotify", "bluetooth", "airplay", "upnp"]);
const SCREEN_SAVER_STAR_COUNT = 32;
const SCREEN_SAVER_METEOR_COUNT = 18;
const SCREEN_SAVER_SIGNAL_COUNT = 22;
const SCREEN_SAVER_PREVIEW_STYLES: DisplaySleepStyle[] = ["clock", "now_playing", "starfield", "meteor_shower", "signal"];

const DEFAULT_SCENE_VIDEO: BackgroundVideoSummary = {
  id: "scene-empty",
  filename: "",
  label: "No scene video",
  src: ""
};

type RoomModeChooserContext = "startup";

function readInitialMode(): AppMode {
  const mode = new URLSearchParams(window.location.search).get("mode");
  if (mode === "player" || mode === "quickSettings" || mode === "quickMenu") return mode;
  return "ambient";
}

function readInitialSurfaceTheme(): SurfaceTheme {
  const savedTheme = window.localStorage.getItem(SURFACE_THEME_STORAGE_KEY);
  if (savedTheme === "warm-gold" || savedTheme === "graphite-silver" || savedTheme === "ivory-studio") {
    return savedTheme;
  }
  return "warm-gold";
}

function readInitialLyricsVisible() {
  const visible = readStoredBoolean(LYRICS_VISIBLE_STORAGE_KEY, true);
  if (!visible && window.localStorage.getItem(LYRICS_VISIBLE_AUTO_RESTORE_KEY) !== "true") {
    window.localStorage.setItem(LYRICS_VISIBLE_AUTO_RESTORE_KEY, "true");
    window.localStorage.setItem(LYRICS_VISIBLE_STORAGE_KEY, "true");
    return true;
  }
  return visible;
}

function hasDisplayableReadyLyrics(state: TikpalState) {
  return state.lyrics.status === "ready"
    && (
      state.lyrics.sourceScope === "bluetooth_input"
      || state.lyrics.sourceScope === "airplay_input"
      || state.lyrics.sourceScope === "upnp_input"
    )
    && state.lyrics.lines.some((line) => line.text.trim());
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

function readStoredPercent(key: string, fallback: number) {
  const savedValue = Number(window.localStorage.getItem(key));
  if (Number.isFinite(savedValue) && savedValue > 0 && savedValue <= 100) {
    return Math.round(savedValue);
  }
  return fallback;
}

function readStoredFlag(key: string) {
  return window.localStorage.getItem(key) === "true";
}

function normalizeRestorePercent(value: number, fallback: number) {
  if (Number.isFinite(value) && value > 0 && value <= 100) {
    return Math.round(value);
  }
  return fallback;
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function formatScreenSaverDuration(seconds: number | null | undefined) {
  if (!Number.isFinite(seconds) || (seconds ?? 0) <= 0) return "--:--";
  const safeSeconds = Math.max(0, Math.floor(seconds ?? 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function isSourceSwitchTarget(sourceId: string): sourceId is SourceSwitchTarget {
  return SOURCE_SWITCH_TARGETS.has(sourceId as SourceSwitchTarget);
}

function isVisibleListeningSourceTarget(sourceId: string): sourceId is SourceSwitchTarget {
  return VISIBLE_LISTENING_SOURCE_TARGETS.has(sourceId as SourceSwitchTarget);
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

function normalizeLibraryTrackPath(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().replaceAll("\\", "/").replace(/^\/+/, "");
  return normalized.startsWith("Codex/") ? normalized.slice("Codex/".length) : normalized;
}

function normalizeTrackIdentityText(value: string | null | undefined) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

function parseRememberedLibraryTrackIdentity(localTrackPath: string) {
  const filename = normalizeLibraryTrackPath(localTrackPath).split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
  const parts = filename.split(" - ").map((part) => part.trim()).filter(Boolean);
  const durationMatch = filename.match(/(\d{1,2})m(\d{2})s/i);
  const minutes = Number(durationMatch?.[1]);
  const seconds = Number(durationMatch?.[2]);
  return {
    artist: parts[0] ?? "",
    title: parts[1] ?? filename,
    durationSeconds: Number.isFinite(minutes) && Number.isFinite(seconds) ? minutes * 60 + seconds : null
  };
}

function isRememberedLibraryTrackCurrent(state: TikpalState, localTrackPath: string) {
  const rememberedPath = normalizeLibraryTrackPath(localTrackPath);
  if (!rememberedPath) return false;
  const activeEntry = state.playback.queuePreview.find((entry) => entry.active);
  if (!activeEntry) return false;
  if (normalizeLibraryTrackPath(activeEntry.id) === rememberedPath) return true;

  const identity = parseRememberedLibraryTrackIdentity(rememberedPath);
  const titleMatches = Boolean(identity.title)
    && normalizeTrackIdentityText(activeEntry.title) === normalizeTrackIdentityText(identity.title);
  const artistMatches = !identity.artist
    || normalizeTrackIdentityText(activeEntry.artist) === normalizeTrackIdentityText(identity.artist);
  const durationMatches = identity.durationSeconds === null
    || activeEntry.durationSeconds === null
    || Math.abs(activeEntry.durationSeconds - identity.durationSeconds) <= 2;
  return titleMatches && artistMatches && durationMatches;
}

function shouldRestoreRememberedSource(state: TikpalState, rememberedSource: RememberedAudioSource | null | undefined) {
  if (!rememberedSource || !isSourceSwitchTarget(rememberedSource.target)) return false;
  const currentSource = state.audio.currentSource;
  const currentSourceId: string = currentSource.id;
  const currentExternalSourceIsOpen = !isExternalHandoffTarget(currentSourceId as SourceSwitchTarget)
    || currentSource.connectionState === "armed"
    || currentSource.connectionState === "connected";
  if (isVisibleListeningSourceTarget(currentSourceId) && currentExternalSourceIsOpen) return false;
  if (rememberedSource.target === "mpd" && rememberedSource.localTrackPath) {
    if (currentSourceId !== "mpd") return true;
    return !isRememberedLibraryTrackCurrent(state, rememberedSource.localTrackPath);
  }
  if (rememberedSource.target === "radio" && rememberedSource.radioStationId) {
    if (currentSourceId !== "radio") return true;
    return state.audio.currentSource.radioStationId !== rememberedSource.radioStationId;
  }
  if (currentSourceId === rememberedSource.target && currentExternalSourceIsOpen) return false;
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
  const [surfaceTheme, setSurfaceTheme] = useState<SurfaceTheme>(readInitialSurfaceTheme);
  const [lyricsVisible, setLyricsVisible] = useState(readInitialLyricsVisible);
  const [lyricsFontSize, setLyricsFontSize] = useState<LyricsFontSize>(readInitialLyricsFontSize);
  const [sceneVideoEnabled, setSceneVideoEnabled] = useState(() => readStoredBoolean(SCENE_VIDEO_ENABLED_STORAGE_KEY, true));
  const [clockVisible, setClockVisible] = useState(() => readStoredBoolean(CLOCK_VISIBLE_STORAGE_KEY, true));
  const [screenOffActive, setScreenOffActive] = useState(false);
  const [screenSaverPreviewIndex, setScreenSaverPreviewIndex] = useState<number | null>(null);
  const [webModeActive, setWebModeActive] = useState(false);
  const [webModeState, setWebModeState] = useState<WebModeState | null>(null);
  const [exploreClosing, setExploreClosing] = useState(false);
  const [exploreOpening, setExploreOpening] = useState(false);
  const [quickMenuProxyEnabled, setQuickMenuProxyEnabled] = useState<boolean | null>(null);
  const [quickMenuProxyPending, setQuickMenuProxyPending] = useState(false);
  const [initialSettingsDetail, setInitialSettingsDetail] = useState<"display" | "webMode" | null>(null);
  const [systemSleepActive, setSystemSleepActive] = useState(false);
  const [ambientSourcePickerRequest, setAmbientSourcePickerRequest] = useState(0);
  const [ambientSourcePickerOpen, setAmbientSourcePickerOpen] = useState(false);
  const [roomModeChooserContext, setRoomModeChooserContext] = useState<RoomModeChooserContext | null>(() => readInitialMode() === "ambient" ? "startup" : null);
  const [roomModeSelectionPending, setRoomModeSelectionPending] = useState(false);
  const [sceneVideoReady, setSceneVideoReady] = useState(false);
  const [onboardingVisible, setOnboardingVisible] = useState(() => !readStoredFlag(ONBOARDING_STORAGE_KEY));
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [onboardingBackgroundHidden, setOnboardingBackgroundHidden] = useState(true);
  const [onboardingSoundMuted, setOnboardingSoundMuted] = useState(true);
  const [activeSceneVideo, setActiveSceneVideo] = useState<BackgroundVideoSummary>(DEFAULT_SCENE_VIDEO);
  const eventLoopLagRef = useRef(0);
  const heartbeatStateRef = useRef<Record<string, unknown>>({});
  const previousRoomModeRef = useRef<RoomMode | null>(null);
  const hifiRestoreKeyRef = useRef<string>("");
  const hifiInitialRestoreCheckedRef = useRef(false);
  const hifiRestoreInFlightRef = useRef(false);
  const roomExperienceRef = useRef<RoomExperienceState | null>(null);
  const quickMenuVolumeRestoreRef = useRef(readStoredPercent(QUICK_MENU_VOLUME_RESTORE_STORAGE_KEY, DEFAULT_QUICK_MENU_RESTORE_VOLUME_PERCENT));
  const quickMenuBrightnessRestoreRef = useRef(readStoredPercent(QUICK_MENU_BRIGHTNESS_RESTORE_STORAGE_KEY, DEFAULT_QUICK_MENU_RESTORE_BRIGHTNESS_PERCENT));
  const systemSleepBrightnessRestoreRef = useRef<number | null>(null);
  const systemSleepVolumeRestoreRef = useRef<number | null>(null);
  const systemSleepEntryTaskRef = useRef<Promise<void> | null>(null);
  const systemSleepWakePendingRef = useRef(false);
  const screenOffActiveRef = useRef(false);
  const screenOffSourceRef = useRef<"manual" | "idle" | null>(null);
  const webModeActiveRef = useRef(false);
  const sceneVideoReadyRef = useRef(false);
  const observedWebModeActiveRef = useRef(false);
  const exploreClosingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exploreOpenVeilRef = useRef<ExploreOpenVeilController | null>(null);
  if (!exploreOpenVeilRef.current) exploreOpenVeilRef.current = new ExploreOpenVeilController();
  const displaySleepLastActivityRef = useRef(Date.now());
  const { state: tikpalState, status: tikpalStatus, refresh, sendPlaybackAction, sendSystemAction, sendSourceSwitch } = useTikpalState();
  const { experience: roomExperience, status: roomExperienceStatus, refresh: refreshRoomExperience, sendExperienceAction } = useRoomExperience();
  const hudAutoHideMs = ambientSourcePickerOpen ? HUD_SOURCE_PICKER_AUTO_HIDE_MS : HUD_AUTO_HIDE_MS;
  const hudAutoHidePaused = tikpalStatus.pending || roomExperienceStatus.pending;
  const { mode, hudVisible, idleTotalMs, idleRemainingMs, showHud, hideHud, toggleHud, changeMode, returnAmbient, resetIdleTimer } = useAppMode(readInitialMode(), {
    hudAutoHideMs,
    hudAutoHidePaused
  });
  const { locale, preferences, setDisplaySleepPreferences, setFontTheme, t } = useI18n();
  const fontTheme = preferences.fontTheme;

  useBrowserKioskGuard();

  const setWebModeSleepSuppressed = useCallback((active: boolean) => {
    const changed = webModeActiveRef.current !== active;
    webModeActiveRef.current = active;
    if (changed) {
      setWebModeActive(active);
      displaySleepLastActivityRef.current = Date.now();
    }
    if (active) {
      displaySleepLastActivityRef.current = Date.now();
      if (screenOffSourceRef.current === "idle") {
        screenOffSourceRef.current = null;
        setScreenOffActive(false);
      }
    }
  }, []);

  const handleSceneVideoReadyChange = useCallback((ready: boolean) => {
    sceneVideoReadyRef.current = ready;
    setSceneVideoReady((current) => current === ready ? current : ready);
  }, []);

  const observeWebModeActivity = useCallback((active: boolean) => {
    const wasActive = observedWebModeActiveRef.current;
    observedWebModeActiveRef.current = active;
    setWebModeSleepSuppressed(active);

    if (active) return;
    if (!wasActive) return;
    returnAmbient();
  }, [returnAmbient, setWebModeSleepSuppressed]);

  useEffect(() => {
    if (mode !== "quickMenu") return undefined;

    let cancelled = false;
    void fetchWebModeState()
      .then((state) => {
        if (!cancelled) setQuickMenuProxyEnabled(state.settings.proxyEnabled);
      })
      .catch(() => {
        if (!cancelled) setQuickMenuProxyEnabled((current) => current);
      });

    return () => {
      cancelled = true;
    };
  }, [mode]);

  const registerDisplayActivity = useCallback((nextMode: AppMode = mode) => {
    displaySleepLastActivityRef.current = Date.now();
    resetIdleTimer(nextMode);
  }, [mode, resetIdleTimer]);

  const enterSoftScreenOff = useCallback((source: "manual" | "idle") => {
    screenOffSourceRef.current = source;
    setScreenOffActive(true);
  }, []);

  const wakeSoftScreen = useCallback(() => {
    screenOffSourceRef.current = null;
    displaySleepLastActivityRef.current = Date.now();
    resetIdleTimer(mode);
    setScreenOffActive(false);
  }, [mode, resetIdleTimer]);

  const stopScreenSaverPreview = useCallback(() => {
    displaySleepLastActivityRef.current = Date.now();
    resetIdleTimer(mode);
    setScreenSaverPreviewIndex(null);
  }, [mode, resetIdleTimer]);

  const startScreenSaverPreview = useCallback(() => {
    screenOffSourceRef.current = null;
    displaySleepLastActivityRef.current = Date.now();
    resetIdleTimer(mode);
    setScreenOffActive(false);
    setScreenSaverPreviewIndex(0);
  }, [mode, resetIdleTimer]);

  useEffect(() => {
    screenOffActiveRef.current = screenOffActive;
  }, [screenOffActive]);

  useEffect(() => {
    if (preferences.displaySleepEnabled) return;
    if (screenOffSourceRef.current === "idle") {
      screenOffSourceRef.current = null;
      setScreenOffActive(false);
    }
  }, [preferences.displaySleepEnabled]);

  useEffect(() => {
    const recordActivity = () => {
      if (screenOffActiveRef.current) return;
      displaySleepLastActivityRef.current = Date.now();
    };
    const activityEvents = ["pointerdown", "pointermove", "wheel", "keydown", "touchstart", "input", "focusin"] as const;
    activityEvents.forEach((eventName) => window.addEventListener(eventName, recordActivity, { passive: true }));
    return () => activityEvents.forEach((eventName) => window.removeEventListener(eventName, recordActivity));
  }, []);

  useEffect(() => {
    let cancelled = false;

    const pollWebModeActivity = async () => {
      try {
        const next = await fetchWebModeState();
        if (cancelled) return;
        setWebModeState(next);
        observeWebModeActivity(Boolean(next.activeProvider || next.openingProvider));
      } catch {
        // Keep the last known Explore state; this only gates the soft screen saver.
      }
    };

    void pollWebModeActivity();
    const interval = window.setInterval(
      () => void pollWebModeActivity(),
      webModeActive ? WEB_MODE_ACTIVE_POLL_MS : WEB_MODE_IDLE_POLL_MS
    );
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [observeWebModeActivity, webModeActive]);

  // Listen for explore close signal from side panel via BroadcastChannel.
  // When webModeActive becomes false (Explore actually closed), delay clearing
  // exploreClosing so the CSS fade-out transition (3000ms) has time to play.
  useEffect(() => {
    if (!webModeActive) {
      // Explore is closed — keep overlay visible, fade it out after delay
      if (exploreClosingTimerRef.current) clearTimeout(exploreClosingTimerRef.current);
      exploreClosingTimerRef.current = setTimeout(() => {
        setExploreClosing(false);
        exploreClosingTimerRef.current = null;
      }, 1200);
      return;
    }
    // Explore is active — listen for close signal from side panel
    if (exploreClosingTimerRef.current) {
      clearTimeout(exploreClosingTimerRef.current);
      exploreClosingTimerRef.current = null;
    }
    const bc = new BroadcastChannel("tikpal-explore-close");
    bc.onmessage = (e) => { if (e.data === "closing") setExploreClosing(true); };
    return () => { bc.close(); };
  }, [webModeActive]);

  useEffect(() => {
    return () => {
      exploreOpenVeilRef.current?.dispose();
    };
  }, []);


  useEffect(() => {
    if (!preferences.displaySleepEnabled || systemSleepActive || screenSaverPreviewIndex !== null || webModeActive) return;
    const interval = window.setInterval(() => {
      if (webModeActiveRef.current) {
        displaySleepLastActivityRef.current = Date.now();
        return;
      }
      if (screenOffActiveRef.current || screenOffSourceRef.current) return;
      const timeoutMs = Math.max(1, preferences.displaySleepMinutes) * 60_000;
      if (Date.now() - displaySleepLastActivityRef.current >= timeoutMs) {
        enterSoftScreenOff("idle");
      }
    }, DISPLAY_SLEEP_CHECK_MS);
    return () => window.clearInterval(interval);
  }, [enterSoftScreenOff, preferences.displaySleepEnabled, preferences.displaySleepMinutes, screenSaverPreviewIndex, systemSleepActive, webModeActive]);

  useEffect(() => {
    if (screenSaverPreviewIndex === null) return undefined;
    displaySleepLastActivityRef.current = Date.now();
    const interval = window.setInterval(() => {
      displaySleepLastActivityRef.current = Date.now();
      setScreenSaverPreviewIndex((index) => index === null ? null : (index + 1) % SCREEN_SAVER_PREVIEW_STYLES.length);
    }, SCREEN_SAVER_PREVIEW_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [screenSaverPreviewIndex]);

  useEffect(() => {
    roomExperienceRef.current = roomExperience;
  }, [roomExperience]);

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
      webModeActive,
      exploreOpening,
      webModeActiveProvider: webModeState?.activeProvider ?? null,
      webModeOpeningProvider: webModeState?.openingProvider ?? null,
      webModeOpenRequestId: webModeState?.openRequestId ?? exploreOpenVeilRef.current?.currentRequestId ?? null,
      webModeOpenStartedAt: webModeState?.openStartedAt ?? null,
      webModeOpenXSessionGeneration: webModeState?.openXSessionGeneration ?? null,
      tikpalStatus,
      roomExperienceStatus
    };
  });

  useEffect(() => {
    function buildPendingSnapshot(nowMs: number) {
      const snapshot = heartbeatStateRef.current;
      const tikpalStatusSnapshot = snapshot.tikpalStatus as typeof tikpalStatus | undefined;
      const roomStatusSnapshot = snapshot.roomExperienceStatus as typeof roomExperienceStatus | undefined;

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
        explore: {
          active: snapshot.webModeActive === true,
          opening: snapshot.exploreOpening === true,
          activeProvider: snapshot.webModeActiveProvider ?? null,
          openingProvider: snapshot.webModeOpeningProvider ?? null,
          openRequestId: snapshot.webModeOpenRequestId ?? null,
          openStartedAt: snapshot.webModeOpenStartedAt ?? null,
          xSessionGeneration: snapshot.webModeOpenXSessionGeneration ?? null
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
    document.documentElement.dataset.surfaceTheme = surfaceTheme;
    window.localStorage.setItem(SURFACE_THEME_STORAGE_KEY, surfaceTheme);
  }, [surfaceTheme]);

  useEffect(() => {
    window.localStorage.setItem(LYRICS_VISIBLE_STORAGE_KEY, lyricsVisible ? "true" : "false");
  }, [lyricsVisible]);

  useEffect(() => {
    if (lyricsVisible || !hasDisplayableReadyLyrics(tikpalState)) return;
    if (window.localStorage.getItem(LYRICS_VISIBLE_READY_RESTORE_KEY) === "true") return;
    window.localStorage.setItem(LYRICS_VISIBLE_READY_RESTORE_KEY, "true");
    setLyricsVisible(true);
  }, [lyricsVisible, tikpalState]);

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
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, onboardingVisible ? "false" : "true");
  }, [onboardingVisible]);

  useEffect(() => {
    const percent = tikpalState.system.volume.percent;
    if (percent <= 0) return;
    quickMenuVolumeRestoreRef.current = Math.round(percent);
    window.localStorage.setItem(QUICK_MENU_VOLUME_RESTORE_STORAGE_KEY, String(Math.round(percent)));
  }, [tikpalState.system.volume.percent]);

  useEffect(() => {
    const percent = tikpalState.system.display.brightnessPercent;
    if (percent <= 0) return;
    quickMenuBrightnessRestoreRef.current = Math.round(percent);
    window.localStorage.setItem(QUICK_MENU_BRIGHTNESS_RESTORE_STORAGE_KEY, String(Math.round(percent)));
  }, [tikpalState.system.display.brightnessPercent]);

  const activeTimeZone = roomExperience.nightSchedule.timeZone;
  const timeFormatter = useMemo(() => new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: activeTimeZone
  }), [activeTimeZone, locale]);
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    timeZone: activeTimeZone
  }), [activeTimeZone]);
  const weekdayFormatter = useMemo(() => new Intl.DateTimeFormat(locale, {
    weekday: "long",
    timeZone: activeTimeZone
  }), [activeTimeZone, locale]);
  const timeLabel = useMemo(() => timeFormatter.format(now), [now, timeFormatter]);
  const dateLabel = useMemo(() => `${dateFormatter.format(now)} ${weekdayFormatter.format(now)}`, [dateFormatter, now, weekdayFormatter]);

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

    const isHifiRoomMode = roomExperience.mode === "hifi" || roomExperienceRef.current?.mode === "hifi";
    const shouldWaitForExternalHandoff = isExternalHandoffTarget(target) && !isHifiRoomMode;
    if (shouldWaitForExternalHandoff && !isSourceHandoffReady(nextState, target)) {
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
  }, [refresh, refreshRoomExperience, roomExperience.mode, sendSourceSwitch, tikpalState.audio.currentSource.connectionState, tikpalState.audio.currentSource.id]);

  const handleOpenWebMode = useCallback(async () => {
    const requestId = createExploreOpenRequestId();
    const veil = exploreOpenVeilRef.current;
    const previousRequestId = veil?.currentRequestId ?? null;
    if (previousRequestId && previousRequestId !== requestId) {
      logExploreOpenVeil("remove", previousRequestId, `reason=superseded_by:${requestId}`);
    }
    setWebModeSleepSuppressed(true);
    setExploreOpening(true);
    logExploreOpenVeil("create", requestId);
    logExploreOpenVeil("fade", requestId, "direction=in");
    veil?.begin(requestId, EXPLORE_OPEN_OVERLAY_MAX_MS, (timedOutRequestId) => {
      setExploreOpening(false);
      logExploreOpenVeil("timeout", timedOutRequestId, `timeoutMs=${EXPLORE_OPEN_OVERLAY_MAX_MS}`);
      logExploreOpenVeil("remove", timedOutRequestId, "reason=timeout");
    });
    try {
      const channel = new BroadcastChannel("tikpal-explore-open");
      channel.postMessage("opening");
      channel.close();
    } catch {}
    let veilRemovalReason = "opened";
    try {
      const nextWebMode = await sendWebModeAction({ type: "open", openRequestId: requestId });
      observeWebModeActivity(Boolean(nextWebMode.activeProvider || nextWebMode.openingProvider));
    } catch (error) {
      veilRemovalReason = error instanceof Error && /stale X session/i.test(error.message)
        ? "stale-session"
        : "api-failed";
      setWebModeSleepSuppressed(false);
      throw error;
    } finally {
      if (veil?.finish(requestId)) {
        setExploreOpening(false);
        logExploreOpenVeil("fade", requestId, "direction=out");
        logExploreOpenVeil("remove", requestId, `reason=${veilRemovalReason}`);
      } else {
        logExploreOpenVeil("remove_ignored", requestId, "reason=request_not_owner");
      }
    }
    await Promise.all([refresh(), refreshRoomExperience()]);
    returnAmbient();
  }, [observeWebModeActivity, refresh, refreshRoomExperience, returnAmbient, setWebModeSleepSuppressed]);

  useEffect(() => {
    const previousMode = previousRoomModeRef.current;
    previousRoomModeRef.current = roomExperience.mode;
    if (roomExperience.mode !== "hifi") {
      hifiRestoreKeyRef.current = "";
      hifiInitialRestoreCheckedRef.current = false;
      return;
    }

    const rememberedSource = tikpalState.audio.rememberedSource;
    if (!rememberedSource) return;
    const restoreKey = getRememberedSourceKey(rememberedSource);
    const enteredHifi = previousMode !== "hifi";
    const shouldCheckInitialRestore = !hifiInitialRestoreCheckedRef.current;
    if ((!enteredHifi && !shouldCheckInitialRestore) || !restoreKey || hifiRestoreKeyRef.current === restoreKey || hifiRestoreInFlightRef.current) return;
    if (!shouldRestoreRememberedSource(tikpalState, rememberedSource)) {
      hifiInitialRestoreCheckedRef.current = true;
      return;
    }

    hifiRestoreKeyRef.current = restoreKey;
    hifiInitialRestoreCheckedRef.current = true;
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

  const handleQuickMenuVolumeEnabledChange = useCallback(async (_enabled: boolean) => {
    try {
      const latestState = await refresh();
      const currentPercent = latestState?.system.volume.percent ?? tikpalState.system.volume.percent;
      if (currentPercent > 0) {
        const remembered = Math.round(currentPercent);
        quickMenuVolumeRestoreRef.current = remembered;
        window.localStorage.setItem(QUICK_MENU_VOLUME_RESTORE_STORAGE_KEY, String(remembered));
        await sendPlaybackAction("volume_set", 0);
        return;
      }

      await sendPlaybackAction(
        "volume_set",
        normalizeRestorePercent(quickMenuVolumeRestoreRef.current, DEFAULT_QUICK_MENU_RESTORE_VOLUME_PERCENT)
      );
    } catch {
      await refresh();
    }
  }, [refresh, sendPlaybackAction, tikpalState.system.volume.percent]);

  const handleQuickMenuProxyEnabledChange = useCallback(async (enabled: boolean) => {
    if (quickMenuProxyPending) return;

    const previous = quickMenuProxyEnabled;
    setQuickMenuProxyPending(true);
    setQuickMenuProxyEnabled(enabled);

    try {
      const nextState = await sendWebModeAction({ type: "proxy", enabled });
      setQuickMenuProxyEnabled(nextState.settings.proxyEnabled);
    } catch {
      if (previous !== null) {
        setQuickMenuProxyEnabled(previous);
      } else {
        const nextState = await fetchWebModeState().catch(() => null);
        setQuickMenuProxyEnabled(nextState?.settings.proxyEnabled ?? null);
      }
    } finally {
      setQuickMenuProxyPending(false);
    }
  }, [quickMenuProxyEnabled, quickMenuProxyPending]);

  const handleQuickMenuScreenEnabledChange = useCallback((enabled: boolean) => {
    if (enabled) {
      wakeSoftScreen();
      return;
    }

    enterSoftScreenOff("manual");
    if (!enabled) {
      returnAmbient();
    }
  }, [enterSoftScreenOff, returnAmbient, wakeSoftScreen]);

  const handleQuickMenuDisplaySleepChange = useCallback(async (enabled: boolean) => {
    try {
      await setDisplaySleepPreferences({ displaySleepEnabled: enabled });
    } catch {}
  }, [setDisplaySleepPreferences]);

  const handleQuickMenuNavigateSettings = useCallback((detail: "display" | "webMode") => {
    setInitialSettingsDetail(detail);
    changeMode("quickSettings");
  }, [changeMode]);

  const handleQuickMenuSleep = useCallback(() => {
    if (systemSleepActive || systemSleepEntryTaskRef.current) return;

    const currentVolume = tikpalState.system.volume.percent;
    systemSleepBrightnessRestoreRef.current = null;
    systemSleepVolumeRestoreRef.current = currentVolume > 0 ? Math.round(currentVolume) : null;

    if (systemSleepVolumeRestoreRef.current !== null) {
      quickMenuVolumeRestoreRef.current = systemSleepVolumeRestoreRef.current;
      window.localStorage.setItem(QUICK_MENU_VOLUME_RESTORE_STORAGE_KEY, String(systemSleepVolumeRestoreRef.current));
    }

    setSystemSleepActive(true);
    returnAmbient();

    const entryTask = (async () => {
      try {
        if (currentVolume > 0) {
          await sendPlaybackAction("volume_set", 0);
        }
      } catch {
        await refresh();
      } finally {
        systemSleepEntryTaskRef.current = null;
      }
    })();

    systemSleepEntryTaskRef.current = entryTask;
  }, [
    refresh,
    returnAmbient,
    sendPlaybackAction,
    systemSleepActive,
    tikpalState.system.volume.percent
  ]);

  const handleSystemSleepWake = useCallback(async () => {
    if (systemSleepWakePendingRef.current) return;
    systemSleepWakePendingRef.current = true;

    try {
      await systemSleepEntryTaskRef.current?.catch(() => null);
      const restoreVolume = systemSleepVolumeRestoreRef.current;

      if (restoreVolume !== null) {
        await sendPlaybackAction("volume_set", restoreVolume);
      }

      setSystemSleepActive(false);
      systemSleepBrightnessRestoreRef.current = null;
      systemSleepVolumeRestoreRef.current = null;
    } catch {
      await refresh();
    } finally {
      systemSleepWakePendingRef.current = false;
    }
  }, [refresh, sendPlaybackAction]);

  const handleSystemSleepWakeGesture = useCallback((event: { preventDefault: () => void; stopPropagation: () => void }) => {
    event.preventDefault();
    event.stopPropagation();
    void handleSystemSleepWake();
  }, [handleSystemSleepWake]);

  useEffect(() => {
    if (!systemSleepActive) return undefined;

    let wakeQueued = false;
    const wakeFromInput = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      if (wakeQueued) return;
      wakeQueued = true;
      void handleSystemSleepWake().finally(() => {
        wakeQueued = false;
      });
    };
    const options = { capture: true, passive: false } as AddEventListenerOptions;

    window.addEventListener("pointerdown", wakeFromInput, options);
    window.addEventListener("click", wakeFromInput, options);
    window.addEventListener("keydown", wakeFromInput, options);

    return () => {
      window.removeEventListener("pointerdown", wakeFromInput, options);
      window.removeEventListener("click", wakeFromInput, options);
      window.removeEventListener("keydown", wakeFromInput, options);
    };
  }, [handleSystemSleepWake, systemSleepActive]);

  const handleRoomExperienceAction = useCallback(
    async (action: RoomExperienceActionRequest) => {
      const nextExperience = await sendExperienceAction(action);
      await refresh();
      return nextExperience;
    },
    [refresh, sendExperienceAction]
  );

  const handleStartupModeSelect = useCallback(async (nextMode: RoomMode) => {
    const chooserContext = roomModeChooserContext ?? "startup";
    const changesScene = nextMode !== roomExperience.mode;
    if (changesScene) {
      handleSceneVideoReadyChange(false);
    }
    setRoomModeSelectionPending(true);
    try {
      await handleRoomExperienceAction({ type: "set_mode", mode: nextMode });
      if (sceneVideoReadyRef.current) {
        setRoomModeChooserContext(null);
        setRoomModeSelectionPending(false);
        setAmbientSourcePickerRequest((request) => request + 1);
      }
    } catch {
      setRoomModeChooserContext(chooserContext);
      setRoomModeSelectionPending(false);
    }
  }, [handleRoomExperienceAction, handleSceneVideoReadyChange, roomExperience.mode, roomModeChooserContext]);

  useEffect(() => {
    if (!roomModeSelectionPending || !sceneVideoReady) return;
    setRoomModeSelectionPending(false);
    setRoomModeChooserContext(null);
    setAmbientSourcePickerRequest((request) => request + 1);
  }, [roomModeSelectionPending, sceneVideoReady]);

  const handleStartupModeAutoDismiss = useCallback(() => {
    setRoomModeChooserContext(null);
  }, []);

  const handleOnboardingDismiss = useCallback(() => {
    setOnboardingVisible(false);
    setOnboardingStep(0);
    setOnboardingBackgroundHidden(false);
    setOnboardingSoundMuted(false);
  }, []);

  const handleOnboardingNext = useCallback(() => {
    setOnboardingStep((step) => Math.min(step + 1, 2));
  }, []);

  const handleOnboardingBack = useCallback(() => {
    setOnboardingStep((step) => Math.max(step - 1, 0));
  }, []);

  const showWizard = useCallback(() => {
    setOnboardingStep(0);
    setOnboardingBackgroundHidden(true);
    setOnboardingSoundMuted(true);
    setOnboardingVisible(true);
  }, []);

  const handleOpenWizard = useCallback(async () => {
    const webMode = webModeActiveRef.current
      ? await fetchWebModeState().catch(() => ({ activeProvider: "qq_music" }))
      : await fetchWebModeState().catch(() => null);

    if (webMode?.activeProvider) {
      try {
        const nextWebMode = await sendWebModeAction({ type: "close" });
        observeWebModeActivity(Boolean(nextWebMode.activeProvider || nextWebMode.openingProvider));
      } catch {
        // The guide only makes sense on the room screen; if Explore close fails,
        // keep the request local and let the user retry from Settings.
        return;
      }
      returnAmbient();
      await Promise.all([
        refresh().catch(() => null),
        refreshRoomExperience().catch(() => null)
      ]);
    }

    showWizard();
  }, [observeWebModeActivity, refresh, refreshRoomExperience, returnAmbient, showWizard]);

  useEffect(() => {
    if (!onboardingVisible) return;
    setOnboardingStep((current) => Math.min(current, 2));
  }, [onboardingVisible]);

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

  function renderScreenSaverContent(style: DisplaySleepStyle) {
    const playback = tikpalState.playback;
    const title = playback.title?.trim() || t("playback.nothingPlaying");
    const artist = playback.artist?.trim() || t("playback.unknownArtist");
    const duration = playback.durationSeconds ?? 0;
    const elapsed = playback.elapsedSeconds ?? 0;
    const progress = duration > 0 ? Math.max(0, Math.min(1, elapsed / duration)) : 0;

    if (style === "meteor_shower") {
      return (
        <div className="screen-saver-content screen-saver-meteor-shower" aria-hidden="true">
          {Array.from({ length: SCREEN_SAVER_METEOR_COUNT }, (_, index) => (
            <span key={index} className={`screen-saver-meteor meteor-${index + 1}`} />
          ))}
          <strong>Tikpal</strong>
        </div>
      );
    }

    if (style === "clock") {
      return (
        <div className="screen-saver-content screen-saver-clock" aria-hidden="true">
          <span>{dateLabel}</span>
          <strong>{timeLabel}</strong>
        </div>
      );
    }

    if (style === "now_playing") {
      return (
        <div className="screen-saver-content screen-saver-now-playing" aria-hidden="true">
          <div className="screen-saver-art">
            {playback.albumArtUrl ? <img src={playback.albumArtUrl} alt="" /> : <span>{title.slice(0, 1).toLocaleUpperCase()}</span>}
          </div>
          <div className="screen-saver-track">
            <span>{tikpalState.audio.currentSource.label || t("source.library")}</span>
            <strong>{title}</strong>
            <em>{artist}</em>
            <div className="screen-saver-progress">
              <i style={{ width: `${progress * 100}%` }} />
            </div>
            <small>{formatScreenSaverDuration(elapsed)} / {formatScreenSaverDuration(duration)}</small>
          </div>
        </div>
      );
    }

    if (style === "starfield") {
      return (
        <div className="screen-saver-content screen-saver-starfield" aria-hidden="true">
          {Array.from({ length: SCREEN_SAVER_STAR_COUNT }, (_, index) => (
            <span key={index} className={`screen-saver-star star-${index + 1}`} />
          ))}
          <strong>Tikpal</strong>
        </div>
      );
    }

    return (
      <div className="screen-saver-content screen-saver-signal" aria-hidden="true">
        <div className="screen-saver-signal-lines">
          {Array.from({ length: SCREEN_SAVER_SIGNAL_COUNT }, (_, index) => (
            <span key={index} className={`signal-${index + 1}`} />
          ))}
        </div>
        <div className="screen-saver-signal-copy">
          <span>{tikpalState.audio.currentSource.label || t("source.library")}</span>
          <strong>Tikpal Signal</strong>
          <em>{title}</em>
        </div>
      </div>
    );
  }

  const { gesturePreview, ...gestureHandlers } = useKioskGestures({
    mode,
    onOpenPlayer: () => changeMode("player"),
    onOpenSettings: () => changeMode("quickSettings"),
    onOpenMenu: () => changeMode("quickMenu"),
    onReturnAmbient: returnAmbient,
    onToggleHud: handleAmbientTap,
    onActivity: () => registerDisplayActivity(mode)
  });

  const onboardingActive = onboardingVisible && !webModeActive;

  return (
    <main className={`app-root ${screenOffActive ? "is-screen-off" : ""} ${systemSleepActive ? "is-system-sleeping" : ""} ${mode === "quickMenu" ? "is-quick-menu-active" : ""} ${onboardingActive && onboardingBackgroundHidden ? "is-wizard-background-hidden" : ""}`} {...gestureHandlers}>
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
        sceneSoundEnabled={roomExperience.sceneSoundEnabled && !(onboardingActive && onboardingSoundMuted)}
        sourcePickerOpenRequest={ambientSourcePickerRequest}
        clockVisible={clockVisible}
        webModeState={webModeState}
        onPlaybackAction={sendPlaybackAction}
        onSystemAction={sendSystemAction}
        onSourceSwitch={handleSourceSwitch}
        onOpenWebMode={handleOpenWebMode}
        onSourcePickerOpenChange={setAmbientSourcePickerOpen}
        onHudActivity={showHud}
        onHudDismiss={hideHud}
        onLyricsVisibleChange={setLyricsVisible}
        onCurrentSceneVideoChange={handleCurrentSceneVideoChange}
        onSceneVideoReadyChange={handleSceneVideoReadyChange}
        onOpenPlayer={() => changeMode("player")}
        onOpenSettings={() => changeMode("quickSettings")}
        roomExperience={roomExperience}
        onExperienceAction={handleRoomExperienceAction}
      />
      <StartupModeChooser
        active={roomModeChooserContext !== null && mode === "ambient"}
        context={roomModeChooserContext ?? "startup"}
        videoReady={sceneVideoReady}
        pending={tikpalStatus.pending || roomModeSelectionPending}
        selectedMode={roomExperience.mode}
        onAutoDismiss={handleStartupModeAutoDismiss}
        onSelectMode={handleStartupModeSelect}
      />
      <OnboardingGuide
        active={onboardingActive}
        step={onboardingStep}
        onDismiss={handleOnboardingDismiss}
        onNext={handleOnboardingNext}
        onBack={handleOnboardingBack}
      />

      <PlayerOverlay
        active={mode === "player"}
        playback={tikpalState.playback}
        audio={tikpalState.audio}
        system={tikpalState.system}
        webModeState={webModeState}
        status={tikpalStatus}
        fontTheme={fontTheme}
        onPlaybackAction={sendPlaybackAction}
        onSourceSwitch={handleSourceSwitch}
        onOpenWebMode={handleOpenWebMode}
        onReturnAmbient={returnAmbient}
      />
      <QuickSettingsOverlay
        active={mode === "quickSettings"}
        audio={tikpalState.audio}
        playback={tikpalState.playback}
        system={tikpalState.system}
        runtime={tikpalState.runtime}
        status={tikpalStatus}
        fontTheme={fontTheme}
        surfaceTheme={surfaceTheme}
        lyricsVisible={lyricsVisible}
        lyricsFontSize={lyricsFontSize}
        roomExperience={roomExperience}
        initialDetail={initialSettingsDetail}
        onInitialDetailConsumed={() => setInitialSettingsDetail(null)}
        onFontThemeChange={setFontTheme}
        onSurfaceThemeChange={setSurfaceTheme}
        onLyricsVisibleChange={setLyricsVisible}
        onLyricsFontSizeChange={setLyricsFontSize}
        onExperienceAction={handleRoomExperienceAction}
        onOpenWebMode={handleOpenWebMode}
        onSystemAction={sendSystemAction}
        onPreviewScreenSaver={startScreenSaverPreview}
        onOpenWizard={handleOpenWizard}
        onReturnAmbient={returnAmbient}
      />
      <QuickMenu
        active={mode === "quickMenu"}
        screenOffActive={screenOffActive}
        proxyEnabled={quickMenuProxyEnabled}
        volumeEnabled={tikpalState.system.volume.percent > 0}
        proxyPending={quickMenuProxyPending}
        volumePending={tikpalStatus.pending && tikpalStatus.pendingAction === "playback:volume_set"}
        sleepPending={systemSleepActive || Boolean(systemSleepEntryTaskRef.current)}
        onScreenSaverToggle={() => void handleQuickMenuScreenEnabledChange(screenOffActive)}
        onProxyEnabledChange={(enabled) => void handleQuickMenuProxyEnabledChange(enabled)}
        onVolumeEnabledChange={(enabled) => void handleQuickMenuVolumeEnabledChange(enabled)}
        onSleep={handleQuickMenuSleep}
        onClose={returnAmbient}
        onReboot={() => void sendSystemAction("reboot")}
        onNavigateSettings={handleQuickMenuNavigateSettings}
      />

      {(screenOffActive || screenSaverPreviewIndex !== null) && !systemSleepActive ? (
        <button
          className={`screen-off-overlay style-${screenSaverPreviewIndex === null ? preferences.displaySleepStyle : SCREEN_SAVER_PREVIEW_STYLES[screenSaverPreviewIndex]}`}
          type="button"
          data-gesture-protected
          data-screen-saver-style={screenSaverPreviewIndex === null ? preferences.displaySleepStyle : SCREEN_SAVER_PREVIEW_STYLES[screenSaverPreviewIndex]}
          data-screen-saver-preview={screenSaverPreviewIndex === null ? undefined : "true"}
          aria-label={screenSaverPreviewIndex === null ? t("quickMenu.turnScreenOn") : t("settings.stopSleepPreview")}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (screenSaverPreviewIndex === null) wakeSoftScreen();
            else stopScreenSaverPreview();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          {screenSaverPreviewIndex === null ? null : (
            <span className="screen-saver-preview-label">
              {t(`settings.sleepStyle.${SCREEN_SAVER_PREVIEW_STYLES[screenSaverPreviewIndex]}`)}
            </span>
          )}
          {screenSaverPreviewIndex === null ? (
            <span className="screen-saver-wake-hint">{t("settings.touchToWake")}</span>
          ) : null}
          {renderScreenSaverContent(screenSaverPreviewIndex === null ? preferences.displaySleepStyle : SCREEN_SAVER_PREVIEW_STYLES[screenSaverPreviewIndex])}
        </button>
      ) : null}

      {systemSleepActive ? (
        <button
          className="system-sleep-overlay"
          type="button"
          data-gesture-protected
          aria-label={t("quickMenu.turnScreenOn")}
          onPointerDown={handleSystemSleepWakeGesture}
          onTouchStart={handleSystemSleepWakeGesture}
          onClick={handleSystemSleepWakeGesture}
        >
          <span className="screen-saver-wake-hint">{t("settings.touchToWake")}</span>
        </button>
      ) : null}

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
      {createPortal(<div className={"app-explore-close-overlay" + (exploreClosing ? " active" : "")} />, document.body)}
      {createPortal(<div className={"app-explore-open-overlay" + (exploreOpening ? " active" : "")} />, document.body)}
    </main>
  );
}

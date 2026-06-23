import { useEffect, useRef, useState } from "react";
import type { PlaybackState } from "../types";

const SCENE_LOGO_SRC = "/assets/tikpal-scene-logo.png";
const DEFAULT_FLAME_VIDEO_SRC = "";
const SCENE_DIM_MS = 420;
const SCENE_REVEAL_MS = 760;
const VIDEO_SYNC_TOLERANCE_SECONDS = 2;
const VIDEO_SEEK_SETTLE_MS = 650;
const VIDEO_METADATA_SETTLE_MS = 1200;
const VIDEO_FRAME_READY_SETTLE_MS = 900;
const SCENE_AUDIO_GAIN_MIN_DB = -24;
const SCENE_AUDIO_GAIN_MAX_DB = 12;
const LOOP_PREPARE_LEAD_SECONDS = 1.2;
const LOOP_REVEAL_LEAD_SECONDS = 0.42;
const LOOP_CROSSFADE_MS = 360;
const LOOP_AUDIO_CROSSFADE_MS = 340;
const MIN_DUAL_LOOP_DURATION_SECONDS = 1.5;
const LOOP_SLOTS = [0, 1] as const;
const SINGLE_LOOP_WATCHDOG_MS = 1250;
const SINGLE_LOOP_STALL_MS = 2800;
const SINGLE_LOOP_STALL_RETRY_LIMIT = 2;
const SINGLE_LOOP_STALL_FALLBACK_LIMIT = 3;
const SINGLE_LOOP_STALL_RESET_MS = 60000;
const SINGLE_LOOP_PROGRESS_EPSILON_SECONDS = 0.04;

interface FlameScenePlayback {
  elapsedSeconds: number | null;
  state: PlaybackState;
}

interface FlameSceneProps {
  lowPower?: boolean;
  playback: FlameScenePlayback;
  singleLoop?: boolean;
  staticOnly?: boolean;
  videoEnabled?: boolean;
  audioEnabled?: boolean;
  audioSuspended?: boolean;
  volumePercent?: number;
  videoSrc?: string;
  audioGainDb?: number;
}

interface VideoLayer {
  id: number;
  src: string;
  audioGainDb: number;
}

interface SingleLoopLayer extends VideoLayer {
  frameReady: boolean;
}

type LoopSlot = typeof LOOP_SLOTS[number];
type LoopSlotMap = Record<number, LoopSlot>;
type LoopMonitorHandle =
  | { video: HTMLVideoElement; type: "video-frame"; id: number }
  | { type: "animation-frame" | "timer"; id: number };
type LoopSlotPhase = "active" | "preparing" | "ready" | "handoff" | "parked";
type LoopSlotRole = "active" | "incoming" | "outgoing" | "parked";
type LoopAudioRole = "active" | "crossfade-in" | "crossfade-out" | "muted";
type SceneTransitionPhase = "idle" | "dimming" | "revealing";
type SceneAudioEnvelopeTarget = "current" | "target" | number;
type SingleLoopVideoHealth = "ok" | "recovering" | "stalled" | "fallback";

interface LoopSlotStatus {
  frameReady: boolean;
  phase: LoopSlotPhase;
}

interface LoopHandoffState {
  layerId: number;
  outgoingSlot: LoopSlot;
  incomingSlot: LoopSlot;
  revealing: boolean;
}

interface SingleLoopWatchdogState {
  currentTime: number;
  sampledAtMs: number;
  stalledSinceMs: number | null;
  stallCount: number;
  lastStallAtMs: number;
  recovering: boolean;
}

type VideoFrameElement = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: (now: number) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};
type BrowserAudioContext = typeof AudioContext;
type WebKitWindow = Window & { webkitAudioContext?: BrowserAudioContext };

interface SceneAudioNode {
  context: AudioContext;
  source: MediaElementAudioSourceNode;
  gain: GainNode;
}

const sceneAudioNodes = new WeakMap<HTMLVideoElement, SceneAudioNode>();
let sceneAudioContext: AudioContext | null = null;

function waitForVideoEvent(video: HTMLVideoElement, eventName: keyof HTMLMediaElementEventMap, timeoutMs: number) {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (receivedEvent: boolean) => {
      if (settled) return;
      settled = true;
      video.removeEventListener(eventName, handleEvent);
      window.clearTimeout(timeout);
      resolve(receivedEvent);
    };
    const handleEvent = () => finish(true);
    const timeout = window.setTimeout(() => finish(false), timeoutMs);
    video.addEventListener(eventName, handleEvent, { once: true });
  });
}

function getTargetVideoTime(video: HTMLVideoElement, elapsedSeconds: number | null) {
  const duration = video.duration;
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const elapsed = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds ?? 0) : 0;
  return elapsed % duration;
}

function getLoopAwareDrift(video: HTMLVideoElement, targetTime: number) {
  const duration = video.duration;
  const rawDrift = Math.abs(video.currentTime - targetTime);
  if (!Number.isFinite(duration) || duration <= 0) return rawDrift;
  return Math.min(rawDrift, Math.abs(duration - rawDrift));
}

function normalizeVideoVolume(percent: number | undefined) {
  if (!Number.isFinite(percent)) return 1;
  return Math.max(0, Math.min(1, Math.round(percent ?? 100) / 100));
}

function clampVideoVolume(volume: number) {
  if (!Number.isFinite(volume)) return 0;
  return Math.max(0, Math.min(1, volume));
}

function normalizeAudioGainDb(value: number | undefined) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(SCENE_AUDIO_GAIN_MIN_DB, Math.min(SCENE_AUDIO_GAIN_MAX_DB, Math.round((value ?? 0) * 10) / 10));
}

function dbToLinearGain(db: number) {
  return Math.pow(10, db / 20);
}

function getSceneAudioContext() {
  if (typeof window === "undefined") return null;
  if (sceneAudioContext) return sceneAudioContext;

  const AudioContextConstructor = window.AudioContext ?? (window as WebKitWindow).webkitAudioContext;
  if (!AudioContextConstructor) return null;

  try {
    sceneAudioContext = new AudioContextConstructor();
    return sceneAudioContext;
  } catch {
    return null;
  }
}

function ensureSceneAudioNode(video: HTMLVideoElement) {
  const existing = sceneAudioNodes.get(video);
  if (existing) return existing;

  const context = getSceneAudioContext();
  if (!context) return null;

  try {
    const source = context.createMediaElementSource(video);
    const gain = context.createGain();
    source.connect(gain);
    gain.connect(context.destination);
    const node = { context, source, gain };
    sceneAudioNodes.set(video, node);
    return node;
  } catch {
    return null;
  }
}

function syncSceneAudioGain(video: HTMLVideoElement) {
  const gainDb = normalizeAudioGainDb(Number(video.dataset.sceneGainDb));
  const existing = sceneAudioNodes.get(video);
  if (!existing && (gainDb === 0 || video.volume <= 0)) return;

  const node = ensureSceneAudioNode(video);
  if (!node) return;

  node.gain.gain.value = dbToLinearGain(gainDb);
  if (!video.muted && video.volume > 0 && node.context.state === "suspended") {
    void node.context.resume().catch(() => undefined);
  }
}

function setSceneVideoVolume(video: HTMLVideoElement, volume: number) {
  const safeVolume = clampVideoVolume(volume);
  const gainDb = normalizeAudioGainDb(Number(video.dataset.sceneGainDb));
  video.volume = safeVolume;
  video.dataset.sceneVolume = safeVolume.toFixed(3);
  video.dataset.sceneEffectiveVolume = (safeVolume * dbToLinearGain(gainDb)).toFixed(3);
  syncSceneAudioGain(video);
}

function muteSceneVideo(video: HTMLVideoElement) {
  video.defaultMuted = true;
  video.muted = true;
  syncSceneAudioGain(video);
}

function unmuteSceneVideo(video: HTMLVideoElement) {
  video.muted = false;
  syncSceneAudioGain(video);
}

function getOppositeSlot(slot: LoopSlot): LoopSlot {
  return slot === 0 ? 1 : 0;
}

function slotKey(layerId: number, slot: LoopSlot) {
  return `${layerId}:${slot}`;
}

function getLayerSlot(slots: LoopSlotMap, layerId: number) {
  return slots[layerId] ?? 0;
}

function getLoopSlotStatus(statuses: Record<string, LoopSlotStatus>, key: string): LoopSlotStatus {
  return statuses[key] ?? { frameReady: false, phase: "parked" };
}

function getVideoRole(layerId: number, slot: LoopSlot, visibleSlot: LoopSlot, handoff: LoopHandoffState | null): LoopSlotRole {
  if (handoff?.layerId === layerId) {
    if (slot === handoff.outgoingSlot) return "outgoing";
    if (slot === handoff.incomingSlot) return "incoming";
  }
  return slot === visibleSlot ? "active" : "parked";
}

function getVideoPhase(role: LoopSlotRole, slotStatus: LoopSlotStatus): LoopSlotPhase {
  if (role === "active") return "active";
  if (role === "incoming" || role === "outgoing") return "handoff";
  return slotStatus.phase;
}

function getAudioRole(isAudibleSlot: boolean, loopRole: LoopSlotRole, handoff: LoopHandoffState | null, audioEnabled: boolean, videoVolume: number): LoopAudioRole {
  if (handoff?.revealing && audioEnabled && videoVolume > 0) {
    if (loopRole === "incoming") return "crossfade-in";
    if (loopRole === "outgoing") return "crossfade-out";
  }
  return isAudibleSlot ? "active" : "muted";
}

function waitForDrawableVideoFrame(video: HTMLVideoElement, timeoutMs: number) {
  return new Promise<boolean>((resolve) => {
    const frameVideo = video as VideoFrameElement;
    let settled = false;
    let frameCallbackId: number | null = null;
    let animationFrameId: number | null = null;
    let timeout: number;

    function finish(ready: boolean) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      video.removeEventListener("loadeddata", handleReadyEvent);
      video.removeEventListener("canplay", handleReadyEvent);
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }
      if (frameCallbackId !== null) {
        frameVideo.cancelVideoFrameCallback?.(frameCallbackId);
      }
      resolve(ready);
    }

    function checkReady() {
      if (video.readyState < 2) return false;
      window.requestAnimationFrame(() => finish(true));
      return true;
    }

    function handleReadyEvent() {
      checkReady();
    }

    function pollReady() {
      if (checkReady()) return;
      animationFrameId = window.requestAnimationFrame(pollReady);
    }

    timeout = window.setTimeout(() => finish(false), timeoutMs);

    video.addEventListener("loadeddata", handleReadyEvent);
    video.addEventListener("canplay", handleReadyEvent);
    if (checkReady()) return;

    if (frameVideo.requestVideoFrameCallback) {
      frameCallbackId = frameVideo.requestVideoFrameCallback(() => finish(video.readyState >= 2));
      return;
    }

    animationFrameId = window.requestAnimationFrame(pollReady);
  });
}

async function alignVideoWithPlayback(video: HTMLVideoElement, playback: FlameScenePlayback, forceSync = false) {
  if (video.readyState < 1) {
    const metadataReady = await waitForVideoEvent(video, "loadedmetadata", VIDEO_METADATA_SETTLE_MS);
    if (!metadataReady && video.readyState < 1) {
      return false;
    }
  }

  const targetTime = getTargetVideoTime(video, playback.elapsedSeconds);
  if (targetTime !== null && (forceSync || getLoopAwareDrift(video, targetTime) > VIDEO_SYNC_TOLERANCE_SECONDS)) {
    try {
      video.currentTime = targetTime;
      await waitForVideoEvent(video, "seeked", VIDEO_SEEK_SETTLE_MS);
    } catch {
      // Some browsers reject seeks while metadata is still settling. Playback state is still enforced below.
    }
  }

  const shouldRestoreAudible = !video.muted;
  if (video.paused) {
    muteSceneVideo(video);
  }
  await video.play().then(() => {
    if (shouldRestoreAudible && video.dataset.sceneAudible === "true") {
      unmuteSceneVideo(video);
    }
  }).catch(() => {
    // Inline scene video can still be blocked briefly while a new layer mounts.
  });

  return true;
}

function SceneLogoBackdrop() {
  return (
    <div className="scene-logo-backdrop" aria-hidden="true">
      <img
        className="scene-logo-mark"
        src={SCENE_LOGO_SRC}
        alt=""
        draggable={false}
        onError={(event) => {
          event.currentTarget.hidden = true;
        }}
      />
    </div>
  );
}

export function FlameScene({ lowPower = false, playback, singleLoop = false, staticOnly = false, videoEnabled = true, audioEnabled = false, audioSuspended = false, volumePercent = 100, videoSrc = DEFAULT_FLAME_VIDEO_SRC, audioGainDb = 0 }: FlameSceneProps) {
  const nextLayerIdRef = useRef(0);
  const nextSingleLayerIdRef = useRef(0);
  const activeVideoSrcRef = useRef(videoSrc);
  const activeLayerIdRef = useRef(0);
  const pendingLayerIdRef = useRef<number | null>(null);
  const pendingSingleVideoSrcRef = useRef<string | null>(null);
  const singleVideoSrcRef = useRef(videoSrc);
  const singleActiveLayerIdRef = useRef(0);
  const singlePendingLayerIdRef = useRef<number | null>(null);
  const playbackRef = useRef(playback);
  const videoEnabledRef = useRef(videoEnabled);
  const audioEnabledRef = useRef(audioEnabled);
  const audioSuspendedRef = useRef(audioSuspended);
  const videoVolumeRef = useRef(normalizeVideoVolume(volumePercent));
  const preparingVideoKeysRef = useRef(new Set<string>());
  const transitionActivateTimerRef = useRef<number | null>(null);
  const transitionCleanupTimerRef = useRef<number | null>(null);
  const sceneAudioEnvelopeFrameRef = useRef<number | null>(null);
  const sceneTransitionAudioActiveRef = useRef(false);
  const loopHandoffTimerRef = useRef<number | null>(null);
  const loopAudioCrossfadeFrameRef = useRef<number | null>(null);
  const loopMonitorRef = useRef<LoopMonitorHandle | null>(null);
  const loopHandoffInProgressRef = useRef(false);
  const loopPrepareTokensRef = useRef(new Map<string, number>());
  const singleVideoRef = useRef<HTMLVideoElement | null>(null);
  const singleVideoHealthRef = useRef<SingleLoopVideoHealth>("ok");
  const singleLoopWatchdogTimerRef = useRef<number | null>(null);
  const singleLoopWatchdogRef = useRef<SingleLoopWatchdogState>({
    currentTime: 0,
    sampledAtMs: 0,
    stalledSinceMs: null,
    stallCount: 0,
    lastStallAtMs: 0,
    recovering: false
  });
  const singleVideoRefs = useRef(new Map<number, HTMLVideoElement>());
  const videoRefs = useRef(new Map<string, HTMLVideoElement>());
  const loopVisibleSlotsRef = useRef<LoopSlotMap>({ 0: 0 });
  const loopAudibleSlotsRef = useRef<LoopSlotMap>({ 0: 0 });
  const loopSlotStatusesRef = useRef<Record<string, LoopSlotStatus>>({});
  const [activeLayerId, setActiveLayerId] = useState(0);
  const normalizedAudioGainDb = normalizeAudioGainDb(audioGainDb);
  const [layers, setLayers] = useState<VideoLayer[]>([{ id: 0, src: videoSrc, audioGainDb: normalizedAudioGainDb }]);
  const [sceneTransitioning, setSceneTransitioning] = useState(false);
  const [sceneTransitionPhase, setSceneTransitionPhase] = useState<SceneTransitionPhase>("idle");
  const [loopHandoff, setLoopHandoff] = useState<LoopHandoffState | null>(null);
  const [loopVisibleSlots, setLoopVisibleSlots] = useState<LoopSlotMap>({ 0: 0 });
  const [loopAudibleSlots, setLoopAudibleSlots] = useState<LoopSlotMap>({ 0: 0 });
  const [loopSlotStatuses, setLoopSlotStatuses] = useState<Record<string, LoopSlotStatus>>({});
  const [singleActiveLayerId, setSingleActiveLayerId] = useState(0);
  const [singlePendingLayerId, setSinglePendingLayerId] = useState<number | null>(null);
  const [singleLayers, setSingleLayers] = useState<SingleLoopLayer[]>([{ id: 0, src: videoSrc, audioGainDb: normalizedAudioGainDb, frameReady: false }]);
  const [singleVideoHealth, setSingleVideoHealth] = useState<SingleLoopVideoHealth>("ok");
  const videoVolume = normalizeVideoVolume(volumePercent);
  const singleLoopFallbackActive = singleVideoHealth === "fallback";
  const singleActiveLayer = singleLayers.find((layer) => layer.id === singleActiveLayerId) ?? singleLayers[0] ?? null;
  const singleVideoSrc = singleActiveLayer?.src ?? "";

  function clearTransitionTimers() {
    if (transitionActivateTimerRef.current !== null) {
      window.clearTimeout(transitionActivateTimerRef.current);
      transitionActivateTimerRef.current = null;
    }
    if (transitionCleanupTimerRef.current !== null) {
      window.clearTimeout(transitionCleanupTimerRef.current);
      transitionCleanupTimerRef.current = null;
    }
  }

  function clearSceneAudioEnvelopeFrame() {
    if (sceneAudioEnvelopeFrameRef.current !== null) {
      window.cancelAnimationFrame(sceneAudioEnvelopeFrameRef.current);
      sceneAudioEnvelopeFrameRef.current = null;
    }
  }

  function clearLoopHandoffTimer() {
    if (loopHandoffTimerRef.current !== null) {
      window.clearTimeout(loopHandoffTimerRef.current);
      loopHandoffTimerRef.current = null;
    }
  }

  function clearLoopAudioCrossfadeFrame() {
    if (loopAudioCrossfadeFrameRef.current !== null) {
      window.cancelAnimationFrame(loopAudioCrossfadeFrameRef.current);
      loopAudioCrossfadeFrameRef.current = null;
    }
  }

  function clearLoopMonitor() {
    const monitor = loopMonitorRef.current;
    if (!monitor) return;

    if (monitor.type === "video-frame") {
      (monitor.video as VideoFrameElement).cancelVideoFrameCallback?.(monitor.id);
    } else if (monitor.type === "timer") {
      window.clearTimeout(monitor.id);
    } else {
      window.cancelAnimationFrame(monitor.id);
    }
    loopMonitorRef.current = null;
  }

  function clearSingleLoopWatchdog() {
    if (singleLoopWatchdogTimerRef.current !== null) {
      window.clearTimeout(singleLoopWatchdogTimerRef.current);
      singleLoopWatchdogTimerRef.current = null;
    }
  }

  function patchSingleLoopVideoHealth(health: SingleLoopVideoHealth) {
    singleVideoHealthRef.current = health;
    setSingleVideoHealth((current) => current === health ? current : health);
    if (singleVideoRef.current) {
      singleVideoRef.current.dataset.flameVideoHealth = health;
    }
  }

  function getSingleLoopVideo(layerId = singleActiveLayerIdRef.current) {
    return singleVideoRefs.current.get(layerId) ?? null;
  }

  function patchSingleLayerFrameReady(layerId: number, frameReady: boolean) {
    setSingleLayers((current) => current.map((layer) => (
      layer.id === layerId && layer.frameReady !== frameReady
        ? { ...layer, frameReady }
        : layer
    )));
  }

  function patchSingleActiveLayerId(layerId: number) {
    singleActiveLayerIdRef.current = layerId;
    setSingleActiveLayerId(layerId);
    singleVideoRef.current = getSingleLoopVideo(layerId);
  }

  function patchSinglePendingLayerId(layerId: number | null) {
    singlePendingLayerIdRef.current = layerId;
    setSinglePendingLayerId(layerId);
  }

  function resetSingleLoopWatchdog(health: SingleLoopVideoHealth = "ok") {
    const video = singleVideoRef.current;
    const now = window.performance.now();
    singleLoopWatchdogRef.current = {
      currentTime: video?.currentTime ?? 0,
      sampledAtMs: now,
      stalledSinceMs: null,
      stallCount: 0,
      lastStallAtMs: 0,
      recovering: false
    };
    patchSingleLoopVideoHealth(health);
  }

  function markSingleLoopVideoProgress(video: HTMLVideoElement, health: SingleLoopVideoHealth = "ok") {
    const now = window.performance.now();
    const watchdog = singleLoopWatchdogRef.current;
    if (watchdog.stallCount > 0 && now - watchdog.lastStallAtMs > SINGLE_LOOP_STALL_RESET_MS) {
      watchdog.stallCount = 0;
      watchdog.lastStallAtMs = 0;
    }
    watchdog.currentTime = video.currentTime;
    watchdog.sampledAtMs = now;
    watchdog.stalledSinceMs = null;
    watchdog.recovering = false;
    if (singleVideoHealthRef.current !== "fallback") {
      patchSingleLoopVideoHealth(health);
    }
  }

  function fallBackSingleLoopVideo(video: HTMLVideoElement) {
    clearSingleLoopWatchdog();
    video.dataset.sceneAudible = "false";
    setSceneVideoVolume(video, 0);
    muteSceneVideo(video);
    video.pause();
    patchSingleLoopVideoHealth("fallback");
  }

  function recoverSingleLoopVideo(video: HTMLVideoElement, stallCount: number) {
    if (singleVideoRef.current !== video) return;
    const watchdog = singleLoopWatchdogRef.current;
    if (watchdog.recovering) return;
    watchdog.recovering = true;
    patchSingleLoopVideoHealth(stallCount >= SINGLE_LOOP_STALL_RETRY_LIMIT ? "stalled" : "recovering");

    void (async () => {
      video.dataset.sceneAudible = "false";
      setSceneVideoVolume(video, 0);
      muteSceneVideo(video);
      try {
        video.pause();
        video.load();
        const aligned = await alignVideoWithPlayback(video, playbackRef.current, true);
        const frameReady = aligned
          ? await waitForDrawableVideoFrame(video, VIDEO_FRAME_READY_SETTLE_MS)
          : false;
        if (singleVideoRef.current !== video || singleVideoHealthRef.current === "fallback") return;
        patchSingleLayerFrameReady(singleActiveLayerIdRef.current, frameReady);
        if (frameReady) {
          markSingleLoopVideoProgress(video);
          syncSingleLoopVideo();
        } else {
          patchSingleLoopVideoHealth("stalled");
        }
      } catch {
        if (singleVideoRef.current === video && singleVideoHealthRef.current !== "fallback") {
          patchSingleLoopVideoHealth("stalled");
        }
      } finally {
        if (singleVideoRef.current === video) {
          singleLoopWatchdogRef.current.recovering = false;
        }
      }
    })();
  }

  function patchLoopSlotStatus(key: string, patch: Partial<LoopSlotStatus>) {
    const current = getLoopSlotStatus(loopSlotStatusesRef.current, key);
    const nextStatus = {
      ...current,
      ...patch
    };
    if (current.frameReady === nextStatus.frameReady && current.phase === nextStatus.phase) return;

    const nextStatuses = {
      ...loopSlotStatusesRef.current,
      [key]: nextStatus
    };
    loopSlotStatusesRef.current = nextStatuses;
    setLoopSlotStatuses(nextStatuses);
  }

  function resetLoopSlotStatus(key: string) {
    patchLoopSlotStatus(key, { frameReady: false, phase: "parked" });
  }

  function setVisibleSlot(layerId: number, slot: LoopSlot) {
    const nextSlots = {
      ...loopVisibleSlotsRef.current,
      [layerId]: slot
    };
    loopVisibleSlotsRef.current = nextSlots;
    setLoopVisibleSlots(nextSlots);
  }

  function setAudibleSlot(layerId: number, slot: LoopSlot) {
    const nextSlots = {
      ...loopAudibleSlotsRef.current,
      [layerId]: slot
    };
    loopAudibleSlotsRef.current = nextSlots;
    setLoopAudibleSlots(nextSlots);
    return nextSlots;
  }

  function initializeLoopSlots(layerId: number) {
    setVisibleSlot(layerId, 0);
    setAudibleSlot(layerId, 0);
    LOOP_SLOTS.forEach((slot) => resetLoopSlotStatus(slotKey(layerId, slot)));
  }

  function pruneLoopSlots(keepLayerId: number) {
    const nextVisibleSlots: LoopSlotMap = { [keepLayerId]: getLayerSlot(loopVisibleSlotsRef.current, keepLayerId) };
    const nextAudibleSlots: LoopSlotMap = { [keepLayerId]: getLayerSlot(loopAudibleSlotsRef.current, keepLayerId) };
    const nextStatuses = Object.fromEntries(
      Object.entries(loopSlotStatusesRef.current).filter(([key]) => key.startsWith(`${keepLayerId}:`))
    );
    loopVisibleSlotsRef.current = nextVisibleSlots;
    loopAudibleSlotsRef.current = nextAudibleSlots;
    loopSlotStatusesRef.current = nextStatuses;
    setLoopVisibleSlots(nextVisibleSlots);
    setLoopAudibleSlots(nextAudibleSlots);
    setLoopSlotStatuses(nextStatuses);
  }

  function applySceneAudioVolume(video: HTMLVideoElement, overrideVolume?: number) {
    const keepsAudioPath = video.dataset.sceneAudible === "true";
    const nextVolume = keepsAudioPath ? overrideVolume ?? videoVolumeRef.current : 0;
    setSceneVideoVolume(video, nextVolume);
    if (keepsAudioPath) {
      unmuteSceneVideo(video);
    } else {
      muteSceneVideo(video);
    }
  }

  function getAudibleVideoForLayer(layerId: number) {
    return getSlotVideo(layerId, getLayerSlot(loopAudibleSlotsRef.current, layerId));
  }

  function resolveSceneAudioEnvelopeTarget(value: SceneAudioEnvelopeTarget, video: HTMLVideoElement) {
    if (value === "current") {
      return clampVideoVolume(Number.parseFloat(video.dataset.sceneVolume ?? "") || video.volume);
    }
    if (value === "target") {
      return videoEnabledRef.current && audioEnabledRef.current ? videoVolumeRef.current : 0;
    }
    return clampVideoVolume(value);
  }

  function startSceneAudioEnvelope(
    videos: Array<HTMLVideoElement | null>,
    from: SceneAudioEnvelopeTarget,
    to: SceneAudioEnvelopeTarget,
    durationMs: number,
    onComplete?: () => void
  ) {
    clearSceneAudioEnvelopeFrame();
    const entries = videos
      .filter((video): video is HTMLVideoElement => Boolean(video))
      .map((video) => ({
        video,
        fromVolume: resolveSceneAudioEnvelopeTarget(from, video)
      }));

    if (entries.length === 0 || durationMs <= 0) {
      onComplete?.();
      return;
    }

    const startedAt = window.performance.now();
    const step = (now: number) => {
      if (!sceneTransitionAudioActiveRef.current) {
        sceneAudioEnvelopeFrameRef.current = null;
        return;
      }

      const progress = Math.max(0, Math.min(1, (now - startedAt) / durationMs));
      for (const entry of entries) {
        const targetVolume = resolveSceneAudioEnvelopeTarget(to, entry.video);
        const nextVolume = entry.fromVolume + ((targetVolume - entry.fromVolume) * progress);
        const shouldBeAudible = videoEnabledRef.current && audioEnabledRef.current && targetVolume > 0;
        entry.video.dataset.sceneAudible = shouldBeAudible ? "true" : "false";
        setSceneVideoVolume(entry.video, shouldBeAudible ? nextVolume : 0);
        if (shouldBeAudible) {
          unmuteSceneVideo(entry.video);
        } else {
          muteSceneVideo(entry.video);
        }
        if (shouldBeAudible && entry.video.paused) {
          void entry.video.play().catch(() => undefined);
        }
      }

      if (progress < 1) {
        sceneAudioEnvelopeFrameRef.current = window.requestAnimationFrame(step);
        return;
      }

      sceneAudioEnvelopeFrameRef.current = null;
      onComplete?.();
    };

    sceneAudioEnvelopeFrameRef.current = window.requestAnimationFrame(step);
  }

  function resetStandbyVideo(video: HTMLVideoElement) {
    video.dataset.sceneAudible = "false";
    setSceneVideoVolume(video, 0);
    muteSceneVideo(video);
    video.pause();
    try {
      if (video.readyState >= 1) {
        video.currentTime = 0;
      }
    } catch {
      // The browser may reject a reset while the media element is still settling.
    }
  }

  function parkSlotVideo(layerId: number, slot: LoopSlot, video: HTMLVideoElement) {
    resetStandbyVideo(video);
    resetLoopSlotStatus(slotKey(layerId, slot));
  }

  function activatePreparedLayer(layerId: number) {
    const previousLayerId = activeLayerIdRef.current;
    const previousVideo = getAudibleVideoForLayer(previousLayerId);
    pendingLayerIdRef.current = null;
    clearTransitionTimers();
    sceneTransitionAudioActiveRef.current = true;
    setSceneTransitioning(true);
    setSceneTransitionPhase("dimming");
    startSceneAudioEnvelope([previousVideo], "current", 0, SCENE_DIM_MS);
    transitionActivateTimerRef.current = window.setTimeout(() => {
      transitionActivateTimerRef.current = null;
      activeLayerIdRef.current = layerId;
      setActiveLayerId(layerId);
      setSceneTransitionPhase("revealing");
      const nextVideo = getAudibleVideoForLayer(layerId);
      if (nextVideo) {
        nextVideo.dataset.sceneAudible = videoEnabledRef.current && audioEnabledRef.current && videoVolumeRef.current > 0 ? "true" : "false";
        setSceneVideoVolume(nextVideo, 0);
        if (nextVideo.dataset.sceneAudible === "true") {
          unmuteSceneVideo(nextVideo);
        } else {
          muteSceneVideo(nextVideo);
        }
        void nextVideo.play().catch(() => undefined);
        startSceneAudioEnvelope([nextVideo], 0, "target", SCENE_REVEAL_MS, () => {
          sceneTransitionAudioActiveRef.current = false;
          syncSceneAudio();
        });
      } else {
        sceneTransitionAudioActiveRef.current = false;
        syncSceneAudio();
      }
      transitionCleanupTimerRef.current = window.setTimeout(() => {
        setLayers((current) => current.filter((layer) => layer.id === layerId));
        setSceneTransitioning(false);
        setSceneTransitionPhase("idle");
        pruneLoopSlots(layerId);
        transitionCleanupTimerRef.current = null;
      }, SCENE_REVEAL_MS);
    }, SCENE_DIM_MS);
  }

  function getSlotVideo(layerId: number, slot: LoopSlot) {
    return videoRefs.current.get(slotKey(layerId, slot)) ?? null;
  }

  function prepareVideoSlot(layerId: number, slot: LoopSlot, options: { forceSync?: boolean; activatePending?: boolean } = {}) {
    const key = slotKey(layerId, slot);
    const video = getSlotVideo(layerId, slot);
    if (!video || preparingVideoKeysRef.current.has(key)) return;

    preparingVideoKeysRef.current.add(key);
    void alignVideoWithPlayback(video, playbackRef.current, Boolean(options.forceSync))
      .then(async (ready) => {
        const frameReady = ready
          ? await waitForDrawableVideoFrame(video, VIDEO_FRAME_READY_SETTLE_MS)
          : false;
        if (videoRefs.current.get(key) === video) {
          patchLoopSlotStatus(key, { frameReady, phase: slot === getLayerSlot(loopVisibleSlotsRef.current, layerId) ? "active" : "parked" });
        }
        if (frameReady && options.activatePending && pendingLayerIdRef.current === layerId) {
          activatePreparedLayer(layerId);
        }
      })
      .finally(() => {
        preparingVideoKeysRef.current.delete(key);
      });
  }

  function syncSceneAudio(audibleSlots = loopAudibleSlotsRef.current) {
    const targetVolume = audioEnabledRef.current ? videoVolumeRef.current : 0;
    const transitionEnvelopeActive = sceneTransitionAudioActiveRef.current;
    videoRefs.current.forEach((video, key) => {
      if (audioSuspendedRef.current) {
        video.dataset.sceneAudible = "false";
        setSceneVideoVolume(video, 0);
        muteSceneVideo(video);
        video.pause();
        return;
      }

      const [layerIdRaw, slotRaw] = key.split(":");
      const layerId = Number(layerIdRaw);
      const slot = Number(slotRaw) as LoopSlot;
      const isActiveLayer = layerId === activeLayerIdRef.current;
      const shouldBeAudible = videoEnabledRef.current
        && audioEnabledRef.current
        && targetVolume > 0
        && isActiveLayer
        && slot === getLayerSlot(audibleSlots, layerId);
      video.dataset.sceneAudible = shouldBeAudible ? "true" : "false";
      applySceneAudioVolume(video, transitionEnvelopeActive && shouldBeAudible ? 0 : undefined);

      if (!isActiveLayer) {
        muteSceneVideo(video);
        return;
      }

      if (shouldBeAudible) {
        if (video.paused) {
          muteSceneVideo(video);
          void video.play().then(() => {
            if (video.dataset.sceneAudible === "true") {
              applySceneAudioVolume(video, sceneTransitionAudioActiveRef.current ? 0 : undefined);
              unmuteSceneVideo(video);
            }
          }).catch(() => {
            muteSceneVideo(video);
          });
        } else {
          unmuteSceneVideo(video);
        }
        return;
      }

      muteSceneVideo(video);
    });
  }

  function syncSingleLoopVideo() {
    const video = getSingleLoopVideo();
    singleVideoRef.current = video;
    if (!video) return;
    if (singleVideoHealthRef.current === "fallback") return;
    if (audioSuspendedRef.current) {
      video.dataset.sceneAudible = "false";
      setSceneVideoVolume(video, 0);
      muteSceneVideo(video);
      video.pause();
      return;
    }

    const shouldBeAudible = videoEnabledRef.current && audioEnabledRef.current && videoVolumeRef.current > 0;
    video.dataset.sceneAudible = shouldBeAudible ? "true" : "false";
    setSceneVideoVolume(video, shouldBeAudible ? (sceneTransitionAudioActiveRef.current ? 0 : videoVolumeRef.current) : 0);
    muteSceneVideo(video);

    void alignVideoWithPlayback(video, playbackRef.current, false)
      .then(() => {
        if (getSingleLoopVideo() !== video) return;
        if (video.dataset.sceneAudible === "true") {
          setSceneVideoVolume(video, sceneTransitionAudioActiveRef.current ? 0 : videoVolumeRef.current);
          unmuteSceneVideo(video);
        }
      })
      .catch(() => {
        muteSceneVideo(video);
      });
  }

  function activatePreparedSingleLoopLayer(layerId: number) {
    const nextVideo = getSingleLoopVideo(layerId);
    const nextLayer = singleLayers.find((layer) => layer.id === layerId);
    if (!nextVideo || !nextLayer) return;
    if (singlePendingLayerIdRef.current !== layerId) return;
    if (pendingSingleVideoSrcRef.current !== nextLayer.src) return;

    const previousVideo = getSingleLoopVideo();
    pendingSingleVideoSrcRef.current = null;
    clearTransitionTimers();
    sceneTransitionAudioActiveRef.current = true;
    setSceneTransitioning(true);
    setSceneTransitionPhase("dimming");
    startSceneAudioEnvelope([previousVideo], "current", 0, SCENE_DIM_MS);

    transitionActivateTimerRef.current = window.setTimeout(() => {
      transitionActivateTimerRef.current = null;
      singleVideoSrcRef.current = nextLayer.src;
      patchSingleActiveLayerId(layerId);
      setSceneTransitionPhase("revealing");

      nextVideo.dataset.sceneAudible = videoEnabledRef.current && audioEnabledRef.current && videoVolumeRef.current > 0 ? "true" : "false";
      setSceneVideoVolume(nextVideo, 0);
      if (nextVideo.dataset.sceneAudible === "true") {
        unmuteSceneVideo(nextVideo);
      } else {
        muteSceneVideo(nextVideo);
      }
      void nextVideo.play().catch(() => undefined);
      startSceneAudioEnvelope([nextVideo], 0, "target", SCENE_REVEAL_MS, () => {
        sceneTransitionAudioActiveRef.current = false;
        syncSingleLoopVideo();
      });

      transitionCleanupTimerRef.current = window.setTimeout(() => {
        setSingleLayers((current) => current.filter((layer) => layer.id === layerId));
        patchSinglePendingLayerId(null);
        setSceneTransitioning(false);
        setSceneTransitionPhase("idle");
        transitionCleanupTimerRef.current = null;
      }, SCENE_REVEAL_MS);
    }, SCENE_DIM_MS);
  }

  function prepareSingleLoopLayer(layerId: number, video: HTMLVideoElement, forceSync = false) {
    const key = `single:${layerId}`;
    if (preparingVideoKeysRef.current.has(key)) return;
    preparingVideoKeysRef.current.add(key);

    if (layerId !== singleActiveLayerIdRef.current) {
      video.dataset.sceneAudible = "false";
      setSceneVideoVolume(video, 0);
      muteSceneVideo(video);
    }

    void alignVideoWithPlayback(video, playbackRef.current, forceSync)
      .then(async (ready) => {
        const frameReady = ready
          ? await waitForDrawableVideoFrame(video, VIDEO_FRAME_READY_SETTLE_MS)
          : false;
        if (singleVideoRefs.current.get(layerId) !== video) return;
        patchSingleLayerFrameReady(layerId, frameReady);
        if (frameReady && singlePendingLayerIdRef.current === layerId) {
          activatePreparedSingleLoopLayer(layerId);
        }
      })
      .finally(() => {
        preparingVideoKeysRef.current.delete(key);
      });
  }

  function handleSingleLoopFrameReady(layerId: number, video: HTMLVideoElement, forceSync = false) {
    if (singlePendingLayerIdRef.current === layerId) {
      prepareSingleLoopLayer(layerId, video, forceSync);
      return;
    }

    void waitForDrawableVideoFrame(video, VIDEO_FRAME_READY_SETTLE_MS).then((ready) => {
      if (singleVideoRefs.current.get(layerId) !== video) return;
      patchSingleLayerFrameReady(layerId, ready);
    });
  }

  function dropPendingSingleLoopLayer(layerId: number) {
    if (singlePendingLayerIdRef.current !== layerId) return;
    pendingSingleVideoSrcRef.current = null;
    patchSinglePendingLayerId(null);
    transitionCleanupTimerRef.current = window.setTimeout(() => {
      setSingleLayers((current) => current.filter((layer) => layer.id !== layerId));
      transitionCleanupTimerRef.current = null;
    }, 0);
  }

  function isSlotFrameReady(layerId: number, slot: LoopSlot) {
    const key = slotKey(layerId, slot);
    const video = getSlotVideo(layerId, slot);
    const status = getLoopSlotStatus(loopSlotStatusesRef.current, key);
    return Boolean(video && status.frameReady && video.readyState >= 2);
  }

  function prepareStandbyForLoop(layerId: number, fromSlot: LoopSlot) {
    if (loopHandoffInProgressRef.current || layerId !== activeLayerIdRef.current) return;
    if (getLayerSlot(loopVisibleSlotsRef.current, layerId) !== fromSlot) return;

    const standbySlot = getOppositeSlot(fromSlot);
    const standbyVideo = getSlotVideo(layerId, standbySlot);
    if (!standbyVideo) return;

    const key = slotKey(layerId, standbySlot);
    const status = getLoopSlotStatus(loopSlotStatusesRef.current, key);
    if (status.frameReady || status.phase === "preparing") return;

    const token = (loopPrepareTokensRef.current.get(key) ?? 0) + 1;
    loopPrepareTokensRef.current.set(key, token);
    patchLoopSlotStatus(key, { frameReady: false, phase: "preparing" });

    standbyVideo.dataset.sceneAudible = "false";
    setSceneVideoVolume(standbyVideo, 0);
    muteSceneVideo(standbyVideo);

    void (async () => {
      if (standbyVideo.readyState < 1) {
        const metadataReady = await waitForVideoEvent(standbyVideo, "loadedmetadata", VIDEO_METADATA_SETTLE_MS);
        if (!metadataReady && standbyVideo.readyState < 1) {
          patchLoopSlotStatus(key, { frameReady: false, phase: "parked" });
          return;
        }
      }

      if (loopPrepareTokensRef.current.get(key) !== token || videoRefs.current.get(key) !== standbyVideo) return;

      try {
        const shouldWaitForSeek = standbyVideo.currentTime > 0.03 || standbyVideo.ended;
        standbyVideo.currentTime = 0;
        if (shouldWaitForSeek) {
          await waitForVideoEvent(standbyVideo, "seeked", VIDEO_SEEK_SETTLE_MS);
        }
      } catch {
        // The standby may already be parked at the first decoded frame.
      }

      if (loopPrepareTokensRef.current.get(key) !== token || videoRefs.current.get(key) !== standbyVideo) return;

      await standbyVideo.play().catch(() => undefined);
      if (standbyVideo.readyState < 2) {
        await waitForVideoEvent(standbyVideo, "loadeddata", VIDEO_FRAME_READY_SETTLE_MS);
      }
      const frameReady = await waitForDrawableVideoFrame(standbyVideo, VIDEO_FRAME_READY_SETTLE_MS);

      if (loopPrepareTokensRef.current.get(key) !== token || videoRefs.current.get(key) !== standbyVideo) return;

      loopPrepareTokensRef.current.delete(key);
      if (!frameReady) {
        patchLoopSlotStatus(key, { frameReady: false, phase: "parked" });
        scheduleLoopMonitor(80);
        return;
      }

      standbyVideo.pause();
      patchLoopSlotStatus(key, { frameReady: true, phase: "ready" });

      if (
        activeLayerIdRef.current === layerId
        && getLayerSlot(loopVisibleSlotsRef.current, layerId) === fromSlot
      ) {
        checkLoopHandoff(layerId, fromSlot);
      }
    })();
  }

  function startLoopHandoff(layerId: number, fromSlot: LoopSlot) {
    if (loopHandoffInProgressRef.current || layerId !== activeLayerIdRef.current) return;
    if (getLayerSlot(loopVisibleSlotsRef.current, layerId) !== fromSlot) return;

    const activeVideo = getSlotVideo(layerId, fromSlot);
    const standbySlot = getOppositeSlot(fromSlot);
    const standbyVideo = getSlotVideo(layerId, standbySlot);
    if (!activeVideo || !standbyVideo) return;

    const duration = activeVideo.duration;
    if (!Number.isFinite(duration) || duration < MIN_DUAL_LOOP_DURATION_SECONDS) return;
    if (!isSlotFrameReady(layerId, standbySlot)) {
      prepareStandbyForLoop(layerId, fromSlot);
      scheduleLoopMonitor(40);
      return;
    }

    loopHandoffInProgressRef.current = true;
    clearLoopMonitor();
    clearLoopHandoffTimer();
    clearLoopAudioCrossfadeFrame();

    setLoopHandoff({
      layerId,
      outgoingSlot: fromSlot,
      incomingSlot: standbySlot,
      revealing: false
    });

    void standbyVideo.play().catch(() => undefined);
    window.requestAnimationFrame(() => {
      if (activeLayerIdRef.current !== layerId || getLayerSlot(loopVisibleSlotsRef.current, layerId) !== fromSlot) {
        loopHandoffInProgressRef.current = false;
        setLoopHandoff(null);
        scheduleLoopMonitor();
        return;
      }

      setVisibleSlot(layerId, standbySlot);
      setLoopHandoff({
        layerId,
        outgoingSlot: fromSlot,
        incomingSlot: standbySlot,
        revealing: true
      });
      let audioCrossfadeDone = false;
      const finishLoopAudio = () => {
        if (audioCrossfadeDone) return;
        audioCrossfadeDone = true;
        clearLoopAudioCrossfadeFrame();
        const nextAudibleSlots = setAudibleSlot(layerId, standbySlot);
        syncSceneAudio(nextAudibleSlots);
      };
      const startLoopAudioCrossfade = () => {
        const targetVolume = videoVolumeRef.current;
        if (!videoEnabledRef.current || !audioEnabledRef.current || targetVolume <= 0) {
          finishLoopAudio();
          return;
        }

        const startedAt = window.performance.now();
        activeVideo.dataset.sceneAudible = "true";
        standbyVideo.dataset.sceneAudible = "true";
        setSceneVideoVolume(standbyVideo, 0);
        unmuteSceneVideo(activeVideo);
        unmuteSceneVideo(standbyVideo);

        const step = (now: number) => {
          if (
            activeLayerIdRef.current !== layerId
            || !loopHandoffInProgressRef.current
            || !videoEnabledRef.current
            || !audioEnabledRef.current
          ) {
            finishLoopAudio();
            return;
          }

          const progress = Math.max(0, Math.min(1, (now - startedAt) / LOOP_AUDIO_CROSSFADE_MS));
          setSceneVideoVolume(activeVideo, targetVolume * (1 - progress));
          setSceneVideoVolume(standbyVideo, targetVolume * progress);
          unmuteSceneVideo(activeVideo);
          unmuteSceneVideo(standbyVideo);

          if (progress < 1) {
            loopAudioCrossfadeFrameRef.current = window.requestAnimationFrame(step);
            return;
          }

          finishLoopAudio();
        };

        loopAudioCrossfadeFrameRef.current = window.requestAnimationFrame(step);
      };
      startLoopAudioCrossfade();
      loopHandoffTimerRef.current = window.setTimeout(() => {
        finishLoopAudio();
        setLoopHandoff(null);
        patchLoopSlotStatus(slotKey(layerId, standbySlot), { frameReady: true, phase: "active" });
        parkSlotVideo(layerId, fromSlot, activeVideo);
        loopHandoffInProgressRef.current = false;
        loopHandoffTimerRef.current = null;
        scheduleLoopMonitor();
      }, LOOP_CROSSFADE_MS);
    });
  }

  function checkLoopHandoff(layerId: number, slot: LoopSlot) {
    if (singleLoop || !videoEnabled || loopHandoffInProgressRef.current) return;
    if (layerId !== activeLayerIdRef.current || slot !== getLayerSlot(loopVisibleSlotsRef.current, layerId)) return;

    const video = getSlotVideo(layerId, slot);
    if (!video) return;

    const duration = video.duration;
    if (!Number.isFinite(duration) || duration < MIN_DUAL_LOOP_DURATION_SECONDS) {
      scheduleLoopMonitor();
      return;
    }

    if (video.ended || video.currentTime >= duration - LOOP_PREPARE_LEAD_SECONDS) {
      prepareStandbyForLoop(layerId, slot);
    }

    if (video.ended || video.currentTime >= duration - LOOP_REVEAL_LEAD_SECONDS) {
      startLoopHandoff(layerId, slot);
      return;
    }

    scheduleLoopMonitor();
  }

  function scheduleLoopMonitor(delayMs = 0) {
    clearLoopMonitor();
    if (singleLoop || !videoEnabled || !videoSrc || loopHandoffInProgressRef.current) return;

    const layerId = activeLayerIdRef.current;
    const slot = getLayerSlot(loopVisibleSlotsRef.current, layerId);
    const video = getSlotVideo(layerId, slot);
    if (!video || video.readyState < 1) return;

    if (delayMs > 0 || video.ended) {
      const id = window.setTimeout(() => {
        loopMonitorRef.current = null;
        checkLoopHandoff(layerId, slot);
      }, delayMs);
      loopMonitorRef.current = { type: "timer", id };
      return;
    }

    const frameVideo = video as VideoFrameElement;
    if (frameVideo.requestVideoFrameCallback) {
      const id = frameVideo.requestVideoFrameCallback(() => {
        loopMonitorRef.current = null;
        checkLoopHandoff(layerId, slot);
      });
      loopMonitorRef.current = { video, type: "video-frame", id };
      return;
    }

    const id = window.requestAnimationFrame(() => {
      loopMonitorRef.current = null;
      checkLoopHandoff(layerId, slot);
    });
    loopMonitorRef.current = { type: "animation-frame", id };
  }

  useEffect(() => {
    playbackRef.current = playback;
  }, [playback.elapsedSeconds, playback.state]);

  useEffect(() => {
    videoEnabledRef.current = videoEnabled;
    audioEnabledRef.current = audioEnabled;
    audioSuspendedRef.current = audioSuspended;
    videoVolumeRef.current = videoVolume;
  }, [audioEnabled, audioSuspended, videoEnabled, videoVolume]);

  useEffect(() => {
    if (!singleLoop) return undefined;
    clearLoopMonitor();
    clearLoopHandoffTimer();
    clearLoopAudioCrossfadeFrame();
    clearSingleLoopWatchdog();
    resetSingleLoopWatchdog();
    loopHandoffInProgressRef.current = false;
    setLoopHandoff(null);
    videoRefs.current.forEach((video) => {
      video.dataset.sceneAudible = "false";
      setSceneVideoVolume(video, 0);
      muteSceneVideo(video);
      video.pause();
    });
    return undefined;
  }, [singleLoop]);

  useEffect(() => {
    activeLayerIdRef.current = activeLayerId;
  }, [activeLayerId]);

  useEffect(() => {
    singleActiveLayerIdRef.current = singleActiveLayerId;
    singleVideoRef.current = getSingleLoopVideo(singleActiveLayerId);
  }, [singleActiveLayerId, singleLayers]);

  useEffect(() => {
    singlePendingLayerIdRef.current = singlePendingLayerId;
  }, [singlePendingLayerId]);

  useEffect(() => () => {
    clearTransitionTimers();
    clearSceneAudioEnvelopeFrame();
    clearLoopHandoffTimer();
    clearLoopAudioCrossfadeFrame();
    clearLoopMonitor();
    clearSingleLoopWatchdog();
  }, []);

  useEffect(() => {
    if (!singleLoop) return;
    if (singleVideoSrcRef.current === videoSrc) {
      setSingleLayers((current) => current.map((layer) => (
        layer.id === singleActiveLayerIdRef.current
          ? { ...layer, audioGainDb: normalizedAudioGainDb }
          : layer
      )));
      return;
    }

    if (!singleVideoSrcRef.current || !videoEnabled || staticOnly) {
      pendingSingleVideoSrcRef.current = null;
      patchSinglePendingLayerId(null);
      singleVideoSrcRef.current = videoSrc;
      const nextLayer = {
        id: nextSingleLayerIdRef.current + 1,
        src: videoSrc,
        audioGainDb: normalizedAudioGainDb,
        frameReady: false
      };
      nextSingleLayerIdRef.current = nextLayer.id;
      patchSingleActiveLayerId(nextLayer.id);
      setSingleLayers([nextLayer]);
      setSceneTransitioning(false);
      setSceneTransitionPhase("idle");
      return;
    }

    clearTransitionTimers();
    clearSceneAudioEnvelopeFrame();
    sceneTransitionAudioActiveRef.current = false;
    setSceneTransitioning(false);
    setSceneTransitionPhase("idle");

    const nextLayer = {
      id: nextSingleLayerIdRef.current + 1,
      src: videoSrc,
      audioGainDb: normalizedAudioGainDb,
      frameReady: false
    };
    nextSingleLayerIdRef.current = nextLayer.id;
    pendingSingleVideoSrcRef.current = videoSrc;
    patchSinglePendingLayerId(nextLayer.id);
    setSingleLayers((current) => {
      const activeLayer = current.find((layer) => layer.id === singleActiveLayerIdRef.current) ?? current[0];
      return activeLayer ? [activeLayer, nextLayer] : [nextLayer];
    });
  }, [normalizedAudioGainDb, singleLoop, staticOnly, videoEnabled, videoSrc]);

  useEffect(() => {
    if (!singleLoop || staticOnly || !videoEnabled || !singleVideoSrc) return;
    syncSingleLoopVideo();
  }, [audioEnabled, audioSuspended, playback.state, singleActiveLayerId, singleLoop, singleVideoSrc, staticOnly, videoEnabled, videoVolume]);

  useEffect(() => {
    if (!singleLoop) return undefined;
    clearSingleLoopWatchdog();
    resetSingleLoopWatchdog();
    return clearSingleLoopWatchdog;
  }, [singleActiveLayerId, singleLoop, singleVideoSrc, staticOnly, videoEnabled]);

  useEffect(() => {
    clearSingleLoopWatchdog();
    if (!singleLoop || staticOnly || !videoEnabled || !singleVideoSrc || singleLoopFallbackActive) {
      return clearSingleLoopWatchdog;
    }

    const scheduleWatchdog = (delayMs = SINGLE_LOOP_WATCHDOG_MS) => {
      singleLoopWatchdogTimerRef.current = window.setTimeout(tick, delayMs);
    };

    const tick = () => {
      singleLoopWatchdogTimerRef.current = null;
      const video = singleVideoRef.current;
      if (!video || singleVideoHealthRef.current === "fallback") return;

      const watchdog = singleLoopWatchdogRef.current;
      const now = window.performance.now();
      const currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      const hasProgress = Math.abs(currentTime - watchdog.currentTime) > SINGLE_LOOP_PROGRESS_EPSILON_SECONDS;

      if (video.readyState < 2 || video.seeking) {
        scheduleWatchdog();
        return;
      }

      if (hasProgress) {
        markSingleLoopVideoProgress(video, singleVideoHealthRef.current === "stalled" ? "recovering" : "ok");
        scheduleWatchdog();
        return;
      }

      watchdog.stalledSinceMs ??= now;
      if (now - watchdog.stalledSinceMs >= SINGLE_LOOP_STALL_MS && !watchdog.recovering) {
        watchdog.stallCount += 1;
        watchdog.lastStallAtMs = now;
        if (watchdog.stallCount >= SINGLE_LOOP_STALL_FALLBACK_LIMIT) {
          fallBackSingleLoopVideo(video);
          return;
        }
        recoverSingleLoopVideo(video, watchdog.stallCount);
      }

      scheduleWatchdog();
    };

    scheduleWatchdog(0);
    return clearSingleLoopWatchdog;
  }, [singleLoop, singleLoopFallbackActive, singleVideoSrc, staticOnly, videoEnabled]);

  useEffect(() => {
    if (!singleLoop || singlePendingLayerId === null) return;
    const pendingVideo = getSingleLoopVideo(singlePendingLayerId);
    if (!pendingVideo) return;
    prepareSingleLoopLayer(singlePendingLayerId, pendingVideo, true);
  }, [singleLoop, singlePendingLayerId, singleLayers]);

  useEffect(() => {
    if (singleLoop || staticOnly || !videoEnabled) return;
    setLayers((current) => current.map((layer) => (
      layer.src === videoSrc ? { ...layer, audioGainDb: normalizedAudioGainDb } : layer
    )));
  }, [normalizedAudioGainDb, singleLoop, staticOnly, videoEnabled, videoSrc]);

  useEffect(() => {
    if (singleLoop || !videoEnabled || staticOnly) return undefined;
    if (activeVideoSrcRef.current === videoSrc) return undefined;
    activeVideoSrcRef.current = videoSrc;
    clearLoopMonitor();
    clearLoopHandoffTimer();
    clearLoopAudioCrossfadeFrame();
    loopHandoffInProgressRef.current = false;
    setLoopHandoff(null);
    syncSceneAudio();

    if (!videoSrc) {
      pendingLayerIdRef.current = null;
      clearTransitionTimers();
      sceneTransitionAudioActiveRef.current = false;
      setSceneTransitioning(false);
      setSceneTransitionPhase("idle");
      setLayers([{ id: activeLayerIdRef.current, src: "", audioGainDb: 0 }]);
      return undefined;
    }

    const nextLayer = {
      id: nextLayerIdRef.current + 1,
      src: videoSrc,
      audioGainDb: normalizedAudioGainDb
    };
    nextLayerIdRef.current = nextLayer.id;
    initializeLoopSlots(nextLayer.id);

    const activeLayer = layers.find((layer) => layer.id === activeLayerIdRef.current);
    if (!activeLayer?.src) {
      pendingLayerIdRef.current = null;
      activeLayerIdRef.current = nextLayer.id;
      setActiveLayerId(nextLayer.id);
      setLayers([nextLayer]);
      return undefined;
    }

    pendingLayerIdRef.current = nextLayer.id;
    setLayers((current) => {
      const currentActiveLayer = current.find((layer) => layer.id === activeLayerIdRef.current) ?? current[current.length - 1];
      return currentActiveLayer ? [currentActiveLayer, nextLayer] : [nextLayer];
    });
    return undefined;
  }, [layers, normalizedAudioGainDb, singleLoop, staticOnly, videoEnabled, videoSrc]);

  useEffect(() => {
    if (!singleLoop && videoEnabled && !staticOnly) return undefined;
    clearLoopMonitor();
    clearLoopHandoffTimer();
    clearLoopAudioCrossfadeFrame();
    loopHandoffInProgressRef.current = false;
    setLoopHandoff(null);
    videoRefs.current.forEach((video) => {
      video.dataset.sceneAudible = "false";
      setSceneVideoVolume(video, 0);
      muteSceneVideo(video);
    });
    return undefined;
  }, [singleLoop, staticOnly, videoEnabled]);

  useEffect(() => {
    if (singleLoop || !videoEnabled || staticOnly) return;
    layers.forEach((layer) => {
      const isPendingLayer = pendingLayerIdRef.current === layer.id;
      const visibleSlot = getLayerSlot(loopVisibleSlotsRef.current, layer.id);
      prepareVideoSlot(layer.id, visibleSlot, {
        activatePending: isPendingLayer,
        forceSync: isPendingLayer
      });
    });
  }, [layers, playback.state, singleLoop, staticOnly, videoEnabled]);

  useEffect(() => {
    if (singleLoop || !videoEnabled || staticOnly) return;
    clearLoopAudioCrossfadeFrame();
    syncSceneAudio();
  }, [activeLayerId, audioEnabled, audioSuspended, layers, loopAudibleSlots, normalizedAudioGainDb, singleLoop, staticOnly, videoEnabled, videoVolume]);

  useEffect(() => {
    if (singleLoop || staticOnly) return clearLoopMonitor;
    scheduleLoopMonitor();
    return clearLoopMonitor;
  }, [activeLayerId, layers, loopVisibleSlots, singleLoop, staticOnly, videoEnabled, videoSrc]);

  if (staticOnly && videoSrc) {
    return (
      <div className="flame-scene is-low-power is-static-only" aria-hidden="true">
        <SceneLogoBackdrop />
      </div>
    );
  }

  if (!videoEnabled || !videoSrc) {
    return <div className="flame-scene is-video-off" aria-hidden="true" />;
  }

  if (singleLoop) {
    const audioActive = audioEnabled && !audioSuspended && videoVolume > 0;

    return (
      <div
        className={`flame-scene ${lowPower ? "is-low-power" : ""} is-single-loop ${singleLoopFallbackActive ? "is-video-fallback" : ""} ${sceneTransitioning ? "is-transitioning is-scene-transitioning" : ""}`}
        aria-hidden="true"
        data-flame-transition={sceneTransitioning ? "scene" : "none"}
        data-flame-transition-phase={sceneTransitionPhase}
        data-flame-loop-mode="single"
        data-flame-video-health={singleVideoHealth}
      >
        <SceneLogoBackdrop />
        {!singleLoopFallbackActive ? singleLayers.filter((layer) => Boolean(layer.src)).map((layer) => {
          const isActiveLayer = layer.id === singleActiveLayerId;
          const isPendingLayer = layer.id === singlePendingLayerId;
          const layerRole = isActiveLayer ? "active" : isPendingLayer ? "incoming" : "outgoing";
          const loopPhase = isActiveLayer
            ? "active"
            : isPendingLayer
            ? layer.frameReady ? "ready" : "preparing"
            : "handoff";
          const layerAudioActive = isActiveLayer && audioActive;

          return (
            <div
              key={layer.id}
              className={`flame-video-layer ${isActiveLayer ? "is-active" : isPendingLayer ? "is-pending" : "is-exiting"}`}
              data-flame-layer={layerRole}
              data-flame-loop-handoff={layerRole === "outgoing" || layerRole === "incoming" ? "active" : "none"}
            >
              <video
                ref={(node) => {
                  if (node) {
                    singleVideoRefs.current.set(layer.id, node);
                    if (isActiveLayer) {
                      singleVideoRef.current = node;
                    }
                    node.dataset.sceneGainDb = layer.audioGainDb.toFixed(1);
                    node.dataset.flameVideoHealth = singleVideoHealthRef.current;
                    if (!node.dataset.sceneVolume) {
                      setSceneVideoVolume(node, 0);
                      node.dataset.sceneAudible = "false";
                      muteSceneVideo(node);
                    }
                    return;
                  }

                  singleVideoRefs.current.delete(layer.id);
                  if (singleActiveLayerIdRef.current === layer.id) {
                    singleVideoRef.current = null;
                  }
                }}
                className={`flame-video ${isActiveLayer ? "is-active" : "is-standby"}`}
                data-flame-layer={layerRole}
                data-flame-slot-index="0"
                data-flame-loop-slot={isActiveLayer ? "active" : "standby"}
                data-flame-loop-role={layerRole}
                data-flame-frame-ready={layer.frameReady ? "true" : "false"}
                data-flame-loop-phase={loopPhase}
                data-flame-audio-slot={layerAudioActive ? "active" : "standby"}
                data-flame-audio-role={layerAudioActive ? "active" : "muted"}
                data-flame-video-health={singleVideoHealth}
                data-scene-gain-db={layer.audioGainDb.toFixed(1)}
                src={layer.src}
                autoPlay={isActiveLayer || isPendingLayer}
                loop
                playsInline
                preload="auto"
                onLoadedMetadata={(event) => {
                  if (isActiveLayer) {
                    markSingleLoopVideoProgress(event.currentTarget);
                    syncSingleLoopVideo();
                  } else if (isPendingLayer) {
                    prepareSingleLoopLayer(layer.id, event.currentTarget, true);
                  }
                }}
                onLoadedData={(event) => {
                  if (isActiveLayer) {
                    markSingleLoopVideoProgress(event.currentTarget);
                  }
                  handleSingleLoopFrameReady(layer.id, event.currentTarget, isPendingLayer);
                }}
                onCanPlay={(event) => handleSingleLoopFrameReady(layer.id, event.currentTarget, isPendingLayer)}
                onPlaying={(event) => {
                  if (isActiveLayer) {
                    markSingleLoopVideoProgress(event.currentTarget);
                  }
                }}
                onTimeUpdate={(event) => {
                  if (isActiveLayer) {
                    markSingleLoopVideoProgress(event.currentTarget);
                  }
                }}
                onStalled={() => {
                  if (isActiveLayer && singleVideoHealthRef.current !== "fallback") {
                    patchSingleLoopVideoHealth("recovering");
                  }
                }}
                onWaiting={() => {
                  if (isActiveLayer && singleVideoHealthRef.current !== "fallback") {
                    patchSingleLoopVideoHealth("recovering");
                  }
                }}
                onError={(event) => {
                  if (!isActiveLayer) {
                    dropPendingSingleLoopLayer(layer.id);
                    return;
                  }
                  if (singleVideoHealthRef.current !== "fallback") {
                    const watchdog = singleLoopWatchdogRef.current;
                    watchdog.stallCount += 1;
                    watchdog.lastStallAtMs = window.performance.now();
                    patchSingleLoopVideoHealth("stalled");
                    if (watchdog.stallCount >= SINGLE_LOOP_STALL_FALLBACK_LIMIT) {
                      fallBackSingleLoopVideo(event.currentTarget);
                    } else {
                      recoverSingleLoopVideo(event.currentTarget, watchdog.stallCount);
                    }
                  }
                }}
              />
            </div>
          );
        }) : null}
        <span className="flame-video-fade" />
      </div>
    );
  }

  return (
    <div
      className={`flame-scene ${lowPower ? "is-low-power" : ""} ${sceneTransitioning ? "is-transitioning is-scene-transitioning" : ""}`}
      aria-hidden="true"
      data-flame-transition={sceneTransitioning ? "scene" : "none"}
      data-flame-transition-phase={sceneTransitionPhase}
    >
      <SceneLogoBackdrop />
      {layers.filter((layer) => Boolean(layer.src)).map((layer) => {
        const visibleSlot = getLayerSlot(loopVisibleSlots, layer.id);
        const audibleSlot = getLayerSlot(loopAudibleSlots, layer.id);
        const isSceneLayerActive = layer.id === activeLayerId;
        const layerHandoff = loopHandoff?.layerId === layer.id ? loopHandoff : null;
        const isLoopHandoff = Boolean(layerHandoff);

        return (
          <div
            key={layer.id}
            className={`flame-video-layer ${isSceneLayerActive ? "is-active" : "is-exiting"} ${isLoopHandoff ? "is-loop-handoff" : ""}`}
            data-flame-layer={isSceneLayerActive ? "active" : "standby"}
            data-flame-loop-handoff={isLoopHandoff ? "active" : "none"}
          >
            {LOOP_SLOTS.map((slot) => {
              const key = slotKey(layer.id, slot);
              const isVisibleSlot = slot === visibleSlot;
              const isAudibleSlot = isSceneLayerActive && slot === audibleSlot;
              const slotStatus = getLoopSlotStatus(loopSlotStatuses, key);
              const loopRole = getVideoRole(layer.id, slot, visibleSlot, layerHandoff);
              const loopPhase = loopRole === "incoming" && layerHandoff && !layerHandoff.revealing
                ? "ready"
                : getVideoPhase(loopRole, slotStatus);
              const audioRole = getAudioRole(isAudibleSlot, loopRole, layerHandoff, audioEnabled && !audioSuspended, videoVolume);

              return (
                <video
                  key={slot}
                  ref={(node) => {
                    if (node) {
                      node.dataset.sceneGainDb = layer.audioGainDb.toFixed(1);
                      if (!node.dataset.sceneVolume) {
                        setSceneVideoVolume(node, 0);
                        node.dataset.sceneAudible = "false";
                        muteSceneVideo(node);
                      }
                      videoRefs.current.set(key, node);
                    } else {
                      videoRefs.current.delete(key);
                    }
                  }}
                  className={`flame-video ${isVisibleSlot ? "is-active" : "is-standby"}`}
                  data-flame-layer={isSceneLayerActive ? "active" : "standby"}
                  data-flame-slot-index={slot}
                  data-flame-loop-slot={isVisibleSlot ? "active" : "standby"}
                  data-flame-loop-role={loopRole}
                  data-flame-frame-ready={slotStatus.frameReady ? "true" : "false"}
                  data-flame-loop-phase={loopPhase}
                  data-flame-audio-slot={isAudibleSlot ? "active" : "standby"}
                  data-flame-audio-role={audioRole}
                  data-scene-gain-db={layer.audioGainDb.toFixed(1)}
                  src={layer.src}
                  autoPlay={isVisibleSlot}
                  playsInline
                  preload="auto"
                  onLoadedMetadata={(event) => {
                    if (slot === getLayerSlot(loopVisibleSlotsRef.current, layer.id)) {
                      prepareVideoSlot(layer.id, slot, {
                        activatePending: true,
                        forceSync: pendingLayerIdRef.current === layer.id
                      });
                      scheduleLoopMonitor();
                    } else if (getLoopSlotStatus(loopSlotStatusesRef.current, key).phase !== "preparing") {
                      parkSlotVideo(layer.id, slot, event.currentTarget);
                    }
                  }}
                  onLoadedData={() => {
                    if (slot === getLayerSlot(loopVisibleSlotsRef.current, layer.id)) {
                      patchLoopSlotStatus(key, { frameReady: true, phase: "active" });
                    }
                  }}
                  onSeeked={() => {
                    if (slot === getLayerSlot(loopVisibleSlotsRef.current, layer.id)) {
                      checkLoopHandoff(layer.id, slot);
                    }
                  }}
                  onTimeUpdate={() => {
                    if (slot === getLayerSlot(loopVisibleSlotsRef.current, layer.id)) {
                      checkLoopHandoff(layer.id, slot);
                    }
                  }}
                  onEnded={() => checkLoopHandoff(layer.id, slot)}
                />
              );
            })}
          </div>
        );
      })}
      <span className="flame-video-fade" />
    </div>
  );
}

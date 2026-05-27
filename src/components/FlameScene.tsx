import { useEffect, useRef, useState } from "react";
import type { PlaybackState } from "../types";

const FIREPLACE_BACKGROUND_SRC = "/assets/fireplace-bg-2560x720.png";
const DEFAULT_FLAME_VIDEO_SRC = "";
const VIDEO_FADE_MS = 900;
const VIDEO_SYNC_TOLERANCE_SECONDS = 2;
const VIDEO_SEEK_SETTLE_MS = 650;
const VIDEO_METADATA_SETTLE_MS = 1200;
const VIDEO_FRAME_READY_SETTLE_MS = 900;
const LOOP_PREPARE_LEAD_SECONDS = 1.2;
const LOOP_REVEAL_LEAD_SECONDS = 0.42;
const LOOP_CROSSFADE_MS = 360;
const LOOP_AUDIO_CROSSFADE_MS = 340;
const MIN_DUAL_LOOP_DURATION_SECONDS = 1.5;
const LOOP_SLOTS = [0, 1] as const;

interface FlameScenePlayback {
  elapsedSeconds: number | null;
  state: PlaybackState;
}

interface FlameSceneProps {
  lowPower?: boolean;
  playback: FlameScenePlayback;
  videoEnabled?: boolean;
  audioEnabled?: boolean;
  volumePercent?: number;
  videoSrc?: string;
}

interface VideoLayer {
  id: number;
  src: string;
}

type LoopSlot = typeof LOOP_SLOTS[number];
type LoopSlotMap = Record<number, LoopSlot>;
type LoopMonitorHandle =
  | { video: HTMLVideoElement; type: "video-frame"; id: number }
  | { type: "animation-frame" | "timer"; id: number };
type LoopSlotPhase = "active" | "preparing" | "ready" | "handoff" | "parked";
type LoopSlotRole = "active" | "incoming" | "outgoing" | "parked";
type LoopAudioRole = "active" | "crossfade-in" | "crossfade-out" | "muted";

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

type VideoFrameElement = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: (now: number) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

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

function setSceneVideoVolume(video: HTMLVideoElement, volume: number) {
  const safeVolume = clampVideoVolume(volume);
  video.volume = safeVolume;
  video.dataset.sceneVolume = safeVolume.toFixed(3);
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

    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      if (frameCallbackId !== null) {
        frameVideo.cancelVideoFrameCallback?.(frameCallbackId);
      }
      resolve(ready);
    };

    const timeout = window.setTimeout(() => finish(false), timeoutMs);

    if (video.readyState >= 2) {
      window.requestAnimationFrame(() => finish(true));
      return;
    }

    if (frameVideo.requestVideoFrameCallback) {
      frameCallbackId = frameVideo.requestVideoFrameCallback(() => finish(video.readyState >= 2));
      return;
    }

    window.requestAnimationFrame(() => finish(video.readyState >= 2));
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
    video.muted = true;
  }
  await video.play().then(() => {
    if (shouldRestoreAudible && video.dataset.sceneAudible === "true") {
      video.muted = false;
    }
  }).catch(() => {
    // Inline scene video can still be blocked briefly while a new layer mounts.
  });

  return true;
}

export function FlameScene({ lowPower = false, playback, videoEnabled = true, audioEnabled = false, volumePercent = 100, videoSrc = DEFAULT_FLAME_VIDEO_SRC }: FlameSceneProps) {
  const nextLayerIdRef = useRef(0);
  const activeVideoSrcRef = useRef(videoSrc);
  const activeLayerIdRef = useRef(0);
  const pendingLayerIdRef = useRef<number | null>(null);
  const playbackRef = useRef(playback);
  const videoEnabledRef = useRef(videoEnabled);
  const audioEnabledRef = useRef(audioEnabled);
  const videoVolumeRef = useRef(normalizeVideoVolume(volumePercent));
  const preparingVideoKeysRef = useRef(new Set<string>());
  const transitionCleanupTimerRef = useRef<number | null>(null);
  const loopHandoffTimerRef = useRef<number | null>(null);
  const loopAudioCrossfadeFrameRef = useRef<number | null>(null);
  const loopMonitorRef = useRef<LoopMonitorHandle | null>(null);
  const loopHandoffInProgressRef = useRef(false);
  const loopPrepareTokensRef = useRef(new Map<string, number>());
  const videoRefs = useRef(new Map<string, HTMLVideoElement>());
  const loopVisibleSlotsRef = useRef<LoopSlotMap>({ 0: 0 });
  const loopAudibleSlotsRef = useRef<LoopSlotMap>({ 0: 0 });
  const loopSlotStatusesRef = useRef<Record<string, LoopSlotStatus>>({});
  const [activeLayerId, setActiveLayerId] = useState(0);
  const [layers, setLayers] = useState<VideoLayer[]>([{ id: 0, src: videoSrc }]);
  const [sceneTransitioning, setSceneTransitioning] = useState(false);
  const [loopHandoff, setLoopHandoff] = useState<LoopHandoffState | null>(null);
  const [loopVisibleSlots, setLoopVisibleSlots] = useState<LoopSlotMap>({ 0: 0 });
  const [loopAudibleSlots, setLoopAudibleSlots] = useState<LoopSlotMap>({ 0: 0 });
  const [loopSlotStatuses, setLoopSlotStatuses] = useState<Record<string, LoopSlotStatus>>({});
  const videoVolume = normalizeVideoVolume(volumePercent);

  function clearTransitionCleanupTimer() {
    if (transitionCleanupTimerRef.current !== null) {
      window.clearTimeout(transitionCleanupTimerRef.current);
      transitionCleanupTimerRef.current = null;
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

  function applySceneAudioVolume(video: HTMLVideoElement) {
    const keepsAudioPath = video.dataset.sceneAudible === "true";
    const nextVolume = keepsAudioPath ? videoVolumeRef.current : 0;
    setSceneVideoVolume(video, nextVolume);
    video.muted = !keepsAudioPath;
  }

  function resetStandbyVideo(video: HTMLVideoElement) {
    video.dataset.sceneAudible = "false";
    setSceneVideoVolume(video, 0);
    video.muted = true;
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
    pendingLayerIdRef.current = null;
    activeLayerIdRef.current = layerId;
    clearTransitionCleanupTimer();
    setSceneTransitioning(true);
    setActiveLayerId(layerId);
    transitionCleanupTimerRef.current = window.setTimeout(() => {
      setLayers((current) => current.filter((layer) => layer.id === layerId));
      setSceneTransitioning(false);
      pruneLoopSlots(layerId);
      transitionCleanupTimerRef.current = null;
    }, VIDEO_FADE_MS);
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
      .then((ready) => {
        if (ready && videoRefs.current.get(key) === video) {
          patchLoopSlotStatus(key, { frameReady: video.readyState >= 2, phase: slot === getLayerSlot(loopVisibleSlotsRef.current, layerId) ? "active" : "parked" });
        }
        if (ready && options.activatePending && pendingLayerIdRef.current === layerId) {
          activatePreparedLayer(layerId);
        }
      })
      .finally(() => {
        preparingVideoKeysRef.current.delete(key);
      });
  }

  function syncSceneAudio(audibleSlots = loopAudibleSlotsRef.current) {
    const targetVolume = audioEnabledRef.current ? videoVolumeRef.current : 0;
    videoRefs.current.forEach((video, key) => {
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
      applySceneAudioVolume(video);

      if (!isActiveLayer) {
        video.muted = true;
        return;
      }

      if (shouldBeAudible) {
        if (video.paused) {
          video.muted = true;
          void video.play().then(() => {
            if (video.dataset.sceneAudible === "true") {
              applySceneAudioVolume(video);
              video.muted = false;
            }
          }).catch(() => {
            video.muted = true;
          });
        } else {
          video.muted = false;
        }
        return;
      }

      video.muted = true;
    });
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
    standbyVideo.muted = true;

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
        activeVideo.muted = false;
        standbyVideo.muted = false;
        setSceneVideoVolume(standbyVideo, 0);

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
          activeVideo.muted = false;
          standbyVideo.muted = false;

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
    if (!videoEnabled || loopHandoffInProgressRef.current) return;
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
    if (!videoEnabled || !videoSrc || loopHandoffInProgressRef.current) return;

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
    videoVolumeRef.current = videoVolume;
  }, [audioEnabled, videoEnabled, videoVolume]);

  useEffect(() => {
    activeLayerIdRef.current = activeLayerId;
  }, [activeLayerId]);

  useEffect(() => () => {
    clearTransitionCleanupTimer();
    clearLoopHandoffTimer();
    clearLoopAudioCrossfadeFrame();
    clearLoopMonitor();
  }, []);

  useEffect(() => {
    if (!videoEnabled) return undefined;
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
      setLayers([{ id: activeLayerIdRef.current, src: "" }]);
      return undefined;
    }

    const nextLayer = {
      id: nextLayerIdRef.current + 1,
      src: videoSrc
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
  }, [layers, videoEnabled, videoSrc]);

  useEffect(() => {
    if (videoEnabled) return undefined;
    clearLoopMonitor();
    clearLoopHandoffTimer();
    clearLoopAudioCrossfadeFrame();
    loopHandoffInProgressRef.current = false;
    setLoopHandoff(null);
    videoRefs.current.forEach((video) => {
      video.dataset.sceneAudible = "false";
      setSceneVideoVolume(video, 0);
      video.muted = true;
    });
    return undefined;
  }, [videoEnabled]);

  useEffect(() => {
    if (!videoEnabled) return;
    layers.forEach((layer) => {
      const isPendingLayer = pendingLayerIdRef.current === layer.id;
      const visibleSlot = getLayerSlot(loopVisibleSlotsRef.current, layer.id);
      prepareVideoSlot(layer.id, visibleSlot, {
        activatePending: isPendingLayer,
        forceSync: isPendingLayer
      });
    });
  }, [layers, playback.state, videoEnabled]);

  useEffect(() => {
    if (!videoEnabled) return;
    clearLoopAudioCrossfadeFrame();
    syncSceneAudio();
  }, [activeLayerId, audioEnabled, layers, loopAudibleSlots, videoEnabled, videoVolume]);

  useEffect(() => {
    scheduleLoopMonitor();
    return clearLoopMonitor;
  }, [activeLayerId, layers, loopVisibleSlots, videoEnabled, videoSrc]);

  if (!videoEnabled || !videoSrc) {
    return <div className="flame-scene is-video-off" aria-hidden="true" />;
  }

  return (
    <div
      className={`flame-scene ${lowPower ? "is-low-power" : ""} ${sceneTransitioning ? "is-transitioning is-scene-transitioning" : ""}`}
      aria-hidden="true"
      data-flame-transition={sceneTransitioning ? "scene" : "none"}
    >
      <img className="fireplace-backdrop" src={FIREPLACE_BACKGROUND_SRC} alt="" draggable={false} />
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
              const audioRole = getAudioRole(isAudibleSlot, loopRole, layerHandoff, audioEnabled, videoVolume);

              return (
                <video
                  key={slot}
                  ref={(node) => {
                    if (node) {
                      if (!node.dataset.sceneVolume) {
                        setSceneVideoVolume(node, 0);
                        node.dataset.sceneAudible = "false";
                        node.muted = true;
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
                  src={layer.src}
                  poster={FIREPLACE_BACKGROUND_SRC}
                  autoPlay={isVisibleSlot}
                  muted
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

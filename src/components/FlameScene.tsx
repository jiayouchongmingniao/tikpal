import { useEffect, useRef, useState } from "react";
import type { PlaybackState } from "../types";

const FIREPLACE_BACKGROUND_SRC = "/assets/fireplace-bg-2560x720.png";
const DEFAULT_FLAME_VIDEO_SRC = "/assets/output_2560x720-4k.mp4";
const VIDEO_FADE_MS = 900;
const VIDEO_SYNC_TOLERANCE_SECONDS = 2;
const VIDEO_SEEK_SETTLE_MS = 650;
const VIDEO_METADATA_SETTLE_MS = 1200;
const LOOP_FADE_OUT_SECONDS = 1.1;
const LOOP_FADE_IN_SECONDS = 0.9;
const SCENE_SOUND_FADE_MS = 1200;

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

function waitForVideoEvent(video: HTMLVideoElement, eventName: "loadedmetadata" | "seeked", timeoutMs: number) {
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

function easeInOut(progress: number) {
  return progress < 0.5
    ? 2 * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 2) / 2;
}

function setSceneVideoVolume(video: HTMLVideoElement, volume: number) {
  const safeVolume = clampVideoVolume(volume);
  video.volume = safeVolume;
  video.dataset.sceneVolume = safeVolume.toFixed(3);
}

function getLoopAudioGain(video: HTMLVideoElement, isLoopDimming: boolean) {
  const duration = video.duration;
  if (!isLoopDimming || !Number.isFinite(duration) || duration <= LOOP_FADE_OUT_SECONDS + LOOP_FADE_IN_SECONDS + 0.5) {
    return 1;
  }

  const currentTime = video.currentTime;
  if (!Number.isFinite(currentTime)) return 1;
  if (currentTime >= duration - LOOP_FADE_OUT_SECONDS) {
    return easeInOut(Math.max(0, Math.min(1, (duration - currentTime) / LOOP_FADE_OUT_SECONDS)));
  }
  if (currentTime <= LOOP_FADE_IN_SECONDS) {
    return easeInOut(Math.max(0, Math.min(1, currentTime / LOOP_FADE_IN_SECONDS)));
  }
  return 1;
}

function shouldDimLoopBoundary(video: HTMLVideoElement, isAlreadyDimming: boolean) {
  const duration = video.duration;
  if (!Number.isFinite(duration) || duration <= LOOP_FADE_OUT_SECONDS + LOOP_FADE_IN_SECONDS + 0.5) {
    return false;
  }

  const currentTime = video.currentTime;
  if (!Number.isFinite(currentTime)) return false;
  return currentTime >= duration - LOOP_FADE_OUT_SECONDS
    || (isAlreadyDimming && currentTime <= LOOP_FADE_IN_SECONDS);
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
  const previousAudioEnabledRef = useRef(audioEnabled);
  const previousAudibleRef = useRef(videoEnabled && audioEnabled && normalizeVideoVolume(volumePercent) > 0);
  const previousAudioLayerIdRef = useRef(0);
  const preparingLayerIdsRef = useRef(new Set<number>());
  const transitionCleanupTimerRef = useRef<number | null>(null);
  const soundTransitionCleanupTimerRef = useRef<number | null>(null);
  const audioFadeFrameRef = useRef<number | null>(null);
  const loopAudioFrameRef = useRef<number | null>(null);
  const videoRefs = useRef(new Map<number, HTMLVideoElement>());
  const soundAudioGainRef = useRef(videoEnabled && audioEnabled && normalizeVideoVolume(volumePercent) > 0 ? 1 : 0);
  const loopAudioGainRef = useRef(1);
  const loopDimmingRef = useRef(false);
  const [activeLayerId, setActiveLayerId] = useState(0);
  const [layers, setLayers] = useState<VideoLayer[]>([{ id: 0, src: videoSrc }]);
  const [sceneTransitioning, setSceneTransitioning] = useState(false);
  const [soundTransitioning, setSoundTransitioning] = useState(false);
  const [loopDimming, setLoopDimming] = useState(false);
  const videoVolume = normalizeVideoVolume(volumePercent);

  function clearTransitionCleanupTimer() {
    if (transitionCleanupTimerRef.current !== null) {
      window.clearTimeout(transitionCleanupTimerRef.current);
      transitionCleanupTimerRef.current = null;
    }
  }

  function clearSoundTransitionCleanupTimer() {
    if (soundTransitionCleanupTimerRef.current !== null) {
      window.clearTimeout(soundTransitionCleanupTimerRef.current);
      soundTransitionCleanupTimerRef.current = null;
    }
  }

  function clearAudioFadeFrame() {
    if (audioFadeFrameRef.current !== null) {
      window.cancelAnimationFrame(audioFadeFrameRef.current);
      audioFadeFrameRef.current = null;
    }
  }

  function clearLoopAudioFrame() {
    if (loopAudioFrameRef.current !== null) {
      window.cancelAnimationFrame(loopAudioFrameRef.current);
      loopAudioFrameRef.current = null;
    }
  }

  function applySceneAudioVolume(video: HTMLVideoElement) {
    const keepsAudioPath = video.dataset.sceneAudible === "true" || video.dataset.sceneAudioFading === "true";
    const nextVolume = keepsAudioPath ? videoVolume * soundAudioGainRef.current * loopAudioGainRef.current : 0;
    setSceneVideoVolume(video, nextVolume);
    video.muted = !keepsAudioPath;
  }

  function startSoundTransition() {
    clearSoundTransitionCleanupTimer();
    setSoundTransitioning(true);
    soundTransitionCleanupTimerRef.current = window.setTimeout(() => {
      setSoundTransitioning(false);
      soundTransitionCleanupTimerRef.current = null;
    }, SCENE_SOUND_FADE_MS);
  }

  function activatePreparedLayer(layerId: number) {
    pendingLayerIdRef.current = null;
    activeLayerIdRef.current = layerId;
    setLoopDimmingState(false);
    clearTransitionCleanupTimer();
    setSceneTransitioning(true);
    setActiveLayerId(layerId);
    transitionCleanupTimerRef.current = window.setTimeout(() => {
      setLayers((current) => current.filter((layer) => layer.id === layerId));
      setSceneTransitioning(false);
      transitionCleanupTimerRef.current = null;
    }, VIDEO_FADE_MS);
  }

  function prepareVideoLayer(layerId: number, options: { forceSync?: boolean; activatePending?: boolean } = {}) {
    const video = videoRefs.current.get(layerId);
    if (!video || preparingLayerIdsRef.current.has(layerId)) return;

    preparingLayerIdsRef.current.add(layerId);
    void alignVideoWithPlayback(video, playbackRef.current, Boolean(options.forceSync))
      .then((ready) => {
        if (ready && options.activatePending && pendingLayerIdRef.current === layerId) {
          activatePreparedLayer(layerId);
        }
      })
      .finally(() => {
        preparingLayerIdsRef.current.delete(layerId);
      });
  }

  function setLoopDimmingState(nextDimming: boolean) {
    if (loopDimmingRef.current === nextDimming) return;
    loopDimmingRef.current = nextDimming;
    setLoopDimming(nextDimming);
  }

  function scheduleLoopAudioFrame(layerId: number, video: HTMLVideoElement) {
    if (loopAudioFrameRef.current !== null) return;
    loopAudioFrameRef.current = window.requestAnimationFrame(() => {
      loopAudioFrameRef.current = null;
      updateLoopDimmingForVideo(layerId, video);
    });
  }

  function updateLoopDimmingForVideo(layerId: number, video: HTMLVideoElement) {
    if (layerId !== activeLayerIdRef.current || !videoEnabled) return;
    const nextDimming = shouldDimLoopBoundary(video, loopDimmingRef.current);
    setLoopDimmingState(nextDimming);
    loopAudioGainRef.current = getLoopAudioGain(video, nextDimming);
    applySceneAudioVolume(video);

    if (nextDimming) {
      scheduleLoopAudioFrame(layerId, video);
    } else {
      clearLoopAudioFrame();
    }
  }

  function animateSceneAudio(video: HTMLVideoElement, targetGain: number, muteWhenDone: boolean) {
    clearAudioFadeFrame();

    const safeTargetGain = clampVideoVolume(targetGain);
    const startGain = video.muted && !video.dataset.sceneAudioFading ? 0 : clampVideoVolume(soundAudioGainRef.current);
    const startedAt = window.performance.now();
    video.dataset.sceneAudioFading = "true";
    if (safeTargetGain > 0) {
      video.dataset.sceneAudible = "true";
      soundAudioGainRef.current = startGain;
      applySceneAudioVolume(video);
      if (video.paused) {
        video.muted = true;
        void video.play().then(() => {
          if (video.dataset.sceneAudible === "true") {
            video.muted = false;
          }
        }).catch(() => {
          video.muted = true;
        });
      } else {
        video.muted = false;
      }
    } else if (startGain <= 0) {
      soundAudioGainRef.current = 0;
      delete video.dataset.sceneAudioFading;
      applySceneAudioVolume(video);
      video.muted = true;
      return;
    } else {
      soundAudioGainRef.current = startGain;
      applySceneAudioVolume(video);
      video.muted = false;
    }

    const step = (now: number) => {
      const progress = Math.min(1, Math.max(0, (now - startedAt) / SCENE_SOUND_FADE_MS));
      const easedProgress = easeInOut(progress);
      soundAudioGainRef.current = startGain + ((safeTargetGain - startGain) * easedProgress);
      applySceneAudioVolume(video);

      if (safeTargetGain > 0 && video.dataset.sceneAudible === "true") {
        video.muted = false;
      }

      if (progress < 1) {
        audioFadeFrameRef.current = window.requestAnimationFrame(step);
        return;
      }

      audioFadeFrameRef.current = null;
      soundAudioGainRef.current = safeTargetGain;
      delete video.dataset.sceneAudioFading;
      applySceneAudioVolume(video);
      if (muteWhenDone || safeTargetGain <= 0 || video.dataset.sceneAudible !== "true") {
        soundAudioGainRef.current = 0;
        applySceneAudioVolume(video);
        video.muted = true;
      } else {
        video.muted = false;
      }
    };

    audioFadeFrameRef.current = window.requestAnimationFrame(step);
  }

  function syncSceneAudio(animate: boolean) {
    const targetVolume = audioEnabled ? videoVolume : 0;
    videoRefs.current.forEach((video, layerId) => {
      const isActiveLayer = layerId === activeLayerIdRef.current;
      const shouldBeAudible = videoEnabled && audioEnabled && targetVolume > 0 && isActiveLayer;
      video.dataset.sceneAudible = shouldBeAudible ? "true" : "false";

      if (!isActiveLayer) {
        delete video.dataset.sceneAudioFading;
        applySceneAudioVolume(video);
        video.muted = true;
        return;
      }

      if (shouldBeAudible) {
        if (animate) {
          animateSceneAudio(video, 1, false);
        } else {
          soundAudioGainRef.current = 1;
          delete video.dataset.sceneAudioFading;
          updateLoopDimmingForVideo(layerId, video);
          if (video.paused) {
            video.muted = true;
            void video.play().then(() => {
              if (video.dataset.sceneAudible === "true") {
                video.muted = false;
              }
            }).catch(() => {
              video.muted = true;
            });
          } else {
            video.muted = false;
          }
        }
        return;
      }

      if (animate) {
        animateSceneAudio(video, 0, true);
      } else {
        soundAudioGainRef.current = 0;
        delete video.dataset.sceneAudioFading;
        applySceneAudioVolume(video);
        video.muted = true;
      }
    });
  }

  useEffect(() => {
    playbackRef.current = playback;
  }, [playback.elapsedSeconds, playback.state]);

  useEffect(() => {
    activeLayerIdRef.current = activeLayerId;
  }, [activeLayerId]);

  useEffect(() => () => {
    clearTransitionCleanupTimer();
    clearSoundTransitionCleanupTimer();
    clearAudioFadeFrame();
    clearLoopAudioFrame();
  }, []);

  useEffect(() => {
    if (!videoEnabled) return undefined;
    if (activeVideoSrcRef.current === videoSrc) return undefined;
    activeVideoSrcRef.current = videoSrc;
    setLoopDimmingState(false);

    const nextLayer = {
      id: nextLayerIdRef.current + 1,
      src: videoSrc
    };
    nextLayerIdRef.current = nextLayer.id;
    pendingLayerIdRef.current = nextLayer.id;
    setLayers((current) => {
      const activeLayer = current.find((layer) => layer.id === activeLayerIdRef.current) ?? current[current.length - 1];
      return activeLayer ? [activeLayer, nextLayer] : [nextLayer];
    });
    return undefined;
  }, [videoEnabled, videoSrc]);

  useEffect(() => {
    if (videoEnabled) return undefined;
    setLoopDimmingState(false);
    setSoundTransitioning(false);
    clearAudioFadeFrame();
    clearLoopAudioFrame();
    soundAudioGainRef.current = 0;
    loopAudioGainRef.current = 1;
    previousAudioEnabledRef.current = audioEnabled;
    previousAudibleRef.current = false;
    previousAudioLayerIdRef.current = activeLayerId;
    videoRefs.current.forEach((video) => {
      video.dataset.sceneAudible = "false";
      delete video.dataset.sceneAudioFading;
      setSceneVideoVolume(video, 0);
      video.muted = true;
    });
    return undefined;
  }, [videoEnabled]);

  useEffect(() => {
    if (!videoEnabled) return;
    videoRefs.current.forEach((_video, layerId) => {
      const isPendingLayer = pendingLayerIdRef.current === layerId;
      prepareVideoLayer(layerId, {
        activatePending: isPendingLayer,
        forceSync: isPendingLayer
      });
    });
  }, [layers, playback.state, videoEnabled]);

  useEffect(() => {
    if (!videoEnabled) return;
    const nextAudible = audioEnabled && videoVolume > 0;
    const audioEnabledChanged = previousAudioEnabledRef.current !== audioEnabled;
    const audibleChanged = previousAudibleRef.current !== nextAudible;
    const audioLayerChanged = previousAudioLayerIdRef.current !== activeLayerId;
    const shouldAnimateAudio = audioEnabledChanged || audibleChanged || (nextAudible && audioLayerChanged);

    if (audioEnabledChanged) {
      startSoundTransition();
    }

    syncSceneAudio(shouldAnimateAudio);
    previousAudioEnabledRef.current = audioEnabled;
    previousAudibleRef.current = nextAudible;
    previousAudioLayerIdRef.current = activeLayerId;
  }, [activeLayerId, audioEnabled, layers, videoEnabled, videoVolume]);

  if (!videoEnabled) {
    return <div className="flame-scene is-video-off" aria-hidden="true" />;
  }

  return (
    <div
      className={`flame-scene ${lowPower ? "is-low-power" : ""} ${sceneTransitioning ? "is-transitioning is-scene-transitioning" : ""} ${soundTransitioning ? "is-sound-transitioning" : ""} ${loopDimming ? "is-loop-dimming" : ""}`}
      aria-hidden="true"
      data-flame-transition={sceneTransitioning ? "scene" : "none"}
      data-flame-sound-transition={soundTransitioning ? "dimming" : "none"}
      data-flame-loop-transition={loopDimming ? "dimming" : "none"}
    >
      <img className="fireplace-backdrop" src={FIREPLACE_BACKGROUND_SRC} alt="" draggable={false} />
      {layers.map((layer) => (
        <video
          key={layer.id}
          ref={(node) => {
            if (node) {
              if (!node.dataset.sceneVolume) {
                setSceneVideoVolume(node, 0);
                node.dataset.sceneAudible = "false";
                node.muted = true;
              }
              videoRefs.current.set(layer.id, node);
            } else {
              videoRefs.current.delete(layer.id);
            }
          }}
          className={`flame-video ${layer.id === activeLayerId ? "is-active" : "is-exiting"}`}
          data-flame-layer={layer.id === activeLayerId ? "active" : "standby"}
          src={layer.src}
          poster={FIREPLACE_BACKGROUND_SRC}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          onLoadedMetadata={() => prepareVideoLayer(layer.id, {
            activatePending: true,
            forceSync: pendingLayerIdRef.current === layer.id
          })}
          onSeeked={(event) => updateLoopDimmingForVideo(layer.id, event.currentTarget)}
          onTimeUpdate={(event) => updateLoopDimmingForVideo(layer.id, event.currentTarget)}
        />
      ))}
      <span className="flame-video-fade" />
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import type { PlaybackState } from "../types";

const FIREPLACE_BACKGROUND_SRC = "/assets/fireplace-bg-2560x720.png";
const DEFAULT_FLAME_VIDEO_SRC = "/assets/output_2560x720-4k.mp4";
const VIDEO_FADE_MS = 900;
const VIDEO_SYNC_TOLERANCE_SECONDS = 2;
const VIDEO_SEEK_SETTLE_MS = 650;
const VIDEO_METADATA_SETTLE_MS = 1200;

interface FlameScenePlayback {
  elapsedSeconds: number | null;
  state: PlaybackState;
}

interface FlameSceneProps {
  lowPower?: boolean;
  playback: FlameScenePlayback;
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

async function alignVideoWithPlayback(video: HTMLVideoElement, playback: FlameScenePlayback, forceSync: boolean) {
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

  if (playback.state === "playing") {
    await video.play().catch(() => {
      // Muted inline video can still be blocked briefly while a new layer mounts.
    });
  } else {
    video.pause();
  }

  return true;
}

export function FlameScene({ lowPower = false, playback, videoSrc = DEFAULT_FLAME_VIDEO_SRC }: FlameSceneProps) {
  const nextLayerIdRef = useRef(0);
  const activeVideoSrcRef = useRef(videoSrc);
  const activeLayerIdRef = useRef(0);
  const pendingLayerIdRef = useRef<number | null>(null);
  const playbackRef = useRef(playback);
  const preparingLayerIdsRef = useRef(new Set<number>());
  const transitionCleanupTimerRef = useRef<number | null>(null);
  const videoRefs = useRef(new Map<number, HTMLVideoElement>());
  const [activeLayerId, setActiveLayerId] = useState(0);
  const [layers, setLayers] = useState<VideoLayer[]>([{ id: 0, src: videoSrc }]);
  const [transitioning, setTransitioning] = useState(false);

  function clearTransitionCleanupTimer() {
    if (transitionCleanupTimerRef.current !== null) {
      window.clearTimeout(transitionCleanupTimerRef.current);
      transitionCleanupTimerRef.current = null;
    }
  }

  function activatePreparedLayer(layerId: number) {
    pendingLayerIdRef.current = null;
    activeLayerIdRef.current = layerId;
    clearTransitionCleanupTimer();
    setTransitioning(true);
    setActiveLayerId(layerId);
    transitionCleanupTimerRef.current = window.setTimeout(() => {
      setLayers((current) => current.filter((layer) => layer.id === layerId));
      setTransitioning(false);
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

  useEffect(() => {
    playbackRef.current = playback;
  }, [playback.elapsedSeconds, playback.state]);

  useEffect(() => {
    activeLayerIdRef.current = activeLayerId;
  }, [activeLayerId]);

  useEffect(() => () => {
    clearTransitionCleanupTimer();
  }, []);

  useEffect(() => {
    if (activeVideoSrcRef.current === videoSrc) return undefined;
    activeVideoSrcRef.current = videoSrc;

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
  }, [videoSrc]);

  useEffect(() => {
    videoRefs.current.forEach((_video, layerId) => {
      prepareVideoLayer(layerId);
    });
  }, [layers, playback.elapsedSeconds, playback.state]);

  return (
    <div className={`flame-scene ${lowPower ? "is-low-power" : ""} ${transitioning ? "is-transitioning" : ""}`} aria-hidden="true">
      <img className="fireplace-backdrop" src={FIREPLACE_BACKGROUND_SRC} alt="" draggable={false} />
      {layers.map((layer) => (
        <video
          key={layer.id}
          ref={(node) => {
            if (node) {
              videoRefs.current.set(layer.id, node);
              prepareVideoLayer(layer.id, {
                activatePending: true,
                forceSync: pendingLayerIdRef.current === layer.id
              });
            } else {
              videoRefs.current.delete(layer.id);
            }
          }}
          className={`flame-video ${layer.id === activeLayerId ? "is-active" : "is-exiting"}`}
          src={layer.src}
          poster={FIREPLACE_BACKGROUND_SRC}
          autoPlay={playback.state === "playing"}
          loop
          muted
          playsInline
          preload="auto"
          onLoadedMetadata={() => prepareVideoLayer(layer.id, {
            activatePending: true,
            forceSync: pendingLayerIdRef.current === layer.id
          })}
        />
      ))}
      <span className="flame-video-fade" />
    </div>
  );
}

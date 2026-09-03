import { useEffect, useRef, useState } from "react";

const SAMPLE_WINDOW_MS = 10_000;
const INITIAL_RECOVERY_MS = 60_000;
const RETRY_RECOVERY_MS = 5 * 60_000;
const MAX_STABLE_FRAME_MS = 42;
const MAX_UNSTABLE_FRAME_MS = 45;
const MAX_DROPPED_FRAME_RATIO = 0.04;

export interface SceneRenderDiagnostics {
  mode: "video" | "static";
  rafP95Ms: number | null;
  longTaskCount: number;
  droppedFrameRatio: number | null;
  retryAt: number | null;
}

interface UseSceneRenderBudgetOptions {
  constrained: boolean;
  enabled: boolean;
}

function percentile(values: number[], fraction: number) {
  if (values.length === 0) return null;
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * fraction) - 1));
  return [...values].sort((left, right) => left - right)[index] ?? null;
}

export function useSceneRenderBudget({ constrained, enabled }: UseSceneRenderBudgetOptions) {
  const [staticOnly, setStaticOnly] = useState(false);
  const diagnosticsRef = useRef<SceneRenderDiagnostics>({
    mode: "video",
    rafP95Ms: null,
    longTaskCount: 0,
    droppedFrameRatio: null,
    retryAt: null
  });
  const retryCountRef = useRef(0);
  const staticSinceRef = useRef<number | null>(null);

  useEffect(() => {
    if (constrained && enabled) return;
    retryCountRef.current = 0;
    staticSinceRef.current = null;
    diagnosticsRef.current = {
      mode: "video",
      rafP95Ms: null,
      longTaskCount: 0,
      droppedFrameRatio: null,
      retryAt: null
    };
    setStaticOnly(false);
  }, [constrained, enabled]);

  useEffect(() => {
    if (!constrained || !enabled) return undefined;

    const frames: Array<{ at: number; delta: number }> = [];
    const longTasks: number[] = [];
    const videoSamples: Array<{ at: number; total: number; dropped: number }> = [];
    let animationFrame = 0;
    let lastFrameAt = performance.now();
    let observer: PerformanceObserver | null = null;

    const publish = () => {
      const current = diagnosticsRef.current;
      const target = window as Window & { __tikpalRenderingDiagnostics?: () => SceneRenderDiagnostics };
      target.__tikpalRenderingDiagnostics = () => ({ ...current });
    };

    const trim = (now: number) => {
      while (frames.length > 0 && frames[0].at < now - SAMPLE_WINDOW_MS) frames.shift();
      while (longTasks.length > 0 && longTasks[0] < now - SAMPLE_WINDOW_MS) longTasks.shift();
      while (videoSamples.length > 0 && videoSamples[0].at < now - SAMPLE_WINDOW_MS) videoSamples.shift();
    };

    const tick = (now: number) => {
      frames.push({ at: now, delta: now - lastFrameAt });
      lastFrameAt = now;
      trim(now);
      animationFrame = window.requestAnimationFrame(tick);
    };
    animationFrame = window.requestAnimationFrame(tick);

    try {
      observer = new PerformanceObserver((entries) => {
        const now = performance.now();
        for (const entry of entries.getEntries()) {
          if (entry.duration >= 50) longTasks.push(now);
        }
        trim(now);
      });
      observer.observe({ type: "longtask", buffered: true });
    } catch {
      observer = null;
    }

    const interval = window.setInterval(() => {
      const now = performance.now();
      trim(now);
      const rafP95Ms = percentile(frames.map((sample) => sample.delta), 0.95);
      const video = document.querySelector("video.flame-video.is-active") as HTMLVideoElement | null;
      let droppedFrameRatio: number | null = null;
      if (video?.getVideoPlaybackQuality) {
        const quality = video.getVideoPlaybackQuality();
        videoSamples.push({
          at: now,
          total: quality.totalVideoFrames,
          dropped: quality.droppedVideoFrames
        });
        trim(now);
        const oldestSample = videoSamples[0];
        const latestSample = videoSamples[videoSamples.length - 1];
        if (oldestSample && latestSample && latestSample.at - oldestSample.at >= SAMPLE_WINDOW_MS - 250) {
          const decoded = Math.max(0, latestSample.total - oldestSample.total);
          const dropped = Math.max(0, latestSample.dropped - oldestSample.dropped);
          if (decoded > 0) droppedFrameRatio = dropped / decoded;
        }
      }

      const currentStatic = staticSinceRef.current !== null;
      const sampledForTenSeconds = frames.length > 0
        && now - frames[0].at >= SAMPLE_WINDOW_MS - 250;
      const unstable = (rafP95Ms !== null && rafP95Ms > MAX_UNSTABLE_FRAME_MS)
        || (droppedFrameRatio !== null && droppedFrameRatio >= MAX_DROPPED_FRAME_RATIO);
      const stable = rafP95Ms !== null && rafP95Ms <= MAX_STABLE_FRAME_MS;

      if (!currentStatic && sampledForTenSeconds && unstable) {
        staticSinceRef.current = Date.now();
        const retryDelay = retryCountRef.current > 0 ? RETRY_RECOVERY_MS : INITIAL_RECOVERY_MS;
        diagnosticsRef.current = {
          mode: "static",
          rafP95Ms,
          longTaskCount: longTasks.length,
          droppedFrameRatio,
          retryAt: Date.now() + retryDelay
        };
        setStaticOnly(true);
      } else if (currentStatic) {
        const retryAt = diagnosticsRef.current.retryAt;
        if (retryAt !== null && Date.now() >= retryAt && stable) {
          retryCountRef.current += 1;
          staticSinceRef.current = null;
          diagnosticsRef.current = {
            mode: "video",
            rafP95Ms,
            longTaskCount: longTasks.length,
            droppedFrameRatio: null,
            retryAt: null
          };
          videoSamples.length = 0;
          setStaticOnly(false);
        } else {
          diagnosticsRef.current = {
            ...diagnosticsRef.current,
            rafP95Ms,
            longTaskCount: longTasks.length,
            droppedFrameRatio
          };
        }
      } else {
        diagnosticsRef.current = {
          mode: "video",
          rafP95Ms,
          longTaskCount: longTasks.length,
          droppedFrameRatio,
          retryAt: null
        };
      }
      publish();
    }, 1000);

    publish();
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.clearInterval(interval);
      observer?.disconnect();
      const target = window as Window & { __tikpalRenderingDiagnostics?: () => SceneRenderDiagnostics };
      delete target.__tikpalRenderingDiagnostics;
    };
  }, [constrained, enabled]);

  return { staticOnly, diagnostics: diagnosticsRef.current };
}

import { useCallback, useEffect, useRef, useState } from "react";
import type { AppMode } from "../types";

export const HUD_AUTO_HIDE_MS = 8000;
export const HUD_SOURCE_PICKER_AUTO_HIDE_MS = 12000;

interface AppModeOptions {
  hudAutoHideMs?: number;
  hudAutoHidePaused?: boolean;
}

function getIdleTotalMs(_mode: AppMode): number | null {
  return null;
}

export function useAppMode(initialMode: AppMode = "ambient", options: AppModeOptions = {}) {
  const hudAutoHideMs = options.hudAutoHideMs ?? HUD_AUTO_HIDE_MS;
  const hudAutoHidePaused = options.hudAutoHidePaused ?? false;
  const [mode, setMode] = useState<AppMode>(initialMode);
  const [hudVisible, setHudVisible] = useState(true);
  const [idleTotalMs, setIdleTotalMs] = useState(() => getIdleTotalMs(initialMode));
  const [idleRemainingMs, setIdleRemainingMs] = useState(() => getIdleTotalMs(initialMode));
  const [idleDeadlineMs, setIdleDeadlineMs] = useState<number | null>(() => {
    const total = getIdleTotalMs(initialMode);
    return total === null ? null : Date.now() + total;
  });
  const idleTimerRef = useRef<number | null>(null);
  const hudTimerRef = useRef<number | null>(null);

  const clearTimer = useCallback((ref: React.MutableRefObject<number | null>) => {
    if (ref.current !== null) {
      window.clearTimeout(ref.current);
      ref.current = null;
    }
  }, []);

  const scheduleHudAutoHide = useCallback(() => {
    clearTimer(hudTimerRef);
    if (hudAutoHidePaused) return;
    hudTimerRef.current = window.setTimeout(() => setHudVisible(false), hudAutoHideMs);
  }, [clearTimer, hudAutoHideMs, hudAutoHidePaused]);

  const showHud = useCallback(() => {
    setHudVisible(true);
    scheduleHudAutoHide();
  }, [scheduleHudAutoHide]);

  const hideHud = useCallback(() => {
    clearTimer(hudTimerRef);
    setHudVisible(false);
  }, [clearTimer]);

  const resetIdleTimer = useCallback(
    (nextMode = mode) => {
      clearTimer(idleTimerRef);
      const total = getIdleTotalMs(nextMode);
      setIdleTotalMs(total);
      setIdleRemainingMs(total);
      setIdleDeadlineMs(total === null ? null : Date.now() + total);

      if (total !== null) {
        idleTimerRef.current = window.setTimeout(() => setMode("ambient"), total);
      }
    },
    [clearTimer, mode]
  );

  const changeMode = useCallback(
    (nextMode: AppMode) => {
      setMode(nextMode);
      resetIdleTimer(nextMode);
    },
    [resetIdleTimer]
  );

  const toggleHud = useCallback(() => {
    setHudVisible((visible) => {
      const nextVisible = !visible;
      clearTimer(hudTimerRef);
      if (nextVisible) {
        if (!hudAutoHidePaused) {
          hudTimerRef.current = window.setTimeout(() => setHudVisible(false), hudAutoHideMs);
        }
      }
      return nextVisible;
    });
  }, [clearTimer, hudAutoHideMs, hudAutoHidePaused]);

  const returnAmbient = useCallback(() => {
    setMode("ambient");
    clearTimer(idleTimerRef);
    setIdleTotalMs(null);
    setIdleRemainingMs(null);
    setIdleDeadlineMs(null);
  }, [clearTimer]);

  useEffect(() => {
    resetIdleTimer(mode);
    return () => {
      clearTimer(idleTimerRef);
      clearTimer(hudTimerRef);
    };
  }, [clearTimer, mode, resetIdleTimer]);

  useEffect(() => {
    clearTimer(hudTimerRef);
    if (!hudVisible || hudAutoHidePaused) return undefined;

    hudTimerRef.current = window.setTimeout(() => setHudVisible(false), hudAutoHideMs);
    return () => clearTimer(hudTimerRef);
  }, [clearTimer, hudAutoHideMs, hudAutoHidePaused, hudVisible]);

  useEffect(() => {
    if (idleDeadlineMs === null) return undefined;

    const interval = window.setInterval(() => {
      setIdleRemainingMs(Math.max(0, idleDeadlineMs - Date.now()));
    }, 250);

    return () => window.clearInterval(interval);
  }, [idleDeadlineMs]);

  return {
    mode,
    hudVisible,
    idleTotalMs,
    idleRemainingMs,
    showHud,
    hideHud,
    toggleHud,
    changeMode,
    returnAmbient,
    resetIdleTimer
  };
}

import { useCallback, useEffect, useRef, useState } from "react";
import type { AppMode } from "../types";

const SETTINGS_IDLE_MS = 30000;
const HUD_AUTO_HIDE_MS = 5000;

function getIdleTotalMs(mode: AppMode): number | null {
  if (mode === "quickSettings") return SETTINGS_IDLE_MS;
  return null;
}

export function useAppMode(initialMode: AppMode = "ambient") {
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
    hudTimerRef.current = window.setTimeout(() => setHudVisible(false), HUD_AUTO_HIDE_MS);
  }, [clearTimer]);

  const showHud = useCallback(() => {
    setHudVisible(true);
    scheduleHudAutoHide();
  }, [scheduleHudAutoHide]);

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
        hudTimerRef.current = window.setTimeout(() => setHudVisible(false), HUD_AUTO_HIDE_MS);
      }
      return nextVisible;
    });
  }, [clearTimer]);

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
    if (!hudVisible) return undefined;

    hudTimerRef.current = window.setTimeout(() => setHudVisible(false), HUD_AUTO_HIDE_MS);
    return () => clearTimer(hudTimerRef);
  }, [clearTimer, hudVisible]);

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
    toggleHud,
    changeMode,
    returnAmbient,
    resetIdleTimer
  };
}

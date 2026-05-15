import { useCallback, useEffect, useRef, useState } from "react";
import type { AppMode } from "../types";

const PLAYER_IDLE_MS = 15000;
const SETTINGS_IDLE_MS = 30000;
const HUD_BOOST_MS = 3000;

export function useAppMode(initialMode: AppMode = "ambient") {
  const [mode, setMode] = useState<AppMode>(initialMode);
  const [hudBoosted, setHudBoosted] = useState(false);
  const idleTimerRef = useRef<number | null>(null);
  const hudTimerRef = useRef<number | null>(null);

  const clearTimer = useCallback((ref: React.MutableRefObject<number | null>) => {
    if (ref.current !== null) {
      window.clearTimeout(ref.current);
      ref.current = null;
    }
  }, []);

  const resetIdleTimer = useCallback(
    (nextMode = mode) => {
      clearTimer(idleTimerRef);
      if (nextMode === "player") {
        idleTimerRef.current = window.setTimeout(() => setMode("ambient"), PLAYER_IDLE_MS);
      }
      if (nextMode === "quickSettings") {
        idleTimerRef.current = window.setTimeout(() => setMode("ambient"), SETTINGS_IDLE_MS);
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

  const boostHud = useCallback(() => {
    setHudBoosted(true);
    clearTimer(hudTimerRef);
    hudTimerRef.current = window.setTimeout(() => setHudBoosted(false), HUD_BOOST_MS);
  }, [clearTimer]);

  const returnAmbient = useCallback(() => {
    setMode("ambient");
    clearTimer(idleTimerRef);
  }, [clearTimer]);

  useEffect(() => {
    resetIdleTimer(mode);
    return () => {
      clearTimer(idleTimerRef);
      clearTimer(hudTimerRef);
    };
  }, [clearTimer, mode, resetIdleTimer]);

  return {
    mode,
    hudBoosted,
    boostHud,
    changeMode,
    returnAmbient,
    resetIdleTimer
  };
}

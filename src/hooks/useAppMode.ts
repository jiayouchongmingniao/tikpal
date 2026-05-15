import { useCallback, useEffect, useRef, useState } from "react";
import type { AppMode } from "../types";

const PLAYER_IDLE_MS = 15000;
const SETTINGS_IDLE_MS = 30000;
const HUD_BOOST_MS = 3000;

function getIdleTotalMs(mode: AppMode): number | null {
  if (mode === "player") return PLAYER_IDLE_MS;
  if (mode === "quickSettings") return SETTINGS_IDLE_MS;
  return null;
}

export function useAppMode(initialMode: AppMode = "ambient") {
  const [mode, setMode] = useState<AppMode>(initialMode);
  const [hudBoosted, setHudBoosted] = useState(false);
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

  const boostHud = useCallback(() => {
    setHudBoosted(true);
    clearTimer(hudTimerRef);
    hudTimerRef.current = window.setTimeout(() => setHudBoosted(false), HUD_BOOST_MS);
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
    if (idleDeadlineMs === null) return undefined;

    const interval = window.setInterval(() => {
      setIdleRemainingMs(Math.max(0, idleDeadlineMs - Date.now()));
    }, 250);

    return () => window.clearInterval(interval);
  }, [idleDeadlineMs]);

  return {
    mode,
    hudBoosted,
    idleTotalMs,
    idleRemainingMs,
    boostHud,
    changeMode,
    returnAmbient,
    resetIdleTimer
  };
}

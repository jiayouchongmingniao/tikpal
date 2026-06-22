import { useCallback, useEffect, useState } from "react";
import {
  fetchRoomExperienceState,
  sendRoomExperienceAction as postRoomExperienceAction
} from "../api/tikpalClient";
import type { RoomExperienceActionRequest, RoomExperienceState } from "../types";

const REFRESH_MS = 5000;

export const fallbackRoomExperienceState: RoomExperienceState = {
  mode: "calm",
  phase: "idle",
  presetId: "calm-rain-room",
  sceneVideoId: "rainy-window",
  hifiEqPresetId: "flat",
  hifiVisualPresetId: "spectrum-bars",
  sceneSoundEnabled: true,
  playlistId: null,
  volumePercent: 38,
  brightnessPercent: 48,
  timerMinutes: 45,
  timerEndsAt: null,
  nightSchedule: {
    enabled: true,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
    start: "22:30",
    end: "06:30",
    brightnessPercent: 5,
    active: false,
    preNightBrightnessPercent: null
  },
  updatedAt: new Date().toISOString()
};

export interface RoomExperienceStatus {
  source: "api" | "fallback";
  pending: boolean;
  error: string | null;
  lastSuccessAtMs: number | null;
  pendingAction: string | null;
  pendingSinceMs: number | null;
}

export function useRoomExperience() {
  const [experience, setExperience] = useState<RoomExperienceState>(fallbackRoomExperienceState);
  const [status, setStatus] = useState<RoomExperienceStatus>({
    source: "fallback",
    pending: false,
    error: null,
    lastSuccessAtMs: null,
    pendingAction: null,
    pendingSinceMs: null
  });

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const nextExperience = await fetchRoomExperienceState(signal);
      const lastSuccessAtMs = Date.now();
      setExperience(nextExperience);
      setStatus((current) => ({
        ...current,
        source: "api",
        error: null,
        lastSuccessAtMs
      }));
    } catch (error) {
      if (signal?.aborted) return;
      setStatus((current) => ({
        ...current,
        source: "fallback",
        error: error instanceof Error ? error.message : "Tikpal experience API unavailable"
      }));
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const interval = window.setInterval(() => {
      void refresh();
    }, REFRESH_MS);

    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [refresh]);

  const sendExperienceAction = useCallback(async (action: RoomExperienceActionRequest) => {
    const pendingSinceMs = Date.now();
    setStatus((current) => ({ ...current, pending: true, pendingAction: `experience:${action.type}`, pendingSinceMs, error: null }));
    try {
      const nextExperience = await postRoomExperienceAction(action);
      const lastSuccessAtMs = Date.now();
      setExperience(nextExperience);
      setStatus({ source: "api", pending: false, error: null, lastSuccessAtMs, pendingAction: null, pendingSinceMs: null });
      return nextExperience;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Experience action failed";
      setStatus((current) => ({
        ...current,
        pending: false,
        pendingAction: null,
        pendingSinceMs: null,
        error: message
      }));
      throw new Error(message);
    }
  }, []);

  return {
    experience,
    status,
    refresh,
    sendExperienceAction
  };
}
